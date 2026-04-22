package handlers

import (
	"encoding/json"
	"fmt"
	"math"
	"net"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

var numberPattern = regexp.MustCompile(`[-+]?\d*\.?\d+`)
var placeholderSSIDPattern = regexp.MustCompile(`(?i)^ssid\d*$`)
var wlanIndexPattern = regexp.MustCompile(`(?i)WLANConfiguration\.(\d+)`)
var accessPointIndexPattern = regexp.MustCompile(`(?i)AccessPoint\.(\d+)`)

func extractValueByKey(data interface{}, target string) (interface{}, bool) {
	switch node := data.(type) {
	case map[string]interface{}:
		if val, ok := node[target]; ok {
			return val, true
		}
		for _, child := range node {
			if val, ok := extractValueByKey(child, target); ok {
				return val, true
			}
		}
	case []interface{}:
		for _, item := range node {
			if val, ok := extractValueByKey(item, target); ok {
				return val, true
			}
		}
	}

	return nil, false
}

func extractStringValue(value interface{}) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(v)
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(v), 'f', -1, 64)
	case int:
		return strconv.Itoa(v)
	case int64:
		return strconv.FormatInt(v, 10)
	case json.Number:
		return v.String()
	case map[string]interface{}:
		if inner, ok := v["_value"]; ok {
			return extractStringValue(inner)
		}
		if inner, ok := v["value"]; ok {
			return extractStringValue(inner)
		}
	case []interface{}:
		if len(v) > 0 {
			return extractStringValue(v[0])
		}
	}

	return ""
}

func extractNumericValue(value interface{}) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case json.Number:
		parsed, err := v.Float64()
		if err == nil {
			return parsed, true
		}
	}

	text := extractStringValue(value)
	if text == "" {
		return 0, false
	}

	number := numberPattern.FindString(text)
	if number == "" {
		return 0, false
	}

	parsed, err := strconv.ParseFloat(number, 64)
	if err != nil {
		return 0, false
	}

	return parsed, true
}

func extractNumericFromDevice(device map[string]interface{}, keyCandidates []string) (float64, bool) {
	for _, key := range keyCandidates {
		var (
			value interface{}
			ok    bool
		)
		if strings.Contains(key, ".") {
			value, ok = extractValueByPath(device, key)
		} else {
			value, ok = extractValueByKey(device, key)
		}

		if ok {
			if parsed, ok := extractNumericValue(value); ok {
				return parsed, true
			}
		}
	}

	return 0, false
}

func extractNumericFromDeviceWithValidator(device map[string]interface{}, keyCandidates []string, validator func(float64) (float64, bool)) (float64, bool) {
	for _, key := range keyCandidates {
		var (
			value interface{}
			ok    bool
		)

		if strings.Contains(key, ".") {
			value, ok = extractValueByPath(device, key)
		} else {
			value, ok = extractValueByKey(device, key)
		}

		if !ok {
			continue
		}

		parsed, parsedOK := extractNumericValue(value)
		if !parsedOK {
			continue
		}

		if validator == nil {
			return parsed, true
		}

		if normalized, valid := validator(parsed); valid {
			return normalized, true
		}
	}

	return 0, false
}

func keyLooksLikeRXPower(key string) bool {
	normalized := normalizeLookupKey(key)
	if strings.Contains(normalized, "wifi") || strings.Contains(normalized, "wlan") || strings.Contains(normalized, "radio") || strings.Contains(normalized, "rssi") || strings.Contains(normalized, "signal") {
		return false
	}

	if normalized == "rxpower" || normalized == "opticalrxpower" || normalized == "downstreamopticalpower" || normalized == "downstreamrxpower" {
		return true
	}

	if strings.Contains(normalized, "rx") && strings.Contains(normalized, "power") {
		if strings.Contains(normalized, "optic") || strings.Contains(normalized, "pon") || strings.Contains(normalized, "gpon") || strings.Contains(normalized, "epon") || strings.Contains(normalized, "wan") {
			return true
		}
	}

	return false
}

func keyLooksLikeTemperature(key string) bool {
	normalized := normalizeLookupKey(key)
	return strings.Contains(normalized, "temp") || strings.Contains(normalized, "temperature")
}

func extractNumericByKeyPattern(data interface{}, matcher func(string) bool) (float64, bool) {
	switch node := data.(type) {
	case map[string]interface{}:
		for key, value := range node {
			if matcher(key) {
				if parsed, ok := extractNumericValue(value); ok {
					return parsed, true
				}
			}
		}

		for _, child := range node {
			if parsed, ok := extractNumericByKeyPattern(child, matcher); ok {
				return parsed, true
			}
		}
	case []interface{}:
		for _, child := range node {
			if parsed, ok := extractNumericByKeyPattern(child, matcher); ok {
				return parsed, true
			}
		}
	}

	return 0, false
}

