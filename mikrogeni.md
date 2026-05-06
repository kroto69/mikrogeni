# Mikrogeni - Project Structure Analysis

## 1. Arsitektur Umum

- **Monorepo** (bukan workspace): Go backend + React frontend dalam satu repo
- **Backend**: Go 1.21+ -> `cmd/server/` entry point, `internal/` (handlers, services, db, models, acsresolver)
- **Frontend**: React 18 + Vite + TypeScript -> `frontend/` subdirectory
- **Database**: SQLite (`database.sqlite`)
- **Deployment**: Docker + nginx reverse proxy

---

## 2. Daftar File .tsx (24 file)

```
frontend/src/App.tsx                                    # Router utama
frontend/src/main.tsx                                   # Entry point React
frontend/src/pages/Dashboard.tsx                        # Halaman dashboard
frontend/src/pages/Login.tsx                            # Halaman login
frontend/src/pages/Settings.tsx                         # Halaman settings
frontend/src/pages/ONU/index.tsx                        # List ONU/ACS devices
frontend/src/pages/ONU/Detail.tsx                       # Detail ONU/ACS device
frontend/src/pages/Mikrotik/index.tsx                   # List MikroTik devices
frontend/src/pages/Mikrotik/Detail.tsx                  # Detail MikroTik device
frontend/src/pages/Billing/index.tsx                    # Halaman billing
frontend/src/pages/Plugin/OltHioso.tsx                  # Plugin Hioso OLT
frontend/src/components/layout/Sidebar.tsx              # Sidebar navigasi
frontend/src/components/layout/Topbar.tsx               # Top bar header
frontend/src/components/layout/MainLayout.tsx           # Layout utama (sidebar + topbar + outlet)
frontend/src/components/page/section-header.tsx         # Section header reusable
frontend/src/components/ui/button.tsx                   # Button component
frontend/src/components/ui/input.tsx                    # Input component
frontend/src/components/ui/card.tsx                     # Card component (Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter)
frontend/src/components/ui/badge.tsx                    # Badge component
frontend/src/components/ui/avatar.tsx                   # Avatar component
frontend/src/components/ui/separator.tsx                # Separator component
frontend/src/components/ui/toast.tsx                    # Toast notification (ToastViewport)
frontend/src/hooks/useAuth.tsx                          # Auth context + hook (login, logout, isAuthenticated)
frontend/src/hooks/useTheme.tsx                         # Theme context + hook (light/dark, brutalStyle toggle)
```

---

## 3. Router Utama (App.tsx)

**Library**: `react-router-dom` v6

**Struktur routing**:
- `<BrowserRouter>` -> `<AuthProvider>` -> `<AppRoutes>`
- `AuthBoundary` component: guard untuk authenticated/guest-only routes
- **Guest route**: `/login` (guestOnly = true)
- **Protected routes** (di bawah `/` dengan `MainLayout`):
  - `/dashboard` -> `Dashboard`
  - `/onu` -> `OnuIndex`, `/onu/:id` -> `OnuDetail`
  - `/mikrotik` -> `MikrotikIndex`, `/mikrotik/:deviceId` -> `MikrotikDetail`
  - `/billing` -> `BillingIndex`
  - `/hioso` -> `OltHiosoPage`
  - `/settings` -> `Settings`
- `*` -> redirect ke `/dashboard`
- **Semua page di-lazy load** via `React.lazy()`

**Entry point** (main.tsx): `QueryClientProvider` -> `ThemeProvider` -> `App` -> `ToastViewport`

---

## 4. Contoh Halaman: Dashboard.tsx

Pattern yang dipakai:
- `useQuery` + `useQueries` dari `@tanstack/react-query` untuk data fetching
- Import API functions dari `@/lib/api` (bukan langsung axios)
- UI: `Card`, `CardContent`, `Badge` dari `@/components/ui/`
- `cn()` dari `@/lib/utils` untuk className merge
- Icons dari `lucide-react`
- Styling: Tailwind dengan brutal design system (`neo-panel`, `shadow-brutal`, `border-2`, `font-extrabold uppercase tracking-[]`)
- Error handling: `getApiErrorMessage()` dari `@/lib/api`
- Loading states: inline conditional rendering

---

## 5. Sidebar / Nav

**File**: `frontend/src/components/layout/Sidebar.tsx`

- Navigasi items hardcoded dalam array `navigation`:
  - Dashboard (`/dashboard`), Mikrotik (`/mikrotik`), Billing (`/billing`), Acs/ONU Device (`/onu`), Hioso (`/hioso`)
