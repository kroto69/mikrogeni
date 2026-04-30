package middleware

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/golang-jwt/jwt/v5"
)

// RequireRole restricts access to users with one of the given roles.
// Must be used after AuthenticateToken so claims exist in context.
func RequireRole(roles ...string) func(http.Handler) http.Handler {
	roleSet := make(map[string]struct{}, len(roles))
	for _, r := range roles {
		roleSet[r] = struct{}{}
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claimsRaw := r.Context().Value("claims")
			if claimsRaw == nil {
				writeForbidden(w)
				return
			}

			claims, ok := claimsRaw.(jwt.MapClaims)
			if !ok {
				writeForbidden(w)
				return
			}

			role, ok := claims["role"].(string)
			if !ok {
				writeForbidden(w)
				return
			}

			if _, allowed := roleSet[role]; !allowed {
				username, _ := claims["username"].(string)
				log.Printf("[rbac] forbidden: user=%s role=%s endpoint=%s", username, role, r.URL.Path)
				writeForbidden(w)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func writeForbidden(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusForbidden)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": false,
		"error":   "Forbidden",
		"code":    403,
	})
}