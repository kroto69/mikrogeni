package services

import (
	"context"
	"crypto/tls"
	"fmt"
	"math"
	"net"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"genieacs-backend/internal/db"

	"github.com/go-routeros/routeros/v3"
	"github.com/go-routeros/routeros/v3/proto"
)

type MikroTikTaskStatus struct {
	ID           string    `json:"id"`
	DeviceID     string    `json:"device_id"`
	Action       string    `json:"action"`
	Status       TaskState `json:"status"`
	CreatedAt    string    `json:"created_at"`
	UpdatedAt    string    `json:"updated_at"`
	CompletedAt  string    `json:"completed_at,omitempty"`
	Error        string    `json:"error,omitempty"`
	ResponseCode int       `json:"response_code,omitempty"`
	ResponseBody string    `json:"response_body,omitempty"`
	Attempts     int       `json:"attempts"`
}

type queuedMikroTikTask struct {
	id       string
	deviceID string
	action   string
	payload  map[string]interface{}
}

type MikroTikService struct {
	queue chan queuedMikroTikTask

	tasksMu sync.RWMutex
	tasks   map[string]*MikroTikTaskStatus

	queueTimeout time.Duration
}

var (
	mikrotikServiceOnce     sync.Once
	mikrotikServiceInstance *MikroTikService
	mikrotikTaskCounter     uint64
)

func GetMikroTikService() *MikroTikService {
	mikrotikServiceOnce.Do(func() {
		mikrotikServiceInstance = NewMikroTikService(2, 512)
	})
	return mikrotikServiceInstance
}

func NewMikroTikService(workers int, queueSize int) *MikroTikService {
	if workers <= 0 {
		workers = 1
	}
	if queueSize <= 0 {
		queueSize = 128
	}

	svc := &MikroTikService{
		queue:        make(chan queuedMikroTikTask, queueSize),
		tasks:        make(map[string]*MikroTikTaskStatus),
		queueTimeout: 15 * time.Second,
	}

	for i := 0; i < workers; i++ {
		go svc.worker()
	}

	return svc
}

func (s *MikroTikService) nextTaskID() string {
	next := atomic.AddUint64(&mikrotikTaskCounter, 1)
	return "mtk-task-" + strconv.FormatInt(time.Now().UnixNano(), 10) + "-" + strconv.FormatUint(next, 10)
}

func (s *MikroTikService) EnqueueTask(deviceID, action string, payload map[string]interface{}) (*MikroTikTaskStatus, error) {
	if strings.TrimSpace(deviceID) == "" {
		return nil, fmt.Errorf("device id is required")
	}
	if strings.TrimSpace(action) == "" {
		return nil, fmt.Errorf("action is required")
	}

	taskID := s.nextTaskID()
	now := time.Now().UTC().Format(time.RFC3339)
	status := &MikroTikTaskStatus{
		ID:        taskID,
		DeviceID:  strings.TrimSpace(deviceID),
		Action:    strings.TrimSpace(action),
		Status:    TaskQueued,
		CreatedAt: now,
		UpdatedAt: now,
		Attempts:  0,
	}

	s.tasksMu.Lock()
	s.tasks[taskID] = status
	s.tasksMu.Unlock()

	job := queuedMikroTikTask{id: taskID, deviceID: status.DeviceID, action: status.Action, payload: payload}
	select {
	case s.queue <- job:
		copied := *status
		return &copied, nil
	default:
		s.tasksMu.Lock()
		delete(s.tasks, taskID)
		s.tasksMu.Unlock()
		return nil, fmt.Errorf("mikrotik task queue is full")
	}
}

func (s *MikroTikService) GetTaskStatus(taskID string) (*MikroTikTaskStatus, bool) {
	s.tasksMu.RLock()
	status, ok := s.tasks[strings.TrimSpace(taskID)]
	s.tasksMu.RUnlock()
	if !ok {
		return nil, false
	}

	copy := *status
	return &copy, true
}

func (s *MikroTikService) updateTask(taskID string, updater func(*MikroTikTaskStatus)) {
	s.tasksMu.Lock()
	task, ok := s.tasks[taskID]
	if ok {
		updater(task)
		task.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	}
	s.tasksMu.Unlock()
}

