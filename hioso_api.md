# Hioso OLT Plugin — API Reference

Base URL: `/api/hioso`
Auth: `Authorization: Bearer <JWT_TOKEN>` (semua endpoint kecuali `/status`)

---

## Plugin Control

### GET /status
Cek status plugin (tidak perlu auth).
```json
{ "success": true, "data": { "enabled": true } }
```

### POST /enable
Aktifkan plugin.

### POST /disable
Nonaktifkan plugin.

---

## Device Management

### GET /devices
List semua OLT yang terdaftar.
```json
{
  "success": true,
  "data": [
    {
      "id": "hioso_1778675305162733241",
      "name": "OLT-1",
      "host": "172.1.2.3",
      "port": 3123,
      "username": "admin",
      "firmware_type": "swcgi_xml",
      "status": "unknown",
      "created_at": "2026-05-13T10:27:11Z",
      "updated_at": "2026-05-13T10:27:11Z"
    }
  ]
}
```

### POST /devices
Tambah OLT baru.

**Body:**
```json
{
  "name": "OLT-1",
  "host": "172.1.2.3",
  "port": 3123,
  "username": "admin",
  "password": "admin",
  "firmware_type": 0
}
```

| firmware_type | Keterangan |
|---|---|
| `0` | HA7304VX (swcgi_xml) |
| `1` | Other/Legacy (legacy_html) |
| `2` | HSGQ Auto — deteksi GPON/EPON otomatis |
| `3` | HSGQ GPON (paksa) |
| `4` | HSGQ EPON (paksa) |

> `firmware_type` yang dikirim saat `POST /devices` adalah angka (0–4). Yang dikembalikan `GET /devices` / `POST /devices/{id}/test` adalah nama driver string: `swcgi_xml`, `legacy_html`, `hsgq`, `hsgq-gpon`, atau `hsgq-epon`.

### DELETE /devices/{id}
Hapus OLT dari database.
```json
{ "success": true, "data": { "deleted": true } }
```

### POST /devices/{id}/test
Test koneksi dan re-detect firmware OLT.
```json
{ "success": true, "data": { "firmware_type": "swcgi_xml", "status": "online" } }
```

---

## System Info

### GET /devices/{id}/health
Ambil informasi sistem OLT.
```json
{
  "success": true,
  "data": {
    "model": "HA7304VX",
    "firmware": "V1.1.21",
    "mac": "78:5C:72:AA:85:A0",
    "ip": "10.14.91.10",
    "uptime": "3?6?15?41",
    "cpu": "6%",
    "memory": "256544?39916?216628",
    "serial_number": "SN2025-12-33280",
    "total_onu": 46,
    "online_onu": 46
  }
}
```

---

## ONU Operations

### GET /devices/{id}/onu?port={N}
List ONU di port tertentu.

