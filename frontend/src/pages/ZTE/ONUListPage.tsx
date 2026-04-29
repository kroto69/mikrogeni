import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getZTEConnections, getZTEONUList, getZTEPONList, getZTESystemInfo } from '@/lib/zteApi'
import { ZTEModal } from './_components/ZTEModal'
import { ZTEONUDetailModal } from './_components/ZTEONUDetailModal'
import { ZTESkeleton } from './_components/ZTESkeleton'
import { ZTEEmptyState } from './_components/ZTEEmptyState'
import type { ZTEONUListItem, ZTEPONInfo, ZTESystemInfo } from '@/types/zte'

type DashboardRow = {
  id: string
  nama: string
  sn: string
  status: 'ONLINE' | 'LOS' | 'OFF' | 'RANGING' | 'DYING_GASP' | 'POWER_OFF'
  statusCode: number
  rx: string
  raw: ZTEONUListItem
}

type DashboardHeaderProps = {
  title: string
  subtitle?: string
  systemInfo?: ZTESystemInfo
  autoRefresh: boolean
  onSyncClick: () => void
  onSettingsClick: () => void
}

function DashboardHeader({ title, subtitle, systemInfo, autoRefresh, onSyncClick, onSettingsClick }: DashboardHeaderProps) {
  return (
    <div className="neo-panel border-2 border-border bg-card p-4 shadow-brutal-sm flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{subtitle ?? 'Live Monitoring'}</p>
        <h1 className="truncate font-heading text-lg font-extrabold uppercase tracking-tight sm:text-xl">
          {title}
        </h1>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {systemInfo ? (
          <>
            <span>CPU {systemInfo.cpuUsage}%</span>
            <span>MEM {systemInfo.memoryUsage}%</span>
            <span>UPTIME {systemInfo.uptime}</span>
          </>
        ) : (
          <span>—</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onSyncClick}>SYNC</Button>
        <Button variant={autoRefresh ? 'default' : 'secondary'} size="sm" onClick={onSettingsClick}>
          AUTO [{autoRefresh ? 'ON' : 'OFF'}]
        </Button>
      </div>
    </div>
  )
}

type StatCardProps = {
  value: number
  label: string
  color: string
  onClick?: () => void
}

function StatCard({ value, label, color, onClick }: StatCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`neo-panel border-2 border-border shadow-brutal-sm text-center px-2 py-2 transition-all hover:-translate-y-[1px] hover:shadow-brutal ${color}`}
    >
      <p className="font-heading text-xl font-extrabold leading-none sm:text-2xl">{value}</p>
      <p className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground sm:text-[11px]">{label}</p>
    </button>
  )
}

type FilterToolbarProps = {
  board: number
  pon: number | null
  ponList: ZTEPONInfo[]
  searchQuery: string
  onBoardChange: (board: number) => void
  onPonChange: (pon: number | null) => void
  onLoad: () => void
  onRefresh: () => void
  onSearchChange: (value: string) => void
}

function FilterToolbar({
  board,
  pon,
  ponList,
  searchQuery,
  onBoardChange,
  onPonChange,
  onLoad,
  onRefresh,
  onSearchChange,
}: FilterToolbarProps) {
  const boardOptions = Array.from({ length: 8 }, (_, i) => i + 1)

  return (
    <div className="neo-panel border-2 border-border bg-card p-4 shadow-brutal-sm flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
      <div className="w-full lg:w-auto">
        <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Pilih Board &amp; Pon</p>
        <div className="flex w-full gap-2 lg:w-auto">
          <select
            value={String(board)}
            onChange={(e) => {
              onBoardChange(Number(e.target.value))
              onPonChange(null)
            }}
            className="h-10 flex-1 rounded-lg border-2 border-input bg-card px-3 text-sm font-bold uppercase shadow-brutal-sm outline-none lg:min-w-36"
          >
            {boardOptions.map((item) => (
              <option key={item} value={item}>
                BOARD {item}
              </option>
            ))}
          </select>

          <select
            value={pon != null ? String(pon) : ''}
            onChange={(e) => onPonChange(e.target.value ? Number(e.target.value) : null)}
            className="h-10 flex-1 rounded-lg border-2 border-input bg-card px-3 text-sm font-bold uppercase shadow-brutal-sm outline-none lg:min-w-36"
          >
            <option value="" disabled>
              Pilih PON
            </option>
            {ponList.map((item) => (
              <option key={`${item.board}-${item.pon}`} value={item.pon}>
                PON {item.pon}{item.description ? ` — ${item.description}` : ''}
              </option>
            ))}
          </select>

          <Button className="h-10 px-4 font-bold uppercase" onClick={onLoad} disabled={pon == null}>
            LOAD
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Search Name, SN..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-10 flex-1 border-2 border-input bg-card text-sm font-medium shadow-brutal-sm lg:max-w-72"
        />
        <Button variant="outline" className="h-10 border-2 border-input px-3 font-bold uppercase shadow-brutal-sm" onClick={onRefresh}>
          REFRESH
        </Button>
      </div>
    </div>
  )
}

