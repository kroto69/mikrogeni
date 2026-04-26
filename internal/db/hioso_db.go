package db

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"sync/atomic"
	"time"
)

type legacyHiosoOLTProfile struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Host          string `json:"host"`
	Port          string `json:"port"`
	WebHost       string `json:"web_host"`
	WebPort       string `json:"web_port"`
	SNMPVersion   string `json:"snmp_version"`
	SNMPCommunity string `json:"snmp_community"`
	Username      string `json:"username"`
	Password      string `json:"password"`
}

var hiosoOLTIDCounter uint64

type HiosoOLTDeviceRecord struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Host          string `json:"host"`
	Port          int    `json:"port"`
	SNMPVersion   string `json:"snmp_version"`
	SNMPCommunity string `json:"snmp_community"`
	WebHost       string `json:"web_host"`
	WebPort       int    `json:"web_port"`
	Username      string `json:"username"`
	Password      string `json:"password"`
	Profile       string `json:"profile"`
	Status        string `json:"status"`
	LastError     string `json:"last_error"`
	LastHealthAt  string `json:"last_health_at"`
	CreatedAt     string `json:"created_at"`
	UpdatedAt     string `json:"updated_at"`
}

func createHiosoOLTDeviceTables() error {
	schema := `
	CREATE TABLE IF NOT EXISTS hioso_olt_devices (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		host TEXT NOT NULL,
		port INTEGER NOT NULL DEFAULT 161,
		snmp_version TEXT NOT NULL DEFAULT '2c',
		snmp_community TEXT NOT NULL DEFAULT 'public',
		web_host TEXT NOT NULL DEFAULT '',
		web_port INTEGER NOT NULL DEFAULT 80,
		username TEXT NOT NULL DEFAULT '',
		password TEXT NOT NULL DEFAULT '',
		profile TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL DEFAULT 'unknown',
		last_error TEXT NOT NULL DEFAULT '',
		last_health_at DATETIME,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_hioso_olt_devices_host ON hioso_olt_devices(host);
	CREATE INDEX IF NOT EXISTS idx_hioso_olt_devices_status ON hioso_olt_devices(status);
	`

	_, err := DB.Exec(schema)
	return err
}

func NewHiosoOLTDeviceID() string {
	stamp := time.Now().UTC().Format("060102150405")
	sequence := atomic.AddUint64(&hiosoOLTIDCounter, 1) % 10000
	return fmt.Sprintf("hso-%s-%04d", stamp, sequence)
}

