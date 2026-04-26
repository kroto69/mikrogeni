package olt

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"strings"
	"time"
)

const sqliteTimestampLayout = "2006-01-02 15:04:05"

type SQLiteRepository struct {
	db *sql.DB
}

func NewSQLiteRepository(db *sql.DB) *SQLiteRepository {
	return &SQLiteRepository{db: db}
}

func (r *SQLiteRepository) Create(ctx context.Context, request AddOLTRequest) (*OLTDevice, error) {
	request.ID = strings.TrimSpace(request.ID)
	request.Name = strings.TrimSpace(request.Name)
	request.Endpoint = strings.TrimSpace(request.Endpoint)
	request.SNMPHost = strings.TrimSpace(request.SNMPHost)
	request.SNMPCommunity = strings.TrimSpace(request.SNMPCommunity)
	request.TelnetHost = strings.TrimSpace(request.TelnetHost)
	request.TelnetUsername = strings.TrimSpace(request.TelnetUsername)

	if request.ID == "" {
		return nil, errors.New("id is required")
	}

	if request.Name == "" {
		request.Name = request.ID
	}

	defaultHost := extractHostFromEndpoint(request.Endpoint)
	if request.SNMPHost == "" {
		request.SNMPHost = defaultHost
	}
	if request.TelnetHost == "" {
		request.TelnetHost = defaultHost
	}

	if request.SNMPPort <= 0 {
		request.SNMPPort = 161
	}
	if request.SNMPCommunity == "" {
		request.SNMPCommunity = "public"
	}
	if request.TelnetPort <= 0 {
		request.TelnetPort = 23
	}
	if request.TelnetUsername == "" {
		request.TelnetUsername = "zte"
	}
	if request.TelnetPassword == "" {
		request.TelnetPassword = "zte"
	}
	if request.TelnetEnablePassword == "" {
		request.TelnetEnablePassword = "zxr10"
	}
	if request.OLTPort <= 0 {
		request.OLTPort = 8081
	}

	var location any
	if request.Location != "" {
		location = request.Location
	} else {
		location = nil
	}

	_, err := r.db.ExecContext(ctx, `
		INSERT INTO olt_devices (
			id, name, location, endpoint,
			snmp_host, snmp_port, snmp_community,
			telnet_host, telnet_port, telnet_username, telnet_password, telnet_enable_password,
			olt_port, status
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		request.ID,
		request.Name,
		location,
		request.Endpoint,
		request.SNMPHost,
		request.SNMPPort,
		request.SNMPCommunity,
		request.TelnetHost,
		request.TelnetPort,
		request.TelnetUsername,
		request.TelnetPassword,
		request.TelnetEnablePassword,
		request.OLTPort,
		StatusUnknown,
	)
	if err != nil {
		return nil, err
	}

	return r.GetByID(ctx, request.ID)
}

func (r *SQLiteRepository) GetByID(ctx context.Context, id string) (*OLTDevice, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT
			id, name, location, endpoint,
			snmp_host, snmp_port, snmp_community,
			telnet_host, telnet_port, telnet_username, telnet_password, telnet_enable_password,
			olt_port, status, error_message, created_at, updated_at
		FROM olt_devices
		WHERE id = ?
	`, id)

	device, err := scanOLTDevice(row)
	if err == sql.ErrNoRows {
		return nil, ErrOLTNotFound
	}
	if err != nil {
		return nil, err
	}

	return device, nil
}

func (r *SQLiteRepository) List(ctx context.Context) ([]*OLTDevice, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT
			id, name, location, endpoint,
			snmp_host, snmp_port, snmp_community,
			telnet_host, telnet_port, telnet_username, telnet_password, telnet_enable_password,
			olt_port, status, error_message, created_at, updated_at
		FROM olt_devices
		ORDER BY created_at DESC, id DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	devices := make([]*OLTDevice, 0)
	for rows.Next() {
		device, scanErr := scanOLTDevice(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		devices = append(devices, device)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return devices, nil
}

func (r *SQLiteRepository) UpdateStatus(ctx context.Context, id, status, errMsg string) error {
	var errorMessage any
	if errMsg != "" {
		errorMessage = errMsg
	} else {
		errorMessage = nil
	}

	result, err := r.db.ExecContext(ctx, `
		UPDATE olt_devices
		SET status = ?, error_message = ?
		WHERE id = ?
	`, status, errorMessage, id)
	if err != nil {
		return err
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrOLTNotFound
	}

	return nil
}

func (r *SQLiteRepository) Delete(ctx context.Context, id string) error {
	result, err := r.db.ExecContext(ctx, `DELETE FROM olt_devices WHERE id = ?`, id)
	if err != nil {
		return err
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrOLTNotFound
	}

	return nil
}

type scanner interface {
	Scan(dest ...any) error
}

func scanOLTDevice(s scanner) (*OLTDevice, error) {
	var (
		device       OLTDevice
		location     sql.NullString
		errorMessage sql.NullString
		createdAtRaw string
		updatedAtRaw string
	)

	err := s.Scan(
		&device.ID,
		&device.Name,
		&location,
		&device.Endpoint,
		&device.SNMPHost,
		&device.SNMPPort,
		&device.SNMPCommunity,
		&device.TelnetHost,
		&device.TelnetPort,
		&device.TelnetUsername,
		&device.TelnetPassword,
		&device.TelnetEnablePassword,
		&device.OLTPort,
		&device.Status,
		&errorMessage,
		&createdAtRaw,
		&updatedAtRaw,
	)
	if err != nil {
		return nil, err
	}

	if location.Valid {
		locationValue := location.String
		device.Location = &locationValue
	}

	if errorMessage.Valid {
		errorMessageValue := errorMessage.String
		device.ErrorMessage = &errorMessageValue
	}

	device.CreatedAt = parseSQLiteTimestamp(createdAtRaw)
	device.UpdatedAt = parseSQLiteTimestamp(updatedAtRaw)

	return &device, nil
}

func parseSQLiteTimestamp(value string) time.Time {
	if value == "" {
		return time.Time{}
	}

	if parsed, err := time.Parse(sqliteTimestampLayout, value); err == nil {
		return parsed
	}
	if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return parsed
	}

	return time.Time{}
}

func extractHostFromEndpoint(endpoint string) string {
	trimmed := strings.TrimSpace(endpoint)
	if trimmed == "" {
		return "127.0.0.1"
	}

	normalized := trimmed
	if !strings.HasPrefix(normalized, "http://") && !strings.HasPrefix(normalized, "https://") {
		normalized = "http://" + normalized
	}

	parsed, err := url.Parse(normalized)
	if err == nil {
		host := strings.TrimSpace(parsed.Hostname())
		if host != "" {
			return host
		}
	}

	hostPort := trimmed
	if slash := strings.Index(hostPort, "/"); slash >= 0 {
		hostPort = hostPort[:slash]
	}
	hostPort = strings.TrimSpace(hostPort)
	if hostPort == "" {
		return "127.0.0.1"
	}

	if colon := strings.Index(hostPort, ":"); colon >= 0 {
		hostPort = strings.TrimSpace(hostPort[:colon])
	}
	if hostPort == "" {
		return "127.0.0.1"
	}

	return hostPort
}
