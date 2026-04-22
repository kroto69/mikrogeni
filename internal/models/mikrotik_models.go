package models

type MikroTikDeviceCreateRequest struct {
	ID            string   `json:"id,omitempty"`
	Name          string   `json:"name"`
	Host          string   `json:"host"`
	Port          int      `json:"port,omitempty"`
	Username      string   `json:"username"`
	Password      string   `json:"password"`
	UseTLS        bool     `json:"use_tls,omitempty"`
	SkipTLSVerify bool     `json:"skip_tls_verify,omitempty"`
	Site          string   `json:"site,omitempty"`
	Tags          []string `json:"tags,omitempty"`
}

type MikroTikDeviceUpdateRequest struct {
	Name          *string  `json:"name,omitempty"`
	Host          *string  `json:"host,omitempty"`
	Port          *int     `json:"port,omitempty"`
	Username      *string  `json:"username,omitempty"`
	Password      *string  `json:"password,omitempty"`
	UseTLS        *bool    `json:"use_tls,omitempty"`
	SkipTLSVerify *bool    `json:"skip_tls_verify,omitempty"`
	Site          *string  `json:"site,omitempty"`
	Tags          []string `json:"tags,omitempty"`
}

type MikroTikInterfaceUpdateRequest struct {
	Disabled *bool   `json:"disabled,omitempty"`
	Comment  *string `json:"comment,omitempty"`
	MTU      *int    `json:"mtu,omitempty"`
}

type MikroTikSecretUpsertRequest struct {
	Name          string  `json:"name"`
	Password      *string `json:"password,omitempty"`
	Profile       *string `json:"profile,omitempty"`
	Service       *string `json:"service,omitempty"`
	LocalAddress  *string `json:"local_address,omitempty"`
	RemoteAddress *string `json:"remote_address,omitempty"`
	Comment       *string `json:"comment,omitempty"`
	Disabled      *bool   `json:"disabled,omitempty"`
}

type MikroTikProfileUpsertRequest struct {
	Name         string  `json:"name"`
	LocalAddress *string `json:"local_address,omitempty"`
	RemotePool   *string `json:"remote_pool,omitempty"`
	RateLimit    *string `json:"rate_limit,omitempty"`
	DNSServer    *string `json:"dns_server,omitempty"`
	OnlyOne      *bool   `json:"only_one,omitempty"`
	ChangeTCPMSS *bool   `json:"change_tcp_mss,omitempty"`
	Comment      *string `json:"comment,omitempty"`
}

type MikroTikKickActiveRequest struct {
	SessionIDs []string `json:"session_ids,omitempty"`
	Usernames  []string `json:"usernames,omitempty"`
}

type MikroTikBulkJobRequest struct {
	DeviceIDs []string               `json:"device_ids"`
	Action    string                 `json:"action"`
	Payload   map[string]interface{} `json:"payload"`
}