func extractRXPowerFromDevice(device map[string]interface{}) (float64, bool) {
	if rxPower, ok := extractZTEWANPONRawRXPower(device); ok {
		return rxPower, true
	}

	if rxPower, ok := extractNumericFromDeviceWithValidator(device, []string{
		"_virtualParameters.Optic Rx Power.value",
		"_virtualParameters.OpticRxPower.value",
		"_virtualParameters.opticalRxPower.value",
		"_virtualParameters.RXPower.value",
		"_virtualParameters.rxPower.value",
		"InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.OpticalRxPower",
		"InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.RxPower",
		"InternetGatewayDevice.WANDevice.2.X_ZTE-COM_WANPONInterfaceConfig.OpticalRxPower",
		"InternetGatewayDevice.WANDevice.2.X_ZTE-COM_WANPONInterfaceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.2.X_ZTE-COM_WANPONInterfaceConfig.RxPower",
		"InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.ReceivedOpticalPower",
		"InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.RcvPower",
		"InternetGatewayDevice.WANDevice.2.X_ZTE-COM_WANPONInterfaceConfig.ReceivedOpticalPower",
		"InternetGatewayDevice.WANDevice.2.X_ZTE-COM_WANPONInterfaceConfig.RcvPower",
		"InternetGatewayDevice.WANDevice.1.X_HW_WANPONInterfaceConfig.OpticalRxPower",
		"InternetGatewayDevice.WANDevice.1.X_HW_WANPONInterfaceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.1.X_HW_WANPONInterfaceConfig.RxPower",
		"InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.1.X_GponInterfaceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.1.X_FH_GponInterfaceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.1.X_CMCC_EponInterfaceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.1.X_CMCC_GponInterfaceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.1.X_CU_WANEPONInterfaceConfig.OpticalTransceiver.RXPower",
		"InternetGatewayDevice.X_ALU_OntOpticalParam.RXPower",
		"Optic Rx Power",
		"OpticRxPower",
		"OpticalRxPower",
		"rxPower",
		"RXPower",
		"RxPower",
		"opticalRxPower",
		"optical_rx_power",
		"DownstreamOpticalPower",
		"downstreamOpticalPower",
		"DownstreamRxPower",
		"downstreamRxPower",
	}, normalizeRXPowerValue); ok {
		return rxPower, true
	}

	if rxPower, ok := extractRXPowerFromKnownNodes(device); ok {
		return rxPower, true
	}

	if rxPower, ok := extractNumericByKeyPattern(device, keyLooksLikeRXPower); ok {
		if normalized, valid := normalizeRXPowerValue(rxPower); valid {
			return normalized, true
		}
	}

	return 0, false
}

func extractZTEWANPONRawRXPower(device map[string]interface{}) (float64, bool) {
	paths := []string{
		"InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.RxPower",
		"InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.ReceivedOpticalPower",
		"InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.RcvPower",
		"InternetGatewayDevice.WANDevice.2.X_ZTE-COM_WANPONInterfaceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.2.X_ZTE-COM_WANPONInterfaceConfig.RxPower",
		"InternetGatewayDevice.WANDevice.2.X_ZTE-COM_WANPONInterfaceConfig.ReceivedOpticalPower",
		"InternetGatewayDevice.WANDevice.2.X_ZTE-COM_WANPONInterfaceConfig.RcvPower",
	}

	for _, path := range paths {
		value, ok := extractValueByPath(device, path)
		if !ok {
			continue
		}
		raw, parsed := extractNumericValue(value)
		if !parsed || raw <= 0 {
			continue
		}

		if raw <= 1000 {
			dbm := 10*math.Log10(raw) - 40
			if dbm >= -60 && dbm <= 10 {
				return math.Round(dbm*100) / 100, true
			}
		}
	}

	return 0, false
}

func extractRXPowerFromKnownNodes(device map[string]interface{}) (float64, bool) {
	nodeKeys := []string{
		"X_ZTE-COM_WANPONInterfaceConfig",
		"X_GponInterafceConfig",
		"X_GponInterfaceConfig",
		"X_FH_GponInterfaceConfig",
		"X_CMCC_EponInterfaceConfig",
		"X_CMCC_GponInterfaceConfig",
		"X_CT-COM_EponInterfaceConfig",
		"X_CT-COM_GponInterfaceConfig",
		"X_CU_WANEPONInterfaceConfig",
		"X_ALU_OntOpticalParam",
	}

	for _, nodeKey := range nodeKeys {
		node, ok := extractValueByKey(device, nodeKey)
		if !ok {
			continue
		}

		switch typed := node.(type) {
		case map[string]interface{}:
			if rxPower, found := extractRXFromNodeMap(typed); found {
				return rxPower, true
			}
		case []interface{}:
			for _, item := range typed {
				if asMap, ok := item.(map[string]interface{}); ok {
					if rxPower, found := extractRXFromNodeMap(asMap); found {
						return rxPower, true
					}
				}
			}
		}
	}

	return 0, false
}

func extractRXFromNodeMap(node map[string]interface{}) (float64, bool) {
	if rxPower, ok := extractNumericFromDeviceWithValidator(node, []string{
		"RXPower",
		"OpticalRxPower",
		"RxPower",
		"DownstreamOpticalPower",
		"DownstreamRxPower",
		"OpticalTransceiver.RXPower",
	}, normalizeRXPowerValue); ok {
		return rxPower, true
	}

	if rxPower, ok := extractNumericByKeyPattern(node, keyLooksLikeRXPower); ok {
		if normalized, valid := normalizeRXPowerValue(rxPower); valid {
			return normalized, true
		}
	}

	return 0, false
}

