package handlers

// Tests for the HSGQ Web JSON driver (one door: read + rename + reboot).
// All use an httptest fake HSGQ OLT — no real device needed. Fixtures
// follow ~/workspace/your_files/olt-refs/SMARTOLT_HSGQ_GUIDE-KusumaVisionNMS.md
// (confidence C for most endpoints — live verification on a real HSGQ OLT
// is still required before production use).

import (
	"crypto/md5"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// HSGQ driver harus mengimplementasikan hiosoConfigSaver supaya handler
// rename otomatis memanggil SaveConfiguration (seperti legacy).
var _ hiosoConfigSaver = (*hsgqWebDriver)(nil)
var _ HiosoDriver = (*hsgqWebDriver)(nil)

// fakeHsgqOLT serves the Web JSON API. It validates the login payload
// (md5 user:pass + base64 pass), issues X-Token, and captures write
// payloads for assertions.
type fakeHsgqOLT struct {
	mu sync.Mutex

	deviceType int // 1 = EPON, 2 = GPON
	loginHits  int
	token      string
	// expireOnce: next authed request fails with code -1 (token expired),
	// forcing the driver to re-login and retry.
	expireOnce   bool
	loginFail    bool // login returns code 0
	loginCaptcha bool

	lastRenameGpon map[string]any
	lastRebootGpon map[string]any
	lastRenameEpon map[string]any
	lastRebootEpon map[string]any
	saveHits       int
}

func (f *fakeHsgqOLT) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.URL.Path == "/userlogin" {
		f.mu.Lock()
		f.loginHits++
		f.mu.Unlock()
		raw, _ := io.ReadAll(r.Body)
		var req struct {
			Method string `json:"method"`
			Param  struct {
				Name  string `json:"name"`
				Key   string `json:"key"`
				Value string `json:"value"`
			} `json:"param"`
		}
		_ = json.Unmarshal(raw, &req)
		sum := md5.Sum([]byte("admin:admin"))
		wantKey := hex.EncodeToString(sum[:])
		wantVal := base64.StdEncoding.EncodeToString([]byte("admin"))
		if f.loginCaptcha {
			_, _ = w.Write([]byte(`{"code":0,"message":"captcha required"}`))
			return
		}
		if f.loginFail || req.Param.Name != "admin" || req.Param.Key != wantKey || req.Param.Value != wantVal {
			_, _ = w.Write([]byte(`{"code":0,"message":"login ilegal"}`))
			return
		}
		f.mu.Lock()
		f.token = fmt.Sprintf("tok-%d", f.loginHits)
		tok := f.token
		f.mu.Unlock()
		w.Header().Set("X-Token", tok)
		_, _ = w.Write([]byte(`{"code":1,"message":"success"}`))
		return
	}
	// Authed endpoints: token wajib cocok.
	f.mu.Lock()
	expire := f.expireOnce
	if expire {
		f.expireOnce = false
	}
	tok := f.token
	f.mu.Unlock()
	if r.Header.Get("X-Token") != tok || tok == "" {
		_, _ = w.Write([]byte(`{"code":-1,"message":"Token Check Failed"}`))
		return
	}
	if expire {
		_, _ = w.Write([]byte(`{"code":-1,"message":"Token Check Failed"}`))
		return
	}
	q := r.URL.Query()
	switch r.URL.Path {
	case "/board":
		if q.Get("info") == "system" {
			_, _ = w.Write([]byte(fmt.Sprintf(`{"code":1,"data":{"vendor":"HSGQ","product_name":"HSGQ-G02ID","fw_ver":"IGC_V1.2.9ID_Rel","macaddr":"AA:BB:CC:DD:EE:FF","sn":"SN123","ponports":2,"device_type":%d}}`, f.deviceType)))
			return
		}
		if q.Get("info") == "pon" {
			_, _ = w.Write([]byte(`{"code":1,"data":[{"port_id":1,"online":2,"offline":1},{"port_id":2,"online":1,"offline":0}]}`))
			return
		}
	case "/ontinfo_table":
		_, _ = w.Write([]byte(`{"code":1,"data":[
			{"ont_sn":"HWTCA9089620","ont_name":"TOKO A","ont_description":"desc A","port_id":1,"ont_id":1,"identifier":"1_1","rstate":1,"receive_power":-19.36,"last_u_time":"2026-11-01 10:00:00","last_d_time":"","last_d_cause":""},
			{"ont_sn":"HWTCA9089621","ont_name":"TOKO B","ont_description":"desc B","port_id":1,"ont_id":2,"identifier":"1_2","rstate":2,"receive_power":-25.5,"last_u_time":"","last_d_time":"2026-11-02 11:00:00","last_d_cause":"Power down"},
			{"ont_sn":"HWTCA9089622","ont_name":"TOKO C","ont_description":"","port_id":2,"ont_id":1,"identifier":"2_1","rstate":1,"receive_power":-21.0,"last_u_time":"2026-11-01 09:00:00","last_d_time":"","last_d_cause":""}
		]}`))
		return
	case "/onutable":
		_, _ = w.Write([]byte(`{"code":1,"data":[
			{"port_id":1,"onu_id":1,"onu_name":"TOKO E1","onu_desc":"desc E1","macaddr":"00:11:22:33:44:55","status":"Online","receive_power":"-19.36 dBm","dev_type":"HGU","auth_state":"ok","register_time":"2026-11-01 10:00:00","last_down_time":"","last_down_reason":"","distance":1234},
			{"port_id":1,"onu_id":2,"onu_name":"TOKO E2","onu_desc":"desc E2","macaddr":"00:11:22:33:44:56","status":"Offline","receive_power":"-27.10 dBm","dev_type":"SFU","auth_state":"ok","register_time":"2026-11-01 09:00:00","last_down_time":"2026-11-02 08:00:00","last_down_reason":"Laser out","distance":2345}
		]}`))
		return
	case "/gponont_mgmt":
		form := q.Get("form")
		if r.Method == "GET" && form == "base" {
			_, _ = w.Write([]byte(`{"code":1,"data":{"ont_name":"TOKO A","ont_sn":"HWTCA9089620","rstate":1,"distance":1234,"register_time":"2026-11-01 10:00:00","last_u_time":"2026-11-01 10:00:00"}}`))
			return
		}
		if r.Method == "GET" && form == "ont_optical" {
			_, _ = w.Write([]byte(`{"code":1,"data":{"receive_power":-19.36,"transmit_power":2.5,"temperature":44.5,"voltage":3.3,"bias_current":12.0}}`))
			return
		}
		if r.Method == "POST" && form == "info" {
			raw, _ := io.ReadAll(r.Body)
			var req struct {
				Param map[string]any `json:"param"`
			}
			_ = json.Unmarshal(raw, &req)
			f.mu.Lock()
			if flags, _ := req.Param["flags"].(float64); flags == 8 {
				f.lastRenameGpon = req.Param
			} else if flags, _ := req.Param["flags"].(float64); flags == 4 {
				f.lastRebootGpon = req.Param
			}
			f.mu.Unlock()
			_, _ = w.Write([]byte(`{"code":1,"message":"success"}`))
			return
		}
	case "/onumgmt":
		form := q.Get("form")
		if r.Method == "GET" && form == "base-info" {
			_, _ = w.Write([]byte(`{"code":1,"data":{"onu_name":"TOKO E1","macaddr":"00:11:22:33:44:55","status":"Online","fec_mode":1,"distance":1234,"register_time":"2026-11-01 10:00:00","last_down_time":""}}`))
			return
		}
		if r.Method == "GET" && form == "optical-diagnose" {
			_, _ = w.Write([]byte(`{"code":1,"data":{"receive_power":"-19.36","transmit_power":"2.5","temperature":44.5}}`))
			return
		}
		if r.Method == "POST" && form == "config" {
			raw, _ := io.ReadAll(r.Body)
			var req struct {
				Param map[string]any `json:"param"`
			}
			_ = json.Unmarshal(raw, &req)
			f.mu.Lock()
			if flags, _ := req.Param["flags"].(float64); flags == 8 {
				f.lastRenameEpon = req.Param
			} else if flags, _ := req.Param["flags"].(float64); flags == 1 {
				f.lastRebootEpon = req.Param
			}
			f.mu.Unlock()
			_, _ = w.Write([]byte(`{"code":1,"message":"success"}`))
			return
		}
	case "/system_save":
		if r.Method == "POST" {
			f.mu.Lock()
			f.saveHits++
			f.mu.Unlock()
			_, _ = w.Write([]byte(`{"code":1,"message":"success"}`))
			return
		}
	}
	w.WriteHeader(http.StatusNotFound)
	_, _ = w.Write([]byte(`{"code":0,"message":"not found"}`))
}