type SectionHeaderProps = {
  autoRefresh: boolean
}

function SectionHeader({ autoRefresh }: SectionHeaderProps) {
  return (
    <div className="flex items-end justify-between">
      <h2 className="font-heading text-base font-extrabold uppercase tracking-tight">LIVE ONU LIST</h2>
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        REFRESH: {autoRefresh ? '5s' : 'OFF'}
      </span>
    </div>
  )
}

type StatusBadgeProps = {
  status: DashboardRow['status']
}

function StatusBadge({ status }: StatusBadgeProps) {
  const config =
    status === 'ONLINE'
      ? { bg: 'bg-success', text: 'text-success-foreground', border: 'border-border', label: 'ONLINE' }
      : status === 'LOS'
        ? { bg: 'bg-destructive', text: 'text-destructive-foreground', border: 'border-border', label: 'LOS' }
        : status === 'RANGING'
          ? { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-400', label: 'RANGING' }
          : status === 'DYING_GASP'
            ? { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-400', label: 'DYING GASP' }
            : status === 'POWER_OFF'
              ? { bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-400', label: 'POWER OFF' }
              : { bg: 'bg-muted', text: 'text-muted-foreground', border: 'border-border', label: 'OFFLINE' }

  return (
    <span className={`inline-flex items-center rounded-md border-2 px-2 py-[2px] text-[8px] font-extrabold uppercase tracking-wider shadow-brutal-sm ${config.bg} ${config.text} ${config.border}`}>
      {config.label}
    </span>
  )
}

type DataTableProps = {
  rows: DashboardRow[]
  onViewDetail: (row: DashboardRow) => void
}

function DataTable({ rows, onViewDetail }: DataTableProps) {
  return (
    <div className="neo-panel border-2 border-border bg-card shadow-brutal-sm rounded-lg overflow-hidden">
      <div className="max-h-[60vh] overflow-y-auto overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="sticky top-0 z-10 border-b-2 border-border bg-muted">
            <tr>
              <th className="w-12 px-3 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">ID</th>
              <th className="px-3 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">NAMA</th>
              <th className="hidden px-3 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground sm:table-cell">SN</th>
              <th className="w-20 px-3 py-3 text-center text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">STATUS</th>
              <th className="w-24 px-3 py-3 text-right text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">RX (DBM)</th>
              <th className="w-14 px-3 py-3 text-center text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">ACTION</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.id}-${row.sn}`} className="cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/30" onClick={() => onViewDetail(row)}>
                <td className="px-3 py-2.5 font-bold">{row.id}</td>
                <td className="px-3 py-2.5">
                  <span className="block max-w-[18rem] truncate font-bold uppercase">{row.nama}</span>
                  <span className="block text-xs text-muted-foreground sm:hidden">{row.sn}</span>
                </td>
                <td className="hidden px-3 py-2.5 font-mono text-xs text-muted-foreground sm:table-cell">{row.sn}</td>
                <td className="px-3 py-2.5 text-center"><StatusBadge status={row.status} /></td>
                <td className="px-3 py-2.5 text-right font-bold">{row.rx}</td>
                <td className="px-3 py-2.5 text-center">
                  <button
                    onClick={(e) => { e.stopPropagation(); onViewDetail(row) }}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border-2 border-input bg-card text-[10px] font-bold shadow-brutal-sm hover:bg-accent"
                  >
                    ...
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function mapStatus(code: number): DashboardRow['status'] {
  if (code === 3) return 'ONLINE'
  if (code === 4) return 'LOS'
  if (code === 2) return 'RANGING'
  if (code === 5) return 'DYING_GASP'
  if (code === 6) return 'POWER_OFF'
  return 'OFF'
}

function mapToDashboardRows(items: ZTEONUListItem[]): DashboardRow[] {
  return items.map((item) => ({
    id: `${item.pon}/${item.onuId}`,
    nama: item.name || `ONU ${item.onuId}`,
    sn: item.serialNumber || '-',
    status: mapStatus(item.statusCode),
    statusCode: item.statusCode,
    rx: mapStatus(item.statusCode) === 'LOS' ? 'NONE' : item.rxPower.toFixed(2),
    raw: item,
  }))
}

export default function ONUListPage() {
  const { connId } = useParams<{ connId: string }>()
  const [board, setBoard] = useState(1)
  const [pon, setPon] = useState<number | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [tick, setTick] = useState(0)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [detailRow, setDetailRow] = useState<ZTEONUListItem | null>(null)

  const { data: systemInfo } = useQuery({
    queryKey: ['zte-system', connId],
    queryFn: () => getZTESystemInfo(connId!),
    refetchInterval: 30_000,
    enabled: !!connId,
  })

  const { data: connections } = useQuery({
    queryKey: ['zte-connections'],
    queryFn: getZTEConnections,
    staleTime: 60_000,
  })

  const { data: ponList } = useQuery({
    queryKey: ['zte-pon-list', connId, board],
    queryFn: () => getZTEPONList(connId!, board),
    enabled: !!connId,
  })

  const { data: onuList, isLoading, isError, refetch } = useQuery({
    queryKey: ['zte-onu-list', connId, board, pon, tick],
    queryFn: () => getZTEONUList(connId!, board, pon!),
    enabled: !!connId && pon != null,
    staleTime: 55_000,
    refetchInterval: autoRefresh ? 5_000 : false,
  })

  const connName = connections?.find((item) => item.olt_id === connId)?.name ?? connId ?? 'ZTE OLT'

  const handleLoad = () => {
    if (pon != null) {
      setHasLoaded(true)
      refetch()
    }
  }

  const handleRefresh = () => {
    if (hasLoaded) refetch()
  }

  const handleSync = () => {
    setTick((v) => v + 1)
  }

  const allRows = useMemo(() => mapToDashboardRows(onuList ?? []), [onuList])

  const liveRows = useMemo(() => {
    const q = searchQuery.toLowerCase()
    if (!q) return allRows
    return allRows.filter((row) =>
      row.nama.toLowerCase().includes(q) ||
      row.sn.toLowerCase().includes(q) ||
      row.status.toLowerCase().includes(q)
    )
  }, [allRows, searchQuery])

  const stats = useMemo(() => {
    if (!hasLoaded) return { total: 0, online: 0, los: 0, offline: 0 }
    const total = allRows.length
    const online = allRows.filter((item) => item.status === 'ONLINE').length
    const los = allRows.filter((item) => item.status === 'LOS').length
    const offline = allRows.filter((item) => item.status !== 'ONLINE' && item.status !== 'LOS').length
    return { total, online, los, offline }
  }, [allRows, hasLoaded])

  const dashboardTitle = hasLoaded && pon
    ? `${connId ?? 'ZTE'} — Board ${board} / PON ${pon}`
    : `${connId ?? 'ZTE'}`

  if (!connId) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <ZTEEmptyState icon="error" title="Koneksi Tidak Ditemukan" description="Pilih OLT dari sidebar terlebih dahulu" />
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <div className="flex flex-col gap-3 px-3 pb-6 pt-3 sm:gap-4 sm:px-4 lg:px-6">
        <DashboardHeader
          title={dashboardTitle}
          subtitle={connName}
          systemInfo={systemInfo}
          autoRefresh={autoRefresh}
          onSyncClick={handleSync}
          onSettingsClick={() => setAutoRefresh((v) => !v)}
        />

        {hasLoaded && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard value={stats.total} label="TOTAL" color="bg-orange-100" onClick={() => setSearchQuery('')} />
            <StatCard value={stats.online} label="ONLINE" color="bg-cyan-100" onClick={() => setSearchQuery('ONLINE')} />
            <StatCard value={stats.los} label="LOS" color="bg-red-100" onClick={() => setSearchQuery('LOS')} />
            <StatCard value={stats.offline} label="OFF" color="bg-gray-100" onClick={() => setSearchQuery('OFF')} />
          </div>
        )}

        <FilterToolbar
          board={board}
          pon={pon}
          ponList={ponList ?? []}
          searchQuery={searchQuery}
          onBoardChange={setBoard}
          onPonChange={setPon}
          onLoad={handleLoad}
          onRefresh={handleRefresh}
          onSearchChange={setSearchQuery}
        />

        {!hasLoaded && (
          <ZTEEmptyState
            icon="pon"
            title="Pilih Board dan PON"
            description="Pilih board dan nomor PON, lalu klik Load untuk melihat data ONU"
          />
        )}

        {hasLoaded && isLoading && <ZTESkeleton rows={8} />}

        {hasLoaded && isError && (
          <ZTEEmptyState
            icon="error"
            title="Gagal Mengambil Data"
            description="Tidak dapat terhubung ke OLT. Periksa koneksi di Settings."
            actionLabel="Ke Settings ZTE"
            actionHref="/settings"
          />
        )}

        {hasLoaded && !isLoading && !isError && liveRows.length === 0 && (
          <ZTEEmptyState
            icon="empty"
            title="Tidak Ada ONU"
            description={searchQuery ? 'Tidak ada ONU yang cocok dengan pencarian' : 'Tidak ada ONU di PON ini'}
          />
        )}

        {hasLoaded && !isLoading && !isError && liveRows.length > 0 && (
          <>
            <SectionHeader autoRefresh={autoRefresh} />
            <DataTable rows={liveRows} onViewDetail={(row) => setDetailRow(row.raw)} />
          </>
        )}
      </div>

      {detailRow && connId && (
        <ZTEONUDetailModal onu={detailRow} connId={connId} onClose={() => setDetailRow(null)} />
      )}
    </div>
  )
}