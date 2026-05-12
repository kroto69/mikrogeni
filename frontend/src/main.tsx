import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "@/App";
import { ToastViewport } from "@/components/ui/toast";
import { ThemeProvider } from "@/hooks/useTheme";
import { GlobalLoaderOverlayProvider } from "@/hooks/useGlobalLoaderOverlay";
import { queryClient } from "@/lib/queryClient";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <GlobalLoaderOverlayProvider>
          <App />
          <ToastViewport />
        </GlobalLoaderOverlayProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