func (s *MikroTikService) worker() {
	for task := range s.queue {
		s.updateTask(task.id, func(state *MikroTikTaskStatus) {
			state.Status = TaskProcessing
		})

		var err error
		for attempt := 1; attempt <= 3; attempt++ {
			err = s.ExecuteAction(task.deviceID, task.action, task.payload)
			s.updateTask(task.id, func(state *MikroTikTaskStatus) {
				state.Attempts = attempt
			})
			if err == nil {
				break
			}
			if attempt < 3 {
				time.Sleep(time.Duration(attempt) * 500 * time.Millisecond)
			}
		}

		if err != nil {
			s.updateTask(task.id, func(state *MikroTikTaskStatus) {
				state.Status = TaskFailed
				state.Error = err.Error()
				state.ResponseCode = 500
				state.ResponseBody = err.Error()
				state.CompletedAt = time.Now().UTC().Format(time.RFC3339)
			})
			continue
		}

		s.updateTask(task.id, func(state *MikroTikTaskStatus) {
			state.Status = TaskSuccess
			state.Error = ""
			state.ResponseCode = 200
			state.ResponseBody = "ok"
			state.CompletedAt = time.Now().UTC().Format(time.RFC3339)
		})
	}
}

func (s *MikroTikService) ExecuteAction(deviceID, action string, payload map[string]interface{}) error {
	device, err := db.GetMikroTikDeviceByID(deviceID)
	if err != nil {
		return err
	}
	if device == nil {
		return fmt.Errorf("mikrotik device not found")
	}

	ctx, cancel := context.WithTimeout(context.Background(), s.queueTimeout)
	defer cancel()

	_, err = s.withClient(ctx, *device, func(client *routeros.Client) (interface{}, error) {
		switch strings.TrimSpace(action) {
		case "interface.update":
			return nil, s.applyInterfaceUpdate(client, payload)
		case "ppp.active.kick":
			return nil, s.kickPPPActive(client, payload)
		case "ppp.secret.create":
			return nil, s.createPPPSecret(client, payload)
		case "ppp.secret.update":
			return nil, s.updatePPPSecret(client, payload)
		case "ppp.secret.delete":
			return nil, s.deletePPPSecret(client, payload)
		case "ppp.profile.create":
			return nil, s.createPPPProfile(client, payload)
		case "ppp.profile.update":
			return nil, s.updatePPPProfile(client, payload)
		case "ppp.profile.delete":
			return nil, s.deletePPPProfile(client, payload)
		default:
			return nil, fmt.Errorf("unsupported action: %s", action)
		}
	})

	return err
}

func (s *MikroTikService) TestConnection(deviceID string) (map[string]interface{}, error) {
	device, err := db.GetMikroTikDeviceByID(deviceID)
	if err != nil {
		return nil, err
	}
	if device == nil {
		return nil, fmt.Errorf("mikrotik device not found")
	}

	facts, err := s.SyncDevice(deviceID)
	if err != nil {
		return nil, err
	}

	response := map[string]interface{}{
		"device_id":    device.ID,
		"status":       "connected",
		"host":         device.Host,
		"ros_version":  facts["ros_version"],
		"ros_major":    facts["ros_major"],
		"identity":     facts["identity"],
		"model":        facts["model"],
		"uptime":       facts["uptime"],
		"checked_at":   time.Now().UTC().Format(time.RFC3339),
		"capabilities": []string{"interface", "ppp.active", "ppp.secret", "ppp.profile"},
	}

	return response, nil
}

