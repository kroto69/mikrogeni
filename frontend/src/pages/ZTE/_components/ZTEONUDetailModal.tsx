import { useState, useEffect } from 'react'
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
  if (rx > -25) return 'text-[#166534] font-extrabold'
  if (rx >= -27) return 'text-amber-600 font-extrabold'
  return 'text-red-600 font-extrabold'
}

function statusBadge(statusCode: number, status: string) {
  if (statusCode === 3)
    return (
      <span className="inline-block rounded-sm bg-cyan-200 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider">
        Online
      </span>
    )
  if (statusCode === 4)
    return (
      <span className="inline-block rounded-sm bg-red-200 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-red-700">
        LOS
      </span>
    )
  if (statusCode === 1)
    return (
      <span className="inline-block rounded-sm bg-gray-200 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-gray-600">
        Offline
      </span>
    )
  if (statusCode === 2)
    return (
      <span className="inline-block rounded-sm bg-amber-200 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-700">
        Ranging
      </span>
    )
  return (
    <span className="inline-block rounded-sm bg-gray-200 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider">
      {status}
    </span>
  )
}

export function ZTEONUDetailModal({ onu, connId, onClose }: ZTEONUDetailModalProps) {
  
  const [detail, setDetail] = useState<ZTEONUDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [rebooting, setRebooting] = useState(false)

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
        <p className="font-extrabold text-red-600 text-sm uppercase">Gagal memuat detail ONU</p>
      )}
      {detail && !loading && !error && (
        <>
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 text-xs sm:grid-cols-2">
            <div>
              <span className="text-[9px] font-extrabold uppercase tracking-wider text-gray-400">Location</span>
              <p className="font-extrabold uppercase">{detail.board}/{detail.pon}/{detail.onuId}</p>
            </div>
            <div>
              <span className="text-[9px] font-extrabold uppercase tracking-wider text-gray-400">Status</span>
              <p className="mt-0.5">{statusBadge(detail.statusCode, detail.status)}</p>
            </div>
            <div>
              <span className="text-[9px] font-extrabold uppercase tracking-wider text-gray-400">Type</span>
              <p className="font-extrabold uppercase">{detail.type || '-'}</p>
            </div>
            <div>
              <span className="text-[9px] font-extrabold uppercase tracking-wider text-gray-400">Serial Number</span>
              <p className="font-mono font-extrabold text-[10px]">{detail.serialNumber || '-'}</p>
            </div>
            <div>
              <span className="text-[9px] font-extrabold uppercase tracking-wider text-gray-400">RX Power</span>
              <p className={cn(rxPowerClass(detail.rxPower))}>{detail.rxPower} dBm</p>
            </div>
            <div>
              <span className="text-[9px] font-extrabold uppercase tracking-wider text-gray-400">TX Power</span>
              <p className="font-extrabold">{detail.txPower} dBm</p>
            </div>
            <div>
              <span className="text-[9px] font-extrabold uppercase tracking-wider text-gray-400">Last Online</span>
              <p className="font-extrabold">{formatDate(detail.lastOnline)}</p>
            </div>
            <div>
              <span className="text-[9px] font-extrabold uppercase tracking-wider text-gray-400">Last Offline</span>
              <p className="font-extrabold">{formatDate(detail.lastOffline)}</p>
            </div>
            <div>
              <span className="text-[9px] font-extrabold uppercase tracking-wider text-gray-400">WAN IP</span>
              <p className="font-extrabold">{detail.wanIp || '-'}</p>
            </div>
            <div>
              <span className="text-[9px] font-extrabold uppercase tracking-wider text-gray-400">Offline Reason</span>
              <p className="font-extrabold">{detail.offlineReason || '-'}</p>
            </div>
          </div>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end sm:gap-3">
            <button
              onClick={() => fetchDetail(true)}
              className="flex-1 border-2 border-black bg-white px-4 py-2 text-[10px] font-extrabold uppercase tracking-wider shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] sm:flex-none"
            >
              REFRESH
            </button>
            <button
              onClick={handleReboot}
              disabled={rebooting}
              className="flex-1 border-2 border-black bg-red-600 px-4 py-2 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50 sm:flex-none"
            >
              REBOOT
            </button>
          </div>
        </>
      )}
    </ZTEModal>
  )
}