"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Search, X } from "lucide-react";

export type PickerOption = {
  value: string;
  label: string;
  description?: string;
};

type PickerPopupProps = {
  open: boolean;
  title: string;
  options: PickerOption[];
  selectedValue?: string;
  // grid: tombol angka rapat (board) — ringkas untuk puluhan hingga
  // ratusan pilihan; list: baris ke bawah "NOMOR: nama" — nomor tebal
  // + nama apa adanya (tanpa uppercase, nama area tak boleh diubah
  // bentuknya), agar operator yang tak hafal nama tetap bisa
  // mencocokkan nomor dan nama sekaligus.
  layout?: "grid" | "list";
  // searchable: kolom cari di atas daftar (untuk opsi yang dikenali
  // lewat nama, mis. PON ZTE) — filter mencocokkan label + deskripsi.
  searchable?: boolean;
  searchPlaceholder?: string;
  onSelect: (value: string) => void;
  onClose: () => void;
};

// Popup picker tengah layar sebagai pengganti dropdown Select untuk
// daftar panjang (port/board/PON): punya area scroll sendiri
// (max 70dvh) sehingga tetap nyaman walau opsinya puluhan hingga
// ratusan, tanpa tergantung posisi trigger di halaman.
export function PickerPopup({
  open,
  title,
  options,
  selectedValue,
  layout = "grid",
  searchable = false,
  searchPlaceholder,
  onSelect,
  onClose,
}: PickerPopupProps) {
  const [query, setQuery] = useState("");
  // Query cari dibersihkan tiap popup ditutup (backdrop/X/pilih),
  // jadi pembukaan berikutnya selalu mulai dari daftar penuh — tanpa
  // effect (setState dalam effect dilarang config eslint proyek ini).
  const handleClose = () => {
    setQuery("");
    onClose();
  };
  // Escape menutup popup (portal custom ini tak mewarisi perilaku
  // Dialog Radix). setState di sini ada di callback listener, bukan
  // sinkron di body effect — pola yang diizinkan eslint proyek ini.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setQuery("");
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);
  const visibleOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return options;
    }
    return options.filter((option) =>
      `${option.label} ${option.description ?? ""}`.toLowerCase().includes(q),
    );
  }, [options, query]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[220] flex items-center justify-center overflow-y-auto bg-foreground/35 p-3 sm:p-6">
      <button aria-label="Tutup popup" className="absolute inset-0" onClick={handleClose} type="button" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 my-auto box-border max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-hidden rounded-[28px] border-2 border-border bg-card shadow-brutal-lg"
      >
        <div className="flex items-center justify-between gap-3 border-b-2 border-border px-5 py-4">
          <h3 className="text-lg font-black uppercase tracking-[0.04em] text-foreground">{title}</h3>
          <button
            aria-label="Tutup"
            className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={handleClose}
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {searchable ? (
          <div className="px-5 pt-4">
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <input
                aria-label="Cari pilihan"
                className="h-11 w-full rounded-lg border-2 border-input bg-card pl-9 pr-3 text-sm font-semibold text-foreground shadow-brutal-sm outline-none placeholder:text-muted-foreground"
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder ?? "Cari…"}
                type="text"
                value={query}
              />
            </div>
          </div>
        ) : null}
        <div className="max-h-[70dvh] overflow-y-auto px-5 py-4">
          {options.length === 0 ? (
            <p className="py-4 text-center text-sm font-semibold text-muted-foreground">Tidak ada pilihan.</p>
          ) : visibleOptions.length === 0 ? (
            <p className="py-4 text-center text-sm font-semibold text-muted-foreground">
              Tidak ada yang cocok dengan “{query.trim()}”.
            </p>
          ) : layout === "grid" ? (
            <div className="grid grid-cols-4 gap-2">
              {visibleOptions.map((option) => {
                const selected = option.value === selectedValue;
                return (
                  <button
                    aria-pressed={selected}
                    className={`h-11 rounded-lg border-2 px-2 text-sm font-black uppercase shadow-brutal-sm ${
                      selected
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-border bg-card text-foreground hover:bg-muted"
                    }`}
                    key={option.value}
                    onClick={() => {
                      onSelect(option.value);
                      handleClose();
                    }}
                    type="button"
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2">
              {visibleOptions.map((option) => {
                const selected = option.value === selectedValue;
                return (
                  <button
                    aria-pressed={selected}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg border-2 px-3 py-2.5 text-left shadow-brutal-sm ${
                      selected ? "border-blue-600 bg-blue-600/10" : "border-border bg-card hover:bg-muted"
                    }`}
                    key={option.value}
                    onClick={() => {
                      onSelect(option.value);
                      handleClose();
                    }}
                    type="button"
                  >
                    <span className="min-w-0 flex-1 text-left text-sm text-foreground">
                      <span className="font-black uppercase">{option.label}</span>
                      {option.description ? <span className="font-semibold">: {option.description}</span> : null}
                    </span>
                    {selected ? <Check className="h-5 w-5 shrink-0 text-blue-600" /> : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
