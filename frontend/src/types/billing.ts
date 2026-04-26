export type BillingServicePlan = {
  id: number;
  code: string;
  name: string;
  price: number;
  billing_cycle_days: number;
  mikrotik_profile: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type BillingCustomerStatus = "active" | "overdue" | "suspended";

export type BillingCustomer = {
  id: number;
  customer_code: string;
  full_name: string;
  phone: string;
  address: string;
  mikrotik_device_id: string;
  ppp_secret_name: string;
  service_plan_id: number;
  status: BillingCustomerStatus;
  next_billing_at: string;
  last_suspended_at: string;
  created_at: string;
  updated_at: string;
  service_plan_code: string;
  service_plan_name: string;
  service_plan_price: number;
};

export type BillingInvoiceStatus = "unpaid" | "partial" | "overdue" | "paid";

export type BillingInvoice = {
  id: number;
  invoice_number: string;
  customer_id: number;
  service_plan_id: number;
  period_start: string;
  period_end: string;
  due_date: string;
  amount: number;
  paid_amount: number;
  status: BillingInvoiceStatus;
  generated_at: string;
  paid_at: string;
  created_at: string;
  updated_at: string;
  customer_code: string;
  customer_name: string;
  service_plan_code: string;
  service_plan_name: string;
};

export type BillingPayment = {
  id: number;
  invoice_id: number;
  amount: number;
  method: string;
  reference_no: string;
  paid_at: string;
  note: string;
  created_at: string;
};

export type CreateBillingServicePlanPayload = {
  code: string;
  name: string;
  price: number;
  billing_cycle_days?: number;
  mikrotik_profile?: string;
  is_active?: boolean;
};

export type CreateBillingCustomerPayload = {
  customer_code: string;
  full_name: string;
  phone?: string;
  address?: string;
  mikrotik_device_id: string;
  ppp_secret_name: string;
  service_plan_id: number;
  next_billing_at?: string;
};

export type CreateBillingPaymentPayload = {
  amount: number;
  method?: string;
  reference_no?: string;
  paid_at?: string;
  note?: string;
};

export type BillingRecurringResult = {
  generated: number;
  skipped: number;
  errors?: string[];
};

export type BillingOverdueResult = {
  marked_overdue: number;
  suspended: number;
  errors?: string[];
};

export type BillingPaymentResult = {
  payment: BillingPayment;
  invoice: BillingInvoice;
  customer?: BillingCustomer;
  lifecycle_action?: string;
  warning?: string;
};
