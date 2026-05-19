package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"genieacs-backend/internal/db"
	"genieacs-backend/internal/models"
	"genieacs-backend/internal/services"

	"github.com/go-chi/chi/v5"
)

func GetMikroTikDevices(w http.ResponseWriter, r *http.Request) {
	statusFilter := strings.TrimSpace(r.URL.Query().Get("status"))
	siteFilter := strings.TrimSpace(r.URL.Query().Get("site"))
	rosMajorFilter := 0
	if raw := strings.TrimSpace(r.URL.Query().Get("ros_major")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "invalid ros_major filter"})
			return
		}
		rosMajorFilter = parsed
	}

	devices, err := db.ListMikroTikDevices(statusFilter, siteFilter, rosMajorFilter)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to list mikrotik devices", Detail: err.Error()})
		return
	}

	response := make([]map[string]interface{}, 0, len(devices))
	for _, device := range devices {
		response = append(response, sanitizeMikroTikDevice(device))
	}

	_ = json.NewEncoder(w).Encode(response)
}

func CreateMikroTikDevice(w http.ResponseWriter, r *http.Request) {
	var request models.MikroTikDeviceCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "invalid request body", Detail: err.Error()})
		return
	}

	request.Name = strings.TrimSpace(request.Name)
	request.ID = strings.TrimSpace(request.ID)
	request.Host = strings.TrimSpace(request.Host)
	request.Username = strings.TrimSpace(request.Username)

	if request.Name == "" || request.Host == "" || request.Username == "" || strings.TrimSpace(request.Password) == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "name, host, username, and password are required"})
		return
	}
	if request.ID != "" && !isValidMikroTikDeviceID(request.ID) {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "invalid id format (allowed: a-z, A-Z, 0-9, '-', '_', '.')"})
		return
	}

	created, err := db.CreateMikroTikDevice(db.MikroTikDeviceRecord{
		ID:            request.ID,
		Name:          request.Name,
		Host:          request.Host,
		Port:          request.Port,
		Username:      request.Username,
		Password:      request.Password,
		UseTLS:        request.UseTLS,
		SkipTLSVerify: request.SkipTLSVerify,
		Site:          strings.TrimSpace(request.Site),
		Tags:          normalizeStringSlice(request.Tags),
		Status:        "unknown",
	})
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to create mikrotik device", Detail: err.Error()})
		return
	}

	logActivity(r, "create_mikrotik_device", created.Host, "", created.Name)
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(sanitizeMikroTikDevice(*created))
}

func GetMikroTikDevice(w http.ResponseWriter, r *http.Request) {
	deviceID := strings.TrimSpace(chi.URLParam(r, "device_id"))
	if deviceID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "device_id is required"})
		return
	}

	device, err := db.GetMikroTikDeviceByID(deviceID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to fetch mikrotik device", Detail: err.Error()})
		return
	}
	if device == nil {
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "mikrotik device not found"})
		return
	}

	facts := map[string]interface{}{}
	syncErrorMessage := ""
	if strings.TrimSpace(r.URL.Query().Get("cached")) != "1" {
		syncedFacts, syncErr := services.GetMikroTikService().SyncDevice(deviceID)
		if syncErr == nil {
			facts = syncedFacts
		} else {
			syncErrorMessage = syncErr.Error()
		}
	}

	if refreshed, refreshErr := db.GetMikroTikDeviceByID(deviceID); refreshErr == nil && refreshed != nil {
		device = refreshed
	}

	identity := firstNonEmptyMikroTik(
		strings.TrimSpace(asString(facts["identity"])),
		strings.TrimSpace(device.Name),
	)

	modelType := strings.TrimSpace(asString(facts["model_type"]))
	if modelType == "" {
		routerboardModel := strings.TrimSpace(asString(facts["routerboard_model"]))
		boardName := strings.TrimSpace(asString(facts["board_name"]))
		if routerboardModel != "" && boardName != "" && !strings.EqualFold(routerboardModel, boardName) {
			modelType = routerboardModel + " · " + boardName
		} else {
			modelType = firstNonEmptyMikroTik(routerboardModel, boardName, strings.TrimSpace(asString(facts["model"])))
		}
	}

	rosVersion := formatROSVersionLabel(firstNonEmptyMikroTik(
		strings.TrimSpace(asString(facts["ros_version"])),
		strings.TrimSpace(device.ROSVersion),
	))

	response := map[string]interface{}{
		"device_id":     device.ID,
		"identity":      identity,
		"ros_version":   rosVersion,
		"model_type":    modelType,
		"management_ip": strings.TrimSpace(device.Host),
		"uptime":        formatMikroTikUptime(strings.TrimSpace(asString(facts["uptime"]))),
		"cpu_load":      formatCPULoad(strings.TrimSpace(asString(facts["cpu_load"]))),
		"free_memory":   formatMemoryUsage(strings.TrimSpace(asString(facts["free_memory"])), strings.TrimSpace(asString(facts["total_memory"]))),
	}
	if syncErrorMessage != "" {
		response["sync_error"] = syncErrorMessage
	}

	_ = json.NewEncoder(w).Encode(response)
}

