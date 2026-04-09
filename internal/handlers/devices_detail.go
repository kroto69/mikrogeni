package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"strings"
	"sync"
	"time"

	"genieacs-backend/internal/db"
	"genieacs-backend/internal/models"
	"genieacs-backend/internal/services"
)

var acsDetailAutoRefreshState sync.Map

const acsDetailAutoRefreshInterval = 5 * time.Minute
const acsDetailRefreshWaitTimeout = 20 * time.Second

func GetDeviceDetail(w http.ResponseWriter, r *http.Request) {
	deviceID := resolveDeviceID(r)
	if deviceID == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(models.ErrorResponse{
			Error: "Device ID is required",
		})
		return
	}

	genieACSURL, err := getGenieACSURL()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{
			Error:  "Failed to resolve GenieACS URL",
			Detail: err.Error(),
		})
		return
	}
	if refreshWait, ok := parseBoolLike(strings.TrimSpace(r.URL.Query().Get("refresh_wait"))); ok && refreshWait {
		if err := refreshACSDetailAndWait(genieACSURL, deviceID, acsDetailRefreshWaitTimeout); err != nil {
			log.Printf("[acs] refresh_wait failed for %s: %v", deviceID, err)
		}
	} else {
		triggerACSDetailAutoRefresh(genieACSURL, deviceID)
	}

	projection := []string{
		"_id",
		"_deviceId._ProductClass",
		"_deviceId._SerialNumber",
		"_deviceId._Manufacturer",
		"_tags",
		"_virtualParameters.pppoeUsername.value",
		"_virtualParameters.pppoeUsername2.value",
		"_virtualParameters.PPPoEUsername.value",
		"_virtualParameters.PPPoE Username.value",
		"_virtualParameters.pppoePassword.value",
		"_virtualParameters.pppPassword.value",
		"_virtualParameters.wanPassword.value",
		"_virtualParameters.PPPoEPassword.value",
		"_virtualParameters.PPPoE Password.value",
		"_virtualParameters.pppoeIP.value",
		"_virtualParameters.IP PPPOE.value",
		"_virtualParameters.IPTR069.value",
		"_virtualParameters.IP TR069.value",
		"_virtualParameters.wifiPassword.value",
		"_virtualParameters.WlanPassword.value",
		"_virtualParameters.WiFiPassword.value",
		"_virtualParameters.WiFi Password.value",
		"_virtualParameters.SSIDPassword.value",
		"_virtualParameters.SSID Password.value",
		"_virtualParameters.RXPower.value",
		"_virtualParameters.OpticRxPower.value",
		"_virtualParameters.Optic Rx Power.value",
		"_virtualParameters.superAdmin.value",
		"_virtualParameters.superPassword.value",
		"_virtualParameters.Devices-Uptime.value",
		"_virtualParameters.Devices Uptime.value",
		"_virtualParameters.deviceUptime.value",
		"_virtualParameters.DeviceUptime.value",
		"_virtualParameters.userAdmin.value",
		"_virtualParameters.userPassword.value",
		"_virtualParameters.wanIpAddress.value",
		"_virtualParameters.lanIpAddress.value",
		"_virtualParameters.wanIpAddress6.value",
		"_virtualParameters.temperature.value",
		"_virtualParameters.Temperature.value",
		"_virtualParameters.Temperatur.value",
		"_virtualParameters.temp.value",
		"_virtualParameters.cpuTemp.value",
		"_virtualParameters.CpuTemp.value",
		"_virtualParameters.cpuTemperature.value",
		"_virtualParameters.CPUTemperature.value",
		"_virtualParameters.boardTemp.value",
		"_virtualParameters.boardTemperature.value",
		"_virtualParameters.onuTemperature.value",
		"_virtualParameters.rxPower.value",
		"_virtualParameters.opticalRxPower.value",
		"_virtualParameters.deviceModel.value",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration",
		"Device.WiFi.AccessPoint",
		"Device.WiFi.AccessPoint.1.Security.KeyPassphrase",
		"Device.WiFi.AccessPoint.1.Security.PreSharedKey",
		"Device.WiFi.AccessPoint.2.Security.KeyPassphrase",
		"Device.WiFi.AccessPoint.2.Security.PreSharedKey",
		"Device.WiFi.AccessPoint.3.Security.KeyPassphrase",
		"Device.WiFi.AccessPoint.3.Security.PreSharedKey",
		"Device.WiFi.AccessPoint.4.Security.KeyPassphrase",
		"Device.WiFi.AccessPoint.4.Security.PreSharedKey",
		"Device.WiFi.AccessPoint.5.Security.KeyPassphrase",
		"Device.WiFi.AccessPoint.5.Security.PreSharedKey",
		"Device.WiFi.AccessPoint.6.Security.KeyPassphrase",
		"Device.WiFi.AccessPoint.6.Security.PreSharedKey",
		"Device.WiFi.AccessPoint.7.Security.KeyPassphrase",
		"Device.WiFi.AccessPoint.7.Security.PreSharedKey",
		"Device.WiFi.AccessPoint.8.Security.KeyPassphrase",
		"Device.WiFi.AccessPoint.8.Security.PreSharedKey",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.X_HW_PreSharedKey",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.X_HW_KeyPassphrase",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.X_HW_WPA2PreSharedKey",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.PreSharedKey.1.KeyPassphrase",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.KeyPassphrase",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.PreSharedKey.1.PreSharedKey",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.X_HW_PreSharedKey",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.X_HW_KeyPassphrase",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.X_HW_WPA2PreSharedKey",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.PreSharedKey.1.KeyPassphrase",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.PreSharedKey.1.PreSharedKey",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.X_HW_PreSharedKey",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.X_HW_KeyPassphrase",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.X_HW_WPA2PreSharedKey",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.4.PreSharedKey.1.KeyPassphrase",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.4.PreSharedKey.1.PreSharedKey",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.4.X_HW_PreSharedKey",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.4.X_HW_KeyPassphrase",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.4.X_HW_WPA2PreSharedKey",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.KeyPassphrase",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.PreSharedKey",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.X_HW_PreSharedKey",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.X_HW_KeyPassphrase",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.X_HW_WPA2PreSharedKey",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.6.PreSharedKey.1.KeyPassphrase",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.6.PreSharedKey.1.PreSharedKey",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.6.X_HW_PreSharedKey",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.6.X_HW_KeyPassphrase",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.6.X_HW_WPA2PreSharedKey",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.7.PreSharedKey.1.KeyPassphrase",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.7.PreSharedKey.1.PreSharedKey",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.7.X_HW_PreSharedKey",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.7.X_HW_KeyPassphrase",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.7.X_HW_WPA2PreSharedKey",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.8.PreSharedKey.1.KeyPassphrase",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.8.PreSharedKey.1.PreSharedKey",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.8.X_HW_PreSharedKey",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.8.X_HW_KeyPassphrase",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.8.X_HW_WPA2PreSharedKey",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Enable",
		"InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.Enable",
		"InternetGatewayDevice.LANDevice.1.Hosts.Host",
		"InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username",
		"InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Password",
		"InternetGatewayDevice.WANDevice.1.WANConnectionDevice",
		"InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_HW_Password",
		"InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_HW_PPPoEPassword",
		"InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_CT-COM_PPPoEPassword",
		"InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_ZTE-COM_Password",
		"InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_ZTE-COM_PPPoEPassword",
		"InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress",
		"InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.IPInterface.1.IPInterfaceIPAddress",
		"InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.IPRouters",
		"Device.LAN.IPAddress",
		"InternetGatewayDevice.X_CU_Function.Web.AdminPassword",
		"InternetGatewayDevice.X_CU_Function.Web.AdminName",
		"InternetGatewayDevice.UserInterface.X_ZTE-COM_WebUserInfo.AdminPassword",
		"InternetGatewayDevice.UserInterface.X_ZTE-COM_WebUserInfo.AdminName",
		"InternetGatewayDevice.UserInterface.X_HW_WebUserInfo.2.Password",
		"InternetGatewayDevice.UserInterface.X_HW_WebUserInfo.2.UserName",
		"InternetGatewayDevice.DeviceInfo.X_CMCC_TeleComAccount.Password",
		"InternetGatewayDevice.DeviceInfo.X_CMCC_TeleComAccount.Username",
		"InternetGatewayDevice.DeviceInfo.X_FH_Account.X_FH_WebUserInfo.WebSuperPassword",
		"InternetGatewayDevice.DeviceInfo.X_FH_Account.X_FH_WebUserInfo.WebSuperUsername",
		"InternetGatewayDevice.User.1.Password",
		"InternetGatewayDevice.X_Authentication.WebAccount.Password",
		"InternetGatewayDevice.DeviceInfo.X_CT-COM_TeleComAccount.Password",
		"InternetGatewayDevice.X_ZTE-COM_UserInterface.X_ZTE-COM_WebUserInfo.AdminPassword",
		"InternetGatewayDevice.X_ZTE-COM_UserInterface.X_ZTE-COM_WebUserInfo.AdminName",
		"InternetGatewayDevice.X_CU_Function.Web.UserName",
		"InternetGatewayDevice.UserInterface.X_ZTE-COM_WebUserInfo.UserName",
		"InternetGatewayDevice.UserInterface.X_HW_WebUserInfo.1.UserName",
		"InternetGatewayDevice.DeviceInfo.X_FH_Account.X_FH_WebUserInfo.WebUsername",
		"InternetGatewayDevice.User.1.Username",
		"InternetGatewayDevice.User.2.Username",
		"InternetGatewayDevice.X_ZTE-COM_UserInterface.X_ZTE-COM_WebUserInfo.UserName",
		"InternetGatewayDevice.X_CU_Function.Web.UserPassword",
		"InternetGatewayDevice.UserInterface.X_ZTE-COM_WebUserInfo.UserPassword",
		"InternetGatewayDevice.UserInterface.X_HW_WebUserInfo.1.Password",
		"InternetGatewayDevice.DeviceInfo.X_FH_Account.X_FH_WebUserInfo.WebPassword",
		"InternetGatewayDevice.User.2.Password",
		"InternetGatewayDevice.X_ZTE-COM_UserInterface.X_ZTE-COM_WebUserInfo.UserPassword",
		"InternetGatewayDevice.WANDevice.1.X_GponInterfaceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.RxPower",
		"InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.OpticalRxPower",
		"InternetGatewayDevice.WANDevice.2.X_ZTE-COM_WANPONInterfaceConfig.RXPower",
		"InternetGatewayDevice.WANDevice.2.X_ZTE-COM_WANPONInterfaceConfig.RxPower",
		"InternetGatewayDevice.WANDevice.2.X_ZTE-COM_WANPONInterfaceConfig.OpticalRxPower",
		"InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.ReceivedOpticalPower",
		"InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.RcvPower",
		"InternetGatewayDevice.WANDevice.2.X_ZTE-COM_WANPONInterfaceConfig.ReceivedOpticalPower",
		"InternetGatewayDevice.WANDevice.2.X_ZTE-COM_WANPONInterfaceConfig.RcvPower",
		"Device.DeviceInfo.TemperatureStatus",
		"Device.DeviceInfo.TemperatureStatus.CPUTemperature",
		"Device.DeviceInfo.TemperatureStatus.CPU",
		"Device.DeviceInfo.TemperatureStatus.BoardTemperature",
		"InternetGatewayDevice.DeviceInfo.TemperatureStatus",
		"InternetGatewayDevice.DeviceInfo.TemperatureStatus.CPUTemperature",
		"InternetGatewayDevice.DeviceInfo.TemperatureStatus.CPU",
		"InternetGatewayDevice.DeviceInfo.TemperatureStatus.BoardTemperature",
		"InternetGatewayDevice.DeviceInfo.X_HW_Temperature",
		"InternetGatewayDevice.DeviceInfo.X_ZTE-COM_Temperature",
		"InternetGatewayDevice.DeviceInfo.X_FH_Temperature",
		"InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.Temperature",
		"InternetGatewayDevice.WANDevice.1.X_HW_WANPONInterfaceConfig.Temperature",
		"InternetGatewayDevice.DeviceInfo.UpTime",
		"Device.DeviceInfo.UpTime",
		"_lastInform",
	}
	projection = mergeStringLists(projection, allVendorProjectionPaths())

	device, err := fetchGenieACSDeviceByID(genieACSURL, deviceID, projection)
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		json.NewEncoder(w).Encode(models.ErrorResponse{
			Error:  "Failed to fetch from GenieACS",
			Detail: err.Error(),
		})
		return
	}

	if device == nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(models.ErrorResponse{
			Error: "Device not found",
		})
		return
	}

	serialNumber := extractStringFromDevice(device, []string{"_SerialNumber", "SerialNumber", "serialNumber"})
	deviceType := extractStringFromDevice(device, []string{"_ProductClass", "ProductClass", "deviceModel", "Model"})
	vendor := extractStringFromDevice(device, []string{"_Manufacturer", "Manufacturer", "vendor", "Vendor"})
	vendorResolution := resolveVendorProfileForDevice(device, vendor, deviceType)
	vendorProfile := vendorResolution.Profile
	parameterProfileSource := vendorResolution.Source
	pppoeUsername := extractPPPoEUsername(device, vendorProfile.PPPoEUsernameKeys)
	pppoePassword := extractPPPoEPassword(device, vendorProfile.PPPoEPasswordKeys)
	webAdminUsername := extractWebAdminUsername(device, vendorProfile.WebAdminUsernamePath)
	webAdminPassword := extractWebAdminPassword(device, vendorProfile.WebAdminPasswordPath)
	webUserPassword := extractWebUserPassword(device, vendorProfile.WebUserPasswordPath)
	virtualWiFiPassword := extractVirtualWiFiPassword(device)
	ipPPPoE := extractPPPoEIP(device)
	ipTR069 := extractTR069IP(device)
	ipLocal := extractLocalIP(device)
	deviceUptime := extractDeviceUptime(device)
	ipv6Address := extractStringFromDevice(device, []string{"wanIpAddress6", "IPv6Address", "IP6Address"})
	ssidList := extractSSIDList(device)
	wifiProfiles := extractWiFiProfiles(device, vendorProfile.WiFiPasswordKeys)
	clientList := extractClientList(device)
	ipLocal = resolveLANGateway(ipLocal, clientList)
	tags := extractTagsFromDevice(device)

	rxPowerValue, hasRXPower := extractRXPowerFromDevice(device)
	temperatureValue, hasTemperature := extractTemperatureFromDevice(device)
	needFullFetch := !hasRXPower || !hasTemperature || deviceUptime == "" || (ipPPPoE == "" && ipTR069 == "") || len(ssidList) == 0 || len(wifiProfiles) == 0 || !hasNonEmptyWiFiPassword(wifiProfiles) || len(clientList) == 0 || pppoePassword == "" || virtualWiFiPassword == "" || webAdminUsername == "" || webAdminPassword == "" || webUserPassword == ""
	if needFullFetch {
		fullProjection := mergeStringLists(projection, vendorProfile.ProjectionPaths)
		if fullDevice, err := fetchGenieACSDeviceByID(genieACSURL, deviceID, fullProjection); err == nil && fullDevice != nil {
			fullVendorResolution := resolveVendorProfileForDevice(fullDevice, vendor, deviceType)
			if fullVendorResolution.Profile.Key != "" && fullVendorResolution.Profile.Key != vendorProfile.Key {
				vendorProfile = fullVendorResolution.Profile
				parameterProfileSource = fullVendorResolution.Source
			}

			if pppoeUsername == "" {
				pppoeUsername = extractPPPoEUsername(fullDevice, vendorProfile.PPPoEUsernameKeys)
			}
			if len(ssidList) == 0 {
				ssidList = extractSSIDList(fullDevice)
			}
			if len(wifiProfiles) == 0 || !hasNonEmptyWiFiPassword(wifiProfiles) {
				wifiProfiles = extractWiFiProfiles(fullDevice, vendorProfile.WiFiPasswordKeys)
			}
			if len(clientList) == 0 {
				clientList = extractClientList(fullDevice)
			}
			if ipPPPoE == "" {
				ipPPPoE = extractPPPoEIP(fullDevice)
			}
			if ipTR069 == "" {
				ipTR069 = extractTR069IP(fullDevice)
			}
			if ipLocal == "" {
				ipLocal = resolveLANGateway(extractLocalIP(fullDevice), clientList)
			}
			if deviceUptime == "" {
				deviceUptime = extractDeviceUptime(fullDevice)
			}
			if pppoePassword == "" {
				pppoePassword = extractPPPoEPassword(fullDevice, vendorProfile.PPPoEPasswordKeys)
			}
			if webAdminUsername == "" {
				webAdminUsername = extractWebAdminUsername(fullDevice, vendorProfile.WebAdminUsernamePath)
			}
			if webAdminPassword == "" {
				webAdminPassword = extractWebAdminPassword(fullDevice, vendorProfile.WebAdminPasswordPath)
			}
			if webUserPassword == "" {
				webUserPassword = extractWebUserPassword(fullDevice, vendorProfile.WebUserPasswordPath)
			}
			if virtualWiFiPassword == "" {
				virtualWiFiPassword = extractVirtualWiFiPassword(fullDevice)
			}
			if fallbackRXPower, ok := extractRXPowerFromDevice(fullDevice); ok {
				rxPowerValue = fallbackRXPower
				hasRXPower = true
			}
			if fallbackTemperature, ok := extractTemperatureFromDevice(fullDevice); ok {
				temperatureValue = fallbackTemperature
				hasTemperature = true
			}

			stillMissingCritical := pppoeUsername == "" || pppoePassword == "" || deviceUptime == "" || (ipPPPoE == "" && ipTR069 == "") || !hasRXPower || !hasTemperature || (len(wifiProfiles) > 0 && !hasNonEmptyWiFiPassword(wifiProfiles)) || virtualWiFiPassword == ""
			if stillMissingCritical {
				if rawDevice, rawErr := fetchGenieACSDeviceByID(genieACSURL, deviceID, nil); rawErr == nil && rawDevice != nil {
					if pppoeUsername == "" {
						pppoeUsername = extractPPPoEUsername(rawDevice, vendorProfile.PPPoEUsernameKeys)
					}
					if pppoePassword == "" {
						pppoePassword = extractPPPoEPassword(rawDevice, vendorProfile.PPPoEPasswordKeys)
					}
					if ipPPPoE == "" {
						ipPPPoE = extractPPPoEIP(rawDevice)
					}
					if ipTR069 == "" {
						ipTR069 = extractTR069IP(rawDevice)
					}
					if ipLocal == "" {
						ipLocal = resolveLANGateway(extractLocalIP(rawDevice), clientList)
					}
					if deviceUptime == "" {
						deviceUptime = extractDeviceUptime(rawDevice)
					}
					if virtualWiFiPassword == "" {
						virtualWiFiPassword = extractVirtualWiFiPassword(rawDevice)
					}
					if len(wifiProfiles) == 0 || !hasNonEmptyWiFiPassword(wifiProfiles) {
						wifiProfiles = extractWiFiProfiles(rawDevice, vendorProfile.WiFiPasswordKeys)
					}
					if !hasRXPower {
						if fallbackRXPower, ok := extractRXPowerFromDevice(rawDevice); ok {
							rxPowerValue = fallbackRXPower
							hasRXPower = true
						}
					}
					if !hasTemperature {
						if fallbackTemperature, ok := extractTemperatureFromDevice(rawDevice); ok {
							temperatureValue = fallbackTemperature
							hasTemperature = true
						}
					}
				}
			}
		}
	}

	if virtualWiFiPassword != "" && len(wifiProfiles) > 0 {
		applied := false
		for _, profile := range wifiProfiles {
			index := strings.TrimSpace(extractStringValue(profile["index"]))
			password := strings.TrimSpace(extractStringValue(profile["password"]))
			if index == "1" && password == "" {
				profile["password"] = virtualWiFiPassword
				applied = true
				break
			}
		}
		if !applied {
			for _, profile := range wifiProfiles {
				password := strings.TrimSpace(extractStringValue(profile["password"]))
				if password == "" {
					profile["password"] = virtualWiFiPassword
					break
				}
			}
		}
	}

	liveWiFiPasswords := collectWiFiPasswordSnapshotFromProfiles(wifiProfiles)
	_ = db.UpsertDeviceCredentials(deviceID, nonEmptyStringPointer(pppoeUsername), nonEmptyStringPointer(pppoePassword), liveWiFiPasswords)

	if storedCredentials, err := db.GetDeviceCredentials(deviceID); err == nil && storedCredentials != nil {
		if pppoeUsername == "" {
			pppoeUsername = storedCredentials.PPPoEUsername
		}
		applyStoredWiFiPasswords(wifiProfiles, storedCredentials.WiFiPasswords)
	}

	activeWiFiProfiles := extractActiveWiFiProfiles(wifiProfiles)
	activeSSIDList := extractSSIDListFromProfiles(activeWiFiProfiles)

	activeOnly := true
	if parsed, ok := parseBoolLike(strings.TrimSpace(r.URL.Query().Get("active_only"))); ok {
		activeOnly = parsed
	}

	if activeOnly && len(activeWiFiProfiles) > 0 {
		wifiProfiles = activeWiFiProfiles
		ssidList = activeSSIDList
	}
	wifiProfiles = sanitizeWiFiProfilesForResponse(wifiProfiles)
	lastInformAt := ""
	if lastInform, ok := parseLastInform(device); ok {
		lastInformAt = lastInform.UTC().Format(time.RFC3339)
	}

	includeRaw := false
	if parsed, ok := parseBoolLike(strings.TrimSpace(r.URL.Query().Get("raw"))); ok {
		includeRaw = parsed
	}

	response := make(map[string]interface{}, 16)
	if includeRaw {
		response = make(map[string]interface{}, len(device)+16)
		for key, value := range device {
			response[key] = value
		}
	}
	response["device_id"] = deviceID
	response["serial_number"] = serialNumber
	response["device_type"] = deviceType
	response["vendor"] = vendor
	response["parameter_profile"] = vendorProfile.Key
	response["parameter_profile_source"] = parameterProfileSource
	response["pppoe_username"] = pppoeUsername
	if strings.TrimSpace(pppoePassword) == "" {
		response["pppoe_password"] = nil
	} else {
		response["pppoe_password"] = pppoePassword
	}
	response["web_admin_username"] = webAdminUsername
	response["web_admin_password"] = webAdminPassword
	response["web_user_password"] = webUserPassword
	response["ip_pppoe"] = dashIfEmpty(ipPPPoE)
	response["ip_tr069"] = dashIfEmpty(ipTR069)
	response["ip_address"] = dashIfEmpty(ipLocal)
	response["ipv6_address"] = ipv6Address
	response["ssid_list"] = ssidList
	response["wifi_profiles"] = wifiProfiles
	response["client_list"] = clientList
	response["tags"] = tags
	response["last_inform_at"] = lastInformAt
	response["device_uptime"] = dashIfEmpty(deviceUptime)
	if hasTemperature {
		response["temp"] = math.Round(temperatureValue*100) / 100
	} else {
		response["temp"] = nil
	}
	if hasRXPower {
		response["rx_power"] = math.Round(rxPowerValue*100) / 100
	} else {
		response["rx_power"] = nil
	}
	missingFields := computeACSMissingFields(pppoeUsername, hasRXPower, hasTemperature, deviceUptime)
	response["is_incomplete"] = len(missingFields) > 0
	response["missing_fields"] = missingFields

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}

