package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"genieacs-backend/internal/db"

	"github.com/go-chi/chi/v5"
)

var hiosoEnabled atomic.Bool

func init() {
	hiosoEnabled.Store(os.Getenv("HIOSO_ENABLED") == "true")
}

func HiosoSetEnabled(val bool) { hiosoStore(val) }
func HiosoIsEnabled() bool     { return hiosoEnabled.Load() }
func hiosoStore(val bool)      { hiosoEnabled.Store(val) }

type hiosoRuntimeSettings struct {
	Host      string
	Port      string
	Version   string
	Community string
	WebHost   string
	WebPort   string
	Username  string
	Password  string
}

var (
	hiosoSettingsCacheMux  sync.RWMutex
	hiosoSettingsCache      hiosoRuntimeSettings
	hiosoSettingsCachedAt   time.Time
	hiosoSettingsCacheTTL   = 30 * time.Second
)

func hiosoInvalidateSettingsCache() {
	hiosoSettingsCacheMux.Lock()
	hiosoSettingsCachedAt = time.Time{}
	hiosoSettingsCacheMux.Unlock()
}

func hiosoLoadRuntimeSettings() hiosoRuntimeSettings {
	hiosoSettingsCacheMux.RLock()
	if time.Since(hiosoSettingsCachedAt) < hiosoSettingsCacheTTL && !hiosoSettingsCachedAt.IsZero() {
		cached := hiosoSettingsCache
		hiosoSettingsCacheMux.RUnlock()
		return cached
	}
	hiosoSettingsCacheMux.RUnlock()

	hiosoSettingsCacheMux.Lock()
	defer hiosoSettingsCacheMux.Unlock()

	if time.Since(hiosoSettingsCachedAt) < hiosoSettingsCacheTTL && !hiosoSettingsCachedAt.IsZero() {
		return hiosoSettingsCache
	}

	cfg := hiosoLoadRuntimeSettingsFresh()
	hiosoSettingsCache = cfg
	hiosoSettingsCachedAt = time.Now()
	return cfg
}

func hiosoLoadRuntimeSettingsFresh() hiosoRuntimeSettings {
	cfg := hiosoRuntimeSettings{
		Host:      strings.TrimSpace(os.Getenv("OLT_HOST")),
		Port:      strings.TrimSpace(os.Getenv("OLT_PORT")),
		Version:   strings.TrimSpace(os.Getenv("OLT_SNMP_VERSION")),
		Community: strings.TrimSpace(os.Getenv("OLT_COMMUNITY")),
		WebHost:   strings.TrimSpace(os.Getenv("OLT_WEB_HOST")),
		WebPort:   strings.TrimSpace(os.Getenv("OLT_WEB_PORT")),
		Username:  strings.TrimSpace(os.Getenv("OLT_WEB_USER")),
		Password:  os.Getenv("OLT_WEB_PASS"),
	}

	keys := []string{
		"plugin_host",
		"plugin_port",
		"plugin_web_host",
		"plugin_web_port",
		"plugin_snmp_version",
		"plugin_snmp_community",
		"plugin_community",
		"plugin_username",
		"plugin_password",
	}
	settings, err := db.GetSettings(keys)
	if err == nil {
		if v := strings.TrimSpace(settings["plugin_host"]); v != "" {
			cfg.Host = v
		}
		if v := strings.TrimSpace(settings["plugin_port"]); v != "" {
			cfg.Port = v
		}
		if v := strings.TrimSpace(settings["plugin_web_host"]); v != "" {
			cfg.WebHost = v
		}
		if v := strings.TrimSpace(settings["plugin_web_port"]); v != "" {
			cfg.WebPort = v
		}
		if v := strings.TrimSpace(settings["plugin_snmp_version"]); v != "" {
			cfg.Version = v
		}
		if v := strings.TrimSpace(settings["plugin_snmp_community"]); v != "" {
			cfg.Community = v
		} else if v := strings.TrimSpace(settings["plugin_community"]); v != "" {
			cfg.Community = v
		}
		if v := strings.TrimSpace(settings["plugin_username"]); v != "" {
			cfg.Username = v
		}
		if v := settings["plugin_password"]; strings.TrimSpace(v) != "" {
			cfg.Password = v
		}
	}

	if active, err := hiosoResolveActiveOLTProfile(); err == nil && active != nil {
		cfg.Host = active.Host
		cfg.Port = active.Port
		cfg.Version = active.SNMPVersion
		cfg.Community = active.SNMPCommunity
		cfg.WebHost = active.WebHost
		cfg.WebPort = active.WebPort
		cfg.Username = active.Username
		if strings.TrimSpace(active.Password) != "" {
			cfg.Password = active.Password
		}
	}

	if cfg.Port == "" {
		cfg.Port = "161"
	}
	if cfg.Version == "" {
		cfg.Version = "2c"
	}
	if cfg.WebHost == "" {
		cfg.WebHost = cfg.Host
	}
	if cfg.WebPort == "" {
		cfg.WebPort = "80"
	}

	return cfg
}

