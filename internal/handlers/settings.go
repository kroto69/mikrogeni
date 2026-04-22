package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"genieacs-backend/internal/acsresolver"
	"genieacs-backend/internal/db"
	"genieacs-backend/internal/models"

	"github.com/go-chi/chi/v5"
)

const (
	hiosoOLTProfilesSettingKey = "plugin_hioso_olts"
	hiosoActiveOLTIDSettingKey = "plugin_hioso_active_olt_id"
)

type hiosoOLTProfile struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Host          string `json:"host"`
	Port          string `json:"port"`
	WebHost       string `json:"web_host"`
	WebPort       string `json:"web_port"`
	SNMPVersion   string `json:"snmp_version"`
	SNMPCommunity string `json:"snmp_community"`
	Username      string `json:"username"`
	Password      string `json:"password"`
}

type hiosoOLTProfileCreateRequest struct {
	Name          string `json:"name"`
	Host          string `json:"host"`
	Port          string `json:"port"`
	WebHost       string `json:"web_host"`
	WebPort       string `json:"web_port"`
	SNMPVersion   string `json:"snmp_version"`
	SNMPCommunity string `json:"snmp_community"`
	Username      string `json:"username"`
	Password      string `json:"password"`
}

type hiosoOLTProfilePatchRequest struct {
	Name          *string `json:"name"`
	Host          *string `json:"host"`
	Port          *string `json:"port"`
	WebHost       *string `json:"web_host"`
	WebPort       *string `json:"web_port"`
	SNMPVersion   *string `json:"snmp_version"`
	SNMPCommunity *string `json:"snmp_community"`
	Username      *string `json:"username"`
	Password      *string `json:"password"`
}

type hiosoOLTProfilesResponse struct {
	Profiles []hiosoOLTProfile `json:"profiles"`
	ActiveID string            `json:"active_id"`
}

type acsLearnedProfileUpsertRequest struct {
	Vendor       string `json:"vendor"`
	ProductClass string `json:"product_class"`
	ProfileKey   string `json:"profile_key"`
	Score        int    `json:"score"`
}

func hiosoNormalizePort(raw string, defaultValue string) (string, error) {
	v := strings.TrimSpace(raw)
	if v == "" {
		return defaultValue, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return "", err
	}
	if n < 1 || n > 65535 {
		return "", errors.New("port out of range")
	}
	return strconv.Itoa(n), nil
}

func hiosoNormalizeSNMPVersion(raw string) string {
	v := strings.TrimSpace(strings.ToLower(raw))
	if v == "" {
		return "2c"
	}
	if v == "1" || v == "2c" || v == "3" {
		return v
	}
	return ""
}

func hiosoNormalizeProfile(profile hiosoOLTProfile) (hiosoOLTProfile, error) {
	profile.ID = strings.TrimSpace(profile.ID)
	profile.Name = strings.TrimSpace(profile.Name)
	profile.Host = strings.TrimSpace(profile.Host)
	profile.WebHost = strings.TrimSpace(profile.WebHost)
	profile.SNMPCommunity = strings.TrimSpace(profile.SNMPCommunity)
	profile.Username = strings.TrimSpace(profile.Username)
	profile.Password = strings.TrimSpace(profile.Password)

	if profile.Host == "" {
		return hiosoOLTProfile{}, strconv.ErrSyntax
	}
	if profile.SNMPCommunity == "" {
		return hiosoOLTProfile{}, strconv.ErrSyntax
	}

	port, err := hiosoNormalizePort(profile.Port, "161")
	if err != nil {
		return hiosoOLTProfile{}, err
	}
	webPort, err := hiosoNormalizePort(profile.WebPort, "80")
	if err != nil {
		return hiosoOLTProfile{}, err
	}

	version := hiosoNormalizeSNMPVersion(profile.SNMPVersion)
	if version == "" {
		return hiosoOLTProfile{}, strconv.ErrSyntax
	}

	profile.Port = port
	profile.WebPort = webPort
	profile.SNMPVersion = version
	if profile.WebHost == "" {
		profile.WebHost = profile.Host
	}

	return profile, nil
}

func hiosoLoadProfiles() ([]hiosoOLTProfile, error) {
	raw, err := db.GetSetting(hiosoOLTProfilesSettingKey)
	if err != nil {
		return nil, err
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return []hiosoOLTProfile{}, nil
	}

	var profiles []hiosoOLTProfile
	if err := json.Unmarshal([]byte(raw), &profiles); err != nil {
		return nil, err
	}

	normalized := make([]hiosoOLTProfile, 0, len(profiles))
	for _, item := range profiles {
		if strings.TrimSpace(item.ID) == "" {
			continue
		}
		p, err := hiosoNormalizeProfile(item)
		if err != nil {
			continue
		}
		normalized = append(normalized, p)
	}

	return normalized, nil
}

func hiosoSaveProfiles(profiles []hiosoOLTProfile) error {
	b, err := json.Marshal(profiles)
	if err != nil {
		return err
	}
	return db.SetSetting(hiosoOLTProfilesSettingKey, string(b))
}

