package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"genieacs-backend/internal/models"
	"genieacs-backend/internal/services"

	"github.com/go-chi/chi/v5"
)

func GetBillingServicePlans(w http.ResponseWriter, r *http.Request) {
	activeOnly := strings.TrimSpace(r.URL.Query().Get("active_only")) == "1"

	plans, err := services.GetBillingService().ListServicePlans(activeOnly)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to list service plans", Detail: err.Error()})
		return
	}

	_ = json.NewEncoder(w).Encode(plans)
}

func CreateBillingServicePlan(w http.ResponseWriter, r *http.Request) {
	var request models.BillingServicePlanCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "invalid request body", Detail: err.Error()})
		return
	}

	plan, err := services.GetBillingService().CreateServicePlan(request)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to create service plan", Detail: err.Error()})
		return
	}

	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(plan)
}

func GetBillingCustomers(w http.ResponseWriter, r *http.Request) {
	statusFilter := strings.TrimSpace(r.URL.Query().Get("status"))

	customers, err := services.GetBillingService().ListCustomers(statusFilter)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to list billing customers", Detail: err.Error()})
		return
	}

	_ = json.NewEncoder(w).Encode(customers)
}

func CreateBillingCustomer(w http.ResponseWriter, r *http.Request) {
	var request models.BillingCustomerCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "invalid request body", Detail: err.Error()})
		return
	}

	customer, err := services.GetBillingService().CreateCustomer(request)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to create billing customer", Detail: err.Error()})
		return
	}

	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(customer)
}

func GetBillingInvoices(w http.ResponseWriter, r *http.Request) {
	statusFilter := strings.TrimSpace(r.URL.Query().Get("status"))
	customerID := 0
	if raw := strings.TrimSpace(r.URL.Query().Get("customer_id")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "invalid customer_id query"})
			return
		}
		customerID = parsed
	}

	invoices, err := services.GetBillingService().ListInvoices(statusFilter, customerID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to list invoices", Detail: err.Error()})
		return
	}

	_ = json.NewEncoder(w).Encode(invoices)
}

func CreateBillingPayment(w http.ResponseWriter, r *http.Request) {
	invoiceIDRaw := strings.TrimSpace(chi.URLParam(r, "invoice_id"))
	invoiceID, err := strconv.Atoi(invoiceIDRaw)
	if err != nil || invoiceID <= 0 {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "invalid invoice_id path parameter"})
		return
	}

	var request models.BillingPaymentCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "invalid request body", Detail: err.Error()})
		return
	}

	result, err := services.GetBillingService().CreatePayment(invoiceID, request)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to create payment", Detail: err.Error()})
		return
	}

	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(result)
}

func GetBillingPayments(w http.ResponseWriter, r *http.Request) {
	invoiceID := 0
	if raw := strings.TrimSpace(r.URL.Query().Get("invoice_id")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "invalid invoice_id query"})
			return
		}
		invoiceID = parsed
	}

	payments, err := services.GetBillingService().ListPayments(invoiceID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to list payments", Detail: err.Error()})
		return
	}

	_ = json.NewEncoder(w).Encode(payments)
}

func RunRecurringBillingNow(w http.ResponseWriter, r *http.Request) {
	result, err := services.GetBillingService().GenerateRecurringInvoices(time.Now().UTC())
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to run recurring billing", Detail: err.Error()})
		return
	}

	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(result)
}

func RunOverdueCheckerNow(w http.ResponseWriter, r *http.Request) {
	result, err := services.GetBillingService().RunOverdueChecker(time.Now().UTC())
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to run overdue checker", Detail: err.Error()})
		return
	}

	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(result)
}
