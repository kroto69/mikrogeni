package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"genieacs-backend/internal/db"

	"github.com/go-chi/chi/v5"
)

// State plugin
var hiosoEnabled = os.Getenv("HIOSO_ENABLED") == "true"

func HiosoSetEnabled(val bool) { hiosoEnabled = val }
func HiosoIsEnabled() bool     { return hiosoEnabled }

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

func hiosoLoadRuntimeSettings() hiosoRuntimeSettings {
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

// hiosoGuard - cek enable, return false + tulis response jika disabled.
func hiosoGuard(w http.ResponseWriter, r *http.Request) bool {
	path := strings.TrimSpace(r.URL.Path)
	if strings.HasSuffix(path, "/enable") || strings.HasSuffix(path, "/disable") {
		return true
	}

	if !hiosoEnabled {
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

// Helper response sukses.
func hiosoJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    data,
		"error":   "",
	})
}

// Helper response error.
func hiosoError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": false,
		"data":    nil,
		"error":   msg,
	})
}

// HiosoStatusHandler menampilkan status enable plugin dan host OLT.
func HiosoStatusHandler(w http.ResponseWriter, r *http.Request) {
	cfg := hiosoLoadRuntimeSettings()
	hiosoJSON(w, map[string]interface{}{
		"enabled": HiosoIsEnabled(),
		"host":    cfg.Host,
	})
}

// HiosoEnableHandler mengaktifkan plugin secara runtime.
func HiosoEnableHandler(w http.ResponseWriter, r *http.Request) {
	if !hiosoGuard(w, r) {
		// Sesuai kontrak: semua handler selain status wajib guard dulu.
		return
	}
	HiosoSetEnabled(true)
	cfg := hiosoLoadRuntimeSettings()
	hiosoJSON(w, map[string]interface{}{
		"enabled": true,
		"host":    cfg.Host,
	})
}

// HiosoDisableHandler mematikan plugin secara runtime.
func HiosoDisableHandler(w http.ResponseWriter, r *http.Request) {
	if !hiosoGuard(w, r) {
		return
	}
	HiosoSetEnabled(false)
	cfg := hiosoLoadRuntimeSettings()
	hiosoJSON(w, map[string]interface{}{
		"enabled": false,
		"host":    cfg.Host,
	})
}

// HiosoHealthHandler mengecek konektivitas OLT via walk sysDescr.
func HiosoHealthHandler(w http.ResponseWriter, r *http.Request) {
	if !hiosoGuard(w, r) {
		return
	}

	cfg := hiosoLoadRuntimeSettings()
	host := strings.TrimSpace(cfg.Host)
	community := strings.TrimSpace(cfg.Community)
	if host == "" || community == "" {
		hiosoError(w, http.StatusBadRequest, "OLT_HOST/OLT_COMMUNITY belum diisi")
		return
	}

	sysDescr, err := hiosoSNMPWalk(host, community, ".1.3.6.1.2.1.1.1")
	if err != nil || !hiosoHasMeaningfulSNMPValues(sysDescr) {
		hiosoJSON(w, map[string]interface{}{
			"online": false,
			"detail": "OLT tidak reachable via SNMP",
		})
		return
	}

	detail := "OLT reachable"
	if profile, profileErr := hiosoDetectProfile(host, community); profileErr == nil {
		detail = "OLT reachable, profil: " + profile.Name
	}

	hiosoJSON(w, map[string]interface{}{
		"online": true,
		"detail": detail,
	})
}

// HiosoFetchAllHandler mengambil semua ONU dari OLT.
func HiosoFetchAllHandler(w http.ResponseWriter, r *http.Request) {
	if !hiosoGuard(w, r) {
		return
	}

	cfg := hiosoLoadRuntimeSettings()
	host := strings.TrimSpace(cfg.Host)
	community := strings.TrimSpace(cfg.Community)
	if host == "" || community == "" {
		hiosoError(w, http.StatusBadRequest, "OLT_HOST/OLT_COMMUNITY belum diisi")
		return
	}

	onus, _, err := FetchAllONU(host, community)
	if err != nil {
		hiosoError(w, http.StatusBadGateway, err.Error())
		return
	}
	hiosoJSON(w, onus)
}

// HiosoDetailHandler mengambil detail satu ONU berdasarkan index.
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
	host := strings.TrimSpace(cfg.Host)
	community := strings.TrimSpace(cfg.Community)
	if host == "" || community == "" {
		hiosoError(w, http.StatusBadRequest, "OLT_HOST/OLT_COMMUNITY belum diisi")
		return
	}

	onus, _, err := FetchAllONU(host, community)
	if err != nil {
		hiosoError(w, http.StatusBadGateway, err.Error())
		return
	}

	for _, onu := range onus {
		if strings.TrimSpace(onu.Index) == index {
			hiosoJSON(w, onu)
			return
		}
	}

	hiosoError(w, http.StatusNotFound, "ONU tidak ditemukan")
}

type hiosoRenameRequest struct {
	Name string `json:"name"`
}

// HiosoRenameHandler rename ONU menggunakan SNMP dulu lalu fallback web.
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
	host := strings.TrimSpace(cfg.Host)
	community := strings.TrimSpace(cfg.Community)
	user := strings.TrimSpace(cfg.Username)
	pass := cfg.Password

	webHost := strings.TrimSpace(cfg.WebHost)
	webPort := strings.TrimSpace(cfg.WebPort)

	method, err := HiosoRenameONU(host, community, webHost, webPort, index, newName, user, pass)
	if err != nil {
		hiosoError(w, http.StatusBadGateway, err.Error())
		return
	}

	hiosoJSON(w, map[string]interface{}{
		"method": method,
	})
}

// HiosoRebootHandler reboot ONU via Web API.
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
	host := strings.TrimSpace(cfg.WebHost)
	webPort := strings.TrimSpace(cfg.WebPort)
	user := strings.TrimSpace(cfg.Username)
	pass := cfg.Password

	if err := HiosoRebootONU(host, webPort, index, user, pass); err != nil {
		hiosoError(w, http.StatusBadGateway, err.Error())
		return
	}

	hiosoJSON(w, map[string]interface{}{
		"rebooted": true,
	})
}
