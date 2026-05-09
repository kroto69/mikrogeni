import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

import { Badge } from "@/components/ui/badge";
import { getNmsStatusTone, type NmsStatus } from "@/lib/status-tone";
import { cn } from "@/lib/utils";

const statusBadgeSizeVariants = cva("", {
  variants: {
    size: {
      sm: "px-2 py-0.5 text-[10px] tracking-[0.12em]",
      md: "px-2.5 py-1 text-[11px] tracking-[0.14em]",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

type StatusBadgeProps = Omit<ComponentPropsWithoutRef<typeof Badge>, "children" | "variant"> &
  VariantProps<typeof statusBadgeSizeVariants> & {
    status: NmsStatus;
    label?: string;
  };

export function StatusBadge({ className, label, size, status, ...props }: StatusBadgeProps) {
  const tone = getNmsStatusTone(status);

  return (
    <Badge
      aria-label={`status-${status}`}
      className={cn(
        "rounded-lg border-2 font-extrabold uppercase",
        tone.className,
        statusBadgeSizeVariants({ size }),
        className,
      )}
      {...props}
    >
      {label ?? tone.label}
    </Badge>
  );
}

export type { StatusBadgeProps };
