package scheduler

import (
	"log"
	"strings"
	"sync"
	"time"

	"genieacs-backend/internal/db"
	"genieacs-backend/internal/services"
)

const (
	offlineSummonInterval = 5 * time.Minute
	offlineThreshold       = 10 * time.Minute
	maxThreshold           = 24 * time.Hour
	cooldownDuration       = 15 * time.Minute

	cooldownCleanupAge = cooldownDuration * 2
)

var summonCooldown sync.Map

var offlineSummonStartOnce sync.Once

func StartACSOfflineSummonScheduler() {
	offlineSummonStartOnce.Do(func() {
		go runOfflineSummonLoop()
		log.Printf("[offline-summon] scheduler started, interval=%s offline_threshold=%s max_threshold=%s cooldown=%s",
			offlineSummonInterval, offlineThreshold, maxThreshold, cooldownDuration)
	})
}

func runOfflineSummonLoop() {
	ticker := time.NewTicker(offlineSummonInterval)
	defer ticker.Stop()

	processOfflineDevices()

	for {
		<-ticker.C
		processOfflineDevices()
	}
}

func processOfflineDevices() {
	genieACSURL, err := getGenieACSURL()
	if err != nil {
		log.Printf("[offline-summon] skipped: failed to resolve GenieACS URL: %v", err)
		return
	}

	svc := services.GetGenieACSService()

	projection := []string{"_id", "_lastInform"}
	devices, err := svc.FetchDevices(genieACSURL, projection, "")
	if err != nil {
		log.Printf("[offline-summon] skipped: failed to fetch devices: %v", err)
		return
	}

	now := time.Now()
	summoned := 0
	skipped := 0
	cooldownHit := 0

	cleanupCooldown(now)

	for _, device := range devices {
		deviceID := extractDeviceID(device)
		if deviceID == "" {
			continue
		}

		if strings.HasPrefix(deviceID, "DISCOVERYSERVICE") ||
			strings.HasPrefix(deviceID, "000000-probe") {
			skipped++
			continue
		}

		lastInform, ok := parseLastInform(device)
		if !ok {
			skipped++
			continue
		}

		sinceLast := now.Sub(lastInform)

		if sinceLast < offlineThreshold {
			skipped++
			continue
		}

		if sinceLast > maxThreshold {
			skipped++
			continue
		}

		lastSummonedRaw, loaded := summonCooldown.Load(deviceID)
		if loaded {
			lastSummoned, ok := lastSummonedRaw.(time.Time)
			if ok && now.Sub(lastSummoned) < cooldownDuration {
				cooldownHit++
				continue
			}
		}

		queued, failed := enqueueACSRefreshTargets(genieACSURL, deviceID, defaultACSRefreshObjects())
		if failed > 0 && queued == 0 {
			log.Printf("[offline-summon] failed to enqueue refresh for %s: queued=%d failed=%d", deviceID, queued, failed)
			continue
		}

		summonCooldown.Store(deviceID, now)
		summoned++
		log.Printf("[offline-summon] summoned %s (lastInform: %s ago)", deviceID, sinceLast.Round(time.Second))
		time.Sleep(50 * time.Millisecond)
	}

	log.Printf("[offline-summon] batch done: summoned=%d skipped=%d cooldown=%d total=%d", summoned, skipped, cooldownHit, len(devices))
}

func cleanupCooldown(now time.Time) {
	summonCooldown.Range(func(key, value interface{}) bool {
		t, ok := value.(time.Time)
		if !ok || now.Sub(t) > cooldownCleanupAge {
			summonCooldown.Delete(key)
		}
		return true
	})
}

// NOTE: functions below are duplicated from internal/handlers/ to avoid circular import.
// If you modify the originals in handlers/, update these duplicates too.

func getGenieACSURL() (string, error) {
	settings, err := db.GetSettings([]string{"genieacs_url"})
	if err != nil {
		return "", err
	}

	genieACSURL := strings.TrimSpace(settings["genieacs_url"])
	if genieACSURL == "" {
		return "", errGenieACSURLNotConfigured
	}

	return genieACSURL, nil
}

var errGenieACSURLNotConfigured = errGenieACSURL("genieacs_url is not configured")

type errGenieACSURL string

func (e errGenieACSURL) Error() string { return string(e) }

func parseLastInform(device map[string]interface{}) (time.Time, bool) {
	value, ok := extractValue(device, "_lastInform")
	if !ok {
		return time.Time{}, false
	}

	text, ok := value.(string)
	if !ok || text == "" {
		return time.Time{}, false
	}

	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05.000Z07:00",
		"2006-01-02 15:04:05",
	}

	for _, layout := range layouts {
		if parsed, err := time.Parse(layout, text); err == nil {
			return parsed, true
		}
	}

	return time.Time{}, false
}

func extractDeviceID(device map[string]interface{}) string {
	if id, ok := device["_id"]; ok {
		if s, ok := id.(string); ok && s != "" {
			return s
		}
	}
	return ""
}

func extractValue(device map[string]interface{}, key string) (interface{}, bool) {
	val, ok := device[key]
	if !ok {
		return nil, false
	}
	return val, true
}

func defaultACSRefreshObjects() []string {
	return []string{
		"InternetGatewayDevice.WANDevice",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration",
		"InternetGatewayDevice.LANDevice.1.Hosts",
		"InternetGatewayDevice.DeviceInfo",
		"InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig",
		"InternetGatewayDevice.WANDevice.2.X_ZTE-COM_WANPONInterfaceConfig",
		"InternetGatewayDevice.WANDevice.1.X_HW_WANPONInterfaceConfig",
		"InternetGatewayDevice.WANDevice.1.X_GponInterfaceConfig",
		"InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig",
		"InternetGatewayDevice.WANDevice.1.X_FH_GponInterfaceConfig",
	}
}

func enqueueACSRefreshTargets(genieACSURL string, deviceID string, objectNames []string) (int, int) {
	queued := 0
	failed := 0
	for _, objectName := range objectNames {
		trimmed := strings.TrimSpace(objectName)
		if trimmed == "" {
			continue
		}
		if _, err := services.GetGenieACSService().EnqueueTask(genieACSURL, deviceID, map[string]interface{}{
			"name":       "refreshObject",
			"objectName": trimmed,
		}); err != nil {
			failed++
			continue
		}
		queued++
	}
	return queued, failed
}