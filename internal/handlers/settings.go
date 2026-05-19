package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"genieacs-backend/internal/acsresolver"
	"genieacs-backend/internal/db"
	"genieacs-backend/internal/models"
)

type acsLearnedProfileUpsertRequest struct {
	Vendor       string `json:"vendor"`
	ProductClass string `json:"product_class"`
	ProfileKey   string `json:"profile_key"`
	Score        int    `json:"score"`
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
	logActivity(r, "update_setting", req.Key, "", "")
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