func newHsgqTestDriver(t *testing.T, fake *fakeHsgqOLT) *hsgqWebDriver {
	t.Helper()
	srv := httptest.NewServer(fake)
	t.Cleanup(srv.Close)
	host, port := testServerHostPort(t, srv)
	d, err := newHsgqWebDriver(host, port, "admin", "admin", "")
	if err != nil {
		t.Fatalf("newHsgqWebDriver: %v", err)
	}
	return d
}

func newHsgqTestDriverForced(t *testing.T, fake *fakeHsgqOLT, forced string) *hsgqWebDriver {
	t.Helper()
	srv := httptest.NewServer(fake)
	t.Cleanup(srv.Close)
	host, port := testServerHostPort(t, srv)
	d, err := newHsgqWebDriver(host, port, "admin", "admin", forced)
	if err != nil {
		t.Fatalf("newHsgqWebDriver: %v", err)
	}
	return d
}

func TestHsgqLoginSuccessAndToken(t *testing.T) {
	fake := &fakeHsgqOLT{deviceType: 2}
	d := newHsgqTestDriver(t, fake)
	if _, err := d.GetSystemInfo(); err != nil {
		t.Fatalf("GetSystemInfo: %v", err)
	}
	if fake.loginHits != 1 {
		t.Errorf("loginHits = %d, want 1", fake.loginHits)
	}
	if d.token == "" {
		t.Errorf("token kosong setelah login")
	}
	// Request kedua memakai token yang sama (tanpa login ulang).
	if _, err := d.GetSystemInfo(); err != nil {
		t.Fatalf("GetSystemInfo kedua: %v", err)
	}
	if fake.loginHits != 1 {
		t.Errorf("loginHits = %d setelah request kedua, want 1 (token dipakai ulang)", fake.loginHits)
	}
}

