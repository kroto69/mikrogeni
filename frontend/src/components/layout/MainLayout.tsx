import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "@/components/layout/Sidebar";
import Topbar from "@/components/layout/Topbar";
import { cn } from "@/lib/utils";

export default function MainLayout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    if (isSidebarOpen) {
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isSidebarOpen]);

  useEffect(() => {
    if (!isSidebarOpen || typeof window === "undefined") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSidebarOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSidebarOpen]);

  return (
    <div className="main-layout-surface neo-shell min-h-screen overflow-x-hidden bg-background font-body text-foreground">
      <div className="hidden xl:block">
        <Sidebar className="fixed inset-y-0 left-0 z-30 h-screen w-72 overflow-y-auto" />
      </div>

      <div
        aria-hidden={!isSidebarOpen}
        aria-modal={isSidebarOpen}
        className={cn(
          "fixed inset-0 z-50 transition-opacity duration-200 xl:hidden",
          isSidebarOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setIsSidebarOpen(false)}
        role="dialog"
      >
        <div className="sidebar-drawer-overlay absolute inset-0 bg-foreground/35 backdrop-blur-[1px]" />
        <div
          className={cn(
            "sidebar-drawer-surface absolute inset-y-0 left-0 w-[88vw] max-w-72 transition-transform duration-200",
            isSidebarOpen ? "translate-x-0" : "-translate-x-full",
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <Sidebar onNavigate={() => setIsSidebarOpen(false)} />
        </div>
      </div>

      <div className="xl:pl-72">
        <div className="min-h-screen flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="flex min-h-full flex-col bg-background/90">
              <Topbar onMenuClick={() => setIsSidebarOpen(true)} />
              <main className="neo-shell flex flex-1 justify-center px-3 py-4 sm:px-4 sm:py-6 xl:px-8">
                <div className="route-shell route-shell-app w-full max-w-[1760px]">
                  <Outlet />
                </div>
              </main>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
