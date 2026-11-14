package handlers

import (
	"bytes"
	"crypto/md5"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Driver HSGQ via Web JSON API — SATU PINTU (baca + tulis).
//
// Referensi: ~/workspace/your_files/olt-refs/SMARTOLT_HSGQ_GUIDE-KusumaVisionNMS.md
// (KusumaVisionNMS, Okt 2026). Keyakinan endpoint: login A (mekanisme),
// tabel ONU A/C, aksi tulis C (dari plugnowplay/HSGQtelegram src/olt.js).
// BELUM TERVERIFIKASI di OLT HSGQ milik kita — wajib tes live sebelum
// dipakai produksi (rename/reboot di ONU uji dulu).
//
// Jalur:
//   - Login: POST /userlogin?form=login {"method":"set","param":{
//     "name":user, "key":md5(user:pass) hex, "value":base64(pass),
//     "captcha_v":"","captcha_f":""}} → {"code":1} + header X-Token.
//     Semua request berikut kirim header X-Token. code 1 = sukses,
//     0 = login ilegal, -1 = token habis ("Token Check Failed" → login
//     ulang sekali lalu ulangi). Auto-logout ±5 menit idle. Captcha bisa
//     aktif (GET /system_captcha) — bila aktif, driver menyerah.
//   - Baca: GET /board?info=system (device_type 1=EPON, 2=GPON),
//     /board?info=pon, GPON /ontinfo_table, EPON /onutable,
//     GPON /gponont_mgmt?form=base|ont_optical|ont_version,
//     EPON /onumgmt?form=base-info|optical-diagnose.
//   - Tulis: GPON reboot POST /gponont_mgmt?form=info {identifier, flags:4},
//     GPON rename flags:8 {ont_name, ont_description},
//     EPON reboot POST /onumgmt?form=config {port_id, onu_id, flags:1, fec_mode},
//     EPON rename flags:8 {onu_name, onu_desc},
//     simpan config POST /system_save {"method":"set","param":{}}.
//     Tanpa system_save, perubahan hilang saat OLT reboot — karena itu
//     driver ini mengimplementasikan hiosoConfigSaver, sehingga handler
//     rename otomatis memanggil SaveConfiguration (seperti legacy).
//   - HTTP polos tanpa TLS: sandi (base64) + md5 lewat jaringan apa
//     adanya → hanya lewat VPN/WireGuard.
//
// Catatan risiko (dari panduan):
//   - flags adalah bitmask; yang diketahui hanya 1/4/8.
//   - EPON fec_mode: bot selalu mengirim fec_mode:1, sehingga aksi bisa
//     ikut MENGUBAH mode FEC ONU. Driver membaca base-info dulu dan
//     mengirim ulang nilai fec_mode yang sedang berlaku bila ada.
//   - Nama/deskripsi disanitasi [A-Za-z0-9 _.-@#()/], maks 32.
//   - Belum diketahui apakah login NMS menendang sesi web admin yang
//     sedang dipakai — baca di sini login web (bukan SNMP), jadi
//     pemakaian bersamaan dengan admin di web UI berisiko.
type hsgqWebDriver struct {
	client  *http.Client
	baseURL string
	host    string
	user    string
	pass    string

	mu      sync.Mutex
	token   string
	ponType string // "gpon" | "epon" | "" (belum dideteksi)
	// forcedPonType: varian yang dipilih saat tambah device ("gpon"/"epon").
	// Kosong = auto-detect. Dipilih user karena pemetaan device_type
	// (1=EPON, 2=GPON) keyakinan C dan bisa ambigu antar firmware.
	forcedPonType string
}

func newHsgqWebDriver(host string, port int, user, pass string, forcedPonType string) (*hsgqWebDriver, error) {
	if port <= 0 {
		port = 80
	}
	d := &hsgqWebDriver{
		client:        &http.Client{Timeout: 15 * time.Second},
		baseURL:       fmt.Sprintf("http://%s:%d", host, port),
		host:          host,
		user:          user,
		pass:          pass,
		forcedPonType: forcedPonType,
	}
	return d, nil
}

func (d *hsgqWebDriver) Close() {}

// --- login & transport ---

type hsgqEnvelope struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}

