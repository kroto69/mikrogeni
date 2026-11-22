import { useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useTheme } from '@/hooks/useTheme';
import { isNbStyle } from '@/lib/nb';
import { cn } from '@/lib/utils'

type ZTEModalProps = {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}

export function ZTEModal({ isOpen, onClose, title, children }: ZTEModalProps) {
  const { styleMode } = useTheme();
  const nb = isNbStyle(styleMode);
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

  return createPortal(
    <div className="fixed inset-0 z-[220] flex items-center justify-center overflow-y-auto bg-black/50 p-3 backdrop-blur-[3px] sm:p-6">
      <button aria-label="Close overlay" className="absolute inset-0" onClick={onClose} type="button" />
      <div className="relative z-10 my-auto box-border max-h-[calc(100dvh-1.5rem)] w-full max-w-[calc(100vw-1.5rem)] overflow-x-hidden overflow-y-auto rounded-[24px] border border-border bg-card shadow-xl sm:max-h-[90vh] sm:max-w-lg">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h3 className={cn("font-display font-bold tracking-[-0.01em] text-foreground", nb ? "nb-stroke text-[22px] sm:text-[27px]" : "text-lg")}>{title}</h3>
          <button onClick={onClose} type="button" className={cn("shrink-0 rounded-full p-2 hover:text-foreground", nb ? "border-2 border-border bg-white text-foreground shadow-brutal-sm" : "bg-muted text-muted-foreground hover:bg-muted")}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
