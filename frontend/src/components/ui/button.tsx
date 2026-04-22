import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "neo-panel neo-interactive inline-flex items-center justify-center gap-2 rounded-lg border-2 border-border font-body text-sm font-extrabold uppercase tracking-[0.06em] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-brutal-sm hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-brutal active:translate-x-[1px] active:translate-y-[1px] active:shadow-none",
        secondary: "bg-secondary text-secondary-foreground shadow-brutal-sm hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-brutal active:translate-x-[1px] active:translate-y-[1px] active:shadow-none",
        outline: "bg-card text-foreground shadow-brutal-sm hover:bg-accent hover:text-accent-foreground hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-brutal active:translate-x-[1px] active:translate-y-[1px] active:shadow-none",
        ghost: "border-transparent bg-transparent text-foreground shadow-none hover:border-border hover:bg-muted/40 hover:shadow-brutal-sm",
        destructive: "bg-destructive text-destructive-foreground shadow-brutal-sm hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-brutal active:translate-x-[1px] active:translate-y-[1px] active:shadow-none",
      },
      size: {
        default: "h-11 px-4 py-2",
        sm: "h-9 px-3 text-xs",
        lg: "h-12 px-6",
        icon: "h-10 w-10 px-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);

Button.displayName = "Button";

export { Button, buttonVariants };
