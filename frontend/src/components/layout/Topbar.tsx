import { Bell, LogOut, Menu } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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
          <Button variant="outline" size="icon" aria-label="Notifications">
            <Bell className="h-4 w-4" />
          </Button>
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
