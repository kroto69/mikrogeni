import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, ChevronDown, Monitor, RefreshCw } from 'lucide-react'
import { PickerPopup } from '@/components/retroui/PickerPopup'
import { IconDisc, OnuStatusPill, RxBar, RxBig } from '@/components/nms/pastel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getApiErrorMessage } from '@/lib/api'
import { useTheme } from '@/hooks/useTheme';
import { isNbStyle } from '@/lib/nb';
import { NB_PANEL, NB_ROW_BG, NB_ROW_META } from '@/lib/nb'
import { rxQuality, type OnuRowTone } from '@/lib/pastel'
import { ONU_PILL_DOT, ONU_PILL_TEXT, ONU_ROW_BG, ONU_ROW_META, RX_QUALITY_PILL_DOT, RX_QUALITY_PILL_TEXT } from '@/lib/pastel'
import { showToast } from '@/lib/toast'
import { getCDataOLTs, getCDataPONList, getCDataONUList, getCDataONUDetail, rebootCDataONU } from '@/lib/cdataApi'
import { ZTEModal } from '../ZTE/_components/ZTEModal'
import type { CDataONUListItem, CDataONUDetail } from '@/types/cdata'

function mapCDataStatus(status: string): { tone: OnuRowTone; label: string } {
  switch (status.toLowerCase()) {
    case 'online':
      return { tone: 'online', label: 'ONLINE' }
    case 'registered':
      return { tone: 'online', label: 'TERDAFTAR' }
    case 'offline':
      return { tone: 'offline', label: 'OFFLINE' }
    case 'notpresent':
      return { tone: 'offline', label: 'TIDAK ADA' }
    case 'lost':
      return { tone: 'los', label: 'HILANG' }
    case 'deregistered':
      return { tone: 'offline', label: 'DEREGISTER' }
    case 'abnormal':
      return { tone: 'offline', label: 'ABNORMAL' }
    default:
      return { tone: 'offline', label: status.toUpperCase() || 'UNKNOWN' }
  }
}

function formatRx(rx: number): string {
  if (rx === 0) return '-'
  return `${rx.toFixed(2)} dBm`
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2.5 last:border-b-0">
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
      <span className="text-right font-mono text-[14px] font-semibold text-foreground">{value}</span>
    </div>
  )
}

