import { useState, useEffect } from 'react'
import { StatusBadge as NmsStatusBadge } from '@/components/nms/status-badge'
import { OnuStatusPill, RxBar } from '@/components/nms/pastel'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/hooks/useTheme';
import { isNbStyle } from '@/lib/nb';
import { NB_PANEL } from '@/lib/nb'
import type { NmsStatus } from '@/lib/status-tone'
import { rxQuality } from '@/lib/pastel'
import { ZTEModal } from './ZTEModal'
import { ZTESkeleton } from './ZTESkeleton'
import { getZTEONUDetail, rebootZTEONU, getApiErrorMessage } from '@/lib/zteApi'
import { showToast } from '@/lib/toast'

import type { ZTEONUListItem, ZTEONUDetail } from '@/types/zte'

type ZTEONUDetailModalProps = {
  onu: ZTEONUListItem
  connId: string
  onClose: () => void
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatShortDate(dateStr: string): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function mapDetailStatusTone(statusCode: number, status: string): { status: NmsStatus; label: string } {
  if (statusCode === 3) return { status: 'online', label: 'ONLINE' }
  if (statusCode === 1) return { status: 'critical', label: 'LOS' }
  if (statusCode === 4) return { status: 'offline', label: 'OFFLINE' }
  if (statusCode === 2) return { status: 'provisioning', label: 'RANGING' }
  if (statusCode === 5) return { status: 'warning', label: 'DYING GASP' }
  if (statusCode === 6) return { status: 'down', label: 'POWER OFF' }

  const normalized = status.trim().toUpperCase()
  return { status: 'unknown', label: normalized || 'UNKNOWN' }
}

function InfoCell({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="border-b border-border/60 py-2 last:border-b-0 sm:py-2.5">
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className={`mt-1 text-sm font-semibold text-foreground ${mono ? 'break-all font-mono text-[14px]' : ''}`}>{children}</p>
    </div>
  )
}

export function ZTEONUDetailModal({ onu, connId, onClose }: ZTEONUDetailModalProps) {
  const { styleMode } = useTheme()
  const nb = isNbStyle(styleMode)
  const [detail, setDetail] = useState<ZTEONUDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [rebooting, setRebooting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  // Setelah reboot sukses, ONU pasti down dulu — jangan percaya status
  // "online" dari backend selama RX masih 0. State ini dihapus begitu
  // polling memastikan ONU online lagi dengan RX beneran, atau setelah
  // 3 menit (timeout) supaya tidak nempel selamanya.
  const [rebootedAt, setRebootedAt] = useState<number | null>(null)
  const detailStatusTone = detail ? mapDetailStatusTone(detail.statusCode, detail.status) : null

  // Status efektif: backend bisa bilang online padahal RX sudah 0 (status
  // OLT ketinggalan setelah reboot). ONU tanpa sinyal optik = tidak online.
  const effectivelyOnline = detail ? detail.statusCode === 3 && !!detail.rxPower : false
  const displayStatusTone = detail && !effectivelyOnline && detail.statusCode === 3
    ? { status: 'offline' as const, label: 'OFFLINE' }
    : detailStatusTone

  const fetchDetail = async (fresh?: boolean, silent?: boolean) => {
    // silent = isi tetap tampil, cuma tombol Refresh yang muter (dipakai
    // tombol Refresh + polling setelah reboot). Tanpa silent, seluruh isi
    // popup diganti skeleton — itu yang terasa "tidak responsif".
    if (silent) setRefreshing(true)
    else setLoading(true)
    setError(false)
    try {
      const data = await getZTEONUDetail(connId, onu.board, onu.pon, onu.onuId, fresh)
      setDetail(data)
      // ONU kembali: online + RX beneran → selesai masa reboot.
      if (data.statusCode === 3 && data.rxPower) setRebootedAt(null)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchDetail()
  }, [])

  // Polling setelah reboot: cek tiap 5 detik sampai ONU online lagi.
  // Timeout 3 menit dicek di dalam interval (bukan di badan effect) supaya
  // tidak memanggil setState secara sinkron di effect.
  useEffect(() => {
    if (rebootedAt == null) return
    const id = window.setInterval(() => {
      if (Date.now() - (rebootedAt ?? 0) > 180_000) {
        setRebootedAt(null)
        return
      }
      void fetchDetail(true, true)
    }, 5000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rebootedAt])

  const handleReboot = async () => {
    if (!window.confirm(`Reboot ONU ${onu.name || onu.onuId}?`)) return
    setRebooting(true)
    try {
      await rebootZTEONU(connId, onu.board, onu.pon, onu.onuId)
      showToast({ title: 'Reboot berhasil', variant: 'success' })
      // Langsung ambil data segar + mulai polling: popup harus menunjukkan
      // ONU DOWN dulu (RX "—"), lalu ONLINE lagi begitu dia kembali.
      setRebootedAt(Date.now())
      await fetchDetail(true, true)
    } catch (err) {
      showToast({ title: 'Reboot gagal', description: getApiErrorMessage(err), variant: 'error' })
    } finally {
      setRebooting(false)
    }
  }

  const quality = detail ? rxQuality(detail.rxPower) : null

  return (
    <ZTEModal isOpen onClose={onClose} title={`${onu.name || `ONU ${onu.onuId}`}`}>
      {loading && <ZTESkeleton rows={4} />}
      {error && (
        <p className="rounded-[16px] bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">Gagal memuat detail ONU</p>
      )}
      {detail && !loading && !error && (
        <div className="space-y-4">
          {/* Hero sinyal (v18): angka RX besar + pill kualitas + satu bar tipis. */}
          <div className={nb ? "border-2 border-border bg-nb-mint shadow-brutal p-3 text-[#131313] sm:p-4" : "rounded-[20px] bg-pastel-mint p-3 text-[#131313] sm:p-4"}>
            <p className={nb ? "font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-foreground" : "font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-[#4a5a50]"}>RX Power</p>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className={nb ? "nb-stroke font-display text-[36px] sm:text-[50px] font-bold leading-none tracking-[-0.02em]" : "font-display text-4xl font-bold leading-none tracking-[-0.02em]"}>{detail.rxPower ? detail.rxPower.toFixed(2) : '—'}</span>
              {detail.rxPower ? <span className="font-mono text-sm font-bold">dBm</span> : null}
              {quality && quality.label !== '-' ? (
                <span className="ml-auto">
                  <OnuStatusPill
                    label={quality.label}
                    textClass={quality.label === 'Baik' ? 'text-pastel-mint' : quality.label === 'Cukup' ? 'text-pastel-yellow' : 'text-pastel-red'}
                    dotClass={quality.label === 'Baik' ? 'bg-pastel-mint' : quality.label === 'Cukup' ? 'bg-pastel-yellow' : 'bg-pastel-red'}
                  />
                </span>
              ) : null}
            </div>
            <RxBar rx={detail.rxPower} barColor={quality?.bar ?? '#9aa3a8'} className="mt-3" />
            <div className="mt-3 flex gap-2.5">
              <div className={nb ? "flex-1 border-2 border-border bg-white shadow-brutal-sm px-3 py-2.5 sm:px-3.5 sm:py-3" : "flex-1 rounded-[16px] bg-pastel-pink px-3 py-2.5 sm:px-3.5 sm:py-3"}>
                <p className={nb ? "font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-foreground" : "font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-[#6b4a5c]"}>TX Power</p>
                <p className="mt-1 font-mono text-[15px] font-bold">{detail.txPower ? `${detail.txPower.toFixed(2)} dBm` : '—'}</p>
              </div>
              <div className={nb ? "flex-1 border-2 border-border bg-white shadow-brutal-sm px-3 py-2.5 sm:px-3.5 sm:py-3" : "flex-1 rounded-[16px] bg-pastel-yellow px-3 py-2.5 sm:px-3.5 sm:py-3"}>
                <p className={nb ? "font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-foreground" : "font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-[#6b5a2e]"}>Terakhir Online</p>
                <p className="mt-1 font-mono text-[15px] font-bold">{formatShortDate(detail.lastOnline)}</p>
              </div>
            </div>
          </div>

          <div className={nb ? `${NB_PANEL} px-4 py-2` : "rounded-[20px] border bg-card px-4 py-2"}>
            <div className="grid grid-cols-2 gap-x-4">
              <InfoCell label="Lokasi">{detail.board}/{detail.pon}/{detail.onuId}</InfoCell>
              <InfoCell label="Status">
                {nb ? (
                  <OnuStatusPill label={displayStatusTone?.label ?? 'UNKNOWN'} textClass="" dotClass="" />
                ) : (
                  <NmsStatusBadge
                    label={displayStatusTone?.label}
                    size="sm"
                    status={displayStatusTone?.status ?? 'unknown'}
                  />
                )}
              </InfoCell>
              <InfoCell label="Tipe">{detail.type || '-'}</InfoCell>
              <InfoCell label="Serial" mono>{detail.serialNumber || '-'}</InfoCell>
              <InfoCell label="Terakhir Offline">{formatDate(detail.lastOffline)}</InfoCell>
              <InfoCell label="WAN IP" mono>{detail.wanIp || '-'}</InfoCell>
              <InfoCell label="Alasan Offline">{detail.offlineReason || '-'}</InfoCell>
            </div>
          </div>

          <div className="flex gap-2.5">
            <Button
              onClick={() => void fetchDetail(true, true)}
              disabled={refreshing || rebooting}
              className="h-10 flex-1 sm:h-11"
              size="sm"
              variant="outline"
            >
              {refreshing ? 'Memuat…' : '↻ Refresh'}
            </Button>
            <Button
              onClick={handleReboot}
              disabled={rebooting || refreshing}
              className="h-10 flex-1 sm:h-11"
              size="sm"
              variant="destructive"
            >
              {rebooting ? 'Mengirim reboot…' : 'Reboot ONU'}
            </Button>
          </div>
        </div>
      )}
    </ZTEModal>
  )
}
