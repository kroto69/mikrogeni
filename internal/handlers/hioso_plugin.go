package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"genieacs-backend/internal/db"
	"genieacs-backend/internal/models"

	"github.com/go-chi/chi/v5"
	"github.com/gosnmp/gosnmp"
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

type hiosoDevicePublic struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	Host          string    `json:"host"`
	Port          int       `json:"port"`
	SNMPVersion   string    `json:"snmp_version"`
	SNMPCommunity string    `json:"snmp_community"`
	WebHost       string    `json:"web_host"`
	WebPort       int       `json:"web_port"`
	Status        string    `json:"status"`
	Profile       string    `json:"profile"`
	LastError     string    `json:"last_error"`
	LastHealthAt  string    `json:"last_health_at"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

func toHiosoDevicePublic(d db.HiosoOLTDeviceRecord) hiosoDevicePublic {
	return hiosoDevicePublic{
		ID:            d.ID,
		Name:          d.Name,
		Host:          d.Host,
		Port:          d.Port,
		SNMPVersion:   d.SNMPVersion,
		SNMPCommunity: d.SNMPCommunity,
		WebHost:       d.WebHost,
		WebPort:       d.WebPort,
		Status:        d.Status,
		Profile:       d.Profile,
		LastError:     d.LastError,
		LastHealthAt:  d.LastHealthAt,
		CreatedAt:     hiosoParseDBTime(d.CreatedAt),
		UpdatedAt:     hiosoParseDBTime(d.UpdatedAt),
	}
}

func hiosoParseDBTime(raw string) time.Time {
	value := strings.TrimSpace(raw)
	if value == "" {
		return time.Time{}
	}

	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02 15:04:05.999999999-07:00",
		"2006-01-02 15:04:05.999999999",
		"2006-01-02 15:04:05",
	}

	for _, layout := range layouts {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed
		}
	}

	return time.Time{}
}

func HiosoRunHealthCheck(deviceID string, target SNMPTarget) {
	deviceID = strings.TrimSpace(deviceID)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	sysDescr, err := hiosoSNMPWalk(target, ".1.3.6.1.2.1.1.1")
	if ctx.Err() != nil || err != nil || !hiosoHasMeaningfulSNMPValues(sysDescr) {
		_ = db.UpdateHiosoOLTDeviceHealth(deviceID, "", "offline", "SNMP not reachable")
		log.Printf("[hioso-health] deviceID=%s status=%s", deviceID, "offline")
		return
	}

	profileName := "unknown"
	if profile, profileErr := hiosoGetOrDetectProfile(target); profileErr == nil && profile != nil && strings.TrimSpace(profile.Name) != "" {
		profileName = profile.Name
	}

	_ = db.UpdateHiosoOLTDeviceHealth(deviceID, profileName, "online", "")
	log.Printf("[hioso-health] deviceID=%s status=%s", deviceID, "online")
}

func HiosoParseSNMPVersion(raw string) gosnmp.SnmpVersion {
	return hiosoParseSNMPVersion(raw)
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

	cfg, err := hiosoSettingsFromRequest(r)
	if err != nil {
		hiosoError(w, http.StatusBadRequest, err.Error())
		return
	}
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

	cfg, err := hiosoSettingsFromRequest(r)
	if err != nil {
		hiosoError(w, http.StatusBadRequest, err.Error())
		return
	}
	target := cfg.ToSNMPTarget()
	if target.Host == "" || target.Community == "" {
		hiosoError(w, http.StatusBadRequest, "OLT_HOST/OLT_COMMUNITY belum diisi")
		return
	}

	port := 1
	if parsed, parseErr := strconv.Atoi(strings.TrimSpace(chi.URLParam(r, "port"))); parseErr == nil && parsed > 0 {
		port = parsed
	}

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	onus, _, err := FetchONUByPort(ctx, target, port)
	if ctx.Err() != nil {
		hiosoError(w, http.StatusGatewayTimeout, "request timeout")
		return
	}
	if err != nil {
		hiosoError(w, http.StatusBadGateway, err.Error())
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

	cfg, err := hiosoSettingsFromRequest(r)
	if err != nil {
		hiosoError(w, http.StatusBadRequest, err.Error())
		return
	}
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

	cfg, err := hiosoSettingsFromRequest(r)
	if err != nil {
		hiosoError(w, http.StatusBadRequest, err.Error())
		return
	}
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

	cfg, err := hiosoSettingsFromRequest(r)
	if err != nil {
		hiosoError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := HiosoRebootONU(cfg.WebHost, cfg.WebPort, index, cfg.Username, cfg.Password); err != nil {
		hiosoError(w, http.StatusBadGateway, err.Error())
		return
	}

	hiosoJSON(w, map[string]interface{}{
		"rebooted": true,
	})
}

func hiosoSettingsFromRequest(r *http.Request) (hiosoRuntimeSettings, error) {
	deviceID := chi.URLParam(r, "device_id")
	if strings.TrimSpace(deviceID) != "" {
		device, err := db.GetHiosoOLTDeviceByID(strings.TrimSpace(deviceID))
		if err != nil {
			return hiosoRuntimeSettings{}, err
		}
		if device == nil {
			return hiosoRuntimeSettings{}, fmt.Errorf("device %s not found", deviceID)
		}
		return hiosoDeviceToSettings(*device), nil
	}
	return hiosoLoadRuntimeSettings(), nil
}

func hiosoDeviceToSettings(d db.HiosoOLTDeviceRecord) hiosoRuntimeSettings {
	return hiosoRuntimeSettings{
		Host:      d.Host,
		Port:      strconv.Itoa(d.Port),
		Version:   d.SNMPVersion,
		Community: d.SNMPCommunity,
		WebHost:   d.WebHost,
		WebPort:   strconv.Itoa(d.WebPort),
		Username:  d.Username,
		Password:  d.Password,
	}
}

func HiosoListDevicesHandler(w http.ResponseWriter, r *http.Request) {
	devices, err := db.ListHiosoOLTDevices()
	if err != nil {
		hiosoError(w, http.StatusInternalServerError, "gagal list devices: "+err.Error())
		return
	}
	result := make([]hiosoDevicePublic, 0, len(devices))
	for _, device := range devices {
		result = append(result, toHiosoDevicePublic(device))
	}
	hiosoJSON(w, result)
}

func HiosoGetDeviceHandler(w http.ResponseWriter, r *http.Request) {
	deviceID := chi.URLParam(r, "device_id")
	device, err := db.GetHiosoOLTDeviceByID(strings.TrimSpace(deviceID))
	if err != nil {
		hiosoError(w, http.StatusInternalServerError, "gagal get device: "+err.Error())
		return
	}
	if device == nil {
		hiosoError(w, http.StatusNotFound, "device tidak ditemukan")
		return
	}
	hiosoJSON(w, toHiosoDevicePublic(*device))
}

func HiosoCreateDeviceHandler(w http.ResponseWriter, r *http.Request) {
	var req models.HiosoOLTDeviceCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		hiosoError(w, http.StatusBadRequest, "body JSON tidak valid")
		return
	}
	if strings.TrimSpace(req.Host) == "" {
		hiosoError(w, http.StatusBadRequest, "host wajib diisi")
		return
	}
	if strings.TrimSpace(req.SNMPCommunity) == "" {
		req.SNMPCommunity = "public"
	}

	record := db.HiosoOLTDeviceRecord{
		Name:          strings.TrimSpace(req.Name),
		Host:          strings.TrimSpace(req.Host),
		Port:          req.Port,
		SNMPVersion:   strings.TrimSpace(req.SNMPVersion),
		SNMPCommunity: strings.TrimSpace(req.SNMPCommunity),
		WebHost:       strings.TrimSpace(req.WebHost),
		WebPort:       req.WebPort,
		Username:      strings.TrimSpace(req.Username),
		Password:      req.Password,
	}
	if strings.TrimSpace(req.ID) != "" {
		record.ID = strings.TrimSpace(req.ID)
	}

	result, err := db.CreateHiosoOLTDevice(record)
	if err != nil {
		hiosoError(w, http.StatusInternalServerError, "gagal create device: "+err.Error())
		return
	}

	target := SNMPTarget{
		Host:      result.Host,
		Port:      hiosoParseSNMPPort(strconv.Itoa(result.Port)),
		Community: result.SNMPCommunity,
		Version:   hiosoParseSNMPVersion(result.SNMPVersion),
	}
	go HiosoRunHealthCheck(result.ID, target)

	w.WriteHeader(http.StatusCreated)
	hiosoJSON(w, toHiosoDevicePublic(*result))
}

func HiosoUpdateDeviceHandler(w http.ResponseWriter, r *http.Request) {
	deviceID := chi.URLParam(r, "device_id")
	existing, err := db.GetHiosoOLTDeviceByID(strings.TrimSpace(deviceID))
	if err != nil {
		hiosoError(w, http.StatusInternalServerError, "gagal get device: "+err.Error())
		return
	}
	if existing == nil {
		hiosoError(w, http.StatusNotFound, "device tidak ditemukan")
		return
	}

	var req models.HiosoOLTDeviceUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		hiosoError(w, http.StatusBadRequest, "body JSON tidak valid")
		return
	}

	if req.Name != nil {
		existing.Name = strings.TrimSpace(*req.Name)
	}
	if req.Host != nil {
		existing.Host = strings.TrimSpace(*req.Host)
	}
	if req.Port != nil {
		existing.Port = *req.Port
	}
	if req.SNMPVersion != nil {
		existing.SNMPVersion = strings.TrimSpace(*req.SNMPVersion)
	}
	if req.SNMPCommunity != nil {
		existing.SNMPCommunity = strings.TrimSpace(*req.SNMPCommunity)
	}
	if req.WebHost != nil {
		existing.WebHost = strings.TrimSpace(*req.WebHost)
	}
	if req.WebPort != nil {
		existing.WebPort = *req.WebPort
	}
	if req.Username != nil {
		existing.Username = strings.TrimSpace(*req.Username)
	}
	if req.Password != nil {
		existing.Password = *req.Password
	}

	result, err := db.UpdateHiosoOLTDevice(*existing)
	if err != nil {
		hiosoError(w, http.StatusInternalServerError, "gagal update device: "+err.Error())
		return
	}
	hiosoJSON(w, toHiosoDevicePublic(*result))
}

func HiosoDeleteDeviceHandler(w http.ResponseWriter, r *http.Request) {
	deviceID := chi.URLParam(r, "device_id")
	if err := db.DeleteHiosoOLTDevice(strings.TrimSpace(deviceID)); err != nil {
		hiosoError(w, http.StatusInternalServerError, "gagal delete device: "+err.Error())
		return
	}
	hiosoJSON(w, map[string]interface{}{"deleted": true})
}

func HiosoTestDeviceHandler(w http.ResponseWriter, r *http.Request) {
	deviceID := chi.URLParam(r, "device_id")
	cfg, err := hiosoSettingsFromRequest(r)
	if err != nil {
		hiosoError(w, http.StatusBadRequest, err.Error())
		return
	}
	target := cfg.ToSNMPTarget()
	if target.Host == "" || target.Community == "" {
		hiosoError(w, http.StatusBadRequest, "host/community belum diisi")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	sysDescr, err := hiosoSNMPWalk(target, ".1.3.6.1.2.1.1.1")
	if ctx.Err() != nil {
		db.UpdateHiosoOLTDeviceHealth(strings.TrimSpace(deviceID), "", "offline", "timeout")
		hiosoError(w, http.StatusGatewayTimeout, "request timeout")
		return
	}
	if err != nil || !hiosoHasMeaningfulSNMPValues(sysDescr) {
		profileName := ""
		if p, pErr := hiosoGetOrDetectProfile(target); pErr == nil {
			profileName = p.Name
		}
		db.UpdateHiosoOLTDeviceHealth(strings.TrimSpace(deviceID), profileName, "offline", "SNMP not reachable")
		hiosoJSON(w, map[string]interface{}{
			"online": false,
			"detail": "OLT tidak reachable via SNMP",
		})
		return
	}

	profileName := "unknown"
	if p, pErr := hiosoGetOrDetectProfile(target); pErr == nil {
		profileName = p.Name
	}
	db.UpdateHiosoOLTDeviceHealth(strings.TrimSpace(deviceID), profileName, "online", "")

	hiosoJSON(w, map[string]interface{}{
		"online":  true,
		"detail":  "OLT reachable, profil: " + profileName,
		"profile": profileName,
	})
}

func HiosoPortsHandler(w http.ResponseWriter, r *http.Request) {
	if !hiosoGuard(w, r) {
		return
	}
	hiosoJSON(w, []int{1, 2, 3, 4})
}
