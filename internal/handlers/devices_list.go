package handlers

import (
	"encoding/json"
	"math"
	"net/http"
	"strings"
	"time"

	"genieacs-backend/internal/models"
)

func GetDevices(w http.ResponseWriter, r *http.Request) {
	genieACSURL, err := getGenieACSURL()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{
			Error:  "Failed to resolve GenieACS URL",
			Detail: err.Error(),
		})
		return
	}

	projection := []string{
		"_id",
		"_deviceId._ProductClass",
		"_deviceId._SerialNumber",
		"_deviceId._Manufacturer",
		"_lastInform",
		"_virtualParameters.pppoeUsername.value",
		"_virtualParameters.pppoeUsername2.value",
		"_virtualParameters.PPPoEUsername.value",
		"_virtualParameters.PPPoE Username.value",
		"InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username",
		"_virtualParameters.pppoeIP.value",
		"_virtualParameters.IP PPPOE.value",
		"_virtualParameters.IPTR069.value",
		"_virtualParameters.IP TR069.value",
		"_virtualParameters.wanIpAddress.value",
		"_virtualParameters.ExternalIPAddress.value",
		"InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress",
		"_virtualParameters.RXPower.value",
		"_virtualParameters.rxPower.value",
		"_virtualParameters.OpticRxPower.value",
		"_virtualParameters.Optic Rx Power.value",
		"_virtualParameters.opticalRxPower.value",
		"InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.OpticalRxPower",
		"InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.2.X_ZTE-COM_WANPONInterfaceConfig.OpticalRxPower",
		"InternetGatewayDevice.WANDevice.2.X_ZTE-COM_WANPONInterfaceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.1.X_HW_WANPONInterfaceConfig.OpticalRxPower",
		"InternetGatewayDevice.WANDevice.1.X_HW_WANPONInterfaceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.1.X_GponInterfaceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.1.X_FH_GponInterfaceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.1.X_CMCC_EponInterfaceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.1.X_CMCC_GponInterfaceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.1.X_CU_WANEPONInterfaceConfig.OpticalTransceiver.RXPower",
		"InternetGatewayDevice.X_ALU_OntOpticalParam.RXPower",
	}
	projection = mergeStringLists(projection, allVendorProjectionPaths())
	projection = mergeStringLists(projection, defaultDeviceUptimeKeys())
	projection = mergeStringLists(projection, defaultTemperatureKeys())

	devices, err := fetchGenieACSDevices(genieACSURL, projection, "")
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		json.NewEncoder(w).Encode(models.ErrorResponse{
			Error:  "Failed to fetch from GenieACS",
			Detail: err.Error(),
		})
		return
	}

	normalized := make([]map[string]interface{}, 0, len(devices))
	enrichFallbackEnabled := true
	if len(devices) > 300 {
		enrichFallbackEnabled = false
	}
	if parsed, ok := parseBoolLike(strings.TrimSpace(r.URL.Query().Get("enrich"))); ok {
		enrichFallbackEnabled = parsed
	}
	enrichFallbackCount := 0
	const maxListEnrichFallbackFetch = 20

	for _, device := range devices {
		id := extractStringFromDevice(device, []string{"_id"})
		sn := extractStringFromDevice(device, []string{"_SerialNumber", "SerialNumber", "serialNumber"})
		deviceType := extractStringFromDevice(device, []string{"_ProductClass", "ProductClass", "deviceModel", "Model"})
		vendor := extractStringFromDevice(device, []string{"_Manufacturer", "Manufacturer", "vendor", "Vendor"})
		vendorProfile := resolveVendorProfileForDevice(device, vendor, deviceType).Profile
		pppoe := extractPPPoEUsername(device, nil)
		ip := firstNonEmpty(extractPPPoEIP(device), extractTR069IP(device))
		deviceUptime := extractDeviceUptime(device)
		var temperature interface{}
		hasTemperature := false
		if temp, ok := extractTemperatureFromDevice(device); ok {
			temperature = math.Round(temp*100) / 100
			hasTemperature = true
		} else {
			temperature = nil
		}

		var rxOptical interface{}
		hasRXPower := false
		if rx, ok := extractRXPowerFromDevice(device); ok {
			rxOptical = math.Round(rx*100) / 100
			hasRXPower = true
		} else {
			rxOptical = nil
		}

		needsEnrichFallback := strings.TrimSpace(pppoe) == "" || strings.TrimSpace(ip) == "" || strings.TrimSpace(deviceUptime) == "" || rxOptical == nil || temperature == nil
		if enrichFallbackEnabled && needsEnrichFallback && strings.TrimSpace(id) != "" && enrichFallbackCount < maxListEnrichFallbackFetch {
			if rawDevice, rawErr := fetchGenieACSDeviceByID(genieACSURL, id, nil); rawErr == nil && rawDevice != nil {
				enrichFallbackCount++

				if strings.TrimSpace(pppoe) == "" {
					pppoe = extractPPPoEUsername(rawDevice, nil)
				}

				if strings.TrimSpace(ip) == "" {
					ip = firstNonEmpty(extractPPPoEIP(rawDevice), extractTR069IP(rawDevice))
				}

				if strings.TrimSpace(deviceUptime) == "" {
					deviceUptime = extractDeviceUptime(rawDevice)
				}

				if rxOptical == nil {
					if fallbackRX, fallbackOK := extractRXPowerFromDevice(rawDevice); fallbackOK {
						rxOptical = math.Round(fallbackRX*100) / 100
					}
				}

				if temperature == nil {
					if fallbackTemp, fallbackOK := extractTemperatureFromDevice(rawDevice); fallbackOK {
						temperature = math.Round(fallbackTemp*100) / 100
					}
				}
			}
		}

		lastInformAt := ""
		if lastInform, ok := parseLastInform(device); ok {
			lastInformAt = lastInform.UTC().Format(time.RFC3339)
		} else {
			lastInformAt = extractStringFromDevice(device, []string{"_lastInform"})
		}

		vendorLabel := compactVendorName(vendor, vendorProfile.Key)
		vendorType := strings.TrimSpace(strings.TrimSpace(vendorLabel) + "/" + strings.TrimSpace(deviceType))
		vendorType = strings.Trim(vendorType, "/")

		pppoeDisplay := dashIfEmpty(pppoe)
		ipDisplay := dashIfEmpty(ip)
		uptimeDisplay := dashIfEmpty(deviceUptime)
		missingFields := computeACSMissingFields(pppoe, hasRXPower, hasTemperature, deviceUptime)

		normalized = append(normalized, map[string]interface{}{
			"id":             id,
			"sn":             sn,
			"vendor_type":    vendorType,
			"pppoe":          pppoeDisplay,
			"pppoe_username": pppoeDisplay,
			"ip":             ipDisplay,
			"ip_address":     ipDisplay,
			"rx_optical":     rxOptical,
			"rx_power":       rxOptical,
			"temp":           temperature,
			"device_uptime":  uptimeDisplay,
			"last_inform":    lastInformAt,
			"is_incomplete":  len(missingFields) > 0,
			"missing_fields": missingFields,
		})
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(normalized)
}