- Settings dipisah di bawah (`/settings`)
- Menggunakan `NavLink` dari react-router-dom dengan `isActive` styling
- **Brutal design**: `neo-panel`, `neo-interactive`, `shadow-brutal`, `border-2`, uppercase text
- Brand section: "MIKROGENI v4.1"
- Health indicator widget di bawah sidebar
- Responsive: desktop fixed sidebar (xl+), mobile drawer

**Topbar** (`Topbar.tsx`):
- Breadcrumb dari URL path segments
- Page title dari route
- Toggle brutal style button
- Notification bell, username badge, avatar, logout button

**MainLayout** (`MainLayout.tsx`):
- Sidebar (fixed desktop, drawer mobile) + Topbar + `<Outlet />`
- Escape key closes sidebar on mobile
- Body overflow lock saat sidebar open

---

## 6. Custom Hooks

### useAuth.tsx
- Context-based auth provider
- State: `user`, `accessToken`, `isAuthenticated`, `isLoading`
- Methods: `login(credentials)`, `logout()`
- Session disimpan di localStorage (`network-core.auth`)
- Cross-tab sync via `CustomEvent` + `storage` event
- Login -> navigate to `/dashboard`, Logout -> navigate to `/login`

### useTheme.tsx
- Context-based theme provider
- Theme: saat ini hardcoded `light` saja (dark mode disabled)
- `brutalStyle`: `"rapi-brutal"` | `"lebih-ekstrim"` (toggle)
- Stored in localStorage
- Applied via `document.documentElement.dataset.styleMode`

### useAsyncTask.ts
- Polling-based async task tracking
- Dual mode: **polling mode** (monitor existing task) atau **trigger mode** (fire action + poll result)
- Auto-polling dengan interval 2-3 detik, stops saat status `success`/`failed`
- Toast notifications on queued/success/failed
- Returns: `trigger()`, `taskId`, `task`, `isPending`, `isSuccess`, `isError`, `errorMessage`, `reset()`
- Path derivation: `/mikrotik/*` -> `/mikrotik/tasks`, lainnya -> `/acs/tasks`

---

## 7. API Fetching Method

**Library utama**: **Axios** (`axios` v1.9.0) + **TanStack React Query** (`@tanstack/react-query` v5.76.1)

### Two Axios instances:
1. **`api`** (`frontend/src/lib/api.ts`): base URL = `/api`, auth header auto-attach, 401 auto-logout
2. **`pluginApi`** (`frontend/src/lib/pluginApi.ts`): base URL = `/plugin-api`, plugin auth header auto-attach

### Pattern:
- Semua API call dibungkus dalam **named async functions** di `lib/api.ts` dan `lib/pluginApi.ts`
- Pages memanggil functions tersebut via `useQuery`/`useMutation` dari TanStack React Query
- **Tidak ada langsung `fetch()`** -- semua via axios instance
- Error handling: `getApiErrorMessage()` / `getPluginApiErrorMessage()`
- Auth: Bearer token dari localStorage, auto-attach via axios interceptor
- 401 response -> auto clear session + redirect to `/login`

### QueryClient config:
- `refetchOnWindowFocus: false`
- `staleTime: 30_000` (30 detik)
- `retry: max 2, skip on 401`
- Mutation retry: 0

### API envelope unwrapping:
- Backend response kadang `{ success, data }` kadang langsung data
- `unwrapApiEnvelope()` / `unwrapData()` menangani kedua format

---

## 8. Komponen UI yang Ada vs Tidak Ada

### ADA
| Komponen | File | Detail |
|---|---|---|
| **Button** | `components/ui/button.tsx` | CVA variants: default, secondary, outline, ghost, destructive. Sizes: default, sm, lg, icon. Brutal hover/active transforms. |
| **Badge** | `components/ui/badge.tsx` | CVA variants: default, success, warning, destructive, secondary. Uppercase tracking. |
| **Card** | `components/ui/card.tsx` | Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter. Brutal border/shadow. |
| **Input** | `components/ui/input.tsx` | Brutal focus transform. |
| **Avatar** | `components/ui/avatar.tsx` | Simple fallback avatar. |
| **Separator** | `components/ui/separator.tsx` | -- |
| **Toast** | `components/ui/toast.tsx` | Event-driven toast viewport. Variants: default, success, error. |

