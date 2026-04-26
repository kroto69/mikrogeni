# API Reference (Backend)

Dokumen ini versi ringkas untuk operasional backend.

## Navigasi Cepat

- **Quick reference**:
  - Base + Login
  - Endpoint Ringkas
  - Ringkasan cepat backend
  - ACS Registry / Auto-Learn
  - Hioso OLT Plugin
- **Recipe / contoh pakai**:
  - Ubah SSID / Password WiFi ACS
  - Auto Refresh ACS Periodik
  - MikroTik Add/Edit/Delete (Simple Example)
  - Async Task Example
  - Curl Cepat
  - Telegram Bot Search (Optional)

## Base

- Base URL: `http://localhost:1997/api`
- Public:
  - `POST /login`
  - `GET /health`
- Endpoint lain wajib header:
  - `Authorization: Bearer <access_token>`

## Login

`POST /login`

Request:

```json
{
  "username": "<username>",
  "password": "<password>"
}
```

> Catatan: backend tidak membuat akun `admin/admin123` otomatis. Untuk bootstrap awal, gunakan env `BOOTSTRAP_ADMIN_USERNAME` + `BOOTSTRAP_ADMIN_PASSWORD`.

Response:

```json
{
  "access_token": "<jwt>",
  "refresh_token": "<jwt>",
  "expires_in": 3600
}
```

## Response Pattern

- Normal success: `200`
- Async action: `202` + object `task`
- Error shape:

```json
{
  "error": "message",
  "detail": "optional"
}
```

## Endpoint Ringkas

### GenieACS Device

| Method | Path | Keterangan |
|---|---|---|
| GET | `/acs/devices` | List device |
| GET | `/acs/devices/{id}` | Detail device |
| POST | `/acs/devices/{id}/reboot` | Reboot (async) |
| POST | `/acs/devices/refresh` | Bulk refresh parameter/object ACS (async) |
| POST | `/acs/devices/{id}/config/wifi` | Config wifi (async) |
| POST | `/acs/devices/{id}/config/wan` | Config wan (async) |
| POST | `/acs/devices/{id}/config/security` | Config security (async) |
| POST | `/acs/devices/{id}/config/parameters` | Set parameter (async) |
| GET | `/acs/tasks/{id}` | Cek status task async (ACS) |

`GET /acs/devices/{id}` default sudah fokus SSID aktif:
- `ssid_list` dan `wifi_profiles` by default hanya yang aktif.
- jika mau semua SSID/profile (aktif + non-aktif), kirim `?active_only=0`.
- field `temp` ikut ditampilkan (`null` jika device tidak expose temperature).
- `pppoe_password` akan `null` jika di GenieACS memang kosong/tidak tersedia (tidak fallback ke password web/superadmin).
- field `device_uptime` menampilkan uptime perangkat (jika tidak tersedia -> `"-"`).
- setiap `GET /acs/devices/{id}` akan otomatis enqueue GenieACS `refreshObject` untuk object penting di background.
- auto refresh ini tidak menunda response detail, dan ditahan throttle 1x per 5 menit per device.
- jika ingin response menunggu refresh selesai dulu, gunakan `GET /acs/devices/{id}?refresh_wait=1`.
- mode `refresh_wait=1` akan queue refresh object penting, tunggu task selesai (maks 20 detik), lalu baru fetch detail terbaru.
- field IP dipisah agar tidak tertukar:
  - `ip_pppoe`
  - `ip_tr069`
  - `ip_address` = IP local gateway LAN CPE (contoh `192.168.1.1`).
- jika field IP tidak ada nilainya, backend kirim `"-"`.
- `wifi_profiles` disederhanakan untuk response: hanya `index`, `ssid`, `password`.

Contoh response `GET /acs/devices/{id}`:

