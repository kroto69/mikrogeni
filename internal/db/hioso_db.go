package db

import (
	"time"
)

// HiosoDevice menyimpan konfigurasi OLT Hioso.
type HiosoDevice struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Host         string `json:"host"`
	Port         int    `json:"port"`
	Username     string `json:"username"`
	Password     string `json:"password,omitempty"`
	FirmwareType string `json:"firmware_type"`
	Status       string `json:"status"`
	CreatedAt    string `json:"created_at"`
	UpdatedAt    string `json:"updated_at"`
}

func createHiosoDeviceTables() error {
	_, err := DB.Exec(`
	CREATE TABLE IF NOT EXISTS hioso_devices (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		host TEXT NOT NULL,
		port INTEGER DEFAULT 80,
		username TEXT NOT NULL,
		password TEXT NOT NULL DEFAULT '',
		firmware_type TEXT DEFAULT '',
		status TEXT DEFAULT 'unknown',
		created_at TEXT,
		updated_at TEXT
	)`)
	return err
}

func CreateHiosoDevice(d HiosoDevice) error {
	now := time.Now().Format(time.RFC3339)
	_, err := DB.Exec(`INSERT INTO hioso_devices (id,name,host,port,username,password,firmware_type,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
		d.ID, d.Name, d.Host, d.Port, d.Username, d.Password, d.FirmwareType, d.Status, now, now)
	return err
}

func ListHiosoDevices() ([]HiosoDevice, error) {
	rows, err := DB.Query(`SELECT id,name,host,port,username,password,firmware_type,status,created_at,updated_at FROM hioso_devices ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var devices []HiosoDevice
	for rows.Next() {
		var d HiosoDevice
		if err := rows.Scan(&d.ID, &d.Name, &d.Host, &d.Port, &d.Username, &d.Password, &d.FirmwareType, &d.Status, &d.CreatedAt, &d.UpdatedAt); err != nil {
			return nil, err
		}
		devices = append(devices, d)
	}
	return devices, nil
}

func GetHiosoDeviceByID(id string) (*HiosoDevice, error) {
	var d HiosoDevice
	err := DB.QueryRow(`SELECT id,name,host,port,username,password,firmware_type,status,created_at,updated_at FROM hioso_devices WHERE id=?`, id).
		Scan(&d.ID, &d.Name, &d.Host, &d.Port, &d.Username, &d.Password, &d.FirmwareType, &d.Status, &d.CreatedAt, &d.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &d, nil
}

func UpdateHiosoDeviceFirmware(id, firmwareType, status string) error {
	now := time.Now().Format(time.RFC3339)
	_, err := DB.Exec(`UPDATE hioso_devices SET firmware_type=?,status=?,updated_at=? WHERE id=?`,
		firmwareType, status, now, id)
	return err
}

func DeleteHiosoDevice(id string) error {
	_, err := DB.Exec(`DELETE FROM hioso_devices WHERE id=?`, id)
	return err
}
