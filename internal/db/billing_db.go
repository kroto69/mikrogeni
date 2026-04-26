package db

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

var (
	ErrBillingInvoiceNotFound    = errors.New("billing invoice not found")
	ErrBillingInvoiceAlreadyPaid = errors.New("billing invoice already paid")
	ErrBillingPaymentOverpaid    = errors.New("billing payment exceeds invoice amount")
)

type BillingServicePlanRecord struct {
	ID               int
	Code             string
	Name             string
	Price            int
	BillingCycleDays int
	MikroTikProfile  string
	IsActive         bool
	CreatedAt        string
	UpdatedAt        string
}

type BillingCustomerRecord struct {
	ID               int
	CustomerCode     string
	FullName         string
	Phone            string
	Address          string
	MikroTikDeviceID string
	PPPSecretName    string
	ServicePlanID    int
	Status           string
	NextBillingAt    string
	LastSuspendedAt  string
	CreatedAt        string
	UpdatedAt        string
	ServicePlanCode  string
	ServicePlanName  string
	ServicePlanPrice int
}

type BillingInvoiceRecord struct {
	ID              int
	InvoiceNumber   string
	CustomerID      int
	ServicePlanID   int
	PeriodStart     string
	PeriodEnd       string
	DueDate         string
	Amount          int
	PaidAmount      int
	Status          string
	GeneratedAt     string
	PaidAt          string
	CreatedAt       string
	UpdatedAt       string
	CustomerCode    string
	CustomerName    string
	ServicePlanCode string
	ServicePlanName string
}

type BillingPaymentRecord struct {
	ID          int
	InvoiceID   int
	Amount      int
	Method      string
	ReferenceNo string
	PaidAt      string
	Note        string
	CreatedAt   string
}

func createBillingTables() error {
	schema := `
	CREATE TABLE IF NOT EXISTS service_plans (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		code TEXT UNIQUE NOT NULL,
		name TEXT NOT NULL,
		price INTEGER NOT NULL,
		billing_cycle_days INTEGER NOT NULL DEFAULT 30,
		mikrotik_profile TEXT NOT NULL DEFAULT '',
		is_active INTEGER NOT NULL DEFAULT 1,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS billing_customers (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		customer_code TEXT UNIQUE NOT NULL,
		full_name TEXT NOT NULL,
		phone TEXT NOT NULL DEFAULT '',
		address TEXT NOT NULL DEFAULT '',
		mikrotik_device_id TEXT NOT NULL,
		ppp_secret_name TEXT NOT NULL,
		service_plan_id INTEGER NOT NULL,
		status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','overdue','suspended')),
		next_billing_at DATETIME,
		last_suspended_at DATETIME,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (service_plan_id) REFERENCES service_plans(id)
	);

	CREATE TABLE IF NOT EXISTS invoices (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		invoice_number TEXT UNIQUE NOT NULL,
		customer_id INTEGER NOT NULL,
		service_plan_id INTEGER NOT NULL,
		period_start DATE NOT NULL,
		period_end DATE NOT NULL,
		due_date DATE NOT NULL,
		amount INTEGER NOT NULL,
		paid_amount INTEGER NOT NULL DEFAULT 0,
		status TEXT NOT NULL DEFAULT 'unpaid' CHECK(status IN ('unpaid','partial','overdue','paid')),
		generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		paid_at DATETIME,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (customer_id) REFERENCES billing_customers(id),
		FOREIGN KEY (service_plan_id) REFERENCES service_plans(id),
		UNIQUE (customer_id, period_start, period_end)
	);

	CREATE TABLE IF NOT EXISTS payments (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		invoice_id INTEGER NOT NULL,
		amount INTEGER NOT NULL,
		method TEXT NOT NULL DEFAULT 'cash',
		reference_no TEXT NOT NULL DEFAULT '',
		paid_at DATETIME NOT NULL,
		note TEXT NOT NULL DEFAULT '',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (invoice_id) REFERENCES invoices(id)
	);

	CREATE INDEX IF NOT EXISTS idx_service_plans_active ON service_plans(is_active);
	CREATE INDEX IF NOT EXISTS idx_billing_customers_status ON billing_customers(status);
	CREATE INDEX IF NOT EXISTS idx_billing_customers_next ON billing_customers(next_billing_at);
	CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
	CREATE INDEX IF NOT EXISTS idx_invoices_status_due ON invoices(status, due_date);
	CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
	`

	_, err := DB.Exec(schema)
	return err
}