```json
{
  "device_id": "00259E-HG8145V5-48575443FE282AB3",
  "serial_number": "48575443FE282AB3",
  "vendor": "Huawei Technologies Co., Ltd",
  "device_type": "HG8145V5",
  "parameter_profile": "huawei",
  "parameter_profile_source": "static",
  "pppoe_username": "user@isp",
  "pppoe_password": null,
  "ip_pppoe": "10.165.204.49",
  "ip_tr069": "10.10.71.204",
  "ip_address": "192.168.100.1",
  "ipv6_address": "",
  "temp": 45,
  "rx_power": -26,
  "ssid_list": ["SSID-AKTIF-2G", "SSID-AKTIF-5G"],
  "wifi_profiles": [
    {
      "index": "1",
      "ssid": "SSID-AKTIF-2G",
      "password": "******"
    }
  ],
  "client_list": [],
  "web_admin_username": "",
  "web_admin_password": "",
  "web_user_password": "",
  "tags": [],
  "device_uptime": "0d 14:17:53",
  "last_inform_at": "2026-03-24T06:40:52Z"
}
```

`GET /acs/devices` sekarang return **ringkas** (bukan raw tree TR-069).

### Recipe: Ubah SSID / Password WiFi ACS

Gunakan endpoint berikut:

```http
POST /acs/devices/{id}/config/wifi
```

Contoh ubah **SSID 2.4G** dan password:

```bash
curl -X POST "http://localhost:1997/api/acs/devices/<DEVICE_ID>/config/wifi" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "ssid_2g": "NamaWifiBaru",
    "password_2g": "PasswordBaru123"
  }'
```

Contoh ubah **SSID 5G** dan password:

```bash
curl -X POST "http://localhost:1997/api/acs/devices/<DEVICE_ID>/config/wifi" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "ssid_5g": "NamaWifi5GBaru",
    "password_5g": "Password5GBaru123"
  }'
```

Contoh aktif/nonaktif WiFi:

```json
{
  "enabled_2g": true,
  "enabled_5g": false
}
```

Field yang tersedia:
- `ssid_2g`
- `password_2g`
- `enabled_2g`
- `ssid_5g`
- `password_5g`
- `enabled_5g`
- `ssid1`, `password1`, `enabled1`
- `hide1`
- `ssid2`, `password2`, `enabled2`
- `hide2`
- `ssid3`, `password3`, `enabled3`
- `hide3`
- `ssid4`, `password4`, `enabled4`
- `hide4`
- `ssid5`, `password5`, `enabled5`
- `hide5`
- `ssid6`, `password6`, `enabled6`
- `hide6`
- `ssid7`, `password7`, `enabled7`
- `hide7`
- `ssid8`, `password8`, `enabled8`
- `hide8`

Kalau device support **multi-SSID** (mis. SSID1, SSID2, SSID3, SSID4), sekarang bisa langsung pakai field sederhana.

Contoh ubah **SSID1 name**:

```bash
curl -X POST "http://localhost:1997/api/acs/devices/<DEVICE_ID>/config/wifi" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "ssid1": "NamaSSID1Baru"
  }'
```

Contoh ubah **SSID1 password**:

```bash
curl -X POST "http://localhost:1997/api/acs/devices/<DEVICE_ID>/config/wifi" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "password1": "PasswordSSID1Baru"
  }'
```

Contoh ubah **SSID2 name + password**:

```bash
curl -X POST "http://localhost:1997/api/acs/devices/<DEVICE_ID>/config/wifi" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "ssid2": "NamaSSID2Baru",
    "password2": "PasswordSSID2Baru"
  }'
```

Contoh **disable + hide** SSID1:

```bash
curl -X POST "http://localhost:1997/api/acs/devices/<DEVICE_ID>/config/wifi" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled1": false,
    "hide1": true
  }'
```

Contoh **enable + unhide** SSID2:

```bash
curl -X POST "http://localhost:1997/api/acs/devices/<DEVICE_ID>/config/wifi" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled2": true,
    "hide2": false
  }'
```

Catatan hide:
- `hideX: true` → backend set `SSIDAdvertisementEnabled=false`
- `hideX: false` → backend set `SSIDAdvertisementEnabled=true`
- support tergantung CPE/TR-069 implementation vendor

Kalau tetap butuh path spesifik/manual, baru gunakan `parameters[]`.

Contoh manual ubah **SSID1 name**:

```bash
curl -X POST "http://localhost:1997/api/acs/devices/<DEVICE_ID>/config/wifi" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "parameters": [
      {
        "name": "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID",
        "value": "NamaSSID1Baru",
        "type": "xsd:string"
      }
    ]
  }'
```