func UpdateMikroTikDevice(w http.ResponseWriter, r *http.Request) {
	deviceID := strings.TrimSpace(chi.URLParam(r, "device_id"))
	if deviceID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "device_id is required"})
		return
	}

	current, err := db.GetMikroTikDeviceByID(deviceID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to fetch mikrotik device", Detail: err.Error()})
		return
	}
	if current == nil {
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "mikrotik device not found"})
		return
	}

	var request models.MikroTikDeviceUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "invalid request body", Detail: err.Error()})
		return
	}

	updated := *current
	if request.Name != nil {
		updated.Name = strings.TrimSpace(*request.Name)
	}
	if request.Host != nil {
		updated.Host = strings.TrimSpace(*request.Host)
	}
	if request.Port != nil {
		updated.Port = *request.Port
	}
	if request.Username != nil {
		updated.Username = strings.TrimSpace(*request.Username)
	}
	if request.Password != nil {
		updated.Password = *request.Password
	}
	if request.UseTLS != nil {
		updated.UseTLS = *request.UseTLS
	}
	if request.SkipTLSVerify != nil {
		updated.SkipTLSVerify = *request.SkipTLSVerify
	}
	if request.Site != nil {
		updated.Site = strings.TrimSpace(*request.Site)
	}
	if request.Tags != nil {
		updated.Tags = normalizeStringSlice(request.Tags)
	}

	if updated.Name == "" || updated.Host == "" || updated.Username == "" || strings.TrimSpace(updated.Password) == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "name, host, username, and password must not be empty"})
		return
	}

	saved, err := db.UpdateMikroTikDevice(updated)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to update mikrotik device", Detail: err.Error()})
		return
	}

	_ = json.NewEncoder(w).Encode(sanitizeMikroTikDevice(*saved))
}

func DeleteMikroTikDevice(w http.ResponseWriter, r *http.Request) {
	deviceID := strings.TrimSpace(chi.URLParam(r, "device_id"))
	if deviceID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "device_id is required"})
		return
	}

	if err := db.DeleteMikroTikDevice(deviceID); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to delete mikrotik device", Detail: err.Error()})
		return
	}

	logActivity(r, "delete_mikrotik_device", deviceID, "", "")
	_ = json.NewEncoder(w).Encode(models.SuccessResponse{Success: true, Message: "MikroTik device deleted"})
}

func TestMikroTikConnection(w http.ResponseWriter, r *http.Request) {
	deviceID := strings.TrimSpace(chi.URLParam(r, "device_id"))
	if deviceID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "device_id is required"})
		return
	}

	result, err := services.GetMikroTikService().TestConnection(deviceID)
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to connect to mikrotik", Detail: err.Error()})
		return
	}

	_ = json.NewEncoder(w).Encode(result)
}

func SyncMikroTikDevice(w http.ResponseWriter, r *http.Request) {
	deviceID := strings.TrimSpace(chi.URLParam(r, "device_id"))
	if deviceID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "device_id is required"})
		return
	}

	result, err := services.GetMikroTikService().SyncDevice(deviceID)
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to sync mikrotik device", Detail: err.Error()})
		return
	}

	_ = json.NewEncoder(w).Encode(result)
}

func GetMikroTikInterfaces(w http.ResponseWriter, r *http.Request) {
	deviceID := strings.TrimSpace(chi.URLParam(r, "device_id"))
	if deviceID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "device_id is required"})
		return
	}

	rows, err := services.GetMikroTikService().ListInterfaces(deviceID)
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to fetch interfaces", Detail: err.Error()})
		return
	}

	_ = json.NewEncoder(w).Encode(rows)
}

