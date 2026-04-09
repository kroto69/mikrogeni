package db

import (
	"database/sql"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func setupUserTableForBootstrapTest(t *testing.T) {
	t.Helper()

	testDB, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite memory db: %v", err)
	}

	_, err = testDB.Exec(`
		CREATE TABLE users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT UNIQUE NOT NULL,
			password TEXT NOT NULL,
			role TEXT NOT NULL DEFAULT 'user',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
	`)
	if err != nil {
		t.Fatalf("create users table: %v", err)
	}

	DB = testDB
	t.Cleanup(func() {
		if DB != nil {
			_ = DB.Close()
			DB = nil
		}
	})
}

func TestCreateDefaultUserSkipsWhenBootstrapEnvMissing(t *testing.T) {
	setupUserTableForBootstrapTest(t)
	t.Setenv("BOOTSTRAP_ADMIN_USERNAME", "")
	t.Setenv("BOOTSTRAP_ADMIN_PASSWORD", "")

	if err := createDefaultUser(); err != nil {
		t.Fatalf("createDefaultUser should skip without env, got error: %v", err)
	}

	var count int
	if err := DB.QueryRow("SELECT COUNT(*) FROM users").Scan(&count); err != nil {
		t.Fatalf("count users: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected no seeded user without bootstrap env, got %d", count)
	}
}

func TestCreateDefaultUserSeedsConfiguredBootstrapAdmin(t *testing.T) {
	setupUserTableForBootstrapTest(t)
	t.Setenv("BOOTSTRAP_ADMIN_USERNAME", "bootstrap-admin")
	t.Setenv("BOOTSTRAP_ADMIN_PASSWORD", "strong-pass-123")

	if err := createDefaultUser(); err != nil {
		t.Fatalf("createDefaultUser should create bootstrap user, got error: %v", err)
	}

	var username, hashedPassword, role string
	err := DB.QueryRow("SELECT username, password, role FROM users WHERE username = ?", "bootstrap-admin").
		Scan(&username, &hashedPassword, &role)
	if err != nil {
		t.Fatalf("query bootstrap admin: %v", err)
	}

	if role != "admin" {
		t.Fatalf("expected role admin, got %s", role)
	}
	if hashedPassword == "strong-pass-123" {
		t.Fatalf("expected password to be hashed")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte("strong-pass-123")); err != nil {
		t.Fatalf("expected stored hash to match bootstrap password: %v", err)
	}
}

func TestCreateDefaultUserRejectsShortBootstrapPassword(t *testing.T) {
	setupUserTableForBootstrapTest(t)
	t.Setenv("BOOTSTRAP_ADMIN_USERNAME", "bootstrap-admin")
	t.Setenv("BOOTSTRAP_ADMIN_PASSWORD", "short")

	if err := createDefaultUser(); err == nil {
		t.Fatalf("expected createDefaultUser to reject short bootstrap password")
	}
}