Contoh manual ubah **SSID1 password**:

```bash
curl -X POST "http://localhost:1997/api/acs/devices/<DEVICE_ID>/config/wifi" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "parameters": [
      {
        "name": "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase",
        "value": "PasswordSSID1Baru",
        "type": "xsd:string"
      }
    ]
  }'
```

Contoh ubah **SSID3**:

```json
{
  "parameters": [
    {
      "name": "InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.SSID",
      "value": "NamaSSID3Baru",
      "type": "xsd:string"
    },
    {
      "name": "InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.PreSharedKey.1.KeyPassphrase",
      "value": "PasswordSSID3Baru",
      "type": "xsd:string"
    }
  ]
}
```

Intinya:
- `WLANConfiguration.1` = SSID1
- `WLANConfiguration.2` = SSID2
- `WLANConfiguration.3` = SSID3
- `WLANConfiguration.4` = SSID4

Jika butuh set path TR-069 manual, gunakan `parameters`:

```json
{
  "parameters": [
    {
      "name": "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID",
      "value": "NamaBaru",
      "type": "xsd:string"
    }
  ]
}
```

Catatan:
- endpoint ini **async**
- response akan mengembalikan object `task`
- cek status task via `GET /acs/tasks/{id}`

### Recipe: Bulk Refresh Parameter ACS

Kalau tidak mau refresh satu device satu-satu, gunakan:

```http
POST /acs/devices/refresh
```

Contoh refresh full object untuk banyak device:

```bash
curl -X POST "http://localhost:1997/api/acs/devices/refresh" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "device_ids": [
      "A4F33B-F670L-ZTEGD118816E",
      "34243E-F670L-ZTEGCF9753AD"
    ],
    "object_name": ""
  }'
```

Contoh refresh object tertentu saja:

```bash
curl -X POST "http://localhost:1997/api/acs/devices/refresh" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "device_ids": [
      "A4F33B-F670L-ZTEGD118816E"
    ],
    "object_name": "InternetGatewayDevice.WANDevice.2.X_ZTE-COM_WANPONInterfaceConfig"
  }'
```

Request body:
- `device_ids` → wajib, array ID device ACS
- `object_name` → optional
  - `""` = refresh object penting default (WAN, WLAN, hosts, device info, PON vendor path)
  - isi object path tertentu = refresh object itu saja

Catatan:
- limit **200 device per request**
- response berisi hasil queue per device
- task yang dipakai adalah GenieACS `refreshObject`
- default target object refresh:
  - `InternetGatewayDevice.WANDevice`
  - `InternetGatewayDevice.LANDevice.1.WLANConfiguration`
  - `InternetGatewayDevice.LANDevice.1.Hosts`
  - `InternetGatewayDevice.DeviceInfo`
  - beberapa object PON vendor (`X_ZTE-COM_WANPONInterfaceConfig`, `X_HW_WANPONInterfaceConfig`, dll)

### Recipe: Auto Refresh ACS Periodik

Kalau ingin backend otomatis refresh semua device ACS tiap interval tertentu, aktifkan env berikut:

```bash
ACS_AUTO_REFRESH_ENABLED=true
ACS_AUTO_REFRESH_INTERVAL=1h
ACS_AUTO_REFRESH_BATCH_SIZE=50
```

Catatan:
- default contoh interval: `1h`
- format mengikuti Go duration, contoh: `30m`, `1h`, `2h`
- scheduler akan scan device ACS lalu pilih hanya device yang **incomplete** (mis. PPPoE/RX/temp/uptime masih kosong)
- hanya device incomplete itu yang akan di-queue refresh untuk object penting yang dibutuhkan backend
- `ACS_AUTO_REFRESH_BATCH_SIZE` membatasi jumlah device yang direfresh per cycle agar tidak membebani GenieACS/CPE
- cocok untuk menjaga parameter seperti RX / temp / uptime tetap lebih fresh tanpa full tree refresh manual satu-satu

Performa list:
- mode enrichment list aktif default untuk jumlah device kecil-menengah.
- jika hasil list > 300 device, enrichment otomatis dimatikan agar respon tetap cepat.
- override manual:
  - `?enrich=1` paksa enrichment (coba isi field kosong seperti `pppoe`, `ip`, `rx_optical`)
  - `?enrich=0` matikan enrichment (mode paling cepat)
