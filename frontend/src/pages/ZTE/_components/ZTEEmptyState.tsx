import { GitBranch, WifiOff, Inbox } from 'lucide-react'
import { Link } from 'react-router-dom'

type EmptyIcon = 'pon' | 'error' | 'empty'

type ZTEEmptyStateProps = {
  icon: EmptyIcon
  title: string
  description: string
  actionLabel?: string
  actionHref?: string
}

const iconMap: Record<EmptyIcon, React.ElementType> = {
  pon: GitBranch,
  error: WifiOff,
  empty: Inbox,
}

export function ZTEEmptyState({ icon, title, description, actionLabel, actionHref }: ZTEEmptyStateProps) {
  const Icon = iconMap[icon]

  return (
    <div className="neo-panel border-2 border-border p-6 text-center sm:p-12">
      <Icon className="mx-auto mb-4 h-8 w-8 text-muted-foreground sm:h-12 sm:w-12" />
      <p className="font-heading text-lg font-bold uppercase">{title}</p>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      {actionLabel && actionHref && (
        <Link
          to={actionHref}
          className="neo-panel neo-interactive mt-4 inline-flex items-center justify-center rounded-lg border-2 border-border bg-card px-4 py-2 text-sm font-extrabold uppercase tracking-[0.06em] text-foreground shadow-brutal-sm transition-all hover:-translate-x-[1px] hover:-translate-y-[1px] hover:bg-accent hover:text-accent-foreground hover:shadow-brutal"
        >
          {actionLabel}
        </Link>
      )}
    </div>
  )
}
