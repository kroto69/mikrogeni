package services

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"genieacs-backend/internal/db"
	"genieacs-backend/internal/models"
)

const (
	BillingCustomerStatusActive    = "active"
	BillingCustomerStatusOverdue   = "overdue"
	BillingCustomerStatusSuspended = "suspended"

	BillingInvoiceStatusUnpaid  = "unpaid"
	BillingInvoiceStatusPartial = "partial"
	BillingInvoiceStatusOverdue = "overdue"
	BillingInvoiceStatusPaid    = "paid"
)

type BillingService struct {
	mikroTikAdapter BillingMikroTikAdapter
	nowFunc         func() time.Time
}

type BillingRecurringResult struct {
	Generated int      `json:"generated"`
	Skipped   int      `json:"skipped"`
	Errors    []string `json:"errors,omitempty"`
}

type BillingOverdueResult struct {
	MarkedOverdue int      `json:"marked_overdue"`
	Suspended     int      `json:"suspended"`
	Errors        []string `json:"errors,omitempty"`
}

type BillingPaymentResult struct {
	Payment         *db.BillingPaymentRecord  `json:"payment"`
	Invoice         *db.BillingInvoiceRecord  `json:"invoice"`
	Customer        *db.BillingCustomerRecord `json:"customer,omitempty"`
	LifecycleAction string                    `json:"lifecycle_action,omitempty"`
	Warning         string                    `json:"warning,omitempty"`
}

var (
	billingServiceOnce     sync.Once
	billingServiceInstance *BillingService
)

func GetBillingService() *BillingService {
	billingServiceOnce.Do(func() {
		billingServiceInstance = &BillingService{
			mikroTikAdapter: NewBillingMikroTikAdapter(),
			nowFunc:         time.Now,
		}
	})

	return billingServiceInstance
}

func NewBillingServiceForTesting(adapter BillingMikroTikAdapter, nowFn func() time.Time) *BillingService {
	if adapter == nil {
		adapter = NewBillingMikroTikAdapter()
	}
	if nowFn == nil {
		nowFn = time.Now
	}

	return &BillingService{mikroTikAdapter: adapter, nowFunc: nowFn}
}

func (s *BillingService) CreateServicePlan(request models.BillingServicePlanCreateRequest) (*db.BillingServicePlanRecord, error) {
	request.Code = strings.TrimSpace(request.Code)
	request.Name = strings.TrimSpace(request.Name)
	request.MikroTikProfile = strings.TrimSpace(request.MikroTikProfile)

	if request.Code == "" || request.Name == "" {
		return nil, fmt.Errorf("code and name are required")
	}
	if request.Price <= 0 {
		return nil, fmt.Errorf("price must be greater than zero")
	}

	isActive := true
	if request.IsActive != nil {
		isActive = *request.IsActive
	}

	return db.CreateBillingServicePlan(db.BillingServicePlanRecord{
		Code:             request.Code,
		Name:             request.Name,
		Price:            request.Price,
		BillingCycleDays: request.BillingCycleDays,
		MikroTikProfile:  request.MikroTikProfile,
		IsActive:         isActive,
	})
}

func (s *BillingService) ListServicePlans(activeOnly bool) ([]db.BillingServicePlanRecord, error) {
	return db.ListBillingServicePlans(activeOnly)
}