func CreateBillingServicePlan(record BillingServicePlanRecord) (*BillingServicePlanRecord, error) {
	mu.Lock()
	defer mu.Unlock()

	record.Code = strings.TrimSpace(record.Code)
	record.Name = strings.TrimSpace(record.Name)
	record.MikroTikProfile = strings.TrimSpace(record.MikroTikProfile)
	if record.BillingCycleDays <= 0 {
		record.BillingCycleDays = 30
	}

	_, err := DB.Exec(
		`INSERT INTO service_plans (code, name, price, billing_cycle_days, mikrotik_profile, is_active)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		record.Code,
		record.Name,
		record.Price,
		record.BillingCycleDays,
		record.MikroTikProfile,
		boolToInt(record.IsActive),
	)
	if err != nil {
		return nil, err
	}

	row := DB.QueryRow("SELECT id FROM service_plans WHERE code = ?", record.Code)
	if err := row.Scan(&record.ID); err != nil {
		return nil, err
	}

	return GetBillingServicePlanByID(record.ID)
}

func GetBillingServicePlanByID(id int) (*BillingServicePlanRecord, error) {
	query := `SELECT id, code, name, price, billing_cycle_days, mikrotik_profile, is_active,
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', created_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', updated_at), '')
		FROM service_plans WHERE id = ?`

	row := DB.QueryRow(query, id)
	return scanBillingServicePlan(row)
}

func ListBillingServicePlans(activeOnly bool) ([]BillingServicePlanRecord, error) {
	query := `SELECT id, code, name, price, billing_cycle_days, mikrotik_profile, is_active,
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', created_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', updated_at), '')
		FROM service_plans`
	args := make([]interface{}, 0, 1)
	if activeOnly {
		query += " WHERE is_active = 1"
	}
	query += " ORDER BY created_at DESC"

	rows, err := DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]BillingServicePlanRecord, 0)
	for rows.Next() {
		record, scanErr := scanBillingServicePlan(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		result = append(result, *record)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return result, nil
}

func CreateBillingCustomer(record BillingCustomerRecord) (*BillingCustomerRecord, error) {
	mu.Lock()
	defer mu.Unlock()

	record.CustomerCode = strings.TrimSpace(record.CustomerCode)
	record.FullName = strings.TrimSpace(record.FullName)
	record.Phone = strings.TrimSpace(record.Phone)
	record.Address = strings.TrimSpace(record.Address)
	record.MikroTikDeviceID = strings.TrimSpace(record.MikroTikDeviceID)
	record.PPPSecretName = strings.TrimSpace(record.PPPSecretName)
	record.Status = strings.TrimSpace(record.Status)
	if record.Status == "" {
		record.Status = "active"
	}

	_, err := DB.Exec(
		`INSERT INTO billing_customers (customer_code, full_name, phone, address, mikrotik_device_id, ppp_secret_name, service_plan_id, status, next_billing_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		record.CustomerCode,
		record.FullName,
		record.Phone,
		record.Address,
		record.MikroTikDeviceID,
		record.PPPSecretName,
		record.ServicePlanID,
		record.Status,
		nullableTimestamp(record.NextBillingAt),
	)
	if err != nil {
		return nil, err
	}

	row := DB.QueryRow("SELECT id FROM billing_customers WHERE customer_code = ?", record.CustomerCode)
	if err := row.Scan(&record.ID); err != nil {
		return nil, err
	}

	return GetBillingCustomerByID(record.ID)
}