function CDataONUDetailModal({ onu, connId, onClose }: { onu: CDataONUListItem; connId: string; onClose: () => void }) {
  const { styleMode } = useTheme()
  const nb = isNbStyle(styleMode)
  const [rebooting, setRebooting] = useState(false)
  const { data: detail, isLoading, refetch } = useQuery({
    queryKey: ['cdata-onu-detail', connId, onu.pon, onu.onuId],
    queryFn: () => getCDataONUDetail(connId, onu.pon, onu.onuId),
    staleTime: 30_000,
  })

  const handleReboot = async () => {
    if (!window.confirm(`Reboot ONU ${onu.name || onu.onuId}?`)) return
    setRebooting(true)
    try {
      await rebootCDataONU(connId, onu.pon, onu.onuId)
      showToast({ title: 'Reboot berhasil', variant: 'success' })
      onClose()
    } catch (err) {
      showToast({ title: 'Reboot gagal', description: getApiErrorMessage(err), variant: 'error' })
    } finally {
      setRebooting(false)
    }
  }

  const d: CDataONUDetail | undefined = detail
  const rx = d?.rxPower ?? onu.rxPower
  const quality = rxQuality(rx)
  const status = mapCDataStatus(d?.status ?? onu.status)

  return (
    <ZTEModal isOpen onClose={onClose} title={d?.name || onu.name || `ONU ${onu.onuId}`}>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Memuat detail…</p>
      ) : (
        <div className="space-y-4">
          {/* Hero sinyal (v18): angka RX besar + pill kualitas + satu bar tipis. */}
          <div className={nb ? "border-2 border-border bg-nb-mint shadow-brutal p-4 text-[#131313]" : "rounded-[20px] bg-pastel-mint p-4 text-[#131313]"}>
            <p className={nb ? "font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-foreground" : "font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-[#4a5a50]"}>RX Power</p>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className={nb ? "nb-stroke font-display text-[42px] sm:text-[50px] font-bold leading-none tracking-[-0.02em]" : "font-display text-4xl font-bold leading-none tracking-[-0.02em]"}>{formatRx(rx)}</span>
              {quality.label !== '-' ? (
                <span className="ml-auto">
                  <OnuStatusPill
                    label={quality.label}
                    textClass={RX_QUALITY_PILL_TEXT[quality.label]}
                    dotClass={RX_QUALITY_PILL_DOT[quality.label]}
                  />
                </span>
              ) : null}
            </div>
            <RxBar rx={rx} barColor={quality.bar} className="mt-3" />
            <div className="mt-3 flex gap-2.5">
              <div className={nb ? "flex-1 border-2 border-border bg-white shadow-brutal-sm px-3.5 py-3" : "flex-1 rounded-[16px] bg-pastel-pink px-3.5 py-3"}>
                <p className={nb ? "font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-foreground" : "font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-[#6b4a5c]"}>TX Power</p>
                <p className="mt-1 font-mono text-[15px] font-bold">{d?.txPower ? `${d.txPower.toFixed(2)} dBm` : '-'}</p>
              </div>
              <div className={nb ? "flex-1 border-2 border-border bg-white shadow-brutal-sm px-3.5 py-3" : "flex-1 rounded-[16px] bg-pastel-yellow px-3.5 py-3"}>
                <p className={nb ? "font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-foreground" : "font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-[#6b5a2e]"}>Laser</p>
                <p className="mt-1 font-mono text-[15px] font-bold">{d?.laserTxPower ? `${d.laserTxPower.toFixed(2)} dBm` : '-'}</p>
              </div>
            </div>
          </div>

          <div className={nb ? `${NB_PANEL} px-4 py-2` : "rounded-[20px] border bg-card px-4 py-2"}>
            <InfoRow label="Status" value={status.label} />
            <InfoRow label="Nama" value={d?.name || onu.name || '-'} />
            <InfoRow label="MAC / Serial" value={d?.serialNumber || onu.serialNumber || '-'} />
            <InfoRow label="Tipe" value={d?.type || '-'} />
            <InfoRow label="Jarak" value={d?.distanceM ? `${d.distanceM} m` : '-'} />
            <InfoRow label="Suhu" value={d?.temperature ? `${d.temperature.toFixed(1)} °C` : '-'} />
            <InfoRow label="Tegangan" value={d?.voltage ? `${d.voltage.toFixed(2)} V` : '-'} />
            <InfoRow label="Bias" value={d?.biasCurrent ? `${d.biasCurrent.toFixed(2)} mA` : '-'} />
          </div>

          <div className="flex gap-2.5">
            <Button className="h-11 flex-1" size="sm" variant="outline" onClick={() => void refetch()}>
              ↻ Refresh
            </Button>
            <Button className="h-11 flex-1" size="sm" variant="destructive" onClick={handleReboot} disabled={rebooting}>
              {rebooting ? 'Mengirim reboot…' : 'Reboot ONU'}
            </Button>
          </div>
        </div>
      )}
    </ZTEModal>
  )
}

