## KONTEKS PROJECT

Kamu adalah expert Go backend developer. Project ini bernama **mikrogeni** (`module: genieacs-backend`).

Project sudah berjalan dengan fitur MikroTik dan GenieACS/ACS. Tugasmu adalah **menambahkan Hioso OLT plugin backend** ke dalam project ini — bukan membuat project baru.

---

## STRUKTUR PROJECT EXISTING (JANGAN DIUBAH)

```
mikrogeni-main/
├── cmd/server/              ← entry point (main.go ada di sini)
├── internal/
│   ├── auth/auth.go
│   ├── db/db.go
│   ├── handlers/            ← semua handler existing (auth, mikrotik, devices, dll)
│   ├── middleware/middleware.go
│   ├── models/models.go     ← struct existing
│   └── services/
├── frontend/                ← JANGAN DISENTUH
├── go.mod                   ← module: genieacs-backend
└── go.sum
```

**HTTP framework yang dipakai:** `github.com/go-chi/chi/v5` (bukan gin!)
**Pattern handler:** `func(w http.ResponseWriter, r *http.Request)` — standard net/http
**Auth:** JWT Bearer token via middleware `middleware.AuthenticateToken`

---

## FILE YANG PERLU DIBUAT (3 file baru saja)

```
internal/handlers/hioso_plugin.go    ← state enable/disable + semua handler HTTP
internal/handlers/hioso_snmp.go      ← OID profiles, walk, set, parser, fetch ONU
internal/handlers/hioso_webapi.go    ← login, rename, reboot HTTP ke OLT
```

Semua file masuk ke package `handlers` (sama dengan file existing).

---

## ROUTE REGISTRATION

Di `cmd/server/main.go` yang sudah ada, **tambahkan route group berikut** di dalam router chi yang sudah ada, di bawah route existing:

```go
// Plugin Hioso OLT
r.Route("/api/plugin/hioso", func(r chi.Router) {
    r.Use(middleware.AuthenticateToken) // wajib auth seperti route lain

    // Plugin control
    r.Get("/status",  handlers.HiosoStatusHandler)
    r.Post("/enable",  handlers.HiosoEnableHandler)
    r.Post("/disable", handlers.HiosoDisableHandler)

    // OLT & ONU
    r.Get("/health",              handlers.HiosoHealthHandler)
    r.Get("/onu",                 handlers.HiosoFetchAllHandler)
    r.Get("/onu/{index}",         handlers.HiosoDetailHandler)
    r.Post("/onu/{index}/rename", handlers.HiosoRenameHandler)
    r.Post("/onu/{index}/reboot", handlers.HiosoRebootHandler)
})
```

---

## CONFIG (tambahkan ke .env existing)

```
HIOSO_ENABLED=true
OLT_HOST=10.17.0.7
OLT_COMMUNITY=public
OLT_WEB_USER=admin
OLT_WEB_PASS=admin
```

---

## API CONTRACT (wajib diikuti — frontend sudah ada dan menunggu ini)

Frontend project ini sudah punya halaman Plugin Hioso di `frontend/src/pages/Plugin/OltHioso.tsx`.
Frontend memanggil backend via `VITE_PLUGIN_API_BASE_URL` (default `/plugin-api`) yang di-proxy nginx ke backend.

### Response envelope semua endpoint:
```json
{ "success": true, "data": {}, "error": "" }
```

### GET /api/plugin/hioso/status
```json
{
  "success": true,
  "data": {
    "enabled": true,
    "host": "10.17.0.7"
  }
}
```

### GET /api/plugin/hioso/health
```json
{
  "success": true,
  "data": {
    "online": true,
    "detail": "OLT reachable, profil: HIOSO_C"
  }
}
```

### GET /api/plugin/hioso/onu
```json
{
  "success": true,
  "data": [
    {
      "index":    "1.1.6",
      "web_id":   "0/1/1:6",
      "name":     "PELANGGAN-06",
      "sn":       "44:22:95:A3:F7:70",
      "status":   "Up",
      "tx_power": -25.40,
      "rx_power": -22.10,
      "profile":  "HIOSO_C"
    }
  ]
}
```

