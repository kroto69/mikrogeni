import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";

type OltSelectorContextValue = {
  selectedOltId: string | null;
  setSelectedOltId: (oltId: string | null) => void;
};

const OLT_SELECTOR_STORAGE_KEY = "network-core.selected-olt-id";
const OltSelectorContext = createContext<OltSelectorContextValue | undefined>(undefined);

function getStoredSelectedOltId() {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(OLT_SELECTOR_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

export function OltSelectorProvider({ children }: PropsWithChildren) {
  const [selectedOltId, setSelectedOltIdState] = useState<string | null>(() => getStoredSelectedOltId());

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!selectedOltId) {
      window.localStorage.removeItem(OLT_SELECTOR_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(OLT_SELECTOR_STORAGE_KEY, selectedOltId);
  }, [selectedOltId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const syncFromStorage = (event: StorageEvent) => {
      if (event.key !== OLT_SELECTOR_STORAGE_KEY) {
        return;
      }

      const next = event.newValue?.trim() || null;
      setSelectedOltIdState(next);
    };

    window.addEventListener("storage", syncFromStorage);
    return () => window.removeEventListener("storage", syncFromStorage);
  }, []);

  const value = useMemo<OltSelectorContextValue>(() => ({
    selectedOltId,
    setSelectedOltId: (oltId) => {
      const normalized = oltId?.trim() || null;
      setSelectedOltIdState(normalized);
    },
  }), [selectedOltId]);

  return <OltSelectorContext.Provider value={value}>{children}</OltSelectorContext.Provider>;
}

export function useOltSelector() {
  const context = useContext(OltSelectorContext);
  if (!context) {
    throw new Error("useOltSelector must be used within OltSelectorProvider");
  }

  return context;
}