// hsgqLogin menukar user/pass menjadi X-Token. md5(user:pass) hex + base64(pass).
func (d *hsgqWebDriver) hsgqLogin() error {
	sum := md5.Sum([]byte(d.user + ":" + d.pass))
	payload := map[string]any{
		"method": "set",
		"param": map[string]string{
			"name":      d.user,
			"key":       hex.EncodeToString(sum[:]),
			"value":     base64.StdEncoding.EncodeToString([]byte(d.pass)),
			"captcha_v": "",
			"captcha_f": "",
		},
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequest("POST", d.baseURL+"/userlogin?form=login", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := d.client.Do(req)
	if err != nil {
		return fmt.Errorf("login HSGQ gagal: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("login HSGQ gagal: %w", err)
	}
	if strings.Contains(strings.ToLower(string(raw)), "captcha") {
		return fmt.Errorf("login HSGQ gagal: captcha aktif di OLT (tidak bisa dilewati otomatis)")
	}
	var env hsgqEnvelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return fmt.Errorf("login HSGQ gagal: respons bukan JSON (%s)", strings.TrimSpace(string(raw)))
	}
	if env.Code != 1 {
		return fmt.Errorf("login HSGQ gagal: code=%d (%s)", env.Code, env.Message)
	}
	token := strings.TrimSpace(resp.Header.Get("X-Token"))
	if token == "" {
		return fmt.Errorf("login HSGQ gagal: server tidak mengembalikan X-Token")
	}
	d.token = token
	return nil
}

// hsgqDo mengirim satu request JSON dengan X-Token. Bila token habis
// (code -1 / "Token Check Failed"), login ulang sekali lalu ulangi.
// respBody (bila non-nil) diisi dari body respons (envelope penuh).
func (d *hsgqWebDriver) hsgqDo(method, path string, reqBody any, respBody any) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.hsgqDoLocked(method, path, reqBody, respBody, false)
}

func (d *hsgqWebDriver) hsgqDoLocked(method, path string, reqBody any, respBody any, retried bool) error {
	if d.token == "" {
		if err := d.hsgqLogin(); err != nil {
			return err
		}
	}
	var rdr io.Reader
	if reqBody != nil {
		b, err := json.Marshal(reqBody)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, d.baseURL+path, rdr)
	if err != nil {
		return err
	}
	if reqBody != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("X-Token", d.token)
	resp, err := d.client.Do(req)
	if err != nil {
		return fmt.Errorf("request HSGQ %s gagal: %w", path, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("request HSGQ %s gagal: %w", path, err)
	}
	// Token habis → login ulang sekali lalu ulangi request.
	if !retried && (strings.Contains(string(raw), "Token Check Failed") || hsgqCodeIs(raw, -1)) {
		d.token = ""
		if err := d.hsgqLogin(); err != nil {
			return err
		}
		return d.hsgqDoLocked(method, path, reqBody, respBody, true)
	}
	if respBody != nil {
		if err := json.Unmarshal(raw, respBody); err != nil {
			return fmt.Errorf("request HSGQ %s: respons bukan JSON (%s)", path, strings.TrimSpace(string(raw)))
		}
		// Bila responsnya envelope {code,message,...}, code != 1 = gagal.
		if env, ok := respBody.(*hsgqEnvelope); ok && env.Code != 1 {
			return fmt.Errorf("request HSGQ %s gagal: code=%d (%s)", path, env.Code, env.Message)
		}
	}
	return nil
}

func hsgqCodeIs(raw []byte, want int) bool {
	var env hsgqEnvelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return false
	}
	return env.Code == want
}

// hsgqRows mengekstrak array baris dari berbagai bentuk respons web HSGQ:
// {"code":1,"data":[...]}, {"code":1,"rows":[...]}, array langsung, dll.
func hsgqRows(raw json.RawMessage) ([]map[string]any, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return nil, nil
	}
	// Array langsung.
	var arr []map[string]any
	if err := json.Unmarshal(raw, &arr); err == nil {
		return arr, nil
	}
	// Objek pembungkus — cari field yang berisi array.
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil {
		return nil, fmt.Errorf("respons HSGQ bukan array/objek")
	}
	for _, key := range []string{"data", "rows", "list", "items", "ontinfo_table", "onutable", "result"} {
		if v, ok := obj[key]; ok {
			var a []map[string]any
			if err := json.Unmarshal(v, &a); err == nil {
				return a, nil
			}
		}
	}
	return nil, fmt.Errorf("respons HSGQ tidak memuat array baris")
}

