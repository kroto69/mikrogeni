import { useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, ChevronDown, Monitor } from 'lucide-react'
import { PickerPopup } from '@/components/retroui/PickerPopup'
import { IconDisc, OnuStatusPill, RxBig } from '@/components/nms/pastel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useGlobalLoaderOverlay } from '@/hooks/useGlobalLoaderOverlay'
import { useTheme } from '@/hooks/useTheme';
import { isNbStyle } from '@/lib/nb';
import { useRole } from '@/hooks/useRole'
import { getApiErrorMessage } from '@/lib/api'
import { NB_PANEL, NB_ROW_BG, NB_ROW_META, NB_STAT_PILL } from '@/lib/nb'
import { ONU_PILL_DOT, ONU_PILL_TEXT, ONU_ROW_BG, ONU_ROW_META, type OnuRowTone } from '@/lib/pastel'
import { showToast } from '@/lib/toast'
import { getZTEBoards, getZTEConnections, getZTEONUList, getZTEPONList, getZTESystemInfo, getZTEUnconfiguredONUs } from '@/lib/zteApi'
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
  const { styleMode } = useTheme()
  const nb = isNbStyle(styleMode)
  return (
    <div className={nb ? `${NB_PANEL} p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between` : "rounded-[20px] border bg-card p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"}>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{subtitle ?? 'Live Monitoring'}</p>
        <h1 className="truncate font-heading text-lg font-extrabold uppercase tracking-tight sm:text-xl">
          {title}
        </h1>
      </div>

      <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
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

      <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">
        <Button className="flex-1 md:flex-none" variant="outline" size="sm" onClick={onSyncClick}>SYNC</Button>
        <Button className="flex-1 md:flex-none" variant={autoRefresh ? 'default' : 'secondary'} size="sm" onClick={onSettingsClick}>
          AUTO [{autoRefresh ? 'ON' : 'OFF'}]
        </Button>
      </div>
    </div>
  )
}

type StatPillProps = {
  value: number
  label: string
  tone: string
  onClick?: () => void
}

