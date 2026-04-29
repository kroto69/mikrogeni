package handlers

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"genieacs-backend/internal/db"
)

func ForwardZTEProxy(w http.ResponseWriter, r *http.Request) {
	connId := chi.URLParam(r, "connId")
	if strings.TrimSpace(connId) == "" {
		hiosoError(w, http.StatusBadRequest, "OLT ID tidak valid")
		return
	}

	conn, err := db.GetZTEConnectionByOltID(connId)
	if err != nil {
		hiosoError(w, http.StatusInternalServerError, "Gagal mencari koneksi ZTE")
		return
	}
	if conn == nil {
		hiosoError(w, http.StatusNotFound, "Koneksi ZTE tidak ditemukan untuk OLT ID: "+connId)
		return
	}

	wildcard := chi.URLParam(r, "*")
	if wildcard == "" {
		hiosoError(w, http.StatusBadRequest, "Path proxy tidak valid")
		return
	}

	targetPath := mapProxyPath(wildcard, connId)
	if targetPath == "" {
		hiosoError(w, http.StatusBadRequest, "Path proxy tidak valid: "+wildcard)
		return
	}

	targetURL := conn.BaseURL + targetPath

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	proxyReq, err := http.NewRequestWithContext(ctx, r.Method, targetURL, r.Body)
	if err != nil {
		log.Printf("ZTE proxy error: oltId=%s url=%s err=%v", connId, targetURL, err)
		hiosoError(w, http.StatusInternalServerError, "Gagal membuat request proxy")
		return
	}

	proxyReq.Header = r.Header.Clone()
	if r.URL.RawQuery != "" {
		proxyReq.URL.RawQuery = r.URL.RawQuery
	}

	resp, err := http.DefaultClient.Do(proxyReq)
	if err != nil {
		log.Printf("ZTE proxy error: oltId=%s url=%s err=%v", connId, targetURL, err)
		hiosoError(w, http.StatusBadGateway, fmt.Sprintf("gagal terhubung ke zzte: %v", err))
		return
	}
	defer resp.Body.Close()

	for key, values := range resp.Header {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}

	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// mapProxyPath converts the chi wildcard path to the zzte API path.
func mapProxyPath(wildcard, connId string) string {
	wildcard = strings.TrimPrefix(wildcard, "/")
	parts := strings.Split(wildcard, "/")

	switch {
	// system → /api/v1/system/olts
	case len(parts) == 1 && parts[0] == "system":
		return "/api/v1/system/olts"

	// system/olt/{oltId} → /api/v1/system/olt/{oltId}
	case len(parts) == 3 && parts[0] == "system" && parts[1] == "olt":
		return fmt.Sprintf("/api/v1/system/olt/%s", parts[2])

	// board/{b}/pon → /api/v1/olt/{connId}/board/{b}/pon
	case len(parts) == 3 && parts[0] == "board" && parts[2] == "pon":
		return fmt.Sprintf("/api/v1/olt/%s/board/%s/pon", connId, parts[1])

	// board/{b}/pon/{p} → /api/v1/olt/{connId}/board/{b}/pon/{p}
	case len(parts) == 4 && parts[0] == "board" && parts[2] == "pon":
		return fmt.Sprintf("/api/v1/olt/%s/board/%s/pon/%s", connId, parts[1], parts[3])

	// board/{b}/pon/{p}/onu/{o} → /api/v1/olt/{connId}/board/{b}/pon/{p}/onu/{o}
	case len(parts) == 6 && parts[0] == "board" && parts[2] == "pon" && parts[4] == "onu":
		return fmt.Sprintf("/api/v1/olt/%s/board/%s/pon/%s/onu/%s", connId, parts[1], parts[3], parts[5])

	// reboot → /api/v1/onu/reboot
	case len(parts) == 1 && parts[0] == "reboot":
		return "/api/v1/onu/reboot"

	// search → /api/v1/search
	case len(parts) == 1 && parts[0] == "search":
		return "/api/v1/search"

	// search/{sub} → /api/v1/search/{sub}
	case len(parts) == 2 && parts[0] == "search":
		return "/api/v1/search/" + parts[1]

	// olts → /api/v1/olts
	case len(parts) == 1 && parts[0] == "olts":
		return "/api/v1/olts"

	// provisioning/{sub} → /api/v1/provisioning/{sub}
	case len(parts) == 2 && parts[0] == "provisioning":
		return "/api/v1/provisioning/" + parts[1]

	default:
		return ""
	}
}
