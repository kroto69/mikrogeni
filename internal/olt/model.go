package olt

import (
	"time"

	gonanoid "github.com/matoous/go-nanoid/v2"
)

const (
	StatusUnknown = "unknown"
	StatusOnline  = "online"
	StatusOffline = "offline"
	StatusError   = "error"
)

const oltIDSize = 8

const oltIDAlphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

// NewOLTID creates an OLT device ID using nanoid with 8 characters.
func NewOLTID() (string, error) {
	return gonanoid.Generate(oltIDAlphabet, oltIDSize)
}

type OLTDevice struct {
	ID                   string    `json:"id"`
	Name                 string    `json:"name"`
	Location             *string   `json:"location,omitempty"`
	Endpoint             string    `json:"endpoint"`
	SNMPHost             string    `json:"snmp_host"`
	SNMPPort             int       `json:"snmp_port"`
	SNMPCommunity        string    `json:"snmp_community"`
	TelnetHost           string    `json:"telnet_host"`
	TelnetPort           int       `json:"telnet_port"`
	TelnetUsername       string    `json:"telnet_username"`
	TelnetPassword       string    `json:"telnet_password"`
	TelnetEnablePassword string    `json:"telnet_enable_password"`
	OLTPort              int       `json:"olt_port"`
	Status               string    `json:"status"`
	ErrorMessage         *string   `json:"error_message,omitempty"`
	CreatedAt            time.Time `json:"created_at"`
	UpdatedAt            time.Time `json:"updated_at"`
}

type AddOLTRequest struct {
	ID                   string `json:"id"`
	Name                 string `json:"name"`
	Location             string `json:"location"`
	Endpoint             string `json:"endpoint"`
	SNMPHost             string `json:"snmp_host"`
	SNMPPort             int    `json:"snmp_port"`
	SNMPCommunity        string `json:"snmp_community"`
	TelnetHost           string `json:"telnet_host"`
	TelnetPort           int    `json:"telnet_port"`
	TelnetUsername       string `json:"telnet_username"`
	TelnetPassword       string `json:"telnet_password"`
	TelnetEnablePassword string `json:"telnet_enable_password"`
	OLTPort              int    `json:"olt_port"`
}
