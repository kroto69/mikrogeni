package handlers

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"math"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"genieacs-backend/internal/db"
	"genieacs-backend/internal/models"
	"genieacs-backend/internal/services"
)

// Dashboard aggregate endpoint.
//
// The frontend used to fan out 4 + 2N + 2M HTTP requests on every dashboard
// open (ACS list, per-router ppp/active + detail, per-OLT health). This
// handler computes the same summary server-side, in parallel, and caches the
// result for a short TTL so reopening the dashboard is a single fast request.

const (
	dashboardCacheTTL   = 30 * time.Second
	dashboardMaxParallel = 8
	dashboardZTETimeout  = 10 * time.Second
)

type dashboardCacheEntry struct {
	expiresAt time.Time
	summary   models.DashboardSummary
}

type dashboardCall struct {
	done    chan struct{}
	summary models.DashboardSummary
	err     error
}

var (
	dashboardMu       sync.Mutex
	dashboardCached   *dashboardCacheEntry
	dashboardInflight *dashboardCall
)

func GetDashboard(w http.ResponseWriter, r *http.Request) {
	summary, err := getDashboardSummary(r)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to build dashboard summary", Detail: err.Error()})
		return
	}

	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(summary)
}

func HealthCheck(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// getDashboardSummary returns the cached summary when fresh, otherwise builds
// it once even under concurrent load (singleflight).
func getDashboardSummary(r *http.Request) (models.DashboardSummary, error) {
	dashboardMu.Lock()
	if dashboardCached != nil && time.Now().Before(dashboardCached.expiresAt) {
		summary := dashboardCached.summary
		dashboardMu.Unlock()
		return summary, nil
	}
	if dashboardInflight != nil {
		inflight := dashboardInflight
		dashboardMu.Unlock()
		<-inflight.done
		return inflight.summary, inflight.err
	}
	inflight := &dashboardCall{done: make(chan struct{})}
	dashboardInflight = inflight
	dashboardMu.Unlock()

	summary, err := buildDashboardSummary(r)

	dashboardMu.Lock()
	if err == nil {
		dashboardCached = &dashboardCacheEntry{
			expiresAt: time.Now().Add(dashboardCacheTTL),
			summary:   summary,
		}
	}
	dashboardInflight = nil
	inflight.summary = summary
	inflight.err = err
	close(inflight.done)
	dashboardMu.Unlock()

	return summary, err
}

func buildDashboardSummary(r *http.Request) (models.DashboardSummary, error) {
	var summary models.DashboardSummary

	var wg sync.WaitGroup
	wg.Add(4)

	go func() {
		defer wg.Done()
		summary.ACS = buildDashboardACSSection()
	}()

	go func() {
		defer wg.Done()
		summary.MikroTik = buildDashboardMikroTikSection()
	}()

	go func() {
		defer wg.Done()
		summary.OLT.Hioso = buildDashboardHiosoSection()
	}()

	go func() {
		defer wg.Done()
		summary.OLT.ZTE = buildDashboardZTESection(r)
	}()

	wg.Wait()

	summary.OLT.Total = len(summary.OLT.Hioso) + len(summary.OLT.ZTE)
	return summary, nil
}

func buildDashboardACSSection() models.DashboardACSSummary {
	section := models.DashboardACSSummary{}

	genieACSURL, err := getGenieACSURL()
	if err != nil {
		log.Printf("[dashboard] acs skipped: %v", err)
		return section
	}

	projection := []string{
		"_id",
		"_lastInform",
		"InternetGatewayDevice.DeviceInfo.TemperatureStatus.TemperatureSensor.1.Value",
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

	devices, err := fetchGenieACSDevices(genieACSURL, projection, "")
	if err != nil {
		log.Printf("[dashboard] acs fetch failed: %v", err)
		return section
	}

	now := time.Now().UTC()
	onlineThreshold := 10 * time.Minute

	onlineCount := 0
	runningRXTotal := 0.0
	runningTempTotal := 0.0
	rXCount := 0
	tempCount := 0

	for _, device := range devices {
		if lastInform, ok := parseLastInform(device); ok && now.Sub(lastInform) <= onlineThreshold {
			onlineCount++
		}

		if rxPower, ok := extractRXPowerFromDevice(device); ok {
			runningRXTotal += rxPower
			rXCount++
		}

		if temperature, ok := extractNumericFromDevice(device, []string{"Temperature", "temperature", "Value"}); ok {
			runningTempTotal += temperature
			tempCount++
		}
	}

	section.TotalDevices = len(devices)
	section.OnlineDevices = onlineCount
	section.OfflineDevices = len(devices) - onlineCount
	if rXCount > 0 {
		section.AverageRXPower = math.Round((runningRXTotal/float64(rXCount))*100) / 100
	}
	if tempCount > 0 {
		section.AverageTemp = math.Round((runningTempTotal/float64(tempCount))*100) / 100
	}
	return section
}

func buildDashboardMikroTikSection() models.DashboardMikroTikSummary {
	section := models.DashboardMikroTikSummary{
		Devices: []models.DashboardMikroTikDevice{},
	}

	devices, err := db.ListMikroTikDevices("", "", 0)
	if err != nil {
		log.Printf("[dashboard] mikrotik list failed: %v", err)
		return section
	}

	out := make([]models.DashboardMikroTikDevice, len(devices))
	var totalPPP int64
	var onlineCount int64

	sem := make(chan struct{}, dashboardMaxParallel)
	var wg sync.WaitGroup
	for i, device := range devices {
		wg.Add(1)
		go func(i int, device db.MikroTikDeviceRecord) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			pppActive := 0
			if rows, err := services.GetMikroTikService().ListPPPActive(device.ID); err == nil {
				pppActive = len(rows)
			} else {
				log.Printf("[dashboard] mikrotik ppp/active failed for %s: %v", device.Host, err)
			}
			atomic.AddInt64(&totalPPP, int64(pppActive))

			status := strings.TrimSpace(device.Status)
			if status == "online" {
				atomic.AddInt64(&onlineCount, 1)
			}

			// Same values the frontend got from GET /mikrotik/devices/{id}?cached=1:
			// identity falls back to the DB name, cpu/uptime are "-" without a live sync.
			out[i] = models.DashboardMikroTikDevice{
				ID:        device.ID,
				Host:      device.Host,
				Name:      device.Name,
				Status:    status,
				Identity:  firstNonEmptyMikroTik(device.Name, device.Host),
				CPULoad:   "-",
				Uptime:    "-",
				PPPActive: pppActive,
			}
		}(i, device)
	}
	wg.Wait()

	section.Total = len(devices)
	section.Online = int(onlineCount)
	section.TotalPPPActive = int(totalPPP)
	section.Devices = out
	return section
}

func buildDashboardHiosoSection() []models.DashboardHiosoOLT {
	devices, err := db.ListHiosoDevices()
	if err != nil {
		log.Printf("[dashboard] hioso list failed: %v", err)
		return []models.DashboardHiosoOLT{}
	}

	out := make([]models.DashboardHiosoOLT, len(devices))
	sem := make(chan struct{}, dashboardMaxParallel)
	var wg sync.WaitGroup
	for i, device := range devices {
		wg.Add(1)
		go func(i int, device db.HiosoDevice) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			row := models.DashboardHiosoOLT{
				ID:   device.ID,
				Name: device.Name,
				Host: device.Host,
			}

			info, err := queryHiosoSystemInfo(device)
			if err == nil && info != nil && strings.TrimSpace(info.Model) != "" {
				row.Online = true
				row.Model = info.Model
				row.ONUTotal = info.TotalONU
				row.ONUOnline = info.OnlineONU
				row.CPU = info.CPU
				row.Uptime = info.Uptime
			}
			out[i] = row
		}(i, device)
	}
	wg.Wait()
	return out
}