func (s *BillingService) CreateCustomer(request models.BillingCustomerCreateRequest) (*db.BillingCustomerRecord, error) {
	request.CustomerCode = strings.TrimSpace(request.CustomerCode)
	request.FullName = strings.TrimSpace(request.FullName)
	request.Phone = strings.TrimSpace(request.Phone)
	request.Address = strings.TrimSpace(request.Address)
	request.MikroTikDeviceID = strings.TrimSpace(request.MikroTikDeviceID)
	request.PPPSecretName = strings.TrimSpace(request.PPPSecretName)

	if request.CustomerCode == "" || request.FullName == "" {
		return nil, fmt.Errorf("customer_code and full_name are required")
	}
	if request.MikroTikDeviceID == "" || request.PPPSecretName == "" {
		return nil, fmt.Errorf("mikrotik_device_id and ppp_secret_name are required")
	}
	if request.ServicePlanID <= 0 {
		return nil, fmt.Errorf("service_plan_id must be greater than zero")
	}

	plan, err := db.GetBillingServicePlanByID(request.ServicePlanID)
	if err != nil {
		return nil, err
	}
	if plan == nil {
		return nil, fmt.Errorf("service plan not found")
	}
	if !plan.IsActive {
		return nil, fmt.Errorf("service plan is not active")
	}

	nextBillingAt := strings.TrimSpace(request.NextBillingAt)
	if nextBillingAt == "" {
		nextBillingAt = s.nowFunc().UTC().Format(time.RFC3339)
	} else {
		parsedNextBillingAt, parseErr := parseBillingTimestampStrict(nextBillingAt)
		if parseErr != nil {
			return nil, parseErr
		}
		nextBillingAt = parsedNextBillingAt
	}

	return db.CreateBillingCustomer(db.BillingCustomerRecord{
		CustomerCode:     request.CustomerCode,
		FullName:         request.FullName,
		Phone:            request.Phone,
		Address:          request.Address,
		MikroTikDeviceID: request.MikroTikDeviceID,
		PPPSecretName:    request.PPPSecretName,
		ServicePlanID:    request.ServicePlanID,
		Status:           BillingCustomerStatusActive,
		NextBillingAt:    nextBillingAt,
	})
}

func (s *BillingService) ListCustomers(statusFilter string) ([]db.BillingCustomerRecord, error) {
	return db.ListBillingCustomers(strings.TrimSpace(statusFilter))
}

func (s *BillingService) ListInvoices(statusFilter string, customerID int) ([]db.BillingInvoiceRecord, error) {
	return db.ListBillingInvoices(strings.TrimSpace(statusFilter), customerID)
}

func (s *BillingService) ListPayments(invoiceID int) ([]db.BillingPaymentRecord, error) {
	return db.ListBillingPayments(invoiceID)
}

func (s *BillingService) GenerateRecurringInvoices(reference time.Time) (*BillingRecurringResult, error) {
	now := reference.UTC()
	customers, err := db.ListDueBillingCustomers(now.Format(time.RFC3339))
	if err != nil {
		return nil, err
	}

	result := &BillingRecurringResult{Generated: 0, Skipped: 0, Errors: make([]string, 0)}
	for _, customer := range customers {
		plan, planErr := db.GetBillingServicePlanByID(customer.ServicePlanID)
		if planErr != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("customer=%d plan lookup failed: %v", customer.ID, planErr))
			continue
		}
		if plan == nil {
			result.Errors = append(result.Errors, fmt.Sprintf("customer=%d service plan missing", customer.ID))
			continue
		}

		cycleDays := plan.BillingCycleDays
		if cycleDays <= 0 {
			cycleDays = 30
		}

		periodStartTime := parseBillingAnchor(customer.NextBillingAt, now)
		periodEndTime := periodStartTime.AddDate(0, 0, cycleDays)

		periodStart := periodStartTime.Format("2006-01-02")
		periodEnd := periodEndTime.Format("2006-01-02")
		existing, existingErr := db.GetOpenBillingInvoiceByPeriod(customer.ID, periodStart, periodEnd)
		if existingErr != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("customer=%d existing invoice check failed: %v", customer.ID, existingErr))
			continue
		}
		if existing != nil {
			result.Skipped++
			if err := db.UpdateBillingCustomerNextBillingAt(customer.ID, periodEndTime.Format(time.RFC3339)); err != nil {
				result.Errors = append(result.Errors, fmt.Sprintf("customer=%d update next billing failed: %v", customer.ID, err))
			}
			continue
		}

		invoiceNumber := buildInvoiceNumber(customer.ID, periodStartTime)
		dueDate := periodStartTime.AddDate(0, 0, 7).Format("2006-01-02")

		_, createErr := db.CreateBillingInvoice(db.BillingInvoiceRecord{
			InvoiceNumber: invoiceNumber,
			CustomerID:    customer.ID,
			ServicePlanID: customer.ServicePlanID,
			PeriodStart:   periodStart,
			PeriodEnd:     periodEnd,
			DueDate:       dueDate,
			Amount:        plan.Price,
			PaidAmount:    0,
			Status:        BillingInvoiceStatusUnpaid,
			GeneratedAt:   now.Format(time.RFC3339),
		})
		if createErr != nil {
			if isInvoicePeriodUniqueConflict(createErr) {
				result.Skipped++
				if err := db.UpdateBillingCustomerNextBillingAt(customer.ID, periodEndTime.Format(time.RFC3339)); err != nil {
					result.Errors = append(result.Errors, fmt.Sprintf("customer=%d update next billing after duplicate failed: %v", customer.ID, err))
				}
				continue
			}
			result.Errors = append(result.Errors, fmt.Sprintf("customer=%d create invoice failed: %v", customer.ID, createErr))
			continue
		}

		if err := db.UpdateBillingCustomerNextBillingAt(customer.ID, periodEndTime.Format(time.RFC3339)); err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("customer=%d update next billing failed: %v", customer.ID, err))
			continue
		}

		result.Generated++
	}

	if len(result.Errors) == 0 {
		result.Errors = nil
	}

	return result, nil
}

