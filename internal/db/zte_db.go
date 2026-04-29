package db

import (
	"database/sql"
	"fmt"
	"strings"
	"sync/atomic"
	"time"

	"genieacs-backend/internal/models"
)

var zteConnectionIDCounter uint64

func createZTEConnectionTables() error {
	schema := `
	CREATE TABLE IF NOT EXISTS zte_connections (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		base_url TEXT NOT NULL,
		olt_id TEXT DEFAULT '',
		is_active INTEGER DEFAULT 1,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_zte_connections_name ON zte_connections(name);
	CREATE INDEX IF NOT EXISTS idx_zte_connections_olt_id ON zte_connections(olt_id);
	`

	_, err := DB.Exec(schema)
	if err != nil {
		return err
	}

	DB.Exec(`ALTER TABLE zte_connections ADD COLUMN olt_id TEXT DEFAULT ''`)

	return nil
}

func NewZTEConnectionID() string {
	stamp := time.Now().UTC().Format("060102150405")
	sequence := atomic.AddUint64(&zteConnectionIDCounter, 1) % 10000
	return fmt.Sprintf("zte-%s-%04d", stamp, sequence)
}

func CreateZTEConnection(req models.ZTEConnectionRequest) (*models.ZTEConnection, error) {
	mu.Lock()
	defer mu.Unlock()

	id := strings.TrimSpace(req.ID)
	if id == "" {
		id = NewZTEConnectionID()
	}

	_, err := DB.Exec(
		`INSERT INTO zte_connections (id, name, base_url) VALUES (?, ?, ?)`,
		id,
		strings.TrimSpace(req.Name),
		strings.TrimSpace(req.BaseURL),
	)
	if err != nil {
		return nil, err
	}

	return GetZTEConnectionByID(id)
}

func GetZTEConnectionByID(id string) (*models.ZTEConnection, error) {
	query := `SELECT id, name, base_url, is_active,
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', created_at), ''),
		COALESCE(olt_id, '')
		FROM zte_connections WHERE id = ?`

	row := DB.QueryRow(query, strings.TrimSpace(id))
	conn, err := scanZTEConnection(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return conn, nil
}

func GetZTEConnectionByOltID(oltId string) (*models.ZTEConnection, error) {
	query := `SELECT id, name, base_url, is_active,
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', created_at), ''),
		COALESCE(olt_id, '')
		FROM zte_connections WHERE olt_id = ?`

	row := DB.QueryRow(query, strings.TrimSpace(oltId))
	conn, err := scanZTEConnection(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return conn, nil
}

func ListZTEConnections() ([]models.ZTEConnection, error) {
	query := `SELECT id, name, base_url, is_active,
		COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', created_at), ''),
		COALESCE(olt_id, '')
		FROM zte_connections ORDER BY created_at DESC`

	rows, err := DB.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	connections := make([]models.ZTEConnection, 0)
	for rows.Next() {
		conn, err := scanZTEConnection(rows)
		if err != nil {
			return nil, err
		}
		connections = append(connections, *conn)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return connections, nil
}

func DeleteZTEConnection(id string) error {
	mu.Lock()
	defer mu.Unlock()

	_, err := DB.Exec(`DELETE FROM zte_connections WHERE id = ?`, strings.TrimSpace(id))
	return err
}

func UpdateZTEConnection(id string, req models.ZTEConnectionUpdateRequest) (*models.ZTEConnection, error) {
	mu.Lock()
	defer mu.Unlock()

	existing, err := GetZTEConnectionByID(id)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, fmt.Errorf("not found")
	}

	name := existing.Name
	baseURL := existing.BaseURL
	oltID := existing.OltID

	if req.Name != nil {
		name = strings.TrimSpace(*req.Name)
	}
	if req.BaseURL != nil {
		baseURL = strings.TrimSpace(*req.BaseURL)
	}
	if req.OltID != nil {
		oltID = strings.TrimSpace(*req.OltID)
	}

	_, err = DB.Exec(
		`UPDATE zte_connections SET name = ?, base_url = ?, olt_id = ? WHERE id = ?`,
		name, baseURL, oltID, strings.TrimSpace(id),
	)
	if err != nil {
		return nil, err
	}

	return GetZTEConnectionByID(id)
}

func scanZTEConnection(scanner interface {
	Scan(dest ...interface{}) error
}) (*models.ZTEConnection, error) {
	var (
		conn      models.ZTEConnection
		isActive  int
		createdAt string
	)

	err := scanner.Scan(
		&conn.ID,
		&conn.Name,
		&conn.BaseURL,
		&isActive,
		&createdAt,
		&conn.OltID,
	)
	if err != nil {
		return nil, err
	}

	conn.IsActive = isActive == 1
	conn.CreatedAt, _ = time.Parse("2006-01-02T15:04:05Z", createdAt)

	return &conn, nil
}

func init() {
	zteConnectionIDCounter = 0
}
