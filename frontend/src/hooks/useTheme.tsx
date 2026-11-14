import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type ThemeMode = "light" | "dark";
type StyleMode = "pastel" | "rapi-brutal";

type ThemeContextValue = {
  theme: ThemeMode;
  styleMode: StyleMode;
  setTheme: (theme: ThemeMode) => void;
  setStyleMode: (mode: StyleMode) => void;
  toggleTheme: () => void;
  toggleStyleMode: () => void;
};

const THEME_STORAGE_KEY = "network-core-theme";
const STYLE_STORAGE_KEY = "network-core-style-mode";
const LEGACY_STYLE_STORAGE_KEY = "network-core-brutal-style";

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getPreferredTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "dark";
  }
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") {
    return stored;
  }
  // Default: dark — mode utama bahasa pastel yang disetujui (v29/v30).
  return "dark";
}

function getPreferredStyleMode(): StyleMode {
  if (typeof window === "undefined") {
    return "pastel";
  }
  const stored =
    window.localStorage.getItem(STYLE_STORAGE_KEY) ??
    window.localStorage.getItem(LEGACY_STYLE_STORAGE_KEY);
  if (stored === "pastel" || stored === "rapi-brutal") {
    return stored;
  }
  return "pastel";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => getPreferredTheme());
  const [styleMode, setStyleModeState] = useState<StyleMode>(() => getPreferredStyleMode());

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;

    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  }, [theme]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const root = document.documentElement;
    root.dataset.styleMode = styleMode;

    if (typeof window !== "undefined") {
      window.localStorage.setItem(STYLE_STORAGE_KEY, styleMode);
    }
  }, [styleMode]);

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    styleMode,
    setTheme: (next: ThemeMode) => setThemeState(next),
    setStyleMode: (next: StyleMode) => setStyleModeState(next),
    toggleTheme: () => setThemeState((current) => (current === "dark" ? "light" : "dark")),
    toggleStyleMode: () => setStyleModeState((current) => (current === "pastel" ? "rapi-brutal" : "pastel")),
  }), [theme, styleMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }

  return context;
}
