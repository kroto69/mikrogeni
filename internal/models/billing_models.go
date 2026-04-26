package models

type BillingServicePlanCreateRequest struct {
	Code             string `json:"code"`
	Name             string `json:"name"`
	Price            int    `json:"price"`
	BillingCycleDays int    `json:"billing_cycle_days,omitempty"`
	MikroTikProfile  string `json:"mikrotik_profile,omitempty"`
	IsActive         *bool  `json:"is_active,omitempty"`
}

type BillingCustomerCreateRequest struct {
	CustomerCode     string `json:"customer_code"`
	FullName         string `json:"full_name"`
	Phone            string `json:"phone,omitempty"`
	Address          string `json:"address,omitempty"`
	MikroTikDeviceID string `json:"mikrotik_device_id"`
	PPPSecretName    string `json:"ppp_secret_name"`
	ServicePlanID    int    `json:"service_plan_id"`
	NextBillingAt    string `json:"next_billing_at,omitempty"`
}

type BillingPaymentCreateRequest struct {
	Amount      int    `json:"amount"`
	Method      string `json:"method,omitempty"`
	ReferenceNo string `json:"reference_no,omitempty"`
	PaidAt      string `json:"paid_at,omitempty"`
	Note        string `json:"note,omitempty"`
}
