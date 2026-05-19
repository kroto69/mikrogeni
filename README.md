# Mikrogeni

Backend API (Go) untuk manajemen CPE GenieACS, MikroTik, dan Hioso OLT + Frontend Dashboard (React).

> Dokumentasi endpoint detail: lihat [`API.md`](./API.md).

---

## Prasyarat

| Komponen | Versi minimum |
|---|---|
| Go | 1.21+ |
| Node.js | 18+ |
| npm | 9+ |
| Docker | Docker Compose v2+ |
| GCC / build-essential | Dibutuhkan CGO (SQLite) |

---

## Quick Start (Production)

### 1. Clone & Setup

```bash
git clone git@github.com:kroto69/mikrogeni.git
cd mikrogeni
cp .env.example .env
nano .env   # Edit JWT_SECRET, BOOTSTRAP_ADMIN_USERNAME/PASSWORD
```

### 2. Jalankan Backend (Docker)

```bash
docker compose up -d --build
```

Ini menjalankan:
- **mikrogeni-backend** — Go API server di port `1997` (network host)
- **mikrogeni-nginx** — Nginx reverse proxy + serve frontend static files

### 3. Build & Deploy Frontend

```bash
bash start.sh
```

Script ini:
1. `npm install` — install dependencies frontend
2. `npm run build` — build production bundle ke `frontend/dist/`
3. Restart container `mikrogeni-nginx` untuk serve file terbaru

### 4. Akses

```
http://<IP-SERVER>:8888
```

> Port dikonfigurasi di `nginx.conf` (`listen 8888`). Ubah sesuai kebutuhan.

### 5. Stop Frontend (Nginx)

```bash
bash stop.sh
```

Hanya stop nginx container. Backend tetap jalan.

### 6. Stop Semua

```bash
docker compose down
```

Tambah `-v` untuk hapus volume database (reset data):

```bash
docker compose down -v
```

---

## Development Mode

### Backend

```bash
go run ./cmd/server
```

Server backend: `http://localhost:1997`

### Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Frontend dev: `http://localhost:5173` — otomatis proxy `/api/*` ke backend `:1997`.

---

## Login Pertama (Bootstrap Admin)

Set di `.env` sebelum pertama kali start backend:

```bash
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_PASSWORD=<password-kuat-min-8-karakter>
```

User admin otomatis dibuat saat backend start dengan database kosong. Setelah itu, kelola user via Settings di dashboard.

> **Penting**: Jika database sudah ada (volume persist), bootstrap tidak akan overwrite. Untuk reset, hapus volume: `docker compose down -v && docker compose up -d --build`.

---

## Struktur Project

```
mikrogeni/
├── cmd/server/          # Entry point aplikasi
├── internal/
│   ├── handlers/        # HTTP handlers (ACS, MikroTik, Hioso OLT, Telegram, dll)
│   ├── services/        # Business logic (GenieACS, MikroTik)
│   ├── db/              # SQLite database layer
│   ├── models/          # Data models
│   └── acsresolver/     # ACS vendor/model registry & resolver
├── frontend/            # React + Vite + Tailwind dashboard
│   ├── src/
│   │   ├── pages/       # Halaman per fitur
│   │   ├── components/  # Komponen UI + layout reusable
│   │   ├── hooks/       # Custom hooks
│   │   └── lib/         # API client & utilitas
│   ├── .env.example
│   └── package.json
├── start.sh             # Build frontend + restart nginx
├── stop.sh              # Stop nginx container
├── docker-compose.yml   # Backend + Nginx containers
├── Dockerfile           # Backend Go build
├── nginx.conf           # Nginx config (serve frontend + proxy API)
├── Makefile
├── hioso_api.md         # Dokumentasi endpoint Hioso OLT
└── .env.example
```

---

## Scripts

| Script | Fungsi |
|---|---|
| `start.sh` | Build frontend production (`npm run build`) lalu restart nginx container agar serve file terbaru |
| `stop.sh` | Stop nginx container saja (backend tetap jalan) |

