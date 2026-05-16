package handlers

import (
	"encoding/json"
	"net/http"
)

// pluginJSON mengirim response sukses dengan envelope standar plugin.
func pluginJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    data,
		"error":   "",
	})
}

// pluginError mengirim response error dengan envelope standar plugin.
func pluginError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": false,
		"data":    nil,
		"error":   msg,
	})
}
