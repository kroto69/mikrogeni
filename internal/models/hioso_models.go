package models

type HiosoOLTDeviceCreateRequest struct {
	ID            string `json:"id,omitempty"`
	Name          string `json:"name"`
	Host          string `json:"host"`
	Port          int    `json:"port,omitempty"`
	SNMPVersion  string `json:"snmp_version,omitempty"`
	SNMPCommunity string `json:"snmp_community"`
	WebHost       string `json:"web_host,omitempty"`
	WebPort       int    `json:"web_port,omitempty"`
	Username      string `json:"username,omitempty"`
	Password      string `json:"password,omitempty"`
}

type HiosoOLTDeviceUpdateRequest struct {
	Name          *string `json:"name,omitempty"`
	Host          *string `json:"host,omitempty"`
	Port          *int    `json:"port,omitempty"`
	SNMPVersion   *string `json:"snmp_version,omitempty"`
	SNMPCommunity *string `json:"snmp_community,omitempty"`
	WebHost       *string `json:"web_host,omitempty"`
	WebPort       *int    `json:"web_port,omitempty"`
	Username      *string `json:"username,omitempty"`
	Password      *string `json:"password,omitempty"`
}