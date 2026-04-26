package db

func createOLTDeviceTables() error {
	schema := `
	CREATE TABLE IF NOT EXISTS olt_devices (
		id TEXT PRIMARY KEY CHECK(length(id) = 8),
		name TEXT NOT NULL,
		location TEXT,
		endpoint TEXT NOT NULL UNIQUE,
		snmp_host TEXT NOT NULL,
		snmp_port INTEGER DEFAULT 161,
		snmp_community TEXT NOT NULL DEFAULT 'public',
		telnet_host TEXT NOT NULL,
		telnet_port INTEGER DEFAULT 23,
		telnet_username TEXT DEFAULT 'zte',
		telnet_password TEXT DEFAULT 'zte',
		telnet_enable_password TEXT DEFAULT 'zxr10',
		olt_port INTEGER DEFAULT 8081,
		status TEXT DEFAULT 'unknown' CHECK(status IN ('unknown', 'online', 'offline', 'error')),
		error_message TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE UNIQUE INDEX IF NOT EXISTS idx_olt_devices_endpoint ON olt_devices(endpoint);
	CREATE INDEX IF NOT EXISTS idx_olt_devices_status ON olt_devices(status);

	CREATE TRIGGER IF NOT EXISTS trg_olt_devices_updated_at
	AFTER UPDATE ON olt_devices
	FOR EACH ROW
	WHEN NEW.updated_at = OLD.updated_at
	BEGIN
		UPDATE olt_devices
		SET updated_at = CURRENT_TIMESTAMP
		WHERE id = OLD.id;
	END;
	`

	_, err := DB.Exec(schema)
	return err
}