| Query Param | Wajib | Keterangan |
|---|---|---|
| `port` | Ya | Nomor PON port (1-8) |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "index": "1/3:1",
      "web_id": "1/3:1",
      "name": "RMWARUE@MARYANTO",
      "sn": "1C:78:4E:78:91:70",
      "status": "Up",
      "tx_power": 2.46,
      "rx_power": -17.85,
      "profile": "swcgi_xml"
    }
  ]
}
```

### GET /devices/{id}/onu/detail?port={N}&id={X}
Detail satu ONU.

| Query Param | Wajib | Keterangan |
|---|---|---|
| `port` | Ya | Nomor PON port |
| `id` | Ya | Nomor ONU di port tersebut |

Contoh: `?port=3&id=1` → ONU `1/3:1` (swcgi) atau `0/3:1` (legacy)

**Response:**
```json
{
  "success": true,
  "data": {
    "index": "1/3:1",
    "web_id": "1/3:1",
    "name": "RMWARUE@MARYANTO",
    "sn": "1C:78:4E:78:91:70",
    "status": "Up",
    "tx_power": 2.46,
    "rx_power": -17.85,
    "profile": "swcgi_xml",
    "firmware": "V9.0.0P1T8",
    "temperature": 60.0,
    "distance": 107,
    "uptime": 433470,
    "registered_at": "2024-01-19 01:42:29",
    "last_online_at": "2024-01-19 01:42:29",
    "chip_id": "9127",
    "ports": "5",
    "voltage": 0,
    "bias_current": 0
  }
}
```

### POST /devices/{id}/onu/rename?port={N}&id={X}
Rename ONU (save nama baru).

| Query Param | Wajib | Keterangan |
|---|---|---|
| `port` | Ya | Nomor PON port |
| `id` | Ya | Nomor ONU |

**Body:**
```json
{ "name": "NAMA-BARU" }
```

**Response:**
```json
{ "success": true, "data": { "method": "swcgi_xml" } }
```

**Catatan perilaku:**
- **Rename otomatis disimpan permanen** (legacy + HSGQ): driver memanggil Save Configuration tepat setelah rename sukses (legacy: `GET /goform/saveConfiguration?savecfg=`; HSGQ: `POST /system_save`). Kalau penyimpanan gagal, rename tetap berlaku dan respons membawa `persist_warning` — nama bisa hilang saat OLT reboot.
- **Reboot tidak menimpa nama**: reboot membaca dulu nama ONU yang tersimpan; kalau nama tidak terbaca, reboot dibatalkan (fail-closed). Dulu pernah ada bug: reboot mengirim nama literal `"reboot"` sehingga ONU ikut ter-rename — sudah diperbaiki.

### POST /devices/{id}/onu/reboot?port={N}&id={X}
Reboot ONU.

| Query Param | Wajib | Keterangan |
|---|---|---|
| `port` | Ya | Nomor PON port |
| `id` | Ya | Nomor ONU |

**Response:**
```json
{ "success": true, "data": { "rebooted": true } }
```

---

## HSGQ OLT (Web JSON API)

HSGQ **bukan SNMP**: MIB HSGQ hanya read-only (satu objek read-write: ambang suhu alarm), jadi semua aksi lewat Web JSON API OLT. Driver: `internal/handlers/hsgq_web.go` (belum pernah diverifikasi ke OLT HSGQ nyata — pemakaian live pertama sebaiknya ke ONU tes).

### Login

`POST /userlogin?form=login` dengan JSON `{"method":"set","param":{"name":user,"key":md5(user+":"+pass),"value":base64(pass),...}}` → `{"code":1}` + header **`X-Token`** untuk request berikutnya.

- Kredensial = **login web UI OLT** (default pabrik: root/admin).
- HTTP polos tanpa TLS — pakai lewat VPN.
- Sesi auto-logout ±5 menit idle; captcha bisa aktif (driver mengembalikan error yang jelas).
- Varian dipilih saat tambah device (`firmware_type` 2/3/4); varian Auto mendeteksi GPON/EPON dari respons OLT.

### Endpoint yang dipakai driver

| Aksi | GPON | EPON |
|---|---|---|
| List ONU | `/ontinfo_table` + `/gponont_mgmt?form=base` | `/onutable` |
| Detail optik | `/gponont_mgmt?form=ont_optical` | `/onumgmt?form=optical-diagnose` |
| Reboot | `/gponont_mgmt?form=info` (flags=4) | `/onumgmt?form=config` (flags=1) |
| Rename | `/gponont_mgmt?form=info` (flags=8) | `/onumgmt?form=config` (flags=8) |
| Simpan konfigurasi | `POST /system_save` (otomatis setelah rename) | sama |

Catatan EPON: rename/reboot membaca dulu `base-info` dan mengirim ulang `fec_mode` yang sedang aktif — jangan mengirim nilai default.

---

## Endpoint Summary

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/status` | Status plugin |
| POST | `/enable` | Aktifkan plugin |
| POST | `/disable` | Nonaktifkan plugin |
| GET | `/devices` | List OLT |
| POST | `/devices` | Tambah OLT |
| DELETE | `/devices/{id}` | Hapus OLT |
| POST | `/devices/{id}/test` | Test koneksi OLT |
| GET | `/devices/{id}/health` | System info OLT |
| GET | `/devices/{id}/onu?port=N` | List ONU per port |
| GET | `/devices/{id}/onu/detail?port=N&id=X` | Detail ONU |
| POST | `/devices/{id}/onu/rename?port=N&id=X` | Rename ONU |
| POST | `/devices/{id}/onu/reboot?port=N&id=X` | Reboot ONU |

---

## Error Response

Semua error menggunakan envelope yang sama:
```json
{ "success": false, "data": null, "error": "pesan error" }
```

| HTTP Code | Keterangan |
|---|---|
| 400 | Parameter tidak valid |
| 404 | Device/ONU tidak ditemukan |
| 503 | Plugin tidak aktif |
| 502 | OLT tidak bisa dihubungi |
