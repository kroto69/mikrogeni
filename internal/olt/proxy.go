package olt

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"genieacs-backend/internal/models"

	"github.com/go-chi/chi/v5"
)

const (
	proxyTimeout = 30 * time.Second
	cacheTTL     = 30 * time.Second
)

var proxyResources = map[string]struct{}{
	"paginate":       {},
	"board":          {},
	"onu":            {},
	"vlan":           {},
	"traffic":        {},
	"monitoring":     {},
	"onu-management": {},
	"batch":          {},
	"config":         {},
	"system":         {},
	"profiles":       {},
}

var hopByHopHeaders = []string{
	"Connection",
	"Proxy-Connection",
	"Keep-Alive",
	"Proxy-Authenticate",
	"Proxy-Authorization",
	"TE",
	"Trailer",
	"Transfer-Encoding",
	"Upgrade",
}

type cachedOLT struct {
	device    *OLTDevice
	expiredAt time.Time
}

type ProxyHandler struct {
	repo       OLTRepository
	httpClient *http.Client

	mu    sync.RWMutex
	cache map[string]*cachedOLT
}

func NewProxyHandler(repo OLTRepository) *ProxyHandler {
	transport := &http.Transport{
		Proxy:               http.ProxyFromEnvironment,
		MaxIdleConnsPerHost: 10,
	}

	return &ProxyHandler{
		repo: repo,
		httpClient: &http.Client{
			Timeout:   proxyTimeout,
			Transport: transport,
		},
		cache: make(map[string]*cachedOLT),
	}
}

func (h *ProxyHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	oltID := strings.TrimSpace(chi.URLParam(r, "oltId"))
	if oltID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "oltId is required"})
		return
	}

	device, err := h.lookupOLT(r.Context(), oltID)
	if err != nil {
		if errors.Is(err, ErrOLTNotFound) {
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "olt not found"})
			return
		}

		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to fetch olt", Detail: err.Error()})
		return
	}

	if strings.ToLower(strings.TrimSpace(device.Status)) != StatusOnline {
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "OLT sedang offline atau belum tersedia"})
		return
	}

	strippedPath, err := stripOLTPath(r.URL.Path, oltID)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "invalid proxy path", Detail: err.Error()})
		return
	}

	resource := firstPathSegment(strippedPath)
	if _, ok := proxyResources[resource]; !ok {
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "resource is not proxied"})
		return
	}

	targetURL, err := buildProxyTargetURL(device.Endpoint, strippedPath, r.URL.RawQuery)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "invalid olt endpoint", Detail: err.Error()})
		return
	}

	outReq := r.Clone(r.Context())
	outReq.URL = targetURL
	outReq.Host = targetURL.Host
	outReq.RequestURI = ""
	outReq.Header = make(http.Header, len(r.Header))
	copyHeaders(outReq.Header, r.Header)
	removeHopByHopHeaders(outReq.Header)

	resp, err := h.httpClient.Do(outReq)
	if err != nil {
		h.markOffline(oltID, err.Error())
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to forward request to olt", Detail: err.Error()})
		return
	}
	defer resp.Body.Close()

	removeHopByHopHeaders(resp.Header)
	copyHeaders(w.Header(), resp.Header)
	w.WriteHeader(resp.StatusCode)
	if _, copyErr := io.Copy(w, resp.Body); copyErr != nil {
		return
	}
}

func (h *ProxyHandler) lookupOLT(ctx context.Context, oltID string) (*OLTDevice, error) {
	now := time.Now()

	h.mu.RLock()
	entry, ok := h.cache[oltID]
	if ok && now.Before(entry.expiredAt) {
		cached := cloneOLT(entry.device)
		h.mu.RUnlock()
		return cached, nil
	}
	h.mu.RUnlock()

	device, err := h.repo.GetByID(ctx, oltID)
	if err != nil {
		return nil, err
	}

	h.mu.Lock()
	h.cache[oltID] = &cachedOLT{
		device:    cloneOLT(device),
		expiredAt: now.Add(cacheTTL),
	}
	h.mu.Unlock()

	return cloneOLT(device), nil
}

func (h *ProxyHandler) markOffline(oltID, errMsg string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = h.repo.UpdateStatus(ctx, oltID, StatusOffline, errMsg)

	h.mu.Lock()
	if entry, ok := h.cache[oltID]; ok && entry.device != nil {
		entry.device.Status = StatusOffline
		if strings.TrimSpace(errMsg) == "" {
			entry.device.ErrorMessage = nil
		} else {
			errorMessage := errMsg
			entry.device.ErrorMessage = &errorMessage
		}
		entry.expiredAt = time.Now().Add(cacheTTL)
	}
	h.mu.Unlock()
}

func stripOLTPath(fullPath, oltID string) (string, error) {
	prefix := "/api/olt/" + oltID
	if !strings.HasPrefix(fullPath, prefix) {
		return "", fmt.Errorf("path %q does not match olt prefix", fullPath)
	}

	stripped := strings.TrimPrefix(fullPath, prefix)
	if stripped == "" {
		stripped = "/"
	}
	if !strings.HasPrefix(stripped, "/") {
		stripped = "/" + stripped
	}

	return stripped, nil
}

func buildProxyTargetURL(endpoint, strippedPath, rawQuery string) (*url.URL, error) {
	trimmedEndpoint := strings.TrimSpace(endpoint)
	if trimmedEndpoint == "" {
		return nil, errors.New("endpoint is empty")
	}

	if !strings.HasPrefix(trimmedEndpoint, "http://") && !strings.HasPrefix(trimmedEndpoint, "https://") {
		trimmedEndpoint = "http://" + trimmedEndpoint
	}

	baseURL, err := url.Parse(trimmedEndpoint)
	if err != nil {
		return nil, err
	}

	if !strings.HasPrefix(strippedPath, "/") {
		strippedPath = "/" + strippedPath
	}

	baseURL.Path = "/api/v1" + strippedPath
	baseURL.RawQuery = rawQuery
	return baseURL, nil
}

func firstPathSegment(path string) string {
	trimmed := strings.Trim(strings.TrimSpace(path), "/")
	if trimmed == "" {
		return ""
	}

	idx := strings.Index(trimmed, "/")
	if idx == -1 {
		return trimmed
	}

	return trimmed[:idx]
}

func copyHeaders(dst, src http.Header) {
	for key, values := range src {
		copied := append([]string(nil), values...)
		dst[key] = copied
	}
}

func removeHopByHopHeaders(header http.Header) {
	if connection := header.Get("Connection"); connection != "" {
		for _, token := range strings.Split(connection, ",") {
			if key := strings.TrimSpace(token); key != "" {
				header.Del(key)
			}
		}
	}

	for _, key := range hopByHopHeaders {
		header.Del(key)
	}
}

func cloneOLT(device *OLTDevice) *OLTDevice {
	if device == nil {
		return nil
	}

	cloned := *device
	if device.Location != nil {
		location := *device.Location
		cloned.Location = &location
	}
	if device.ErrorMessage != nil {
		errMsg := *device.ErrorMessage
		cloned.ErrorMessage = &errMsg
	}

	return &cloned
}