---

## Docker Compose Services

| Container | Image | Fungsi |
|---|---|---|
| `mikrogeni-backend` | Custom (Go) | API server, port 1997, network host |
| `mikrogeni-nginx` | nginx:1.27-alpine | Serve `frontend/dist` + proxy `/api/` ke backend, network host |

Volume:
- `backend_data` → `/data` di container backend (SQLite database)
- `./frontend/dist` → `/usr/share/nginx/html` di nginx (read-only mount)

---

## Environment Variables

### Backend (`.env`)

| Variabel | Default | Deskripsi |
|---|---|---|
| `PORT` | `1997` | Port server backend |
| `JWT_SECRET` | — | **Wajib** diisi |
| `JWT_EXPIRES_IN` | `1h` | Masa berlaku access token |
| `REFRESH_TOKEN_EXPIRES_IN` | `7d` | Masa berlaku refresh token |
| `BOOTSTRAP_ADMIN_USERNAME` | — | Admin user untuk first setup |
| `BOOTSTRAP_ADMIN_PASSWORD` | — | Admin password (min 8 karakter) |
| `GENIEACS_URL` | `http://localhost:7557/devices` | URL GenieACS API |
| `ACS_AUTO_REFRESH_ENABLED` | `false` | Auto refresh ACS device |
| `ACS_AUTO_REFRESH_INTERVAL` | `1h` | Interval refresh |
| `ACS_AUTO_REFRESH_BATCH_SIZE` | `50` | Batch size refresh |
| `TELEGRAM_BOT_ENABLED` | `false` | Aktifkan Telegram bot |
| `TELEGRAM_BOT_TOKEN` | — | Bot token Telegram |
| `TELEGRAM_CHAT_IDS` | — | Chat ID Telegram (comma-separated) |
| `HIOSO_ENABLED` | `true` | Aktifkan Hioso OLT plugin |

> GenieACS dan Billing bisa di-enable/disable via Settings dashboard (tanpa restart).

### Frontend (`frontend/.env`)

| Variabel | Default | Deskripsi |
|---|---|---|
| `VITE_API_BASE_URL` | `/api` | Base URL backend API |
| `VITE_DEV_PROXY_TARGET` | `http://localhost:1997` | Proxy target saat dev |
| `VITE_PLUGIN_API_BASE_URL` | `/plugin-api` | Base URL plugin API |
| `VITE_DEV_PLUGIN_PROXY_TARGET` | `http://localhost:3000` | Proxy target plugin saat dev |

---

## Fitur Dashboard

- **Operations Dashboard** — summary ONU, MikroTik, PPPoE, OLT
- **MikroTik** — manage devices, PPP secrets/profiles, kick sessions, interface monitoring
- **ACS/ONU** — GenieACS device list, reboot, WiFi/WAN/Security config
- **Hioso OLT** — manage OLT (HA7304VX + Legacy), ONU list per port, rename, reboot
- **ZTE OLT** — proxy ke zzte container, ONU monitoring per board/PON
- **Billing** — service plans, customers, invoices, payments (enable/disable via Settings)
- **Activity Logs** — history semua aksi user (reboot, rename, kick, edit, login, dll)
- **Settings** — user management, GenieACS config, enable/disable fitur, ZTE connections
- **Telegram Bot** — notifikasi dan query device via Telegram

---

## Endpoint Utama

### Auth

| Method | Endpoint | Deskripsi |
|---|---|---|
| `POST` | `/api/login` | Login, dapat access + refresh token |
| `POST` | `/api/refresh` | Refresh access token |
| `GET` | `/api/health` | Health check |

### ACS Devices

| Method | Endpoint | Deskripsi |
|---|---|---|
| `GET` | `/api/acs/devices` | List semua CPE |
| `GET` | `/api/acs/devices/:id` | Detail 1 CPE |
| `POST` | `/api/acs/devices/:id/reboot` | Reboot CPE |
| `GET` | `/api/acs/tasks/:id` | Status async task |

