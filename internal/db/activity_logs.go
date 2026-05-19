package db

import "time"

type ActivityLog struct {
	ID        int64  `json:"id"`
	Username  string `json:"username"`
	Action    string `json:"action"`
	Target    string `json:"target"`
	Device    string `json:"device"`
	Detail    string `json:"detail"`
	CreatedAt string `json:"created_at"`
}

func InsertActivityLog(username, action, target, device, detail string) {
	if DB == nil {
		return
	}
	_, _ = DB.Exec(
		`INSERT INTO activity_logs (username, action, target, device, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		username, action, target, device, detail, time.Now().UTC().Format(time.RFC3339),
	)
	// Keep only the 50 most recent logs
	_, _ = DB.Exec(`DELETE FROM activity_logs WHERE id NOT IN (SELECT id FROM activity_logs ORDER BY created_at DESC LIMIT 50)`)
}

func GetActivityLogs(limit, offset int) ([]ActivityLog, int, error) {
	if DB == nil {
		return nil, 0, nil
	}

	var total int
	_ = DB.QueryRow(`SELECT COUNT(*) FROM activity_logs`).Scan(&total)

	rows, err := DB.Query(`SELECT id, username, action, target, device, detail, created_at FROM activity_logs ORDER BY created_at DESC LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var logs []ActivityLog
	for rows.Next() {
		var l ActivityLog
		if err := rows.Scan(&l.ID, &l.Username, &l.Action, &l.Target, &l.Device, &l.Detail, &l.CreatedAt); err != nil {
			continue
		}
		logs = append(logs, l)
	}
	return logs, total, nil
}
