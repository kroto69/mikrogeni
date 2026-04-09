package handlers

type deviceParameterInput struct {
	Name  string      `json:"name"`
	Value interface{} `json:"value"`
	Type  string      `json:"type,omitempty"`
}

type deviceParametersRequest struct {
	Parameters []deviceParameterInput `json:"parameters"`
}

type deviceWiFiConfigRequest struct {
	SSID2G     *string                `json:"ssid_2g,omitempty"`
	Password2G *string                `json:"password_2g,omitempty"`
	Enabled2G  *bool                  `json:"enabled_2g,omitempty"`
	SSID5G     *string                `json:"ssid_5g,omitempty"`
	Password5G *string                `json:"password_5g,omitempty"`
	Enabled5G  *bool                  `json:"enabled_5g,omitempty"`
	SSID1      *string                `json:"ssid1,omitempty"`
	Password1  *string                `json:"password1,omitempty"`
	Enabled1   *bool                  `json:"enabled1,omitempty"`
	Hide1      *bool                  `json:"hide1,omitempty"`
	SSID2      *string                `json:"ssid2,omitempty"`
	Password2  *string                `json:"password2,omitempty"`
	Enabled2   *bool                  `json:"enabled2,omitempty"`
	Hide2      *bool                  `json:"hide2,omitempty"`
	SSID3      *string                `json:"ssid3,omitempty"`
	Password3  *string                `json:"password3,omitempty"`
	Enabled3   *bool                  `json:"enabled3,omitempty"`
	Hide3      *bool                  `json:"hide3,omitempty"`
	SSID4      *string                `json:"ssid4,omitempty"`
	Password4  *string                `json:"password4,omitempty"`
	Enabled4   *bool                  `json:"enabled4,omitempty"`
	Hide4      *bool                  `json:"hide4,omitempty"`
	SSID5      *string                `json:"ssid5,omitempty"`
	Password5  *string                `json:"password5,omitempty"`
	Enabled5   *bool                  `json:"enabled5,omitempty"`
	Hide5      *bool                  `json:"hide5,omitempty"`
	SSID6      *string                `json:"ssid6,omitempty"`
	Password6  *string                `json:"password6,omitempty"`
	Enabled6   *bool                  `json:"enabled6,omitempty"`
	Hide6      *bool                  `json:"hide6,omitempty"`
	SSID7      *string                `json:"ssid7,omitempty"`
	Password7  *string                `json:"password7,omitempty"`
	Enabled7   *bool                  `json:"enabled7,omitempty"`
	Hide7      *bool                  `json:"hide7,omitempty"`
	SSID8      *string                `json:"ssid8,omitempty"`
	Password8  *string                `json:"password8,omitempty"`
	Enabled8   *bool                  `json:"enabled8,omitempty"`
	Hide8      *bool                  `json:"hide8,omitempty"`
	Parameters []deviceParameterInput `json:"parameters,omitempty"`
}

type deviceWANConfigRequest struct {
	PPPoEUsername *string                `json:"pppoe_username,omitempty"`
	PPPoEPassword *string                `json:"pppoe_password,omitempty"`
	NATEnabled    *bool                  `json:"nat_enabled,omitempty"`
	MTU           *int                   `json:"mtu,omitempty"`
	Parameters    []deviceParameterInput `json:"parameters,omitempty"`
}
