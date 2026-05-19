package handlers

import (
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Driver untuk firmware HA7304VX (swcgi_xml)
type hiosoSwcgiDriver struct {
	client  *http.Client
	baseURL string
}

func newSwcgiDriver(host string, port int, user, pass string) (*hiosoSwcgiDriver, error) {
	jar, _ := cookiejar.New(nil)
	d := &hiosoSwcgiDriver{
		client:  &http.Client{Timeout: 30 * time.Second, Jar: jar},
		baseURL: fmt.Sprintf("http://%s:%d", host, port),
	}
	// Login: POST /sw.cgi dengan set=login&user=base64(USER&PASS)
	cred := base64.StdEncoding.EncodeToString([]byte(user + "&" + pass))
	payload := "set=login&user=" + cred
	body, err := d.postSWCGI(payload, d.baseURL+"/")
	if err != nil {
		return nil, fmt.Errorf("login swcgi gagal: %w", err)
	}
	if body == "" {
		return nil, fmt.Errorf("login swcgi gagal: empty response (OLT tidak merespons)")
	}
	if strings.Contains(body, `value="-1"`) {
		return nil, fmt.Errorf("login swcgi gagal: credential salah")
	}
	return d, nil
}

func (d *hiosoSwcgiDriver) Close() {}

func (d *hiosoSwcgiDriver) postSWCGI(payload string, referer string) (string, error) {
	req, err := http.NewRequest("POST", d.baseURL+"/sw.cgi", strings.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "uni_mars_ap")
	req.Header.Set("Origin", d.baseURL)
	req.Header.Set("Referer", referer)
	req.Header.Set("X-Requested-With", "XMLHttpRequest")
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set("Pragma", "no-cache")
	req.ContentLength = int64(len(payload))
	resp, err := d.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

var swcgiItemRegex = regexp.MustCompile(`<item\s+onu="([^"]+)"`)
var swcgiAttrItemRegex = regexp.MustCompile(`<item\s+([^>]+)/>`)

func (d *hiosoSwcgiDriver) GetSystemInfo() (*HiosoSystemInfo, error) {
	body, err := d.postSWCGI("get=sysinfo2&sysunit=1", d.baseURL+"/m/system_info.htm")
	if err != nil {
		return nil, err
	}
	info := &HiosoSystemInfo{}
	for _, m := range swcgiAttrItemRegex.FindAllStringSubmatch(body, -1) {
		if len(m) < 2 {
			continue
		}
		attrs := m[1]
		if v := swcgiExtractAttr(attrs, "model"); v != "" {
			info.Model = v
		}
		if v := swcgiExtractAttr(attrs, "version"); v != "" {
			parts := strings.SplitN(v, "?", 2)
			info.Firmware = parts[0]
		}
		if v := swcgiExtractAttr(attrs, "sys_mac"); v != "" {
			info.MAC = v
		}
		if v := swcgiExtractAttr(attrs, "ip"); v != "" {
			info.IP = v
		}
		if v := swcgiExtractAttr(attrs, "uptime"); v != "" {
			parts := strings.Split(v, "?")
			if len(parts) >= 4 {
				info.Uptime = parts[0] + "d " + parts[1] + "h " + parts[2] + "m " + parts[3] + "s"
			} else {
				info.Uptime = v
			}
		}
		if v := swcgiExtractAttr(attrs, "cpu"); v != "" {
			info.CPU = v + "%"
		}
		if v := swcgiExtractAttr(attrs, "memory"); v != "" {
			parts := strings.Split(v, "?")
			if len(parts) >= 3 {
				total, _ := strconv.Atoi(parts[0])
				used, _ := strconv.Atoi(parts[1])
				if total > 0 {
					pct := float64(used) * 100 / float64(total)
					info.Memory = fmt.Sprintf("%.1f%%", pct)
				} else {
					info.Memory = v
				}
			} else {
				info.Memory = v
			}
		}
		if v := swcgiExtractAttr(attrs, "sn"); v != "" {
			info.SerialNumber = v
		}
		if v := swcgiExtractAttr(attrs, "devInfo"); v != "" {
			parts := strings.Split(v, "?")
			if len(parts) >= 2 {
				info.TotalONU, _ = strconv.Atoi(parts[0])
				info.OnlineONU, _ = strconv.Atoi(parts[1])
			}
		}
	}
	return info, nil
}

func swcgiExtractAttr(attrs, key string) string {
	re := regexp.MustCompile(key + `="([^"]*)"`)
	m := re.FindStringSubmatch(attrs)
	if len(m) >= 2 {
		return m[1]
	}
	return ""
}

func (d *hiosoSwcgiDriver) ListONUByPort(port int) ([]HiosoONU, error) {
	payload := fmt.Sprintf("get=info&sysUnit=1&ponport=%d&displayfunc=displayAll", port)
	referer := fmt.Sprintf("%s/m/onu_info.htm?ponport=%d", d.baseURL, port)
	body, err := d.postSWCGI(payload, referer)
	if err != nil {
		return nil, fmt.Errorf("request gagal: %w", err)
	}
	matches := swcgiItemRegex.FindAllStringSubmatch(body, -1)
	var result []HiosoONU
	for _, m := range matches {
		if len(m) < 2 {
			continue
		}
		onu := swcgiParseONULine(m[1])
		if onu != nil {
			result = append(result, *onu)
		}
	}
	return result, nil
}

func (d *hiosoSwcgiDriver) ListAllONU() ([]HiosoONU, error) {
	var all []HiosoONU
	emptyCount := 0
	for ponPort := 1; ponPort <= 16; ponPort++ {
		payload := fmt.Sprintf("get=info&sysUnit=1&ponport=%d&displayfunc=displayAll", ponPort)
		referer := fmt.Sprintf("%s/m/onu_info.htm?ponport=%d", d.baseURL, ponPort)
		body, err := d.postSWCGI(payload, referer)
		if err != nil {
			emptyCount++
			if emptyCount >= 3 {
				break
			}
			continue
		}
		matches := swcgiItemRegex.FindAllStringSubmatch(body, -1)
		if len(matches) == 0 {
			emptyCount++
			if emptyCount >= 3 {
				break
			}
			continue
		}
		emptyCount = 0
		for _, m := range matches {
			if len(m) < 2 {
				continue
			}
			onu := swcgiParseONULine(m[1])
			if onu != nil {
				all = append(all, *onu)
			}
		}
	}
	return all, nil
}

// swcgiParseONULine parse 16-field CSV dari atribut onu="..."
func swcgiParseONULine(csv string) *HiosoONU {
	fields := strings.Split(csv, ",")
	if len(fields) < 16 {
		return nil
	}
	onuID := strings.TrimSpace(fields[0])
	tx, _ := strconv.ParseFloat(strings.TrimSpace(fields[14]), 64)
	rx, _ := strconv.ParseFloat(strings.TrimSpace(fields[15]), 64)
	return &HiosoONU{
		Index:   onuID,
		WebID:   onuID,
		Name:    strings.TrimSpace(fields[1]),
		SN:      strings.TrimSpace(fields[2]),
		Status:  strings.TrimSpace(fields[3]),
		TxPower: tx,
		RxPower: rx,
		Profile: "swcgi_xml",
	}
}

func (d *hiosoSwcgiDriver) GetONUDetail(onuID string) (*HiosoONUDetail, error) {
	ponPort, payloadID := swcgiParseOnuID(onuID)
	payload := fmt.Sprintf("get=config&sysUnit=1&ponport=%d&onuid=%s", ponPort, payloadID)
	referer := fmt.Sprintf("%s/m/onu_config.htm?ponport=%d&onuid=%s", d.baseURL, ponPort, payloadID)
	body, err := d.postSWCGI(payload, referer)
	if err != nil {
		return nil, err
	}
	m := swcgiItemRegex.FindStringSubmatch(body)
	if len(m) < 2 {
		return nil, fmt.Errorf("detail ONU %s tidak ditemukan dalam response: %s", onuID, body)
	}
	fields := strings.Split(m[1], ",")
	if len(fields) < 18 {
		return nil, fmt.Errorf("detail ONU %s: field kurang, dapat %d field", onuID, len(fields))
	}
	return swcgiParseDetail(fields), nil
}

func swcgiParseDetail(fields []string) *HiosoONUDetail {
	temp, _ := strconv.ParseFloat(strings.TrimSpace(safeIdx(fields, 13)), 64)
	tx, _ := strconv.ParseFloat(strings.TrimSpace(safeIdx(fields, 16)), 64)
	rx, _ := strconv.ParseFloat(strings.TrimSpace(safeIdx(fields, 17)), 64)
	uptime, _ := strconv.Atoi(strings.TrimSpace(safeIdx(fields, 18)))
	onuID := strings.TrimSpace(safeIdx(fields, 0))

	return &HiosoONUDetail{
		Index:        onuID,
		WebID:        onuID,
		Name:         strings.TrimSpace(safeIdx(fields, 1)),
		SN:           strings.TrimSpace(safeIdx(fields, 2)),
		Status:       strings.TrimSpace(safeIdx(fields, 3)),
		Firmware:     strings.TrimSpace(safeIdx(fields, 4)),
		ChipID:       strings.TrimSpace(safeIdx(fields, 5)),
		Ports:        strings.TrimSpace(safeIdx(fields, 6)),
		RegisteredAt: strings.TrimSpace(safeIdx(fields, 7)),
		LastOnlineAt: strings.TrimSpace(safeIdx(fields, 8)),
		Temperature:  temp,
		TxPower:      tx,
		RxPower:      rx,
		Uptime:       uptime,
		Profile:      "swcgi_xml",
	}
}

func (d *hiosoSwcgiDriver) RenameONU(onuID, newName string) error {
	newName = hiosoTruncateName(newName)
	ponPort, payloadID := swcgiParseOnuID(onuID)
	payload := fmt.Sprintf("set=config&sysUnit=1&ponport=%d&onuid=%s&onuopt=nonOp&onuname=%s", ponPort, payloadID, newName)
	referer := fmt.Sprintf("%s/m/onu_config.htm?ponport=%d&onuid=%s", d.baseURL, ponPort, payloadID)
	body, err := d.postSWCGI(payload, referer)
	if err != nil {
		return err
	}
	if strings.Contains(body, `value="-1"`) {
		return fmt.Errorf("rename gagal: %s", body)
	}
	return nil
}

func (d *hiosoSwcgiDriver) RebootONU(onuID string) error {
	ponPort, payloadID := swcgiParseOnuID(onuID)
	payload := fmt.Sprintf("set=config&sysUnit=1&ponport=%d&onuid=%s&onuopt=rebootOp&onuname=reboot", ponPort, payloadID)
	referer := fmt.Sprintf("%s/m/onu_config.htm?ponport=%d&onuid=%s", d.baseURL, ponPort, payloadID)
	body, err := d.postSWCGI(payload, referer)
	if err != nil {
		return err
	}
	if strings.Contains(body, `value="-1"`) {
		return fmt.Errorf("reboot gagal: %s", body)
	}
	return nil
}

// swcgiParseOnuID mengkonversi "1/1:3" → ponPort=1, payloadID="1_1:3"
func swcgiParseOnuID(onuID string) (int, string) {
	onuID = strings.TrimSpace(onuID)
	payloadID := strings.ReplaceAll(onuID, "/", "_")
	parts := strings.Split(onuID, "/")
	if len(parts) >= 2 {
		portPart := strings.Split(parts[1], ":")
		if p, err := strconv.Atoi(portPart[0]); err == nil {
			return p, payloadID
		}
	}
	return 1, payloadID
}

func safeIdx(s []string, i int) string {
	if i < len(s) {
		return s[i]
	}
	return ""
}
