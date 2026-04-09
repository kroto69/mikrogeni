package db

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"sync/atomic"
	"time"
)

var mikroTikIDCounter uint64

type MikroTikDeviceRecord struct {
	ID            string
	Name          string
	Host          string
	Port          int
	Username      string
	Password      string
	UseTLS        bool
	SkipTLSVerify bool
	Site          string
	Tags          []string
	ROSVersion    string
	ROSMajor      int
	Status        string
	LastError     string
	LastSyncAt    string
	CreatedAt     string
	UpdatedAt     string
}

func createMikroTikTables() error {
	schema := `
	CREATE TABLE IF NOT EXISTS mikrotik_devices (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		host TEXT NOT NULL,
		port INTEGER NOT NULL DEFAULT 8728,
		username TEXT NOT NULL,
		password TEXT NOT NULL,
		use_tls INTEGER NOT NULL DEFAULT 0,
		skip_tls_verify INTEGER NOT NULL DEFAULT 0,
		site TEXT NOT NULL DEFAULT '',
		tags TEXT NOT NULL DEFAULT '[]',
		ros_version TEXT NOT NULL DEFAULT '',
		ros_major INTEGER NOT NULL DEFAULT 0,
		status TEXT NOT NULL DEFAULT 'unknown',
		last_error TEXT NOT NULL DEFAULT '',
		last_sync_at DATETIME,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_mikrotik_devices_host ON mikrotik_devices(host);
	CREATE INDEX IF NOT EXISTS idx_mikrotik_devices_status ON mikrotik_devices(status);
	CREATE INDEX IF NOT EXISTS idx_mikrotik_devices_ros_major ON mikrotik_devices(ros_major);
	`

	_, err := DB.Exec(schema)
	return err
}

func NewMikroTikDeviceID() string {
	stamp := time.Now().UTC().Format("060102150405")
	sequence := atomic.AddUint64(&mikroTikIDCounter, 1) % 10000
	return fmt.Sprintf("mtk-%s-%04d", stamp, sequence)
}

