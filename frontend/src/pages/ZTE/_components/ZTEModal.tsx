import { useEffect, useCallback } from 'react'

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
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-foreground/50 p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        className="neo-panel box-border my-auto max-h-[calc(100dvh-1.5rem)] w-full max-w-[calc(100vw-1.5rem)] overflow-x-hidden overflow-y-auto rounded-none border-2 border-border bg-card p-4 text-card-foreground shadow-brutal sm:max-h-[90dvh] sm:max-w-lg sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between border-b-2 border-border pb-3">
          <h2 className="font-heading text-sm font-extrabold uppercase tracking-tight sm:text-base">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="neo-panel neo-interactive rounded-none border-2 border-border bg-card px-2 py-1 text-[10px] font-extrabold uppercase shadow-brutal-sm transition-all hover:-translate-x-[1px] hover:-translate-y-[1px] hover:bg-accent hover:text-accent-foreground hover:shadow-brutal"
          >
            X
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
