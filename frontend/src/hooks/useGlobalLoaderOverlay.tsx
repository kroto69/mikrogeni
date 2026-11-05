import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * NOTE (redesign 2026-10-29): this used to render a full-screen blocking
 * overlay with backdrop blur on every Load/Refresh/Sync, freezing the whole
 * UI until the request finished. It now renders only a slim indeterminate
 * progress bar pinned to the top of the viewport: the page stays interactive
 * (scroll, navigate, cancel) while data loads, and buttons that need to guard
 * double-submit keep working via `isGlobalLoading`. The API is unchanged, so
 * all existing callers (ONU, OLT, ZTE pages) keep working as-is.
 */

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
        <div className="global-progress" role="status" aria-label={message}>
          <span className="sr-only">{message}</span>
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
