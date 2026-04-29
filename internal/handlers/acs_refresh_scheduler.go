package handlers

import (
	"log"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"genieacs-backend/internal/services"
)

var acsAutoRefreshStartOnce sync.Once

const defaultACSAutoRefreshInterval = time.Hour
const defaultACSAutoRefreshBatchSize = 50

func StartACSAutoRefreshFromEnv() {
	acsAutoRefreshStartOnce.Do(func() {
		enabledRaw := strings.TrimSpace(os.Getenv("ACS_AUTO_REFRESH_ENABLED"))
		enabled, ok := parseBoolLike(enabledRaw)
		if !ok || !enabled {
			return
		}

		interval := defaultACSAutoRefreshInterval
		if raw := strings.TrimSpace(os.Getenv("ACS_AUTO_REFRESH_INTERVAL")); raw != "" {
			parsed, err := time.ParseDuration(raw)
			if err != nil || parsed <= 0 {
				log.Printf("[acs] invalid ACS_AUTO_REFRESH_INTERVAL=%q, fallback to %s", raw, defaultACSAutoRefreshInterval)
			} else {
				interval = parsed
			}
		}

		batchSize := defaultACSAutoRefreshBatchSize
		if raw := strings.TrimSpace(os.Getenv("ACS_AUTO_REFRESH_BATCH_SIZE")); raw != "" {
			parsed, err := strconv.Atoi(raw)
			if err != nil || parsed <= 0 {
				log.Printf("[acs] invalid ACS_AUTO_REFRESH_BATCH_SIZE=%q, fallback to %d", raw, defaultACSAutoRefreshBatchSize)
			} else {
				batchSize = parsed
			}
		}

		go runACSAutoRefreshLoop(interval, batchSize)
		log.Printf("[acs] auto refresh scheduler started interval=%s batch_size=%d mode=incomplete-only", interval, batchSize)
	})
}

func runACSAutoRefreshLoop(interval time.Duration, batchSize int) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		triggerACSAutoRefreshBatch(batchSize)
		<-ticker.C
	}
}

func triggerACSAutoRefreshBatch(batchSize int) {
	genieACSURL, err := getGenieACSURL()
	if err != nil {
		log.Printf("[acs] auto refresh skipped: %v", err)
		return
	}

	projection := []string{
		"_id",
		"_deviceId._ProductClass",
		"_deviceId._Manufacturer",
		"_virtualParameters.RXPower.value",
		"_virtualParameters.rxPower.value",
		"_virtualParameters.temperature.value",
		"_virtualParameters.Temperature.value",
		"_virtualParameters.Temperatur.value",
		"_virtualParameters.temp.value",
		"_virtualParameters.Devices-Uptime.value",
		"_virtualParameters.deviceUptime.value",
		"InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username",
		"InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress",
	}
	projection = mergeStringLists(projection, allVendorProjectionPaths())
	devices, err := fetchGenieACSDevices(genieACSURL, projection, "")
	if err != nil {
		log.Printf("[acs] auto refresh fetch devices failed: %v", err)
		return
	}

	queued := 0
	failed := 0
	processed := 0
	for _, device := range devices {
		if batchSize > 0 && processed >= batchSize {
			break
		}
		deviceID := strings.TrimSpace(extractStringFromDevice(device, []string{"_id"}))
		if deviceID == "" {
			continue
		}
		if !needsACSRefresh(device) {
			continue
		}
		queuedCount, failedCount := enqueueACSRefreshTargets(genieACSURL, deviceID, defaultACSRefreshObjects())
		queued += queuedCount
		failed += failedCount
		processed++
	}

	log.Printf("[acs] auto refresh batch done queued=%d failed=%d scanned=%d refreshed=%d total=%d", queued, failed, len(devices), processed, len(devices))
}

func needsACSRefresh(device map[string]interface{}) bool {
	vendor := extractStringFromDevice(device, []string{"_Manufacturer", "Manufacturer", "vendor", "Vendor"})
	deviceType := extractStringFromDevice(device, []string{"_ProductClass", "ProductClass", "deviceModel", "Model"})
	profile := resolveVendorProfileForDevice(device, vendor, deviceType).Profile

	pppoeUsername := extractPPPoEUsername(device, profile.PPPoEUsernameKeys)
	_, hasRXPower := extractRXPowerFromDevice(device)
	_, hasTemperature := extractTemperatureFromDevice(device)
	deviceUptime := extractDeviceUptime(device)
	return len(computeACSMissingFields(pppoeUsername, hasRXPower, hasTemperature, deviceUptime)) > 0
}

// NOTE: this function is duplicated in internal/scheduler/acs_offline_summon_scheduler.go
// If you modify this, update the duplicate too.
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

// NOTE: this function is duplicated in internal/scheduler/acs_offline_summon_scheduler.go
// If you modify this, update the duplicate too.
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