func GetBillingCustomerByID(id int) (*BillingCustomerRecord, error) {
	query := `SELECT c.id, c.customer_code, c.full_name, c.phone, c.address, c.mikrotik_device_id, c.ppp_secret_name,
		c.service_plan_id, c.status,
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', c.next_billing_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', c.last_suspended_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', c.created_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', c.updated_at), ''),
		COALESCE(p.code, ''), COALESCE(p.name, ''), COALESCE(p.price, 0)
		FROM billing_customers c
		LEFT JOIN service_plans p ON p.id = c.service_plan_id
		WHERE c.id = ?`

	row := DB.QueryRow(query, id)
	record, err := scanBillingCustomer(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return record, nil
}

func ListBillingCustomers(statusFilter string) ([]BillingCustomerRecord, error) {
	query := `SELECT c.id, c.customer_code, c.full_name, c.phone, c.address, c.mikrotik_device_id, c.ppp_secret_name,
		c.service_plan_id, c.status,
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', c.next_billing_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', c.last_suspended_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', c.created_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', c.updated_at), ''),
		COALESCE(p.code, ''), COALESCE(p.name, ''), COALESCE(p.price, 0)
		FROM billing_customers c
		LEFT JOIN service_plans p ON p.id = c.service_plan_id`
	args := make([]interface{}, 0, 1)
	if strings.TrimSpace(statusFilter) != "" {
		query += " WHERE c.status = ?"
		args = append(args, strings.TrimSpace(statusFilter))
	}
	query += " ORDER BY c.created_at DESC"

	rows, err := DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]BillingCustomerRecord, 0)
	for rows.Next() {
		record, scanErr := scanBillingCustomer(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		result = append(result, *record)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return result, nil
}

func UpdateBillingCustomerStatus(customerID int, status string, lastSuspendedAt string) error {
	mu.Lock()
	defer mu.Unlock()

	_, err := DB.Exec(
		`UPDATE billing_customers
		 SET status = ?, last_suspended_at = ?, updated_at = CURRENT_TIMESTAMP
		 WHERE id = ?`,
		strings.TrimSpace(status),
		nullableTimestamp(lastSuspendedAt),
		customerID,
	)

	return err
}

func UpdateBillingCustomerNextBillingAt(customerID int, nextBillingAt string) error {
	mu.Lock()
	defer mu.Unlock()

	_, err := DB.Exec(
		`UPDATE billing_customers
		 SET next_billing_at = ?, updated_at = CURRENT_TIMESTAMP
		 WHERE id = ?`,
		nullableTimestamp(nextBillingAt),
		customerID,
	)

	return err
}

func ListDueBillingCustomers(referenceTime string) ([]BillingCustomerRecord, error) {
	query := `SELECT c.id, c.customer_code, c.full_name, c.phone, c.address, c.mikrotik_device_id, c.ppp_secret_name,
		c.service_plan_id, c.status,
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', c.next_billing_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', c.last_suspended_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', c.created_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', c.updated_at), ''),
		COALESCE(p.code, ''), COALESCE(p.name, ''), COALESCE(p.price, 0)
		FROM billing_customers c
		LEFT JOIN service_plans p ON p.id = c.service_plan_id
		WHERE c.status = 'active' AND c.next_billing_at IS NOT NULL AND datetime(c.next_billing_at) <= datetime(?)
		ORDER BY c.next_billing_at ASC`

	rows, err := DB.Query(query, strings.TrimSpace(referenceTime))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]BillingCustomerRecord, 0)
	for rows.Next() {
		record, scanErr := scanBillingCustomer(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		result = append(result, *record)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return result, nil
}

func CreateBillingInvoice(record BillingInvoiceRecord) (*BillingInvoiceRecord, error) {
	mu.Lock()
	defer mu.Unlock()

	record.InvoiceNumber = strings.TrimSpace(record.InvoiceNumber)
	record.Status = strings.TrimSpace(record.Status)
	if record.Status == "" {
		record.Status = "unpaid"
	}

	_, err := DB.Exec(
		`INSERT INTO invoices (invoice_number, customer_id, service_plan_id, period_start, period_end, due_date, amount, paid_amount, status, generated_at, paid_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		record.InvoiceNumber,
		record.CustomerID,
		record.ServicePlanID,
		record.PeriodStart,
		record.PeriodEnd,
		record.DueDate,
		record.Amount,
		record.PaidAmount,
		record.Status,
		nullableTimestamp(record.GeneratedAt),
		nullableTimestamp(record.PaidAt),
	)
	if err != nil {
		return nil, err
	}

	row := DB.QueryRow("SELECT id FROM invoices WHERE invoice_number = ?", record.InvoiceNumber)
	if err := row.Scan(&record.ID); err != nil {
		return nil, err
	}

	return GetBillingInvoiceByID(record.ID)
}

func GetOpenBillingInvoiceByPeriod(customerID int, periodStart, periodEnd string) (*BillingInvoiceRecord, error) {
	query := `SELECT i.id, i.invoice_number, i.customer_id, i.service_plan_id, i.period_start, i.period_end, i.due_date,
		i.amount, i.paid_amount, i.status,
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', i.generated_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', i.paid_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', i.created_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', i.updated_at), ''),
		COALESCE(c.customer_code, ''), COALESCE(c.full_name, ''), COALESCE(p.code, ''), COALESCE(p.name, '')
		FROM invoices i
		LEFT JOIN billing_customers c ON c.id = i.customer_id
		LEFT JOIN service_plans p ON p.id = i.service_plan_id
		WHERE i.customer_id = ? AND i.period_start = ? AND i.period_end = ?`

	row := DB.QueryRow(query, customerID, strings.TrimSpace(periodStart), strings.TrimSpace(periodEnd))
	record, err := scanBillingInvoice(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return record, nil
}

func GetBillingInvoiceByID(id int) (*BillingInvoiceRecord, error) {
	query := `SELECT i.id, i.invoice_number, i.customer_id, i.service_plan_id, i.period_start, i.period_end, i.due_date,
		i.amount, i.paid_amount, i.status,
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', i.generated_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', i.paid_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', i.created_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', i.updated_at), ''),
		COALESCE(c.customer_code, ''), COALESCE(c.full_name, ''), COALESCE(p.code, ''), COALESCE(p.name, '')
		FROM invoices i
		LEFT JOIN billing_customers c ON c.id = i.customer_id
		LEFT JOIN service_plans p ON p.id = i.service_plan_id
		WHERE i.id = ?`

	row := DB.QueryRow(query, id)
	record, err := scanBillingInvoice(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return record, nil
}

func ListBillingInvoices(statusFilter string, customerID int) ([]BillingInvoiceRecord, error) {
	query := `SELECT i.id, i.invoice_number, i.customer_id, i.service_plan_id, i.period_start, i.period_end, i.due_date,
		i.amount, i.paid_amount, i.status,
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', i.generated_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', i.paid_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', i.created_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', i.updated_at), ''),
		COALESCE(c.customer_code, ''), COALESCE(c.full_name, ''), COALESCE(p.code, ''), COALESCE(p.name, '')
		FROM invoices i
		LEFT JOIN billing_customers c ON c.id = i.customer_id
		LEFT JOIN service_plans p ON p.id = i.service_plan_id`

	where := make([]string, 0, 2)
	args := make([]interface{}, 0, 2)
	if strings.TrimSpace(statusFilter) != "" {
		where = append(where, "i.status = ?")
		args = append(args, strings.TrimSpace(statusFilter))
	}
	if customerID > 0 {
		where = append(where, "i.customer_id = ?")
		args = append(args, customerID)
	}
	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	query += " ORDER BY i.created_at DESC"

	rows, err := DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]BillingInvoiceRecord, 0)
	for rows.Next() {
		record, scanErr := scanBillingInvoice(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		result = append(result, *record)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return result, nil
}

func ListOverdueBillingInvoices(referenceDate string) ([]BillingInvoiceRecord, error) {
	query := `SELECT i.id, i.invoice_number, i.customer_id, i.service_plan_id, i.period_start, i.period_end, i.due_date,
		i.amount, i.paid_amount, i.status,
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', i.generated_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', i.paid_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', i.created_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', i.updated_at), ''),
		COALESCE(c.customer_code, ''), COALESCE(c.full_name, ''), COALESCE(p.code, ''), COALESCE(p.name, '')
		FROM invoices i
		LEFT JOIN billing_customers c ON c.id = i.customer_id
		LEFT JOIN service_plans p ON p.id = i.service_plan_id
		WHERE i.status IN ('unpaid', 'partial') AND date(i.due_date) < date(?)
		ORDER BY i.due_date ASC`

	rows, err := DB.Query(query, strings.TrimSpace(referenceDate))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]BillingInvoiceRecord, 0)
	for rows.Next() {
		record, scanErr := scanBillingInvoice(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		result = append(result, *record)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return result, nil
}

func ListInvoicesToMarkOverdue(referenceDate string) ([]BillingInvoiceRecord, error) {
	query := `SELECT i.id, i.invoice_number, i.customer_id, i.service_plan_id, i.period_start, i.period_end, i.due_date,
		i.amount, i.paid_amount, i.status,
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', i.generated_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', i.paid_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', i.created_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', i.updated_at), ''),
		COALESCE(c.customer_code, ''), COALESCE(c.full_name, ''), COALESCE(p.code, ''), COALESCE(p.name, '')
		FROM invoices i
		LEFT JOIN billing_customers c ON c.id = i.customer_id
		LEFT JOIN service_plans p ON p.id = i.service_plan_id
		WHERE i.status IN ('unpaid', 'partial') AND date(i.due_date) < date(?)
		ORDER BY i.due_date ASC`

	rows, err := DB.Query(query, strings.TrimSpace(referenceDate))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]BillingInvoiceRecord, 0)
	for rows.Next() {
		record, scanErr := scanBillingInvoice(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		result = append(result, *record)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return result, nil
}

func ListCustomersPendingOverdueSuspension(referenceDate string) ([]BillingCustomerRecord, error) {
	query := `SELECT c.id, c.customer_code, c.full_name, c.phone, c.address, c.mikrotik_device_id, c.ppp_secret_name,
		c.service_plan_id, c.status,
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', c.next_billing_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', c.last_suspended_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', c.created_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', c.updated_at), ''),
		COALESCE(p.code, ''), COALESCE(p.name, ''), COALESCE(p.price, 0)
		FROM billing_customers c
		LEFT JOIN service_plans p ON p.id = c.service_plan_id
		WHERE c.status IN ('active', 'overdue')
		  AND EXISTS (
			SELECT 1 FROM invoices i
			WHERE i.customer_id = c.id
			  AND i.status = 'overdue'
			  AND date(i.due_date) < date(?)
		  )
		ORDER BY c.id ASC`

	rows, err := DB.Query(query, strings.TrimSpace(referenceDate))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]BillingCustomerRecord, 0)
	for rows.Next() {
		record, scanErr := scanBillingCustomer(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		result = append(result, *record)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return result, nil
}

func UpdateBillingInvoicePayment(invoiceID int, paidAmount int, status string, paidAt string) error {
	mu.Lock()
	defer mu.Unlock()

	_, err := DB.Exec(
		`UPDATE invoices
		 SET paid_amount = ?, status = ?, paid_at = ?, updated_at = CURRENT_TIMESTAMP
		 WHERE id = ?`,
		paidAmount,
		strings.TrimSpace(status),
		nullableTimestamp(paidAt),
		invoiceID,
	)

	return err
}

func UpdateBillingInvoiceStatus(invoiceID int, status string) error {
	mu.Lock()
	defer mu.Unlock()

	_, err := DB.Exec(
		`UPDATE invoices SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		strings.TrimSpace(status),
		invoiceID,
	)

	return err
}