func CreateHiosoOLTDevice(device HiosoOLTDeviceRecord) (*HiosoOLTDeviceRecord, error) {
	mu.Lock()
	defer mu.Unlock()

	if strings.TrimSpace(device.ID) == "" {
		device.ID = NewHiosoOLTDeviceID()
	}
	if strings.TrimSpace(device.Status) == "" {
		device.Status = "unknown"
	}
	if device.Port == 0 {
		device.Port = 161
	}
	if strings.TrimSpace(device.SNMPVersion) == "" {
		device.SNMPVersion = "2c"
	}
	if strings.TrimSpace(device.SNMPCommunity) == "" {
		device.SNMPCommunity = "public"
	}
	if strings.TrimSpace(device.WebHost) == "" {
		device.WebHost = strings.TrimSpace(device.Host)
	}
	if device.WebPort == 0 {
		device.WebPort = 80
	}

	_, err := DB.Exec(
		`INSERT INTO hioso_olt_devices (id, name, host, port, snmp_version, snmp_community, web_host, web_port, username, password, profile, status, last_error, last_health_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		device.ID,
		strings.TrimSpace(device.Name),
		strings.TrimSpace(device.Host),
		device.Port,
		strings.TrimSpace(device.SNMPVersion),
		strings.TrimSpace(device.SNMPCommunity),
		strings.TrimSpace(device.WebHost),
		device.WebPort,
		strings.TrimSpace(device.Username),
		device.Password,
		strings.TrimSpace(device.Profile),
		strings.TrimSpace(device.Status),
		strings.TrimSpace(device.LastError),
		nullableTimestamp(device.LastHealthAt),
	)
	if err != nil {
		return nil, err
	}

	return GetHiosoOLTDeviceByID(device.ID)
}

func GetHiosoOLTDeviceByID(id string) (*HiosoOLTDeviceRecord, error) {
	query := `SELECT id, name, host, port, snmp_version, snmp_community, web_host, web_port, username, password, profile, status, last_error,
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', last_health_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', created_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', updated_at), '')
		FROM hioso_olt_devices WHERE id = ?`

	row := DB.QueryRow(query, strings.TrimSpace(id))
	record, err := scanHiosoOLTDevice(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return record, nil
}

func ListHiosoOLTDevices() ([]HiosoOLTDeviceRecord, error) {
	query := `SELECT id, name, host, port, snmp_version, snmp_community, web_host, web_port, username, password, profile, status, last_error,
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', last_health_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', created_at), ''),
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', updated_at), '')
		FROM hioso_olt_devices ORDER BY created_at DESC`

	rows, err := DB.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	devices := make([]HiosoOLTDeviceRecord, 0)
	for rows.Next() {
		record, err := scanHiosoOLTDevice(rows)
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

func UpdateHiosoOLTDevice(device HiosoOLTDeviceRecord) (*HiosoOLTDeviceRecord, error) {
	mu.Lock()
	defer mu.Unlock()

	_, err := DB.Exec(
		`UPDATE hioso_olt_devices
		 SET name = ?, host = ?, port = ?, snmp_version = ?, snmp_community = ?, web_host = ?, web_port = ?, username = ?, password = ?, profile = ?, status = ?, last_error = ?, last_health_at = ?, updated_at = CURRENT_TIMESTAMP
		 WHERE id = ?`,
		strings.TrimSpace(device.Name),
		strings.TrimSpace(device.Host),
		device.Port,
		strings.TrimSpace(device.SNMPVersion),
		strings.TrimSpace(device.SNMPCommunity),
		strings.TrimSpace(device.WebHost),
		device.WebPort,
		strings.TrimSpace(device.Username),
		device.Password,
		strings.TrimSpace(device.Profile),
		strings.TrimSpace(device.Status),
		strings.TrimSpace(device.LastError),
		nullableTimestamp(device.LastHealthAt),
		strings.TrimSpace(device.ID),
	)
	if err != nil {
		return nil, err
	}

	return GetHiosoOLTDeviceByID(device.ID)
}

func UpdateHiosoOLTDeviceHealth(id, profile, status, lastError string) error {
	mu.Lock()
	defer mu.Unlock()

	_, err := DB.Exec(
		`UPDATE hioso_olt_devices
		 SET profile = ?, status = ?, last_error = ?, last_health_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		 WHERE id = ?`,
		strings.TrimSpace(profile),
		strings.TrimSpace(status),
		strings.TrimSpace(lastError),
		strings.TrimSpace(id),
	)

	return err
}

func DeleteHiosoOLTDevice(id string) error {
	mu.Lock()
	defer mu.Unlock()

	_, err := DB.Exec(`DELETE FROM hioso_olt_devices WHERE id = ?`, strings.TrimSpace(id))
	return err
}

func MigrateHiosoProfilesToDevices(profiles []HiosoOLTDeviceRecord) error {
	mu.Lock()
	defer mu.Unlock()

	for _, p := range profiles {
		if strings.TrimSpace(p.ID) == "" {
			p.ID = NewHiosoOLTDeviceID()
		}
		if p.Port == 0 {
			p.Port = 161
		}
		if strings.TrimSpace(p.SNMPVersion) == "" {
			p.SNMPVersion = "2c"
		}
		if strings.TrimSpace(p.SNMPCommunity) == "" {
			p.SNMPCommunity = "public"
		}
		if strings.TrimSpace(p.WebHost) == "" {
			p.WebHost = strings.TrimSpace(p.Host)
		}
		if p.WebPort == 0 {
			p.WebPort = 80
		}

		var count int
		err := DB.QueryRow(`SELECT COUNT(*) FROM hioso_olt_devices WHERE host = ?`, strings.TrimSpace(p.Host)).Scan(&count)
		if err != nil {
			return err
		}
		if count > 0 {
			continue
		}

		_, err = DB.Exec(
			`INSERT OR IGNORE INTO hioso_olt_devices (id, name, host, port, snmp_version, snmp_community, web_host, web_port, username, password, profile, status, last_error)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			p.ID, strings.TrimSpace(p.Name), strings.TrimSpace(p.Host), p.Port,
			strings.TrimSpace(p.SNMPVersion), strings.TrimSpace(p.SNMPCommunity),
			strings.TrimSpace(p.WebHost), p.WebPort,
			strings.TrimSpace(p.Username), p.Password,
			strings.TrimSpace(p.Profile), strings.TrimSpace(p.Status), strings.TrimSpace(p.LastError),
		)
		if err != nil {
			return err
		}
	}
	return nil
}

