import { useEffect, useRef, useState } from "react";
import { Check, Palette } from "lucide-react";
import { useTheme, type StyleMode } from "@/hooks/useTheme";
import { THEME_OPTIONS } from "@/lib/nb";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Swatch latar tiap tema di daftar pilihan. */
const OPTION_SWATCH_BG: Record<string, string> = {
  "nb-a": "#BEF6FE",
  "nb-b": "#F7F7F8",
  pastel: "#B8E6C9",
};

/** Pemilih tema — tiga pilihan (keputusan juragan 2026-11-17):
    Neo-brutalism A "Semula", Neo-brutalism B "Semula Putih", dan
    Pastel (tema yang sudah ada, tetap dipertahankan). Dipakai di
    Topbar (ikon saja) dan halaman Login (dengan label). Pilihan
    tersimpan di localStorage via styleMode dan bertahan setelah reload. */
export function ThemePicker({ showLabel = false }: { showLabel?: boolean }) {
  const { styleMode, setStyleMode } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open ]);

  const current = THEME_OPTIONS.find((o) => o.id === styleMode) ?? THEME_OPTIONS[0];

  return (
    <div className="relative" ref={ref}>
      <Button
        type="button"
        variant="outline"
        size={showLabel ? "default" : "icon"}
        aria-label="Pilih tema"
        aria-expanded={open}
        title={`Tema: ${current.label} — ${current.hint}`}
        className={cn(showLabel ? "h-11 w-auto gap-2 px-4" : "h-9 w-9 sm:h-10 sm:w-10")}
        onClick={() => setOpen((v) => !v)}
      >
        <Palette className="h-4 w-4 shrink-0" />
        {showLabel ? <span className="whitespace-nowrap">{current.label}</span> : null}
      </Button>
      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-60 rounded-[12px] border-2 border-border bg-card p-1.5 shadow-brutal">
          <p className="px-3 pb-1 pt-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Tema tampilan
          </p>
          {THEME_OPTIONS.map((opt) => {
            const active = styleMode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setStyleMode(opt.id as StyleMode);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-[8px] px-3 py-2.5 text-left text-sm font-bold text-foreground transition-colors hover:bg-muted",
                  active && "bg-muted",
                )}
              >
                <span className="flex h-6 w-6 shrink-0 items-stretch overflow-hidden rounded-[6px] border border-border">
                  <i className="h-full w-1/2" style={{ backgroundColor: OPTION_SWATCH_BG[opt.id] ?? "#ffffff" }} />
                  <i className="h-full w-1/2" style={{ backgroundColor: "#EA435F" }} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{opt.label}</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">{opt.hint}</span>
                </span>
                {active ? <Check className="h-4 w-4 shrink-0" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