func TestHsgqLoginFailure(t *testing.T) {
	fake := &fakeHsgqOLT{deviceType: 2, loginFail: true}
	d := newHsgqTestDriver(t, fake)
	if _, err := d.GetSystemInfo(); err == nil {
		t.Errorf("GetSystemInfo dengan login gagal harus error")
	} else if !strings.Contains(err.Error(), "login") {
		t.Errorf("error = %v, want menyebut login", err)
	}
}

func TestHsgqLoginCaptcha(t *testing.T) {
	fake := &fakeHsgqOLT{deviceType: 2, loginCaptcha: true}
	d := newHsgqTestDriver(t, fake)
	if _, err := d.GetSystemInfo(); err == nil {
		t.Errorf("GetSystemInfo dengan captcha harus error")
	} else if !strings.Contains(strings.ToLower(err.Error()), "captcha") {
		t.Errorf("error = %v, want menyebut captcha", err)
	}
}

func TestHsgqTokenRefresh(t *testing.T) {
	fake := &fakeHsgqOLT{deviceType: 2, expireOnce: true}
	d := newHsgqTestDriver(t, fake)
	info, err := d.GetSystemInfo()
	if err != nil {
		t.Fatalf("GetSystemInfo dengan token kedaluwarsa: %v", err)
	}
	if info.Model != "HSGQ-G02ID" {
		t.Errorf("Model = %q, want HSGQ-G02ID", info.Model)
	}
	if fake.loginHits != 2 {
		t.Errorf("loginHits = %d, want 2 (login awal + login ulang setelah Token Check Failed)", fake.loginHits)
	}
}