func (s hiosoRuntimeSettings) ToSNMPTarget() SNMPTarget {
	return SNMPTarget{
		Host:      strings.TrimSpace(s.Host),
		Port:      hiosoParseSNMPPort(s.Port),
		Community: strings.TrimSpace(s.Community),
		Version:   hiosoParseSNMPVersion(s.Version),
	}
}

func hiosoGuard(w http.ResponseWriter, r *http.Request) bool {
	if r.Method == http.MethodPost {
		path := strings.TrimRight(r.URL.Path, "/")
		if path == "/api/plugin/hioso/enable" || path == "/api/plugin/hioso/disable" {
			return true
		}
	}

	if !hiosoEnabled.Load() {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Plugin Hioso tidak aktif. Aktifkan via POST /api/plugin/hioso/enable",
			"data":    nil,
		})
		return false
	}
	return true
}

func hiosoJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    data,
		"error":   "",
	})
}

func hiosoError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": false,
		"data":    nil,
		"error":   msg,
	})
}

func HiosoStatusHandler(w http.ResponseWriter, r *http.Request) {
	cfg := hiosoLoadRuntimeSettings()
	hiosoJSON(w, map[string]interface{}{
		"enabled": HiosoIsEnabled(),
		"host":    cfg.Host,
	})
}

func HiosoEnableHandler(w http.ResponseWriter, r *http.Request) {
	hiosoStore(true)
	hiosoInvalidateSettingsCache()
	cfg := hiosoLoadRuntimeSettings()
	hiosoJSON(w, map[string]interface{}{
		"enabled": true,
		"host":    cfg.Host,
	})
}

func HiosoDisableHandler(w http.ResponseWriter, r *http.Request) {
	hiosoStore(false)
	hiosoInvalidateSettingsCache()
	cfg := hiosoLoadRuntimeSettings()
	hiosoJSON(w, map[string]interface{}{
		"enabled": false,
		"host":    cfg.Host,
	})
}

