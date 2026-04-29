import { useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'

type ZTEModalProps = {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}

export function ZTEModal({ isOpen, onClose, title, children }: ZTEModalProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    },
    [onClose]
  )

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [isOpen, handleKeyDown])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-2xl rounded-lg border-2 border-black bg-white p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] sm:mx-0 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-sm font-extrabold uppercase tracking-tight sm:text-base">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="border-2 border-black bg-white px-2 py-1 text-[10px] font-extrabold uppercase shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
          >
            X
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}