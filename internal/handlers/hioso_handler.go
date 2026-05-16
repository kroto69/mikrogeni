package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"genieacs-backend/internal/db"

	"github.com/go-chi/chi/v5"
)

var hiosoEnabled atomic.Bool

func init() {
	hiosoEnabled.Store(os.Getenv("HIOSO_ENABLED") == "true")
}

func HiosoIsEnabled() bool     { return hiosoEnabled.Load() }
func HiosoSetEnabled(val bool) { hiosoEnabled.Store(val) }

// hiosoGuard cek apakah plugin aktif. Return false jika disabled (sudah tulis response).
func hiosoGuard(w http.ResponseWriter, _ *http.Request) bool {
	if !hiosoEnabled.Load() {
		pluginError(w, http.StatusServiceUnavailable, "Plugin Hioso tidak aktif. Aktifkan via POST /api/hioso/enable")
		return false
	}
	return true
}

// --- Handlers ---

func HiosoStatusHandler(w http.ResponseWriter, r *http.Request) {
	pluginJSON(w, map[string]interface{}{
		"enabled": HiosoIsEnabled(),
	})
}

func HiosoEnableHandler(w http.ResponseWriter, r *http.Request) {
	HiosoSetEnabled(true)
	pluginJSON(w, map[string]interface{}{"enabled": true})
}

func HiosoDisableHandler(w http.ResponseWriter, r *http.Request) {
	HiosoSetEnabled(false)
	pluginJSON(w, map[string]interface{}{"enabled": false})
}

func HiosoListDevicesHandler(w http.ResponseWriter, r *http.Request) {
	if !hiosoGuard(w, r) {
		return
	}
	devices, err := db.ListHiosoDevices()
	if err != nil {
		pluginError(w, http.StatusInternalServerError, "gagal list devices: "+err.Error())
		return
	}
	if devices == nil {
		devices = []db.HiosoDevice{}
	}
	pluginJSON(w, devices)
}

type hiosoCreateDeviceReq struct {
	Name         string `json:"name"`
	Host         string `json:"host"`
	Port         int    `json:"port"`
	Username     string `json:"username"`
	Password     string `json:"password"`
	FirmwareType int    `json:"firmware_type"` // 0 = HA7304VX (swcgi_xml), 1 = Other (legacy_html)
}

func HiosoCreateDeviceHandler(w http.ResponseWriter, r *http.Request) {
	if !hiosoGuard(w, r) {
		return
	}
	var req hiosoCreateDeviceReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		pluginError(w, http.StatusBadRequest, "body tidak valid")
		return
	}
	if strings.TrimSpace(req.Host) == "" || strings.TrimSpace(req.Username) == "" {
		pluginError(w, http.StatusBadRequest, "host dan username wajib diisi")
		return
	}
	if req.Port <= 0 {
		req.Port = 80
	}

	var fwType string
	switch req.FirmwareType {
	case 0:
		fwType = "swcgi_xml"
	case 1:
		fwType = "legacy_html"
	default:
		pluginError(w, http.StatusBadRequest, "firmware_type harus 0 (HA7304VX) atau 1 (Other)")
		return
	}

	id := fmt.Sprintf("hioso_%d", time.Now().UnixNano())
	device := db.HiosoDevice{
		ID:           id,
		Name:         req.Name,
		Host:         req.Host,
		Port:         req.Port,
		Username:     req.Username,
		Password:     req.Password,
		FirmwareType: fwType,
		Status:       "unknown",
	}
	if err := db.CreateHiosoDevice(device); err != nil {
		pluginError(w, http.StatusInternalServerError, "gagal simpan device: "+err.Error())
		return
	}
	pluginJSON(w, device)
}

func HiosoDeleteDeviceHandler(w http.ResponseWriter, r *http.Request) {
	if !hiosoGuard(w, r) {
		return
	}
	id := chi.URLParam(r, "id")
	if err := db.DeleteHiosoDevice(id); err != nil {
		pluginError(w, http.StatusInternalServerError, "gagal hapus device: "+err.Error())
		return
	}
	pluginJSON(w, map[string]interface{}{"deleted": true})
}

func HiosoTestDeviceHandler(w http.ResponseWriter, r *http.Request) {
	if !hiosoGuard(w, r) {
		return
	}
	id := chi.URLParam(r, "id")
	device, err := db.GetHiosoDeviceByID(id)
	if err != nil {
		pluginError(w, http.StatusNotFound, "device tidak ditemukan")
		return
	}
	fwType, err := HiosoDetectFirmware(device.Host, device.Port, device.Username, device.Password)
	if err != nil {
		_ = db.UpdateHiosoDeviceFirmware(id, device.FirmwareType, "offline")
		pluginError(w, http.StatusBadGateway, "gagal detect: "+err.Error())
		return
	}
	_ = db.UpdateHiosoDeviceFirmware(id, fwType, "online")
	pluginJSON(w, map[string]interface{}{"firmware_type": fwType, "status": "online"})
}

func HiosoHealthHandler(w http.ResponseWriter, r *http.Request) {
	if !hiosoGuard(w, r) {
		return
	}
	device, err := hiosoGetDevice(w, r)
	if err != nil {
		return
	}
	driver, err := HiosoNewDriver(device.FirmwareType, device.Host, device.Port, device.Username, device.Password)
	if err != nil {
		pluginError(w, http.StatusBadGateway, "gagal konek OLT: "+err.Error())
		return
	}
	defer driver.Close()
	info, err := driver.GetSystemInfo()
	if err != nil {
		pluginError(w, http.StatusBadGateway, "gagal ambil system info: "+err.Error())
		return
	}
	pluginJSON(w, info)
}