func (s *BillingService) RunOverdueChecker(reference time.Time) (*BillingOverdueResult, error) {
	now := reference.UTC()
	referenceDate := now.Format("2006-01-02")
	invoicesToMarkOverdue, err := db.ListInvoicesToMarkOverdue(referenceDate)
	if err != nil {
		return nil, err
	}

	result := &BillingOverdueResult{MarkedOverdue: 0, Suspended: 0, Errors: make([]string, 0)}
	for _, invoice := range invoicesToMarkOverdue {
		if err := db.UpdateBillingInvoiceStatus(invoice.ID, BillingInvoiceStatusOverdue); err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("invoice=%d update overdue failed: %v", invoice.ID, err))
			continue
		}
		result.MarkedOverdue++
	}

	overdueCustomers, err := db.ListCustomersPendingOverdueSuspension(referenceDate)
	if err != nil {
		return nil, err
	}

	for _, customer := range overdueCustomers {
		if err := db.UpdateBillingCustomerStatus(customer.ID, BillingCustomerStatusOverdue, customer.LastSuspendedAt); err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("customer=%d set overdue failed: %v", customer.ID, err))
			continue
		}

		if err := s.mikroTikAdapter.Suspend(customer.MikroTikDeviceID, customer.PPPSecretName); err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("customer=%d suspend mikrotik failed: %v", customer.ID, err))
			continue
		}

		suspendedAt := now.Format(time.RFC3339)
		if err := db.UpdateBillingCustomerStatus(customer.ID, BillingCustomerStatusSuspended, suspendedAt); err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("customer=%d set suspended failed: %v", customer.ID, err))
			continue
		}

		result.Suspended++
	}

	if len(result.Errors) == 0 {
		result.Errors = nil
	}

	return result, nil
}

