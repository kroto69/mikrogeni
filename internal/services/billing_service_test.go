package services

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"genieacs-backend/internal/db"
	"genieacs-backend/internal/models"
)

type billingAdapterSpy struct {
	suspended       []string
	restored        []string
	suspendFailures int
}

func (s *billingAdapterSpy) Suspend(deviceID, pppSecretName string) error {
	s.suspended = append(s.suspended, deviceID+":"+pppSecretName)
	if s.suspendFailures > 0 {
		s.suspendFailures--
		return fmt.Errorf("simulated suspend failure")
	}
	return nil
}

func (s *billingAdapterSpy) Restore(deviceID, pppSecretName string) error {
	s.restored = append(s.restored, deviceID+":"+pppSecretName)
	return nil
}

func setupBillingServiceTestDB(t *testing.T) {
	t.Helper()

	t.Setenv("BOOTSTRAP_ADMIN_USERNAME", "")
	t.Setenv("BOOTSTRAP_ADMIN_PASSWORD", "")

	dbPath := filepath.Join(t.TempDir(), "billing-test.sqlite")
	_, err := db.Init(dbPath)
	if err != nil {
		t.Fatalf("init db: %v", err)
	}

	t.Cleanup(func() {
		if db.DB != nil {
			_ = db.DB.Close()
			db.DB = nil
		}
	})
}

