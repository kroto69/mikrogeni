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
    <div className="rounded-[20px] border bg-card p-6 text-center sm:p-12">
      <Icon className="mx-auto mb-4 h-8 w-8 text-muted-foreground sm:h-12 sm:w-12" />
      <p className="font-heading text-lg font-bold uppercase">{title}</p>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      {actionLabel && actionHref && (
        <Link
          to={actionHref}
          className="mt-4 inline-flex items-center justify-center rounded-full border border-border bg-card px-4 py-2 text-sm font-extrabold uppercase tracking-[0.06em] text-foreground transition-colors hover:bg-muted"
        >
          {actionLabel}
        </Link>
      )}
    </div>
  )
}