func hiosoLoadActiveProfileID() (string, error) {
	v, err := db.GetSetting(hiosoActiveOLTIDSettingKey)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(v), nil
}

func hiosoSetActiveProfileID(id string) error {
	return db.SetSetting(hiosoActiveOLTIDSettingKey, strings.TrimSpace(id))
}

func hiosoFindProfileByID(profiles []hiosoOLTProfile, id string) (int, *hiosoOLTProfile) {
	id = strings.TrimSpace(id)
	for i := range profiles {
		if profiles[i].ID == id {
			return i, &profiles[i]
		}
	}
	return -1, nil
}

func hiosoMirrorProfileToLegacySettings(profile hiosoOLTProfile) error {
	profile, err := hiosoNormalizeProfile(profile)
	if err != nil {
		return err
	}

	legacyPairs := map[string]string{
		"plugin_host":           profile.Host,
		"plugin_port":           profile.Port,
		"plugin_web_host":       profile.WebHost,
		"plugin_web_port":       profile.WebPort,
		"plugin_snmp_version":   profile.SNMPVersion,
		"plugin_snmp_community": profile.SNMPCommunity,
		"plugin_community":      profile.SNMPCommunity,
		"plugin_username":       profile.Username,
		"plugin_password":       profile.Password,
	}

	for k, v := range legacyPairs {
		if err := db.SetSetting(k, v); err != nil {
			return err
		}
	}

	return nil
}

func hiosoResolveActiveOLTProfile() (*hiosoOLTProfile, error) {
	activeID, err := hiosoLoadActiveProfileID()
	if err != nil {
		return nil, err
	}
	if activeID == "" {
		return nil, nil
	}

	profiles, err := hiosoLoadProfiles()
	if err != nil {
		return nil, err
	}

	_, profile := hiosoFindProfileByID(profiles, activeID)
	if profile == nil {
		return nil, nil
	}

	return profile, nil
}

func GetHiosoOLTProfiles(w http.ResponseWriter, r *http.Request) {
	profiles, err := hiosoLoadProfiles()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to load Hioso OLT profiles", Detail: err.Error()})
		return
	}

	activeID, err := hiosoLoadActiveProfileID()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to load active Hioso OLT profile", Detail: err.Error()})
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(hiosoOLTProfilesResponse{Profiles: profiles, ActiveID: activeID})
}

func CreateHiosoOLTProfile(w http.ResponseWriter, r *http.Request) {
	var req hiosoOLTProfileCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Invalid request body"})
		return
	}

	profile, err := hiosoNormalizeProfile(hiosoOLTProfile{
		ID:            strconv.FormatInt(time.Now().UnixNano(), 36),
		Name:          req.Name,
		Host:          req.Host,
		Port:          req.Port,
		WebHost:       req.WebHost,
		WebPort:       req.WebPort,
		SNMPVersion:   req.SNMPVersion,
		SNMPCommunity: req.SNMPCommunity,
		Username:      req.Username,
		Password:      req.Password,
	})
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Invalid Hioso OLT profile payload"})
		return
	}

	profiles, err := hiosoLoadProfiles()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to load Hioso OLT profiles", Detail: err.Error()})
		return
	}

	profiles = append(profiles, profile)
	if err := hiosoSaveProfiles(profiles); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to save Hioso OLT profile", Detail: err.Error()})
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(profile)
}

func UpdateHiosoOLTProfile(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	if id == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Profile id is required"})
		return
	}

	var req hiosoOLTProfilePatchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Invalid request body"})
		return
	}

	profiles, err := hiosoLoadProfiles()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to load Hioso OLT profiles", Detail: err.Error()})
		return
	}

	idx, profile := hiosoFindProfileByID(profiles, id)
	if profile == nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Hioso OLT profile not found"})
		return
	}

	updated := *profile
	if req.Name != nil {
		updated.Name = *req.Name
	}
	if req.Host != nil {
		updated.Host = *req.Host
	}
	if req.Port != nil {
		updated.Port = *req.Port
	}
	if req.WebHost != nil {
		updated.WebHost = *req.WebHost
	}
	if req.WebPort != nil {
		updated.WebPort = *req.WebPort
	}
	if req.SNMPVersion != nil {
		updated.SNMPVersion = *req.SNMPVersion
	}
	if req.SNMPCommunity != nil {
		updated.SNMPCommunity = *req.SNMPCommunity
	}
	if req.Username != nil {
		updated.Username = *req.Username
	}
	if req.Password != nil {
		updated.Password = *req.Password
	}

	updated, err = hiosoNormalizeProfile(updated)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Invalid Hioso OLT profile payload"})
		return
	}

	profiles[idx] = updated
	if err := hiosoSaveProfiles(profiles); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to update Hioso OLT profile", Detail: err.Error()})
		return
	}

	activeID, err := hiosoLoadActiveProfileID()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to load active Hioso OLT profile", Detail: err.Error()})
		return
	}
	if activeID == updated.ID {
		if err := hiosoMirrorProfileToLegacySettings(updated); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to mirror active Hioso OLT profile", Detail: err.Error()})
			return
		}
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(updated)
}