export default function CDataONUListPage() {
  const { styleMode } = useTheme()
  const nb = isNbStyle(styleMode)
  const { connId } = useParams()
  const navigate = useNavigate()
  const [pon, setPon] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [oltPickerOpen, setOltPickerOpen] = useState(false)
  const [ponPickerOpen, setPonPickerOpen] = useState(false)
  const [selectedOnu, setSelectedOnu] = useState<CDataONUListItem | null>(null)

  const { data: olts, isLoading: oltsLoading, error: oltsError } = useQuery({
    queryKey: ['cdata-olts', connId],
    queryFn: () => getCDataOLTs(connId!),
    enabled: !!connId,
    staleTime: 60_000,
  })

  const selectedOlt = useMemo(() => {
    if (!olts || olts.length === 0) return null
    return olts.find((o) => o.id === connId) ?? olts[0]
  }, [olts, connId])

  const { data: ponList } = useQuery({
    queryKey: ['cdata-pon-list', selectedOlt?.id],
    queryFn: () => getCDataPONList(selectedOlt!.id),
    enabled: !!selectedOlt,
    staleTime: 60_000,
  })

  const selectedPon = useMemo(() => {
    if (!ponList || ponList.length === 0) return null
    if (pon != null) return ponList.find((p) => p.pon === pon) ?? ponList[0]
    return ponList[0]
  }, [ponList, pon])

  const {
    data: onuList,
    isLoading: listLoading,
    refetch: refetchList,
  } = useQuery({
    queryKey: ['cdata-onu-list', selectedOlt?.id, selectedPon?.pon],
    queryFn: () => getCDataONUList(selectedOlt!.id, selectedPon!.pon),
    enabled: !!selectedOlt && !!selectedPon,
    staleTime: 30_000,
  })

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = onuList ?? []
    if (!q) return list
    return list.filter(
      (o) =>
        (o.name || '').toLowerCase().includes(q) ||
        (o.serialNumber || '').toLowerCase().includes(q) ||
        String(o.onuId).includes(q)
    )
  }, [onuList, search])

  const onlineCount = useMemo(
    () => (onuList ?? []).filter((o) => o.status.toLowerCase() === 'online' || o.status.toLowerCase() === 'registered').length,
    [onuList]
  )

  if (!connId) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">Pilih OLT C-Data dari sidebar.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="font-display text-xl font-bold uppercase tracking-wide text-foreground">C-Data</h1>
        <p className="font-mono text-xs text-muted-foreground">
          {oltsLoading ? 'Memuat OLT…' : selectedOlt ? selectedOlt.name || selectedOlt.id : '—'}
          {onuList ? ` · ${onlineCount}/${onuList.length} online` : ''}
        </p>
      </div>

      {oltsError ? (
        <div className="rounded-[20px] border bg-card p-4 text-sm text-muted-foreground">
          Gagal memuat OLT C-Data: {getApiErrorMessage(oltsError)}
        </div>
      ) : oltsLoading ? (
        <p className="text-sm text-muted-foreground">Memuat OLT…</p>
      ) : !olts || olts.length === 0 ? (
        <div className="rounded-[20px] border bg-card p-4 text-sm text-muted-foreground">
          Tidak ada OLT C-Data di server ini. Tambahkan OLT dengan vendor <code>cdata</code> di config zzte
          (olt_config.yaml), lalu simpan ulang koneksi zzte agar baris koneksinya terbentuk.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" className="h-11 justify-between gap-2" onClick={() => setOltPickerOpen(true)}>
              <span className="truncate">{selectedOlt?.name || selectedOlt?.id || 'Pilih OLT'}</span>
              <ChevronDown className="h-4 w-4 shrink-0" />
            </Button>
            <Button
              variant="outline"
              className="h-11 justify-between gap-2"
              onClick={() => setPonPickerOpen(true)}
              disabled={!ponList || ponList.length === 0}
            >
              <span className="truncate">
                {selectedPon ? `PON ${selectedPon.pon}${selectedPon.description ? `: ${selectedPon.description}` : ''}` : 'Pilih PON'}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0" />
            </Button>
            <Input
              className="h-11 min-w-0 flex-1"
              placeholder="Cari nama / MAC / ONU…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button
              variant="outline"
              className="h-11 shrink-0 gap-2"
              onClick={() => void refetchList()}
              disabled={!selectedPon || listLoading}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>

          {listLoading ? (
            <p className="text-sm text-muted-foreground">Memuat ONU…</p>
          ) : rows.length === 0 ? (
            <div className="rounded-[20px] border bg-card p-4 text-sm text-muted-foreground">
              {selectedPon ? 'Tidak ada ONU di PON ini.' : 'Pilih PON dulu.'}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {rows.map((o) => {
                const { tone, label } = mapCDataStatus(o.status)
                const iconTint = tone === 'online' ? 'text-pastel-mint' : tone === 'los' ? 'text-pastel-red' : 'text-pastel-grey'
                return (
                  <button
                    key={o.onuId}
                    type="button"
                    onClick={() => setSelectedOnu(o)}
                    className={`w-full rounded-[18px] p-4 text-left text-[#131313] transition-opacity hover:opacity-90 ${nb ? NB_ROW_BG : ONU_ROW_BG[tone]}`}
                  >
                    <div className="flex items-center gap-3">
                      <IconDisc iconClass={iconTint} className="h-11 w-11">
                        <Monitor className="h-5 w-5" />
                      </IconDisc>
                      <div className="min-w-0 flex-1">
                        <p className={nb ? "truncate nb-stroke font-display text-[18px] sm:text-[20px] font-bold tracking-[-0.01em]" : "truncate font-display text-[17px] font-bold tracking-[-0.01em]"}>{o.name || `ONU ${o.onuId}`}</p>
                        <p className={`mt-0.5 truncate font-mono text-[12px] ${nb ? NB_ROW_META : ONU_ROW_META[tone]}`}>
                          ID {o.pon}/{o.onuId} · PON {o.pon}
                        </p>
                      </div>
                      <div className={`hidden min-w-0 flex-1 font-mono leading-[1.7] lg:block ${nb ? 'text-[14px]' : 'text-xs'}`}>
                        <p className="truncate">{o.serialNumber || '-'}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <div className="flex items-center gap-2.5">
                          <OnuStatusPill label={label} textClass={ONU_PILL_TEXT[tone]} dotClass={ONU_PILL_DOT[tone]} />
                          <span className={nb ? "hidden h-9 w-9 items-center justify-center rounded-[10px] border-2 border-border bg-white text-foreground shadow-brutal-sm sm:flex" : "hidden h-9 w-9 items-center justify-center rounded-full bg-[#131313] text-[#f5f5f5] sm:flex"}>
                            <ArrowUpRight className="h-4 w-4" />
                          </span>
                        </div>
                        <RxBig rx={o.rxPower === 0 ? null : o.rxPower.toFixed(2)} metaClass={ONU_ROW_META[tone]} />
                      </div>
                    </div>
                    <div className={`mt-3 space-y-1 border-t border-black/10 pt-3 font-mono lg:hidden ${nb ? 'text-[14px]' : 'text-xs'} ${nb ? NB_ROW_META : ONU_ROW_META[tone]}`}>
                      <p className="truncate text-[#131313]">{o.serialNumber || '-'}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Data diambil langsung dari OLT saat halaman dibuka atau tombol Refresh ditekan (tanpa auto-refresh, supaya OLT tidak terbebani).
          </p>
        </>
      )}

      <PickerPopup
        open={oltPickerOpen}
        title="Pilih OLT C-Data"
        layout="list"
        searchable
        options={(olts ?? []).map((o) => ({ value: o.id, label: o.name || o.id, description: o.id }))}
        selectedValue={selectedOlt?.id}
        onSelect={(value) => {
          setOltPickerOpen(false)
          setPon(null)
          navigate(`/cdata/${encodeURIComponent(value)}`)
        }}
        onClose={() => setOltPickerOpen(false)}
      />

      <PickerPopup
        open={ponPickerOpen}
        title="Pilih PON"
        layout="list"
        searchable
        options={(ponList ?? []).map((p) => ({ value: String(p.pon), label: `PON ${p.pon}`, description: p.description || undefined }))}
        selectedValue={selectedPon ? String(selectedPon.pon) : undefined}
        onSelect={(value) => {
          setPonPickerOpen(false)
          setPon(Number(value))
        }}
        onClose={() => setPonPickerOpen(false)}
      />

      {selectedOnu && selectedOlt && (
        <CDataONUDetailModal onu={selectedOnu} connId={selectedOlt.id} onClose={() => setSelectedOnu(null)} />
      )}
    </div>
  )
}
