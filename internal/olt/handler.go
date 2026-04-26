package olt

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"genieacs-backend/internal/middleware"
	"genieacs-backend/internal/models"

	"github.com/go-chi/chi/v5"
)

const defaultHealthTimeout = 5 * time.Second

type OLTHandler struct {
	repo          OLTRepository
	httpClient    *http.Client
	healthTimeout time.Duration
}

func NewOLTHandler(repo OLTRepository) *OLTHandler {
	return &OLTHandler{
		repo: repo,
		httpClient: &http.Client{
			Timeout: defaultHealthTimeout,
		},
		healthTimeout: defaultHealthTimeout,
	}
}

func RegisterOLTRoutes(r chi.Router, h *OLTHandler) {
	proxyHandler := NewProxyHandler(h.repo)

	r.Route("/api/olt", func(r chi.Router) {
		r.Use(middleware.AuthenticateToken)

		r.Post("/", h.CreateOLT)
		r.Get("/", h.ListOLT)
		r.Get("/{oltId}", h.GetOLTByID)
		r.Delete("/{oltId}", h.DeleteOLT)
		r.Get("/{oltId}/health", h.GetOLTHealth)

		r.Mount("/{oltId}/board", proxyHandler)
		r.Mount("/{oltId}/paginate", proxyHandler)
		r.Mount("/{oltId}/onu", proxyHandler)
		r.Mount("/{oltId}/vlan", proxyHandler)
		r.Mount("/{oltId}/traffic", proxyHandler)
		r.Mount("/{oltId}/monitoring", proxyHandler)
		r.Mount("/{oltId}/onu-management", proxyHandler)
		r.Mount("/{oltId}/batch", proxyHandler)
		r.Mount("/{oltId}/config", proxyHandler)
		r.Mount("/{oltId}/system", proxyHandler)
		r.Mount("/{oltId}/profiles", proxyHandler)
	})
}

func (h *OLTHandler) CreateOLT(w http.ResponseWriter, r *http.Request) {
	var req AddOLTRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "invalid request body", Detail: err.Error()})
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	req.ID = strings.TrimSpace(req.ID)
	req.Location = strings.TrimSpace(req.Location)
	req.Endpoint = strings.TrimSpace(req.Endpoint)
	req.SNMPHost = strings.TrimSpace(req.SNMPHost)
	req.SNMPCommunity = strings.TrimSpace(req.SNMPCommunity)
	req.TelnetHost = strings.TrimSpace(req.TelnetHost)
	req.TelnetUsername = strings.TrimSpace(req.TelnetUsername)

	if req.ID == "" || req.Endpoint == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "id dan endpoint wajib diisi"})
		return
	}

	if len(req.ID) != oltIDSize {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "id harus 8 karakter"})
		return
	}

	if req.Name == "" {
		req.Name = req.ID
	}

	if req.SNMPHost == "" {
		req.SNMPHost = extractHostFromEndpoint(req.Endpoint)
	}

	if req.TelnetHost == "" {
		req.TelnetHost = req.SNMPHost
	}

	if req.SNMPHost == "" || req.TelnetHost == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "endpoint tidak valid untuk menurunkan host default"})
		return
	}

	created, err := h.repo.Create(r.Context(), req)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to create olt", Detail: err.Error()})
		return
	}

	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(created)
}

func (h *OLTHandler) ListOLT(w http.ResponseWriter, r *http.Request) {
	devices, err := h.repo.List(r.Context())
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to list olt devices", Detail: err.Error()})
		return
	}

	if devices == nil {
		devices = make([]*OLTDevice, 0)
	}

	for _, device := range devices {
		if device == nil || strings.TrimSpace(device.ID) == "" {
			continue
		}

		deviceID := device.ID
		endpoint := strings.TrimSpace(device.Endpoint)

		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), h.healthTimeout)
			defer cancel()

			status, errMsg := h.checkHealth(ctx, endpoint)
			_ = h.repo.UpdateStatus(ctx, deviceID, status, errMsg)
		}()
	}

	_ = json.NewEncoder(w).Encode(devices)
}

func (h *OLTHandler) GetOLTByID(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(chi.URLParam(r, "oltId"))
	if id == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "oltId is required"})
		return
	}

	device, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		if err == ErrOLTNotFound {
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "olt not found"})
			return
		}

		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to fetch olt", Detail: err.Error()})
		return
	}

	healthCtx, cancel := context.WithTimeout(r.Context(), h.healthTimeout)
	defer cancel()

	status, errMsg := h.checkHealth(healthCtx, strings.TrimSpace(device.Endpoint))
	if updateErr := h.repo.UpdateStatus(r.Context(), id, status, errMsg); updateErr != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to update olt status", Detail: updateErr.Error()})
		return
	}

	updatedDevice, getErr := h.repo.GetByID(r.Context(), id)
	if getErr == nil && updatedDevice != nil {
		_ = json.NewEncoder(w).Encode(updatedDevice)
		return
	}

	device.Status = status
	if strings.TrimSpace(errMsg) == "" {
		device.ErrorMessage = nil
	} else {
		device.ErrorMessage = &errMsg
	}
	_ = json.NewEncoder(w).Encode(device)
}

func (h *OLTHandler) DeleteOLT(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(chi.URLParam(r, "oltId"))
	if id == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "oltId is required"})
		return
	}

	err := h.repo.Delete(r.Context(), id)
	if err != nil {
		if err == ErrOLTNotFound {
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "olt not found"})
			return
		}

		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to delete olt", Detail: err.Error()})
		return
	}

	_ = json.NewEncoder(w).Encode(models.SuccessResponse{Success: true, Message: "OLT deleted"})
}

func (h *OLTHandler) GetOLTHealth(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(chi.URLParam(r, "oltId"))
	if id == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "oltId is required"})
		return
	}

	device, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		if err == ErrOLTNotFound {
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "olt not found"})
			return
		}

		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to fetch olt", Detail: err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), h.healthTimeout)
	defer cancel()

	status, errMsg := h.checkHealth(ctx, strings.TrimSpace(device.Endpoint))
	if err := h.repo.UpdateStatus(r.Context(), id, status, errMsg); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to update olt status", Detail: err.Error()})
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]any{
		"id":      id,
		"status":  status,
		"message": errMsg,
	})
}

func (h *OLTHandler) checkHealth(ctx context.Context, endpoint string) (status string, errMsg string) {
	url, err := buildHealthURL(endpoint)
	if err != nil {
		return StatusError, err.Error()
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return StatusError, err.Error()
	}

	resp, err := h.httpClient.Do(req)
	if err != nil {
		return StatusOffline, err.Error()
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return StatusOffline, fmt.Sprintf("health endpoint returned status %d", resp.StatusCode)
	}

	return StatusOnline, ""
}

func buildHealthURL(endpoint string) (string, error) {
	trimmed := strings.TrimSpace(endpoint)
	if trimmed == "" {
		return "", fmt.Errorf("endpoint is empty")
	}

	if !strings.HasPrefix(trimmed, "http://") && !strings.HasPrefix(trimmed, "https://") {
		trimmed = "http://" + trimmed
	}

	trimmed = strings.TrimRight(trimmed, "/")
	return trimmed + "/health", nil
}
