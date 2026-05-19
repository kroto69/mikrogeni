import { Bell, LogOut, Menu } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";

const routeLabels: Record<string, string> = {
  dashboard: "Dashboard",
  onu: "ONU Devices",
  mikrotik: "Mikrotik",
  billing: "Billing",
  hioso: "Manage OLT",
  settings: "Settings",
};

type TopbarProps = {
  onMenuClick?: () => void;
};

export default function Topbar({ onMenuClick }: TopbarProps) {
  const location = useLocation();
  const { user, logout } = useAuth();
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);

  const { data: recentLogs } = useQuery({
    queryKey: ["activity-logs-recent"],
    queryFn: async () => {
      const { data } = await api.get<{ data: Array<{ id: number; username: string; action: string; target: string; device: string; created_at: string }> }>("/activity-logs", { params: { limit: 4 } });
      return data.data ?? [];
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!bellOpen) return;
    const handler = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [bellOpen]);

  const crumbs = location.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => routeLabels[segment] ?? segment);

  const pageTitle = crumbs[crumbs.length - 1] ?? "Dashboard";

  return (
    <header className="topbar-surface neo-panel sticky top-0 z-20 border-b-2 border-border bg-background/95 px-3 py-3 backdrop-blur sm:px-4 xl:px-8">
      <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Button aria-label="Open navigation" className="xl:hidden" onClick={onMenuClick} size="icon" variant="outline">
              <Menu className="h-4 w-4" />
            </Button>
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground sm:text-xs">
              <span className="inline-flex rounded-lg border-2 border-border bg-card px-2 py-0.5 text-foreground shadow-brutal-sm">Home</span>
              {crumbs.map((crumb) => (
                <span key={crumb} className="flex items-center gap-2">
                  <span className="text-foreground">/</span>
                  <span className="max-w-[8rem] truncate sm:max-w-[12rem] xl:max-w-none">{crumb}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="min-w-0">
            <h1 className="break-all font-display text-xl uppercase tracking-[0.04em] text-foreground sm:text-2xl">{pageTitle}</h1>
            <p className="max-w-full text-xs font-semibold uppercase tracking-[0.06em] text-foreground sm:text-sm">Real-time monitoring and device management.</p>
          </div>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end sm:gap-3">
          <div className="relative" ref={bellRef}>
            <Button variant="outline" size="icon" aria-label="Notifications" onClick={() => setBellOpen((v) => !v)}>
              <Bell className="h-4 w-4" />
            </Button>
            {bellOpen && createPortal(
              <div className="fixed inset-0 z-[9999]" onClick={() => setBellOpen(false)}>
                <div className="fixed right-4 top-16 w-72 rounded-lg border-2 border-border bg-card shadow-brutal sm:w-80" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between border-b-2 border-border px-3 py-2">
                    <span className="text-xs font-bold uppercase tracking-wider">Recent Activity</span>
                    <Link to="/logs" onClick={() => setBellOpen(false)} className="text-[10px] font-semibold text-primary hover:underline">View All</Link>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {(recentLogs ?? []).length === 0 ? (
                      <p className="px-3 py-4 text-center text-xs text-muted-foreground">No activity yet</p>
                    ) : (
                      (recentLogs ?? []).map((log: { id: number; username: string; action: string; target: string; device: string; created_at: string }) => (
                        <div key={log.id} className="border-b border-border/50 px-3 py-2 last:border-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold">{log.action.replace(/_/g, " ")}</span>
                            <span className="text-[10px] text-muted-foreground">{new Date(log.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</span>
                          </div>
                          <p className="text-[11px] text-muted-foreground">{log.target} · {log.device} · by {log.username}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>,
              document.body,
            )}
          </div>
          <Badge variant="secondary" className="hidden px-3 py-2 text-[11px] tracking-[0.08em] sm:inline-flex">
            {user?.username ?? "Admin"}
          </Badge>
          <Avatar fallback={(user?.username ?? "AD").slice(0, 2).toUpperCase()} />
          <Button variant="ghost" size="icon" onClick={logout} aria-label="Logout">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
