package handlers

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

func normalizeXSDType(parameterType string, value interface{}) string {
	normalized := strings.ToLower(strings.TrimSpace(parameterType))
	switch normalized {
	case "xsd:boolean", "boolean", "bool", "xsd:bool":
		return "xsd:boolean"
	case "xsd:int", "int", "integer", "xsd:integer", "xsd:unsignedint", "unsignedint", "xsd:long", "long":
		return "xsd:int"
	case "xsd:double", "double", "float", "xsd:float", "number":
		return "xsd:double"
	case "xsd:string", "string", "", "xsd":
	default:
		if strings.HasPrefix(normalized, "xsd:") {
			return normalized
		}
	}

	switch typedValue := value.(type) {
	case bool:
		return "xsd:boolean"
	case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return "xsd:int"
	case float32:
		if float32(int64(typedValue)) == typedValue {
			return "xsd:int"
		}
		return "xsd:double"
	case float64:
		if math.Trunc(typedValue) == typedValue {
			return "xsd:int"
		}
		return "xsd:double"
	case json.Number:
		if strings.Contains(typedValue.String(), ".") {
			return "xsd:double"
		}
		return "xsd:int"
	default:
		return "xsd:string"
	}
}

func normalizeParameterValue(value interface{}, xsdType string) (interface{}, error) {
	switch xsdType {
	case "xsd:boolean":
		switch typedValue := value.(type) {
		case bool:
			return typedValue, nil
		case float64:
			return typedValue != 0, nil
		case float32:
			return typedValue != 0, nil
		case int:
			return typedValue != 0, nil
		case int64:
			return typedValue != 0, nil
		case string:
			parsed, ok := parseBoolLike(typedValue)
			if !ok {
				return nil, fmt.Errorf("invalid boolean value: %q", typedValue)
			}
			return parsed, nil
		default:
			textValue := extractStringValue(value)
			parsed, ok := parseBoolLike(textValue)
			if !ok {
				return nil, fmt.Errorf("invalid boolean value: %q", textValue)
			}
			return parsed, nil
		}
	case "xsd:int":
		if parsed, ok := extractNumericValue(value); ok {
			return int64(math.Round(parsed)), nil
		}
		return nil, fmt.Errorf("invalid integer value")
	case "xsd:double", "xsd:float":
		if parsed, ok := extractNumericValue(value); ok {
			return parsed, nil
		}
		return nil, fmt.Errorf("invalid numeric value")
	default:
		return extractStringValue(value), nil
	}
}

// NOTE: this function is duplicated in internal/scheduler/acs_offline_summon_scheduler.go
// If you modify this, update the duplicate too.
func parseLastInform(device map[string]interface{}) (time.Time, bool) {
	value, ok := extractValueByKey(device, "_lastInform")
	if !ok {
		return time.Time{}, false
	}

	text := extractStringValue(value)
	if text == "" {
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

func normalizeLookupKey(key string) string {
	key = strings.ToLower(key)
	var builder strings.Builder
	builder.Grow(len(key))

	for i := 0; i < len(key); i++ {
		ch := key[i]
		if (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') {
			builder.WriteByte(ch)
		}
	}

	return builder.String()
}

func normalizeRXPowerValue(value float64) (float64, bool) {
	tryValues := []float64{value}
	if math.Abs(value) >= 100 {
		tryValues = append(tryValues, value/10, value/100, value/1000, value/256)
	}

	for _, candidate := range tryValues {
		normalized := candidate
		if normalized > 0 && normalized <= 60 {
			normalized = -normalized
		}
		if normalized >= -60 && normalized <= 10 {
			return normalized, true
		}
	}

	if value > 1000 {
		dbm := 30 + 10*math.Log10(value*math.Pow(10, -7))
		if dbm >= -60 && dbm <= 10 {
			return dbm, true
		}
	}

	return 0, false
}

func normalizeTemperatureValue(value float64) (float64, bool) {
	tryValues := []float64{value}
	if math.Abs(value) >= 100 {
		tryValues = append(tryValues, value/10, value/100, value/256, value/1000)
	}

	for _, candidate := range tryValues {
		if candidate >= -20 && candidate <= 90 {
			return candidate, true
		}
	}

	return 0, false
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}

	return ""
}

func dashIfEmpty(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "-"
	}
	return trimmed
}

func parseBoolLike(value string) (bool, bool) {
	normalized := strings.ToLower(strings.TrimSpace(value))
	switch normalized {
	case "1", "true", "yes", "on", "up", "active":
		return true, true
	case "0", "false", "no", "off", "down", "inactive":
		return false, true
	default:
		return false, false
	}
}

func normalizeDeviceUptime(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}

	lower := strings.ToLower(trimmed)
	if strings.Contains(lower, "d") && strings.Contains(trimmed, ":") {
		return trimmed
	}
	if strings.Contains(trimmed, ":") {
		return trimmed
	}

	secondsText := strings.TrimSpace(strings.TrimSuffix(lower, "s"))
	if secondsText == "" {
		return trimmed
	}

	if secondsInt, err := strconv.ParseInt(secondsText, 10, 64); err == nil {
		if secondsInt < 0 {
			return trimmed
		}
		return formatUptimeSeconds(secondsInt)
	}

	if secondsFloat, err := strconv.ParseFloat(secondsText, 64); err == nil {
		if secondsFloat < 0 {
			return trimmed
		}
		return formatUptimeSeconds(int64(math.Round(secondsFloat)))
	}

	return trimmed
}

func formatUptimeSeconds(totalSeconds int64) string {
	days := totalSeconds / 86400
	remaining := totalSeconds % 86400
	hours := remaining / 3600
	remaining %= 3600
	minutes := remaining / 60
	seconds := remaining % 60

	return fmt.Sprintf("%dd %02d:%02d:%02d", days, hours, minutes, seconds)
}

func compactVendorName(vendor, profileKey string) string {
	key := strings.TrimSpace(strings.ToLower(profileKey))
	switch key {
	case "huawei":
		return "Huawei"
	case "zte":
		return "ZTE"
	case "fiberhome":
		return "FiberHome"
	case "ciot":
		return "CIOT"
	case "nokia":
		return "Nokia"
	}

	raw := strings.TrimSpace(vendor)
	if raw == "" {
		return ""
	}

	lower := strings.ToLower(raw)
	switch {
	case strings.Contains(lower, "huawei"):
		return "Huawei"
	case strings.Contains(lower, "zte"):
		return "ZTE"
	case strings.Contains(lower, "fiberhome"), strings.Contains(lower, "fiber home"), strings.Contains(lower, "fh"):
		return "FiberHome"
	case strings.Contains(lower, "nokia"), strings.Contains(lower, "alu"):
		return "Nokia"
	case strings.Contains(lower, "ciot"), strings.Contains(lower, "gm220"):
		return "CIOT"
	case strings.Contains(lower, "cmcc"):
		return "CMCC"
	case strings.Contains(lower, "ct-com"), strings.Contains(lower, "ctcom"):
		return "CT-COM"
	}

	if idx := strings.Index(raw, ","); idx > 0 {
		raw = strings.TrimSpace(raw[:idx])
	}

	return raw
}
