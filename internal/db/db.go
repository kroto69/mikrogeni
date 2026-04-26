package db

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"

	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var (
	DB *sql.DB
	mu sync.Mutex

	ErrUserNotFound = errors.New("user not found")
)

// Init initializes the database
func Init(dbPath string) (*sql.DB, error) {
	var err error
	DB, err = sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Set connection pool settings
	DB.SetMaxOpenConns(25)
	DB.SetMaxIdleConns(5)

	// Test connection
	if err := DB.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	// Create tables
	if err := createTables(); err != nil {
		return nil, fmt.Errorf("failed to create tables: %w", err)
	}

	// Create vendor and tag tables if not exist
	if err := createAdditionalTables(); err != nil {
		return nil, fmt.Errorf("failed to create additional tables: %w", err)
	}

	// Create default admin user if not exists
	if err := createDefaultUser(); err != nil {
		log.Printf("Warning: failed to create default user: %v", err)
	}

	log.Println("✓ Database initialized successfully")
	return DB, nil
}

// createTables creates necessary database tables
func createTables() error {
	schema := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL,
		role TEXT NOT NULL DEFAULT 'user',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS settings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		key TEXT UNIQUE NOT NULL,
		value TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	`

	_, err := DB.Exec(schema)
	if err != nil {
		return err
	}

	if err := createMikroTikTables(); err != nil {
		return err
	}

	if err := createBillingTables(); err != nil {
		return err
	}

	return nil
}

// createAdditionalTables creates vendor, tag, and fault tables
func createAdditionalTables() error {
	schema := `
	CREATE TABLE IF NOT EXISTS vendors (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT UNIQUE NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS tags (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT UNIQUE NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS faults (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		device_id TEXT NOT NULL,
		fault_type TEXT NOT NULL,
		description TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS device_credentials (
		device_id TEXT PRIMARY KEY,
		pppoe_username TEXT NOT NULL DEFAULT '',
		pppoe_password TEXT NOT NULL DEFAULT '',
		wifi_passwords TEXT NOT NULL DEFAULT '{}',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS acs_learned_profiles (
		vendor TEXT NOT NULL,
		product_class TEXT NOT NULL,
		profile_key TEXT NOT NULL,
		score INTEGER NOT NULL DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY (vendor, product_class)
	);
	`

	_, err := DB.Exec(schema)
	return err
}

func GetACSLearnedProfile(vendor, productClass string) (string, int, error) {
	if DB == nil {
		return "", 0, nil
	}
	vendor = strings.TrimSpace(strings.ToLower(vendor))
	productClass = strings.TrimSpace(strings.ToLower(productClass))
	if vendor == "" && productClass == "" {
		return "", 0, nil
	}

	var profileKey string
	var score int
	err := DB.QueryRow(
		"SELECT profile_key, score FROM acs_learned_profiles WHERE vendor = ? AND product_class = ?",
		vendor,
		productClass,
	).Scan(&profileKey, &score)
	if err == sql.ErrNoRows {
		return "", 0, nil
	}
	if err != nil {
		return "", 0, err
	}
	return profileKey, score, nil
}

func UpsertACSLearnedProfile(vendor, productClass, profileKey string, score int) error {
	if DB == nil {
		return nil
	}
	vendor = strings.TrimSpace(strings.ToLower(vendor))
	productClass = strings.TrimSpace(strings.ToLower(productClass))
	profileKey = strings.TrimSpace(strings.ToLower(profileKey))
	if vendor == "" || productClass == "" || profileKey == "" {
		return nil
	}

	mu.Lock()
	defer mu.Unlock()

	_, err := DB.Exec(
		"INSERT INTO acs_learned_profiles (vendor, product_class, profile_key, score) VALUES (?, ?, ?, ?) ON CONFLICT(vendor, product_class) DO UPDATE SET profile_key = excluded.profile_key, score = excluded.score, updated_at = CURRENT_TIMESTAMP",
		vendor,
		productClass,
		profileKey,
		score,
	)
	return err
}

type ACSLearnedProfile struct {
	Vendor       string `json:"vendor"`
	ProductClass string `json:"product_class"`
	ProfileKey   string `json:"profile_key"`
	Score        int    `json:"score"`
	CreatedAt    string `json:"created_at"`
	UpdatedAt    string `json:"updated_at"`
}

func ListACSLearnedProfiles() ([]ACSLearnedProfile, error) {
	if DB == nil {
		return []ACSLearnedProfile{}, nil
	}

	rows, err := DB.Query("SELECT vendor, product_class, profile_key, score, created_at, updated_at FROM acs_learned_profiles ORDER BY updated_at DESC, vendor ASC, product_class ASC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]ACSLearnedProfile, 0)
	for rows.Next() {
		var item ACSLearnedProfile
		if err := rows.Scan(&item.Vendor, &item.ProductClass, &item.ProfileKey, &item.Score, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		result = append(result, item)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return result, nil
}

func DeleteACSLearnedProfile(vendor, productClass string) error {
	if DB == nil {
		return nil
	}
	vendor = strings.TrimSpace(strings.ToLower(vendor))
	productClass = strings.TrimSpace(strings.ToLower(productClass))
	if vendor == "" || productClass == "" {
		return nil
	}

	mu.Lock()
	defer mu.Unlock()

	_, err := DB.Exec("DELETE FROM acs_learned_profiles WHERE vendor = ? AND product_class = ?", vendor, productClass)
	return err
}

// createDefaultUser bootstraps admin user only when explicitly configured.
func createDefaultUser() error {
	mu.Lock()
	defer mu.Unlock()

	bootstrapUsername := strings.TrimSpace(os.Getenv("BOOTSTRAP_ADMIN_USERNAME"))
	bootstrapPassword := os.Getenv("BOOTSTRAP_ADMIN_PASSWORD")

	if bootstrapUsername == "" && bootstrapPassword == "" {
		return nil
	}

	if bootstrapUsername == "" || bootstrapPassword == "" {
		return fmt.Errorf("BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD must both be set")
	}

	if len(bootstrapPassword) < 8 {
		return fmt.Errorf("BOOTSTRAP_ADMIN_PASSWORD must be at least 8 characters")
	}

	// Check if bootstrap user exists
	var count int
	err := DB.QueryRow("SELECT COUNT(*) FROM users WHERE username = ?", bootstrapUsername).Scan(&count)
	if err != nil {
		return err
	}

	if count > 0 {
		return nil
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(bootstrapPassword), 12)
	if err != nil {
		return err
	}

	// Insert bootstrap admin user
	_, err = DB.Exec(
		"INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
		bootstrapUsername,
		string(hashedPassword),
		"admin",
	)
	return err
}

// GetUser retrieves a user by username
func GetUser(username string) (*sql.Row, error) {
	row := DB.QueryRow(
		"SELECT id, username, password, role FROM users WHERE username = ?",
		username,
	)
	return row, nil
}

// CreateUser creates a new user
func CreateUser(username, password, role string) error {
	mu.Lock()
	defer mu.Unlock()

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return err
	}

	_, err = DB.Exec(
		"INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
		username,
		string(hashedPassword),
		role,
	)
	return err
}

// GetSetting retrieves a single setting value
func GetSetting(key string) (string, error) {
	var value string
	err := DB.QueryRow("SELECT value FROM settings WHERE key = ?", key).Scan(&value)
	if err != nil && err != sql.ErrNoRows {
		return "", err
	}
	return value, nil
}

// GetSettings retrieves multiple settings
func GetSettings(keys []string) (map[string]string, error) {
	result := make(map[string]string)

	for _, key := range keys {
		value, err := GetSetting(key)
		if err != nil && err != sql.ErrNoRows {
			return nil, err
		}
		result[key] = value
	}

	return result, nil
}

// SetSetting sets a setting value
func SetSetting(key, value string) error {
	mu.Lock()
	defer mu.Unlock()

	// Check if setting exists
	var exists bool
	err := DB.QueryRow("SELECT EXISTS(SELECT 1 FROM settings WHERE key = ?)", key).Scan(&exists)
	if err != nil {
		return err
	}

	if exists {
		_, err = DB.Exec("UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?", value, key)
	} else {
		_, err = DB.Exec("INSERT INTO settings (key, value) VALUES (?, ?)", key, value)
	}

	return err
}

// DeleteSetting deletes a setting
func DeleteSetting(key string) error {
	mu.Lock()
	defer mu.Unlock()

	_, err := DB.Exec("DELETE FROM settings WHERE key = ?", key)
	return err
}

// GetAllSettings retrieves all settings
func GetAllSettings() (map[string]string, error) {
	rows, err := DB.Query("SELECT key, value FROM settings")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]string)
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return nil, err
		}
		result[key] = value
	}

	return result, rows.Err()
}

// UpdateUser updates user information
func UpdateUser(id int, username, role, password string) error {
	mu.Lock()
	defer mu.Unlock()

	if strings.TrimSpace(password) != "" {
		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), 12)
		if err != nil {
			return err
		}

		result, err := DB.Exec(
			"UPDATE users SET username = ?, role = ?, password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
			username,
			role,
			string(hashedPassword),
			id,
		)
		if err != nil {
			return err
		}

		rowsAffected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if rowsAffected == 0 {
			return ErrUserNotFound
		}
		return nil
	}

	result, err := DB.Exec(
		"UPDATE users SET username = ?, role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
		username,
		role,
		id,
	)
	if err != nil {
		return err
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return ErrUserNotFound
	}

	return nil
}

// DeleteUser deletes a user
func DeleteUser(id int) error {
	mu.Lock()
	defer mu.Unlock()

	result, err := DB.Exec("DELETE FROM users WHERE id = ?", id)
	if err != nil {
		return err
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return ErrUserNotFound
	}

	return nil
}

// GetAllUsers retrieves all users
func GetAllUsers() ([]map[string]interface{}, error) {
	rows, err := DB.Query("SELECT id, username, role, created_at FROM users")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []map[string]interface{}
	for rows.Next() {
		var id int
		var username, role, createdAt string
		if err := rows.Scan(&id, &username, &role, &createdAt); err != nil {
			return nil, err
		}

		users = append(users, map[string]interface{}{
			"id":         id,
			"username":   username,
			"role":       role,
			"created_at": createdAt,
		})
	}

	return users, rows.Err()
}

// Vendor Management

// CreateVendor creates a new vendor
func CreateVendor(name string) error {
	mu.Lock()
	defer mu.Unlock()

	_, err := DB.Exec(
		"INSERT INTO vendors (name) VALUES (?) ON CONFLICT(name) DO NOTHING",
		name,
	)
	return err
}

// GetAllVendors retrieves all vendors
func GetAllVendors() ([]map[string]interface{}, error) {
	rows, err := DB.Query("SELECT id, name, created_at FROM vendors")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var vendors []map[string]interface{}
	for rows.Next() {
		var id int
		var name, createdAt string
		if err := rows.Scan(&id, &name, &createdAt); err != nil {
			return nil, err
		}

		vendors = append(vendors, map[string]interface{}{
			"id":         id,
			"name":       name,
			"created_at": createdAt,
		})
	}

	return vendors, rows.Err()
}

// Tag Management

// CreateTag creates a new tag
func CreateTag(name string) error {
	mu.Lock()
	defer mu.Unlock()

	_, err := DB.Exec(
		"INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING",
		name,
	)
	return err
}

// GetAllTags retrieves all tags
func GetAllTags() ([]map[string]interface{}, error) {
	rows, err := DB.Query("SELECT id, name, created_at FROM tags")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tags []map[string]interface{}
	for rows.Next() {
		var id int
		var name, createdAt string
		if err := rows.Scan(&id, &name, &createdAt); err != nil {
			return nil, err
		}

		tags = append(tags, map[string]interface{}{
			"id":         id,
			"name":       name,
			"created_at": createdAt,
		})
	}

	return tags, rows.Err()
}

// Fault Management

// CreateFault creates a new fault record
func CreateFault(deviceID, faultType, description string) error {
	mu.Lock()
	defer mu.Unlock()

	_, err := DB.Exec(
		"INSERT INTO faults (device_id, fault_type, description) VALUES (?, ?, ?)",
		deviceID,
		faultType,
		description,
	)
	return err
}

// GetFaults retrieves faults for a device
func GetFaults(deviceID string) ([]map[string]interface{}, error) {
	rows, err := DB.Query(
		"SELECT id, device_id, fault_type, description, created_at FROM faults WHERE device_id = ? ORDER BY created_at DESC",
		deviceID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var faults []map[string]interface{}
	for rows.Next() {
		var id int
		var deviceID, faultType, description, createdAt string
		if err := rows.Scan(&id, &deviceID, &faultType, &description, &createdAt); err != nil {
			return nil, err
		}

		faults = append(faults, map[string]interface{}{
			"id":          id,
			"device_id":   deviceID,
			"fault_type":  faultType,
			"description": description,
			"created_at":  createdAt,
		})
	}

	return faults, rows.Err()
}

// DeleteFault deletes a fault record
func DeleteFault(id int) error {
	mu.Lock()
	defer mu.Unlock()

	_, err := DB.Exec("DELETE FROM faults WHERE id = ?", id)
	return err
}

type DeviceCredentials struct {
	DeviceID      string
	PPPoEUsername string
	PPPoEPassword string
	WiFiPasswords map[string]string
}

func GetDeviceCredentials(deviceID string) (*DeviceCredentials, error) {
	var (
		credentials   DeviceCredentials
		wifiPasswords string
	)

	err := DB.QueryRow(
		"SELECT device_id, pppoe_username, pppoe_password, wifi_passwords FROM device_credentials WHERE device_id = ?",
		deviceID,
	).Scan(&credentials.DeviceID, &credentials.PPPoEUsername, &credentials.PPPoEPassword, &wifiPasswords)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	credentials.WiFiPasswords = make(map[string]string)
	if wifiPasswords != "" {
		if err := json.Unmarshal([]byte(wifiPasswords), &credentials.WiFiPasswords); err != nil {
			return nil, err
		}
	}

	return &credentials, nil
}

func UpsertDeviceCredentials(deviceID string, pppoeUsername *string, pppoePassword *string, wifiPasswords map[string]string) error {
	mu.Lock()
	defer mu.Unlock()

	credentials, err := GetDeviceCredentials(deviceID)
	if err != nil {
		return err
	}

	merged := DeviceCredentials{DeviceID: deviceID, WiFiPasswords: make(map[string]string)}
	if credentials != nil {
		merged.PPPoEUsername = credentials.PPPoEUsername
		merged.PPPoEPassword = credentials.PPPoEPassword
		for key, value := range credentials.WiFiPasswords {
			merged.WiFiPasswords[key] = value
		}
	}

	if pppoeUsername != nil && *pppoeUsername != "" {
		merged.PPPoEUsername = *pppoeUsername
	}
	if pppoePassword != nil && *pppoePassword != "" {
		merged.PPPoEPassword = *pppoePassword
	}

	for key, value := range wifiPasswords {
		if key == "" || value == "" {
			continue
		}
		merged.WiFiPasswords[key] = value
	}

	rawWiFiPasswords, err := json.Marshal(merged.WiFiPasswords)
	if err != nil {
		return err
	}

	_, err = DB.Exec(
		"INSERT INTO device_credentials (device_id, pppoe_username, pppoe_password, wifi_passwords) VALUES (?, ?, ?, ?) ON CONFLICT(device_id) DO UPDATE SET pppoe_username = excluded.pppoe_username, pppoe_password = excluded.pppoe_password, wifi_passwords = excluded.wifi_passwords, updated_at = CURRENT_TIMESTAMP",
		deviceID,
		merged.PPPoEUsername,
		merged.PPPoEPassword,
		string(rawWiFiPasswords),
	)

	return err
}