func HiosoFetchAllHandler(w http.ResponseWriter, r *http.Request) {
	if !hiosoGuard(w, r) {
		return
	}
	device, err := hiosoGetDevice(w, r)
	if err != nil {
		return
	}
	driver, err := HiosoNewDriver(device.FirmwareType, device.Host, device.Port, device.Username, device.Password)
	if err != nil {
		pluginError(w, http.StatusBadGateway, "gagal konek OLT: "+err.Error())
		return
	}
	defer driver.Close()

	portStr := r.URL.Query().Get("port")
	if portStr != "" {
		port, parseErr := strconv.Atoi(portStr)
		if parseErr != nil || port < 1 {
			pluginError(w, http.StatusBadRequest, "port tidak valid")
			return
		}
		onus, err := driver.ListONUByPort(port)
		if err != nil {
			pluginError(w, http.StatusBadGateway, "gagal ambil ONU: "+err.Error())
			return
		}
		if onus == nil {
			onus = []HiosoONU{}
		}
		pluginJSON(w, onus)
		return
	}

	onus, err := driver.ListAllONU()
	if err != nil {
		pluginError(w, http.StatusBadGateway, "gagal ambil ONU: "+err.Error())
		return
	}
	if onus == nil {
		onus = []HiosoONU{}
	}
	pluginJSON(w, onus)
}

func HiosoDetailHandler(w http.ResponseWriter, r *http.Request) {
	if !hiosoGuard(w, r) {
		return
	}
	device, err := hiosoGetDevice(w, r)
	if err != nil {
		return
	}
	portStr := r.URL.Query().Get("port")
	idStr := r.URL.Query().Get("id")
	if portStr == "" || idStr == "" {
		pluginError(w, http.StatusBadRequest, "port dan id wajib diisi (?port=3&id=1)")
		return
	}
	onuID := hiosoBuildOnuID(device.FirmwareType, portStr, idStr)
	driver, err := HiosoNewDriver(device.FirmwareType, device.Host, device.Port, device.Username, device.Password)
	if err != nil {
		pluginError(w, http.StatusBadGateway, "gagal konek OLT: "+err.Error())
		return
	}
	defer driver.Close()
	detail, err := driver.GetONUDetail(onuID)
	if err != nil {
		pluginError(w, http.StatusBadGateway, "gagal ambil detail ONU: "+err.Error())
		return
	}
	pluginJSON(w, detail)
}

type hiosoRenameReq struct {
	Name string `json:"name"`
}

func HiosoRenameHandler(w http.ResponseWriter, r *http.Request) {
	if !hiosoGuard(w, r) {
		return
	}
	device, err := hiosoGetDevice(w, r)
	if err != nil {
		return
	}
	portStr := r.URL.Query().Get("port")
	idStr := r.URL.Query().Get("id")
	if portStr == "" || idStr == "" {
		pluginError(w, http.StatusBadRequest, "port dan id wajib diisi (?port=3&id=1)")
		return
	}
	onuID := hiosoBuildOnuID(device.FirmwareType, portStr, idStr)
	var req hiosoRenameReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Name) == "" {
		pluginError(w, http.StatusBadRequest, "name wajib diisi")
		return
	}
	driver, err := HiosoNewDriver(device.FirmwareType, device.Host, device.Port, device.Username, device.Password)
	if err != nil {
		pluginError(w, http.StatusBadGateway, "gagal konek OLT: "+err.Error())
		return
	}
	defer driver.Close()
	if err := driver.RenameONU(onuID, req.Name); err != nil {
		pluginError(w, http.StatusBadGateway, "rename gagal: "+err.Error())
		return
	}
	pluginJSON(w, map[string]interface{}{"method": device.FirmwareType})
}

func HiosoRebootHandler(w http.ResponseWriter, r *http.Request) {
	if !hiosoGuard(w, r) {
		return
	}
	device, err := hiosoGetDevice(w, r)
	if err != nil {
		return
	}
	portStr := r.URL.Query().Get("port")
	idStr := r.URL.Query().Get("id")
	if portStr == "" || idStr == "" {
		pluginError(w, http.StatusBadRequest, "port dan id wajib diisi (?port=3&id=1)")
		return
	}
	onuID := hiosoBuildOnuID(device.FirmwareType, portStr, idStr)
	driver, err := HiosoNewDriver(device.FirmwareType, device.Host, device.Port, device.Username, device.Password)
	if err != nil {
		pluginError(w, http.StatusBadGateway, "gagal konek OLT: "+err.Error())
		return
	}
	defer driver.Close()
	if err := driver.RebootONU(onuID); err != nil {
		pluginError(w, http.StatusBadGateway, "reboot gagal: "+err.Error())
		return
	}
	pluginJSON(w, map[string]interface{}{"rebooted": true})
}

// hiosoGetDevice helper — ambil device dari DB berdasarkan URL param {id}
func hiosoGetDevice(w http.ResponseWriter, r *http.Request) (*db.HiosoDevice, error) {
	id := chi.URLParam(r, "id")
	if strings.TrimSpace(id) == "" {
		pluginError(w, http.StatusBadRequest, "device id wajib diisi")
		return nil, fmt.Errorf("no id")
	}
	device, err := db.GetHiosoDeviceByID(id)
	if err != nil || device == nil {
		pluginError(w, http.StatusNotFound, "device tidak ditemukan")
		return nil, fmt.Errorf("not found")
	}
	if device.FirmwareType == "" {
		pluginError(w, http.StatusBadRequest, "firmware belum terdeteksi, jalankan test dulu")
		return nil, fmt.Errorf("no firmware")
	}
	return device, nil
}
