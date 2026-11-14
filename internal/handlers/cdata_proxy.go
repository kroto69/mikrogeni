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

// ForwardCDataProxy meneruskan request C-Data ke zzte — cerminan
// ForwardZTEProxy, dengan path /api/v1/cdata/... (tanpa board).
// Koneksi dicari dari tabel yang sama (zte_connections) berdasarkan
// olt_id; baris C-Data terbentuk otomatis saat koneksi zzte dibuat
// (auto-fetch /api/v1/olts) dan dibedakan lewat kolom vendor.
func ForwardCDataProxy(w http.ResponseWriter, r *http.Request) {
	connId := chi.URLParam(r, "connId")
	if strings.TrimSpace(connId) == "" {
		pluginError(w, http.StatusBadRequest, "OLT ID tidak valid")
		return
	}

	conn, err := db.GetZTEConnectionByOltID(connId)
	if err != nil {
		pluginError(w, http.StatusInternalServerError, "Gagal mencari koneksi C-Data")
		return
	}
	if conn == nil {
		pluginError(w, http.StatusNotFound, "Koneksi C-Data tidak ditemukan untuk OLT ID: "+connId)
		return
	}

	wildcard := chi.URLParam(r, "*")
	if wildcard == "" {
		pluginError(w, http.StatusBadRequest, "Path proxy tidak valid")
		return
	}

	targetPath := mapCDataProxyPath(wildcard, connId)
	if targetPath == "" {
		pluginError(w, http.StatusBadRequest, "Path proxy tidak valid: "+wildcard)
		return
	}

	// Log mutation actions
	if r.Method == "POST" && strings.Contains(targetPath, "/reboot") {
		logActivity(r, "reboot_onu", r.URL.Query().Get("onuId"), connId, "cdata")
	}

	targetURL := conn.BaseURL + targetPath

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	proxyReq, err := http.NewRequestWithContext(ctx, r.Method, targetURL, r.Body)
	if err != nil {
		log.Printf("C-Data proxy error: oltId=%s url=%s err=%v", connId, targetURL, err)
		pluginError(w, http.StatusInternalServerError, "Gagal membuat request proxy")
		return
	}

	proxyReq.Header = r.Header.Clone()
	if r.URL.RawQuery != "" {
		proxyReq.URL.RawQuery = r.URL.RawQuery
	}

	resp, err := http.DefaultClient.Do(proxyReq)
	if err != nil {
		log.Printf("C-Data proxy error: oltId=%s url=%s err=%v", connId, targetURL, err)
		pluginError(w, http.StatusBadGateway, fmt.Sprintf("gagal terhubung ke zzte: %v", err))
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

// mapCDataProxyPath converts the chi wildcard path to the zzte C-Data API path.
func mapCDataProxyPath(wildcard, connId string) string {
	wildcard = strings.TrimPrefix(wildcard, "/")
	parts := strings.Split(wildcard, "/")

	switch {
	// olts → /api/v1/cdata/olts
	case len(parts) == 1 && parts[0] == "olts":
		return "/api/v1/cdata/olts"

	// pon → /api/v1/cdata/olt/{connId}/pon
	case len(parts) == 1 && parts[0] == "pon":
		return fmt.Sprintf("/api/v1/cdata/olt/%s/pon", connId)

	// pon/{p} → /api/v1/cdata/olt/{connId}/pon/{p}
	case len(parts) == 2 && parts[0] == "pon":
		return fmt.Sprintf("/api/v1/cdata/olt/%s/pon/%s", connId, parts[1])

	// pon/{p}/onu/{o} → /api/v1/cdata/olt/{connId}/pon/{p}/onu/{o}
	case len(parts) == 4 && parts[0] == "pon" && parts[2] == "onu":
		return fmt.Sprintf("/api/v1/cdata/olt/%s/pon/%s/onu/%s", connId, parts[1], parts[3])

	// reboot → /api/v1/cdata/onu/reboot
	case len(parts) == 1 && parts[0] == "reboot":
		return "/api/v1/cdata/onu/reboot"

	default:
		return ""
	}
}
