package handlers

import (
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Driver untuk firmware V2.1 (legacy_html)
type hiosoLegacyDriver struct {
	client  *http.Client
	baseURL string
	user    string
	pass    string
}

func newLegacyDriver(host string, port int, user, pass string) (*hiosoLegacyDriver, error) {
	jar, _ := cookiejar.New(nil)
	d := &hiosoLegacyDriver{
		client: &http.Client{
			Timeout: 15 * time.Second,
			Jar:     jar,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				// Tetap kirim Basic Auth saat redirect
				if len(via) > 0 {
					req.SetBasicAuth(user, pass)
				}
				return nil
			},
		},
		baseURL: fmt.Sprintf("http://%s:%d", host, port),
		user:    user,
		pass:    pass,
	}
	return d, nil
}

func (d *hiosoLegacyDriver) Close() {}

func (d *hiosoLegacyDriver) get(path string) (string, error) {
	req, err := http.NewRequest("GET", d.baseURL+path, nil)
	if err != nil {
		return "", err
	}
	req.SetBasicAuth(d.user, d.pass)
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

func (d *hiosoLegacyDriver) post(path string, form url.Values) (*http.Response, error) {
	req, err := http.NewRequest("POST", d.baseURL+path, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetBasicAuth(d.user, d.pass)
	return d.client.Do(req)
}

var legacyQuotedRegex = regexp.MustCompile(`'([^']*)'`)

// legacyParseArray mengekstrak isi array JS dari HTML, return slice of string values.
func legacyParseArray(html, varName string) []string {
	re := regexp.MustCompile(`(?s)var\s+` + varName + `\s*=\s*new\s+Array\s*\((.*?)\)\s*;`)
	m := re.FindStringSubmatch(html)
	if len(m) < 2 {
		return nil
	}
	content := m[1]
	// Strip baris komentar JS (// ...)
	lines := strings.Split(content, "\n")
	var cleaned []string
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "//") {
			continue
		}
		cleaned = append(cleaned, line)
	}
	joined := strings.Join(cleaned, "\n")
	// Extract semua quoted values
	matches := legacyQuotedRegex.FindAllStringSubmatch(joined, -1)
	var result []string
	for _, match := range matches {
		if len(match) >= 2 {
			result = append(result, match[1])
		}
	}
	return result
}

func (d *hiosoLegacyDriver) GetSystemInfo() (*HiosoSystemInfo, error) {
	body, err := d.get("/system.asp")
	if err != nil {
		return nil, err
	}
	fields := legacyParseArray(body, "sysInfo")
	if len(fields) == 0 {
		return nil, fmt.Errorf("gagal parse system info: sysInfo tidak ditemukan")
	}
	info := &HiosoSystemInfo{
		Model:    safeIdx(fields, 0),
		Firmware: safeIdx(fields, 4),
		MAC:      safeIdx(fields, 6),
		IP:       safeIdx(fields, 7),
		Uptime:   safeIdx(fields, 8),
	}
	if len(fields) > 10 {
		info.SerialNumber = safeIdx(fields, 10)
	}
	if len(fields) > 9 {
		info.Memory = safeIdx(fields, 9)
	}
	if len(fields) > 11 {
		info.CPU = safeIdx(fields, 11) + "%"
	}
	if len(fields) > 12 {
		info.Memory = safeIdx(fields, 12) + "%"
	}
	return info, nil
}

func (d *hiosoLegacyDriver) ListONUByPort(port int) ([]HiosoONU, error) {
	path := fmt.Sprintf("/onuOverview.asp?oltponno=0/%d", port)
	body, err := d.get(path)
	if err != nil {
		return nil, err
	}
	fields := legacyParseArray(body, "onutable")
	if len(fields) == 0 {
		return nil, nil
	}
	const chunk = 16
	var result []HiosoONU
	for i := 0; i+chunk <= len(fields); i += chunk {
		onu := legacyParseONUChunk(fields[i : i+chunk])
		if onu != nil {
			result = append(result, *onu)
		}
	}
	return result, nil
}

func (d *hiosoLegacyDriver) ListAllONU() ([]HiosoONU, error) {
	body, err := d.get("/onuAllPonOnuList.asp")
	if err != nil {
		return nil, err
	}
	fields := legacyParseArray(body, "onutable")
	if len(fields) == 0 {
		return nil, nil
	}
	// Chunk per 22 field
	const chunk = 22
	var result []HiosoONU
	for i := 0; i+chunk <= len(fields); i += chunk {
		onu := legacyParseONUChunk(fields[i : i+chunk])
		if onu != nil {
			result = append(result, *onu)
		}
	}
	// Fallback: coba chunk 16 jika 22 tidak menghasilkan apa-apa
	if len(result) == 0 && len(fields) >= 16 {
		const chunk16 = 16
		for i := 0; i+chunk16 <= len(fields); i += chunk16 {
			onu := legacyParseONUChunk(fields[i : i+chunk16])
			if onu != nil {
				result = append(result, *onu)
			}
		}
	}
	return result, nil
}

