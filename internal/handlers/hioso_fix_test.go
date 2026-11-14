package handlers

// Tests for the 2026-10-29 Hioso bugfixes. All use httptest fake OLTs — no
// real device needed.
//
//  1. Reboot must NOT rename the ONU to "reboot" (both drivers): the reboot
//     request must carry the ONU's current name, and must be aborted (without
//     touching the device) when the current name cannot be read.
//  2. Legacy GetSystemInfo must report real ONU totals (sysInfo has no
//     counters, so they are derived from the all-PON list).
//  3. Online-status classification for the totals.

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestHiosoOnlineStatus(t *testing.T) {
	cases := []struct {
		status string
		want   bool
	}{
		{"Up", true},
		{"up", true},
		{"UP", true},
		{"online", true},
		{"Online", true},
		{"Down", false},
		{"PwrDown", false},
		{"", false},
		{"unknown", false},
	}
	for _, c := range cases {
		if got := hiosoOnlineStatus(c.status); got != c.want {
			t.Errorf("hiosoOnlineStatus(%q) = %v, want %v", c.status, got, c.want)
		}
	}
}

// fakeLegacyOLT serves the legacy HTML pages a test needs. It captures the
// last /goform/setOnu form it received, plus saveConfiguration hits.
type fakeLegacyOLT struct {
	setOnuForm   url.Values
	setOnuHits   int
	saveCfgHits  int
	saveCfgQuery url.Values
	saveFail     bool
	detailOK     bool
}

func (f *fakeLegacyOLT) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.URL.Path == "/goform/saveConfiguration":
		if f.saveFail {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		f.saveCfgHits++
		f.saveCfgQuery = r.URL.Query()
		w.WriteHeader(http.StatusOK)
	case r.URL.Path == "/onuConfig.asp":
		if !f.detailOK {
			// No onuinfo array -> GetONUDetail fails.
			_, _ = w.Write([]byte(`<html><body>empty</body></html>`))
			return
		}
		// onuinfo: id, name, sn, status, firmware, chip, ports, registered, last online.
		_, _ = w.Write([]byte(`<html><script>var onuinfo = new Array("0/1:3","BUDI SANTOSO","SN123","Up","FW1","CHIP","2","2024-01-01","2024-01-02");</script></html>`))
	case r.URL.Path == "/goform/setOnu":
		_ = r.ParseForm()
		f.setOnuForm = r.Form
		f.setOnuHits++
		w.WriteHeader(http.StatusOK)
	case r.URL.Path == "/system.asp":
		// sysInfo: model, ?, ?, ?, firmware, ?, mac, ip, uptime, mem, serial, cpu, mem%.
		_, _ = w.Write([]byte(`<html><script>var sysInfo = new Array("HA7302","x","x","x","V2.2.59","x","AA:BB:CC:DD:EE:FF","10.0.0.1","100d","256","SN1","18","39");</script></html>`))
	case r.URL.Path == "/onuAllPonOnuList.asp":
		// Two ONUs, 22 fields each: id, name, sn, status, ..., tx(14), rx(15), ...
		rec := func(id, name, status string) string {
			f := make([]string, 22)
			f[0], f[1], f[2], f[3] = id, name, "SN-"+id, status
			f[14], f[15] = "1.5", "-21.0"
			quoted := make([]string, 0, 22)
			for _, v := range f {
				quoted = append(quoted, `"`+v+`"`)
			}
			return strings.Join(quoted, ",")
		}
		_, _ = w.Write([]byte(`<html><script>var onutable = new Array(` + rec("0/1:1", "TOKO A", "Up") + `,` + rec("0/1:2", "TOKO B", "Down") + `);</script></html>`))
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

func testServerHostPort(t *testing.T, srv *httptest.Server) (string, int) {
	t.Helper()
	u, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatalf("parse test server URL: %v", err)
	}
	port := 0
	if _, err := fmt.Sscanf(u.Port(), "%d", &port); err != nil {
		t.Fatalf("parse test server port: %v", err)
	}
	return u.Hostname(), port
}

func newLegacyTestDriver(t *testing.T, fake *fakeLegacyOLT) *hiosoLegacyDriver {
	t.Helper()
	srv := httptest.NewServer(fake)
	t.Cleanup(srv.Close)
	host, port := testServerHostPort(t, srv)
	d, err := newLegacyDriver(host, port, "admin", "admin")
	if err != nil {
		t.Fatalf("newLegacyDriver: %v", err)
	}
	return d
}

func TestLegacyRebootPreservesName(t *testing.T) {
	fake := &fakeLegacyOLT{detailOK: true}
	d := newLegacyTestDriver(t, fake)
	if err := d.RebootONU("0/1:3"); err != nil {
		t.Fatalf("RebootONU: %v", err)
	}
	if fake.setOnuHits != 1 {
		t.Fatalf("setOnu hits = %d, want 1", fake.setOnuHits)
	}
	if got := fake.setOnuForm.Get("onuName"); got != "BUDI SANTOSO" {
		t.Errorf("onuName = %q, want %q (must be the current name, never \"reboot\")", got, "BUDI SANTOSO")
	}
	if got := fake.setOnuForm.Get("onuOperation"); got != "rebootOp" {
		t.Errorf("onuOperation = %q, want rebootOp", got)
	}
}