func HiosoHealthHandler(w http.ResponseWriter, r *http.Request) {
	if !hiosoGuard(w, r) {
		return
	}

	cfg := hiosoLoadRuntimeSettings()
	target := cfg.ToSNMPTarget()
	if target.Host == "" || target.Community == "" {
		hiosoError(w, http.StatusBadRequest, "OLT_HOST/OLT_COMMUNITY belum diisi")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	sysDescr, err := hiosoSNMPWalk(target, ".1.3.6.1.2.1.1.1")
	if ctx.Err() != nil {
		hiosoError(w, http.StatusGatewayTimeout, "request timeout")
		return
	}
	if err != nil || !hiosoHasMeaningfulSNMPValues(sysDescr) {
		hiosoJSON(w, map[string]interface{}{
			"online": false,
			"detail": "OLT tidak reachable via SNMP",
		})
		return
	}

	detail := "OLT reachable"
	if profile, profileErr := hiosoGetOrDetectProfile(target); profileErr == nil {
		detail = "OLT reachable, profil: " + profile.Name
	}

	hiosoJSON(w, map[string]interface{}{
		"online": true,
		"detail": detail,
	})
}

func HiosoFetchAllHandler(w http.ResponseWriter, r *http.Request) {
	if !hiosoGuard(w, r) {
		return
	}

	cfg := hiosoLoadRuntimeSettings()
	target := cfg.ToSNMPTarget()
	if target.Host == "" || target.Community == "" {
		hiosoError(w, http.StatusBadRequest, "OLT_HOST/OLT_COMMUNITY belum diisi")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	onus, _, err := FetchAllONU(ctx, target)
	if ctx.Err() != nil {
		hiosoError(w, http.StatusGatewayTimeout, "request timeout")
		return
	}
	if err != nil {
		hiosoError(w, http.StatusBadGateway, err.Error())
		return
	}

	portFilter := strings.TrimSpace(r.URL.Query().Get("port"))
	if portFilter != "" {
		portNum, parseErr := strconv.Atoi(portFilter)
		if parseErr != nil {
			hiosoError(w, http.StatusBadRequest, "port harus berupa angka")
			return
		}
		filtered := make([]HiosoONU, 0, len(onus))
		for _, onu := range onus {
			if onu.Port == portNum {
				filtered = append(filtered, onu)
			}
		}
		hiosoJSON(w, filtered)
		return
	}

	hiosoJSON(w, onus)
}

func HiosoDetailHandler(w http.ResponseWriter, r *http.Request) {
	if !hiosoGuard(w, r) {
		return
	}

	index := strings.TrimSpace(chi.URLParam(r, "index"))
	if index == "" {
		hiosoError(w, http.StatusBadRequest, "index ONU wajib diisi")
		return
	}

	cfg := hiosoLoadRuntimeSettings()
	target := cfg.ToSNMPTarget()
	if target.Host == "" || target.Community == "" {
		hiosoError(w, http.StatusBadRequest, "OLT_HOST/OLT_COMMUNITY belum diisi")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	onu, err := FetchONUByIndex(ctx, target, index)
	if ctx.Err() != nil {
		hiosoError(w, http.StatusGatewayTimeout, "request timeout")
		return
	}
	if err != nil {
		hiosoError(w, http.StatusBadGateway, err.Error())
		return
	}
	hiosoJSON(w, onu)
}

type hiosoRenameRequest struct {
	Name string `json:"name"`
}

func HiosoRenameHandler(w http.ResponseWriter, r *http.Request) {
	if !hiosoGuard(w, r) {
		return
	}

	index := strings.TrimSpace(chi.URLParam(r, "index"))
	if index == "" {
		hiosoError(w, http.StatusBadRequest, "index ONU wajib diisi")
		return
	}

	var req hiosoRenameRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		hiosoError(w, http.StatusBadRequest, "body JSON tidak valid")
		return
	}
	newName := strings.TrimSpace(req.Name)
	if newName == "" {
		hiosoError(w, http.StatusBadRequest, "name wajib diisi")
		return
	}

	cfg := hiosoLoadRuntimeSettings()
	target := cfg.ToSNMPTarget()

	method, err := HiosoRenameONU(target, cfg.WebHost, cfg.WebPort, index, newName, cfg.Username, cfg.Password)
	if err != nil {
		hiosoError(w, http.StatusBadGateway, err.Error())
		return
	}

	hiosoJSON(w, map[string]interface{}{
		"method": method,
	})
}

func HiosoRebootHandler(w http.ResponseWriter, r *http.Request) {
	if !hiosoGuard(w, r) {
		return
	}

	index := strings.TrimSpace(chi.URLParam(r, "index"))
	if index == "" {
		hiosoError(w, http.StatusBadRequest, "index ONU wajib diisi")
		return
	}

	cfg := hiosoLoadRuntimeSettings()

	if err := HiosoRebootONU(cfg.WebHost, cfg.WebPort, index, cfg.Username, cfg.Password); err != nil {
		hiosoError(w, http.StatusBadGateway, err.Error())
		return
	}

	hiosoJSON(w, map[string]interface{}{
		"rebooted": true,
	})
}

func HiosoPortsHandler(w http.ResponseWriter, r *http.Request) {
	if !hiosoGuard(w, r) {
		return
	}

	cfg := hiosoLoadRuntimeSettings()
	target := cfg.ToSNMPTarget()
	if target.Host == "" || target.Community == "" {
		hiosoError(w, http.StatusBadRequest, "OLT_HOST/OLT_COMMUNITY belum diisi")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	onus, _, err := FetchAllONU(ctx, target)
	if ctx.Err() != nil {
		hiosoError(w, http.StatusGatewayTimeout, "request timeout")
		return
	}
	if err != nil {
		hiosoError(w, http.StatusBadGateway, err.Error())
		return
	}

	portSet := make(map[int]struct{})
	for _, onu := range onus {
		if onu.Port > 0 {
			portSet[onu.Port] = struct{}{}
		}
	}

	ports := make([]int, 0, len(portSet))
	for p := range portSet {
		ports = append(ports, p)
	}
	sort.Ints(ports)

	hiosoJSON(w, ports)
}