// hsgqFields mengekstrak objek field dari respons ({"code":1,"data":{...}}
// atau field langsung di top-level).
func hsgqFields(raw json.RawMessage) (map[string]any, error) {
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil {
		return nil, fmt.Errorf("respons HSGQ bukan objek")
	}
	if data, ok := obj["data"]; ok {
		if m, ok := data.(map[string]any); ok {
			return m, nil
		}
	}
	return obj, nil
}

func hsgqStr(row map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := row[k]; ok && v != nil {
			switch t := v.(type) {
			case string:
				return strings.TrimSpace(t)
			case float64:
				return strconv.FormatFloat(t, 'f', -1, 64)
			case json.Number:
				return t.String()
			case bool:
				return strconv.FormatBool(t)
			}
		}
	}
	return ""
}

func hsgqInt(row map[string]any, keys ...string) int {
	s := hsgqStr(row, keys...)
	if s == "" {
		return 0
	}
	n, _ := strconv.Atoi(s)
	return n
}

// hsgqPower mem-parse daya optik: angka, atau string "-19.36 dBm" / "-19.36".
func hsgqPower(row map[string]any, keys ...string) float64 {
	s := hsgqStr(row, keys...)
	s = strings.TrimSuffix(strings.TrimSpace(s), "dBm")
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	f, _ := strconv.ParseFloat(s, 64)
	return f
}

// --- deteksi pon type ---

// hsgqDetectPonType menentukan "gpon"/"epon" via /board?info=system
// (device_type 1=EPON, 2=GPON — C, pemetaan ambigu). Bila tak jelas,
// probe tabel: GPON dulu, lalu EPON. Hasil di-cache per driver.
// Bila varian dipilih eksplisit saat tambah device (forcedPonType),
// deteksi dilewati sepenuhnya.
func (d *hsgqWebDriver) hsgqDetectPonType() (string, error) {
	if d.forcedPonType != "" {
		d.ponType = d.forcedPonType
		return d.ponType, nil
	}
	if d.ponType != "" {
		return d.ponType, nil
	}
	var env hsgqEnvelope
	if err := d.hsgqDo("GET", "/board?info=system", nil, &env); err == nil {
		fields, ferr := hsgqFields(env.Data)
		if ferr == nil {
			switch hsgqInt(fields, "device_type") {
			case 1:
				d.ponType = "epon"
				return d.ponType, nil
			case 2:
				d.ponType = "gpon"
				return d.ponType, nil
			}
		}
	}
	// Fallback: probe tabel GPON dulu, lalu EPON.
	if rows, err := d.hsgqFetchTable("/ontinfo_table"); err == nil && len(rows) > 0 {
		d.ponType = "gpon"
		return d.ponType, nil
	}
	if rows, err := d.hsgqFetchTable("/onutable"); err == nil && len(rows) > 0 {
		d.ponType = "epon"
		return d.ponType, nil
	}
	// Kedua tabel kosong/tak menjawab — default GPON (varian terbanyak),
	// verifikasi live yang akan membuktikan.
	d.ponType = "gpon"
	return d.ponType, nil
}

func (d *hsgqWebDriver) hsgqFetchTable(path string) ([]map[string]any, error) {
	var env hsgqEnvelope
	if err := d.hsgqDo("GET", path, nil, &env); err != nil {
		return nil, err
	}
	if env.Code != 1 {
		return nil, fmt.Errorf("tabel HSGQ %s gagal: code=%d (%s)", path, env.Code, env.Message)
	}
	return hsgqRows(env.Data)
}

// --- HiosoDriver ---