### GET /api/plugin/hioso/onu/{index}
```json
{ "success": true, "data": { /* satu ONU */ } }
```

### POST /api/plugin/hioso/onu/{index}/rename
Request body: `{ "name": "NAMA-BARU" }`
```json
{ "success": true, "data": { "method": "SNMP" }, "error": "" }
```

### POST /api/plugin/hioso/onu/{index}/reboot
```json
{ "success": true, "data": { "rebooted": true }, "error": "" }
```

---

## ISI hioso_plugin.go

Package: `handlers`

```go
// State plugin
var hiosoEnabled = os.Getenv("HIOSO_ENABLED") == "true"

func HiosoSetEnabled(val bool) { hiosoEnabled = val }
func HiosoIsEnabled() bool     { return hiosoEnabled }

// hiosoGuard - cek enable, return false + tulis response jika disabled
func hiosoGuard(w http.ResponseWriter, r *http.Request) bool {
    if !hiosoEnabled {
        w.WriteHeader(http.StatusServiceUnavailable)
        json.NewEncoder(w).Encode(map[string]interface{}{
            "success": false,
            "error":   "Plugin Hioso tidak aktif. Aktifkan via POST /api/plugin/hioso/enable",
            "data":    nil,
        })
        return false
    }
    return true
}

// Helper response
func hiosoJSON(w http.ResponseWriter, data interface{}) {
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(map[string]interface{}{
        "success": true,
        "data":    data,
        "error":   "",
    })
}

func hiosoError(w http.ResponseWriter, code int, msg string) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(code)
    json.NewEncoder(w).Encode(map[string]interface{}{
        "success": false,
        "data":    nil,
        "error":   msg,
    })
}
```

Handler yang dibuat (semua wajib panggil `hiosoGuard` dulu kecuali status):
- `HiosoStatusHandler` — GET /status (tidak perlu guard, boleh selalu diakses)
- `HiosoEnableHandler` — POST /enable
- `HiosoDisableHandler` — POST /disable
- `HiosoHealthHandler` — GET /health, walk sysDescr
- `HiosoFetchAllHandler` — GET /onu, panggil FetchAllONU()
- `HiosoDetailHandler` — GET /onu/{index}, cari dari FetchAllONU by index
- `HiosoRenameHandler` — POST /onu/{index}/rename, bind JSON body {"name":"..."}
- `HiosoRebootHandler` — POST /onu/{index}/reboot

---

## ISI hioso_snmp.go

Package: `handlers`

### Struct ONU

```go
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
```

### OID Profiles (slice, bukan map — urutan penting untuk auto-detect)

```go
type hiosoOIDProfile struct {
    Name, NameOID, SNOID, StatOID, TxOID, RxOID string
}

var hiosoProfiles = []hiosoOIDProfile{
    {
        Name:    "HIOSO_C",
        NameOID: ".1.3.6.1.4.1.25355.3.2.6.3.2.1.37",
        SNOID:   ".1.3.6.1.4.1.25355.3.2.6.3.2.1.11",
        StatOID: ".1.3.6.1.4.1.25355.3.2.6.3.2.1.39",
        TxOID:   ".1.3.6.1.4.1.25355.3.2.6.14.2.1.4",
        RxOID:   ".1.3.6.1.4.1.25355.3.2.6.14.2.1.8",
    },
    {
        Name:    "HIOSO_B",
        NameOID: ".1.3.6.1.4.1.3320.101.10.1.1.79",
        SNOID:   ".1.3.6.1.4.1.3320.101.10.1.1.3",
        StatOID: ".1.3.6.1.4.1.3320.101.10.1.1.26",
        TxOID:   ".1.3.6.1.4.1.3320.101.10.5.1.5",
        RxOID:   ".1.3.6.1.4.1.3320.101.10.5.1.6",
    },
    {
        Name:    "HIOSO_GPON",
        NameOID: ".1.3.6.1.4.1.25355.3.3.1.1.1.2",
        SNOID:   ".1.3.6.1.4.1.25355.3.3.1.1.1.5",
        StatOID: ".1.3.6.1.4.1.25355.3.3.1.1.1.11",
        TxOID:   ".1.3.6.1.4.1.25355.3.3.1.1.4.1.2",
        RxOID:   ".1.3.6.1.4.1.25355.3.3.1.1.4.1.1",
    },
}
```