func defaultTemperatureKeys() []string {
	return []string{
		"_virtualParameters.Temperatur.value",
		"_virtualParameters.temperature.value",
		"_virtualParameters.Temperature.value",
		"_virtualParameters.temp.value",
		"_virtualParameters.cpuTemp.value",
		"_virtualParameters.CpuTemp.value",
		"_virtualParameters.cpuTemperature.value",
		"_virtualParameters.CPUTemperature.value",
		"_virtualParameters.boardTemp.value",
		"_virtualParameters.boardTemperature.value",
		"_virtualParameters.onuTemperature.value",
		"Device.DeviceInfo.TemperatureStatus.CPUTemperature",
		"Device.DeviceInfo.TemperatureStatus.CPU",
		"Device.DeviceInfo.TemperatureStatus.BoardTemperature",
		"InternetGatewayDevice.DeviceInfo.TemperatureStatus.CPUTemperature",
		"InternetGatewayDevice.DeviceInfo.TemperatureStatus.CPU",
		"InternetGatewayDevice.DeviceInfo.TemperatureStatus.BoardTemperature",
		"InternetGatewayDevice.DeviceInfo.X_HW_Temperature",
		"InternetGatewayDevice.DeviceInfo.X_ZTE-COM_Temperature",
		"InternetGatewayDevice.DeviceInfo.X_FH_Temperature",
		"InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.Temperature",
		"InternetGatewayDevice.WANDevice.1.X_HW_WANPONInterfaceConfig.Temperature",
		"Temperatur",
		"temperature",
		"Temperature",
		"temp",
		"Temp",
		"cpuTemp",
		"CpuTemp",
		"boardTemp",
		"BoardTemp",
		"deviceTemperature",
		"DeviceTemperature",
		"boardTemperature",
		"BoardTemperature",
		"cpuTemperature",
		"CPUTemperature",
		"CpuTemperature",
		"onuTemperature",
		"OnuTemperature",
		"moduleTemperature",
		"ModuleTemperature",
		"TemperatureStatus",
		"temperatureStatus",
		"X_HW_Temperature",
		"X_ZTE-COM_Temperature",
		"X_FH_Temperature",
	}
}

func extractTemperatureFromDevice(device map[string]interface{}) (float64, bool) {
	if temperature, ok := extractNumericFromDeviceWithValidator(device, defaultTemperatureKeys(), normalizeTemperatureValue); ok {
		return temperature, true
	}

	if temperature, ok := extractNumericByKeyPattern(device, keyLooksLikeTemperature); ok {
		if normalized, valid := normalizeTemperatureValue(temperature); valid {
			return normalized, true
		}
	}

	return 0, false
}

func defaultPPPoEIPKeys() []string {
	return []string{
		"_virtualParameters.pppoeIP.value",
		"_virtualParameters.IP PPPOE.value",
		"_virtualParameters.IPPPPOE.value",
		"pppoeIP",
		"IP PPPOE",
		"IPPPPOE",
		"InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress",
		"InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.2.ExternalIPAddress",
	}
}

func defaultTR069IPKeys() []string {
	return []string{
		"_virtualParameters.IPTR069.value",
		"_virtualParameters.IP TR069.value",
		"IPTR069",
		"IP TR069",
		"tr069IpAddress",
		"TR069IPAddress",
		"InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress",
	}
}

func defaultLocalIPKeys() []string {
	return []string{
		"_virtualParameters.lanIpAddress.value",
		"lanIpAddress",
		"LANIPAddress",
		"InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.IPInterface.1.IPInterfaceIPAddress",
		"InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.IPRouters",
		"Device.LAN.IPAddress",
	}
}

func extractPPPoEIP(device map[string]interface{}) string {
	return extractStringFromDevice(device, defaultPPPoEIPKeys())
}

func extractTR069IP(device map[string]interface{}) string {
	if ip := extractConnectionRequestHostIP(device); ip != "" {
		return ip
	}
	return extractStringFromDevice(device, defaultTR069IPKeys())
}

func extractConnectionRequestHostIP(device map[string]interface{}) string {
	rawURL := extractStringFromDevice(device, []string{
		"InternetGatewayDevice.ManagementServer.ConnectionRequestURL",
		"Device.ManagementServer.ConnectionRequestURL",
	})
	if rawURL == "" {
		return ""
	}
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Host == "" {
		return ""
	}
	host := parsed.Hostname()
	if net.ParseIP(host) == nil {
		return ""
	}
	return host
}

func extractLocalIP(device map[string]interface{}) string {
	return extractStringFromDevice(device, defaultLocalIPKeys())
}

func defaultDeviceUptimeKeys() []string {
	return []string{
		"_virtualParameters.Devices-Uptime.value",
		"_virtualParameters.Devices Uptime.value",
		"_virtualParameters.deviceUptime.value",
		"_virtualParameters.DeviceUptime.value",
		"Devices-Uptime",
		"Devices Uptime",
		"deviceUptime",
		"DeviceUptime",
		"InternetGatewayDevice.DeviceInfo.UpTime",
		"Device.DeviceInfo.UpTime",
	}
}

func extractDeviceUptime(device map[string]interface{}) string {
	return normalizeDeviceUptime(extractStringFromDevice(device, defaultDeviceUptimeKeys()))
}

func extractStringFromDevice(device map[string]interface{}, keyCandidates []string) string {
	for _, key := range keyCandidates {
		var (
			value interface{}
			ok    bool
		)

		if strings.Contains(key, ".") {
			value, ok = extractValueByPath(device, key)
		} else {
			value, ok = extractValueByKey(device, key)
		}

		if ok {
			parsed := extractStringValue(value)
			if parsed != "" {
				return parsed
			}
		}
	}

	return ""
}

