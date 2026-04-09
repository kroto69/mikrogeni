package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"genieacs-backend/internal/db"
	"genieacs-backend/internal/models"

	"github.com/go-chi/chi/v5"
)

func CheckWAN(w http.ResponseWriter, r *http.Request) {
	deviceID := r.URL.Query().Get("device_id")
	if deviceID == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Device ID is required"})
		return
	}

	genieACSURL, err := getGenieACSURL()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to resolve GenieACS URL", Detail: err.Error()})
		return
	}

	projection := []string{
		"_id",
		"_lastInform",
		"InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ConnectionStatus",
		"InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ConnectionStatus",
	}

	device, err := fetchGenieACSDeviceByID(genieACSURL, deviceID, projection)
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to fetch WAN status", Detail: err.Error()})
		return
	}

	if device == nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Device not found"})
		return
	}

	wanStatus := "unknown"
	if rawStatus, ok := extractValueByKey(device, "ConnectionStatus"); ok {
		statusText := strings.TrimSpace(strings.ToLower(extractStringValue(rawStatus)))
		if statusText != "" {
			wanStatus = statusText
		}
	}

	if wanStatus == "unknown" {
		if lastInform, ok := parseLastInform(device); ok && time.Since(lastInform) <= 10*time.Minute {
			wanStatus = "active"
		} else {
			wanStatus = "inactive"
		}
	}

	connectionType := "unknown"
	searchText := deviceSearchText(device)
	if strings.Contains(searchText, "wanpppconnection") || strings.Contains(searchText, "pppoe") {
		connectionType = "ppp"
	} else if strings.Contains(searchText, "wanipconnection") {
		connectionType = "ip"
	}

	lastInform := ""
	if parsed, ok := parseLastInform(device); ok {
		lastInform = parsed.UTC().Format(time.RFC3339)
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"device_id":       deviceID,
		"wan_status":      wanStatus,
		"connection_type": connectionType,
		"last_inform":     lastInform,
	})
}

func CheckGPONEPON(w http.ResponseWriter, r *http.Request) {
	deviceID := r.URL.Query().Get("device_id")
	if deviceID == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Device ID is required"})
		return
	}

	genieACSURL, err := getGenieACSURL()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to resolve GenieACS URL", Detail: err.Error()})
		return
	}

	projection := []string{
		"_id",
		"_lastInform",
		"_deviceId._ProductClass",
		"_virtualParameters.rxPower.value",
		"_virtualParameters.opticalRxPower.value",
		"InternetGatewayDevice.WANDevice.1.X_GponInterfaceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.RxPower",
		"InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.OpticalRxPower",
		"InternetGatewayDevice.WANDevice.2.X_ZTE-COM_WANPONInterfaceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.2.X_ZTE-COM_WANPONInterfaceConfig.RxPower",
		"InternetGatewayDevice.WANDevice.2.X_ZTE-COM_WANPONInterfaceConfig.OpticalRxPower",
	}

	device, err := fetchGenieACSDeviceByID(genieACSURL, deviceID, projection)
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to fetch GPON/EPON status", Detail: err.Error()})
		return
	}

	if device == nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Device not found"})
		return
	}

	deviceType := "gpon"
	if productClass, ok := extractValueByKey(device, "_ProductClass"); ok {
		if strings.Contains(strings.ToLower(extractStringValue(productClass)), "epon") {
			deviceType = "epon"
		}
	}

	status := "offline"
	if lastInform, ok := parseLastInform(device); ok && time.Since(lastInform) <= 10*time.Minute {
		status = "online"
	}

	signalStrength := interface{}(nil)
	if rxPower, ok := extractRXPowerFromDevice(device); ok {
		signalStrength = rxPower
	} else if fullDevice, err := fetchGenieACSDeviceByID(genieACSURL, deviceID, nil); err == nil && fullDevice != nil {
		if fallbackRXPower, ok := extractRXPowerFromDevice(fullDevice); ok {
			signalStrength = fallbackRXPower
		}
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"device_id":       deviceID,
		"type":            deviceType,
		"status":          status,
		"signal_strength": signalStrength,
	})
}

func GetFaults(w http.ResponseWriter, r *http.Request) {
	deviceID := r.URL.Query().Get("device_id")
	if deviceID == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Device ID is required"})
		return
	}

	faults, err := db.GetFaults(deviceID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to fetch faults"})
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(faults)
}

func DeleteFault(w http.ResponseWriter, r *http.Request) {
	faultID := strings.TrimSpace(chi.URLParam(r, "id"))
	if faultID == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Fault ID path parameter is required"})
		return
	}

	id, err := strconv.Atoi(faultID)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Invalid fault ID"})
		return
	}

	if err := db.DeleteFault(id); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to delete fault", Detail: err.Error()})
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(models.SuccessResponse{Success: true, Message: "Fault deleted successfully"})
}
