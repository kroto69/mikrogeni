package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"genieacs-backend/internal/db"
	"genieacs-backend/internal/services"

	"github.com/go-chi/chi/v5"
)

func getGenieACSURL() (string, error) {
	settings, err := db.GetSettings([]string{"genieacs_url"})
	if err != nil {
		return "", err
	}

	genieACSURL := strings.TrimSpace(settings["genieacs_url"])
	if genieACSURL == "" {
		return "", fmt.Errorf("genieacs_url is not configured")
	}

	return genieACSURL, nil
}

func fetchGenieACSDevices(genieACSURL string, projection []string, query string) ([]map[string]interface{}, error) {
	return services.GetGenieACSService().FetchDevices(genieACSURL, projection, query)
}

func fetchGenieACSDeviceByID(genieACSURL, deviceID string, projection []string) (map[string]interface{}, error) {
	return services.GetGenieACSService().FetchDeviceByID(genieACSURL, deviceID, projection)
}

func resolveDeviceID(r *http.Request) string {
	return strings.TrimSpace(chi.URLParam(r, "id"))
}

func buildSetParameterValues(parameters []deviceParameterInput) ([][]interface{}, error) {
	if len(parameters) == 0 {
		return nil, fmt.Errorf("no parameters provided")
	}

	parameterValues := make([][]interface{}, 0, len(parameters))
	for _, parameter := range parameters {
		name := strings.TrimSpace(parameter.Name)
		if name == "" {
			return nil, fmt.Errorf("parameter name is required")
		}

		xsdType := normalizeXSDType(parameter.Type, parameter.Value)
		normalizedValue, err := normalizeParameterValue(parameter.Value, xsdType)
		if err != nil {
			return nil, fmt.Errorf("parameter %s: %w", name, err)
		}

		parameterValues = append(parameterValues, []interface{}{name, normalizedValue, xsdType})
	}

	return parameterValues, nil
}

func persistConfig(settingKey string, payload map[string]interface{}) error {
	if len(payload) == 0 {
		return fmt.Errorf("configuration payload is empty")
	}

	rawPayload, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	if err := db.SetSetting(settingKey, string(rawPayload)); err != nil {
		return err
	}

	return db.SetSetting(settingKey+"_updated_at", time.Now().UTC().Format(time.RFC3339))
}