func extractTagsFromDevice(device map[string]interface{}) []string {
	value, ok := device["_tags"]
	if !ok || value == nil {
		return []string{}
	}

	tags := make([]string, 0)
	switch raw := value.(type) {
	case []interface{}:
		for _, item := range raw {
			text := strings.TrimSpace(extractStringValue(item))
			if text != "" {
				tags = append(tags, text)
			}
		}
	case []string:
		for _, item := range raw {
			text := strings.TrimSpace(item)
			if text != "" {
				tags = append(tags, text)
			}
		}
	}

	return tags
}

func sortedMapKeys(node map[string]interface{}) []string {
	keys := make([]string, 0, len(node))
	for key := range node {
		keys = append(keys, key)
	}

	sort.Slice(keys, func(i, j int) bool {
		left, leftErr := strconv.Atoi(keys[i])
		right, rightErr := strconv.Atoi(keys[j])
		if leftErr == nil && rightErr == nil {
			return left < right
		}
		return keys[i] < keys[j]
	})

	return keys
}

func extractSSIDList(device map[string]interface{}) []string {
	ssidSeen := make(map[string]struct{})
	ssids := make([]string, 0)

	wlanConfigValue, ok := extractValueByKey(device, "WLANConfiguration")
	if !ok {
		return ssids
	}

	wlanConfig, ok := wlanConfigValue.(map[string]interface{})
	if !ok {
		return ssids
	}

	for _, key := range sortedMapKeys(wlanConfig) {
		entry, ok := wlanConfig[key].(map[string]interface{})
		if !ok {
			continue
		}

		ssidValue, ok := entry["SSID"]
		if !ok {
			continue
		}

		ssid := strings.TrimSpace(extractStringValue(ssidValue))
		if ssid == "" {
			continue
		}

		if _, exists := ssidSeen[ssid]; exists {
			continue
		}
		ssidSeen[ssid] = struct{}{}
		ssids = append(ssids, ssid)
	}

	return ssids
}

func keyLooksLikePassword(key string) bool {
	normalized := normalizeLookupKey(key)
	if strings.Contains(normalized, "username") || strings.Contains(normalized, "user") {
		return false
	}

	return strings.Contains(normalized, "password") ||
		strings.Contains(normalized, "passphrase") ||
		strings.Contains(normalized, "presharedkey") ||
		strings.Contains(normalized, "wpakey") ||
		strings.Contains(normalized, "psk")
}

func keyLooksLikePPPoEUsername(key string) bool {
	normalized := normalizeLookupKey(key)
	if strings.Contains(normalized, "web") || strings.Contains(normalized, "admin") {
		return false
	}

	if strings.Contains(normalized, "pppoe") {
		return strings.Contains(normalized, "username") || strings.Contains(normalized, "user")
	}

	if strings.Contains(normalized, "wanpppconnection") {
		return strings.Contains(normalized, "username") || strings.Contains(normalized, "user")
	}

	return false
}

func keyLooksLikePPPoEPassword(key string) bool {
	normalized := normalizeLookupKey(key)
	if strings.Contains(normalized, "web") || strings.Contains(normalized, "admin") || strings.Contains(normalized, "telecomaccount") {
		return false
	}

	if strings.Contains(normalized, "pppoe") || strings.Contains(normalized, "wanpppconnection") {
		return strings.Contains(normalized, "password") || strings.Contains(normalized, "passphrase") || strings.Contains(normalized, "psk") || strings.Contains(normalized, "wpakey")
	}

	return false
}

func extractStringByKeyPattern(data interface{}, matcher func(string) bool) string {
	switch node := data.(type) {
	case map[string]interface{}:
		for key, value := range node {
			if matcher(key) {
				parsed := strings.TrimSpace(extractStringValue(value))
				if parsed != "" {
					return parsed
				}
			}
		}

		for _, child := range node {
			if parsed := extractStringByKeyPattern(child, matcher); parsed != "" {
				return parsed
			}
		}
	case []interface{}:
		for _, child := range node {
			if parsed := extractStringByKeyPattern(child, matcher); parsed != "" {
				return parsed
			}
		}
	}

	return ""
}

func extractValueByPath(data interface{}, path string) (interface{}, bool) {
	segments := strings.Split(path, ".")
	if len(segments) == 0 {
		return nil, false
	}

	current := data
	for _, segment := range segments {
		switch node := current.(type) {
		case map[string]interface{}:
			next, ok := node[segment]
			if !ok {
				return nil, false
			}
			current = next
		case []interface{}:
			idx, err := strconv.Atoi(segment)
			if err != nil || idx < 0 || idx >= len(node) {
				return nil, false
			}
			current = node[idx]
		default:
			return nil, false
		}
	}

	return current, true
}

func extractStringByPaths(device map[string]interface{}, paths []string) string {
	for _, path := range paths {
		value, ok := extractValueByPath(device, path)
		if !ok {
			continue
		}

		text := strings.TrimSpace(extractStringValue(value))
		if text != "" {
			return text
		}
	}

	return ""
}

func defaultWebAdminPasswordPaths() []string {
	return []string{
		"InternetGatewayDevice.X_CU_Function.Web.AdminPassword",
		"InternetGatewayDevice.UserInterface.X_ZTE-COM_WebUserInfo.AdminPassword",
		"InternetGatewayDevice.UserInterface.X_HW_WebUserInfo.2.Password",
		"InternetGatewayDevice.DeviceInfo.X_CMCC_TeleComAccount.Password",
		"InternetGatewayDevice.DeviceInfo.X_FH_Account.X_FH_WebUserInfo.WebSuperPassword",
		"InternetGatewayDevice.User.1.Password",
		"InternetGatewayDevice.X_Authentication.WebAccount.Password",
		"InternetGatewayDevice.DeviceInfo.X_CT-COM_TeleComAccount.Password",
		"InternetGatewayDevice.X_ZTE-COM_UserInterface.X_ZTE-COM_WebUserInfo.AdminPassword",
	}
}