- enrichment dibatasi maksimal 20 device per request.

Catatan penting list:
- field list memang ringkas untuk kebutuhan tabel backend/integrasi.
- kalau butuh data lengkap per CPE (WiFi profile, client, temp, web creds, IP terpisah), pakai `GET /acs/devices/{id}`.

Contoh response item:

```json
{
  "id": "000AC2-HG6145D2-FHTT9DBA9270",
  "sn": "FHTT9DBA9270",
  "vendor_type": "Huawei/HG6145D2",
  "pppoe": "user@isp",
  "ip": "10.10.10.2",
  "rx_optical": -23.46,
  "last_inform": "2026-03-24T04:07:35Z"
}
```

Field list:
- `id`
- `sn`
- `vendor_type` (format ringkas: `Vendor/Type`, contoh `Huawei/HG6145D2`)
- `pppoe`
- `ip`
- `rx_optical` (null jika tidak tersedia)
- `last_inform`

## Ringkasan cepat backend

- List inventory ringkas: `GET /acs/devices`
- Detail CPE lengkap: `GET /acs/devices/{id}`
- Update/reboot/config: endpoint async + poll `GET /acs/tasks/{id}`
- Untuk detail IP:
- `ip_address` = IP local gateway LAN CPE
- `ip_pppoe` = IP WAN PPPoE
- `ip_tr069` = IP TR069
- jika tidak ada nilainya -> `"-"`
- ACS response sekarang juga menyertakan:
  - `is_incomplete` → `true/false`
  - `missing_fields` → array field penting yang masih kosong (contoh: `rx_power`, `temp`, `device_uptime`, `pppoe_username`)

## ACS Registry / Auto-Learn

- mapping vendor/model/path ACS dibaca dari `internal/handlers/acs_registry.yaml`
- resolver tetap pakai logic Go untuk fallback, scoring, dan normalization
- hasil lookup profile disimpan di cache in-memory agar request berikutnya lebih cepat
- jika vendor/model belum ada di registry tapi berhasil ter-resolve lewat auto-summon, backend akan simpan hasil profile key ke SQLite table `acs_learned_profiles`
- tujuan auto-learn ini agar model unknown tidak perlu dihitung ulang terus-menerus di setiap request

Debug endpoint:
- `GET /acs/settings/acs-learned-profiles`
- `POST /acs/settings/acs-learned-profiles`
- `DELETE /acs/settings/acs-learned-profiles?vendor=<vendor>&product_class=<product_class>`

Response example:

```json
[
  {
    "vendor": "zte",
    "product_class": "f609",
    "profile_key": "zte",
    "score": 8,
    "created_at": "2026-04-01 10:00:00",
    "updated_at": "2026-04-01 12:30:00"
  }
]
```

Promote / upsert example:

```bash
curl -X POST "http://localhost:1997/api/acs/settings/acs-learned-profiles" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "vendor": "zte",
    "product_class": "f609",
    "profile_key": "zte",
    "score": 10
  }'
```

Delete/reset example:

```bash
curl -X DELETE "http://localhost:1997/api/acs/settings/acs-learned-profiles?vendor=zte&product_class=f609" \
  -H "Authorization: Bearer $TOKEN"
```

Endpoint ACS tambahan:
- `GET /acs/dashboard`
- `GET/POST /acs/settings`
- `GET /acs/settings/hioso-olts`
- `POST /acs/settings/hioso-olts`
- `PATCH /acs/settings/hioso-olts/{id}`
- `DELETE /acs/settings/hioso-olts/{id}`
- `POST /acs/settings/hioso-olts/{id}/activate`
- `GET /acs/settings/acs-learned-profiles`
- `GET /acs/users`, `POST /acs/users`, `PATCH /acs/users/{id}`, `DELETE /acs/users/{id}`
- `GET/POST /acs/vendors`
- `GET/POST /acs/tags`
- `POST /acs/config/wifi`, `POST /acs/config/wan`, `POST /acs/config/security`
- `GET /acs/check/wan`, `GET /acs/check/gpon-epon`, `GET /acs/faults`, `DELETE /acs/faults/{id}`
- `POST /acs/portal/validate-accesscode`, `GET /acs/search`

