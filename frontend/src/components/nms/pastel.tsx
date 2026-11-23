import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/useTheme";
import { isNbStyle } from "@/lib/nb";
import type { ReactNode } from "react";

/** Pill status. Pastel: latar gelap + teks/dot warna pastel.
    Neo-brutalism: SOLID per status (online teal, offline abu, LOS merah
    + teks putih; pill kualitas Baik/Cukup/Buruk putih di atas hero teal).
    Dipilih dari label agar pemakai lama (textClass/dotClass pastel)
    tidak perlu diubah. */
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
  const { styleMode } = useTheme();
  if (isNbStyle(styleMode)) {
    const l = label.trim().toUpperCase();
    let bg = "bg-nb-grey";
    let tx = "text-foreground";
    let dot = "bg-foreground";
    if (l === "ONLINE" || l === "TERDAFTAR") {
      bg = "bg-nb-mint";
    } else if (l === "LOS" || l === "HILANG") {
      bg = "bg-nb-red";
      tx = "text-white";
      dot = "bg-white";
    } else if (l === "BAIK" || l === "CUKUP" || l === "BURUK") {
      bg = "bg-white";
    }
    return (
      <span
        className={cn(
          "inline-flex items-center gap-2 whitespace-nowrap rounded-[8px] border-2 border-border px-3.5 py-2 font-mono text-xs font-extrabold tracking-[0.04em]",
          bg,
          tx,
          className,
        )}
      >
        <i className={cn("h-2 w-2 shrink-0 rounded-full", dot)} />
        {label}
      </span>
    );
  }
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

/** Lingkaran ikon. Pastel: gelap + ikon warna pastel.
    Neo-brutalism: kotak putih ber-border tinta + ikon tinta. */
export function IconDisc({
  iconClass,
  children,
  className,
}: {
  iconClass: string;
  children: ReactNode;
  className?: string;
}) {
  const { styleMode } = useTheme();
  const nb = isNbStyle(styleMode);
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center",
        nb ? "rounded-[10px] border-2 border-border bg-white" : "rounded-full bg-[#131313]",
        className ?? "h-11 w-11",
      )}
    >
      <span className={cn("flex items-center justify-center", nb ? "text-foreground" : iconClass)}>{children}</span>
    </span>
  );
}

/** Bar tipis RX (v18): satu track + isi warna kualitas, tanpa zona/jarum/skala.
    Neo-brutalism: track putih ber-border tinta, isi tinta (bukan warna). */
export function RxBar({
  rx,
  className,
  barColor,
}: {
  rx: number | null | undefined;
  className?: string;
  barColor: string;
}) {
  const { styleMode } = useTheme();
  const nb = isNbStyle(styleMode);
  const percent =
    rx == null || Number.isNaN(rx) ? 0 : Math.min(100, Math.max(0, ((-10 - rx) / 25) * 100));
  return (
    <div
      className={cn(
        nb ? "h-[10px] overflow-hidden rounded-full border-2 border-border bg-white" : "h-2 overflow-hidden rounded-full bg-white/70",
        className,
      )}
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="RX power"
    >
      <div
        className="h-full rounded-full"
        style={{ width: `${percent}%`, backgroundColor: nb ? "hsl(var(--foreground))" : barColor }}
      />
    </div>
  );
}

/** RX besar di list ONU, diletakkan di bawah pill status: label "RX"
    di samping angka (satu baris) agar kartu lebih pendek.
    `rx` = angka terformat tanpa satuan (mis. "-24.50"); null = tidak ada data ("—").
    Neo-brutalism: angka 26px Archivo Black + stroke tinta 0.3px, label hitam pekat.
    Catatan: line-height HARUS menempel di utility text-nya
    (text-[26px]/none) — `leading-none` terpisah dibuang tailwind-merge
    bila digabung cn() dengan text-[Npx]. */
export function RxBig({ rx, metaClass }: { rx: string | null; metaClass?: string }) {
  const { styleMode } = useTheme();
  const nb = isNbStyle(styleMode);
  return (
    <div className="flex items-baseline justify-end gap-1.5">
      <span
        className={cn(
          "font-mono uppercase tracking-[0.12em]",
          nb ? "text-[11px]/none font-extrabold text-foreground" : cn("text-[10px]/none font-bold", metaClass),
        )}
      >
        RX
      </span>
      <span
        className={cn(
          "font-display tracking-[-0.01em]",
          nb ? "nb-stroke text-[26px]/none font-bold" : "text-[22px]/none font-bold",
        )}
      >
        {rx ?? "—"}
        {rx != null && <span className="ml-1 font-mono text-[11px] font-bold">dBm</span>}
      </span>
    </div>
  );
}
