import { useState, useEffect } from 'react'
import { StatusBadge as NmsStatusBadge } from '@/components/nms/status-badge'
import { Button } from '@/components/ui/button'
import type { NmsStatus } from '@/lib/status-tone'
import { ZTEModal } from './ZTEModal'
import { ZTESkeleton } from './ZTESkeleton'
import { getZTEONUDetail, rebootZTEONU, getApiErrorMessage } from '@/lib/zteApi'
import { showToast } from '@/lib/toast'
import { cn } from '@/lib/utils'

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

function rxPowerClass(rx: number): string {
  if (rx > -25) return 'text-success font-extrabold'
  if (rx >= -27) return 'text-warning font-extrabold'
  return 'text-destructive font-extrabold'
}

function mapDetailStatusTone(statusCode: number, status: string): { status: NmsStatus; label: string } {
  if (statusCode === 3) return { status: 'online', label: 'ONLINE' }
  if (statusCode === 4) return { status: 'critical', label: 'LOS' }
  if (statusCode === 1) return { status: 'offline', label: 'OFFLINE' }
  if (statusCode === 2) return { status: 'provisioning', label: 'RANGING' }
  if (statusCode === 5) return { status: 'warning', label: 'DYING GASP' }
  if (statusCode === 6) return { status: 'down', label: 'POWER OFF' }

  const normalized = status.trim().toUpperCase()
  return { status: 'unknown', label: normalized || 'UNKNOWN' }
}

export function ZTEONUDetailModal({ onu, connId, onClose }: ZTEONUDetailModalProps) {
  const [detail, setDetail] = useState<ZTEONUDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [rebooting, setRebooting] = useState(false)
  const detailStatusTone = detail ? mapDetailStatusTone(detail.statusCode, detail.status) : null

  const fetchDetail = async (fresh?: boolean) => {
    setLoading(true)
    setError(false)
    try {
      const data = await getZTEONUDetail(connId, onu.board, onu.pon, onu.onuId, fresh)
      setDetail(data)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDetail()
  }, [])

  const handleReboot = async () => {
    if (!window.confirm(`Reboot ONU ${onu.name || onu.onuId}?`)) return
    setRebooting(true)
    try {
      await rebootZTEONU(connId, onu.board, onu.pon, onu.onuId)
      showToast({ title: 'Reboot berhasil', variant: 'success' })
    } catch (err) {
      showToast({ title: 'Reboot gagal', description: getApiErrorMessage(err), variant: 'error' })
    } finally {
      setRebooting(false)
    }
  }

  return (
    <ZTEModal isOpen onClose={onClose} title={`${onu.name || `ONU ${onu.onuId}`}`}>
      {loading && <ZTESkeleton rows={4} />}
      {error && (
        <p className="rounded-none border-2 border-border bg-destructive/10 px-3 py-2 text-sm font-extrabold uppercase text-destructive">Gagal memuat detail ONU</p>
      )}
      {detail && !loading && !error && (
        <>
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 text-xs sm:grid-cols-2">
            <div className="min-w-0">
              <span className="text-[9px] font-extrabold uppercase tracking-wider text-muted-foreground">Location</span>
              <p className="font-extrabold uppercase">{detail.board}/{detail.pon}/{detail.onuId}</p>
            </div>
            <div className="min-w-0">
              <span className="text-[9px] font-extrabold uppercase tracking-wider text-muted-foreground">Status</span>
              <div className="mt-0.5">
                <NmsStatusBadge
                  label={detailStatusTone?.label}
                  size="sm"
                  status={detailStatusTone?.status ?? 'unknown'}
                />
              </div>
            </div>
            <div className="min-w-0">
              <span className="text-[9px] font-extrabold uppercase tracking-wider text-muted-foreground">Type</span>
              <p className="break-words font-extrabold uppercase">{detail.type || '-'}</p>
            </div>
            <div className="min-w-0">
              <span className="text-[9px] font-extrabold uppercase tracking-wider text-muted-foreground">Serial Number</span>
              <p className="break-all font-mono font-extrabold text-[10px]">{detail.serialNumber || '-'}</p>
            </div>
            <div className="min-w-0">
              <span className="text-[9px] font-extrabold uppercase tracking-wider text-muted-foreground">RX Power</span>
              <p className={cn(rxPowerClass(detail.rxPower))}>{detail.rxPower} dBm</p>
            </div>
            <div className="min-w-0">
              <span className="text-[9px] font-extrabold uppercase tracking-wider text-muted-foreground">TX Power</span>
              <p className="font-extrabold">{detail.txPower} dBm</p>
            </div>
            <div className="min-w-0">
              <span className="text-[9px] font-extrabold uppercase tracking-wider text-muted-foreground">Last Online</span>
              <p className="font-extrabold">{formatDate(detail.lastOnline)}</p>
            </div>
            <div className="min-w-0">
              <span className="text-[9px] font-extrabold uppercase tracking-wider text-muted-foreground">Last Offline</span>
              <p className="font-extrabold">{formatDate(detail.lastOffline)}</p>
            </div>
            <div className="min-w-0">
              <span className="text-[9px] font-extrabold uppercase tracking-wider text-muted-foreground">WAN IP</span>
              <p className="break-all font-extrabold">{detail.wanIp || '-'}</p>
            </div>
            <div className="min-w-0">
              <span className="text-[9px] font-extrabold uppercase tracking-wider text-muted-foreground">Offline Reason</span>
              <p className="break-words font-extrabold">{detail.offlineReason || '-'}</p>
            </div>
          </div>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end sm:gap-3">
            <Button
              onClick={() => fetchDetail(true)}
              className="h-10 flex-1 sm:flex-none"
              size="sm"
              variant="outline"
            >
              REFRESH
            </Button>
            <Button
              onClick={handleReboot}
              disabled={rebooting}
              className="h-10 flex-1 sm:flex-none"
              size="sm"
              variant="destructive"
            >
              REBOOT
            </Button>
          </div>
        </>
      )}
    </ZTEModal>
  )
}
