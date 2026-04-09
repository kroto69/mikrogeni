import { Bell, LogOut, Menu, Moon, Sun } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const routeLabels: Record<string, string> = {
  dashboard: "Dashboard",
  onu: "ONU Devices",
  mikrotik: "Mikrotik",
  settings: "Settings",
};

type TopbarProps = {
  onMenuClick?: () => void;
};

export default function Topbar({ onMenuClick }: TopbarProps) {
  const location = useLocation();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const crumbs = location.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => routeLabels[segment] ?? segment);

  const pageTitle = crumbs[crumbs.length - 1] ?? "Dashboard";

  return (
    <header className="sticky top-0 z-20 border-b border-border/70 bg-card/95 px-3 py-3 backdrop-blur sm:px-4 xl:px-8">
      <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Button aria-label="Open navigation" className="xl:hidden" onClick={onMenuClick} size="icon" variant="outline">
              <Menu className="h-4 w-4" />
            </Button>
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-muted-foreground sm:text-xs">
              <span>Home</span>
              {crumbs.map((crumb) => (
                <span key={crumb} className="flex items-center gap-2">
                  <span>/</span>
                  <span className="max-w-[8rem] truncate sm:max-w-[12rem] xl:max-w-none">{crumb}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="min-w-0">
            <h1 className="break-all text-xl font-semibold text-foreground sm:text-2xl">{pageTitle}</h1>
            <p className="max-w-full text-xs text-muted-foreground sm:text-sm">Real-time monitoring and device management.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <Button aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} onClick={toggleTheme} size="icon" variant="outline">
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button variant="outline" size="icon" aria-label="Notifications">
            <Bell className="h-4 w-4" />
          </Button>
          <Badge variant="secondary" className="hidden rounded-xl px-3 py-2 text-[12px] normal-case tracking-normal sm:inline-flex">
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
