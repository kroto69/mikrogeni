# GenieACS Backend (Go)

Backend API untuk manajemen CPE GenieACS + modul MikroTik.

> Dokumentasi endpoint detail: lihat [`API.md`](./API.md).

## 1) Quick Start

```bash
cp .env.example .env
# wajib: isi JWT_SECRET sebelum start server
go mod download
go run ./cmd/server
```

Server default: `http://localhost:1997`

## 2) Login cepat

Saat ini backend **tidak** lagi membuat akun `admin/admin123` otomatis.

Jika ingin bootstrap admin saat first run, set env berikut dulu:

```bash
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_PASSWORD=<password-kuat-min-8-karakter>
```

Lalu gunakan kredensial bootstrap tersebut untuk login:

```bash
TOKEN=$(curl -s -X POST "http://localhost:1997/api/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"<bootstrap_username>","password":"<bootstrap_password>"}' | jq -r '.access_token')
```

## 3) Endpoint utama backend

### List device (ringkas, cepat)

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:1997/api/acs/devices" | jq
```

Field list:
- `id`
- `sn`
- `vendor_type`
- `pppoe`
- `ip`
- `rx_optical`
- `last_inform`

Opsional query backend:
- `?enrich=1` paksa enrichment list
- `?enrich=0` mode cepat tanpa enrichment

### Detail 1 device

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:1997/api/acs/devices/<device_id>" | jq
```

Field penting detail:
- `ip_address` = IP local gateway CPE
- `ip_pppoe` = IP PPPoE
- `ip_tr069` = IP TR069
- `pppoe_password` = `null` jika memang kosong di GenieACS

## 4) MikroTik module

Contoh endpoint:
- `GET /api/mikrotik/devices`
- `POST /api/mikrotik/devices`
- `PATCH /api/mikrotik/devices/{device_id}`
- `DELETE /api/mikrotik/devices/{device_id}`
- `GET /api/mikrotik/devices/{device_id}/ppp/secrets`
- `POST /api/mikrotik/devices/{device_id}/ppp/secrets`

Semua action async (config/change) bisa dipolling via:
- ACS: `GET /api/acs/tasks/{id}`
- MikroTik: `GET /api/mikrotik/tasks/{id}`

## 5) Notes backend

- `.env` dipakai untuk konfigurasi aplikasi (port, jwt, db, dsb), **bukan** untuk data per-device MikroTik.
- Data MikroTik per-device disimpan di DB dan dikelola via endpoint `/api/mikrotik/*`.
- Jika behavior endpoint berubah, update `API.md` agar integrasi backend tetap sinkron.
- Auto refresh ACS massal bisa diaktifkan via env:
  - `ACS_AUTO_REFRESH_ENABLED=true`
  - `ACS_AUTO_REFRESH_INTERVAL=1h`
  - `ACS_AUTO_REFRESH_BATCH_SIZE=50`
  - scheduler hanya pilih device ACS yang datanya masih incomplete, lalu queue `refreshObject` untuk object penting secara periodik (bukan full tree).

## 6) File Map (GenieACS vs MikroTik)

### GenieACS Core
- `internal/handlers/devices_list.go` → list CPE (`GET /api/acs/devices`)
- `internal/handlers/devices_detail.go` → detail CPE (`GET /api/acs/devices/{id}`)
- `internal/handlers/devices_tasks.go` → reboot/config/task GenieACS
- `internal/handlers/genieacs_http.go` → helper akses GenieACS API
- `internal/handlers/device_extractors.go` + `device_normalizers.go` → parser/extractor TR-069
- `internal/acsresolver/registry.yaml` → registry mapping vendor/model/path ACS
- `internal/acsresolver/registry.go` → loader registry YAML
- `internal/acsresolver/resolver.go` → resolver/scoring/cache/auto-learn ACS
- `internal/handlers/vendor_profiles.go` → thin compatibility wrapper ke package ACS resolver
- `internal/services/genieacs_service.go` → fetch devices + async task queue GenieACS

### MikroTik Core
- `internal/handlers/mikrotik.go` → semua endpoint `/api/mikrotik/*`
- `internal/services/mikrotik_service.go` → client RouterOS v6/v7, sync, interface, PPP, async queue
- `internal/db/mikrotik_db.go` → registry device MikroTik di SQLite
- `internal/models/mikrotik_models.go` → model request/response MikroTik

### Cross-domain / Shared
- `cmd/server/main.go` → route registration + middleware + startup
- `internal/db/db.go` → settings/user/device credentials umum
- `internal/handlers/telegram.go` → worker bot Telegram untuk pencarian ACS + MikroTik

Parameter registry notes:
- mapping vendor/model/path ACS sekarang dibaca dari `internal/acsresolver/registry.yaml`
- logic fallback, scoring, cache, dan auto-learn ada di `internal/acsresolver/resolver.go`
- normalization/extraction tetap di Go (`device_extractors.go`, `device_normalizers.go`)
- tambah vendor/model baru idealnya dimulai dari registry, bukan hardcode logic baru
- resolver sekarang punya cache in-memory untuk hasil profile lookup
- kalau vendor/model unknown berhasil ter-resolve lewat auto-summon dengan confidence cukup, hasilnya disimpan ke SQLite (`acs_learned_profiles`) agar request berikutnya lebih cepat dan stabil

## 7) Telegram Bot Search (Optional)

Set env:

```bash
TELEGRAM_BOT_ENABLED=true
TELEGRAM_BOT_TOKEN=<your_bot_token>
TELEGRAM_CHAT_IDS=123456789,987654321
```

Perilaku:
- Bot start otomatis saat server start.
- `/cari [acs|ppp] [keyword]` = list ringkas semua hasil.
- `/cek [acs|ppp] [keyword]` = detail 2 item per halaman.
- Navigasi detail: `/next`, `/back`, `/refresh`.
- Alias: `/search` dan `/find` sama seperti `/cari`.
- Tanpa filter domain (`acs|ppp`) = cari ke semua domain.
- Teks biasa (contoh: `andik`) = alias `/cari andik`.

## 8) Docker Compose + Nginx

File yang disediakan:
- `Dockerfile`
- `docker-compose.yml`
- `nginx.conf`

Cara jalan:

```bash
docker compose up -d --build
```

Flow default:
- nginx expose port `80`
- request `http://<host>/api/...` diteruskan ke backend Go di container `backend:1997`
- file SQLite disimpan di volume `backend_data`

Untuk cek health sederhana:

```bash
curl http://localhost/api/health
```

Kalau nanti mau tambah plugin backend, cukup extend `docker-compose.yml` + `nginx.conf`, misalnya:
- tambah service `plugin-backend`
- tambah route nginx `/plugin-api/` → `plugin-backend:<port>`

Jadi setup sekarang fokus backend utama dulu, tapi sudah siap diperluas nanti.
