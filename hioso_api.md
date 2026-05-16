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