func scanHiosoOLTDevice(scanner interface {
	Scan(dest ...interface{}) error
}) (*HiosoOLTDeviceRecord, error) {
	var (
		record       HiosoOLTDeviceRecord
		port         int
		snmpVersion  string
		snmpCommunity string
		webHost      string
		webPort      int
		profile      string
		status       string
		lastError    string
		lastHealthAt string
		createdAt    string
		updatedAt    string
	)

	err := scanner.Scan(
		&record.ID,
		&record.Name,
		&record.Host,
		&port,
		&snmpVersion,
		&snmpCommunity,
		&webHost,
		&webPort,
		&record.Username,
		&record.Password,
		&profile,
		&status,
		&lastError,
		&lastHealthAt,
		&createdAt,
		&updatedAt,
	)
	if err != nil {
		return nil, err
	}

	record.Port = port
	record.SNMPVersion = snmpVersion
	record.SNMPCommunity = snmpCommunity
	record.WebHost = webHost
	record.WebPort = webPort
	record.Profile = profile
	record.Status = status
	record.LastError = lastError
	record.LastHealthAt = lastHealthAt
	record.CreatedAt = createdAt
	record.UpdatedAt = updatedAt

	return &record, nil
}

var _ = json.Marshal

func init() {
	hiosoOLTIDCounter = 0
}

func MigrateHiosoProfilesIfNeeded() {
	migrated, err := GetSetting("hioso_profiles_migrated")
	if err == nil && strings.TrimSpace(migrated) == "1" {
		return
	}

	raw, err := GetSetting("plugin_hioso_olts")
	if err != nil || strings.TrimSpace(raw) == "" {
		_ = SetSetting("hioso_profiles_migrated", "1")
		return
	}

	var profiles []legacyHiosoOLTProfile
	if err := json.Unmarshal([]byte(raw), &profiles); err != nil {
		_ = SetSetting("hioso_profiles_migrated", "1")
		return
	}

	var devices []HiosoOLTDeviceRecord
	for _, p := range profiles {
		port := 161
		if v, e := fmt.Sscanf(strings.TrimSpace(p.Port), "%d", &port); e != nil || v != 1 {
			port = 161
		}
		webPort := 80
		if v, e := fmt.Sscanf(strings.TrimSpace(p.WebPort), "%d", &webPort); e != nil || v != 1 {
			webPort = 80
		}
		snmpVer := strings.TrimSpace(p.SNMPVersion)
		if snmpVer == "" {
			snmpVer = "2c"
		}
		webHost := strings.TrimSpace(p.WebHost)
		if webHost == "" {
			webHost = strings.TrimSpace(p.Host)
		}
		devices = append(devices, HiosoOLTDeviceRecord{
			Name:          strings.TrimSpace(p.Name),
			Host:          strings.TrimSpace(p.Host),
			Port:          port,
			SNMPVersion:   snmpVer,
			SNMPCommunity: strings.TrimSpace(p.SNMPCommunity),
			WebHost:       webHost,
			WebPort:       webPort,
			Username:      strings.TrimSpace(p.Username),
			Password:      p.Password,
		})
	}

	_ = MigrateHiosoProfilesToDevices(devices)
	_ = SetSetting("hioso_profiles_migrated", "1")
}