### User Management (ACS)

- Role yang valid hanya: `admin` atau `teknisi`.
- Create user (`POST /acs/users`) wajib kirim: `username`, `password`, `role`.
- Update user (`PATCH /acs/users/{id}`) wajib kirim: `username`, `role`.
  - `password` opsional. Jika dikirim dan tidak kosong, password user akan di-update.
- Update/Delete ke ID user yang tidak ada akan return `404`.

### Hioso runtime settings (DB + fallback env)

Untuk plugin Hioso, backend sekarang mendukung profile OLT multi-item:

- `plugin_hioso_olts` (JSON array profile)
- `plugin_hioso_active_olt_id` (ID profile aktif)

Runtime resolve priority:
1. profile aktif dari `plugin_hioso_olts`
2. key legacy `plugin_*`
3. env lama `OLT_*`

Saat activate profile, backend otomatis mirror profile aktif ke key legacy agar flow lama tetap jalan.

Key legacy yang tetap dipertahankan:

- `plugin_host` → fallback `OLT_HOST`
- `plugin_port` → fallback `OLT_PORT` (default aman: `161`)
- `plugin_web_host` → fallback `OLT_WEB_HOST`, lalu fallback kompatibilitas ke `plugin_host`
- `plugin_web_port` → fallback `OLT_WEB_PORT` (default aman untuk WebUI: `80`)
- `plugin_snmp_version` → fallback `OLT_SNMP_VERSION` (default aman: `2c`)
- `plugin_snmp_community` (atau `plugin_community`) → fallback `OLT_COMMUNITY`
- `plugin_username` → fallback `OLT_WEB_USER`
- `plugin_password` → fallback `OLT_WEB_PASS`

#### CRUD profile Hioso OLT

`GET /acs/settings/hioso-olts`

Contoh response:

```json
{
  "profiles": [
    {
      "id": "l9w6l2rvm4",
      "name": "OLT-Core-1",
      "host": "10.10.10.10",
      "port": "161",
      "web_host": "10.10.10.10",
      "web_port": "80",
      "snmp_version": "2c",
      "snmp_community": "public",
      "username": "admin",
      "password": "admin"
    }
  ],
  "active_id": "l9w6l2rvm4"
}
```

`POST /acs/settings/hioso-olts`

Contoh payload:

```json
{
  "name": "OLT-Core-1",
  "host": "10.10.10.10",
  "port": "161",
  "web_host": "10.10.10.10",
  "web_port": "80",
  "snmp_version": "2c",
  "snmp_community": "public",
  "username": "admin",
  "password": "admin"
}
```

Catatan validasi:
- `host` dan `snmp_community` wajib.
- `port` default `161` jika kosong.
- `web_port` default `80` jika kosong.
- `snmp_version` default `2c` jika kosong (nilai valid: `1`, `2c`, `3`).

`PATCH /acs/settings/hioso-olts/{id}` untuk edit profile.

`DELETE /acs/settings/hioso-olts/{id}` untuk hapus profile.

`POST /acs/settings/hioso-olts/{id}/activate` untuk set active profile + mirror ke key legacy `plugin_*`.

### MikroTik Device Registry

| Method | Path | Keterangan |
|---|---|---|
| GET | `/mikrotik/devices` | List device MikroTik |
| POST | `/mikrotik/devices` | Add device MikroTik |
| GET | `/mikrotik/devices/{device_id}` | Detail 1 device |
| PATCH | `/mikrotik/devices/{device_id}` | Edit host/user/password/port/site/tags |
| DELETE | `/mikrotik/devices/{device_id}` | Hapus device |
| POST | `/mikrotik/devices/{device_id}/test-connection` | Test koneksi API RouterOS |
| POST | `/mikrotik/devices/{device_id}/sync` | Sync facts + detect ROS v6/v7 |
| GET | `/mikrotik/tasks/{id}` | Cek status task async (MikroTik) |

Response ringkas `GET /mikrotik/devices/{device_id}`:

