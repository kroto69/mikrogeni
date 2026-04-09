package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"genieacs-backend/internal/auth"
	"genieacs-backend/internal/db"
	"genieacs-backend/internal/models"
)

func resetLoginThrottleState() {
	loginAttemptMu.Lock()
	defer loginAttemptMu.Unlock()
	loginAttemptByUser = make(map[string]loginAttemptState)
}

func performLoginRequest(t *testing.T, username, password string) *httptest.ResponseRecorder {
	t.Helper()

	payload, err := json.Marshal(models.LoginRequest{Username: username, Password: password})
	if err != nil {
		t.Fatalf("marshal login payload: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/login", bytes.NewReader(payload))
	req.RemoteAddr = "127.0.0.1:12345"
	rec := httptest.NewRecorder()

	Login(rec, req)
	return rec
}

func setupAuthTestDB(t *testing.T) {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "auth-test.sqlite")
	_, err := db.Init(dbPath)
	if err != nil {
		t.Fatalf("init db: %v", err)
	}

	t.Cleanup(func() {
		if db.DB != nil {
			_ = db.DB.Close()
			db.DB = nil
		}
	})
}

func TestLoginThrottlesAfterRepeatedFailures(t *testing.T) {
	t.Setenv("BOOTSTRAP_ADMIN_USERNAME", "")
	t.Setenv("BOOTSTRAP_ADMIN_PASSWORD", "")
	setupAuthTestDB(t)
	resetLoginThrottleState()

	if err := auth.Init("test-secret", "1h", "24h"); err != nil {
		t.Fatalf("init auth: %v", err)
	}

	if err := db.CreateUser("tester", "correct-password", "admin"); err != nil {
		t.Fatalf("create user: %v", err)
	}

	for i := 0; i < maxLoginFailures; i++ {
		rec := performLoginRequest(t, "tester", "wrong-password")
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: expected 401, got %d", i+1, rec.Code)
		}
	}

	blocked := performLoginRequest(t, "tester", "wrong-password")
	if blocked.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 after repeated failures, got %d", blocked.Code)
	}
}

func TestLoginSuccessClearsFailedAttempts(t *testing.T) {
	t.Setenv("BOOTSTRAP_ADMIN_USERNAME", "")
	t.Setenv("BOOTSTRAP_ADMIN_PASSWORD", "")
	setupAuthTestDB(t)
	resetLoginThrottleState()

	if err := auth.Init("test-secret", "1h", "24h"); err != nil {
		t.Fatalf("init auth: %v", err)
	}

	if err := db.CreateUser("tester", "correct-password", "admin"); err != nil {
		t.Fatalf("create user: %v", err)
	}

	for i := 0; i < maxLoginFailures-1; i++ {
		rec := performLoginRequest(t, "tester", "wrong-password")
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("warmup attempt %d: expected 401, got %d", i+1, rec.Code)
		}
	}

	success := performLoginRequest(t, "tester", "correct-password")
	if success.Code != http.StatusOK {
		t.Fatalf("expected successful login (200), got %d", success.Code)
	}

	afterSuccess := performLoginRequest(t, "tester", "wrong-password")
	if afterSuccess.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 after reset, got %d", afterSuccess.Code)
	}
}
