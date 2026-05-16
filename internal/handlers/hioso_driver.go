package handlers

import (
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"strings"
	"time"
)

// DTO untuk list ONU (format ringkas ke frontend)
type HiosoONU struct {
	Index   string  `json:"index"`
	WebID   string  `json:"web_id"`
	Name    string  `json:"name"`
	SN      string  `json:"sn"`
	Status  string  `json:"status"`
	TxPower float64 `json:"tx_power"`
	RxPower float64 `json:"rx_power"`
	Profile string  `json:"profile"`
}

// DTO untuk detail ONU (format kaya)
type HiosoONUDetail struct {
	Index        string  `json:"index"`
	WebID        string  `json:"web_id"`
	Name         string  `json:"name"`
	SN           string  `json:"sn"`
	Status       string  `json:"status"`
	TxPower      float64 `json:"tx_power"`
	RxPower      float64 `json:"rx_power"`
	Profile      string  `json:"profile"`
	Firmware     string  `json:"firmware"`
	Temperature  float64 `json:"temperature"`
	Distance     int     `json:"distance"`
	Uptime       int     `json:"uptime"`
	RegisteredAt string  `json:"registered_at"`
	LastOnlineAt string  `json:"last_online_at"`
	ChipID       string  `json:"chip_id"`
	Ports        string  `json:"ports"`
	Voltage      float64 `json:"voltage"`
	BiasCurrent  float64 `json:"bias_current"`
}

// DTO untuk system info OLT
type HiosoSystemInfo struct {
	Model        string `json:"model"`
	Firmware     string `json:"firmware"`
	MAC          string `json:"mac"`
	IP           string `json:"ip"`
	Uptime       string `json:"uptime"`
	CPU          string `json:"cpu"`
	Memory       string `json:"memory"`
	SerialNumber string `json:"serial_number"`
	TotalONU     int    `json:"total_onu"`
	OnlineONU    int    `json:"online_onu"`
}

// HiosoDriver — interface untuk kedua firmware family
type HiosoDriver interface {
	GetSystemInfo() (*HiosoSystemInfo, error)
	ListAllONU() ([]HiosoONU, error)
	ListONUByPort(port int) ([]HiosoONU, error)
	GetONUDetail(onuID string) (*HiosoONUDetail, error)
	RenameONU(onuID, newName string) error
	RebootONU(onuID string) error
	Close()
}

// HiosoDetectFirmware mencoba auto-detect firmware OLT.
// Coba swcgi_xml (login via POST /sw.cgi), fallback legacy_html (GET /system.asp dengan Basic auth).
func HiosoDetectFirmware(host string, port int, user, pass string) (string, error) {
	baseURL := fmt.Sprintf("http://%s:%d", host, port)
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Timeout: 10 * time.Second, Jar: jar}

	// Coba swcgi_xml: login via POST /sw.cgi set=login&user=base64(user&pass)
	cred := base64.StdEncoding.EncodeToString([]byte(user + "&" + pass))
	loginPayload := "set=login&user=" + cred
	swReq, _ := http.NewRequest("POST", baseURL+"/sw.cgi", strings.NewReader(loginPayload))
	swReq.Header.Set("Content-Type", "uni_mars_ap")
	swReq.Header.Set("Origin", baseURL)
	swReq.Header.Set("Referer", baseURL+"/")
	resp, err := client.Do(swReq)
	if err == nil {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		bodyStr := string(body)
		// Login sukses = value="0", gagal = value="-1"
		if strings.Contains(bodyStr, "<xml") || strings.Contains(bodyStr, "<item") {
			if !strings.Contains(bodyStr, `value="-1"`) {
				return "swcgi_xml", nil
			}
		}
	}

	// Coba legacy_html: GET /system.asp dengan Basic auth
	sysReq, _ := http.NewRequest("GET", baseURL+"/system.asp", nil)
	sysReq.SetBasicAuth(user, pass)
	sysResp, err := client.Do(sysReq)
	if err == nil {
		body, _ := io.ReadAll(sysResp.Body)
		sysResp.Body.Close()
		if strings.Contains(string(body), "sysInfo") || strings.Contains(string(body), "new Array") {
			return "legacy_html", nil
		}
	}

	return "", fmt.Errorf("tidak dapat mendeteksi firmware OLT di %s:%d", host, port)
}

// HiosoNewDriver membuat driver sesuai firmware type.
func HiosoNewDriver(firmwareType, host string, port int, user, pass string) (HiosoDriver, error) {
	switch firmwareType {
	case "swcgi_xml":
		return newSwcgiDriver(host, port, user, pass)
	case "legacy_html":
		return newLegacyDriver(host, port, user, pass)
	default:
		return nil, fmt.Errorf("firmware type tidak dikenal: %s", firmwareType)
	}
}

// hiosoTruncateName memotong nama ONU max 31 char dan strip koma.
func hiosoTruncateName(name string) string {
	name = strings.ReplaceAll(strings.TrimSpace(name), ",", "")
	if len([]rune(name)) > 31 {
		return string([]rune(name)[:31])
	}
	return name
}

// hiosoBuildOnuID membuat onuID sesuai firmware type.
func hiosoBuildOnuID(firmwareType, port, id string) string {
	if firmwareType == "swcgi_xml" {
		return fmt.Sprintf("1/%s:%s", port, id)
	}
	return fmt.Sprintf("0/%s:%s", port, id)
}