func (d *hsgqWebDriver) GetSystemInfo() (*HiosoSystemInfo, error) {
	var env hsgqEnvelope
	if err := d.hsgqDo("GET", "/board?info=system", nil, &env); err != nil {
		return nil, err
	}
	if env.Code != 1 {
		return nil, fmt.Errorf("system HSGQ gagal: code=%d (%s)", env.Code, env.Message)
	}
	fields, err := hsgqFields(env.Data)
	if err != nil {
		return nil, err
	}
	info := &HiosoSystemInfo{
		Model:        hsgqStr(fields, "product_name", "product", "model"),
		Firmware:     hsgqStr(fields, "fw_ver", "fwver", "firmware"),
		MAC:          hsgqStr(fields, "macaddr", "mac"),
		IP:           d.host,
		SerialNumber: hsgqStr(fields, "sn", "serial"),
	}
	if v := hsgqStr(fields, "vendor"); v != "" && info.Model == "" {
		info.Model = v
	}
	// Jumlah ONU dari /board?info=pon [{port_id, online, offline}].
	if rows, err := d.hsgqFetchTable("/board?info=pon"); err == nil {
		for _, r := range rows {
			info.TotalONU += hsgqInt(r, "online", "online_count") + hsgqInt(r, "offline", "offline_count")
			info.OnlineONU += hsgqInt(r, "online", "online_count")
		}
	}
	// Uptime/CPU/memori tidak tersedia via Web JSON (hanya via SNMP).
	return info, nil
}

func (d *hsgqWebDriver) hsgqListRows() ([]map[string]any, string, error) {
	ponType, err := d.hsgqDetectPonType()
	if err != nil {
		return nil, "", err
	}
	if ponType == "epon" {
		rows, err := d.hsgqFetchTable("/onutable")
		return rows, ponType, err
	}
	rows, err := d.hsgqFetchTable("/ontinfo_table")
	return rows, ponType, err
}

func (d *hsgqWebDriver) ListAllONU() ([]HiosoONU, error) {
	rows, ponType, err := d.hsgqListRows()
	if err != nil {
		return nil, err
	}
	out := make([]HiosoONU, 0, len(rows))
	for _, r := range rows {
		out = append(out, hsgqRowToONU(r, ponType))
	}
	return out, nil
}

func (d *hsgqWebDriver) ListONUByPort(port int) ([]HiosoONU, error) {
	all, err := d.ListAllONU()
	if err != nil {
		return nil, err
	}
	out := make([]HiosoONU, 0)
	for _, o := range all {
		if p, _, perr := hsgqParseOnuID(o.Index); perr == nil && p == port {
			out = append(out, o)
		}
	}
	return out, nil
}

func hsgqRowToONU(r map[string]any, ponType string) HiosoONU {
	if ponType == "epon" {
		port := hsgqInt(r, "port_id")
		id := hsgqInt(r, "onu_id")
		status := hsgqStr(r, "status")
		return HiosoONU{
			Index:   fmt.Sprintf("2/%d:%d", port, id),
			WebID:   fmt.Sprintf("2/%d:%d", port, id),
			Name:    hsgqStr(r, "onu_name", "name"),
			SN:      hsgqStr(r, "macaddr", "mac", "ont_sn"),
			Status:  status,
			RxPower: hsgqPower(r, "receive_power", "rx_power", "rx"),
			Profile: "hsgq",
		}
	}
	// GPON: rstate 0=initial, 1=online, 2=offline.
	port := hsgqInt(r, "port_id")
	id := hsgqInt(r, "ont_id")
	status := "Offline"
	switch hsgqInt(r, "rstate") {
	case 1:
		status = "Online"
	case 0:
		status = "Initial"
	case 2:
		status = "Offline"
	}
	return HiosoONU{
		Index:   fmt.Sprintf("2/%d:%d", port, id),
		WebID:   fmt.Sprintf("2/%d:%d", port, id),
		Name:    hsgqStr(r, "ont_name", "name"),
		SN:      hsgqStr(r, "ont_sn", "sn"),
		Status:  status,
		RxPower: hsgqPower(r, "receive_power", "rx_power", "rx"),
		Profile: "hsgq",
	}
}