func CreateMikroTikDevice(device MikroTikDeviceRecord) (*MikroTikDeviceRecord, error) {
	mu.Lock()
	defer mu.Unlock()

	if strings.TrimSpace(device.ID) == "" {
		device.ID = NewMikroTikDeviceID()
	}
	if strings.TrimSpace(device.Status) == "" {
		device.Status = "unknown"
	}
	if device.Port == 0 {
		if device.UseTLS {
			device.Port = 8729
		} else {
			device.Port = 8728
		}
	}

	tagsRaw, err := json.Marshal(device.Tags)
	if err != nil {
		return nil, err
	}

	_, err = DB.Exec(
		`INSERT INTO mikrotik_devices (id, name, host, port, username, password, use_tls, skip_tls_verify, site, tags, ros_version, ros_major, status, last_error, last_sync_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		device.ID,
		strings.TrimSpace(device.Name),
		strings.TrimSpace(device.Host),
		device.Port,
		strings.TrimSpace(device.Username),
		device.Password,
		boolToInt(device.UseTLS),
		boolToInt(device.SkipTLSVerify),
		strings.TrimSpace(device.Site),
		string(tagsRaw),
		strings.TrimSpace(device.ROSVersion),
		device.ROSMajor,
		strings.TrimSpace(device.Status),
		strings.TrimSpace(device.LastError),
		nullableTimestamp(device.LastSyncAt),
	)
	if err != nil {
		return nil, err
	}

	return GetMikroTikDeviceByID(device.ID)
}

func GetMikroTikDeviceByID(id string) (*MikroTikDeviceRecord, error) {
	query := `SELECT id, name, host, port, username, password, use_tls, skip_tls_verify, site, tags, ros_version, ros_major, status, last_error,
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', last_sync_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', created_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', updated_at), '')
		FROM mikrotik_devices WHERE id = ?`

	row := DB.QueryRow(query, strings.TrimSpace(id))
	record, err := scanMikroTikDevice(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return record, nil
}

func ListMikroTikDevices(statusFilter, siteFilter string, rosMajorFilter int) ([]MikroTikDeviceRecord, error) {
	base := `SELECT id, name, host, port, username, password, use_tls, skip_tls_verify, site, tags, ros_version, ros_major, status, last_error,
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', last_sync_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', created_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', updated_at), '')
		FROM mikrotik_devices`

	where := make([]string, 0, 3)
	args := make([]interface{}, 0, 3)

	if strings.TrimSpace(statusFilter) != "" {
		where = append(where, "status = ?")
		args = append(args, strings.TrimSpace(statusFilter))
	}
	if strings.TrimSpace(siteFilter) != "" {
		where = append(where, "site = ?")
		args = append(args, strings.TrimSpace(siteFilter))
	}
	if rosMajorFilter > 0 {
		where = append(where, "ros_major = ?")
		args = append(args, rosMajorFilter)
	}

	query := base
	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	query += " ORDER BY created_at DESC"

	rows, err := DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	devices := make([]MikroTikDeviceRecord, 0)
	for rows.Next() {
		record, err := scanMikroTikDevice(rows)
		if err != nil {
			return nil, err
		}
		devices = append(devices, *record)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return devices, nil
}

func UpdateMikroTikDevice(device MikroTikDeviceRecord) (*MikroTikDeviceRecord, error) {
	mu.Lock()
	defer mu.Unlock()

	tagsRaw, err := json.Marshal(device.Tags)
	if err != nil {
		return nil, err
	}

	_, err = DB.Exec(
		`UPDATE mikrotik_devices
		 SET name = ?, host = ?, port = ?, username = ?, password = ?, use_tls = ?, skip_tls_verify = ?, site = ?, tags = ?,
			 ros_version = ?, ros_major = ?, status = ?, last_error = ?, last_sync_at = ?, updated_at = CURRENT_TIMESTAMP
		 WHERE id = ?`,
		strings.TrimSpace(device.Name),
		strings.TrimSpace(device.Host),
		device.Port,
		strings.TrimSpace(device.Username),
		device.Password,
		boolToInt(device.UseTLS),
		boolToInt(device.SkipTLSVerify),
		strings.TrimSpace(device.Site),
		string(tagsRaw),
		strings.TrimSpace(device.ROSVersion),
		device.ROSMajor,
		strings.TrimSpace(device.Status),
		strings.TrimSpace(device.LastError),
		nullableTimestamp(device.LastSyncAt),
		strings.TrimSpace(device.ID),
	)
	if err != nil {
		return nil, err
	}

	return GetMikroTikDeviceByID(device.ID)
}

func UpdateMikroTikDeviceSync(id, rosVersion string, rosMajor int, status, lastError string) error {
	mu.Lock()
	defer mu.Unlock()

	_, err := DB.Exec(
		`UPDATE mikrotik_devices
		 SET ros_version = ?, ros_major = ?, status = ?, last_error = ?, last_sync_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		 WHERE id = ?`,
		strings.TrimSpace(rosVersion),
		rosMajor,
		strings.TrimSpace(status),
		strings.TrimSpace(lastError),
		strings.TrimSpace(id),
	)

	return err
}

func DeleteMikroTikDevice(id string) error {
	mu.Lock()
	defer mu.Unlock()

	_, err := DB.Exec(`DELETE FROM mikrotik_devices WHERE id = ?`, strings.TrimSpace(id))
	return err
}

func scanMikroTikDevice(scanner interface {
	Scan(dest ...interface{}) error
}) (*MikroTikDeviceRecord, error) {
	var (
		record     MikroTikDeviceRecord
		tagsRaw    string
		useTLSInt  int
		skipTLSInt int
		rosVersion string
		rosMajor   int
		status     string
		lastError  string
		lastSyncAt string
		createdAt  string
		updatedAt  string
	)

	err := scanner.Scan(
		&record.ID,
		&record.Name,
		&record.Host,
		&record.Port,
		&record.Username,
		&record.Password,
		&useTLSInt,
		&skipTLSInt,
		&record.Site,
		&tagsRaw,
		&rosVersion,
		&rosMajor,
		&status,
		&lastError,
		&lastSyncAt,
		&createdAt,
		&updatedAt,
	)
	if err != nil {
		return nil, err
	}

	record.UseTLS = useTLSInt == 1
	record.SkipTLSVerify = skipTLSInt == 1
	record.ROSVersion = rosVersion
	record.ROSMajor = rosMajor
	record.Status = status
	record.LastError = lastError
	record.LastSyncAt = lastSyncAt
	record.CreatedAt = createdAt
	record.UpdatedAt = updatedAt
	record.Tags = make([]string, 0)
	if strings.TrimSpace(tagsRaw) != "" {
		_ = json.Unmarshal([]byte(tagsRaw), &record.Tags)
	}

	return &record, nil
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func nullableTimestamp(value string) interface{} {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return trimmed
}
