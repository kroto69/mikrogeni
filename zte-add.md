# TASK: Tambah Plugin ZTE OLT ke Mikrogeni NMS Dashboard

## Konteks Project
- Monorepo: Go backend (port 1997) + React frontend (Vite)
- Frontend: frontend/src/
- Backend existing: internal/handlers/, internal/services/, internal/db/
- ZTE service (zzte): container terpisah, URL disimpan di DB Mikrogeni
- Frontend TIDAK boleh langsung hit zzte — semua lewat Go backend Mikrogeni
- Komentar kode: Bahasa Indonesia
- Design system: Neo-Brutalism (neo-panel, shadow-brutal, border-2, uppercase)

## Baca Dulu Sebelum Mulai
1. Baca frontend/src/lib/api.ts — pahami pola axios instance dan fungsi API
2. Baca frontend/src/lib/pluginApi.ts — ini referensi untuk zteApi.ts
3. Baca frontend/src/pages/Plugin/OltHioso.tsx — ini referensi paling mirip
4. Baca frontend/src/components/layout/Sidebar.tsx — untuk tambah menu ZTE
5. Baca frontend/src/App.tsx — untuk tambah route
6. Baca frontend/src/types/plugin-olt.ts — referensi struktur types
7. Baca internal/ dan cari handler Hioso sebagai referensi pola Go handler

---

## BAGIAN A: GO BACKEND

### A1. Tabel SQLite — ZTE Connections
Tambahkan di file migration/init DB yang sudah ada (cari pola yang dipakai):