func extractWebAdminPassword(device map[string]interface{}, preferredPaths []string) string {
	if value := extractStringFromDevice(device, []string{"superPassword", "superpassword", "adminPassword", "AdminPassword"}); value != "" {
		return value
	}

	paths := mergeStringLists(preferredPaths, defaultWebAdminPasswordPaths())
	return extractStringByPaths(device, paths)
}

func defaultWebAdminUsernamePaths() []string {
	return []string{
		"InternetGatewayDevice.X_CU_Function.Web.AdminName",
		"InternetGatewayDevice.UserInterface.X_ZTE-COM_WebUserInfo.AdminName",
		"InternetGatewayDevice.UserInterface.X_HW_WebUserInfo.2.UserName",
		"InternetGatewayDevice.DeviceInfo.X_CMCC_TeleComAccount.Username",
		"InternetGatewayDevice.DeviceInfo.X_FH_Account.X_FH_WebUserInfo.WebSuperUsername",
		"InternetGatewayDevice.X_ZTE-COM_UserInterface.X_ZTE-COM_WebUserInfo.AdminName",
		"InternetGatewayDevice.X_CU_Function.Web.UserName",
		"InternetGatewayDevice.UserInterface.X_ZTE-COM_WebUserInfo.UserName",
		"InternetGatewayDevice.UserInterface.X_HW_WebUserInfo.1.UserName",
		"InternetGatewayDevice.DeviceInfo.X_FH_Account.X_FH_WebUserInfo.WebUsername",
		"InternetGatewayDevice.User.1.Username",
		"InternetGatewayDevice.User.2.Username",
		"InternetGatewayDevice.X_ZTE-COM_UserInterface.X_ZTE-COM_WebUserInfo.UserName",
	}
}

func extractWebAdminUsername(device map[string]interface{}, preferredPaths []string) string {
	if value := extractStringFromDevice(device, []string{"superAdmin", "superadmin", "adminName", "AdminName", "userAdmin"}); value != "" {
		return value
	}

	paths := mergeStringLists(preferredPaths, defaultWebAdminUsernamePaths())
	return extractStringByPaths(device, paths)
}

func defaultWebUserPasswordPaths() []string {
	return []string{
		"InternetGatewayDevice.X_CU_Function.Web.UserPassword",
		"InternetGatewayDevice.UserInterface.X_ZTE-COM_WebUserInfo.UserPassword",
		"InternetGatewayDevice.UserInterface.X_HW_WebUserInfo.1.Password",
		"InternetGatewayDevice.DeviceInfo.X_FH_Account.X_FH_WebUserInfo.WebPassword",
		"InternetGatewayDevice.User.2.Password",
		"InternetGatewayDevice.X_ZTE-COM_UserInterface.X_ZTE-COM_WebUserInfo.UserPassword",
	}
}

func extractWebUserPassword(device map[string]interface{}, preferredPaths []string) string {
	if value := extractStringFromDevice(device, []string{"userPassword"}); value != "" {
		return value
	}

	paths := mergeStringLists(preferredPaths, defaultWebUserPasswordPaths())
	return extractStringByPaths(device, paths)
}

func defaultWiFiPasswordKeys() []string {
	return []string{
		"wifiPassword",
		"WiFiPassword",
		"WiFi Password",
		"WifiPassword",
		"WlanPassword",
		"WLANPassword",
		"SSIDPassword",
		"SSID Password",
		"PreSharedKey",
		"KeyPassphrase",
		"WPAKey",
		"Password",
		"Key",
		"X_HW_KeyPassphrase",
		"X_HW_PreSharedKey",
		"X_HW_WPA2PreSharedKey",
		"X_HW_WPAKey",
		"X_ZTE-COM_KeyPassphrase",
		"X_ZTE-COM_WPAKey",
		"X_CT-COM_KeyPassphrase",
	}
}

func defaultVirtualWiFiPasswordKeys() []string {
	return []string{
		"wifiPassword",
		"WiFiPassword",
		"WiFi Password",
		"WifiPassword",
		"WlanPassword",
		"WLANPassword",
		"SSIDPassword",
		"SSID Password",
		"_virtualParameters.wifiPassword.value",
		"_virtualParameters.WiFiPassword.value",
		"_virtualParameters.WiFi Password.value",
		"_virtualParameters.WlanPassword.value",
		"_virtualParameters.WLANPassword.value",
		"_virtualParameters.SSIDPassword.value",
		"_virtualParameters.SSID Password.value",
	}
}

func extractVirtualWiFiPassword(device map[string]interface{}) string {
	return extractStringFromDevice(device, defaultVirtualWiFiPasswordKeys())
}

func extractWiFiPasswordFromNode(node interface{}, keyCandidates []string) string {
	password := strings.TrimSpace(extractStringValue(node))
	if password != "" {
		return password
	}

	if asMap, ok := node.(map[string]interface{}); ok {
		for _, candidate := range mergeStringLists(keyCandidates, defaultWiFiPasswordKeys()) {
			if value, exists := extractValueByKey(asMap, candidate); exists {
				password = strings.TrimSpace(extractStringValue(value))
				if password != "" {
					return password
				}
			}
		}

		password = extractStringByKeyPattern(asMap, keyLooksLikePassword)
		if password != "" {
			return password
		}
	}

	return ""
}