func (s *MikroTikService) SyncDevice(deviceID string) (map[string]interface{}, error) {
	device, err := db.GetMikroTikDeviceByID(deviceID)
	if err != nil {
		return nil, err
	}
	if device == nil {
		return nil, fmt.Errorf("mikrotik device not found")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()

	factsRaw, err := s.withClient(ctx, *device, func(client *routeros.Client) (interface{}, error) {
		resourceReply, runErr := client.Run("/system/resource/print")
		if runErr != nil {
			return nil, runErr
		}
		if len(resourceReply.Re) == 0 {
			return nil, fmt.Errorf("empty response from /system/resource/print")
		}

		resource := sentenceToMap(resourceReply.Re[0])
		identityName := ""
		if identityReply, identityErr := client.Run("/system/identity/print"); identityErr == nil && len(identityReply.Re) > 0 {
			identityName = strings.TrimSpace(toString(identityReply.Re[0].Map["name"]))
		}

		routerboardModel := ""
		if rbReply, rbErr := client.Run("/system/routerboard/print"); rbErr == nil && len(rbReply.Re) > 0 {
			routerboardModel = strings.TrimSpace(toString(rbReply.Re[0].Map["model"]))
		}

		boardName := strings.TrimSpace(toString(resource["board-name"]))
		architectureName := strings.TrimSpace(toString(resource["architecture-name"]))
		identity := firstNonEmptyString(identityName, boardName)
		model := firstNonEmptyString(routerboardModel, architectureName, boardName)
		modelType := ""
		if routerboardModel != "" && boardName != "" && !strings.EqualFold(routerboardModel, boardName) {
			modelType = routerboardModel + " · " + boardName
		} else {
			modelType = firstNonEmptyString(routerboardModel, boardName, architectureName)
		}

		result := map[string]interface{}{}
		for key, value := range resource {
			result[key] = value
		}
		result["identity"] = identity
		result["model"] = model
		result["model_type"] = modelType
		result["routerboard_model"] = routerboardModel
		result["board_name"] = boardName
		result["architecture_name"] = architectureName

		return result, nil
	})
	if err != nil {
		_ = db.UpdateMikroTikDeviceSync(device.ID, "", 0, "offline", err.Error())
		return nil, err
	}

	facts, ok := factsRaw.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid facts response")
	}

	version := strings.TrimSpace(toString(facts["version"]))
	major := parseROSMajor(version)
	identity := strings.TrimSpace(toString(facts["identity"]))

	status := "online"
	if err := db.UpdateMikroTikDeviceSync(device.ID, version, major, status, ""); err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"device_id":    device.ID,
		"identity":     identity,
		"model":        strings.TrimSpace(toString(facts["model"])),
		"model_type":   strings.TrimSpace(toString(facts["model_type"])),
		"board_name":   strings.TrimSpace(toString(facts["board_name"])),
		"uptime":       strings.TrimSpace(toString(facts["uptime"])),
		"ros_version":  version,
		"ros_major":    major,
		"cpu_load":     strings.TrimSpace(toString(facts["cpu-load"])),
		"free_memory":  strings.TrimSpace(toString(facts["free-memory"])),
		"total_memory": strings.TrimSpace(toString(facts["total-memory"])),
	}, nil
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}

	return ""
}

func normalizeInterfaceMAC(row map[string]interface{}) {
	mac := firstNonEmptyString(
		toString(row["mac-address"]),
		toString(row["actual-mac-address"]),
		toString(row["orig-mac-address"]),
		toString(row["current-mac-address"]),
		toString(row["radio-mac"]),
		toString(row["mac_address"]),
		toString(row["macAddress"]),
	)

	if mac != "" {
		row["mac-address"] = mac
	}
}

func isPPPoEInterface(row map[string]interface{}) bool {
	typeValue := strings.ToLower(strings.TrimSpace(toString(row["type"])))
	nameValue := strings.ToLower(strings.TrimSpace(toString(row["name"])))
	return strings.Contains(typeValue, "pppoe") || strings.HasPrefix(nameValue, "pppoe")
}

func pppoeNameCandidates(rawName string) []string {
	trimmed := strings.TrimSpace(strings.ToLower(rawName))
	if trimmed == "" {
		return nil
	}

	strippedAngles := strings.TrimPrefix(strings.TrimSuffix(trimmed, ">"), "<")
	withoutPrefix := strings.TrimPrefix(strippedAngles, "pppoe-")

	uniq := map[string]struct{}{}
	ordered := []string{trimmed, strippedAngles, withoutPrefix}
	result := make([]string, 0, len(ordered))
	for _, candidate := range ordered {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		if _, exists := uniq[candidate]; exists {
			continue
		}
		uniq[candidate] = struct{}{}
		result = append(result, candidate)
	}

	return result
}