### MikroTik

| Method | Endpoint | Deskripsi |
|---|---|---|
| `GET` | `/api/mikrotik/devices` | List device MikroTik |
| `POST` | `/api/mikrotik/devices` | Tambah device |
| `PATCH` | `/api/mikrotik/devices/:id` | Update device |
| `DELETE` | `/api/mikrotik/devices/:id` | Hapus device |
| `GET` | `/api/mikrotik/devices/:id/ppp/secrets` | PPP secrets |
| `POST` | `/api/mikrotik/devices/:id/ppp/secrets` | Buat PPP secret |
| `GET` | `/api/mikrotik/devices/:id/ppp/active` | PPP active sessions |
| `DELETE` | `/api/mikrotik/devices/:id/ppp/active/:sid` | Kick session |

### Hioso OLT

| Method | Endpoint | Deskripsi |
|---|---|---|
| `GET` | `/api/hioso/devices` | List OLT yang tersimpan |
| `POST` | `/api/hioso/devices` | Tambah OLT (firmware_type: 0=HA7304VX, 1=Legacy) |
| `DELETE` | `/api/hioso/devices/{id}` | Hapus OLT |
| `GET` | `/api/hioso/devices/{id}/health` | System info OLT |
| `GET` | `/api/hioso/devices/{id}/onu?port=N` | List ONU per port |
| `POST` | `/api/hioso/devices/{id}/onu/rename?port=N&id=X` | Rename ONU |
| `POST` | `/api/hioso/devices/{id}/onu/reboot?port=N&id=X` | Reboot ONU |

### Activity Logs

| Method | Endpoint | Deskripsi |
|---|---|---|
| `GET` | `/api/activity-logs?limit=50&offset=0` | List activity logs (max 50 tersimpan) |

---

## Arsitektur Backend Hioso

Komunikasi ke OLT menggunakan **Web API** (HTTP), bukan SNMP. Support 2 firmware family:

| Firmware | Driver | Transport | OLT Model |
|---|---|---|---|
| `swcgi_xml` | `hioso_swcgi.go` | POST /sw.cgi (XML response) | HA7304VX |
| `legacy_html` | `hioso_legacy.go` | GET *.asp + Basic Auth | V2.x (GoAhead-Webs) |

> Dokumentasi endpoint detail: lihat [`hioso_api.md`](./hioso_api.md).

---

## Makefile Targets

```bash
make help     # Tampilkan semua target
make build    # Build binary
make run      # Build & run binary
make dev      # Run dalam mode dev (tanpa build)
make clean    # Hapus build artifacts
make deps     # Download & tidy dependencies
make fmt      # Format kode Go
```

---

## Telegram Bot (Opsional)

Set env:

```bash
TELEGRAM_BOT_ENABLED=true
TELEGRAM_BOT_TOKEN=<your_bot_token>
TELEGRAM_CHAT_IDS=123456789,987654321
```

Perintah:
- `/cari [acs|ppp] [keyword]` — list ringkas
- `/cek [acs|ppp] [keyword]` — detail 2 item per halaman
- `/next`, `/back`, `/refresh` — navigasi

---

## Notes

- `.env` dipakai untuk konfigurasi aplikasi, **bukan** untuk data per-device.
- Data MikroTik, Hioso OLT, dan ZTE connections disimpan di SQLite.
- GenieACS dan Billing bisa di-enable/disable runtime via Settings (tanpa restart backend).
- Activity logs otomatis menyimpan max 50 entries terbaru (auto-cleanup).
- Parameter registry ACS dibaca dari `internal/acsresolver/registry.yaml`.
- Hioso OLT plugin mendukung 2 firmware family dengan pilihan manual saat add device.
- Frontend branding/logo: `frontend/src/images/logo.png`.
