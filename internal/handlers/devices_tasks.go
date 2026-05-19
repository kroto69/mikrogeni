package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"genieacs-backend/internal/db"
	"genieacs-backend/internal/models"
	"genieacs-backend/internal/services"

	"github.com/go-chi/chi/v5"
)

type bulkRefreshDevicesRequest struct {
	DeviceIDs  []string `json:"device_ids"`
	ObjectName string   `json:"object_name,omitempty"`
}

func RebootDevice(w http.ResponseWriter, r *http.Request) {
	deviceID := strings.TrimSpace(chi.URLParam(r, "id"))
	if deviceID == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Device ID path parameter is required"})
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to read request body"})
		return
	}

	if len(strings.TrimSpace(string(body))) > 0 {
		var req models.RebootDeviceRequest
		if err := json.Unmarshal(body, &req); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Invalid request body"})
			return
		}

		if req.DeviceID != "" && req.DeviceID != deviceID {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Path device ID and body device_id do not match"})
			return
		}
	}

	genieACSURL, err := getGenieACSURL()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to resolve GenieACS URL", Detail: err.Error()})
		return
	}

	taskStatus, err := services.GetGenieACSService().EnqueueTask(genieACSURL, deviceID, map[string]interface{}{"name": "reboot"})
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to enqueue reboot command", Detail: err.Error()})
		return
	}

	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":   true,
		"message":   "Reboot command queued",
		"device_id": deviceID,
		"task":      taskStatus,
	})
	logActivity(r, "reboot_onu", deviceID, "ACS", "")
}

func RefreshACSDevices(w http.ResponseWriter, r *http.Request) {
	var req bulkRefreshDevicesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Invalid request body"})
		return
	}

	deviceIDs := make([]string, 0, len(req.DeviceIDs))
	seen := make(map[string]struct{}, len(req.DeviceIDs))
	for _, id := range req.DeviceIDs {
		trimmed := strings.TrimSpace(id)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		deviceIDs = append(deviceIDs, trimmed)
	}

	if len(deviceIDs) == 0 {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "device_ids is required"})
		return
	}
	if len(deviceIDs) > 200 {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "device_ids exceeds limit 200 per request"})
		return
	}

	genieACSURL, err := getGenieACSURL()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to resolve GenieACS URL", Detail: err.Error()})
		return
	}

	objectName := strings.TrimSpace(req.ObjectName)
	objectNames := defaultACSRefreshObjects()
	if objectName != "" {
		objectNames = []string{objectName}
	}
	results := make([]map[string]interface{}, 0, len(deviceIDs))
	queued := 0
	for _, deviceID := range deviceIDs {
		queuedCount, failedCount := enqueueACSRefreshTargets(genieACSURL, deviceID, objectNames)
		if queuedCount == 0 && failedCount > 0 {
			results = append(results, map[string]interface{}{
				"device_id": deviceID,
				"success":   false,
				"error":     "failed to enqueue refresh tasks",
			})
			continue
		}

		queued += queuedCount
		results = append(results, map[string]interface{}{
			"device_id": deviceID,
			"success":   true,
			"queued":    queuedCount,
			"targets":   objectNames,
		})
	}

	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      queued > 0,
		"message":      "ACS targeted refresh queued",
		"object_names": objectNames,
		"queued_count": queued,
		"total_count":  len(deviceIDs),
		"results":      results,
	})
}

func applyDeviceParameterUpdate(w http.ResponseWriter, deviceID string, parameters []deviceParameterInput, successMessage string) {
	parameterValues, err := buildSetParameterValues(parameters)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Invalid parameter payload", Detail: err.Error()})
		return
	}

	genieACSURL, err := getGenieACSURL()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to resolve GenieACS URL", Detail: err.Error()})
		return
	}

	payload := map[string]interface{}{
		"name":            "setParameterValues",
		"parameterValues": parameterValues,
	}

	taskStatus, err := services.GetGenieACSService().EnqueueTask(genieACSURL, deviceID, payload)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to enqueue device configuration", Detail: err.Error()})
		return
	}

	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":         true,
		"message":         successMessage,
		"device_id":       deviceID,
		"parameter_count": len(parameterValues),
		"task":            taskStatus,
	})
}