func GetMikroTikInterfaceTraffic(w http.ResponseWriter, r *http.Request) {
	deviceID := strings.TrimSpace(chi.URLParam(r, "device_id"))
	interfaceID := strings.TrimSpace(chi.URLParam(r, "interface_id"))
	if deviceID == "" || interfaceID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "device_id and interface_id are required"})
		return
	}

	traffic, err := services.GetMikroTikService().GetInterfaceTraffic(deviceID, interfaceID)
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to fetch interface traffic", Detail: err.Error()})
		return
	}

	_ = json.NewEncoder(w).Encode(traffic)
}

func UpdateMikroTikInterface(w http.ResponseWriter, r *http.Request) {
	deviceID := strings.TrimSpace(chi.URLParam(r, "device_id"))
	interfaceID := strings.TrimSpace(chi.URLParam(r, "interface_id"))
	if deviceID == "" || interfaceID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "device_id and interface_id are required"})
		return
	}

	var request models.MikroTikInterfaceUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "invalid request body", Detail: err.Error()})
		return
	}

	payload := map[string]interface{}{"interface_id": interfaceID}
	if request.Disabled != nil {
		payload["disabled"] = *request.Disabled
	}
	if request.Comment != nil {
		payload["comment"] = strings.TrimSpace(*request.Comment)
	}
	if request.MTU != nil {
		payload["mtu"] = *request.MTU
	}

	enqueueMikroTikAction(w, deviceID, "interface.update", payload, "Interface update queued")
}

func GetMikroTikPPPActive(w http.ResponseWriter, r *http.Request) {
	deviceID := strings.TrimSpace(chi.URLParam(r, "device_id"))
	if deviceID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "device_id is required"})
		return
	}

	rows, err := services.GetMikroTikService().ListPPPActive(deviceID)
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to fetch ppp active sessions", Detail: err.Error()})
		return
	}

	_ = json.NewEncoder(w).Encode(rows)
}

func KickMikroTikPPPActive(w http.ResponseWriter, r *http.Request) {
	deviceID := strings.TrimSpace(chi.URLParam(r, "device_id"))
	sessionID := strings.TrimSpace(chi.URLParam(r, "session_id"))
	if deviceID == "" || sessionID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "device_id and session_id are required"})
		return
	}

	logActivity(r, "kick_ppp", sessionID, deviceID, "")
	enqueueMikroTikAction(w, deviceID, "ppp.active.kick", map[string]interface{}{"session_id": sessionID}, "PPP active kick queued")
}

func KickMikroTikPPPActiveBulk(w http.ResponseWriter, r *http.Request) {
	deviceID := strings.TrimSpace(chi.URLParam(r, "device_id"))
	if deviceID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "device_id is required"})
		return
	}

	var request models.MikroTikKickActiveRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "invalid request body", Detail: err.Error()})
		return
	}

	tasks := make([]*services.MikroTikTaskStatus, 0)
	for _, sessionID := range normalizeStringSlice(request.SessionIDs) {
		task, err := services.GetMikroTikService().EnqueueTask(deviceID, "ppp.active.kick", map[string]interface{}{"session_id": sessionID})
		if err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to enqueue kick action", Detail: err.Error()})
			return
		}
		tasks = append(tasks, task)
	}
	for _, username := range normalizeStringSlice(request.Usernames) {
		task, err := services.GetMikroTikService().EnqueueTask(deviceID, "ppp.active.kick", map[string]interface{}{"username": username})
		if err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to enqueue kick action", Detail: err.Error()})
			return
		}
		tasks = append(tasks, task)
	}

	if len(tasks) == 0 {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "session_ids or usernames is required"})
		return
	}

	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success":   true,
		"message":   "PPP active bulk kick queued",
		"device_id": deviceID,
		"tasks":     tasks,
	})
}

func GetMikroTikPPPSecrets(w http.ResponseWriter, r *http.Request) {
	deviceID := strings.TrimSpace(chi.URLParam(r, "device_id"))
	if deviceID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "device_id is required"})
		return
	}

	rows, err := services.GetMikroTikService().ListPPPSecrets(deviceID)
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to fetch ppp secrets", Detail: err.Error()})
		return
	}

	_ = json.NewEncoder(w).Encode(rows)
}

