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

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      {isSidebarOpen ? (
        <button
          aria-label="Close navigation overlay"
          className="fixed inset-0 z-40 bg-background/70 xl:hidden"
          onClick={() => setIsSidebarOpen(false)}
          type="button"
        />
      ) : null}

      <div className="hidden xl:block">
        <Sidebar className="fixed inset-y-0 left-0 z-30 h-screen w-72 overflow-y-auto" />
      </div>

      <div className={cn(
        "fixed inset-y-0 left-0 z-50 w-[88vw] max-w-72 transition-transform duration-200 xl:hidden",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full",
      )}>
        <Sidebar onNavigate={() => setIsSidebarOpen(false)} />
      </div>

      <div className="xl:pl-72">
        <div className="min-h-screen flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="flex min-h-full flex-col bg-background/80">
              <Topbar onMenuClick={() => setIsSidebarOpen(true)} />
              <main className="flex flex-1 justify-center px-3 py-4 sm:px-4 sm:py-6 xl:px-8">
                <div className="w-full max-w-[1760px]">
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
