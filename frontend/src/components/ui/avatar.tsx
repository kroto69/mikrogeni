import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type AvatarProps = HTMLAttributes<HTMLDivElement> & {
  fallback: string;
};

export function Avatar({ className, fallback, ...props }: AvatarProps) {
  return (
    <div
        className={cn(
          "neo-panel flex h-10 w-10 items-center justify-center rounded-lg border-2 border-border bg-primary font-body text-sm font-extrabold text-primary-foreground shadow-brutal-sm",
          className,
        )}
      {...props}
    >
      {fallback}
    </div>
  );
}
