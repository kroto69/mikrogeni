package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"genieacs-backend/internal/db"
	"github.com/golang-jwt/jwt/v5"
)

func getRequestUsername(r *http.Request) string {
	claims, _ := r.Context().Value("claims").(jwt.MapClaims)
	if claims == nil {
		return "system"
	}
	if u, ok := claims["username"].(string); ok {
		return u
	}
	return "unknown"
}

func logActivity(r *http.Request, action, target, device, detail string) {
	db.InsertActivityLog(getRequestUsername(r), action, target, device, detail)
}

func GetActivityLogs(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if limit <= 0 || limit > 100 {
		limit = 20
	}

	logs, total, err := db.GetActivityLogs(limit, offset)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
		return
	}
	if logs == nil {
		logs = []db.ActivityLog{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"data":  logs,
		"total": total,
	})
}
