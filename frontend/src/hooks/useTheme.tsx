import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type ThemeMode = "light" | "dark";
type BrutalStyleMode = "rapi-brutal";

type ThemeContextValue = {
  theme: ThemeMode;
  brutalStyle: BrutalStyleMode;
  setTheme: (theme: ThemeMode) => void;
  setBrutalStyle: (mode: BrutalStyleMode) => void;
  toggleTheme: () => void;
  toggleBrutalStyle: () => void;
};

const THEME_STORAGE_KEY = "network-core-theme";
const BRUTAL_STYLE_STORAGE_KEY = "network-core-brutal-style";

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getPreferredTheme(): ThemeMode {
  return "light";
}

function getPreferredBrutalStyle(): BrutalStyleMode {
  return "rapi-brutal";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => getPreferredTheme());
  const [brutalStyle] = useState<BrutalStyleMode>(() => getPreferredBrutalStyle());

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const root = document.documentElement;
    root.classList.remove("dark");
    root.style.colorScheme = "light";

    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    }
  }, [theme]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const root = document.documentElement;
    root.dataset.styleMode = brutalStyle;

    if (typeof window !== "undefined") {
      window.localStorage.setItem(BRUTAL_STYLE_STORAGE_KEY, brutalStyle);
    }
  }, [brutalStyle]);

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    brutalStyle,
    setTheme: () => setThemeState("light"),
    setBrutalStyle: () => undefined,
    toggleTheme: () => setThemeState("light"),
    toggleBrutalStyle: () => undefined,
  }), [theme, brutalStyle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }

  return context;
}