func TestHsgqGetSystemInfo(t *testing.T) {
	fake := &fakeHsgqOLT{deviceType: 2}
	d := newHsgqTestDriver(t, fake)
	info, err := d.GetSystemInfo()
	if err != nil {
		t.Fatalf("GetSystemInfo: %v", err)
	}
	if info.Model != "HSGQ-G02ID" || info.Firmware != "IGC_V1.2.9ID_Rel" {
		t.Errorf("Model/Firmware = %q/%q", info.Model, info.Firmware)
	}
	if info.MAC != "AA:BB:CC:DD:EE:FF" || info.SerialNumber != "SN123" {
		t.Errorf("MAC/SN = %q/%q", info.MAC, info.SerialNumber)
	}
	// /board?info=pon: (2+1)+(1+0) = 4 total, 2+1 = 3 online.
	if info.TotalONU != 4 || info.OnlineONU != 3 {
		t.Errorf("Total/Online = %d/%d, want 4/3", info.TotalONU, info.OnlineONU)
	}
}

func TestHsgqListAllONU_GPON(t *testing.T) {
	fake := &fakeHsgqOLT{deviceType: 2}
	d := newHsgqTestDriver(t, fake)
	onus, err := d.ListAllONU()
	if err != nil {
		t.Fatalf("ListAllONU: %v", err)
	}
	if len(onus) != 3 {
		t.Fatalf("len = %d, want 3", len(onus))
	}
	if onus[0].Name != "TOKO A" || onus[0].SN != "HWTCA9089620" || onus[0].Status != "Online" {
		t.Errorf("onu[0] = %+v", onus[0])
	}
	if onus[0].RxPower != -19.36 || onus[0].Index != "2/1:1" || onus[0].Profile != "hsgq" {
		t.Errorf("onu[0] = %+v", onus[0])
	}
	if onus[1].Status != "Offline" {
		t.Errorf("onu[1].Status = %q, want Offline (rstate 2)", onus[1].Status)
	}
}

func TestHsgqListAllONU_EPON(t *testing.T) {
	fake := &fakeHsgqOLT{deviceType: 1}
	d := newHsgqTestDriver(t, fake)
	onus, err := d.ListAllONU()
	if err != nil {
		t.Fatalf("ListAllONU: %v", err)
	}
	if len(onus) != 2 {
		t.Fatalf("len = %d, want 2", len(onus))
	}
	if onus[0].Name != "TOKO E1" || onus[0].SN != "00:11:22:33:44:55" || onus[0].Status != "Online" {
		t.Errorf("onu[0] = %+v", onus[0])
	}
	if onus[0].RxPower != -19.36 {
		t.Errorf("onu[0].RxPower = %v, want -19.36 (string \"-19.36 dBm\" ter-parse)", onus[0].RxPower)
	}
	if onus[1].Status != "Offline" || onus[1].Index != "2/1:2" {
		t.Errorf("onu[1] = %+v", onus[1])
	}
}

func TestHsgqListONUByPort(t *testing.T) {
	fake := &fakeHsgqOLT{deviceType: 2}
	d := newHsgqTestDriver(t, fake)
	onus, err := d.ListONUByPort(2)
	if err != nil {
		t.Fatalf("ListONUByPort: %v", err)
	}
	if len(onus) != 1 || onus[0].Name != "TOKO C" {
		t.Errorf("ListONUByPort(2) = %+v, want [TOKO C]", onus)
	}
}

func TestHsgqGetONUDetail_GPON(t *testing.T) {
	fake := &fakeHsgqOLT{deviceType: 2}
	d := newHsgqTestDriver(t, fake)
	detail, err := d.GetONUDetail("2/1:1")
	if err != nil {
		t.Fatalf("GetONUDetail: %v", err)
	}
	if detail.Name != "TOKO A" || detail.SN != "HWTCA9089620" || detail.Status != "Online" {
		t.Errorf("detail = %+v", detail)
	}
	if detail.RxPower != -19.36 || detail.TxPower != 2.5 || detail.Distance != 1234 {
		t.Errorf("detail Rx/Tx/Distance = %v/%v/%v, want -19.36/2.5/1234", detail.RxPower, detail.TxPower, detail.Distance)
	}
}

func TestHsgqGetONUDetail_EPON(t *testing.T) {
	fake := &fakeHsgqOLT{deviceType: 1}
	d := newHsgqTestDriver(t, fake)
	detail, err := d.GetONUDetail("2/1:1")
	if err != nil {
		t.Fatalf("GetONUDetail: %v", err)
	}
	if detail.Name != "TOKO E1" || detail.SN != "00:11:22:33:44:55" || detail.Status != "Online" {
		t.Errorf("detail = %+v", detail)
	}
	if detail.RxPower != -19.36 || detail.TxPower != 2.5 || detail.Distance != 1234 {
		t.Errorf("detail Rx/Tx/Distance = %v/%v/%v, want -19.36/2.5/1234", detail.RxPower, detail.TxPower, detail.Distance)
	}
}