func (d *hsgqWebDriver) GetONUDetail(onuID string) (*HiosoONUDetail, error) {
	port, id, err := hsgqParseOnuID(onuID)
	if err != nil {
		return nil, err
	}
	ponType, err := d.hsgqDetectPonType()
	if err != nil {
		return nil, err
	}
	detail := &HiosoONUDetail{
		Index:   onuID,
		WebID:   onuID,
		Profile: "hsgq",
	}
	if ponType == "epon" {
		base := fmt.Sprintf("/onumgmt?form=base-info&port_id=%d&onu_id=%d", port, id)
		var env hsgqEnvelope
		if err := d.hsgqDo("GET", base, nil, &env); err != nil {
			return nil, err
		}
		if env.Code != 1 {
			return nil, fmt.Errorf("detail HSGQ EPON gagal: code=%d (%s)", env.Code, env.Message)
		}
		fields, err := hsgqFields(env.Data)
		if err != nil {
			return nil, err
		}
		detail.Name = hsgqStr(fields, "onu_name", "name")
		detail.SN = hsgqStr(fields, "macaddr", "mac", "ont_sn")
		detail.Status = hsgqStr(fields, "status")
		detail.Firmware = hsgqStr(fields, "dev_type", "model", "firmware")
		detail.Distance = hsgqInt(fields, "distance")
		detail.RegisteredAt = hsgqStr(fields, "register_time")
		detail.LastOnlineAt = hsgqStr(fields, "last_down_time")
		// Optik presisi.
		opt := fmt.Sprintf("/onumgmt?form=optical-diagnose&port_id=%d&onu_id=%d", port, id)
		var oenv hsgqEnvelope
		if err := d.hsgqDo("GET", opt, nil, &oenv); err == nil && oenv.Code == 1 {
			if of, ferr := hsgqFields(oenv.Data); ferr == nil {
				detail.RxPower = hsgqPower(of, "receive_power", "rx_power", "rx")
				detail.TxPower = hsgqPower(of, "transmit_power", "tx_power", "tx")
				detail.Temperature = hsgqPower(of, "temperature", "temp")
				detail.Voltage = hsgqPower(of, "voltage")
				detail.BiasCurrent = hsgqPower(of, "bias_current", "bias")
			}
		}
		return detail, nil
	}
	// GPON detail: base + optik + versi.
	base := fmt.Sprintf("/gponont_mgmt?form=base&port_id=%d&ont_id=%d", port, id)
	var env hsgqEnvelope
	if err := d.hsgqDo("GET", base, nil, &env); err != nil {
		return nil, err
	}
	if env.Code != 1 {
		return nil, fmt.Errorf("detail HSGQ GPON gagal: code=%d (%s)", env.Code, env.Message)
	}
	fields, err := hsgqFields(env.Data)
	if err != nil {
		return nil, err
	}
	detail.Name = hsgqStr(fields, "ont_name", "name")
	detail.SN = hsgqStr(fields, "ont_sn", "sn")
	detail.Firmware = hsgqStr(fields, "model", "firmware", "ont_version")
	detail.Distance = hsgqInt(fields, "distance")
	detail.RegisteredAt = hsgqStr(fields, "register_time")
	detail.LastOnlineAt = hsgqStr(fields, "last_u_time", "last_d_time")
	if v := hsgqStr(fields, "rstate"); v != "" {
		switch v {
		case "1":
			detail.Status = "Online"
		case "2":
			detail.Status = "Offline"
		default:
			detail.Status = "Initial"
		}
	}
	opt := fmt.Sprintf("/gponont_mgmt?form=ont_optical&port_id=%d&ont_id=%d", port, id)
	var oenv hsgqEnvelope
	if err := d.hsgqDo("GET", opt, nil, &oenv); err == nil && oenv.Code == 1 {
		if of, ferr := hsgqFields(oenv.Data); ferr == nil {
			detail.RxPower = hsgqPower(of, "receive_power", "rx_power", "rx")
			detail.TxPower = hsgqPower(of, "transmit_power", "tx_power", "tx")
			detail.Temperature = hsgqPower(of, "temperature", "temp")
			detail.Voltage = hsgqPower(of, "voltage")
			detail.BiasCurrent = hsgqPower(of, "bias_current", "bias")
		}
	}
	return detail, nil
}