### TIDAK ADA
| Komponen | Status |
|---|---|
| **Modal/Dialog** | Belum ada |
| **Dropdown Menu** | Belum ada |
| **Skeleton** | Belum ada |
| **Select/Combobox** | Belum ada |
| **Table** | Belum ada |
| **Tabs** | Belum ada |
| **Sheet/Drawer** | Belum ada |
| **Tooltip** | Belum ada |
| **Switch/Toggle** | Belum ada |
| **Textarea** | Belum ada |
| **Popover** | Belum ada |
| **Command** | Belum ada |

---

## 9. Tailwind Config

**File**: `frontend/tailwind.config.ts`

### Colors (CSS variable-based, HSL):
- `border`, `input`, `ring`, `background`, `foreground`
- `primary` / `primary-foreground`
- `secondary` / `secondary-foreground`
- `muted` / `muted-foreground`
- `accent` / `accent-foreground`
- `card` / `card-foreground`
- `destructive` / `destructive-foreground`
- **`success` / `success-foreground`** (custom, untuk status online/OK)
- **`warning` / `warning-foreground`** (custom, untuk peringatan)

### Border Radius:
- Menggunakan CSS variable `--radius` sebagai base
- `sm`, `md`, `lg`, `xl`, `2xl` derived dari base

### Box Shadow (Brutal Design):
- `brutal`: `4px 4px 0 0 hsl(var(--border))`
- `brutal-sm`: `2px 2px 0 0 hsl(var(--border))`
- `brutal-lg`: `8px 8px 0 0 hsl(var(--border))`
- `panel`: same as brutal

### Font:
- `display`: `var(--font-display)` -- untuk heading
- `body`: `var(--font-body)` -- untuk body text

### Background:
- `grid-soft`: subtle grid pattern via linear-gradient

### Dark Mode:
- Config: `darkMode: ["class"]` -- tapi saat ini **disabled** (hardcoded light in useTheme)

---

## 10. Dependencies

### Production (dependencies):
| Package | Versi | Fungsi |
|---|---|---|
| `@tanstack/react-query` | ^5.76.1 | Server state management / data fetching |
| `axios` | ^1.9.0 | HTTP client |
| `class-variance-authority` | ^0.7.1 | Variant-based component styling (CVA) |
| `clsx` | ^2.1.1 | Conditional className |
| `lucide-react` | ^0.511.0 | Icon library |
| `react` | ^18.3.1 | UI framework |
| `react-dom` | ^18.3.1 | React DOM renderer |
| `react-router-dom` | ^6.30.0 | Client-side routing |
| `tailwind-merge` | ^3.3.0 | Tailwind class merge (via cn()) |

### Dev (devDependencies):
| Package | Versi | Fungsi |
|---|---|---|
| `@eslint/js` | ^10.0.1 | ESLint config |
| `@types/node` | ^22.15.29 | Node types |
| `@types/react` | ^18.3.12 | React types |
| `@types/react-dom` | ^18.3.1 | React DOM types |
| `@vitejs/plugin-react` | ^4.4.1 | Vite React plugin |
| `autoprefixer` | ^10.4.21 | PostCSS autoprefixer |
| `eslint` | ^10.2.1 | Linter |
| `eslint-config-prettier` | ^10.1.8 | Prettier compatibility |
| `eslint-plugin-react-hooks` | ^7.1.1 | Hooks lint rules |
| `eslint-plugin-react-refresh` | ^0.5.2 | Refresh lint rules |
| `playwright` | ^1.58.2 | E2E testing |
| `postcss` | ^8.5.3 | CSS processing |
| `prettier` | ^3.8.3 | Code formatter |
| `tailwindcss` | ^3.4.17 | CSS framework |
| `typescript` | ^5.8.3 | Type checker |
| `typescript-eslint` | ^8.59.0 | TS ESLint |
| `vite` | ^5.4.19 | Build tool |

---

## 11. Struktur Directory Lengkap