func (s *MikroTikService) ListInterfaces(deviceID string) ([]map[string]interface{}, error) {
	device, err := db.GetMikroTikDeviceByID(deviceID)
	if err != nil {
		return nil, err
	}
	if device == nil {
		return nil, fmt.Errorf("mikrotik device not found")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()

	replyRaw, err := s.withClient(ctx, *device, func(client *routeros.Client) (interface{}, error) {
		reply, runErr := client.RunArgs([]string{"/interface/print", "=.proplist=.id,name,type,disabled,running,mtu,comment,mac-address,orig-mac-address,actual-mac-address,current-mac-address,radio-mac,rx-byte,tx-byte"})
		if runErr != nil {
			return nil, runErr
		}

		ethernetMACByName := map[string]string{}
		if ethReply, ethErr := client.RunArgs([]string{"/interface/ethernet/print", "=.proplist=name,mac-address,orig-mac-address"}); ethErr == nil {
			for _, sentence := range ethReply.Re {
				ethRow := sentenceToMap(sentence)
				name := strings.TrimSpace(toString(ethRow["name"]))
				if name == "" {
					continue
				}

				mac := firstNonEmptyString(
					toString(ethRow["mac-address"]),
					toString(ethRow["orig-mac-address"]),
				)
				if mac != "" {
					ethernetMACByName[name] = mac
				}
			}
		}

		pppoeCallerIDByName := map[string]string{}
		if pppReply, pppErr := client.RunArgs([]string{"/ppp/active/print", "=.proplist=name,caller-id"}); pppErr == nil {
			for _, sentence := range pppReply.Re {
				pppRow := sentenceToMap(sentence)
				name := strings.TrimSpace(toString(pppRow["name"]))
				if name == "" {
					continue
				}

				callerID := strings.TrimSpace(toString(pppRow["caller-id"]))
				if callerID != "" {
					for _, key := range pppoeNameCandidates(name) {
						pppoeCallerIDByName[key] = callerID
					}
				}
			}
		}

		rows := make([]map[string]interface{}, 0, len(reply.Re))
		for _, sentence := range reply.Re {
			row := sentenceToMap(sentence)
			normalizeInterfaceMAC(row)
			name := strings.TrimSpace(toString(row["name"]))

			if strings.TrimSpace(toString(row["mac-address"])) == "" {
				if name != "" {
					if mac, ok := ethernetMACByName[name]; ok && strings.TrimSpace(mac) != "" {
						row["mac-address"] = mac
					}
				}
			}

			if strings.TrimSpace(toString(row["mac-address"])) == "" && isPPPoEInterface(row) && name != "" {
				for _, key := range pppoeNameCandidates(name) {
					if callerID, ok := pppoeCallerIDByName[key]; ok && strings.TrimSpace(callerID) != "" {
						row["mac-address"] = callerID
						row["caller-id"] = callerID
						break
					}
				}
			}

			rows = append(rows, row)
		}

		return rows, nil
	})
	if err != nil {
		return nil, err
	}

	rows, ok := replyRaw.([]map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid interface response")
	}

	return rows, nil
}

func (s *MikroTikService) GetInterfaceTraffic(deviceID string, interfaceID string) (map[string]interface{}, error) {
	device, err := db.GetMikroTikDeviceByID(deviceID)
	if err != nil {
		return nil, err
	}
	if device == nil {
		return nil, fmt.Errorf("mikrotik device not found")
	}

	requestedInterface := strings.TrimSpace(interfaceID)
	if requestedInterface == "" {
		return nil, fmt.Errorf("interface_id is required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()

	replyRaw, err := s.withClient(ctx, *device, func(client *routeros.Client) (interface{}, error) {
		resolvedInterfaceName, resolveErr := s.resolveInterfaceName(client, requestedInterface)
		if resolveErr != nil {
			return nil, resolveErr
		}

		args := []string{
			"/interface/monitor-traffic",
			"=interface=" + resolvedInterfaceName,
			"=once=",
			"=.proplist=name,rx-bits-per-second,tx-bits-per-second,rx-packets-per-second,tx-packets-per-second,rx-byte-per-second,tx-byte-per-second",
		}
		reply, runErr := client.RunArgs(args)
		if runErr != nil {
			reply, runErr = client.RunArgs([]string{"/interface/monitor-traffic", "=interface=" + resolvedInterfaceName, "=once="})
			if runErr != nil {
				return nil, runErr
			}
		}
		if len(reply.Re) == 0 {
			return nil, fmt.Errorf("empty response from /interface/monitor-traffic")
		}

		trafficRow := sentenceToMap(reply.Re[0])
		trafficRow["interface"] = resolvedInterfaceName
		trafficRow["requested_interface"] = requestedInterface
		return trafficRow, nil
	})
	if err != nil {
		return nil, err
	}

	row, ok := replyRaw.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid interface traffic response")
	}

	rxBps := toFloat64(row["rx-bits-per-second"])
	txBps := toFloat64(row["tx-bits-per-second"])
	rxPps := toFloat64(row["rx-packets-per-second"])
	txPps := toFloat64(row["tx-packets-per-second"])

	response := map[string]interface{}{
		"device_id":    deviceID,
		"interface_id": requestedInterface,
		"interface":    strings.TrimSpace(toString(row["interface"])),
		"rx_bps":       rxBps,
		"tx_bps":       txBps,
		"rx_mbps":      math.Round((rxBps/1000000)*100) / 100,
		"tx_mbps":      math.Round((txBps/1000000)*100) / 100,
		"rx_pps":       rxPps,
		"tx_pps":       txPps,
		"sampled_at":   time.Now().UTC().Format(time.RFC3339),
	}

	return response, nil
}

func (s *MikroTikService) resolveInterfaceName(client *routeros.Client, identifier string) (string, error) {
	resourceID, err := s.resolveResourceID(client, "/interface/print", identifier, "name")
	if err != nil {
		return "", err
	}

	reply, err := client.RunArgs([]string{"/interface/print", "?.id=" + resourceID, "=.proplist=name"})
	if err != nil {
		return "", err
	}
	if len(reply.Re) == 0 {
		return "", fmt.Errorf("interface not found: %s", identifier)
	}

	name := strings.TrimSpace(reply.Re[0].Map["name"])
	if name == "" {
		return "", fmt.Errorf("interface name not found: %s", identifier)
	}

	return name, nil
}

func (s *MikroTikService) ListPPPActive(deviceID string) ([]map[string]interface{}, error) {
	device, err := db.GetMikroTikDeviceByID(deviceID)
	if err != nil {
		return nil, err
	}
	if device == nil {
		return nil, fmt.Errorf("mikrotik device not found")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()

	replyRaw, err := s.withClient(ctx, *device, func(client *routeros.Client) (interface{}, error) {
		reply, runErr := client.RunArgs([]string{"/ppp/active/print", "=.proplist=.id,name,service,address,caller-id,uptime,session-id"})
		if runErr != nil {
			return nil, runErr
		}

		rows := make([]map[string]interface{}, 0, len(reply.Re))
		for _, sentence := range reply.Re {
			rows = append(rows, sentenceToMap(sentence))
		}

		return rows, nil
	})
	if err != nil {
		return nil, err
	}

	rows, ok := replyRaw.([]map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid ppp active response")
	}

	return rows, nil
}

func (s *MikroTikService) ListPPPSecrets(deviceID string) ([]map[string]interface{}, error) {
	device, err := db.GetMikroTikDeviceByID(deviceID)
	if err != nil {
		return nil, err
	}
	if device == nil {
		return nil, fmt.Errorf("mikrotik device not found")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()

	replyRaw, err := s.withClient(ctx, *device, func(client *routeros.Client) (interface{}, error) {
		reply, runErr := client.RunArgs([]string{"/ppp/secret/print", "=.proplist=.id,name,password,service,profile,disabled,comment,remote-address,last-logged-out"})
		if runErr != nil {
			return nil, runErr
		}

		rows := make([]map[string]interface{}, 0, len(reply.Re))
		for _, sentence := range reply.Re {
			rows = append(rows, sentenceToMap(sentence))
		}

		return rows, nil
	})
	if err != nil {
		return nil, err
	}

	rows, ok := replyRaw.([]map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid ppp secret response")
	}

	return rows, nil
}

func (s *MikroTikService) ListPPPProfiles(deviceID string) ([]map[string]interface{}, error) {
	device, err := db.GetMikroTikDeviceByID(deviceID)
	if err != nil {
		return nil, err
	}
	if device == nil {
		return nil, fmt.Errorf("mikrotik device not found")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()

	replyRaw, err := s.withClient(ctx, *device, func(client *routeros.Client) (interface{}, error) {
		reply, runErr := client.RunArgs([]string{"/ppp/profile/print", "=.proplist=.id,name,local-address,remote-address,rate-limit,dns-server,only-one,change-tcp-mss,comment"})
		if runErr != nil {
			return nil, runErr
		}

		rows := make([]map[string]interface{}, 0, len(reply.Re))
		for _, sentence := range reply.Re {
			rows = append(rows, sentenceToMap(sentence))
		}

		return rows, nil
	})
	if err != nil {
		return nil, err
	}

	rows, ok := replyRaw.([]map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid ppp profile response")
	}

	return rows, nil
}

func (s *MikroTikService) applyInterfaceUpdate(client *routeros.Client, payload map[string]interface{}) error {
	identifier := strings.TrimSpace(toString(payload["interface_id"]))
	if identifier == "" {
		return fmt.Errorf("interface_id is required")
	}

	resourceID, err := s.resolveResourceID(client, "/interface/print", identifier, "name")
	if err != nil {
		return err
	}

	args := []string{"/interface/set", "=.id=" + resourceID}
	if disabled, ok := payload["disabled"]; ok {
		args = append(args, "=disabled="+formatBoolean(disabled))
	}
	if comment, ok := payload["comment"]; ok {
		args = append(args, "=comment="+toString(comment))
	}
	if mtu, ok := payload["mtu"]; ok {
		args = append(args, "=mtu="+strconv.Itoa(toInt(mtu)))
	}

	if len(args) <= 2 {
		return fmt.Errorf("no interface fields to update")
	}

	_, err = client.RunArgs(args)
	return err
}

func (s *MikroTikService) kickPPPActive(client *routeros.Client, payload map[string]interface{}) error {
	identifier := strings.TrimSpace(toString(payload["session_id"]))
	if identifier == "" {
		identifier = strings.TrimSpace(toString(payload["username"]))
	}
	if identifier == "" {
		return fmt.Errorf("session_id or username is required")
	}

	resourceID, err := s.resolvePPPActiveResourceID(client, identifier)
	if err != nil {
		return err
	}

	_, err = client.RunArgs([]string{"/ppp/active/remove", "=.id=" + resourceID})
	return err
}

func (s *MikroTikService) resolvePPPActiveResourceID(client *routeros.Client, identifier string) (string, error) {
	trimmed := strings.TrimSpace(identifier)
	if trimmed == "" {
		return "", fmt.Errorf("identifier is required")
	}

	if decoded, err := url.QueryUnescape(trimmed); err == nil {
		trimmed = strings.TrimSpace(decoded)
	}

	if strings.HasPrefix(trimmed, "*") {
		return trimmed, nil
	}

	reply, err := client.RunArgs([]string{"/ppp/active/print", "=.proplist=.id,name,session-id"})
	if err != nil {
		return "", err
	}

	for _, sentence := range reply.Re {
		id := strings.TrimSpace(sentence.Map[".id"])
		if id == "" {
			continue
		}

		if id == trimmed || strings.TrimSpace(sentence.Map["session-id"]) == trimmed || strings.TrimSpace(sentence.Map["name"]) == trimmed {
			return id, nil
		}
	}

	return "", fmt.Errorf("resource not found: %s", identifier)
}

func (s *MikroTikService) createPPPSecret(client *routeros.Client, payload map[string]interface{}) error {
	name := strings.TrimSpace(toString(payload["name"]))
	if name == "" {
		return fmt.Errorf("name is required")
	}

	args := []string{"/ppp/secret/add", "=name=" + name}
	if password, ok := payload["password"]; ok {
		args = append(args, "=password="+toString(password))
	}
	if profile, ok := payload["profile"]; ok {
		args = append(args, "=profile="+toString(profile))
	}
	if service, ok := payload["service"]; ok {
		args = append(args, "=service="+toString(service))
	}
	if localAddress, ok := payload["local_address"]; ok {
		args = append(args, "=local-address="+toString(localAddress))
	}
	if remoteAddress, ok := payload["remote_address"]; ok {
		args = append(args, "=remote-address="+toString(remoteAddress))
	}
	if comment, ok := payload["comment"]; ok {
		args = append(args, "=comment="+toString(comment))
	}
	if disabled, ok := payload["disabled"]; ok {
		args = append(args, "=disabled="+formatBoolean(disabled))
	}

	_, err := client.RunArgs(args)
	return err
}

func (s *MikroTikService) updatePPPSecret(client *routeros.Client, payload map[string]interface{}) error {
	identifier := strings.TrimSpace(toString(payload["secret_id"]))
	if identifier == "" {
		identifier = strings.TrimSpace(toString(payload["name"]))
	}
	if identifier == "" {
		return fmt.Errorf("secret_id or name is required")
	}

	resourceID, err := s.resolveResourceID(client, "/ppp/secret/print", identifier, "name")
	if err != nil {
		return err
	}

	args := []string{"/ppp/secret/set", "=.id=" + resourceID}
	if name, ok := payload["name"]; ok {
		args = append(args, "=name="+toString(name))
	}
	if password, ok := payload["password"]; ok {
		args = append(args, "=password="+toString(password))
	}
	if profile, ok := payload["profile"]; ok {
		args = append(args, "=profile="+toString(profile))
	}
	if service, ok := payload["service"]; ok {
		args = append(args, "=service="+toString(service))
	}
	if localAddress, ok := payload["local_address"]; ok {
		args = append(args, "=local-address="+toString(localAddress))
	}
	if remoteAddress, ok := payload["remote_address"]; ok {
		args = append(args, "=remote-address="+toString(remoteAddress))
	}
	if comment, ok := payload["comment"]; ok {
		args = append(args, "=comment="+toString(comment))
	}
	if disabled, ok := payload["disabled"]; ok {
		args = append(args, "=disabled="+formatBoolean(disabled))
	}

	if len(args) <= 2 {
		return fmt.Errorf("no secret fields to update")
	}

	_, err = client.RunArgs(args)
	return err
}

func (s *MikroTikService) deletePPPSecret(client *routeros.Client, payload map[string]interface{}) error {
	identifier := strings.TrimSpace(toString(payload["secret_id"]))
	if identifier == "" {
		identifier = strings.TrimSpace(toString(payload["name"]))
	}
	if identifier == "" {
		return fmt.Errorf("secret_id or name is required")
	}

	resourceID, err := s.resolveResourceID(client, "/ppp/secret/print", identifier, "name")
	if err != nil {
		return err
	}

	_, err = client.RunArgs([]string{"/ppp/secret/remove", "=.id=" + resourceID})
	return err
}

func (s *MikroTikService) createPPPProfile(client *routeros.Client, payload map[string]interface{}) error {
	name := strings.TrimSpace(toString(payload["name"]))
	if name == "" {
		return fmt.Errorf("name is required")
	}

	args := []string{"/ppp/profile/add", "=name=" + name}
	if localAddress, ok := payload["local_address"]; ok {
		args = append(args, "=local-address="+toString(localAddress))
	}
	if remotePool, ok := payload["remote_pool"]; ok {
		args = append(args, "=remote-address="+toString(remotePool))
	}
	if rateLimit, ok := payload["rate_limit"]; ok {
		args = append(args, "=rate-limit="+toString(rateLimit))
	}
	if dnsServer, ok := payload["dns_server"]; ok {
		args = append(args, "=dns-server="+toString(dnsServer))
	}
	if onlyOne, ok := payload["only_one"]; ok {
		args = append(args, "=only-one="+formatBoolean(onlyOne))
	}
	if changeTCPMSS, ok := payload["change_tcp_mss"]; ok {
		args = append(args, "=change-tcp-mss="+formatBoolean(changeTCPMSS))
	}
	if comment, ok := payload["comment"]; ok {
		args = append(args, "=comment="+toString(comment))
	}

	_, err := client.RunArgs(args)
	return err
}

func (s *MikroTikService) updatePPPProfile(client *routeros.Client, payload map[string]interface{}) error {
	identifier := strings.TrimSpace(toString(payload["profile_id"]))
	if identifier == "" {
		identifier = strings.TrimSpace(toString(payload["name"]))
	}
	if identifier == "" {
		return fmt.Errorf("profile_id or name is required")
	}

	resourceID, err := s.resolveResourceID(client, "/ppp/profile/print", identifier, "name")
	if err != nil {
		return err
	}

	args := []string{"/ppp/profile/set", "=.id=" + resourceID}
	if name, ok := payload["name"]; ok {
		args = append(args, "=name="+toString(name))
	}
	if localAddress, ok := payload["local_address"]; ok {
		args = append(args, "=local-address="+toString(localAddress))
	}
	if remotePool, ok := payload["remote_pool"]; ok {
		args = append(args, "=remote-address="+toString(remotePool))
	}
	if rateLimit, ok := payload["rate_limit"]; ok {
		args = append(args, "=rate-limit="+toString(rateLimit))
	}
	if dnsServer, ok := payload["dns_server"]; ok {
		args = append(args, "=dns-server="+toString(dnsServer))
	}
	if onlyOne, ok := payload["only_one"]; ok {
		args = append(args, "=only-one="+formatBoolean(onlyOne))
	}
	if changeTCPMSS, ok := payload["change_tcp_mss"]; ok {
		args = append(args, "=change-tcp-mss="+formatBoolean(changeTCPMSS))
	}
	if comment, ok := payload["comment"]; ok {
		args = append(args, "=comment="+toString(comment))
	}

	if len(args) <= 2 {
		return fmt.Errorf("no profile fields to update")
	}

	_, err = client.RunArgs(args)
	return err
}

func (s *MikroTikService) deletePPPProfile(client *routeros.Client, payload map[string]interface{}) error {
	identifier := strings.TrimSpace(toString(payload["profile_id"]))
	if identifier == "" {
		identifier = strings.TrimSpace(toString(payload["name"]))
	}
	if identifier == "" {
		return fmt.Errorf("profile_id or name is required")
	}

	resourceID, err := s.resolveResourceID(client, "/ppp/profile/print", identifier, "name")
	if err != nil {
		return err
	}

	_, err = client.RunArgs([]string{"/ppp/profile/remove", "=.id=" + resourceID})
	return err
}

func (s *MikroTikService) resolveResourceID(client *routeros.Client, printPath string, identifier string, nameField string) (string, error) {
	trimmed := strings.TrimSpace(identifier)
	if trimmed == "" {
		return "", fmt.Errorf("identifier is required")
	}
	if decoded, err := url.QueryUnescape(trimmed); err == nil {
		trimmed = strings.TrimSpace(decoded)
	}
	if strings.HasPrefix(trimmed, "*") {
		return trimmed, nil
	}

	reply, err := client.RunArgs([]string{printPath, "?name=" + trimmed, "=.proplist=.id,name"})
	if err != nil {
		return "", err
	}
	if len(reply.Re) > 0 {
		if id := strings.TrimSpace(reply.Re[0].Map[".id"]); id != "" {
			return id, nil
		}
	}

	if strings.TrimSpace(nameField) != "" {
		reply, err = client.RunArgs([]string{printPath, "?" + nameField + "=" + trimmed, "=.proplist=.id," + nameField})
		if err != nil {
			return "", err
		}
		if len(reply.Re) > 0 {
			if id := strings.TrimSpace(reply.Re[0].Map[".id"]); id != "" {
				return id, nil
			}
		}
	}

	if strings.TrimSpace(nameField) != "" {
		reply, err = client.RunArgs([]string{printPath, "=.proplist=.id," + nameField})
		if err != nil {
			return "", err
		}
		for _, sentence := range reply.Re {
			if strings.TrimSpace(sentence.Map[nameField]) == trimmed {
				if id := strings.TrimSpace(sentence.Map[".id"]); id != "" {
					return id, nil
				}
			}
		}
	}

	return "", fmt.Errorf("resource not found: %s", identifier)
}

func (s *MikroTikService) withClient(ctx context.Context, device db.MikroTikDeviceRecord, fn func(*routeros.Client) (interface{}, error)) (interface{}, error) {
	address := buildMikroTikAddress(device.Host, device.Port, device.UseTLS)

	var (
		client *routeros.Client
		err    error
	)

	if device.UseTLS {
		tlsConfig := &tls.Config{InsecureSkipVerify: device.SkipTLSVerify}
		client, err = routeros.DialTLSContext(ctx, address, device.Username, device.Password, tlsConfig)
	} else {
		client, err = routeros.DialContext(ctx, address, device.Username, device.Password)
	}
	if err != nil {
		return nil, err
	}
	defer client.Close()

	return fn(client)
}

func sentenceToMap(sentence *proto.Sentence) map[string]interface{} {
	result := make(map[string]interface{}, len(sentence.Map))
	for key, value := range sentence.Map {
		result[key] = value
	}
	return result
}

func parseROSMajor(version string) int {
	trimmed := strings.TrimSpace(version)
	if trimmed == "" {
		return 0
	}
	parts := strings.Split(trimmed, ".")
	if len(parts) == 0 {
		return 0
	}
	major, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0
	}
	return major
}

func buildMikroTikAddress(host string, port int, useTLS bool) string {
	trimmedHost := strings.TrimSpace(host)
	if trimmedHost == "" {
		return ""
	}

	if _, _, err := net.SplitHostPort(trimmedHost); err == nil {
		return trimmedHost
	}

	resolvedPort := port
	if resolvedPort <= 0 {
		if useTLS {
			resolvedPort = 8729
		} else {
			resolvedPort = 8728
		}
	}

	return net.JoinHostPort(trimmedHost, strconv.Itoa(resolvedPort))
}

func toString(value interface{}) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	case bool:
		if typed {
			return "true"
		}
		return "false"
	case int:
		return strconv.Itoa(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	default:
		return fmt.Sprintf("%v", typed)
	}
}

func toInt(value interface{}) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case string:
		parsed, err := strconv.Atoi(strings.TrimSpace(typed))
		if err != nil {
			return 0
		}
		return parsed
	default:
		return 0
	}
}

func toFloat64(value interface{}) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		if err != nil {
			return 0
		}
		return parsed
	default:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(toString(typed)), 64)
		if err != nil {
			return 0
		}
		return parsed
	}
}

func formatBoolean(value interface{}) string {
	switch typed := value.(type) {
	case bool:
		if typed {
			return "yes"
		}
		return "no"
	case string:
		trimmed := strings.TrimSpace(strings.ToLower(typed))
		if trimmed == "1" || trimmed == "true" || trimmed == "yes" || trimmed == "on" {
			return "yes"
		}
		return "no"
	case int:
		if typed != 0 {
			return "yes"
		}
		return "no"
	case float64:
		if typed != 0 {
			return "yes"
		}
		return "no"
	default:
		return "no"
	}
}
