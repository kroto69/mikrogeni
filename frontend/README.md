# Frontend (React + Vite)

Frontend dashboard untuk GenieACS + MikroTik.

## Prasyarat

- Node.js 18+
- npm 9+

## Setup

```bash
cp .env.example .env
npm install
```

## Menjalankan aplikasi

```bash
npm run dev
```

Default dev server: `http://localhost:5173`

## Quality Gates

```bash
npm run lint
npm run test
npm run typecheck
npm run build
```

> Saat ini `lint` dan `test` menggunakan typecheck sebagai gate minimal agar perubahan gagal lebih cepat saat ada error tipe.

## Environment Variables

Gunakan file `frontend/.env.example` sebagai acuan. Variabel penting:

- `VITE_API_BASE_URL`: base URL backend API utama (default biasanya `/api` via reverse proxy).
- `VITE_PLUGIN_API_BASE_URL`: base URL plugin backend (default `/plugin-api`).

## Struktur Singkat

- `src/pages/` → halaman per fitur
- `src/components/` → komponen UI + layout reusable
- `src/hooks/` → custom hooks (auth/theme/async task)
- `src/lib/` → API client, utilitas, query client