// Filter cepat ala v29: pill berwarna menurut status (klik = filter).
function StatPill({ value, label, tone, onClick }: StatPillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 font-mono text-xs font-bold transition-opacity hover:opacity-80 ${tone}`}
    >
      {label} {value}
    </button>
  )
}

type FilterToolbarProps = {
  board: number
  boardOptions: number[]
  pon: number | null
  ponList: ZTEPONInfo[]
  searchQuery: string
  onBoardChange: (board: number) => void
  onPonChange: (pon: number | null) => void
  onLoad: () => void
  onRefresh: () => void
  onSearchChange: (value: string) => void
  showUncfg?: boolean
  onUncfgToggle?: () => void
  uncfgCount?: number
}

function FilterToolbar({
  board,
  boardOptions,
  pon,
  ponList,
  searchQuery,
  onBoardChange,
  onPonChange,
  onLoad,
  onRefresh,
  onSearchChange,
  showUncfg,
  onUncfgToggle,
  uncfgCount,
}: FilterToolbarProps) {
  const [pickerOpen, setPickerOpen] = useState<'board' | 'pon' | null>(null)
  const { styleMode } = useTheme()
  const nb = isNbStyle(styleMode)
  // Nama PON tak dihafal operator — trigger menampilkan nomor + nama
  // sekaligus ("PON 1: suambian"), bukan nama saja atau nomor saja.
  const selectedPon = pon != null ? ponList.find((item) => item.pon === pon) : undefined
  const ponTriggerLabel =
    pon == null ? 'Pilih PON' : selectedPon?.description ? `PON ${pon}: ${selectedPon.description}` : `PON ${pon}`

  return (
    <div className={nb ? `${NB_PANEL} p-4 flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between` : "rounded-[20px] border bg-card p-4 flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between"}>
      <div className="w-full lg:w-auto">
        <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Pilih Board &amp; Pon</p>
        <div className="grid w-full gap-2 sm:grid-cols-2 lg:flex lg:w-auto">
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={pickerOpen === 'board'}
            onClick={() => setPickerOpen('board')}
            className="flex h-10 w-full items-center justify-between rounded-full border border-input bg-card px-3 text-sm font-bold uppercase outline-none lg:min-w-32"
          >
            BOARD {board}
            <ChevronDown className="ml-2 h-4 w-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={pickerOpen === 'pon'}
            onClick={() => setPickerOpen('pon')}
            title={ponTriggerLabel}
            className="flex h-10 w-full items-center justify-between rounded-full border border-input bg-card px-3 text-sm font-bold uppercase outline-none lg:min-w-32"
          >
            <span className="min-w-0 flex-1 truncate text-left">{ponTriggerLabel}</span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0" aria-hidden="true" />
          </button>

          <Button className="h-10 w-full whitespace-nowrap px-4 font-bold uppercase sm:col-span-2 lg:w-auto" onClick={onLoad} disabled={pon == null}>
            LOAD
          </Button>
          {onUncfgToggle && (
            <Button className="h-10 w-full whitespace-nowrap px-4 font-bold uppercase sm:col-span-2 lg:w-auto" variant={showUncfg ? "default" : "outline"} onClick={onUncfgToggle}>
              UNCFG {uncfgCount ?? "?"}
            </Button>
          )}
        </div>
      </div>

      <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
        <Input
          placeholder="Search Name, SN..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-10 w-full min-w-0 text-sm font-medium lg:min-w-48"
        />
        <Button variant="outline" className="h-10 w-full shrink-0 whitespace-nowrap px-3 font-bold uppercase sm:w-auto" onClick={onRefresh}>
          REFRESH
        </Button>
      </div>

      <PickerPopup
        open={pickerOpen != null}
        title={pickerOpen === 'board' ? 'Pilih Board' : 'Pilih PON'}
        layout={pickerOpen === 'board' ? 'grid' : 'list'}
        searchable={pickerOpen === 'pon'}
        searchPlaceholder="Cari nama atau nomor PON…"
        options={pickerOpen === 'board'
          ? boardOptions.map((item) => ({ value: String(item), label: String(item) }))
          // Nomor + nama sekaligus ("PON 1: suambian") — tanpa nama,
          // tampil nomor saja.
          : ponList.map((item) => ({ value: String(item.pon), label: `PON ${item.pon}`, description: item.description || undefined }))}
        selectedValue={pickerOpen === 'board' ? String(board) : pon != null ? String(pon) : undefined}
        onSelect={(value) => {
          if (pickerOpen === 'board') {
            onBoardChange(Number(value))
            onPonChange(null)
          } else {
            onPonChange(Number(value))
          }
        }}
        onClose={() => setPickerOpen(null)}
      />
    </div>
  )
}

function SectionHeader({ autoRefresh }: { autoRefresh: boolean }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <h2 className="font-heading text-base font-extrabold uppercase tracking-tight">Live ONU List</h2>
      <span className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        Refresh: {autoRefresh ? '5s' : 'OFF'}
      </span>
    </div>
  )
}

// Baris ONU bahasa pastel (v29): kartu penuh warna status, kolom
// nama (+ ID · PON), SN, pill status besar + RX besar di bawahnya.
function rowTone(status: DashboardRow['status']): { tone: OnuRowTone; label: string } {
  if (status === 'ONLINE') return { tone: 'online', label: 'ONLINE' }
  if (status === 'LOS') return { tone: 'los', label: 'LOS' }
  if (status === 'RANGING') return { tone: 'offline', label: 'RANGING' }
  if (status === 'DYING_GASP') return { tone: 'offline', label: 'DYING GASP' }
  if (status === 'POWER_OFF') return { tone: 'offline', label: 'POWER OFF' }
  return { tone: 'offline', label: 'OFFLINE' }
}

type DataTableProps = {
  rows: DashboardRow[]
  onViewDetail: (row: DashboardRow) => void
}

function DataTable({ rows, onViewDetail }: DataTableProps) {
  const { styleMode } = useTheme()
  const nb = isNbStyle(styleMode)
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => {
        const { tone, label } = rowTone(row.status)
        const iconTint = tone === 'online' ? 'text-pastel-mint' : tone === 'los' ? 'text-pastel-red' : 'text-pastel-grey'
        return (
          <button
            key={`${row.id}-${row.sn}`}
            type="button"
            onClick={() => onViewDetail(row)}
            className={`w-full rounded-[18px] p-4 text-left text-[#131313] transition-opacity hover:opacity-90 ${nb ? NB_ROW_BG : ONU_ROW_BG[tone]}`}
          >
            <div className="flex items-center gap-3">
              <IconDisc iconClass={iconTint} className="h-11 w-11">
                <Monitor className="h-5 w-5" />
              </IconDisc>
              <div className="min-w-0 flex-1">
                <p className={nb ? "truncate nb-stroke font-display text-[18px] sm:text-[20px] font-bold tracking-[-0.01em]" : "truncate font-display text-[17px] font-bold tracking-[-0.01em]"}>{row.nama}</p>
                <p className={`mt-0.5 truncate font-mono text-[12px] ${nb ? NB_ROW_META : ONU_ROW_META[tone]}`}>
                  ID {row.id} · PON {row.raw.pon}
                </p>
              </div>
              <div className={`hidden min-w-0 flex-1 font-mono leading-[1.7] lg:block ${nb ? 'text-[14px]' : 'text-xs'}`}>
                <p className="truncate">{row.sn}</p>
                <p className={nb ? NB_ROW_META : ONU_ROW_META[tone]}>BOARD {row.raw.board}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <div className="flex items-center gap-2.5">
                  <OnuStatusPill label={label} textClass={ONU_PILL_TEXT[tone]} dotClass={ONU_PILL_DOT[tone]} />
                  <span className={nb ? "hidden h-9 w-9 items-center justify-center rounded-[10px] border-2 border-border bg-white text-foreground shadow-brutal-sm sm:flex" : "hidden h-9 w-9 items-center justify-center rounded-full bg-[#131313] text-[#f5f5f5] sm:flex"}>
                    <ArrowUpRight className="h-4 w-4" />
                  </span>
                </div>
                <RxBig rx={row.rx === 'NONE' ? null : row.rx} metaClass={ONU_ROW_META[tone]} />
              </div>
            </div>
            <div className={`mt-3 space-y-1 border-t border-black/10 pt-3 font-mono lg:hidden ${nb ? 'text-[14px]' : 'text-xs'} ${nb ? NB_ROW_META : ONU_ROW_META[tone]}`}>
              <p className="truncate text-[#131313]">{row.sn}</p>
              <p>BOARD {row.raw.board}</p>
            </div>
          </button>
        )
      })}
    </div>
  )
}

