package handlers

import (
	"encoding/json"
	"math"
	"net/http"
	"time"

	"genieacs-backend/internal/models"
)

func GetDashboard(w http.ResponseWriter, r *http.Request) {
	genieACSURL, err := getGenieACSURL()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to resolve GenieACS URL", Detail: err.Error()})
		return
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
		w.WriteHeader(http.StatusBadGateway)
		json.NewEncoder(w).Encode(models.ErrorResponse{Error: "Failed to fetch dashboard data", Detail: err.Error()})
		return
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

	averageRXPower := 0.0
	if rXCount > 0 {
		averageRXPower = math.Round((runningRXTotal/float64(rXCount))*100) / 100
	}

	averageTemp := 0.0
	if tempCount > 0 {
		averageTemp = math.Round((runningTempTotal/float64(tempCount))*100) / 100
	}

	stats := models.DashboardStats{
		TotalDevices:   len(devices),
		OnlineDevices:  onlineCount,
		OfflineDevices: len(devices) - onlineCount,
		AverageRXPower: averageRXPower,
		AverageTemp:    averageTemp,
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(stats)
}

func HealthCheck(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