func CreateBillingPayment(record BillingPaymentRecord) (*BillingPaymentRecord, error) {
	mu.Lock()
	defer mu.Unlock()

	record.Method = strings.TrimSpace(record.Method)
	record.ReferenceNo = strings.TrimSpace(record.ReferenceNo)
	record.Note = strings.TrimSpace(record.Note)
	if record.Method == "" {
		record.Method = "cash"
	}

	_, err := DB.Exec(
		`INSERT INTO payments (invoice_id, amount, method, reference_no, paid_at, note)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		record.InvoiceID,
		record.Amount,
		record.Method,
		record.ReferenceNo,
		record.PaidAt,
		record.Note,
	)
	if err != nil {
		return nil, err
	}

	row := DB.QueryRow("SELECT id FROM payments WHERE invoice_id = ? ORDER BY id DESC LIMIT 1", record.InvoiceID)
	if err := row.Scan(&record.ID); err != nil {
		return nil, err
	}

	return GetBillingPaymentByID(record.ID)
}

func CreateBillingPaymentAtomic(invoiceID int, amount int, method string, referenceNo string, paidAt string, note string) (*BillingPaymentRecord, *BillingInvoiceRecord, error) {
	mu.Lock()
	defer mu.Unlock()

	tx, err := DB.Begin()
	if err != nil {
		return nil, nil, err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	var invoiceAmount int
	var invoiceStatus string
	err = tx.QueryRow(`SELECT amount, status FROM invoices WHERE id = ?`, invoiceID).Scan(&invoiceAmount, &invoiceStatus)
	if err == sql.ErrNoRows {
		return nil, nil, ErrBillingInvoiceNotFound
	}
	if err != nil {
		return nil, nil, err
	}
	if strings.TrimSpace(invoiceStatus) == "paid" {
		return nil, nil, ErrBillingInvoiceAlreadyPaid
	}

	var totalBefore int
	err = tx.QueryRow(`SELECT COALESCE(SUM(amount), 0) FROM payments WHERE invoice_id = ?`, invoiceID).Scan(&totalBefore)
	if err != nil {
		return nil, nil, err
	}

	totalAfter := totalBefore + amount
	if totalAfter > invoiceAmount {
		return nil, nil, ErrBillingPaymentOverpaid
	}

	method = strings.TrimSpace(method)
	if method == "" {
		method = "cash"
	}
	referenceNo = strings.TrimSpace(referenceNo)
	note = strings.TrimSpace(note)

	insertResult, err := tx.Exec(
		`INSERT INTO payments (invoice_id, amount, method, reference_no, paid_at, note)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		invoiceID,
		amount,
		method,
		referenceNo,
		paidAt,
		note,
	)
	if err != nil {
		return nil, nil, err
	}

	paymentID64, err := insertResult.LastInsertId()
	if err != nil {
		return nil, nil, err
	}
	paymentID := int(paymentID64)

	invoiceNextStatus := "partial"
	invoicePaidAt := ""
	if totalAfter >= invoiceAmount {
		invoiceNextStatus = "paid"
		invoicePaidAt = strings.TrimSpace(paidAt)
	}

	_, err = tx.Exec(
		`UPDATE invoices
		 SET paid_amount = ?, status = ?, paid_at = ?, updated_at = CURRENT_TIMESTAMP
		 WHERE id = ?`,
		totalAfter,
		invoiceNextStatus,
		nullableTimestamp(invoicePaidAt),
		invoiceID,
	)
	if err != nil {
		return nil, nil, err
	}

	paymentQuery := `SELECT id, invoice_id, amount, method, reference_no,
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', paid_at), ''),
		note,
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', created_at), '')
		FROM payments WHERE id = ?`
	payment, err := scanBillingPayment(tx.QueryRow(paymentQuery, paymentID))
	if err != nil {
		return nil, nil, err
	}

	invoiceQuery := `SELECT i.id, i.invoice_number, i.customer_id, i.service_plan_id, i.period_start, i.period_end, i.due_date,
		i.amount, i.paid_amount, i.status,
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', i.generated_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', i.paid_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', i.created_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', i.updated_at), ''),
		COALESCE(c.customer_code, ''), COALESCE(c.full_name, ''), COALESCE(p.code, ''), COALESCE(p.name, '')
		FROM invoices i
		LEFT JOIN billing_customers c ON c.id = i.customer_id
		LEFT JOIN service_plans p ON p.id = i.service_plan_id
		WHERE i.id = ?`
	invoice, err := scanBillingInvoice(tx.QueryRow(invoiceQuery, invoiceID))
	if err != nil {
		return nil, nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, nil, err
	}
	committed = true

	return payment, invoice, nil
}

