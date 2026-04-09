package models

import "time"

// User represents a user in the system
type User struct {
	ID        int       `json:"id"`
	Username  string    `json:"username"`
	Password  string    `json:"-"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Device represents an ONT/GPON device
type Device struct {
	ID            string   `json:"id"`
	SerialNumber  string   `json:"serial_number"`
	ProductClass  string   `json:"product_class"`
	PPPoE         string   `json:"pppoe"`
	WANBridge     string   `json:"wan_bridge"`
	RXPower       string   `json:"rx_power"`
	Temperature   string   `json:"temperature"`
	ActiveDevices string   `json:"active_devices"`
	LastInform    string   `json:"last_inform"`
	SSID1         string   `json:"ssid_1"`
	SSID2         string   `json:"ssid_2"`
	SSID3         string   `json:"ssid_3"`
	SSID4         string   `json:"ssid_4"`
	SSID5         string   `json:"ssid_5"`
	SSID6         string   `json:"ssid_6"`
	SSID7         string   `json:"ssid_7"`
	SSID8         string   `json:"ssid_8"`
	Tags          []string `json:"tags"`
}

// LoginRequest represents login request
type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// TokenResponse represents token response
type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
}

// ErrorResponse represents error response
type ErrorResponse struct {
	Error  string `json:"error"`
	Detail string `json:"detail,omitempty"`
}

// SuccessResponse represents success response
type SuccessResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

// DashboardStats represents dashboard statistics
type DashboardStats struct {
	TotalDevices   int     `json:"total_devices"`
	OnlineDevices  int     `json:"online_devices"`
	OfflineDevices int     `json:"offline_devices"`
	AverageRXPower float64 `json:"average_rx_power"`
	AverageTemp    float64 `json:"average_temp"`
}

// RebootDeviceRequest represents reboot device request
type RebootDeviceRequest struct {
	DeviceID string `json:"device_id"`
}

// DeleteDeviceRequest represents delete device request
type DeleteDeviceRequest struct {
	DeviceID string `json:"device_id"`
}

// SettingsUpdateRequest represents settings update request
type SettingsUpdateRequest struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// Setting represents a setting key-value pair
type Setting struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}