// --- aksi tulis ---

// hsgqSanitizeName mengikuti panduan: [A-Za-z0-9 _.-@#()/], maks 32.
func hsgqSanitizeName(name string) string {
	name = strings.TrimSpace(name)
	var b strings.Builder
	for _, r := range name {
		if (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') ||
			r == ' ' || r == '_' || r == '.' || r == '-' || r == '@' || r == '#' ||
			r == '(' || r == ')' || r == '/' {
			b.WriteRune(r)
		}
	}
	out := b.String()
	if len([]rune(out)) > 32 {
		out = string([]rune(out)[:32])
	}
	return out
}

// hsgqParseOnuID mengurai "2/{port}:{id}" (dibuat hiosoBuildOnuID untuk hsgq).
func hsgqParseOnuID(onuID string) (int, int, error) {
	s := strings.TrimPrefix(strings.TrimSpace(onuID), "2/")
	parts := strings.SplitN(s, "/", 2)
	if len(parts) == 2 {
		s = parts[1]
	}
	kv := strings.SplitN(s, ":", 2)
	if len(kv) != 2 {
		return 0, 0, fmt.Errorf("onuID HSGQ tidak valid: %s", onuID)
	}
	port, err1 := strconv.Atoi(strings.TrimSpace(kv[0]))
	id, err2 := strconv.Atoi(strings.TrimSpace(kv[1]))
	if err1 != nil || err2 != nil {
		return 0, 0, fmt.Errorf("onuID HSGQ tidak valid: %s", onuID)
	}
	return port, id, nil
}

// hsgqGponRow mencari baris GPON (port, ont_id) di /ontinfo_table —
// dipakai untuk identifier + nama/deskripsi saat ini (reboot/rename
// mengirim ulang nilai yang berlaku).
func (d *hsgqWebDriver) hsgqGponRow(port, id int) (map[string]any, error) {
	rows, err := d.hsgqFetchTable("/ontinfo_table")
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		if hsgqInt(r, "port_id") == port && hsgqInt(r, "ont_id") == id {
			return r, nil
		}
	}
	return nil, fmt.Errorf("ONU HSGQ GPON %d:%d tidak ditemukan di /ontinfo_table", port, id)
}

// hsgqEponRow mencari baris EPON (port, onu_id) di /onutable.
func (d *hsgqWebDriver) hsgqEponRow(port, id int) (map[string]any, error) {
	rows, err := d.hsgqFetchTable("/onutable")
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		if hsgqInt(r, "port_id") == port && hsgqInt(r, "onu_id") == id {
			return r, nil
		}
	}
	return nil, fmt.Errorf("ONU HSGQ EPON %d:%d tidak ditemukan di /onutable", port, id)
}

// hsgqEponFec membaca fec_mode yang sedang berlaku dari base-info
// (0 bila tak ada — pemanggil yang memutuskan).
func (d *hsgqWebDriver) hsgqEponFec(port, id int) (int, bool) {
	base := fmt.Sprintf("/onumgmt?form=base-info&port_id=%d&onu_id=%d", port, id)
	var env hsgqEnvelope
	if err := d.hsgqDo("GET", base, nil, &env); err != nil || env.Code != 1 {
		return 0, false
	}
	fields, err := hsgqFields(env.Data)
	if err != nil {
		return 0, false
	}
	if s := hsgqStr(fields, "fec_mode"); s != "" {
		n, err := strconv.Atoi(s)
		if err == nil {
			return n, true
		}
	}
	return 0, false
}