func (s *BillingService) CreatePayment(invoiceID int, request models.BillingPaymentCreateRequest) (*BillingPaymentResult, error) {
	if invoiceID <= 0 {
		return nil, fmt.Errorf("invoice_id is required")
	}
	if request.Amount <= 0 {
		return nil, fmt.Errorf("amount must be greater than zero")
	}

	invoice, err := db.GetBillingInvoiceByID(invoiceID)
	if err != nil {
		return nil, err
	}
	if invoice == nil {
		return nil, fmt.Errorf("invoice not found")
	}
	if invoice.Status == BillingInvoiceStatusPaid {
		return nil, fmt.Errorf("invoice already paid")
	}

	paidAt := strings.TrimSpace(request.PaidAt)
	if paidAt == "" {
		paidAt = s.nowFunc().UTC().Format(time.RFC3339)
	}

	payment, updatedInvoice, err := db.CreateBillingPaymentAtomic(
		invoiceID,
		request.Amount,
		strings.TrimSpace(request.Method),
		strings.TrimSpace(request.ReferenceNo),
		paidAt,
		strings.TrimSpace(request.Note),
	)
	if err != nil {
		if errors.Is(err, db.ErrBillingInvoiceNotFound) {
			return nil, fmt.Errorf("invoice not found")
		}
		if errors.Is(err, db.ErrBillingInvoiceAlreadyPaid) {
			return nil, fmt.Errorf("invoice already paid")
		}
		if errors.Is(err, db.ErrBillingPaymentOverpaid) {
			return nil, fmt.Errorf("payment amount exceeds invoice remaining balance")
		}
		return nil, err
	}

	result := &BillingPaymentResult{Payment: payment, Invoice: updatedInvoice}

	customer, err := db.GetBillingCustomerByID(updatedInvoice.CustomerID)
	if err != nil {
		return nil, err
	}
	if customer == nil {
		return result, nil
	}
	result.Customer = customer

	if updatedInvoice.Status != BillingInvoiceStatusPaid {
		return result, nil
	}

	hasOutstanding, err := db.HasCustomerOutstandingOverdueInvoices(customer.ID, s.nowFunc().UTC().Format("2006-01-02"))
	if err != nil {
		return nil, err
	}
	if hasOutstanding {
		result.LifecycleAction = "paid-invoice-but-still-overdue"
		return result, nil
	}

	if customer.Status == BillingCustomerStatusSuspended || customer.Status == BillingCustomerStatusOverdue {
		if err := s.mikroTikAdapter.Restore(customer.MikroTikDeviceID, customer.PPPSecretName); err != nil {
			result.Warning = fmt.Sprintf("payment saved but restore mikrotik failed: %v", err)
			return result, nil
		}
	}

	if err := db.UpdateBillingCustomerStatus(customer.ID, BillingCustomerStatusActive, ""); err != nil {
		return nil, err
	}

	refreshedCustomer, err := db.GetBillingCustomerByID(customer.ID)
	if err != nil {
		return nil, err
	}
	result.Customer = refreshedCustomer
	result.LifecycleAction = "paid->active"

	return result, nil
}

func parseBillingAnchor(raw string, fallback time.Time) time.Time {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return fallback.UTC()
	}

	if parsed, err := time.Parse(time.RFC3339, trimmed); err == nil {
		return parsed.UTC()
	}
	if parsed, err := time.Parse("2006-01-02", trimmed); err == nil {
		return parsed.UTC()
	}

	return fallback.UTC()
}

func parseBillingTimestampStrict(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", fmt.Errorf("next_billing_at is required")
	}

	if parsed, err := time.Parse(time.RFC3339, trimmed); err == nil {
		return parsed.UTC().Format(time.RFC3339), nil
	}
	if parsed, err := time.Parse("2006-01-02", trimmed); err == nil {
		return parsed.UTC().Format(time.RFC3339), nil
	}

	return "", fmt.Errorf("next_billing_at must be RFC3339 or YYYY-MM-DD")
}

func isInvoicePeriodUniqueConflict(err error) bool {
	if err == nil {
		return false
	}

	normalized := strings.ToLower(err.Error())
	return strings.Contains(normalized, "unique constraint failed") &&
		strings.Contains(normalized, "invoices.customer_id") &&
		strings.Contains(normalized, "invoices.period_start") &&
		strings.Contains(normalized, "invoices.period_end")
}

func buildInvoiceNumber(customerID int, periodStart time.Time) string {
	stamp := periodStart.UTC().Format("200601")
	unixPart := strconv.FormatInt(time.Now().UTC().UnixNano()%1000000, 10)
	return fmt.Sprintf("INV-%s-%04d-%s", stamp, customerID, unixPart)
}
