package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"genieacs-backend/internal/db"
	"genieacs-backend/internal/models"
)

func ValidateAccessCode(w http.ResponseWriter, r *http.Request) {
	var req map[string]string
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Invalid request body"})
		return
	}

	accessCode := strings.TrimSpace(req["accesscode"])
	if accessCode == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Access code is required"})
		return
	}

	settings, err := db.GetSettings([]string{"portal_access_code", "portal_access_codes", "portal_access_map", "portal_default_device_id"})
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to load portal settings", Detail: err.Error()})
		return
	}

	valid := false
	deviceID := strings.TrimSpace(settings["portal_default_device_id"])

	singleCode := strings.TrimSpace(settings["portal_access_code"])
	if singleCode != "" && accessCode == singleCode {
		valid = true
	}

	if !valid {
		multiCodesRaw := strings.TrimSpace(settings["portal_access_codes"])
		if multiCodesRaw != "" {
			var codes []string
			if err := json.Unmarshal([]byte(multiCodesRaw), &codes); err == nil {
				for _, code := range codes {
					if strings.TrimSpace(code) == accessCode {
						valid = true
						break
					}
				}
			} else {
				for _, code := range strings.Split(multiCodesRaw, ",") {
					if strings.TrimSpace(code) == accessCode {
						valid = true
						break
					}
				}
			}
		}
	}

	accessMapRaw := strings.TrimSpace(settings["portal_access_map"])
	if accessMapRaw != "" {
		var accessMap map[string]string
		if err := json.Unmarshal([]byte(accessMapRaw), &accessMap); err == nil {
			if mappedDeviceID, ok := accessMap[accessCode]; ok {
				valid = true
				if strings.TrimSpace(mappedDeviceID) != "" {
					deviceID = strings.TrimSpace(mappedDeviceID)
				}
			}
		}
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{"valid": valid, "device_id": deviceID})
}

func SearchDevice(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if query == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Search query is required"})
		return
	}

	genieACSURL, err := getGenieACSURL()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to resolve GenieACS URL", Detail: err.Error()})
		return
	}

	projection := []string{"_id", "_deviceId._ProductClass", "_deviceId._SerialNumber", "_tags", "_lastInform"}
	devices, err := fetchGenieACSDevices(genieACSURL, projection, "")
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to search devices", Detail: err.Error()})
		return
	}

	searchTerm := strings.ToLower(query)
	results := make([]map[string]interface{}, 0)
	for _, device := range devices {
		if strings.Contains(deviceSearchText(device), searchTerm) {
			results = append(results, device)
		}
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(results)
}