func extractIndexedWiFiPassword(device map[string]interface{}, profile map[string]interface{}, index string, keyCandidates []string) string {
	if preSharedRaw, exists := profile["PreSharedKey"]; exists {
		if preSharedMap, ok := preSharedRaw.(map[string]interface{}); ok {
			if slot1, ok := preSharedMap["1"]; ok {
				if slot1Map, ok := slot1.(map[string]interface{}); ok {
					if value, exists := slot1Map["PreSharedKey"]; exists {
						if password := extractWiFiPasswordFromNode(value, keyCandidates); password != "" {
							return password
						}
					}
					if value, exists := slot1Map["KeyPassphrase"]; exists {
						if password := extractWiFiPasswordFromNode(value, keyCandidates); password != "" {
							return password
						}
					}
				}
			}
		}
	}

	if value, exists := profile["KeyPassphrase"]; exists {
		if password := extractWiFiPasswordFromNode(value, keyCandidates); password != "" {
			return password
		}
	}

	if value, exists := profile["PreSharedKey"]; exists {
		if password := extractWiFiPasswordFromNode(value, keyCandidates); password != "" {
			return password
		}
	}

	for _, candidate := range mergeStringLists(keyCandidates, defaultWiFiPasswordKeys()) {
		if value, exists := extractValueByKey(profile, candidate); exists {
			if password := extractWiFiPasswordFromNode(value, keyCandidates); password != "" {
				return password
			}
		}
	}

	if apRootValue, ok := extractValueByKey(device, "AccessPoint"); ok {
		if apRoot, ok := apRootValue.(map[string]interface{}); ok {
			for _, key := range []string{index, "1"} {
				if key == "" {
					continue
				}
				apNode, ok := apRoot[key].(map[string]interface{})
				if !ok {
					continue
				}

				if securityNode, ok := extractValueByKey(apNode, "Security"); ok {
					if securityMap, ok := securityNode.(map[string]interface{}); ok {
						if keyPassphrase, exists := securityMap["KeyPassphrase"]; exists {
							if password := extractWiFiPasswordFromNode(keyPassphrase, keyCandidates); password != "" {
								return password
							}
						}
					}
					if password := extractWiFiPasswordFromNode(securityNode, keyCandidates); password != "" {
						return password
					}
				}
			}
		}
	}

	return extractStringByKeyPattern(profile, keyLooksLikePassword)
}

func extractWiFiProfiles(device map[string]interface{}, keyCandidates []string) []map[string]interface{} {
	wlanConfigValue, ok := extractValueByKey(device, "WLANConfiguration")
	if !ok {
		return []map[string]interface{}{}
	}

	wlanConfig, ok := wlanConfigValue.(map[string]interface{})
	if !ok {
		return []map[string]interface{}{}
	}

	profiles := make([]map[string]interface{}, 0, len(wlanConfig))
	for _, key := range sortedMapKeys(wlanConfig) {
		entry, ok := wlanConfig[key].(map[string]interface{})
		if !ok {
			continue
		}

		ssid := strings.TrimSpace(extractStringValue(entry["SSID"]))
		password := extractIndexedWiFiPassword(device, entry, key, keyCandidates)

		enabled := interface{}(nil)
		if value, exists := entry["Enable"]; exists {
			if parsed, ok := parseBoolLike(extractStringValue(value)); ok {
				enabled = parsed
			}
		}

		if ssid == "" && password == "" && enabled == nil {
			continue
		}

		profile := map[string]interface{}{
			"index":    key,
			"ssid":     ssid,
			"password": password,
		}
		if enabled != nil {
			profile["enabled"] = enabled
		}

		profiles = append(profiles, profile)
	}

	return profiles
}

func hasNonEmptyWiFiPassword(profiles []map[string]interface{}) bool {
	for _, profile := range profiles {
		if strings.TrimSpace(extractStringValue(profile["password"])) != "" {
			return true
		}
	}

	return false
}

func extractSSIDListFromProfiles(profiles []map[string]interface{}) []string {
	result := make([]string, 0, len(profiles))
	seen := make(map[string]struct{})

	for _, profile := range profiles {
		ssid := strings.TrimSpace(extractStringValue(profile["ssid"]))
		if ssid == "" {
			continue
		}
		if _, exists := seen[ssid]; exists {
			continue
		}
		seen[ssid] = struct{}{}
		result = append(result, ssid)
	}

	return result
}

func profileActiveState(profile map[string]interface{}) (bool, bool) {
	if value, ok := profile["enabled"]; ok {
		switch typedValue := value.(type) {
		case bool:
			return typedValue, true
		default:
			if parsed, ok := parseBoolLike(extractStringValue(typedValue)); ok {
				return parsed, true
			}
		}
	}

	return false, false
}

func extractActiveWiFiProfiles(profiles []map[string]interface{}) []map[string]interface{} {
	activeProfiles := make([]map[string]interface{}, 0, len(profiles))

	for _, profile := range profiles {
		ssid := strings.TrimSpace(extractStringValue(profile["ssid"]))
		if ssid == "" {
			continue
		}

		active, hasExplicitState := profileActiveState(profile)
		if !hasExplicitState {
			index := strings.TrimSpace(extractStringValue(profile["index"]))
			active = index == "1" || index == "5" || !placeholderSSIDPattern.MatchString(ssid)
		}

		if !active {
			continue
		}

		copied := make(map[string]interface{}, len(profile))
		for key, value := range profile {
			copied[key] = value
		}
		activeProfiles = append(activeProfiles, copied)
	}

	return activeProfiles
}

