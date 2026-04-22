import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageSectionHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  badge?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function PageSectionHeader({
  title,
  description,
  badge,
  meta,
  actions,
  className,
}: PageSectionHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            {badge ? <div className="flex-shrink-0">{badge}</div> : null}
            <div className="min-w-0">{title}</div>
          </div>
          {description ? <div className="mt-1">{description}</div> : null}
        </div>
        {meta ? <div className="mt-1 sm:mt-0 flex-shrink-0">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
