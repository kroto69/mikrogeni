import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Loader } from "@/components/retroui/Loader";

type GlobalLoaderOverlayContextValue = {
  isGlobalLoading: boolean;
  showGlobalLoader: (message?: string) => void;
  hideGlobalLoader: () => void;
  runWithGlobalLoader: <T>(task: () => Promise<T>, message?: string) => Promise<T>;
};

const DEFAULT_MESSAGE = "Loading...";

const GlobalLoaderOverlayContext = createContext<GlobalLoaderOverlayContextValue | null>(null);

export function GlobalLoaderOverlayProvider({ children }: { children: ReactNode }) {
  const [activeCount, setActiveCount] = useState(0);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);

  const showGlobalLoader = useCallback((nextMessage?: string) => {
    if (nextMessage) {
      setMessage(nextMessage);
    }
    setActiveCount((prev) => prev + 1);
  }, []);

  const hideGlobalLoader = useCallback(() => {
    setActiveCount((prev) => {
      const next = Math.max(0, prev - 1);
      if (next === 0) {
        setMessage(DEFAULT_MESSAGE);
      }
      return next;
    });
  }, []);

  const runWithGlobalLoader = useCallback(async <T,>(task: () => Promise<T>, nextMessage?: string) => {
    showGlobalLoader(nextMessage);
    try {
      return await task();
    } finally {
      hideGlobalLoader();
    }
  }, [hideGlobalLoader, showGlobalLoader]);

  const isGlobalLoading = activeCount > 0;

  const value = useMemo<GlobalLoaderOverlayContextValue>(() => ({
    isGlobalLoading,
    showGlobalLoader,
    hideGlobalLoader,
    runWithGlobalLoader,
  }), [hideGlobalLoader, isGlobalLoading, runWithGlobalLoader, showGlobalLoader]);

  return (
    <GlobalLoaderOverlayContext.Provider value={value}>
      {children}

      {isGlobalLoading ? (
        <div className="fixed inset-0 z-[240] grid place-items-center bg-foreground/35 p-4 backdrop-blur-sm">
          <div className="neo-panel flex min-w-[16rem] max-w-[22rem] flex-col items-center gap-3 border-2 border-border bg-card px-5 py-5 text-center shadow-brutal">
            <Loader size="lg" variant="default" />
            <p className="text-sm font-black uppercase tracking-[0.06em] text-foreground">{message}</p>
          </div>
        </div>
      ) : null}
    </GlobalLoaderOverlayContext.Provider>
  );
}

export function useGlobalLoaderOverlay() {
  const context = useContext(GlobalLoaderOverlayContext);
  if (!context) {
    throw new Error("useGlobalLoaderOverlay must be used inside GlobalLoaderOverlayProvider");
  }
  return context;
}
