import React from "react";
import { LayoutDashboard, Menu } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { AcsIcon } from "@/components/icons/AcsIcon";
import { OltIcon } from "@/components/icons/OltIcon";
import { Router } from "lucide-react";
import { cn } from "@/lib/utils";
import { preloadRoute, type RouteLoaderKey } from "@/lib/routePreload";

type BottomNavProps = {
  onMenuClick?: () => void;
};

const items: ReadonlyArray<{ label: string; to: string; icon: React.FC<{ className?: string }>; match: (path: string) => boolean; preload: RouteLoaderKey }> = [
  { label: "Home", to: "/dashboard", icon: LayoutDashboard, match: (path: string) => path === "/dashboard" || path === "/", preload: "dashboard" },
  { label: "ONU", to: "/onu", icon: AcsIcon, match: (path: string) => path.startsWith("/onu"), preload: "onu" },
  { label: "OLT", to: "/hioso", icon: OltIcon, match: (path: string) => path.startsWith("/hioso") || path.startsWith("/zte"), preload: "hioso" },
  { label: "Mikrotik", to: "/mikrotik", icon: Router, match: (path: string) => path.startsWith("/mikrotik"), preload: "mikrotik" },
];

export default function BottomNav({ onMenuClick }: BottomNavProps) {
  const location = useLocation();

  return (
    <nav
      aria-label="Navigasi utama"
      className="bottomnav-surface fixed inset-x-0 bottom-0 z-40 border-t-2 border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur xl:hidden"
    >
      <div className="grid grid-cols-5 gap-1 px-2 pt-2">
        {items.map(({ label, to, icon: Icon, match, preload }) => {
          const active = match(location.pathname);
          return (
            <NavLink
              key={to}
              to={to}
              onMouseEnter={() => preloadRoute(preload)}
              onFocus={() => preloadRoute(preload)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg border-2 px-1 py-2 text-[10px] font-extrabold uppercase tracking-[0.06em] transition-all",
                active
                  ? "border-foreground bg-primary text-primary-foreground shadow-brutal-sm"
                  : "border-transparent text-muted-foreground active:border-border active:bg-muted/40",
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="leading-none">{label}</span>
            </NavLink>
          );
        })}
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Buka menu"
          className="flex flex-col items-center gap-1 rounded-lg border-2 border-transparent px-1 py-2 text-[10px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground transition-all active:border-border active:bg-muted/40"
        >
          <Menu className="h-5 w-5" />
          <span className="leading-none">Menu</span>
        </button>
      </div>
    </nav>
  );
}