function mapStatus(code: number): DashboardRow['status'] {
  if (code === 3) return 'ONLINE'
  if (code === 1) return 'LOS'
  if (code === 2) return 'RANGING'
  if (code === 5) return 'DYING_GASP'
  if (code === 6) return 'POWER_OFF'
  if (code === 4) return 'OFF'
  return 'OFF'
}

function mapToDashboardRows(items: ZTEONUListItem[]): DashboardRow[] {
  return items.map((item) => ({
    id: `${item.pon}/${item.onuId}`,
    nama: item.name || `ONU ${item.onuId}`,
    sn: item.serialNumber || '-',
    status: mapStatus(item.statusCode),
    statusCode: item.statusCode,
    rx: mapStatus(item.statusCode) === 'LOS' || !item.rxPower ? 'NONE' : item.rxPower.toFixed(2),
    raw: item,
  }))
}

export default function ONUListPage() {
  const { styleMode } = useTheme()
  const nb = isNbStyle(styleMode)
  const { runWithGlobalLoader } = useGlobalLoaderOverlay()
  const { can } = useRole()
  const { connId } = useParams<{ connId: string }>()
  const [board, setBoard] = useState(1)
  const [pon, setPon] = useState<number | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [tick, setTick] = useState(0)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [detailRow, setDetailRow] = useState<ZTEONUListItem | null>(null)
  const [showUncfg, setShowUncfg] = useState(false)

  const { data: uncfgOnus, isFetching: uncfgLoading } = useQuery({
    queryKey: ['zte-uncfg', connId],
    queryFn: () => getZTEUnconfiguredONUs(connId!),
    enabled: !!connId && showUncfg,
    staleTime: 15_000,
  })

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

  // Slot board dari perangkat (endpoint boards zzte: distinct slot hasil
  // SNMP walk). Fallback 1..8 seperti dulu bila endpoint gagal (zzte
  // lama) atau kosong — jangan sembunyikan board tanpa dasar data.
  const { data: boardList } = useQuery({
    queryKey: ['zte-boards', connId],
    queryFn: () => getZTEBoards(connId!),
    enabled: !!connId,
    staleTime: 60_000,
  })
  const boardOptions = boardList?.length ? boardList : [1, 2, 3, 4, 5, 6, 7, 8]
  // Tanpa auto-koreksi board: default 1 ada di hampir semua C320; bila
  // tak ada, popup board menampilkan slot asli dan user memilih sendiri
  // (satu ketuk) — lebih eksplisit daripada pindah diam-diam.

  // Jendela live: refresh manual (LOAD/REFRESH/SYNC) kirim fresh=true,
  // jadi teknisi dapat status + redaman live dari OLT untuk 1 PON ini
  // (walk 1 PON saja, ~2-5 detik). Jendela cuma 3 dtk — cukup untuk
  // refetch manual + fetch akibat ganti tick SYNC; tick AUTO berikutnya
  // (interval 5 dtk) sudah di luar jendela, jadi AUTO tetap pakai cache
  // dan tidak ada polling live terus-menerus yang memberatkan OLT.
  const freshUntilRef = useRef(0)
  const armFreshWindow = () => {
    freshUntilRef.current = Date.now() + 3_000
  }

  const { data: onuList, isLoading, isError, refetch } = useQuery({
    queryKey: ['zte-onu-list', connId, board, pon, tick],
    queryFn: () => getZTEONUList(connId!, board, pon!, Date.now() < freshUntilRef.current),
    enabled: !!connId && pon != null,
    staleTime: 55_000,
    refetchInterval: autoRefresh ? 5_000 : false,
  })

  const connName = connections?.find((item) => item.olt_id === connId)?.name ?? connId ?? 'ZTE OLT'

  const handleLoad = () => {
    if (pon != null) {
      armFreshWindow()
      setHasLoaded(true)
      void runWithGlobalLoader(async () => {
        const result = await refetch()
        if (result.error) throw result.error
      }, 'Loading ONU Data...')
    }
  }

  const handleRefresh = () => {
    if (!hasLoaded) return

    armFreshWindow()
    void runWithGlobalLoader(async () => {
      const result = await refetch()
      if (result.error) {
        throw result.error
      }
    }, 'Refreshing ONU Data...').catch((refreshError) => {
      showToast({
        title: 'Refresh gagal',
        description: getApiErrorMessage(refreshError),
        variant: 'error',
      })
    })
  }

  const handleSync = () => {
    armFreshWindow()
    setTick((v) => v + 1)

    if (!hasLoaded) {
      return
    }

    void runWithGlobalLoader(async () => {
      const result = await refetch()
      if (result.error) {
        throw result.error
      }
    }, 'Refreshing ONU Data...').catch((refreshError) => {
      showToast({
        title: 'Refresh gagal',
        description: getApiErrorMessage(refreshError),
        variant: 'error',
      })
    })
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

        <FilterToolbar
          board={board}
          boardOptions={boardOptions}
          pon={pon}
          ponList={ponList ?? []}
          searchQuery={searchQuery}
          onBoardChange={setBoard}
          onPonChange={setPon}
          onLoad={handleLoad}
          onRefresh={handleRefresh}
          onSearchChange={setSearchQuery}
          showUncfg={showUncfg}
          onUncfgToggle={can("zte_connections_crud") ? () => setShowUncfg((v) => !v) : undefined}
          uncfgCount={uncfgOnus?.length}
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

        {hasLoaded && !isLoading && !isError && (
          <div className="flex flex-wrap items-center gap-2">
            <StatPill value={stats.total} label="TOTAL" tone={nb ? NB_STAT_PILL.total : "bg-card border border-border text-foreground"} onClick={() => setSearchQuery('')} />
            <StatPill value={stats.online} label="ONLINE" tone={nb ? NB_STAT_PILL.online : "bg-pastel-mint text-[#131313]"} onClick={() => setSearchQuery('ONLINE')} />
            <StatPill value={stats.los} label="LOS" tone={nb ? NB_STAT_PILL.los : "bg-pastel-red text-[#131313]"} onClick={() => setSearchQuery('LOS')} />
            <StatPill value={stats.offline} label="OFFLINE" tone={nb ? NB_STAT_PILL.offline : "bg-pastel-grey text-[#131313]"} onClick={() => setSearchQuery('OFF')} />
          </div>
        )}

        {hasLoaded && !isLoading && !isError && showUncfg && (
          <div className={nb ? `${NB_PANEL} overflow-hidden` : "rounded-[20px] border bg-card overflow-hidden"}>
            <div className="border-b border-border bg-muted/30 px-3 py-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Unconfigured ONU</span>
            </div>
            {uncfgLoading ? (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">Loading...</div>
            ) : (uncfgOnus ?? []).length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">No unconfigured ONU found</div>
            ) : (
              <div className="divide-y divide-border/50">
                {(uncfgOnus ?? []).map((onu, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 text-xs">
                    <div>
                      <span className="font-bold">{onu.board}/{onu.pon}/{onu.onuId}</span>
                      <span className="ml-2 font-mono text-muted-foreground">{onu.sn}</span>
                    </div>
                    <span className="rounded-full border border-orange-300 bg-orange-50 px-1.5 py-0.5 text-[10px] font-bold text-orange-700">{onu.state}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
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