func (d *hsgqWebDriver) RenameONU(onuID, newName string) error {
	port, id, err := hsgqParseOnuID(onuID)
	if err != nil {
		return err
	}
	name := hsgqSanitizeName(newName)
	if name == "" {
		return fmt.Errorf("nama ONU HSGQ kosong setelah sanitasi")
	}
	ponType, err := d.hsgqDetectPonType()
	if err != nil {
		return err
	}
	if ponType == "epon" {
		row, err := d.hsgqEponRow(port, id)
		if err != nil {
			return err
		}
		param := map[string]any{
			"port_id":  port,
			"onu_id":   id,
			"flags":    8,
			"onu_name": name,
			"onu_desc": hsgqStr(row, "onu_desc", "desc"),
		}
		// Kirim ulang fec_mode yang berlaku bila diketahui, supaya
		// rename tidak ikut mengubah mode FEC.
		if fec, ok := d.hsgqEponFec(port, id); ok {
			param["fec_mode"] = fec
		}
		var env hsgqEnvelope
		if err := d.hsgqDo("POST", "/onumgmt?form=config", map[string]any{"method": "set", "param": param}, &env); err != nil {
			return err
		}
		if env.Code != 1 {
			return fmt.Errorf("rename HSGQ EPON gagal: code=%d (%s)", env.Code, env.Message)
		}
		return nil
	}
	row, err := d.hsgqGponRow(port, id)
	if err != nil {
		return err
	}
	param := map[string]any{
		"identifier":      hsgqStr(row, "identifier"),
		"flags":           8,
		"ont_name":        name,
		"ont_description": hsgqStr(row, "ont_description", "description"),
	}
	var env hsgqEnvelope
	if err := d.hsgqDo("POST", "/gponont_mgmt?form=info", map[string]any{"method": "set", "param": param}, &env); err != nil {
		return err
	}
	if env.Code != 1 {
		return fmt.Errorf("rename HSGQ GPON gagal: code=%d (%s)", env.Code, env.Message)
	}
	return nil
}

func (d *hsgqWebDriver) RebootONU(onuID string) error {
	port, id, err := hsgqParseOnuID(onuID)
	if err != nil {
		return err
	}
	ponType, err := d.hsgqDetectPonType()
	if err != nil {
		return err
	}
	if ponType == "epon" {
		// Reboot EPON: flags 1 + fec_mode yang sedang berlaku.
		fec := 1
		if f, ok := d.hsgqEponFec(port, id); ok {
			fec = f
		}
		param := map[string]any{
			"port_id":  port,
			"onu_id":   id,
			"flags":    1,
			"fec_mode": fec,
		}
		var env hsgqEnvelope
		if err := d.hsgqDo("POST", "/onumgmt?form=config", map[string]any{"method": "set", "param": param}, &env); err != nil {
			return err
		}
		if env.Code != 1 {
			return fmt.Errorf("reboot HSGQ EPON gagal: code=%d (%s)", env.Code, env.Message)
		}
		return nil
	}
	// Reboot GPON: flags 4 + kirim ulang nama & deskripsi yang berlaku.
	row, err := d.hsgqGponRow(port, id)
	if err != nil {
		return err
	}
	param := map[string]any{
		"identifier":      hsgqStr(row, "identifier"),
		"flags":           4,
		"ont_name":        hsgqStr(row, "ont_name", "name"),
		"ont_description": hsgqStr(row, "ont_description", "description"),
	}
	var env hsgqEnvelope
	if err := d.hsgqDo("POST", "/gponont_mgmt?form=info", map[string]any{"method": "set", "param": param}, &env); err != nil {
		return err
	}
	if env.Code != 1 {
		return fmt.Errorf("reboot HSGQ GPON gagal: code=%d (%s)", env.Code, env.Message)
	}
	return nil
}

// SaveConfiguration — POST /system_save. Tanpa ini perubahan hilang
// saat OLT reboot. Mengimplementasikan hiosoConfigSaver sehingga
// handler rename otomatis memanggilnya (seperti legacy).
func (d *hsgqWebDriver) SaveConfiguration() error {
	var env hsgqEnvelope
	if err := d.hsgqDo("POST", "/system_save", map[string]any{"method": "set", "param": map[string]any{}}, &env); err != nil {
		return err
	}
	if env.Code != 1 {
		return fmt.Errorf("save config HSGQ gagal: code=%d (%s)", env.Code, env.Message)
	}
	return nil
}