func TestLegacyRebootAbortsWhenDetailUnreadable(t *testing.T) {
	fake := &fakeLegacyOLT{detailOK: false}
	d := newLegacyTestDriver(t, fake)
	if err := d.RebootONU("0/1:3"); err == nil {
		t.Fatalf("RebootONU should fail when the current name cannot be read")
	}
	if fake.setOnuHits != 0 {
		t.Errorf("setOnu hits = %d, want 0 (no request must reach the device)", fake.setOnuHits)
	}
}

func TestLegacySaveConfiguration(t *testing.T) {
	fake := &fakeLegacyOLT{detailOK: true}
	d := newLegacyTestDriver(t, fake)
	if err := d.SaveConfiguration(); err != nil {
		t.Fatalf("SaveConfiguration: %v", err)
	}
	if fake.saveCfgHits != 1 {
		t.Fatalf("saveConfiguration hits = %d, want 1", fake.saveCfgHits)
	}
	if _, ok := fake.saveCfgQuery["savecfg"]; !ok {
		t.Errorf("saveConfiguration query = %v, want savecfg param (system_save.asp form)", fake.saveCfgQuery)
	}
}

func TestLegacySaveConfigurationFailure(t *testing.T) {
	fake := &fakeLegacyOLT{detailOK: true, saveFail: true}
	d := newLegacyTestDriver(t, fake)
	if err := d.SaveConfiguration(); err == nil {
		t.Fatalf("SaveConfiguration should fail on 401")
	}
}

func TestLegacySystemInfoTotals(t *testing.T) {
	fake := &fakeLegacyOLT{detailOK: true}
	d := newLegacyTestDriver(t, fake)
	info, err := d.GetSystemInfo()
	if err != nil {
		t.Fatalf("GetSystemInfo: %v", err)
	}
	if info.Model != "HA7302" || info.Firmware != "V2.2.59" {
		t.Errorf("model/firmware = %q/%q", info.Model, info.Firmware)
	}
	if info.TotalONU != 2 {
		t.Errorf("TotalONU = %d, want 2", info.TotalONU)
	}
	if info.OnlineONU != 1 {
		t.Errorf("OnlineONU = %d, want 1 (only the Up ONU)", info.OnlineONU)
	}
}

// fakeSwcgiOLT mimics the swcgi CGI: login + config get/set.
type fakeSwcgiOLT struct {
	lastRebootPayload string
	rebootHits        int
}

func (f *fakeSwcgiOLT) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	s := string(body)
	switch {
	case strings.Contains(s, "set=login"):
		_, _ = w.Write([]byte(`<xml><item value="0"/></xml>`))
	case strings.Contains(s, "get=config"):
		// 19 fields: id, name, sn, status, fw, chip, ports, reg, last, ?, ?, ?, ?, temp, ?, ?, tx, rx, uptime.
		fields := []string{"1/1:3", "AGUS PRATAMA", "SN999", "Up", "FW2", "CHIP", "4", "2024-02-01", "2024-02-02", "", "", "", "", "45.5", "", "", "2.1", "-20.3", "3600"}
		_, _ = w.Write([]byte(`<xml><item onu="` + strings.Join(fields, ",") + `"/></xml>`))
	case strings.Contains(s, "rebootOp"):
		f.lastRebootPayload = s
		f.rebootHits++
		_, _ = w.Write([]byte(`<xml><item value="0"/></xml>`))
	default:
		_, _ = w.Write([]byte(`<xml><item value="0"/></xml>`))
	}
}

func TestSwcgiRebootPreservesName(t *testing.T) {
	fake := &fakeSwcgiOLT{}
	srv := httptest.NewServer(fake)
	t.Cleanup(srv.Close)
	host, port := testServerHostPort(t, srv)
	d, err := newSwcgiDriver(host, port, "admin", "admin")
	if err != nil {
		t.Fatalf("newSwcgiDriver (login): %v", err)
	}
	if err := d.RebootONU("1/1:3"); err != nil {
		t.Fatalf("RebootONU: %v", err)
	}
	if fake.rebootHits != 1 {
		t.Fatalf("reboot hits = %d, want 1", fake.rebootHits)
	}
	if !strings.Contains(fake.lastRebootPayload, "onuname=AGUS PRATAMA") {
		t.Errorf("reboot payload = %q, want onuname=AGUS PRATAMA", fake.lastRebootPayload)
	}
	if strings.Contains(fake.lastRebootPayload, "onuname=reboot") {
		t.Errorf("reboot payload must not contain onuname=reboot: %q", fake.lastRebootPayload)
	}
}
