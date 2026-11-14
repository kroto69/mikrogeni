type ZTESkeletonProps = {
  rows: number
}

export function ZTESkeleton({ rows }: ZTESkeletonProps) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex h-12 items-center rounded-[18px] border bg-muted px-4">
          <div className="h-4 w-full animate-pulse rounded bg-border" />
        </div>
      ))}
    </div>
  )
}