### Dependency SNMP

Tambahkan ke go.mod: `github.com/gosnmp/gosnmp`

### Fungsi-fungsi wajib di hioso_snmp.go

**hiosoSNMPWalk(host, community, oid string) (map[string]string, error)**
- gosnmp, SNMPv2c, timeout 2s, retries 2
- Return map[oid_key]value_string

**hiosoSNMPSet(host, community, oid, value string) error**
- SNMP set, type OctetString

**hiosoDetectProfile(host, community string) (*hiosoOIDProfile, error)**
- Loop hiosoProfiles, walk NameOID
- Return profil pertama yang hasilnya tidak kosong
- Gagal semua → error "OLT tidak dikenali sebagai Hioso"

**hiosoExtractIndex(rawOID, baseOID string) string**
- Strip baseOID dari kiri → return sisa (contoh: "1.1.6")

**hiosoParseSignal(raw string) float64**
```
ekstrak angka (support negatif & desimal)
abs > 500 → / 100
abs > 50  → / 10
else      → as-is
return 2 desimal
```

**hiosoDecodeMacOrSN(raw string) string**
```
1. Bersihkan: hapus '"', 'Hex-STRING: ', 'STRING: '
2. "XX XX XX XX XX XX" → MAC dengan ":"
3. hex 12 char → MAC dengan ":"
4. hex 16 char → decode ASCII → cek printable
5. pola GPON "XXXX########" → as-is
6. fallback → cleaned string
```

**hiosoParseStatus(raw string, isGPON bool) string**
```
GPON: 2/3/4="Up", 1="Offline", lain="Down"
EPON: 1/3/4="Up", lain="Down"
```

**hiosoIsGhost(name, sn string, tx, rx float64) bool**
```
true jika tx==0 && rx==0 && name=="" && sn==""
true jika name mengandung "NO SUCH" (case insensitive)
```

**hiosoResolveWebID(index string) string**
```
dot "1.1.6" → "0/1/1:6"
integer     → bit shift: port=(v>>16)&0xFF, onu=v&0xFF
jika port==0||>8 → port=(v>>8)&0xFF
jika port masih 0 → port=1
→ "0/1/{port}:{onu}"
```

**Fallback OID SN/MAC:**
```go
var hiosoSNFallbacks = []string{
    ".1.3.6.1.4.1.25355.3.2.10.1.1.2",
    ".1.3.6.1.4.1.25355.3.2.1.2.1.2",
    ".1.3.6.1.4.1.25355.3.2.6.1.1.18",
    ".1.3.6.1.4.1.25355.3.2.6.3.2.1.12",
    ".1.3.6.1.4.1.25355.3.2.6.1.1.2.1.6",
    ".1.3.6.1.4.1.25355.3.3.1.1.1.5",
    ".1.3.6.1.4.1.3320.101.10.1.1.3",
}
var hiosoStatusKeywords = []string{
    "Registered","Offline","Active","Online","Down","Up","Power","Alarm",
}
```

**FetchAllONU(host, community string) ([]HiosoONU, string, error)**
```
1. Walk sysDescr (.1.3.6.1.2.1.1.1) → error jika gagal
2. Walk sysObjectID (.1.3.6.1.2.1.1.2.0) → simpan untuk log
3. hiosoDetectProfile() → error jika gagal
4. Walk NameOID → parse nama per index
5. Walk SNOID + fallback → decodeMacOrSN per index
6. Walk StatOID → parseStatus per index
7. Walk TxOID → parseSignal per index
8. Walk RxOID → parseSignal per index
9. Gabung per index → []HiosoONU
10. Filter hiosoIsGhost
11. Return ([]HiosoONU, profileName, error)
```

