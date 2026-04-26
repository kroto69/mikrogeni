# Mikrogeni

Backend API (Go) untuk manajemen CPE GenieACS + modul MikroTik + Frontend Dashboard (React).

> Dokumentasi endpoint detail: lihat [`API.md`](./API.md).

---

## Prasyarat

| Komponen | Versi minimum |
|---|---|
| Go | 1.21+ |
| Node.js | 18+ |
| npm | 9+ |
| Docker (opsional) | Docker Compose v2+ |
| GCC / build-essential | Dibutuhkan CGO (SQLite) |

---

## Cara Clone & Run

### 1. Clone repository

```bash
git clone git@github.com:kroto69/mikrogeni.git
cd mikrogeni
```

### 2. Setup environment

```bash
# Copy file .env untuk backend
cp .env.example .env

# Edit JWT_SECRET — WAJIB diisi sebelum jalan
# Edit variabel lain sesuai kebutuhan
nano .env   # atau gunakan editor apapun
```

### 3. Jalankan Backend (Go)

```bash
# Download dependencies
go mod download

# Jalankan dalam mode development
go run ./cmd/server

# ATAU build lalu run
make build
make run
```

Server backend default: `http://localhost:1997`

### 4. Jalankan Frontend (React + Vite)

```bash
cd frontend

# Copy file .env untuk frontend
cp .env.example .env

# Install dependencies
npm install

# Jalankan dev server
npm run dev
```

Frontend default: `http://localhost:5173` — otomatis proxy ke backend `:1997`.

### 5. Login pertama (Bootstrap Admin)

Sebelum jalan server, set di file `.env`:

```bash
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_PASSWORD=<password-kuat-min-8-karakter>
```

Lalu login via frontend, atau via curl:

```bash
TOKEN=$(curl -s -X POST "http://localhost:1997/api/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"<bootstrap_username>","password":"<bootstrap_password>"}' | jq -r '.access_token')
```

---

## Menjalankan dengan Docker

```bash
# Build & jalankan semua (backend + nginx)
docker compose up -d --build
```

Flow default:
- Nginx expose port `80`
- Request `http://<host>/api/...` diteruskan ke backend Go di container `backend:1997`
- File SQLite disimpan di volume `backend_data`

Cek health:

```bash
curl http://localhost/api/health
```

> **Catatan**: Docker setup saat ini hanya menjalankan backend + nginx reverse proxy. Untuk menjalankan frontend di Docker, perlu ditambahkan service terpisah di `docker-compose.yml`.

---

## Struktur Project

```
mikrogeni/
├── cmd/server/          # Entry point aplikasi
├── internal/
│   ├── handlers/        # HTTP handlers (ACS, MikroTik, Telegram, dll)
│   ├── services/        # Business logic (GenieACS, MikroTik, SNMP)
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
├── docker-compose.yml
├── Dockerfile
├── nginx.conf
├── Makefile
└── .env.example
```

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
| `OLT_HOST` | — | IP OLT |
| `OLT_COMMUNITY` | `public` | SNMP community string |
| `OLT_WEB_USER` | `admin` | Web UI user OLT |
| `OLT_WEB_PASS` | `admin` | Web UI password OLT |

### Frontend (`frontend/.env`)

| Variabel | Default | Deskripsi |
|---|---|---|
| `VITE_API_BASE_URL` | `/api` | Base URL backend API |
| `VITE_DEV_PROXY_TARGET` | `http://localhost:1997` | Proxy target saat dev |
| `VITE_PLUGIN_API_BASE_URL` | `/plugin-api` | Base URL plugin API |
| `VITE_DEV_PLUGIN_PROXY_TARGET` | `http://localhost:3000` | Proxy target plugin saat dev |

---

## Endpoint Utama

### ACS Devices

| Method | Endpoint | Deskripsi |
|---|---|---|
| `GET` | `/api/acs/devices` | List semua CPE |
| `GET` | `/api/acs/devices/:id` | Detail 1 CPE |
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

### Auth

| Method | Endpoint | Deskripsi |
|---|---|---|
| `POST` | `/api/login` | Login, dapat access + refresh token |
| `POST` | `/api/refresh` | Refresh access token |
| `GET` | `/api/health` | Health check |

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

- `.env` dipakai untuk konfigurasi aplikasi, **bukan** untuk data per-device MikroTik.
- Data MikroTik per-device disimpan di SQLite dan dikelola via `/api/mikrotik/*`.
- Jika behavior endpoint berubah, update `API.md` agar integrasi tetap sinkron.
- Parameter registry ACS dibaca dari `internal/acsresolver/registry.yaml` — tambah vendor/model baru dari registry, bukan hardcode.
- Auto-learn ACS menyimpan hasil resolve ke SQLite (`acs_learned_profiles`) untuk caching.