```json
{
  "device_id": "mtk_1774316151080317887",
  "identity": "GW-SARIREJO-01",
  "ros_version": "7.13.2 stable",
  "model_type": "RB750Gr3 · hEX",
  "management_ip": "192.168.1.1",
  "uptime": "12d 4h 37m",
  "cpu_load": "14%",
  "free_memory": "196 / 256 MB"
}
```

### MikroTik Manage (yang kamu minta)

| Method | Path | Keterangan |
|---|---|---|
| GET | `/mikrotik/devices/{device_id}/interfaces` | List interface |
| GET | `/mikrotik/devices/{device_id}/interfaces/{interface_id}/traffic` | Monitor traffic interface (real-time sample) |
| PATCH | `/mikrotik/devices/{device_id}/interfaces/{interface_id}` | Edit interface (async) |

Contoh response `GET /mikrotik/devices/{device_id}/interfaces/{interface_id}/traffic`:

```json
{
  "device_id": "mtk_1774316151080317887",
  "interface_id": "ether1",
  "interface": "ether1",
  "rx_bps": 21500000,
  "tx_bps": 1840000,
  "rx_mbps": 21.5,
  "tx_mbps": 1.84,
  "rx_pps": 3200,
  "tx_pps": 410,
  "sampled_at": "2026-03-26T09:15:22Z"
}
```
| GET | `/mikrotik/devices/{device_id}/ppp/active` | List PPP active |
| DELETE | `/mikrotik/devices/{device_id}/ppp/active/{session_id}` | Kick 1 session (async) |
| POST | `/mikrotik/devices/{device_id}/ppp/active/kick` | Bulk kick by `session_ids` / `usernames` (async) |
| GET | `/mikrotik/devices/{device_id}/ppp/secrets` | List secret |
| POST | `/mikrotik/devices/{device_id}/ppp/secrets` | Add secret (async) |
| PATCH | `/mikrotik/devices/{device_id}/ppp/secrets/{secret_id}` | Edit secret (async) |
| DELETE | `/mikrotik/devices/{device_id}/ppp/secrets/{secret_id}` | Delete secret (async) |
| GET | `/mikrotik/devices/{device_id}/ppp/profiles` | List profile |
| POST | `/mikrotik/devices/{device_id}/ppp/profiles` | Add profile (async) |
| PATCH | `/mikrotik/devices/{device_id}/ppp/profiles/{profile_id}` | Edit profile (async) |
| DELETE | `/mikrotik/devices/{device_id}/ppp/profiles/{profile_id}` | Delete profile (async) |

Contoh response `GET /mikrotik/devices/{device_id}/ppp/active`:

```json
[
  {
    ".id": "*A",
    "name": "PSD014@ANDIK",
    "service": "pppoe",
    "address": "10.10.20.31",
    "caller-id": "AA:BB:CC:DD:EE:FF",
    "uptime": "2d4h12m",
    "session-id": "abc123"
  }
]
```
| POST | `/mikrotik/bulk/jobs` | 1 aksi ke banyak device (async) |

### Hioso OLT Plugin

Plugin Hioso mengelola OLT via SNMP dan Web API. Semua endpoint di bawah `/api/plugin/hioso` membutuhkan JWT auth.

#### Plugin Control

| Method | Path | Keterangan |
|---|---|---|
| `GET` | `/plugin/hioso/status` | Status plugin (enabled/disabled + host) |
| `POST` | `/plugin/hioso/enable` | Aktifkan plugin |
| `POST` | `/plugin/hioso/disable` | Nonaktifkan plugin |
| `GET` | `/plugin/hioso/health` | Cek koneksi OLT via SNMP |

Contoh response `GET /plugin/hioso/status`:

```json
{
  "success": true,
  "data": {
    "enabled": true,
    "host": "10.10.10.10"
  }
}
```

Contoh response `GET /plugin/hioso/health`:

```json
{
  "success": true,
  "data": {
    "online": true,
    "detail": "OLT reachable, profil: HIOSO_GPON"
  }
}
```

#### ONU Data