---

## ISI hioso_webapi.go

Package: `handlers`

**hiosoWebLogin(host, user, pass string) (http.CookieJar, error)**
```
POST http://{host}/goform/login
Header: Authorization: Basic base64(user:pass)
Form  : user={u}&pass={p}&username={u}&password={p}&submit=Login
Timeout: 10 detik
Return: CookieJar berisi session
```

**HiosoRenameONU(host, community, index, newName, user, pass string) (string, error)**
```
1. Truncate newName max 31 char
2. hiosoDetectProfile() → dapat NameOID
3. hiosoSNMPSet(host, community, NameOID+"."+index, newName)
   → sukses: return ("SNMP", nil)
4. Gagal → hiosoWebLogin()
5. POST /goform/setOnu:
   onuId={hiosoResolveWebID(index)}&onuName={newName}&onuOperation=modifyOnu
   HTTP 200/302 → return ("Web", nil)
   lainnya → return ("", error)
```

**HiosoRebootONU(host, index, user, pass string) error**
```
1. hiosoWebLogin()
2. POST /goform/setOnu:
   onuId={hiosoResolveWebID(index)}&onuName=rebooter&onuOperation=rebootOp
3. HTTP 200/302 → nil
4. lainnya → error
CATATAN: Web API only. Tidak ada SNMP OID untuk reboot. Jangan Telnet.
```

---

## DATA TERVERIFIKASI (OLT 10.17.0.7, profil HIOSO_C)

```
Index 1.1.1 → MAC: 74:B5:7E:4A:5F:BF
Index 1.1.2 → MAC: EC:F0:FE:6B:C4:7B
Index 1.1.3 → MAC: 1C:78:4E:A8:D7:A0
Index 1.1.4 → MAC: 6C:D2:B3:D3:A8:B9
Index 1.1.5 → MAC: 44:E6:B0:0F:F2:C0
Index 1.1.6 → MAC: 44:22:95:A3:F7:70
```

Gunakan untuk validasi output parser.

---

## ATURAN WAJIB

1. **Package semua file baru: `handlers`** — sama dengan file existing.
2. **Jangan ubah file existing** — hanya tambah 3 file baru + route di main.go.
3. **HTTP framework: chi** — bukan gin. Handler signature: `func(w http.ResponseWriter, r *http.Request)`.
4. **Semua nama fungsi/var diawali `hioso` atau `Hioso`** — hindari konflik.
5. **Semua handler kecuali StatusHandler wajib cek hiosoGuard dulu.**
6. **Auto-detect profil** — loop hiosoProfiles[], stop saat walk berhasil.
7. **Connectivity check** — walk sysDescr sebelum operasi.
8. **Smart scaling sinyal** — abs>500/abs>50/else.
9. **Handle semua format SN/MAC** — hex spasi, raw hex, binary, GPON SN.
10. **Filter ghost ONU** sebelum return response.
11. **Rename: SNMP dulu, Web API fallback.**
12. **Reboot: Web API only.**
13. **Komentar kode Bahasa Indonesia.**
14. **Nama ONU max 31 karakter** — truncate otomatis.
15. **Tulis semua file lengkap** — tidak boleh ada `// TODO` atau placeholder kosong.
16. **Tambahkan `github.com/gosnmp/gosnmp` ke go.mod** via `go get`.

---

## URUTAN PENGERJAAN

1. `go get github.com/gosnmp/gosnmp` untuk update go.mod
2. `internal/handlers/hioso_snmp.go` — struct, profiles, walk/set, semua parser, FetchAllONU
3. `internal/handlers/hioso_webapi.go` — login, RenameONU, RebootONU
4. `internal/handlers/hioso_plugin.go` — state, guard, helper, semua handler
5. Tambahkan route group ke `cmd/server/main.go` (hanya tambah, jangan ubah yang lain)