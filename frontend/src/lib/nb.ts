// Bahasa neo-brutalism fresh modern (mockup 2026-11-17, revisi 1-9):
// dua arah — A "Semula" (bg cyan #BEF6FE) dan B "Semula Putih"
// (bg #F7F7F8). Keduanya light-only, dipilih lewat pemilih tema
// (Topbar + halaman login), tersimpan di localStorage via styleMode
// ("nb-a" / "nb-b", lihat hooks/useTheme). Default: nb-a.
//
// Aturan yang dipatuhi di seluruh restyle:
//  1. Baris list ONU PUTIH semua status.
//  2. Pill status SOLID per status (online teal, offline abu, LOS merah).
//  3. Palet original jenuh, BUKAN pastel.
//  4. Tanpa blok hitam solid (kotak ikon/tombol putih ber-border tinta).
//  5. Dashboard kalem: blok stat putih + strip warna 6px, blok OLT putih.
//  6. Background grid 32px + ornamen 2D datar (bukan isometrik/3D).
//  7. Teks BOLD (weight 800; nama/RX angka Archivo Black).
//  8. Teks detail HITAM PEKAT (tanpa abu MUTED, tanpa opacity).
//  9. Nama ONU + angka RX besar + -webkit-text-stroke 0.3px tinta (0.6px terlalu tebal, 2026-11-22).
//
// Warna jenuh bersama kedua arah (token Tailwind `nb-*`, lihat
// tailwind.config.ts); tinta/permukaan mengikuti --foreground/--card
// yang berbeda per arah (lihat index.css).
import type { StyleMode } from "@/hooks/useTheme";

export function isNbStyle(styleMode: StyleMode | string): boolean {
  return styleMode === "nb-a" || styleMode === "nb-b";
}

export function nbLetter(styleMode: StyleMode | string): "A" | "B" | null {
  if (styleMode === "nb-a") return "A";
  if (styleMode === "nb-b") return "B";
  return null;
}

/** Opsi pemilih tema (Topbar + Login). */
export const THEME_OPTIONS: ReadonlyArray<{ id: StyleMode; label: string; hint: string }> = [
  { id: "nb-a", label: "Neo A", hint: "Semula" },
  { id: "nb-b", label: "Neo B", hint: "Semula Putih" },
  { id: "pastel", label: "Pastel", hint: "v29/v30" },
];

/** Strip warna 6px di atas blok stat dashboard, per urutan stat
    (ONU Online, MikroTik, PPPoE Aktif, OLT). A: pink/teal/kuning/oranye;
    B: teal/pink/kuning/tinta. */
export const NB_STAT_STRIPS: Record<"a" | "b", string[]> = {
  a: ["#EA435F", "#54CFC0", "#FFD95C", "#F07C00"],
  b: ["#54CFC0", "#EA435F", "#FFD95C", "#121216"],
};

export function nbStatStrip(styleMode: StyleMode | string, index: number): string {
  const letter = nbLetter(styleMode) ?? "a";
  const strips = NB_STAT_STRIPS[letter.toLowerCase() as "a" | "b"];
  return strips[index % strips.length];
}

/** Baris list ONU mode nb: putih + border tinta 2px + shadow keras.
    Menggantikan ONU_ROW_BG[tone] (pastel: kartu penuh warna status). */
export const NB_ROW_BG = "border-2 border-border bg-white text-foreground shadow-brutal";

/** Teks meta di baris ONU mode nb: hitam pekat (bukan ONU_ROW_META
    yang berwarna redup per status). */
export const NB_ROW_META = "text-foreground";

/** Tombol panah "go" di baris ONU mode nb: putih + border tinta
    (bukan lingkaran hitam). */
export const NB_GO_BTN =
  "flex h-9 w-9 items-center justify-center rounded-[10px] border-2 border-border bg-white text-foreground shadow-brutal-sm";

/** Pill filter cepat (TOTAL/ONLINE/LOS/OFFLINE) mode nb. */
export const NB_STAT_PILL: Record<"total" | "online" | "los" | "offline", string> = {
  total: "border-2 border-border bg-white text-foreground",
  online: "border-2 border-border bg-nb-mint text-foreground",
  los: "border-2 border-border bg-nb-red text-white",
  offline: "border-2 border-border bg-nb-grey text-foreground",
};

/** Kartu panel (header/toolbar) mode nb: putih + border tinta + shadow. */
export const NB_PANEL = "border-2 border-border bg-card shadow-brutal";

/** Blok OLT dashboard + blok aktivitas mode nb: putih, meta hitam. */
export const NB_BLOCK_BG = "bg-white";
export const NB_BLOCK_META = "text-foreground";

/** Blok "PERLU PERHATIAN" dashboard mode nb: kuning solid. */
export const NB_ATTENTION_BG = "bg-nb-butter";
