import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/** Pill status bahasa pastel: latar gelap + teks/dot warna pastel. */
export function OnuStatusPill({
  label,
  textClass,
  dotClass,
  className,
}: {
  label: string;
  textClass: string;
  dotClass: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-[#131313] px-4 py-2 font-mono text-xs font-bold tracking-[0.04em]",
        textClass,
        className,
      )}
    >
      <i className={cn("h-2 w-2 shrink-0 rounded-full", dotClass)} />
      {label}
    </span>
  );
}

/** Lingkaran ikon gelap dengan ikon warna pastel (ala mockup v29/v30). */
export function IconDisc({
  iconClass,
  children,
  className,
}: {
  iconClass: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-[#131313]",
        className ?? "h-11 w-11",
      )}
    >
      <span className={cn("flex items-center justify-center", iconClass)}>{children}</span>
    </span>
  );
}

/** Bar tipis RX (v18): satu track + isi warna kualitas, tanpa zona/jarum/skala. */
export function RxBar({
  rx,
  className,
  barColor,
}: {
  rx: number | null | undefined;
  className?: string;
  barColor: string;
}) {
  const percent =
    rx == null || Number.isNaN(rx) ? 0 : Math.min(100, Math.max(0, ((-10 - rx) / 25) * 100));
  return (
    <div
      className={cn("h-2 overflow-hidden rounded-full bg-white/70", className)}
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="RX power"
    >
      <div className="h-full rounded-full" style={{ width: `${percent}%`, backgroundColor: barColor }} />
    </div>
  );
}