```sql
CREATE TABLE IF NOT EXISTS zte_connections (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  base_url    TEXT NOT NULL,
  is_active   INTEGER DEFAULT 1,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### A2. Model Go
File baru: internal/models/zte.go

```go
type ZTEConnection struct {
    ID        string    `json:"id" db:"id"`
    Name      string    `json:"name" db:"name"`
    BaseURL   string    `json:"base_url" db:"base_url"`
    IsActive  bool      `json:"is_active" db:"is_active"`
    CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// Request body untuk tambah/edit
type ZTEConnectionRequest struct {
    ID      string `json:"id"`
    Name    string `json:"name"`
    BaseURL string `json:"base_url"` // sudah include port: http://10.5.0.10:8081
}
```

### A3. Handler: ZTE Config Management
File baru: internal/handlers/zte_config.go

Endpoint (ikuti pola handler existing):
GET    /api/zte/connections           → list semua koneksi dari DB
POST   /api/zte/connections           → tambah koneksi baru
DELETE /api/zte/connections/:id       → hapus koneksi
POST   /api/zte/connections/:id/health → test koneksi:
- HTTP GET ke {base_url}/health
- timeout: 5 detik
- return: { success, data: { status, latency_ms } }

### A4. Handler: ZTE Proxy
File baru: internal/handlers/zte_proxy.go

Baca base_url dari DB by id, forward request ke zzte.
Semua prefix: /api/zte/proxy/:connId/...
Timeout per request: 15 detik.
Copy response body langsung ke ResponseWriter.
Kalau connId tidak ada di DB → 404.

Proxy routes:
GET  /api/zte/proxy/:connId/system
→ {base_url}/api/v1/system/olt/:connId
GET  /api/zte/proxy/:connId/board/:board/pon
→ {base_url}/api/v1/olt/:connId/board/:board/pon
GET  /api/zte/proxy/:connId/board/:board/pon/:pon
→ {base_url}/api/v1/olt/:connId/board/:board/pon/:pon
→ teruskan query string ?fresh=true kalau ada
GET  /api/zte/proxy/:connId/board/:board/pon/:pon/onu/:onuId
→ {base_url}/api/v1/olt/:connId/board/:board/pon/:pon/onu/:onuId
→ teruskan query string ?fresh=true
POST /api/zte/proxy/:connId/reboot
→ {base_url}/api/v1/onu/reboot (forward body)
GET  /api/zte/proxy/:connId/search
→ {base_url}/api/v1/search (teruskan ?q=)

### A5. Register Routes
Tambahkan di file router/main Go yang ada (cari pola registrasi route existing):
```go
// ZTE Plugin routes (protected, ikuti middleware auth existing)
zte := api.Group("/zte")
zte.GET("/connections", zteConfigHandler.List)
zte.POST("/connections", zteConfigHandler.Create)
zte.DELETE("/connections/:id", zteConfigHandler.Delete)
zte.POST("/connections/:id/health", zteConfigHandler.Health)
zte.Any("/proxy/:connId/*path", zteProxyHandler.Forward)
```

---

## BAGIAN B: FRONTEND

### B1. Types
File baru: frontend/src/types/zte.ts

```ts
export type ZTEConnection = {
  id: string
  name: string
  base_url: string
  is_active: boolean
  created_at: string
}

export type ZTESystemInfo = {
  oltId: string
  name: string
  host: string
  uptime: string
  cpuUsage: number
  memoryUsage: number
  isOnline: boolean
}

export type ZTEPONInfo = {
  board: number
  pon: number
  description: string
}

export type ZTEONUListItem = {
  oltId: string
  board: number
  pon: number
  onuId: number
  name: string
  serialNumber: string
  status: string
  statusCode: number
  rxPower: number
}

export type ZTEONUDetail = {
  oltId: string
  board: number
  pon: number
  onuId: number
  name: string
  serialNumber: string
  type: string
  status: string
  statusCode: number
  rxPower: number
  txPower: number
  lastOnline: string
  lastOffline: string
  offlineReason: string
  wanIp: string
}
```

### B2. API Functions
File baru: frontend/src/lib/zteApi.ts

Gunakan instance `api` dari @/lib/api (base URL /api, auth auto-attach).
Ikuti PERSIS pola yang ada di api.ts dan pluginApi.ts.

```ts
import { api, unwrapApiEnvelope, getApiErrorMessage } from '@/lib/api'
import type { ZTEConnection, ZTESystemInfo, ZTEPONInfo, ZTEONUListItem, ZTEONUDetail } from '@/types/zte'

// Connection management
export async function getZTEConnections(): Promise<ZTEConnection[]>
export async function addZTEConnection(data: { id: string; name: string; base_url: string }): Promise<ZTEConnection>
export async function deleteZTEConnection(id: string): Promise<void>
export async function healthCheckZTE(id: string): Promise<{ status: string; latency_ms: number }>

// Proxy — semua lewat /api/zte/proxy/:connId/
export async function getZTESystemInfo(connId: string): Promise<ZTESystemInfo>
export async function getZTEPONList(connId: string, board: number): Promise<ZTEPONInfo[]>
export async function getZTEONUList(connId: string, board: number, pon: number, fresh?: boolean): Promise<ZTEONUListItem[]>
export async function getZTEONUDetail(connId: string, board: number, pon: number, onuId: number, fresh?: boolean): Promise<ZTEONUDetail>
export async function rebootZTEONU(connId: string, board: number, pon: number, onuId: number): Promise<{ success: boolean; message: string }>
export async function searchZTEONU(connId: string, q: string): Promise<ZTEONUListItem[]>
```

### B3. Komponen UI Baru yang Dibutuhkan
Karena Modal, Select, Skeleton, Table belum ada — buat minimal di dalam folder zte:

File: frontend/src/pages/ZTE/_components/ZTEModal.tsx
- Overlay fullscreen + centered box
- Props: { isOpen, onClose, title, children }
- Close on overlay click + ESC key
- Ikuti brutal style: border-2, shadow-brutal, neo-panel

File: frontend/src/pages/ZTE/_components/ZTESelect.tsx
- Native HTML <select> dengan brutal styling
- Props: { value, onChange, options: {value, label}[], placeholder, disabled }
- Ikuti styling Input existing

File: frontend/src/pages/ZTE/_components/ZTESkeleton.tsx
- Animated pulse rows untuk tabel
- Props: { rows: number }
- Gunakan bg-muted animate-pulse

### B4. Halaman ZTE Settings Section
File baru: frontend/src/pages/ZTE/ZTESettings.tsx

Ini halaman TERPISAH, bukan modifikasi Settings.tsx existing.
Route: /settings/zte

Layout menggunakan MainLayout (via routing, sudah auto).

Section: "ZTE OLT Connections"
Gunakan Card, CardHeader, CardContent dari @/components/ui/card

#### Form Tambah Koneksi:
Label "TAMBAH KONEKSI ZTE OLT"  ← uppercase brutal style
Connection ID*  : <Input placeholder="olt_kudus_01" />
Display Name*   : <Input placeholder="OLT Kudus 1" />
Host / IP*      : <Input placeholder="10.5.0.10" />
Port            : <Input placeholder="8081" type="number" />
[Test Connection]  [Simpan]

State lokal: id, name, host, port(8081), testResult(null|{ok,latency}|'error')

Test Connection:
- Gabungkan host+port → base_url: `http://${host}:${port}`
- Hit healthCheckZTE dengan body {id, name, base_url} (belum save ke DB)
- Sukses → badge success "Online · {latency}ms"
- Gagal → badge destructive "Gagal terhubung"

Simpan:
- useMutation → addZTEConnection({id, name, base_url: `http://${host}:${port}`})
- Sukses → showToast success + invalidate query connections + reset form

#### List Koneksi Tersimpan:
- useQuery(['zte-connections'], getZTEConnections)
- Saat load: health check semua paralel (Promise.all) → simpan hasil di state Map<id, boolean>

Empty state (belum ada koneksi):
<div class="neo-panel border-2 p-8 text-center">
  <Server icon dari lucide-react size 48 class="mx-auto mb-4 text-muted-foreground" />
  <p class="font-bold uppercase">BELUM ADA OLT ZTE TERDAFTAR</p>
  <p class="text-muted-foreground text-sm mt-1">
    Tambahkan koneksi OLT ZTE menggunakan form di atas
  </p>
</div>
````
List item per koneksi (Card atau row brutal):
[Nama OLT]  [URL]  [Badge: Online/Offline]  [Button Delete destructive]
Delete: useMutation → deleteZTEConnection → showToast + invalidate
B5. Halaman ONU List
File baru: frontend/src/pages/ZTE/ONUListPage.tsx
State:
tsconst { connId } = useParams<{ connId: string }>()
const [board, setBoard] = useState(1)
const [pon, setPon] = useState<number | null>(null)
const [hasLoaded, setHasLoaded] = useState(false)
const [autoRefresh, setAutoRefresh] = useState(false)
const [searchQuery, setSearchQuery] = useState('')
const [detailONU, setDetailONU] = useState<ZTEONUListItem | null>(null)
const [tick, setTick] = useState(0) // untuk auto refresh
Data fetching (TanStack Query):
ts// System info — staleTime 30 detik
const { data: systemInfo } = useQuery({
  queryKey: ['zte-system', connId],
  queryFn: () => getZTESystemInfo(connId!),
  refetchInterval: 30_000,
  enabled: !!connId
})

// Connections list — untuk cek nama OLT
const { data: connections } = useQuery({
  queryKey: ['zte-connections'],
  queryFn: getZTEConnections,
  staleTime: 60_000
})
const connName = connections?.find(c => c.id === connId)?.name ?? connId

// PON list — refetch saat board berubah
const { data: ponList } = useQuery({
  queryKey: ['zte-pon-list', connId, board],
  queryFn: () => getZTEPONList(connId!, board),
  enabled: !!connId
})

// ONU list — hanya kalau hasLoaded = true
const { data: onuList, isLoading, isError, refetch } = useQuery({
  queryKey: ['zte-onu-list', connId, board, pon, tick],
  queryFn: () => getZTEONUList(connId!, board, pon!),
  enabled: hasLoaded && !!pon,
  staleTime: 55_000,
  refetchInterval: autoRefresh ? 60_000 : false
})
Filter data:
tsconst filtered = (onuList ?? []).filter(d =>
  d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
  d.serialNumber.toLowerCase().includes(searchQuery.toLowerCase())
)
Stats (hitung dari onuList):
tsconst stats = {
  total: onuList?.length ?? 0,
  online: onuList?.filter(d => d.statusCode === 3).length ?? 0,
  los: onuList?.filter(d => d.statusCode === 4).length ?? 0,
  offline: onuList?.filter(d => d.statusCode !== 3 && d.statusCode !== 4).length ?? 0
}
Layout JSX:
tsx<div class="flex flex-col gap-4 p-4">

  {/* Header Bar */}
  <ZTEHeaderBar
    title={hasLoaded && pon
      ? `Board ${board} / PON ${pon} — ${connName}`
      : `${connName} — ZTE OLT Monitor`}
    systemInfo={systemInfo}
    autoRefresh={autoRefresh}
    onAutoRefreshToggle={() => setAutoRefresh(p => !p)}
  />

  {/* Stats Cards — hanya tampil kalau sudah load */}
  {hasLoaded && onuList && <ZTEStatsCards stats={stats} />}

  {/* Toolbar */}
  <ZTEToolbar
    board={board}
    pon={pon}
    ponList={ponList ?? []}
    loading={isLoading}
    autoRefresh={autoRefresh}
    searchQuery={searchQuery}
    onBoardChange={b => { setBoard(b); setPon(null); setHasLoaded(false) }}
    onPonChange={setPon}
    onLoad={() => { if (pon) setHasLoaded(true) }}
    onRefresh={() => refetch()}
    onSearchChange={setSearchQuery}
  />

  {/* Area konten kondisional */}
  {!hasLoaded && (
    <EmptyState
      icon="pon"
      title="PILIH BOARD DAN PON"
      description="Pilih board dan nomor PON, lalu klik Load untuk melihat data ONU"
    />
  )}
  {hasLoaded && isLoading && <ZTESkeleton rows={8} />}
  {hasLoaded && isError && (
    <EmptyState
      icon="error"
      title="GAGAL MENGAMBIL DATA"
      description="Tidak dapat terhubung ke OLT. Periksa koneksi di Settings."
      actionLabel="Ke Settings ZTE"
      actionHref="/settings/zte"
    />
  )}
  {hasLoaded && !isLoading && !isError && filtered.length === 0 && (
    <EmptyState
      icon="empty"
      title="TIDAK ADA ONU"
      description={searchQuery ? 'Tidak ada ONU yang cocok dengan pencarian' : 'Tidak ada ONU di PON ini'}
    />
  )}
  {hasLoaded && !isLoading && !isError && filtered.length > 0 && (
    <ZTEONUTable data={filtered} onViewDetail={setDetailONU} />
  )}

  {/* Modal Detail */}
  {detailONU && (
    <ZTEONUDetailModal
      onu={detailONU}
      connId={connId!}
      onClose={() => setDetailONU(null)}
    />
  )}
</div>
B6. Sub-komponen ZTE
File: frontend/src/pages/ZTE/_components/ZTEHeaderBar.tsx
Props: { title, systemInfo, autoRefresh, onAutoRefreshToggle }
Layout brutal (neo-panel border-2):

Kiri: title (font-bold uppercase tracking-tight)
Tengah: CPU% · MEM% · Uptime · Host (skeleton kalau systemInfo null)
Kanan: tombol "AUTO REFRESH [ON/OFF]" (Button variant outline) + jam HH:MM:SS (setInterval 1 detik)

File: frontend/src/pages/ZTE/_components/ZTEStatsCards.tsx
Props: { stats: { total, online, los, offline } }
4 Card horizontal (grid-cols-4):

TOTAL ONUs (foreground)
ONLINE (text-success)
LOS (text-destructive)
OFFLINE/OTHER (text-muted-foreground)
Gunakan Card + CardContent dari @/components/ui/card

File: frontend/src/pages/ZTE/_components/ZTEToolbar.tsx
Props: { board, pon, ponList, loading, autoRefresh, searchQuery, onBoardChange, onPonChange, onLoad, onRefresh, onSearchChange }
Layout:

Kiri: ZTESelect board (1..8) + ZTESelect PON (dari ponList, placeholder "Pilih PON") + Button "LOAD" (disabled kalau pon null) + Button icon RefreshCw (disabled kalau !hasLoaded)
Kanan: Input search placeholder "Search Name, SN..."
Semua menggunakan komponen existing (Button, Input) + ZTESelect baru

File: frontend/src/pages/ZTE/_components/ZTEONUTable.tsx
Props: { data: ZTEONUListItem[], onViewDetail: (onu) => void }
Table HTML native dengan brutal styling (border-2, shadow-brutal):
Kolom: ID | NAME | SERIAL NUMBER | STATUS | RX POWER | ACTIONS

name="" → tampilkan "-"
serialNumber="" → tampilkan "-"
Status Badge (dari @/components/ui/badge):
statusCode 3 → variant="success" "Online"
statusCode 4 → variant="destructive" "LOS"
statusCode 1 → variant="secondary" "Offline"
lain → variant="warning" status string
RX Power color:

-25 → text-success font-bold
-25 to -27 → text-warning font-bold
< -27 → text-destructive font-bold
format: "{rxPower} dBm"


Actions: Button variant="ghost" size="icon" → Eye icon → onViewDetail(onu)

File: frontend/src/pages/ZTE/_components/ZTEONUDetailModal.tsx
Props: { onu: ZTEONUListItem, connId: string, onClose: () => void }
State lokal:
tsconst [detail, setDetail] = useState<ZTEONUDetail | null>(null)
const [loading, setLoading] = useState(true)
const [error, setError] = useState(false)
Saat mount: fetch getZTEONUDetail(connId, onu.board, onu.pon, onu.onuId)
Gunakan ZTEModal sebagai wrapper.
Header: icon Router (lucide) + onu.name + "ONU Detail View"
Loading: ZTESkeleton rows={4}
Error: text-destructive "Gagal memuat detail ONU"
Grid 2 kolom (detail berhasil):
LOCATION: {board}/{pon}/{onuId}   STATUS: Badge
TYPE: type || "-"                  SERIAL NUMBER: serialNumber
RX POWER: warna sesuai nilai       TX POWER: txPower dBm
LAST ONLINE: format id-ID WIB      LAST OFFLINE: format id-ID WIB
WAN IP: wanIp                      OFFLINE REASON: offlineReason
Format tanggal:
tsnew Date(dateStr).toLocaleString('id-ID', {
  timeZone: 'Asia/Jakarta',
  day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit'
})
Footer buttons:

Button variant="outline" onClick refresh dengan fresh=true → fetch ulang → setDetail
Button variant="destructive" "Reboot ONU":
window.confirm → useMutation rebootZTEONU → showToast sukses/error

File: frontend/src/pages/ZTE/_components/ZTEEmptyState.tsx
Props: { icon: 'pon'|'error'|'empty', title, description, actionLabel?, actionHref? }
Center content dengan ikon lucide:

pon → GitBranch icon
error → WifiOff icon
empty → Inbox icon
Ikuti brutal style: neo-panel border-2 p-12 text-center
Judul: font-bold uppercase text-lg
Deskripsi: text-muted-foreground text-sm mt-2
Kalau ada action: Button variant="outline" className="mt-4" as Link to actionHref

B7. Modifikasi Sidebar.tsx
HANYA tambah item ZTE di array navigation yang ada.
Jangan ubah item yang sudah ada.
ts// Tambah import
import { useQuery } from '@tanstack/react-query'
import { getZTEConnections } from '@/lib/zteApi'

// Di dalam komponen Sidebar, tambah:
const { data: zteConnections } = useQuery({
  queryKey: ['zte-connections'],
  queryFn: getZTEConnections,
  staleTime: 60_000
})
Tambah section ZTE di JSX sidebar, setelah item Hioso, sebelum Settings:
tsx{/* ZTE OLT Section */}
<div className="..."> {/* ikuti styling group/section existing */}
  <p className="... uppercase text-xs font-bold text-muted-foreground px-2 mb-1">ZTE OLT</p>

  {(!zteConnections || zteConnections.length === 0) ? (
    <NavLink to="/settings/zte" className={...}>
      <Plus size={16} />
      <span>Tambah OLT</span>
    </NavLink>
  ) : (
    zteConnections.map(conn => (
      <NavLink key={conn.id} to={`/zte/${conn.id}`} className={({ isActive }) => ...}>
        <Router size={16} />
        <span>{conn.name}</span>
      </NavLink>
    ))
  )}
</div>
Ikuti PERSIS pola NavLink dan className pattern yang sudah ada di Sidebar.tsx.
B8. Modifikasi App.tsx
Tambah lazy imports dan routes baru.
JANGAN ubah route yang sudah ada.
ts// Tambah lazy imports
const ZTEONUListPage = React.lazy(() => import('@/pages/ZTE/ONUListPage'))
const ZTESettingsPage = React.lazy(() => import('@/pages/ZTE/ZTESettings'))

// Tambah di dalam protected routes (di bawah /hioso route):
<Route path="/zte/:connId" element={<ZTEONUListPage />} />
<Route path="/settings/zte" element={<ZTESettingsPage />} />

Struktur File yang Dibuat
frontend/src/
├── types/zte.ts
├── lib/zteApi.ts
└── pages/ZTE/
    ├── ONUListPage.tsx
    ├── ZTESettings.tsx
    └── _components/
        ├── ZTEModal.tsx
        ├── ZTESelect.tsx
        ├── ZTESkeleton.tsx
        ├── ZTEHeaderBar.tsx
        ├── ZTEStatsCards.tsx
        ├── ZTEToolbar.tsx
        ├── ZTEONUTable.tsx
        ├── ZTEONUDetailModal.tsx
        └── ZTEEmptyState.tsx

internal/
├── models/zte.go
├── handlers/zte_config.go
└── handlers/zte_proxy.go
File yang Dimodifikasi (minimal)

frontend/src/components/layout/Sidebar.tsx → tambah section ZTE
frontend/src/App.tsx → tambah 2 route
internal/router atau main Go → register route ZTE
internal/db → tambah table zte_connections

Urutan Pengerjaan

Go: models/zte.go + DB migration
Go: handlers/zte_config.go + register routes
Go: handlers/zte_proxy.go + register routes
Frontend: types/zte.ts
Frontend: lib/zteApi.ts
Frontend: _components/ (Modal, Select, Skeleton, EmptyState dulu)
Frontend: _components/ (HeaderBar, StatsCards, Toolbar, Table, DetailModal)
Frontend: ZTESettings.tsx
Frontend: ONUListPage.tsx
Frontend: modifikasi Sidebar.tsx
Frontend: modifikasi App.tsx

Pantangan

JANGAN ubah file selain yang disebutkan di "File yang Dimodifikasi"
JANGAN install dependency baru
JANGAN hardcode warna — gunakan CSS variable / Tailwind token existing
JANGAN buat ulang Button, Badge, Card, Input — gunakan dari @/components/ui/
JANGAN gunakan fetch() langsung — semua via axios instance dari @/lib/api

Verifikasi
go build ./...
npx tsc --noEmit