func TestHsgqRename_GPON(t *testing.T) {
	fake := &fakeHsgqOLT{deviceType: 2}
	d := newHsgqTestDriver(t, fake)
	if err := d.RenameONU("2/1:1", "TOKO BARU"); err != nil {
		t.Fatalf("RenameONU: %v", err)
	}
	p := fake.lastRenameGpon
	if p == nil {
		t.Fatalf("tidak ada request rename GPON ke /gponont_mgmt?form=info")
	}
	if p["flags"] != float64(8) || p["ont_name"] != "TOKO BARU" {
		t.Errorf("rename payload = %v, want flags 8 + ont_name TOKO BARU", p)
	}
	if p["identifier"] != "1_1" || p["ont_description"] != "desc A" {
		t.Errorf("rename payload = %v, want identifier 1_1 + deskripsi lama dikirim ulang", p)
	}
	// Rename driver TIDAK memanggil system_save — itu tugas handler
	// (hiosoConfigSaver). Driver hanya menyediakan SaveConfiguration.
	if fake.saveHits != 0 {
		t.Errorf("saveHits = %d, want 0 (save dipanggil handler, bukan driver)", fake.saveHits)
	}
}

func TestHsgqRename_EPON(t *testing.T) {
	fake := &fakeHsgqOLT{deviceType: 1}
	d := newHsgqTestDriver(t, fake)
	if err := d.RenameONU("2/1:1", "TOKO E BARU"); err != nil {
		t.Fatalf("RenameONU: %v", err)
	}
	p := fake.lastRenameEpon
	if p == nil {
		t.Fatalf("tidak ada request rename EPON ke /onumgmt?form=config")
	}
	if p["flags"] != float64(8) || p["onu_name"] != "TOKO E BARU" {
		t.Errorf("rename payload = %v, want flags 8 + onu_name TOKO E BARU", p)
	}
	if p["onu_desc"] != "desc E1" {
		t.Errorf("rename payload = %v, want onu_desc lama dikirim ulang", p)
	}
	if p["fec_mode"] != float64(1) {
		t.Errorf("rename payload = %v, want fec_mode 1 dikirim ulang dari base-info", p)
	}
}

func TestHsgqReboot_GPON(t *testing.T) {
	fake := &fakeHsgqOLT{deviceType: 2}
	d := newHsgqTestDriver(t, fake)
	if err := d.RebootONU("2/1:1"); err != nil {
		t.Fatalf("RebootONU: %v", err)
	}
	p := fake.lastRebootGpon
	if p == nil {
		t.Fatalf("tidak ada request reboot GPON")
	}
	if p["flags"] != float64(4) || p["identifier"] != "1_1" {
		t.Errorf("reboot payload = %v, want flags 4 + identifier 1_1", p)
	}
	if p["ont_name"] != "TOKO A" || p["ont_description"] != "desc A" {
		t.Errorf("reboot payload = %v, want nama+deskripsi lama dikirim ulang", p)
	}
}

func TestHsgqReboot_EPON(t *testing.T) {
	fake := &fakeHsgqOLT{deviceType: 1}
	d := newHsgqTestDriver(t, fake)
	if err := d.RebootONU("2/1:1"); err != nil {
		t.Fatalf("RebootONU: %v", err)
	}
	p := fake.lastRebootEpon
	if p == nil {
		t.Fatalf("tidak ada request reboot EPON")
	}
	if p["flags"] != float64(1) || p["fec_mode"] != float64(1) {
		t.Errorf("reboot payload = %v, want flags 1 + fec_mode 1 dari base-info", p)
	}
}

func TestHsgqSaveConfiguration(t *testing.T) {
	fake := &fakeHsgqOLT{deviceType: 2}
	d := newHsgqTestDriver(t, fake)
	if err := d.SaveConfiguration(); err != nil {
		t.Fatalf("SaveConfiguration: %v", err)
	}
	if fake.saveHits != 1 {
		t.Errorf("saveHits = %d, want 1 (POST /system_save)", fake.saveHits)
	}
}