func TestBillingLifecycleRecurringOverduePaidActive(t *testing.T) {
	setupBillingServiceTestDB(t)

	baseNow := time.Date(2026, time.January, 10, 10, 0, 0, 0, time.UTC)
	adapter := &billingAdapterSpy{}
	service := NewBillingServiceForTesting(adapter, func() time.Time { return baseNow })

	plan, err := service.CreateServicePlan(models.BillingServicePlanCreateRequest{
		Code:             "HOME20",
		Name:             "Home 20Mbps",
		Price:            200000,
		BillingCycleDays: 30,
	})
	if err != nil {
		t.Fatalf("create service plan: %v", err)
	}

	customer, err := service.CreateCustomer(models.BillingCustomerCreateRequest{
		CustomerCode:     "CUST-001",
		FullName:         "Andi Setiawan",
		MikroTikDeviceID: "mtk-a",
		PPPSecretName:    "andi-pppoe",
		ServicePlanID:    plan.ID,
		NextBillingAt:    baseNow.AddDate(0, 0, -1).Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("create customer: %v", err)
	}

	recurringResult, err := service.GenerateRecurringInvoices(baseNow)
	if err != nil {
		t.Fatalf("generate recurring invoices: %v", err)
	}
	if recurringResult.Generated != 1 {
		t.Fatalf("expected 1 generated invoice, got %d", recurringResult.Generated)
	}

	invoices, err := service.ListInvoices("", customer.ID)
	if err != nil {
		t.Fatalf("list invoices: %v", err)
	}
	if len(invoices) != 1 {
		t.Fatalf("expected 1 invoice, got %d", len(invoices))
	}
	if invoices[0].Status != BillingInvoiceStatusUnpaid {
		t.Fatalf("expected invoice status unpaid, got %s", invoices[0].Status)
	}

	overdueTime := baseNow.AddDate(0, 0, 20)
	overdueResult, err := service.RunOverdueChecker(overdueTime)
	if err != nil {
		t.Fatalf("run overdue checker: %v", err)
	}
	if overdueResult.MarkedOverdue != 1 {
		t.Fatalf("expected 1 overdue invoice, got %d", overdueResult.MarkedOverdue)
	}
	if overdueResult.Suspended != 1 {
		t.Fatalf("expected 1 suspended customer, got %d", overdueResult.Suspended)
	}
	if len(adapter.suspended) != 1 {
		t.Fatalf("expected suspend adapter called once, got %d", len(adapter.suspended))
	}

	refreshedCustomer, err := db.GetBillingCustomerByID(customer.ID)
	if err != nil {
		t.Fatalf("get customer after overdue: %v", err)
	}
	if refreshedCustomer == nil {
		t.Fatal("customer not found after overdue")
	}
	if refreshedCustomer.Status != BillingCustomerStatusSuspended {
		t.Fatalf("expected customer suspended, got %s", refreshedCustomer.Status)
	}

	paymentResult, err := service.CreatePayment(invoices[0].ID, models.BillingPaymentCreateRequest{
		Amount:      invoices[0].Amount,
		Method:      "cash",
		ReferenceNo: "PAY-001",
	})
	if err != nil {
		t.Fatalf("create payment: %v", err)
	}
	if paymentResult.Invoice == nil || paymentResult.Invoice.Status != BillingInvoiceStatusPaid {
		t.Fatalf("expected paid invoice after payment, got %#v", paymentResult.Invoice)
	}
	if paymentResult.Customer == nil || paymentResult.Customer.Status != BillingCustomerStatusActive {
		t.Fatalf("expected customer active after full payment, got %#v", paymentResult.Customer)
	}
	if len(adapter.restored) != 1 {
		t.Fatalf("expected restore adapter called once, got %d", len(adapter.restored))
	}
}

func TestCreateCustomerRejectsInvalidNextBillingAt(t *testing.T) {
	setupBillingServiceTestDB(t)

	baseNow := time.Date(2026, time.January, 10, 10, 0, 0, 0, time.UTC)
	service := NewBillingServiceForTesting(&billingAdapterSpy{}, func() time.Time { return baseNow })

	plan, err := service.CreateServicePlan(models.BillingServicePlanCreateRequest{
		Code:             "HOME10",
		Name:             "Home 10Mbps",
		Price:            100000,
		BillingCycleDays: 30,
	})
	if err != nil {
		t.Fatalf("create service plan: %v", err)
	}

	_, err = service.CreateCustomer(models.BillingCustomerCreateRequest{
		CustomerCode:     "CUST-INV-DATE",
		FullName:         "Tanggal Invalid",
		MikroTikDeviceID: "mtk-a",
		PPPSecretName:    "cust-invalid-date",
		ServicePlanID:    plan.ID,
		NextBillingAt:    "2026/01/10 10:00",
	})
	if err == nil {
		t.Fatal("expected invalid next_billing_at error")
	}
	if !strings.Contains(err.Error(), "next_billing_at") {
		t.Fatalf("expected next_billing_at validation error, got %v", err)
	}
}

func TestOverdueCheckerRetriesSuspensionAfterFailure(t *testing.T) {
	setupBillingServiceTestDB(t)

	baseNow := time.Date(2026, time.January, 10, 10, 0, 0, 0, time.UTC)
	adapter := &billingAdapterSpy{suspendFailures: 1}
	service := NewBillingServiceForTesting(adapter, func() time.Time { return baseNow })

	plan, err := service.CreateServicePlan(models.BillingServicePlanCreateRequest{
		Code:             "HOME30",
		Name:             "Home 30Mbps",
		Price:            300000,
		BillingCycleDays: 30,
	})
	if err != nil {
		t.Fatalf("create service plan: %v", err)
	}

	customer, err := service.CreateCustomer(models.BillingCustomerCreateRequest{
		CustomerCode:     "CUST-RETRY",
		FullName:         "Retry Suspend",
		MikroTikDeviceID: "mtk-a",
		PPPSecretName:    "retry-pppoe",
		ServicePlanID:    plan.ID,
		NextBillingAt:    baseNow.AddDate(0, 0, -1).Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("create customer: %v", err)
	}

	if _, err := service.GenerateRecurringInvoices(baseNow); err != nil {
		t.Fatalf("generate recurring invoices: %v", err)
	}

	overdueTime := baseNow.AddDate(0, 0, 20)
	firstRun, err := service.RunOverdueChecker(overdueTime)
	if err != nil {
		t.Fatalf("first overdue run: %v", err)
	}
	if firstRun.MarkedOverdue != 1 {
		t.Fatalf("expected first run marked_overdue=1, got %d", firstRun.MarkedOverdue)
	}
	if firstRun.Suspended != 0 {
		t.Fatalf("expected first run suspended=0, got %d", firstRun.Suspended)
	}

	customerAfterFirstRun, err := db.GetBillingCustomerByID(customer.ID)
	if err != nil {
		t.Fatalf("get customer after first run: %v", err)
	}
	if customerAfterFirstRun == nil || customerAfterFirstRun.Status != BillingCustomerStatusOverdue {
		t.Fatalf("expected customer overdue after failed suspend, got %#v", customerAfterFirstRun)
	}

	secondRun, err := service.RunOverdueChecker(overdueTime)
	if err != nil {
		t.Fatalf("second overdue run: %v", err)
	}
	if secondRun.MarkedOverdue != 0 {
		t.Fatalf("expected second run marked_overdue=0, got %d", secondRun.MarkedOverdue)
	}
	if secondRun.Suspended != 1 {
		t.Fatalf("expected second run suspended=1, got %d", secondRun.Suspended)
	}

	customerAfterSecondRun, err := db.GetBillingCustomerByID(customer.ID)
	if err != nil {
		t.Fatalf("get customer after second run: %v", err)
	}
	if customerAfterSecondRun == nil || customerAfterSecondRun.Status != BillingCustomerStatusSuspended {
		t.Fatalf("expected customer suspended after retry, got %#v", customerAfterSecondRun)
	}
	if len(adapter.suspended) != 2 {
		t.Fatalf("expected suspend called twice, got %d", len(adapter.suspended))
	}
}

func TestCreatePaymentRejectsOverpayment(t *testing.T) {
	setupBillingServiceTestDB(t)

	baseNow := time.Date(2026, time.January, 10, 10, 0, 0, 0, time.UTC)
	service := NewBillingServiceForTesting(&billingAdapterSpy{}, func() time.Time { return baseNow })

	plan, err := service.CreateServicePlan(models.BillingServicePlanCreateRequest{
		Code:             "HOME25",
		Name:             "Home 25Mbps",
		Price:            250000,
		BillingCycleDays: 30,
	})
	if err != nil {
		t.Fatalf("create service plan: %v", err)
	}

	customer, err := service.CreateCustomer(models.BillingCustomerCreateRequest{
		CustomerCode:     "CUST-OVERPAY",
		FullName:         "Overpay User",
		MikroTikDeviceID: "mtk-a",
		PPPSecretName:    "overpay-pppoe",
		ServicePlanID:    plan.ID,
		NextBillingAt:    baseNow.AddDate(0, 0, -1).Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("create customer: %v", err)
	}

	recurringResult, err := service.GenerateRecurringInvoices(baseNow)
	if err != nil {
		t.Fatalf("generate recurring invoices: %v", err)
	}
	if recurringResult.Generated != 1 {
		t.Fatalf("expected 1 generated invoice, got %d", recurringResult.Generated)
	}

	invoices, err := service.ListInvoices("", customer.ID)
	if err != nil {
		t.Fatalf("list invoices: %v", err)
	}
	if len(invoices) != 1 {
		t.Fatalf("expected 1 invoice, got %d", len(invoices))
	}
	invoice := invoices[0]

	if _, err := service.CreatePayment(invoice.ID, models.BillingPaymentCreateRequest{Amount: 200000, Method: "cash"}); err != nil {
		t.Fatalf("create first partial payment: %v", err)
	}

	_, err = service.CreatePayment(invoice.ID, models.BillingPaymentCreateRequest{Amount: 60000, Method: "cash"})
	if err == nil {
		t.Fatal("expected overpayment to be rejected")
	}
	if !strings.Contains(err.Error(), "remaining balance") {
		t.Fatalf("expected remaining balance error, got %v", err)
	}

	updatedInvoice, err := db.GetBillingInvoiceByID(invoice.ID)
	if err != nil {
		t.Fatalf("get invoice after overpayment rejection: %v", err)
	}
	if updatedInvoice == nil {
		t.Fatal("invoice not found after overpayment rejection")
	}
	if updatedInvoice.PaidAmount != 200000 {
		t.Fatalf("expected paid_amount stay 200000, got %d", updatedInvoice.PaidAmount)
	}
	if updatedInvoice.Status != BillingInvoiceStatusPartial {
		t.Fatalf("expected invoice status partial, got %s", updatedInvoice.Status)
	}
}