func triggerACSDetailAutoRefresh(genieACSURL string, deviceID string) {
	if strings.TrimSpace(genieACSURL) == "" || strings.TrimSpace(deviceID) == "" {
		return
	}

	now := time.Now().UTC()
	if lastRefreshRaw, ok := acsDetailAutoRefreshState.Load(deviceID); ok {
		if lastRefresh, ok := lastRefreshRaw.(time.Time); ok && now.Sub(lastRefresh) < acsDetailAutoRefreshInterval {
			return
		}
	}
	acsDetailAutoRefreshState.Store(deviceID, now)

	if queued, failed := enqueueACSRefreshTargets(genieACSURL, deviceID, defaultACSRefreshObjects()); queued == 0 && failed > 0 {
		log.Printf("[acs] auto refresh enqueue failed for %s (failed=%d)", deviceID, failed)
		acsDetailAutoRefreshState.Delete(deviceID)
	}
}

func refreshACSDetailAndWait(genieACSURL string, deviceID string, timeout time.Duration) error {
	objectNames := defaultACSRefreshObjects()
	taskIDs := make([]string, 0, len(objectNames))
	for _, objectName := range objectNames {
		taskStatus, err := services.GetGenieACSService().EnqueueTask(genieACSURL, deviceID, map[string]interface{}{
			"name":       "refreshObject",
			"objectName": objectName,
		})
		if err != nil {
			return err
		}
		taskIDs = append(taskIDs, taskStatus.ID)
	}

	return waitForACSRefreshTasks(taskIDs, timeout)
}

func waitForACSRefreshTasks(taskIDs []string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		pending := 0
		for _, taskID := range taskIDs {
			current, ok := services.GetGenieACSService().GetTaskStatus(taskID)
			if !ok {
				pending++
				continue
			}
			switch current.Status {
			case services.TaskSuccess:
				continue
			case services.TaskFailed:
				if strings.TrimSpace(current.Error) != "" {
					return fmt.Errorf(current.Error)
				}
				return fmt.Errorf("refresh task failed")
			default:
				pending++
			}
		}
		if pending == 0 {
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}

	return fmt.Errorf("refresh_wait timed out after %s", timeout)
}