func CreateMikroTikPPPSecret(w http.ResponseWriter, r *http.Request) {
	deviceID := strings.TrimSpace(chi.URLParam(r, "device_id"))
	if deviceID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "device_id is required"})
		return
	}

	var request models.MikroTikSecretUpsertRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "invalid request body", Detail: err.Error()})
		return
	}

	request.Name = strings.TrimSpace(request.Name)
	if request.Name == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "name is required"})
		return
	}

	payload := map[string]interface{}{"name": request.Name}
	if request.Password != nil {
		payload["password"] = *request.Password
	}
	if request.Profile != nil {
		payload["profile"] = strings.TrimSpace(*request.Profile)
	}
	if request.Service != nil {
		payload["service"] = strings.TrimSpace(*request.Service)
	}
	if request.LocalAddress != nil {
		payload["local_address"] = strings.TrimSpace(*request.LocalAddress)
	}
	if request.RemoteAddress != nil {
		payload["remote_address"] = strings.TrimSpace(*request.RemoteAddress)
	}
	if request.Comment != nil {
		payload["comment"] = strings.TrimSpace(*request.Comment)
	}
	if request.Disabled != nil {
		payload["disabled"] = *request.Disabled
	}

	logActivity(r, "create_ppp_secret", request.Name, deviceID, "")
	enqueueMikroTikAction(w, deviceID, "ppp.secret.create", payload, "PPP secret create queued")
}

func UpdateMikroTikPPPSecret(w http.ResponseWriter, r *http.Request) {
	deviceID := strings.TrimSpace(chi.URLParam(r, "device_id"))
	secretID := strings.TrimSpace(chi.URLParam(r, "secret_id"))
	if deviceID == "" || secretID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "device_id and secret_id are required"})
		return
	}

	var request models.MikroTikSecretUpsertRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "invalid request body", Detail: err.Error()})
		return
	}

	payload := map[string]interface{}{"secret_id": secretID}
	if strings.TrimSpace(request.Name) != "" {
		payload["name"] = strings.TrimSpace(request.Name)
	}
	if request.Password != nil {
		payload["password"] = *request.Password
	}
	if request.Profile != nil {
		payload["profile"] = strings.TrimSpace(*request.Profile)
	}
	if request.Service != nil {
		payload["service"] = strings.TrimSpace(*request.Service)
	}
	if request.LocalAddress != nil {
		payload["local_address"] = strings.TrimSpace(*request.LocalAddress)
	}
	if request.RemoteAddress != nil {
		payload["remote_address"] = strings.TrimSpace(*request.RemoteAddress)
	}
	if request.Comment != nil {
		payload["comment"] = strings.TrimSpace(*request.Comment)
	}
	if request.Disabled != nil {
		payload["disabled"] = *request.Disabled
	}

	logActivity(r, "edit_ppp_secret", secretID, deviceID, "")
	enqueueMikroTikAction(w, deviceID, "ppp.secret.update", payload, "PPP secret update queued")
}

func DeleteMikroTikPPPSecret(w http.ResponseWriter, r *http.Request) {
	deviceID := strings.TrimSpace(chi.URLParam(r, "device_id"))
	secretID := strings.TrimSpace(chi.URLParam(r, "secret_id"))
	if deviceID == "" || secretID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "device_id and secret_id are required"})
		return
	}

	logActivity(r, "delete_ppp_secret", secretID, deviceID, "")
	enqueueMikroTikAction(w, deviceID, "ppp.secret.delete", map[string]interface{}{"secret_id": secretID}, "PPP secret delete queued")
}

func GetMikroTikPPPProfiles(w http.ResponseWriter, r *http.Request) {
	deviceID := strings.TrimSpace(chi.URLParam(r, "device_id"))
	if deviceID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "device_id is required"})
		return
	}

	rows, err := services.GetMikroTikService().ListPPPProfiles(deviceID)
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to fetch ppp profiles", Detail: err.Error()})
		return
	}

	_ = json.NewEncoder(w).Encode(rows)
}

func CreateMikroTikPPPProfile(w http.ResponseWriter, r *http.Request) {
	deviceID := strings.TrimSpace(chi.URLParam(r, "device_id"))
	if deviceID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "device_id is required"})
		return
	}

	var request models.MikroTikProfileUpsertRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "invalid request body", Detail: err.Error()})
		return
	}

	request.Name = strings.TrimSpace(request.Name)
	if request.Name == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "name is required"})
		return
	}

	payload := map[string]interface{}{"name": request.Name}
	if request.LocalAddress != nil {
		payload["local_address"] = strings.TrimSpace(*request.LocalAddress)
	}
	if request.RemotePool != nil {
		payload["remote_pool"] = strings.TrimSpace(*request.RemotePool)
	}
	if request.RateLimit != nil {
		payload["rate_limit"] = strings.TrimSpace(*request.RateLimit)
	}
	if request.DNSServer != nil {
		payload["dns_server"] = strings.TrimSpace(*request.DNSServer)
	}
	if request.OnlyOne != nil {
		payload["only_one"] = *request.OnlyOne
	}
	if request.ChangeTCPMSS != nil {
		payload["change_tcp_mss"] = *request.ChangeTCPMSS
	}
	if request.Comment != nil {
		payload["comment"] = strings.TrimSpace(*request.Comment)
	}

	logActivity(r, "create_ppp_profile", request.Name, deviceID, "")
	enqueueMikroTikAction(w, deviceID, "ppp.profile.create", payload, "PPP profile create queued")
}