| Method | Path | Keterangan |
|---|---|---|
| `GET` | `/plugin/hioso/onu` | List semua ONU |
| `GET` | `/plugin/hioso/onu?port=N` | List ONU pada port tertentu |
| `GET` | `/plugin/hioso/onu/{index}` | Detail 1 ONU |
| `POST` | `/plugin/hioso/onu/{index}/rename` | Rename ONU |
| `POST` | `/plugin/hioso/onu/{index}/reboot` | Reboot ONU |
| `GET` | `/plugin/hioso/ports` | List port yang tersedia |

**Query Parameters:**

- `port` (opsional, integer) — filter ONU berdasarkan nomor port PON

**ONU Response Fields:**

| Field | Tipe | Keterangan |
|---|---|---|
| `index` | string | SNMP index ONU |
| `web_id` | string | Web UI ID untuk rename/reboot |
| `port` | int | Nomor port PON (diparse dari index) |
| `onu_id` | int | ID ONU pada port tersebut |
| `name` | string | Nama ONU |
| `sn` | string | Serial number |
| `status` | string | Status online/offline |
| `tx_power` | float | Transmit power (dBm) |
| `rx_power` | float | Receive power (dBm) |
| `profile` | string | Profil OID yang terdeteksi |

Contoh response `GET /plugin/hioso/onu`:

```json
{
  "success": true,
  "data": [
    {
      "index": "1.3.1",
      "web_id": "1",
      "port": 3,
      "onu_id": 1,
      "name": "ONU-Customer-A",
      "sn": "HISO12345678",
      "status": "online",
      "tx_power": 2.5,
      "rx_power": -18.3,
      "profile": "HIOSO_GPON"
    }
  ]
}
```

Contoh response `GET /plugin/hioso/onu?port=3`:

```json
{
  "success": true,
  "data": [
    {
      "index": "1.3.1",
      "web_id": "1",
      "port": 3,
      "onu_id": 1,
      "name": "ONU-Customer-A",
      "sn": "HISO12345678",
      "status": "online",
      "tx_power": 2.5,
      "rx_power": -18.3,
      "profile": "HIOSO_GPON"
    }
  ]
}
```

Contoh response `GET /plugin/hioso/ports`:

```json
{
  "success": true,
  "data": [1, 2, 3, 4, 5, 6, 7, 8]
}
```

#### ONU Actions

**Rename ONU:**

```bash
curl -X POST "http://localhost:1997/api/plugin/hioso/onu/1.3.1/rename" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Customer-Baru"}'
```

Response:

```json
{
  "success": true,
  "data": {
    "method": "snmp"
  }
}
```

> `method` bisa `snmp` atau `web` tergantung profil OLT.

**Reboot ONU:**

```bash
curl -X POST "http://localhost:1997/api/plugin/hioso/onu/1.3.1/reboot" \
  -H "Authorization: Bearer $TOKEN"
```

Response:

```json
{
  "success": true,
  "data": {
    "rebooted": true
  }
}
```

#### Hioso OLT Profiles (Settings)

OLT profiles dikelola via Settings API (bukan plugin endpoint):

| Method | Path | Keterangan |
|---|---|---|
| `GET` | `/acs/settings/hioso-olts` | List semua OLT profiles |
| `POST` | `/acs/settings/hioso-olts` | Buat OLT profile baru |
| `PATCH` | `/acs/settings/hioso-olts/{id}` | Edit OLT profile |
| `DELETE` | `/acs/settings/hioso-olts/{id}` | Hapus OLT profile |
| `POST` | `/acs/settings/hioso-olts/{id}/activate` | Set profile aktif + mirror ke legacy keys |

Detail CRUD profile lihat di bagian "Hioso runtime settings" di bawah.

#### Hioso SNMP & Profile Detection

- Backend mendukung **3 profil OID**: `HIOSO_GPON`, `HIOSO_B`, `HIOSO_C`
- **Auto-detect** via scoring: walk NameOID (+3), SNOID (+2), StatOID (+1) per profil. Skor tertinggi menang.
- **Fallback**: `sysObjectID` prefix matching (misal `.1.3.6.1.4.1.25355` → HIOSO_C)
- **Profile cache** 30 menit — deteksi hanya dilakukan sekali per `host:community`, lalu di-cache
- **SNMP timeout**: 5 detik untuk walk, 3 detik untuk set
- **Request timeout**: 20 detik (context.WithTimeout)
- Referensi lengkap OID: lihat file `hioso_oid` di root project

