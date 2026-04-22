package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type TaskState string

const (
	TaskQueued     TaskState = "queued"
	TaskProcessing TaskState = "processing"
	TaskSuccess    TaskState = "success"
	TaskFailed     TaskState = "failed"
)

type GenieACSTaskStatus struct {
	ID           string    `json:"id"`
	DeviceID     string    `json:"device_id"`
	Status       TaskState `json:"status"`
	CreatedAt    string    `json:"created_at"`
	UpdatedAt    string    `json:"updated_at"`
	CompletedAt  string    `json:"completed_at,omitempty"`
	Error        string    `json:"error,omitempty"`
	ResponseCode int       `json:"response_code,omitempty"`
	ResponseBody string    `json:"response_body,omitempty"`
	Attempts     int       `json:"attempts"`
}

type queuedTask struct {
	id       string
	baseURL  string
	deviceID string
	payload  map[string]interface{}
}

type cacheEntry struct {
	expiresAt time.Time
	data      []map[string]interface{}
}

type GenieACSService struct {
	client *http.Client

	cacheTTL time.Duration
	cacheMu  sync.RWMutex
	cache    map[string]cacheEntry

	queue chan queuedTask

	tasksMu sync.RWMutex
	tasks   map[string]*GenieACSTaskStatus

	breakerMu            sync.Mutex
	breakerFailures      int
	breakerOpenUntil     time.Time
	breakerFailureThresh int
	breakerOpenDuration  time.Duration
}

var (
	genieServiceInstance *GenieACSService
	genieServiceOnce     sync.Once
	taskCounter          uint64
)

func GetGenieACSService() *GenieACSService {
	genieServiceOnce.Do(func() {
		genieServiceInstance = NewGenieACSService(15*time.Second, 3, 1024)
	})

	return genieServiceInstance
}

func NewGenieACSService(cacheTTL time.Duration, workers int, queueSize int) *GenieACSService {
	if workers <= 0 {
		workers = 1
	}
	if queueSize <= 0 {
		queueSize = 256
	}

	svc := &GenieACSService{
		client: &http.Client{Timeout: 20 * time.Second},

		cacheTTL: cacheTTL,
		cache:    make(map[string]cacheEntry),

		queue: make(chan queuedTask, queueSize),
		tasks: make(map[string]*GenieACSTaskStatus),

		breakerFailureThresh: 5,
		breakerOpenDuration:  20 * time.Second,
	}

	for i := 0; i < workers; i++ {
		go svc.worker()
	}

	return svc
}

func buildDevicesURL(baseURL string, projection []string, query string) string {
	params := url.Values{}
	if len(projection) > 0 {
		params.Set("projection", strings.Join(projection, ","))
	}
	if strings.TrimSpace(query) != "" {
		params.Set("query", query)
	}

	encoded := params.Encode()
	if encoded == "" {
		return baseURL
	}

	sep := "?"
	if strings.Contains(baseURL, "?") {
		sep = "&"
	}

	return baseURL + sep + encoded
}

func (s *GenieACSService) cacheKey(baseURL string, projection []string, query string) string {
	return baseURL + "|" + strings.Join(projection, ",") + "|" + query
}

func (s *GenieACSService) cloneDevices(input []map[string]interface{}) []map[string]interface{} {
	if len(input) == 0 {
		return []map[string]interface{}{}
	}

	raw, err := json.Marshal(input)
	if err != nil {
		return input
	}

	var cloned []map[string]interface{}
	if err := json.Unmarshal(raw, &cloned); err != nil {
		return input
	}

	return cloned
}