func UpdateMikroTikPPPProfile(w http.ResponseWriter, r *http.Request) {
	deviceID := strings.TrimSpace(chi.URLParam(r, "device_id"))
	profileID := strings.TrimSpace(chi.URLParam(r, "profile_id"))
	if deviceID == "" || profileID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "device_id and profile_id are required"})
		return
	}

	var request models.MikroTikProfileUpsertRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "invalid request body", Detail: err.Error()})
		return
	}

	payload := map[string]interface{}{"profile_id": profileID}
	if strings.TrimSpace(request.Name) != "" {
		payload["name"] = strings.TrimSpace(request.Name)
	}
	if request.LocalAddress != nil {
		payload["local_address"] = strings.TrimSpace(*request.LocalAddress)
	}
	if request.RemotePool != nil {
		payload["remote_pool"] = strings.TrimSpace(*request.RemotePool)
	}
	if request.RateLimit != nil {
		payload["rate_limit"] = strings.TrimSpace(*request.RateLimit)
	}
	if request.DNSServer != nil {
		payload["dns_server"] = strings.TrimSpace(*request.DNSServer)
	}
	if request.OnlyOne != nil {
		payload["only_one"] = *request.OnlyOne
	}
	if request.ChangeTCPMSS != nil {
		payload["change_tcp_mss"] = *request.ChangeTCPMSS
	}
	if request.Comment != nil {
		payload["comment"] = strings.TrimSpace(*request.Comment)
	}

	logActivity(r, "update_ppp_profile", profileID, deviceID, "")
	enqueueMikroTikAction(w, deviceID, "ppp.profile.update", payload, "PPP profile update queued")
}

func DeleteMikroTikPPPProfile(w http.ResponseWriter, r *http.Request) {
	deviceID := strings.TrimSpace(chi.URLParam(r, "device_id"))
	profileID := strings.TrimSpace(chi.URLParam(r, "profile_id"))
	if deviceID == "" || profileID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "device_id and profile_id are required"})
		return
	}

	logActivity(r, "delete_ppp_profile", profileID, deviceID, "")
	enqueueMikroTikAction(w, deviceID, "ppp.profile.delete", map[string]interface{}{"profile_id": profileID}, "PPP profile delete queued")
}

func CreateMikroTikBulkJob(w http.ResponseWriter, r *http.Request) {
	var request models.MikroTikBulkJobRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "invalid request body", Detail: err.Error()})
		return
	}

	request.Action = strings.TrimSpace(request.Action)
	deviceIDs := normalizeStringSlice(request.DeviceIDs)
	if request.Action == "" || len(deviceIDs) == 0 {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "action and device_ids are required"})
		return
	}

	tasks := make([]*services.MikroTikTaskStatus, 0, len(deviceIDs))
	for _, deviceID := range deviceIDs {
		task, err := services.GetMikroTikService().EnqueueTask(deviceID, request.Action, request.Payload)
		if err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to enqueue bulk job", Detail: err.Error()})
			return
		}
		tasks = append(tasks, task)
	}

	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "MikroTik bulk job queued",
		"action":  request.Action,
		"tasks":   tasks,
	})
}

func enqueueMikroTikAction(w http.ResponseWriter, deviceID, action string, payload map[string]interface{}, message string) {
	task, err := services.GetMikroTikService().EnqueueTask(deviceID, action, payload)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "failed to enqueue mikrotik task", Detail: err.Error()})
		return
	}

	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success":   true,
		"message":   message,
		"device_id": deviceID,
		"action":    action,
		"task":      task,
	})
}