func TestHsgqSanitizeName(t *testing.T) {
	cases := []struct{ in, want string }{
		{"TOKO A-1", "TOKO A-1"},
		{"Nama, dengan koma", "Nama dengan koma"},
		{"A/B (cabang) #2", "A/B (cabang) #2"},
		{"emoji 😀 hilang", "emoji  hilang"},
		{strings.Repeat("A", 40), strings.Repeat("A", 32)},
	}
	for _, c := range cases {
		if got := hsgqSanitizeName(c.in); got != c.want {
			t.Errorf("hsgqSanitizeName(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestHsgqParseOnuID(t *testing.T) {
	port, id, err := hsgqParseOnuID("2/1:3")
	if err != nil || port != 1 || id != 3 {
		t.Errorf("hsgqParseOnuID(2/1:3) = %d,%d,%v, want 1,3,nil", port, id, err)
	}
	if _, _, err := hsgqParseOnuID("bogus"); err == nil {
		t.Errorf("hsgqParseOnuID(bogus) harus error")
	}
}

func TestHsgqDetectPonType(t *testing.T) {
	gpon := &fakeHsgqOLT{deviceType: 2}
	dg := newHsgqTestDriver(t, gpon)
	if pt, err := dg.hsgqDetectPonType(); err != nil || pt != "gpon" {
		t.Errorf("device_type 2 → %q,%v, want gpon", pt, err)
	}
	epon := &fakeHsgqOLT{deviceType: 1}
	de := newHsgqTestDriver(t, epon)
	if pt, err := de.hsgqDetectPonType(); err != nil || pt != "epon" {
		t.Errorf("device_type 1 → %q,%v, want epon", pt, err)
	}
}

// Varian paksa (dipilih saat tambah device) melewati deteksi sepenuhnya.
func TestHsgqForcedPonType(t *testing.T) {
	// Server mengaku GPON (device_type 2), tapi driver dipaksa EPON.
	fake := &fakeHsgqOLT{deviceType: 2}
	d := newHsgqTestDriverForced(t, fake, "epon")
	onus, err := d.ListAllONU()
	if err != nil {
		t.Fatalf("ListAllONU: %v", err)
	}
	if len(onus) != 2 || onus[0].Name != "TOKO E1" {
		t.Errorf("forced epon = %+v, want daftar EPON (TOKO E1), bukan GPON", onus)
	}
	if pt, _ := d.hsgqDetectPonType(); pt != "epon" {
		t.Errorf("hsgqDetectPonType = %q, want epon (paksa)", pt)
	}
	// Sebaliknya: server EPON, driver dipaksa GPON.
	fake2 := &fakeHsgqOLT{deviceType: 1}
	d2 := newHsgqTestDriverForced(t, fake2, "gpon")
	onus2, err := d2.ListAllONU()
	if err != nil {
		t.Fatalf("ListAllONU: %v", err)
	}
	if len(onus2) != 3 || onus2[0].Name != "TOKO A" {
		t.Errorf("forced gpon = %+v, want daftar GPON (TOKO A)", onus2)
	}
}

// Factory + onuID untuk ketiga varian HSGQ.
func TestHsgqFactoryVariants(t *testing.T) {
	for _, fw := range []string{"hsgq", "hsgq-gpon", "hsgq-epon"} {
		d, err := HiosoNewDriver(fw, "127.0.0.1", 80, "admin", "admin")
		if err != nil {
			t.Errorf("HiosoNewDriver(%q): %v", fw, err)
			continue
		}
		if _, ok := d.(*hsgqWebDriver); !ok {
			t.Errorf("HiosoNewDriver(%q) bukan *hsgqWebDriver", fw)
		}
		if got := hiosoBuildOnuID(fw, "1", "3"); got != "2/1:3" {
			t.Errorf("hiosoBuildOnuID(%q) = %q, want 2/1:3", fw, got)
		}
	}
	if _, err := HiosoNewDriver("hsgq-x", "127.0.0.1", 80, "admin", "admin"); err == nil {
		t.Errorf("HiosoNewDriver(hsgq-x) harus error")
	}
}