func sanitizeWiFiProfilesForResponse(profiles []map[string]interface{}) []map[string]interface{} {
	result := make([]map[string]interface{}, 0, len(profiles))
	for _, profile := range profiles {
		result = append(result, map[string]interface{}{
			"index":    strings.TrimSpace(extractStringValue(profile["index"])),
			"ssid":     strings.TrimSpace(extractStringValue(profile["ssid"])),
			"password": strings.TrimSpace(extractStringValue(profile["password"])),
		})
	}

	return result
}

func nonEmptyStringPointer(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}

	result := trimmed
	return &result
}

func collectWiFiPasswordSnapshotFromProfiles(profiles []map[string]interface{}) map[string]string {
	result := make(map[string]string)

	for _, profile := range profiles {
		password := strings.TrimSpace(extractStringValue(profile["password"]))
		if password == "" {
			continue
		}

		index := strings.TrimSpace(extractStringValue(profile["index"]))
		if index != "" {
			result["index:"+index] = password
		}

		ssid := strings.TrimSpace(extractStringValue(profile["ssid"]))
		if ssid != "" {
			result["ssid:"+strings.ToLower(ssid)] = password
		}
	}

	return result
}

func applyStoredWiFiPasswords(profiles []map[string]interface{}, stored map[string]string) {
	if len(stored) == 0 {
		return
	}

	for _, profile := range profiles {
		password := strings.TrimSpace(extractStringValue(profile["password"]))
		if password != "" {
			continue
		}

		index := strings.TrimSpace(extractStringValue(profile["index"]))
		if index != "" {
			if value := strings.TrimSpace(stored["index:"+index]); value != "" {
				profile["password"] = value
				continue
			}
		}

		ssid := strings.ToLower(strings.TrimSpace(extractStringValue(profile["ssid"])))
		if ssid == "" {
			continue
		}
		if value := strings.TrimSpace(stored["ssid:"+ssid]); value != "" {
			profile["password"] = value
		}
	}
}

func extractCredentialHintsFromParameters(parameters []deviceParameterInput) (*string, *string, map[string]string) {
	var (
		pppoeUsername string
		pppoePassword string
	)

	wifiPasswords := make(map[string]string)

	for _, parameter := range parameters {
		nameLower := strings.ToLower(strings.TrimSpace(parameter.Name))
		value := strings.TrimSpace(extractStringValue(parameter.Value))
		if value == "" {
			continue
		}

		if strings.Contains(nameLower, "wanpppconnection") && strings.HasSuffix(nameLower, ".username") {
			pppoeUsername = value
		}
		if strings.Contains(nameLower, "wanpppconnection") && strings.Contains(nameLower, "password") {
			pppoePassword = value
		}

		looksLikeWiFiPassword := strings.Contains(nameLower, "wlanconfiguration") || strings.Contains(nameLower, "device.wifi.accesspoint")
		if !looksLikeWiFiPassword {
			continue
		}

		if !keyLooksLikePassword(nameLower) {
			continue
		}

		index := ""
		if matches := wlanIndexPattern.FindStringSubmatch(parameter.Name); len(matches) > 1 {
			index = matches[1]
		} else if matches := accessPointIndexPattern.FindStringSubmatch(parameter.Name); len(matches) > 1 {
			index = matches[1]
		}

		if index != "" {
			wifiPasswords["index:"+index] = value
		}
	}

	return nonEmptyStringPointer(pppoeUsername), nonEmptyStringPointer(pppoePassword), wifiPasswords
}

func defaultPPPoEUsernameKeys() []string {
	return []string{
		"pppoeUsername",
		"pppoeUsername2",
		"PPPoEUsername",
		"PPPoE Username",
		"pppoeUserName",
		"pppUsername",
		"wanUsername",
		"WANUsername",
		"X_HW_PPPoEUsername",
		"X_ZTE-COM_PPPoEUsername",
		"X_CT-COM_PPPoEUsername",
		"_virtualParameters.PPPoEUsername.value",
		"_virtualParameters.PPPoE Username.value",
	}
}

func extractPPPoEUsername(device map[string]interface{}, keyCandidates []string) string {
	username := extractStringFromDevice(device, mergeStringLists(keyCandidates, defaultPPPoEUsernameKeys()))
	if username != "" {
		return username
	}

	wanPPPValue, ok := extractValueByKey(device, "WANPPPConnection")
	if !ok {
		return ""
	}

	wanPPPMap, ok := wanPPPValue.(map[string]interface{})
	if !ok {
		return ""
	}

	for _, key := range sortedMapKeys(wanPPPMap) {
		entry, ok := wanPPPMap[key].(map[string]interface{})
		if !ok {
			continue
		}

		for _, candidate := range []string{"Username", "UserName", "X_HW_PPPoEUsername", "X_ZTE-COM_PPPoEUsername", "X_CT-COM_PPPoEUsername"} {
			if value, exists := entry[candidate]; exists {
				username = strings.TrimSpace(extractStringValue(value))
				if username != "" {
					return username
				}
			}
		}

		if username = extractStringByKeyPattern(entry, keyLooksLikePPPoEUsername); username != "" {
			return username
		}
	}

	return ""
}

