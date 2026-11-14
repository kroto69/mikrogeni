// Bahasa pastel (disetujui 2026-11-13, mockup v29/v30): blok pastel sama di
// light + dark; teks gelap di atas pastel; pill status berlatar gelap.
export const PASTEL = {
  mint: "#B8E6C9",
  pink: "#FFD6EA",
  yellow: "#FFE6A6",
  lavender: "#D7CAE8",
  grey: "#D9D9D9",
  red: "#F5B5B5",
  ink: "#131313",
} as const;

export type OnuRowTone = "online" | "offline" | "los";

// Baris ONU: ONLINE mint, OFFLINE abu pastel, LOS merah pastel.
export const ONU_ROW_BG: Record<OnuRowTone, string> = {
  online: "bg-pastel-mint",
  offline: "bg-pastel-grey",
  los: "bg-pastel-red",
};

// Teks meta (sub) di atas tiap warna baris — gelap tapi lebih redup.
export const ONU_ROW_META: Record<OnuRowTone, string> = {
  online: "text-[#4a5a50]",
  offline: "text-[#6b6b6b]",
  los: "text-[#6b3a35]",
};

// Pill status: latar gelap, teks + dot warna pastel.
export const ONU_PILL_TEXT: Record<OnuRowTone, string> = {
  online: "text-pastel-mint",
  offline: "text-pastel-grey",
  los: "text-pastel-red",
};
export const ONU_PILL_DOT: Record<OnuRowTone, string> = {
  online: "bg-pastel-mint",
  offline: "bg-pastel-grey",
  los: "bg-pastel-red",
};

// Kualitas RX sebagai pill gelap: Baik → mint, Cukup → kuning, Buruk → merah.
export const RX_QUALITY_PILL_TEXT: Record<"Baik" | "Cukup" | "Buruk", string> = {
  Baik: "text-pastel-mint",
  Cukup: "text-pastel-yellow",
  Buruk: "text-pastel-red",
};
export const RX_QUALITY_PILL_DOT: Record<"Baik" | "Cukup" | "Buruk", string> = {
  Baik: "bg-pastel-mint",
  Cukup: "bg-pastel-yellow",
  Buruk: "bg-pastel-red",
};

// Rotasi warna blok (dashboard OLT, dsb.): mint → lavender → kuning → pink.
// Kelas ditulis lengkap (bukan template string) agar Tailwind memindainya.
export const PASTEL_CYCLE_BG = [
  "bg-pastel-mint",
  "bg-pastel-lavender",
  "bg-pastel-yellow",
  "bg-pastel-pink",
] as const;
export const PASTEL_CYCLE_META = [
  "text-[#4a5a50]",
  "text-[#5c5170]",
  "text-[#6b5a2e]",
  "text-[#6b4a5c]",
] as const;
export const PASTEL_CYCLE_ICON = [
  "text-pastel-mint",
  "text-pastel-lavender",
  "text-pastel-yellow",
  "text-pastel-pink",
] as const;

export function pastelCycleBg(index: number): string {
  return PASTEL_CYCLE_BG[index % PASTEL_CYCLE_BG.length];
}
export function pastelCycleMeta(index: number): string {
  return PASTEL_CYCLE_META[index % PASTEL_CYCLE_META.length];
}
export function pastelCycleIcon(index: number): string {
  return PASTEL_CYCLE_ICON[index % PASTEL_CYCLE_ICON.length];
}

// Kualitas sinyal RX — ambang sama seperti dulu: >−25 Baik, ≥−27 Cukup,
// selebihnya Buruk. rx 0 / null = tidak ada data.
export function rxQuality(rx: number | null | undefined): {
  label: "Baik" | "Cukup" | "Buruk" | "-";
  bar: string;
} {
  if (rx == null || rx === 0) return { label: "-", bar: "#9aa3a8" };
  if (rx > -25) return { label: "Baik", bar: "#16a34a" };
  if (rx >= -27) return { label: "Cukup", bar: "#d97706" };
  return { label: "Buruk", bar: "#dc2626" };
}

// Skala RX −10..−35 dBm → persen lebar bar (v18: −24,5 → 58%).
export function rxBarPercent(rx: number | null | undefined): number {
  if (rx == null || Number.isNaN(rx)) return 0;
  return Math.min(100, Math.max(0, ((-10 - rx) / 25) * 100));
}