func GetTaskStatus(w http.ResponseWriter, r *http.Request) {
	taskID := strings.TrimSpace(chi.URLParam(r, "id"))
	if taskID == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Task ID is required"})
		return
	}

	taskStatus, ok := services.GetGenieACSService().GetTaskStatus(taskID)
	if ok {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(taskStatus)
		return
	}

	mikrotikTaskStatus, ok := services.GetMikroTikService().GetTaskStatus(taskID)
	if !ok {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Task not found"})
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(mikrotikTaskStatus)
}

func ConfigureDeviceParameters(w http.ResponseWriter, r *http.Request) {
	deviceID := resolveDeviceID(r)
	if deviceID == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Device ID is required"})
		return
	}

	var req deviceParametersRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Invalid request body"})
		return
	}

	if len(req.Parameters) == 0 {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "At least one parameter is required"})
		return
	}

	pppoeUsername, pppoePassword, wifiPasswords := extractCredentialHintsFromParameters(req.Parameters)
	_ = db.UpsertDeviceCredentials(deviceID, pppoeUsername, pppoePassword, wifiPasswords)

	applyDeviceParameterUpdate(w, deviceID, req.Parameters, "Device parameters update dispatched")
}

func ConfigureDeviceWiFi(w http.ResponseWriter, r *http.Request) {
	deviceID := resolveDeviceID(r)
	if deviceID == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Device ID is required"})
		return
	}

	var req deviceWiFiConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Invalid request body"})
		return
	}

	parameters := make([]deviceParameterInput, 0, len(req.Parameters)+30)
	if req.SSID2G != nil {
		parameters = append(parameters, deviceParameterInput{Name: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", Value: *req.SSID2G, Type: "xsd:string"})
	}
	if req.Password2G != nil {
		parameters = append(parameters, deviceParameterInput{Name: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase", Value: *req.Password2G, Type: "xsd:string"})
	}
	if req.Enabled2G != nil {
		parameters = append(parameters, deviceParameterInput{Name: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Enable", Value: *req.Enabled2G, Type: "xsd:boolean"})
	}
	if req.SSID5G != nil {
		parameters = append(parameters, deviceParameterInput{Name: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.SSID", Value: *req.SSID5G, Type: "xsd:string"})
	}
	if req.Password5G != nil {
		parameters = append(parameters, deviceParameterInput{Name: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.PreSharedKey.1.KeyPassphrase", Value: *req.Password5G, Type: "xsd:string"})
	}
	if req.Enabled5G != nil {
		parameters = append(parameters, deviceParameterInput{Name: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.Enable", Value: *req.Enabled5G, Type: "xsd:boolean"})
	}

	appendIndexedWiFiParameters := func(index string, ssid *string, password *string, enabled *bool, hide *bool) {
		basePath := "InternetGatewayDevice.LANDevice.1.WLANConfiguration." + index
		if ssid != nil {
			parameters = append(parameters, deviceParameterInput{Name: basePath + ".SSID", Value: *ssid, Type: "xsd:string"})
		}
		if password != nil {
			parameters = append(parameters, deviceParameterInput{Name: basePath + ".PreSharedKey.1.KeyPassphrase", Value: *password, Type: "xsd:string"})
		}
		if enabled != nil {
			parameters = append(parameters, deviceParameterInput{Name: basePath + ".Enable", Value: *enabled, Type: "xsd:boolean"})
		}
		if hide != nil {
			parameters = append(parameters, deviceParameterInput{Name: basePath + ".SSIDAdvertisementEnabled", Value: !*hide, Type: "xsd:boolean"})
		}
	}

	appendIndexedWiFiParameters("1", req.SSID1, req.Password1, req.Enabled1, req.Hide1)
	appendIndexedWiFiParameters("2", req.SSID2, req.Password2, req.Enabled2, req.Hide2)
	appendIndexedWiFiParameters("3", req.SSID3, req.Password3, req.Enabled3, req.Hide3)
	appendIndexedWiFiParameters("4", req.SSID4, req.Password4, req.Enabled4, req.Hide4)
	appendIndexedWiFiParameters("5", req.SSID5, req.Password5, req.Enabled5, req.Hide5)
	appendIndexedWiFiParameters("6", req.SSID6, req.Password6, req.Enabled6, req.Hide6)
	appendIndexedWiFiParameters("7", req.SSID7, req.Password7, req.Enabled7, req.Hide7)
	appendIndexedWiFiParameters("8", req.SSID8, req.Password8, req.Enabled8, req.Hide8)

	if len(req.Parameters) > 0 {
		parameters = append(parameters, req.Parameters...)
	}

	if len(parameters) == 0 {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "No WiFi fields or parameters provided"})
		return
	}

	wifiPasswords := make(map[string]string)
	if req.Password2G != nil && strings.TrimSpace(*req.Password2G) != "" {
		wifiPasswords["index:1"] = strings.TrimSpace(*req.Password2G)
	}
	if req.Password5G != nil && strings.TrimSpace(*req.Password5G) != "" {
		password5g := strings.TrimSpace(*req.Password5G)
		wifiPasswords["index:2"] = password5g
		wifiPasswords["index:5"] = password5g
	}
	indexedPasswords := map[string]*string{
		"1": req.Password1,
		"2": req.Password2,
		"3": req.Password3,
		"4": req.Password4,
		"5": req.Password5,
		"6": req.Password6,
		"7": req.Password7,
		"8": req.Password8,
	}
	for index, password := range indexedPasswords {
		if password != nil && strings.TrimSpace(*password) != "" {
			wifiPasswords["index:"+index] = strings.TrimSpace(*password)
		}
	}
	_, _, parameterWiFiPasswords := extractCredentialHintsFromParameters(parameters)
	for key, value := range parameterWiFiPasswords {
		wifiPasswords[key] = value
	}
	_ = db.UpsertDeviceCredentials(deviceID, nil, nil, wifiPasswords)

	applyDeviceParameterUpdate(w, deviceID, parameters, "Device WiFi configuration dispatched")
	logActivity(r, "config_wifi", deviceID, "ACS", "")
}

func ConfigureDeviceWAN(w http.ResponseWriter, r *http.Request) {
	deviceID := resolveDeviceID(r)
	if deviceID == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Device ID is required"})
		return
	}

	var req deviceWANConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Invalid request body"})
		return
	}

	parameters := make([]deviceParameterInput, 0, len(req.Parameters)+4)
	if req.PPPoEUsername != nil {
		parameters = append(parameters, deviceParameterInput{Name: "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username", Value: *req.PPPoEUsername, Type: "xsd:string"})
	}
	if req.PPPoEPassword != nil {
		parameters = append(parameters, deviceParameterInput{Name: "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Password", Value: *req.PPPoEPassword, Type: "xsd:string"})
	}
	if req.NATEnabled != nil {
		parameters = append(parameters, deviceParameterInput{Name: "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.NATEnabled", Value: *req.NATEnabled, Type: "xsd:boolean"})
	}
	if req.MTU != nil {
		parameters = append(parameters, deviceParameterInput{Name: "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.MaxMRUSize", Value: *req.MTU, Type: "xsd:int"})
	}

	if len(req.Parameters) > 0 {
		parameters = append(parameters, req.Parameters...)
	}

	if len(parameters) == 0 {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "No WAN fields or parameters provided"})
		return
	}

	pppoeUsername, pppoePassword, _ := extractCredentialHintsFromParameters(parameters)
	if req.PPPoEUsername != nil {
		pppoeUsername = nonEmptyStringPointer(*req.PPPoEUsername)
	}
	if req.PPPoEPassword != nil {
		pppoePassword = nonEmptyStringPointer(*req.PPPoEPassword)
	}
	_ = db.UpsertDeviceCredentials(deviceID, pppoeUsername, pppoePassword, nil)

	applyDeviceParameterUpdate(w, deviceID, parameters, "Device WAN configuration dispatched")
	logActivity(r, "config_wan", deviceID, "ACS", "")
}

func ConfigureDeviceSecurity(w http.ResponseWriter, r *http.Request) {
	deviceID := resolveDeviceID(r)
	if deviceID == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Device ID is required"})
		return
	}

	var req deviceParametersRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Invalid request body"})
		return
	}

	if len(req.Parameters) == 0 {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Security configuration is vendor-specific, provide parameters[] with explicit TR-069 paths"})
		return
	}

	applyDeviceParameterUpdate(w, deviceID, req.Parameters, "Device security configuration dispatched")
	logActivity(r, "config_security", deviceID, "ACS", "")
}