func GetBillingPaymentByID(id int) (*BillingPaymentRecord, error) {
	query := `SELECT id, invoice_id, amount, method, reference_no,
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', paid_at), ''),
		note,
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', created_at), '')
		FROM payments WHERE id = ?`

	row := DB.QueryRow(query, id)
	record, err := scanBillingPayment(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return record, nil
}

func ListBillingPayments(invoiceID int) ([]BillingPaymentRecord, error) {
	query := `SELECT id, invoice_id, amount, method, reference_no,
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', paid_at), ''),
		note,
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', created_at), '')
		FROM payments`
	args := make([]interface{}, 0, 1)
	if invoiceID > 0 {
		query += " WHERE invoice_id = ?"
		args = append(args, invoiceID)
	}
	query += " ORDER BY paid_at DESC, id DESC"

	rows, err := DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]BillingPaymentRecord, 0)
	for rows.Next() {
		record, scanErr := scanBillingPayment(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		result = append(result, *record)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return result, nil
}

func GetBillingInvoicePaidTotal(invoiceID int) (int, error) {
	var total int
	if err := DB.QueryRow("SELECT COALESCE(SUM(amount), 0) FROM payments WHERE invoice_id = ?", invoiceID).Scan(&total); err != nil {
		return 0, err
	}

	return total, nil
}

func HasCustomerOutstandingOverdueInvoices(customerID int, referenceDate string) (bool, error) {
	var count int
	err := DB.QueryRow(
		`SELECT COUNT(*)
		 FROM invoices
		 WHERE customer_id = ?
		   AND status IN ('unpaid', 'partial', 'overdue')
		   AND date(due_date) < date(?)`,
		customerID,
		strings.TrimSpace(referenceDate),
	).Scan(&count)
	if err != nil {
		return false, err
	}

	return count > 0, nil
}

func scanBillingServicePlan(scanner interface {
	Scan(dest ...interface{}) error
}) (*BillingServicePlanRecord, error) {
	var record BillingServicePlanRecord
	var isActiveInt int
	err := scanner.Scan(
		&record.ID,
		&record.Code,
		&record.Name,
		&record.Price,
		&record.BillingCycleDays,
		&record.MikroTikProfile,
		&isActiveInt,
		&record.CreatedAt,
		&record.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	record.IsActive = isActiveInt == 1

	return &record, nil
}

func scanBillingCustomer(scanner interface {
	Scan(dest ...interface{}) error
}) (*BillingCustomerRecord, error) {
	var record BillingCustomerRecord
	err := scanner.Scan(
		&record.ID,
		&record.CustomerCode,
		&record.FullName,
		&record.Phone,
		&record.Address,
		&record.MikroTikDeviceID,
		&record.PPPSecretName,
		&record.ServicePlanID,
		&record.Status,
		&record.NextBillingAt,
		&record.LastSuspendedAt,
		&record.CreatedAt,
		&record.UpdatedAt,
		&record.ServicePlanCode,
		&record.ServicePlanName,
		&record.ServicePlanPrice,
	)
	if err != nil {
		return nil, err
	}

	return &record, nil
}

func scanBillingInvoice(scanner interface {
	Scan(dest ...interface{}) error
}) (*BillingInvoiceRecord, error) {
	var record BillingInvoiceRecord
	err := scanner.Scan(
		&record.ID,
		&record.InvoiceNumber,
		&record.CustomerID,
		&record.ServicePlanID,
		&record.PeriodStart,
		&record.PeriodEnd,
		&record.DueDate,
		&record.Amount,
		&record.PaidAmount,
		&record.Status,
		&record.GeneratedAt,
		&record.PaidAt,
		&record.CreatedAt,
		&record.UpdatedAt,
		&record.CustomerCode,
		&record.CustomerName,
		&record.ServicePlanCode,
		&record.ServicePlanName,
	)
	if err != nil {
		return nil, err
	}

	return &record, nil
}

func scanBillingPayment(scanner interface {
	Scan(dest ...interface{}) error
}) (*BillingPaymentRecord, error) {
	var record BillingPaymentRecord
	err := scanner.Scan(
		&record.ID,
		&record.InvoiceID,
		&record.Amount,
		&record.Method,
		&record.ReferenceNo,
		&record.PaidAt,
		&record.Note,
		&record.CreatedAt,
	)
	if err != nil {
		return nil, err
	}

	return &record, nil
}

func ensureBillingServicePlanExists(id int) error {
	plan, err := GetBillingServicePlanByID(id)
	if err != nil {
		return err
	}
	if plan == nil {
		return fmt.Errorf("service plan not found")
	}

	return nil
}
