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

// DashboardACSSummary is the ACS section of the dashboard summary.
type DashboardACSSummary struct {
	TotalDevices   int     `json:"total_devices"`
	OnlineDevices  int     `json:"online_devices"`
	OfflineDevices int     `json:"offline_devices"`
	AverageRXPower float64 `json:"average_rx_power"`
	AverageTemp    float64 `json:"average_temp"`
}

// DashboardMikroTikDevice is one router row in the dashboard summary.
type DashboardMikroTikDevice struct {
	ID        string `json:"id"`
	Host      string `json:"host"`
	Name      string `json:"name"`
	Status    string `json:"status"`
	Identity  string `json:"identity"`
	CPULoad   string `json:"cpu_load"`
	Uptime    string `json:"uptime"`
	PPPActive int    `json:"ppp_active"`
}

// DashboardMikroTikSummary is the MikroTik section of the dashboard summary.
type DashboardMikroTikSummary struct {
	Total          int                     `json:"total"`
	Online         int                     `json:"online"`
	TotalPPPActive int                     `json:"total_ppp_active"`
	Devices        []DashboardMikroTikDevice `json:"devices"`
}

// DashboardHiosoOLT is one Hioso OLT row in the dashboard summary.
type DashboardHiosoOLT struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Host      string `json:"host"`
	Online    bool   `json:"online"`
	Model     string `json:"model"`
	ONUOnline int    `json:"onu_online"`
	ONUTotal  int    `json:"onu_total"`
	CPU       string `json:"cpu"`
	Uptime    string `json:"uptime"`
}

// DashboardZTEOLT is one ZTE OLT row in the dashboard summary.
type DashboardZTEOLT struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	BaseURL     string `json:"base_url"`
	OltID       string `json:"olt_id"`
	Online      bool   `json:"online"`
	CPUUsage    int    `json:"cpu_usage"`
	MemoryUsage int    `json:"memory_usage"`
	Uptime      string `json:"uptime"`
}

// DashboardOLTSummary is the OLT section of the dashboard summary.
type DashboardOLTSummary struct {
	Total int               `json:"total"`
	Hioso []DashboardHiosoOLT `json:"hioso"`
	ZTE   []DashboardZTEOLT   `json:"zte"`
}

// DashboardSummary is the single-payload response for GET /api/dashboard.
// It replaces the N+1 per-device fan-out the frontend used to perform.
type DashboardSummary struct {
	ACS      DashboardACSSummary     `json:"acs"`
	MikroTik DashboardMikroTikSummary `json:"mikrotik"`
	OLT      DashboardOLTSummary      `json:"olt"`
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