func queryHiosoSystemInfo(device db.HiosoDevice) (*HiosoSystemInfo, error) {
	driver, err := HiosoNewDriver(device.FirmwareType, device.Host, device.Port, device.Username, device.Password)
	if err != nil {
		return nil, err
	}
	defer driver.Close()
	return driver.GetSystemInfo()
}

// zteSystemInfo mirrors the OLTSystemInfo JSON returned by the zzte backend
// (GET /api/v1/system/olts), which itself is cached server-side for 5 minutes.
type zteSystemInfo struct {
	OltID       string `json:"oltId"`
	Name        string `json:"name"`
	Host        string `json:"host"`
	Uptime      string `json:"uptime"`
	CPUUsage    int    `json:"cpuUsage"`
	MemoryUsage int    `json:"memoryUsage"`
	IsOnline    bool   `json:"isOnline"`
}

func buildDashboardZTESection(r *http.Request) []models.DashboardZTEOLT {
	conns, err := db.ListZTEConnections()
	if err != nil {
		log.Printf("[dashboard] zte connections list failed: %v", err)
		return []models.DashboardZTEOLT{}
	}
	if len(conns) == 0 {
		return []models.DashboardZTEOLT{}
	}

	// One batched call per distinct zzte base URL instead of one per connection.
	healthByOltID := map[string]zteSystemInfo{}
	baseURLs := map[string]struct{}{}
	for _, conn := range conns {
		if base := strings.TrimSpace(conn.BaseURL); base != "" {
			baseURLs[base] = struct{}{}
		}
	}

	authHeader := ""
	if r != nil {
		authHeader = r.Header.Get("Authorization")
	}

	var mu sync.Mutex
	var wg sync.WaitGroup
	for baseURL := range baseURLs {
		wg.Add(1)
		go func(baseURL string) {
			defer wg.Done()
			for _, info := range fetchZTEAllSystemInfo(baseURL, authHeader) {
				mu.Lock()
				healthByOltID[info.OltID] = info
				mu.Unlock()
			}
		}(baseURL)
	}
	wg.Wait()

	out := make([]models.DashboardZTEOLT, 0, len(conns))
	for _, conn := range conns {
		row := models.DashboardZTEOLT{
			ID:      conn.ID,
			Name:    conn.Name,
			BaseURL: conn.BaseURL,
			OltID:   conn.OltID,
		}
		if info, ok := healthByOltID[conn.OltID]; ok {
			row.Online = info.IsOnline
			row.CPUUsage = info.CPUUsage
			row.MemoryUsage = info.MemoryUsage
			row.Uptime = info.Uptime
		}
		out = append(out, row)
	}
	return out
}

func fetchZTEAllSystemInfo(baseURL, authHeader string) []zteSystemInfo {
	ctx, cancel := context.WithTimeout(context.Background(), dashboardZTETimeout)
	defer cancel()

	target := strings.TrimRight(baseURL, "/") + "/api/v1/system/olts"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		log.Printf("[dashboard] zte system/olts request build failed: %v", err)
		return nil
	}
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("[dashboard] zte system/olts failed for %s: %v", baseURL, err)
		return nil
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		log.Printf("[dashboard] zte system/olts read failed: %v", err)
		return nil
	}

	// zzte wraps payloads as {"success":true,"data":[...]}.
	var envelope struct {
		Success bool            `json:"success"`
		Data    []zteSystemInfo `json:"data"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil || !envelope.Success {
		// Fall back to a bare array just in case.
		var bare []zteSystemInfo
		if err := json.Unmarshal(body, &bare); err != nil {
			log.Printf("[dashboard] zte system/olts decode failed: %v", err)
			return nil
		}
		return bare
	}
	return envelope.Data
}
