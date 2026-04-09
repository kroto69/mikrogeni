package middleware

import (
	"context"
	"encoding/json"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"time"

	"genieacs-backend/internal/auth"
	"genieacs-backend/internal/models"
)

type limiterState struct {
	tokens     float64
	lastRefill time.Time
}

var (
	rateLimitMu     sync.Mutex
	rateLimitStates = make(map[string]limiterState)
	ratePerSecond   = 20.0
	burstCapacity   = 60.0
)

// AuthenticateToken middleware verifies JWT token
func AuthenticateToken(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(models.ErrorResponse{
				Error: "Missing authorization header",
			})
			return
		}

		// Extract token from "Bearer <token>"
		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || parts[0] != "Bearer" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(models.ErrorResponse{
				Error: "Invalid authorization header format",
			})
			return
		}

		token := parts[1]

		// Verify token
		claims, err := auth.VerifyToken(token)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(models.ErrorResponse{
				Error: "Invalid or expired token",
			})
			return
		}

		// Store claims in context
		ctx := context.WithValue(r.Context(), "claims", claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// JSONContentType middleware sets JSON content type
func JSONContentType(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		next.ServeHTTP(w, r)
	})
}

// CORSMiddleware enables CORS
func CORSMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func RateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		now := time.Now()

		rateLimitMu.Lock()
		state, exists := rateLimitStates[ip]
		if !exists {
			state = limiterState{tokens: burstCapacity, lastRefill: now}
		}

		elapsed := now.Sub(state.lastRefill).Seconds()
		if elapsed > 0 {
			state.tokens += elapsed * ratePerSecond
			if state.tokens > burstCapacity {
				state.tokens = burstCapacity
			}
			state.lastRefill = now
		}

		if state.tokens < 1 {
			rateLimitStates[ip] = state
			rateLimitMu.Unlock()
			w.WriteHeader(http.StatusTooManyRequests)
			json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Too many requests"})
			return
		}

		state.tokens--
		rateLimitStates[ip] = state
		rateLimitMu.Unlock()

		next.ServeHTTP(w, r)
	})
}

func clientIP(r *http.Request) string {
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
