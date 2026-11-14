package models

import "time"

type ZTEConnection struct {
	ID        string    `json:"id" db:"id"`
	Name      string    `json:"name" db:"name"`
	BaseURL   string    `json:"base_url" db:"base_url"`
	OltID     string    `json:"olt_id" db:"olt_id"`
	Vendor    string    `json:"vendor,omitempty" db:"vendor"`
	IsActive  bool      `json:"is_active" db:"is_active"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

type ZTEConnectionRequest struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	BaseURL string `json:"base_url"`
	Vendor  string `json:"vendor,omitempty"`
}

type ZTEConnectionUpdateRequest struct {
	Name    *string `json:"name,omitempty"`
	BaseURL *string `json:"base_url,omitempty"`
	OltID   *string `json:"olt_id,omitempty"`
	Vendor  *string `json:"vendor,omitempty"`
}