## Recipe: MikroTik Add/Edit/Delete (Simple Example)

### Add device

`POST /mikrotik/devices`

```json
{
  "id": "mtk-jkt-01",
  "name": "MTK-JKT-01",
  "host": "192.168.1.99",
  "port": 8728,
  "username": "admin",
  "password": "secret",
  "use_tls": false,
  "site": "jakarta",
  "tags": ["core", "pppoe"]
}
```

Catatan:
- `id` opsional. Kalau tidak diisi, backend auto-generate: `mtk-YYMMDDHHMMSS-XXXX`.

### Edit device

`PATCH /mikrotik/devices/{device_id}`

```json
{
  "host": "192.168.1.100",
  "port": 8728,
  "username": "admin",
  "password": "new-secret",
  "site": "jakarta",
  "tags": ["core"]
}
```

### Delete device

`DELETE /mikrotik/devices/{device_id}`

Response:

```json
{
  "success": true,
  "message": "MikroTik device deleted"
}
```

## Recipe: Async Task Example

Contoh response endpoint async:

```json
{
  "success": true,
  "message": "PPP secret create queued",
  "device_id": "mtk-jkt-01",
  "action": "ppp.secret.create",
  "task": {
    "id": "mtk-task-123",
    "status": "queued",
    "created_at": "2026-03-24T01:00:00Z"
  }
}
```

Polling:

- ACS task: `GET /acs/tasks/{task_id}` sampai status `success` atau `failed`.
- MikroTik task: `GET /mikrotik/tasks/{task_id}` sampai status `success` atau `failed`.

## Recipe: Curl Cepat

```bash
# login
TOKEN=$(curl -s -X POST "http://localhost:1997/api/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"<username>","password":"<password>"}' | jq -r '.access_token')

# list mikrotik
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:1997/api/mikrotik/devices" | jq

# add mikrotik
curl -s -X POST "http://localhost:1997/api/mikrotik/devices" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id":"mtk-jkt-01","name":"MTK-JKT-01","host":"192.168.1.99","port":8728,"username":"admin","password":"secret","use_tls":false}' | jq

# edit mikrotik
curl -s -X PATCH "http://localhost:1997/api/mikrotik/devices/mtk-jkt-01" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"password":"new-secret"}' | jq

# delete mikrotik
curl -s -X DELETE "http://localhost:1997/api/mikrotik/devices/mtk-jkt-01" \
  -H "Authorization: Bearer $TOKEN" | jq
```

## Recipe: Telegram Bot Search (Optional)

Aktifkan via env:

```bash
TELEGRAM_BOT_ENABLED=true
TELEGRAM_BOT_TOKEN=<your_bot_token>
TELEGRAM_CHAT_IDS=123456789,987654321
```

Input chat yang didukung:
- `/help`
- `/status` atau `/ping` → cek status bot
- `/cari [acs|ppp] [keyword]` → list hasil ringkas (tanpa detail), tampilkan semua match
- `/search [acs|ppp] [keyword]` (alias `/cari`)
- `/find [acs|ppp] [keyword]` (alias `/cari`)
- `/cek [acs|ppp] [keyword]` → tampil detail, 2 item per halaman (paged)
- `/next`, `/back`, `/refresh` → navigasi hasil `/cek`
- jika domain filter (`acs|ppp`) tidak diisi, bot cari semua domain
- jika keyword kosong, bot tampilkan semua data sesuai domain
- kirim teks biasa (contoh: `andik`) = alias `/cari andik`

Output bot:
- `/cari` = ringkas
- `/cek` = detail ACS + MikroTik dengan format operasional
- jika `pppoe` di ACS cocok dengan `name` di PPP MikroTik, hasil ditampilkan dalam **1 blok gabungan** (ACS + PPP/MikroTik)
- jika tidak cocok, hasil ACS dan PPP tetap ditampilkan terpisah

Catatan:
- Jika `TELEGRAM_CHAT_IDS` diisi, hanya chat id yang terdaftar yang bisa menggunakan bot.
- Bot jalan via long polling dan start otomatis saat server start.
