import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
        <input
          ref={ref}
          type={type}
          className={cn(
          "neo-panel flex h-11 w-full rounded-lg border-2 border-input bg-card px-3 py-2 font-body text-sm text-foreground shadow-brutal-sm transition-all placeholder:text-muted-foreground focus-visible:-translate-x-[1px] focus-visible:-translate-y-[1px] focus-visible:shadow-brutal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);

Input.displayName = "Input";

export { Input };