func DeleteHiosoOLTProfile(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	if id == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Profile id is required"})
		return
	}

	profiles, err := hiosoLoadProfiles()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to load Hioso OLT profiles", Detail: err.Error()})
		return
	}

	idx, _ := hiosoFindProfileByID(profiles, id)
	if idx < 0 {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Hioso OLT profile not found"})
		return
	}

	profiles = append(profiles[:idx], profiles[idx+1:]...)
	if err := hiosoSaveProfiles(profiles); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to delete Hioso OLT profile", Detail: err.Error()})
		return
	}

	activeID, err := hiosoLoadActiveProfileID()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to load active Hioso OLT profile", Detail: err.Error()})
		return
	}
	if activeID == id {
		if err := hiosoSetActiveProfileID(""); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to clear active Hioso OLT profile", Detail: err.Error()})
			return
		}
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(models.SuccessResponse{Success: true, Message: "Hioso OLT profile deleted"})
}

func ActivateHiosoOLTProfile(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	if id == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Profile id is required"})
		return
	}

	profiles, err := hiosoLoadProfiles()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to load Hioso OLT profiles", Detail: err.Error()})
		return
	}

	_, profile := hiosoFindProfileByID(profiles, id)
	if profile == nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Hioso OLT profile not found"})
		return
	}

	if err := hiosoMirrorProfileToLegacySettings(*profile); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to mirror active Hioso OLT profile", Detail: err.Error()})
		return
	}
	if err := hiosoSetActiveProfileID(id); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to activate Hioso OLT profile", Detail: err.Error()})
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(models.SuccessResponse{Success: true, Message: "Hioso OLT profile activated"})
}

func GetSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := db.GetAllSettings()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to fetch settings"})
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(settings)
}

func UpdateSetting(w http.ResponseWriter, r *http.Request) {
	var req models.SettingsUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Invalid request body"})
		return
	}

	if req.Key == "" || req.Value == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Key and value are required"})
		return
	}

	if err := db.SetSetting(req.Key, req.Value); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to update setting"})
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(models.SuccessResponse{Success: true, Message: "Setting updated successfully"})
}

func GetACSLearnedProfiles(w http.ResponseWriter, r *http.Request) {
	items, err := db.ListACSLearnedProfiles()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to fetch ACS learned profiles", Detail: err.Error()})
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(items)
}

func UpsertACSLearnedProfile(w http.ResponseWriter, r *http.Request) {
	var req acsLearnedProfileUpsertRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Invalid request body"})
		return
	}

	req.Vendor = strings.TrimSpace(req.Vendor)
	req.ProductClass = strings.TrimSpace(req.ProductClass)
	req.ProfileKey = strings.TrimSpace(req.ProfileKey)
	if req.Vendor == "" || req.ProductClass == "" || req.ProfileKey == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "vendor, product_class, and profile_key are required"})
		return
	}
	if !acsresolver.HasProfileKey(req.ProfileKey) {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Unknown profile_key"})
		return
	}
	if req.Score < 0 {
		req.Score = 0
	}

	if err := db.UpsertACSLearnedProfile(req.Vendor, req.ProductClass, req.ProfileKey, req.Score); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to save ACS learned profile", Detail: err.Error()})
		return
	}
	acsresolver.ForgetLearnedProfile(req.Vendor, req.ProductClass)

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(models.SuccessResponse{Success: true, Message: "ACS learned profile saved"})
}

func DeleteACSLearnedProfile(w http.ResponseWriter, r *http.Request) {
	vendor := strings.TrimSpace(r.URL.Query().Get("vendor"))
	productClass := strings.TrimSpace(r.URL.Query().Get("product_class"))
	if vendor == "" || productClass == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "vendor and product_class are required"})
		return
	}

	if err := db.DeleteACSLearnedProfile(vendor, productClass); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to delete ACS learned profile", Detail: err.Error()})
		return
	}
	acsresolver.ForgetLearnedProfile(vendor, productClass)

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(models.SuccessResponse{Success: true, Message: "ACS learned profile deleted"})
}

func ConfigureWiFi(w http.ResponseWriter, r *http.Request) {
	var req map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Invalid request body"})
		return
	}

	if err := persistConfig("config_wifi", req); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to persist WiFi configuration", Detail: err.Error()})
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(models.SuccessResponse{Success: true, Message: "WiFi configuration saved"})
}

func ConfigureWAN(w http.ResponseWriter, r *http.Request) {
	var req map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Invalid request body"})
		return
	}

	if err := persistConfig("config_wan", req); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to persist WAN configuration", Detail: err.Error()})
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(models.SuccessResponse{Success: true, Message: "WAN configuration saved"})
}

func ConfigureSecurity(w http.ResponseWriter, r *http.Request) {
	var req map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Invalid request body"})
		return
	}

	if err := persistConfig("config_security", req); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to persist security configuration", Detail: err.Error()})
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(models.SuccessResponse{Success: true, Message: "Security configuration saved"})
}
