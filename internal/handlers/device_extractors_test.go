package handlers

import (
	"math"
	"testing"
)

func TestExtractZTEWANPONRawRXPower(t *testing.T) {
	device := map[string]interface{}{
		"InternetGatewayDevice": map[string]interface{}{
			"WANDevice": map[string]interface{}{
				"2": map[string]interface{}{
					"X_ZTE-COM_WANPONInterfaceConfig": map[string]interface{}{
						"RXPower": map[string]interface{}{"_value": 59.0},
					},
				},
			},
		},
	}

	rx, ok := extractRXPowerFromDevice(device)
	if !ok {
		t.Fatalf("expected RX power to resolve")
	}
	want := -22.29
	if math.Abs(rx-want) > 0.2 {
		t.Fatalf("expected approx %v, got %v", want, rx)
	}
}

func TestExtractTR069IPFromConnectionRequestURL(t *testing.T) {
	device := map[string]interface{}{
		"InternetGatewayDevice": map[string]interface{}{
			"ManagementServer": map[string]interface{}{
				"ConnectionRequestURL": map[string]interface{}{"_value": "http://10.100.8.59:7547"},
			},
		},
	}

	if got := extractTR069IP(device); got != "10.100.8.59" {
		t.Fatalf("expected tr069 ip 10.100.8.59, got %q", got)
	}
}

func TestExtractPPPoEIPFromWANPPPConnection2(t *testing.T) {
	device := map[string]interface{}{
		"InternetGatewayDevice": map[string]interface{}{
			"WANDevice": map[string]interface{}{
				"1": map[string]interface{}{
					"WANConnectionDevice": map[string]interface{}{
						"1": map[string]interface{}{
							"WANPPPConnection": map[string]interface{}{
								"2": map[string]interface{}{
									"ExternalIPAddress": map[string]interface{}{"_value": "10.20.30.40"},
								},
							},
						},
					},
				},
			},
		},
	}

	if got := extractPPPoEIP(device); got != "10.20.30.40" {
		t.Fatalf("expected pppoe ip 10.20.30.40, got %q", got)
	}
}
