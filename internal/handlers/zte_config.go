package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"genieacs-backend/internal/db"
	"genieacs-backend/internal/models"
)

func ListZTEConnections(w http.ResponseWriter, r *http.Request) {
	connections, err := db.ListZTEConnections()
	if err != nil {
		hiosoError(w, http.StatusInternalServerError, "Gagal mengambil data koneksi ZTE")
		return
	}
	if connections == nil {
		connections = make([]models.ZTEConnection, 0)
	}
	hiosoJSON(w, connections)
}

func CreateZTEConnection(w http.ResponseWriter, r *http.Request) {
	var req models.ZTEConnectionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		hiosoError(w, http.StatusBadRequest, "Body request tidak valid")
		return
	}

	if strings.TrimSpace(req.BaseURL) == "" {
		hiosoError(w, http.StatusBadRequest, "Base URL wajib diisi")
		return
	}

	conn, err := db.CreateZTEConnection(req)
	if err != nil {
		hiosoError(w, http.StatusInternalServerError, "Gagal menyimpan koneksi ZTE")
		return
	}

	type oltItem struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	type oltsResponse struct {
		Success bool      `json:"success"`
		Data    []oltItem `json:"data"`
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	fetchURL := strings.TrimRight(conn.BaseURL, "/") + "/api/v1/olts"
	fetchReq, err := http.NewRequestWithContext(ctx, http.MethodGet, fetchURL, nil)
	if err != nil {
		log.Printf("ZTE auto-fetch failed: %v", err)
		hiosoJSON(w, conn)
		return
	}

	resp, err := http.DefaultClient.Do(fetchReq)
	if err != nil {
		log.Printf("ZTE auto-fetch failed: %v", err)
		hiosoJSON(w, conn)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("ZTE auto-fetch failed: unexpected status %d", resp.StatusCode)
		hiosoJSON(w, conn)
		return
	}

	var result oltsResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		log.Printf("ZTE auto-fetch failed: %v", err)
		hiosoJSON(w, conn)
		return
	}

	if len(result.Data) > 0 {
		fetchedName := strings.TrimSpace(result.Data[0].Name)
		fetchedOltID := strings.TrimSpace(result.Data[0].ID)
		if fetchedName != "" || fetchedOltID != "" {
			updateReq := models.ZTEConnectionUpdateRequest{}
			if fetchedName != "" {
				updateReq.Name = &fetchedName
			}
			if fetchedOltID != "" {
				updateReq.OltID = &fetchedOltID
			}
			updated, err := db.UpdateZTEConnection(conn.ID, updateReq)
			if err != nil {
				log.Printf("ZTE auto-fetch update failed: %v", err)
				hiosoJSON(w, conn)
				return
			}
			conn = updated
		}
	}

	hiosoJSON(w, conn)
}

func DeleteZTEConnection(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if strings.TrimSpace(id) == "" {
		hiosoError(w, http.StatusBadRequest, "ID koneksi tidak valid")
		return
	}

	existing, err := db.GetZTEConnectionByID(id)
	if err != nil {
		hiosoError(w, http.StatusInternalServerError, "Gagal mencari koneksi ZTE")
		return
	}
	if existing == nil {
		hiosoError(w, http.StatusNotFound, "Koneksi ZTE tidak ditemukan")
		return
	}

	if err := db.DeleteZTEConnection(id); err != nil {
		hiosoError(w, http.StatusInternalServerError, "Gagal menghapus koneksi ZTE")
		return
	}

	hiosoJSON(w, map[string]string{"message": "Koneksi ZTE berhasil dihapus"})
}

func UpdateZTEConnection(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if strings.TrimSpace(id) == "" {
		hiosoError(w, http.StatusBadRequest, "ID koneksi tidak valid")
		return
	}

	var req models.ZTEConnectionUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		hiosoError(w, http.StatusBadRequest, "Body request tidak valid")
		return
	}

	conn, err := db.UpdateZTEConnection(id, req)
	if err != nil {
		if err.Error() == "not found" {
			hiosoError(w, http.StatusNotFound, "Koneksi ZTE tidak ditemukan")
			return
		}
		hiosoError(w, http.StatusInternalServerError, "Gagal mengupdate koneksi ZTE")
		return
	}

	hiosoJSON(w, conn)
}

func HealthCheckZTE(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if strings.TrimSpace(id) == "" {
		hiosoError(w, http.StatusBadRequest, "ID koneksi tidak valid")
		return
	}

	conn, err := db.GetZTEConnectionByID(id)
	if err != nil {
		hiosoError(w, http.StatusInternalServerError, "Gagal mencari koneksi ZTE")
		return
	}
	if conn == nil {
		hiosoError(w, http.StatusNotFound, "Koneksi ZTE tidak ditemukan")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	targetURL := strings.TrimRight(conn.BaseURL, "/") + "/api/v1/olts"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		hiosoJSON(w, map[string]interface{}{
			"status":     "error",
			"latency_ms": 0,
		})
		return
	}

	start := time.Now()
	resp, err := http.DefaultClient.Do(req)
	latency := time.Since(start).Milliseconds()

	if err != nil || resp.StatusCode != http.StatusOK {
		if err == nil {
			resp.Body.Close()
		}
		hiosoJSON(w, map[string]interface{}{
			"status":     "offline",
			"latency_ms": latency,
		})
		return
	}
	defer resp.Body.Close()

	hiosoJSON(w, map[string]interface{}{
		"status":     "ok",
		"latency_ms": latency,
	})
}

func TestZTEConnection(w http.ResponseWriter, r *http.Request) {
	var req struct {
		BaseURL string `json:"base_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		hiosoError(w, http.StatusBadRequest, "Body tidak valid")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	targetURL := strings.TrimRight(req.BaseURL, "/") + "/api/v1/olts"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		hiosoJSON(w, map[string]interface{}{"status": "error", "latency_ms": 0})
		return
	}

	start := time.Now()
	resp, err := http.DefaultClient.Do(httpReq)
	latency := time.Since(start).Milliseconds()

	if err != nil || resp.StatusCode != http.StatusOK {
		if err == nil {
			resp.Body.Close()
		}
		hiosoJSON(w, map[string]interface{}{"status": "offline", "latency_ms": latency})
		return
	}
	defer resp.Body.Close()

	hiosoJSON(w, map[string]interface{}{"status": "ok", "latency_ms": latency})
}
