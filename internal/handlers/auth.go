package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"time"

	"genieacs-backend/internal/auth"
	"genieacs-backend/internal/db"
	"genieacs-backend/internal/models"
)

type loginAttemptState struct {
	failures int
	resetAt  time.Time
}

var (
	loginAttemptMu     sync.Mutex
	loginAttemptByUser = make(map[string]loginAttemptState)
)

const (
	maxLoginFailures = 5
	loginLockWindow  = 5 * time.Minute
)

func loginThrottleKey(r *http.Request, username string) string {
	trimmedUsername := strings.ToLower(strings.TrimSpace(username))
	if trimmedUsername == "" {
		trimmedUsername = "unknown"
	}
	return fmt.Sprintf("%s|%s", trimmedUsername, loginClientIP(r))
}

func loginClientIP(r *http.Request) string {
	if forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); forwarded != "" {
		parts := strings.Split(forwarded, ",")
		if len(parts) > 0 {
			candidate := strings.TrimSpace(parts[0])
			if addr, err := netip.ParseAddr(candidate); err == nil {
				return addr.String()
			}
		}
	}

	host := strings.TrimSpace(r.RemoteAddr)
	if host == "" {
		return "unknown"
	}

	if strings.Contains(host, ":") {
		if addrPort, err := netip.ParseAddrPort(host); err == nil {
			return addrPort.Addr().String()
		}
		if addr, err := netip.ParseAddr(host); err == nil {
			return addr.String()
		}
	}

	return host
}

func isLoginBlocked(key string, now time.Time) bool {
	loginAttemptMu.Lock()
	defer loginAttemptMu.Unlock()

	state, ok := loginAttemptByUser[key]
	if !ok {
		return false
	}

	if now.After(state.resetAt) {
		delete(loginAttemptByUser, key)
		return false
	}

	return state.failures >= maxLoginFailures
}

func recordFailedLogin(key string, now time.Time) {
	loginAttemptMu.Lock()
	defer loginAttemptMu.Unlock()

	state, ok := loginAttemptByUser[key]
	if !ok || now.After(state.resetAt) {
		state = loginAttemptState{failures: 0, resetAt: now.Add(loginLockWindow)}
	}

	state.failures++
	loginAttemptByUser[key] = state
}

func clearFailedLogins(key string) {
	loginAttemptMu.Lock()
	defer loginAttemptMu.Unlock()
	delete(loginAttemptByUser, key)
}

// Login handles POST /api/login
func Login(w http.ResponseWriter, r *http.Request) {
	var req models.LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{
			Error: "Invalid request body",
		})
		return
	}

	if req.Username == "" || req.Password == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{
			Error: "Username and password are required",
		})
		return
	}

	throttleKey := loginThrottleKey(r, req.Username)
	if isLoginBlocked(throttleKey, time.Now()) {
		w.WriteHeader(http.StatusTooManyRequests)
		json.NewEncoder(w).Encode(models.ErrorResponse{
			Error: "Too many failed login attempts. Please try again later",
		})
		return
	}

	// Get user from database
	row, err := db.GetUser(req.Username)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{
			Error: "Failed to process login request",
		})
		return
	}

	var userID int
	var username, storedPassword, role string
	err = row.Scan(&userID, &username, &storedPassword, &role)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			recordFailedLogin(throttleKey, time.Now())
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(models.ErrorResponse{
				Error: "Invalid credentials",
			})
			return
		}

		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{
			Error: "Failed to process login request",
		})
		return
	}

	// Compare password
	if !auth.ComparePassword(storedPassword, req.Password) {
		recordFailedLogin(throttleKey, time.Now())
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(models.ErrorResponse{
			Error: "Invalid credentials",
		})
		return
	}

	clearFailedLogins(throttleKey)

	// Generate tokens
	accessToken, refreshToken, err := auth.GenerateTokens(userID, username, role)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{
			Error: "Failed to generate tokens",
		})
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(models.TokenResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    3600, // 1 hour
	})
}