func (s *GenieACSService) FetchDevices(baseURL string, projection []string, query string) ([]map[string]interface{}, error) {
	if strings.TrimSpace(baseURL) == "" {
		return nil, fmt.Errorf("genieacs url is required")
	}

	cacheKey := s.cacheKey(baseURL, projection, query)
	now := time.Now()

	s.cacheMu.RLock()
	cached, exists := s.cache[cacheKey]
	s.cacheMu.RUnlock()
	if exists && now.Before(cached.expiresAt) {
		return s.cloneDevices(cached.data), nil
	}

	if err := s.ensureCircuitClosed(); err != nil {
		return nil, err
	}

	resp, err := s.client.Get(buildDevicesURL(baseURL, projection, query))
	if err != nil {
		s.recordFailure()
		return nil, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		if resp.StatusCode >= http.StatusInternalServerError {
			s.recordFailure()
		}
		return nil, fmt.Errorf("status: %d body: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var devices []map[string]interface{}
	if err := json.Unmarshal(body, &devices); err != nil {
		s.recordFailure()
		return nil, err
	}

	s.recordSuccess()

	s.cacheMu.Lock()
	s.cache[cacheKey] = cacheEntry{
		expiresAt: now.Add(s.cacheTTL),
		data:      s.cloneDevices(devices),
	}
	s.cacheMu.Unlock()

	return devices, nil
}

func (s *GenieACSService) FetchDeviceByID(baseURL string, deviceID string, projection []string) (map[string]interface{}, error) {
	queryBytes, err := json.Marshal(map[string]string{"_id": deviceID})
	if err != nil {
		return nil, err
	}

	devices, err := s.FetchDevices(baseURL, projection, string(queryBytes))
	if err != nil {
		return nil, err
	}
	if len(devices) == 0 {
		return nil, nil
	}

	return devices[0], nil
}

func buildTaskURL(baseURL string, deviceID string) string {
	parsed, err := url.Parse(baseURL)
	if err != nil {
		base := strings.TrimRight(baseURL, "/")
		if idx := strings.Index(base, "/devices"); idx >= 0 {
			base = base[:idx]
		}
		return fmt.Sprintf("%s/devices/%s/tasks?connection_request", strings.TrimRight(base, "/"), url.PathEscape(deviceID))
	}

	parsed.RawQuery = ""
	path := strings.TrimRight(parsed.Path, "/")
	if idx := strings.Index(path, "/devices"); idx >= 0 {
		path = path[:idx]
	}
	parsed.Path = strings.TrimRight(path, "/")

	base := strings.TrimRight(parsed.String(), "/")
	return fmt.Sprintf("%s/devices/%s/tasks?connection_request", base, url.PathEscape(deviceID))
}

func (s *GenieACSService) dispatchTask(baseURL string, deviceID string, payload map[string]interface{}) (int, string, error) {
	if err := s.ensureCircuitClosed(); err != nil {
		return 0, "", err
	}

	rawPayload, err := json.Marshal(payload)
	if err != nil {
		return 0, "", err
	}

	req, err := http.NewRequest(http.MethodPost, buildTaskURL(baseURL, deviceID), bytes.NewReader(rawPayload))
	if err != nil {
		return 0, "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		s.recordFailure()
		return 0, "", err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	bodyText := strings.TrimSpace(string(body))

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusAccepted {
		if resp.StatusCode >= http.StatusInternalServerError {
			s.recordFailure()
		}
		return resp.StatusCode, bodyText, fmt.Errorf("status: %d body: %s", resp.StatusCode, bodyText)
	}

	s.recordSuccess()
	s.invalidateCache()
	return resp.StatusCode, bodyText, nil
}

func (s *GenieACSService) nextTaskID() string {
	next := atomic.AddUint64(&taskCounter, 1)
	return "task-" + strconv.FormatInt(time.Now().UnixNano(), 10) + "-" + strconv.FormatUint(next, 10)
}

func (s *GenieACSService) EnqueueTask(baseURL string, deviceID string, payload map[string]interface{}) (*GenieACSTaskStatus, error) {
	if strings.TrimSpace(baseURL) == "" {
		return nil, fmt.Errorf("genieacs url is required")
	}
	if strings.TrimSpace(deviceID) == "" {
		return nil, fmt.Errorf("device id is required")
	}

	taskID := s.nextTaskID()
	now := time.Now().UTC()
	status := &GenieACSTaskStatus{
		ID:        taskID,
		DeviceID:  deviceID,
		Status:    TaskQueued,
		CreatedAt: now.Format(time.RFC3339),
		UpdatedAt: now.Format(time.RFC3339),
		Attempts:  0,
	}

	s.tasksMu.Lock()
	s.tasks[taskID] = status
	s.tasksMu.Unlock()

	job := queuedTask{id: taskID, baseURL: baseURL, deviceID: deviceID, payload: payload}
	select {
	case s.queue <- job:
		copied := *status
		return &copied, nil
	default:
		s.tasksMu.Lock()
		delete(s.tasks, taskID)
		s.tasksMu.Unlock()
		return nil, fmt.Errorf("task queue is full")
	}
}

func (s *GenieACSService) GetTaskStatus(taskID string) (*GenieACSTaskStatus, bool) {
	s.tasksMu.RLock()
	status, exists := s.tasks[taskID]
	s.tasksMu.RUnlock()
	if !exists {
		return nil, false
	}

	copy := *status
	return &copy, true
}

func (s *GenieACSService) updateTask(taskID string, updater func(*GenieACSTaskStatus)) {
	s.tasksMu.Lock()
	task, ok := s.tasks[taskID]
	if ok {
		updater(task)
		task.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	}
	s.tasksMu.Unlock()
}

func (s *GenieACSService) worker() {
	for task := range s.queue {
		s.updateTask(task.id, func(state *GenieACSTaskStatus) {
			state.Status = TaskProcessing
		})

		var (
			statusCode int
			body       string
			err        error
		)

		for attempt := 1; attempt <= 3; attempt++ {
			statusCode, body, err = s.dispatchTask(task.baseURL, task.deviceID, task.payload)
			s.updateTask(task.id, func(state *GenieACSTaskStatus) {
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
			s.updateTask(task.id, func(state *GenieACSTaskStatus) {
				state.Status = TaskFailed
				state.Error = err.Error()
				state.ResponseCode = statusCode
				state.ResponseBody = body
				state.CompletedAt = time.Now().UTC().Format(time.RFC3339)
			})
			continue
		}

		s.updateTask(task.id, func(state *GenieACSTaskStatus) {
			state.Status = TaskSuccess
			state.Error = ""
			state.ResponseCode = statusCode
			state.ResponseBody = body
			state.CompletedAt = time.Now().UTC().Format(time.RFC3339)
		})
	}
}

func (s *GenieACSService) ensureCircuitClosed() error {
	s.breakerMu.Lock()
	defer s.breakerMu.Unlock()

	now := time.Now()
	if now.Before(s.breakerOpenUntil) {
		return fmt.Errorf("genieacs circuit breaker is open until %s", s.breakerOpenUntil.UTC().Format(time.RFC3339))
	}

	if !s.breakerOpenUntil.IsZero() && now.After(s.breakerOpenUntil) {
		s.breakerOpenUntil = time.Time{}
		s.breakerFailures = 0
	}

	return nil
}

func (s *GenieACSService) recordFailure() {
	s.breakerMu.Lock()
	defer s.breakerMu.Unlock()

	s.breakerFailures++
	if s.breakerFailures >= s.breakerFailureThresh {
		s.breakerOpenUntil = time.Now().Add(s.breakerOpenDuration)
	}
}

func (s *GenieACSService) recordSuccess() {
	s.breakerMu.Lock()
	s.breakerFailures = 0
	s.breakerOpenUntil = time.Time{}
	s.breakerMu.Unlock()
}

func (s *GenieACSService) invalidateCache() {
	s.cacheMu.Lock()
	s.cache = make(map[string]cacheEntry)
	s.cacheMu.Unlock()
}
