import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-display)"],
        body: ["var(--font-body)"],
        mono: ["var(--font-mono)"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        sidebar: "hsl(var(--sidebar))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        complementary: {
          DEFAULT: "hsl(var(--complementary))",
          foreground: "hsl(var(--complementary-foreground))",
        },
        // Warna jenuh neo-brutalism (mockup 2026-11-17, bersama A+B).
        nb: {
          mint: "#54CFC0",
          butter: "#FFD95C",
          red: "#D0112D",
          orange: "#F07C00",
          accent: "#EA435F",
          grey: "#E8E8E3",
        },
        // Blok pastel (mockup v29/v30) — sama di light + dark, jadi hex
        // mentah, bukan token HSL yang berubah per mode.
        pastel: {
          mint: "#B8E6C9",
          pink: "#FFD6EA",
          yellow: "#FFE6A6",
          lavender: "#D7CAE8",
          grey: "#D9D9D9",
          red: "#F5B5B5",
          ink: "#131313",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xl: "calc(var(--radius) + 0.25rem)",
        "2xl": "calc(var(--radius) + 0.5rem)",
      },
      boxShadow: {
        // Nama "brutal" dipertahankan agar kelas lama tetap jalan, tapi
        // isinya bayangan lembut ala pastel — bukan offset keras.
        brutal: "0 1px 2px rgb(0 0 0 / 0.05), 0 8px 24px rgb(0 0 0 / 0.08)",
        "brutal-sm": "0 1px 2px rgb(0 0 0 / 0.06)",
        "brutal-lg": "0 4px 12px rgb(0 0 0 / 0.08), 0 16px 40px rgb(0 0 0 / 0.12)",
        panel: "0 1px 2px rgb(0 0 0 / 0.05), 0 8px 24px rgb(0 0 0 / 0.08)",
      },
      backgroundImage: {
        "grid-soft": "linear-gradient(to right, rgba(0,0,0,0.08) 2px, transparent 2px), linear-gradient(to bottom, rgba(0,0,0,0.08) 2px, transparent 2px)",
      },
    },
  },
  plugins: [],
} satisfies Config;