func defaultPPPoEPasswordKeys() []string {
	return []string{
		"pppoePassword",
		"PPPoEPassword",
		"PPPoE Password",
		"pppPassword",
		"wanPassword",
		"WANPassword",
		"X_ZTE-COM_Password",
		"X_HW_PPPoEPassword",
		"X_CT-COM_PPPoEPassword",
		"X_ZTE-COM_PPPoEPassword",
		"_virtualParameters.PPPoEPassword.value",
		"_virtualParameters.PPPoE Password.value",
	}
}

func extractPPPoEPassword(device map[string]interface{}, keyCandidates []string) string {
	password := extractStringFromDevice(device, mergeStringLists(keyCandidates, defaultPPPoEPasswordKeys()))
	if password != "" {
		return password
	}

	wanPPPValue, ok := extractValueByKey(device, "WANPPPConnection")
	if !ok {
		return ""
	}

	wanPPPMap, ok := wanPPPValue.(map[string]interface{})
	if !ok {
		return ""
	}

	for _, key := range sortedMapKeys(wanPPPMap) {
		entry, ok := wanPPPMap[key].(map[string]interface{})
		if !ok {
			continue
		}

		if passwordValue, exists := entry["Password"]; exists {
			password = strings.TrimSpace(extractStringValue(passwordValue))
			if password != "" {
				return password
			}
		}

		for _, candidate := range mergeStringLists(keyCandidates, []string{
			"X_HW_PPPoEPassword",
			"X_CT-COM_PPPoEPassword",
			"X_ZTE-COM_PPPoEPassword",
			"Passphrase",
		}) {
			if value, exists := entry[candidate]; exists {
				password = strings.TrimSpace(extractStringValue(value))
				if password != "" {
					return password
				}
			}
		}

		if password = extractStringByKeyPattern(entry, keyLooksLikePPPoEPassword); password != "" {
			return password
		}
	}

	wanIPValue, ok := extractValueByKey(device, "WANIPConnection")
	if ok {
		if wanIPMap, ok := wanIPValue.(map[string]interface{}); ok {
			for _, key := range sortedMapKeys(wanIPMap) {
				entry, ok := wanIPMap[key].(map[string]interface{})
				if !ok {
					continue
				}
				if password = extractStringByKeyPattern(entry, keyLooksLikePPPoEPassword); password != "" {
					return password
				}
			}
		}
	}

	return ""
}

func extractClientList(device map[string]interface{}) []map[string]interface{} {
	clients := make([]map[string]interface{}, 0)
	seen := make(map[string]struct{})

	hostValue, ok := extractValueByKey(device, "Host")
	if !ok {
		return clients
	}

	hostMap, ok := hostValue.(map[string]interface{})
	if !ok {
		return clients
	}

	for _, key := range sortedMapKeys(hostMap) {
		entry, ok := hostMap[key].(map[string]interface{})
		if !ok {
			continue
		}

		macAddress := strings.TrimSpace(extractStringValue(entry["MACAddress"]))
		if macAddress == "" {
			macAddress = strings.TrimSpace(extractStringValue(entry["PhysAddress"]))
		}

		ipAddress := strings.TrimSpace(extractStringValue(entry["IPAddress"]))
		hostName := strings.TrimSpace(extractStringValue(entry["HostName"]))

		if macAddress == "" && ipAddress == "" && hostName == "" {
			continue
		}

		clientKey := strings.ToLower(macAddress + "|" + ipAddress + "|" + hostName)
		if _, exists := seen[clientKey]; exists {
			continue
		}
		seen[clientKey] = struct{}{}

		client := map[string]interface{}{
			"host_name":   hostName,
			"ip_address":  ipAddress,
			"mac_address": macAddress,
		}

		if activeValue, exists := entry["Active"]; exists {
			if active, parsed := parseBoolLike(extractStringValue(activeValue)); parsed {
				client["active"] = active
			}
		}

		clients = append(clients, client)
	}

	return clients
}

func inferLANGatewayFromClients(clients []map[string]interface{}) string {
	for _, client := range clients {
		rawIP := strings.TrimSpace(extractStringValue(client["ip_address"]))
		if rawIP == "" {
			continue
		}

		parsed := net.ParseIP(rawIP)
		if parsed == nil {
			continue
		}

		ipv4 := parsed.To4()
		if ipv4 == nil {
			continue
		}

		return fmt.Sprintf("%d.%d.%d.1", int(ipv4[0]), int(ipv4[1]), int(ipv4[2]))
	}

	return ""
}

func resolveLANGateway(localIP string, clients []map[string]interface{}) string {
	if trimmed := strings.TrimSpace(localIP); trimmed != "" {
		return trimmed
	}

	return inferLANGatewayFromClients(clients)
}

func deviceSearchText(device map[string]interface{}) string {
	raw, err := json.Marshal(device)
	if err != nil {
		return ""
	}

	return strings.ToLower(string(raw))
}

func computeACSMissingFields(pppoeUsername string, hasRXPower bool, hasTemperature bool, deviceUptime string) []string {
	missing := make([]string, 0, 4)
	if strings.TrimSpace(pppoeUsername) == "" {
		missing = append(missing, "pppoe_username")
	}
	if !hasRXPower {
		missing = append(missing, "rx_power")
	}
	if !hasTemperature {
		missing = append(missing, "temp")
	}
	if strings.TrimSpace(deviceUptime) == "" {
		missing = append(missing, "device_uptime")
	}
	return missing
}