func sanitizeMikroTikDevice(device db.MikroTikDeviceRecord) map[string]interface{} {
	return map[string]interface{}{
		"id":              device.ID,
		"name":            device.Name,
		"host":            device.Host,
		"port":            device.Port,
		"username":        device.Username,
		"has_password":    strings.TrimSpace(device.Password) != "",
		"use_tls":         device.UseTLS,
		"skip_tls_verify": device.SkipTLSVerify,
		"site":            device.Site,
		"tags":            device.Tags,
		"ros_version":     device.ROSVersion,
		"ros_major":       device.ROSMajor,
		"status":          device.Status,
		"last_error":      device.LastError,
		"last_sync_at":    device.LastSyncAt,
		"created_at":      device.CreatedAt,
		"updated_at":      device.UpdatedAt,
	}
}

func normalizeStringSlice(values []string) []string {
	if values == nil {
		return nil
	}

	set := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, exists := set[trimmed]; exists {
			continue
		}
		set[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	return result
}

func isValidMikroTikDeviceID(id string) bool {
	if len(id) < 3 || len(id) > 64 {
		return false
	}

	for _, char := range id {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') {
			continue
		}
		if char == '-' || char == '_' || char == '.' {
			continue
		}
		return false
	}

	return true
}

func asString(value interface{}) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	default:
		return fmt.Sprintf("%v", typed)
	}
}

func firstNonEmptyMikroTik(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}

	return ""
}

func formatROSVersionLabel(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "-"
	}
	trimmed = strings.ReplaceAll(trimmed, "(", " ")
	trimmed = strings.ReplaceAll(trimmed, ")", " ")
	return strings.Join(strings.Fields(trimmed), " ")
}

func formatCPULoad(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "-"
	}
	if strings.HasSuffix(trimmed, "%") {
		return trimmed
	}
	return trimmed + "%"
}

func formatMemoryUsage(freeRaw, totalRaw string) string {
	freeMB, freeOK := parseMemoryToMB(freeRaw)
	totalMB, totalOK := parseMemoryToMB(totalRaw)
	if !freeOK || !totalOK {
		return "-"
	}
	return fmt.Sprintf("%d / %d MB", freeMB, totalMB)
}

func parseMemoryToMB(raw string) (int64, bool) {
	trimmed := strings.TrimSpace(strings.ToLower(raw))
	if trimmed == "" {
		return 0, false
	}

	if bytesValue, err := strconv.ParseInt(trimmed, 10, 64); err == nil {
		if bytesValue < 0 {
			return 0, false
		}
		return bytesValue / (1024 * 1024), true
	}

	unitPattern := regexp.MustCompile(`^([0-9]+(?:\.[0-9]+)?)\s*([kmgt]?i?b)$`)
	matches := unitPattern.FindStringSubmatch(trimmed)
	if len(matches) != 3 {
		return 0, false
	}

	value, err := strconv.ParseFloat(matches[1], 64)
	if err != nil || value < 0 {
		return 0, false
	}

	unit := matches[2]
	multiplier := float64(1)
	switch unit {
	case "b":
		multiplier = 1.0 / (1024 * 1024)
	case "kb", "kib":
		multiplier = 1.0 / 1024
	case "mb", "mib":
		multiplier = 1
	case "gb", "gib":
		multiplier = 1024
	case "tb", "tib":
		multiplier = 1024 * 1024
	}

	return int64(value * multiplier), true
}

func formatMikroTikUptime(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "-"
	}

	weekPattern := regexp.MustCompile(`(\d+)w`)
	dayPattern := regexp.MustCompile(`(\d+)d`)
	hourPattern := regexp.MustCompile(`(\d+)h`)
	minutePattern := regexp.MustCompile(`(\d+)m`)
	timePattern := regexp.MustCompile(`(\d+):(\d+):(\d+)`)

	weeks := extractRegexInt(weekPattern, trimmed)
	days := extractRegexInt(dayPattern, trimmed)
	hours := extractRegexInt(hourPattern, trimmed)
	minutes := extractRegexInt(minutePattern, trimmed)

	if matches := timePattern.FindStringSubmatch(trimmed); len(matches) == 4 {
		if parsedHours, err := strconv.Atoi(matches[1]); err == nil {
			hours = parsedHours
		}
		if parsedMinutes, err := strconv.Atoi(matches[2]); err == nil {
			minutes = parsedMinutes
		}
	}

	totalDays := days + (weeks * 7)
	return fmt.Sprintf("%dd %dh %dm", totalDays, hours, minutes)
}

func extractRegexInt(pattern *regexp.Regexp, value string) int {
	matches := pattern.FindStringSubmatch(value)
	if len(matches) != 2 {
		return 0
	}
	parsed, err := strconv.Atoi(matches[1])
	if err != nil {
		return 0
	}
	return parsed
}