func legacyParseONUChunk(f []string) *HiosoONU {
	if len(f) < 16 {
		return nil
	}
	onuID := strings.TrimSpace(f[0])
	if onuID == "" {
		return nil
	}
	tx, _ := strconv.ParseFloat(strings.TrimSpace(f[14]), 64)
	rx, _ := strconv.ParseFloat(strings.TrimSpace(f[15]), 64)
	return &HiosoONU{
		Index:   onuID,
		WebID:   onuID,
		Name:    strings.TrimSpace(f[1]),
		SN:      strings.TrimSpace(f[2]),
		Status:  strings.TrimSpace(f[3]),
		TxPower: tx,
		RxPower: rx,
		Profile: "legacy_html",
	}
}

func (d *hiosoLegacyDriver) GetONUDetail(onuID string) (*HiosoONUDetail, error) {
	ponPort := legacyExtractPon(onuID)
	path := fmt.Sprintf("/onuConfig.asp?onuno=%s&oltponno=%s", url.QueryEscape(onuID), url.QueryEscape(ponPort))
	body, err := d.get(path)
	if err != nil {
		return nil, err
	}
	infoFields := legacyParseArray(body, "onuinfo")
	opmFields := legacyParseArray(body, "onuOpmInfo")

	if len(infoFields) < 7 {
		return nil, fmt.Errorf("detail ONU %s tidak ditemukan", onuID)
	}

	detail := &HiosoONUDetail{
		Index:   strings.TrimSpace(safeIdx(infoFields, 0)),
		WebID:   strings.TrimSpace(safeIdx(infoFields, 0)),
		Name:    strings.TrimSpace(safeIdx(infoFields, 1)),
		SN:      strings.TrimSpace(safeIdx(infoFields, 2)),
		Status:  strings.TrimSpace(safeIdx(infoFields, 3)),
		Profile: "legacy_html",
		Firmware: strings.TrimSpace(safeIdx(infoFields, 4)),
		ChipID:  strings.TrimSpace(safeIdx(infoFields, 5)),
		Ports:   strings.TrimSpace(safeIdx(infoFields, 6)),
	}
	if len(infoFields) > 7 {
		detail.RegisteredAt = strings.TrimSpace(safeIdx(infoFields, 7))
	}
	if len(infoFields) > 8 {
		detail.LastOnlineAt = strings.TrimSpace(safeIdx(infoFields, 8))
	}

	// Parse OPM info (6 fields: onuId, temp, voltage, bias, tx, rx)
	if len(opmFields) >= 6 {
		detail.Temperature, _ = strconv.ParseFloat(strings.TrimSpace(opmFields[1]), 64)
		detail.Voltage, _ = strconv.ParseFloat(strings.TrimSpace(opmFields[2]), 64)
		detail.BiasCurrent, _ = strconv.ParseFloat(strings.TrimSpace(opmFields[3]), 64)
		detail.TxPower, _ = strconv.ParseFloat(strings.TrimSpace(opmFields[4]), 64)
		detail.RxPower, _ = strconv.ParseFloat(strings.TrimSpace(opmFields[5]), 64)
	}

	return detail, nil
}

func (d *hiosoLegacyDriver) RenameONU(onuID, newName string) error {
	newName = hiosoTruncateName(newName)
	form := url.Values{}
	form.Set("onuId", onuID)
	form.Set("onuName", newName)
	form.Set("onuOperation", "nonOp")
	resp, err := d.post("/goform/setOnu", form)
	if err != nil {
		return fmt.Errorf("rename gagal: %w", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusFound {
		return fmt.Errorf("rename gagal status=%d", resp.StatusCode)
	}
	return nil
}

func (d *hiosoLegacyDriver) RebootONU(onuID string) error {
	form := url.Values{}
	form.Set("onuId", onuID)
	form.Set("onuName", "reboot")
	form.Set("onuOperation", "rebootOp")
	resp, err := d.post("/goform/setOnu", form)
	if err != nil {
		return fmt.Errorf("reboot gagal: %w", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusFound {
		return fmt.Errorf("reboot gagal status=%d", resp.StatusCode)
	}
	return nil
}

// legacyExtractPon mengekstrak PON port dari onuID "0/1:3" → "0/1"
func legacyExtractPon(onuID string) string {
	parts := strings.Split(onuID, ":")
	if len(parts) >= 1 {
		return parts[0]
	}
	return "0/1"
}