```
frontend/src/
├── App.tsx                          # Router (BrowserRouter + AuthBoundary + lazy routes)
├── main.tsx                         # Entry point (QueryClientProvider + ThemeProvider)
├── index.css                        # Global CSS (Tailwind + custom)
├── vite-env.d.ts                    # Vite env types
│
├── components/
│   ├── layout/
│   │   ├── MainLayout.tsx           # Shell: sidebar + topbar + <Outlet />
│   │   ├── Sidebar.tsx              # Navigation sidebar
│   │   └── Topbar.tsx              # Header bar (breadcrumb + actions)
│   ├── page/
│   │   └── section-header.tsx       # Reusable section header
│   └── ui/
│       ├── avatar.tsx               # Avatar
│       ├── badge.tsx                # Badge (CVA variants)
│       ├── button.tsx               # Button (CVA variants)
│       ├── card.tsx                 # Card + subcomponents
│       ├── input.tsx                # Input
│       ├── separator.tsx            # Separator
│       └── toast.tsx                # Toast notification viewport
│
├── hooks/
│   ├── useAsyncTask.ts              # Async task polling hook
│   ├── useAuth.tsx                  # Auth context + hook
│   └── useTheme.tsx                 # Theme context + hook
│
├── lib/
│   ├── api.ts                       # Main API client (axios + typed functions)
│   ├── pluginApi.ts                 # Plugin API client (separate axios instance)
│   ├── queryClient.ts               # React Query client config
│   ├── toast.ts                     # Toast event system
│   └── utils.ts                     # cn() utility (clsx + tailwind-merge)
│
├── pages/
│   ├── Dashboard.tsx                # Dashboard overview
│   ├── Login.tsx                    # Login page
│   ├── Settings.tsx                 # Settings page
│   ├── Billing/
│   │   └── index.tsx                # Billing page
│   ├── Mikrotik/
│   │   ├── index.tsx                # MikroTik device list
│   │   └── Detail.tsx               # MikroTik device detail
│   ├── ONU/
│   │   ├── index.tsx                # ONU/ACS device list
│   │   └── Detail.tsx               # ONU/ACS device detail
│   └── Plugin/
│       └── OltHioso.tsx             # Hioso OLT plugin page
│
└── types/
    ├── billing.ts                   # Billing types
    ├── mikrotik.ts                  # MikroTik types
    ├── onu.ts                       # ONU/ACS types
    └── plugin-olt.ts                # Plugin OLT types
```

---

## 12. Design System Notes

- **Brutal/Neo-Brutalism style** -- bold borders, offset shadows, uppercase text, hover transforms
- Custom utility classes: `neo-panel`, `neo-interactive`, `neo-shell`, `shadow-brutal`, `shadow-brutal-sm`, `shadow-brutal-lg`
- Component variant system via **CVA** (`class-variance-authority`)
- Class merge via **cn()** = `clsx` + `tailwind-merge`
- Responsive breakpoints: mobile-first, sidebar switches at `xl` (1280px)
- Two style modes: "Rapi Brutal" (clean brutal) vs "Lebih Ekstrim" (more extreme) -- toggled via Topbar button
- Color semantic tokens: success (green), warning (amber), destructive (red) -- via CSS custom properties
- Font: display (headings) + body -- loaded via CSS custom properties

---

## 13. Backend API Summary

Base URL: `/api` (proxied to Go backend port 1997)

### Auth
- `POST /login` -> access + refresh token
- `POST /refresh` -> refresh access token

### ACS / ONU
- `GET /acs/devices` -> list ringkas
- `GET /acs/devices/:id` -> detail lengkap (auto-refresh background)
- `POST /acs/devices/:id/reboot` -> async reboot
- `POST /acs/devices/:id/config/wifi` -> async WiFi config
- `POST /acs/devices/:id/config/wan` -> async WAN config
- `POST /acs/devices/refresh` -> bulk refresh
- `GET /acs/tasks/:id` -> poll async task status

### MikroTik
- CRUD `/mikrotik/devices` + test-connection + sync
- PPP: active, secrets, profiles (CRUD)
- Interfaces + traffic monitoring
- Async tasks via `/mikrotik/tasks/:id`

### Hioso OLT Plugin
- Plugin enable/disable + health check
- ONU list, detail, rename, reboot
- OLT device CRUD via settings
- Port listing

### Billing
- Service plans, customers, invoices, payments
- Recurring + overdue job triggers

### Settings / Admin
- Settings key-value CRUD
- User management (admin/teknisi roles)
- ACS learned profiles
- Hioso OLT profiles (CRUD + activate)

---

## 14. Key Patterns untuk Implementasi Baru

1. **Buat page baru**: buat file di `src/pages/`, lazy import di `App.tsx`, tambah route, tambah nav item di `Sidebar.tsx`
2. **API function**: tambah typed async function di `src/lib/api.ts`, import di page
3. **Data fetching**: gunakan `useQuery` untuk read, `useMutation` untuk write
4. **Async action**: gunakan `useAsyncTask` hook (auto-polling + toast)
5. **UI component**: ikuti pattern CVA + `cn()` + brutal styling (`neo-panel`, `shadow-brutal`, `border-2`)
6. **Types**: definisikan di `src/types/`
7. **Toast**: gunakan `showToast()` dari `@/lib/toast`
8. **Error display**: gunakan `getApiErrorMessage()` dari `@/lib/api`
