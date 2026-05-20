import React from "react";
import { LayoutDashboard, ReceiptText, Router, Settings } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getZTEConnections } from "@/lib/zteApi";
import { getHiosoDevices, getMikrotikDevices } from "@/lib/api";
import { useRole } from "@/hooks/useRole";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { cn } from "@/lib/utils";
import { OltIcon } from "@/components/icons/OltIcon";
import { AcsIcon } from "@/components/icons/AcsIcon";
import { LogsIcon } from "@/components/icons/LogsIcon";
import SidebarLogo from "@/images/logo.png";

type SidebarFeature = Parameters<ReturnType<typeof useRole>["can"]>[0];

const navigation: ReadonlyArray<{ label: string; to: string; icon: React.FC<{ className?: string }>; feature?: SidebarFeature }> = [
  { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
  { label: "Mikrotik", to: "/mikrotik", icon: Router },
  { label: "Billing", to: "/billing", icon: ReceiptText, feature: "billing" as const },
  { label: "Acs/ONU Device", to: "/onu", icon: AcsIcon },
  { label: "Logs", to: "/logs", icon: LogsIcon },
];

type SidebarProps = {
  className?: string;
  onNavigate?: () => void;
};

export default function Sidebar({ className, onNavigate }: SidebarProps) {
  const navLinkBase = "neo-panel neo-interactive relative flex items-center gap-3 rounded-lg border-2 border-border bg-card px-4 py-3 text-xs font-extrabold uppercase tracking-[0.08em] text-foreground shadow-brutal-sm transition-all hover:-translate-x-[1px] hover:-translate-y-[1px] hover:bg-muted/40 hover:shadow-brutal";
  const navLinkActive = "border-foreground bg-primary text-primary-foreground shadow-brutal";
  const subNavBase = "relative ml-3 flex items-center gap-2.5 rounded-lg border-2 border-border bg-card px-3 py-2 text-[10px] font-extrabold uppercase tracking-[0.06em] text-foreground shadow-[3px_3px_0_0_hsl(var(--border))] transition-all hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-brutal-sm";
  const subNavActive = "border-foreground bg-primary text-primary-foreground shadow-brutal-sm";

  const { can } = useRole();
  const { genieacsEnabled, billingEnabled } = useFeatureFlags();
  const location = useLocation();

  const { data: zteConnections } = useQuery({
    queryKey: ["zte-connections"],
    queryFn: getZTEConnections,
    staleTime: 60_000,
  });

  const { data: hiosoDevices } = useQuery({
    queryKey: ["hioso-devices"],
    queryFn: getHiosoDevices,
    staleTime: 60_000,
  });

  const { data: mikrotikDevices } = useQuery({
    queryKey: ["mikrotik-devices"],
    queryFn: getMikrotikDevices,
    staleTime: 60_000,
  });

  const hasAnyOlt = (zteConnections?.length ?? 0) > 0 || (hiosoDevices?.length ?? 0) > 0;
  const activeHiosoDeviceId = new URLSearchParams(location.search).get("device");
  const isHiosoRoute = location.pathname === "/hioso";

  return (
    <aside className={cn("sidebar-surface neo-panel data-grid-line flex h-full w-full flex-col border-r-2 border-border bg-card/95 px-4 py-5", className)}>
      <div className="sidebar-brand-surface rounded-lg border-2 border-border bg-primary p-3 text-primary-foreground shadow-brutal">
        <div className="flex items-center justify-center rounded-lg border-2 border-border bg-primary p-2 shadow-brutal-sm">
          <img alt="NC MIKROGENI" className="h-16 w-auto object-contain" src={SidebarLogo} />
        </div>
        <p className="mt-2 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-primary-foreground/90"></p>
      </div>

      <nav className="mt-6 space-y-2">
        {navigation.filter((item) => {
          if (item.feature && !can(item.feature)) return false;
          if (item.to === "/billing" && !billingEnabled) return false;
          if (item.to === "/onu" && !genieacsEnabled) return false;
          return true;
        }).map(({ label, to, icon: Icon }) => (
          <React.Fragment key={to}>
            <NavLink
              onClick={onNavigate}
              to={to}
              className={({ isActive }) =>
                cn(
                  navLinkBase,
                  isActive && !location.pathname.startsWith(to + "/") && navLinkActive,
                  to === "/mikrotik" && location.pathname.startsWith("/mikrotik") && navLinkActive,
                )
              }
            >
              <Icon className="h-4 w-4" />
              <span className="truncate">{label}</span>
            </NavLink>
            {to === "/mikrotik" && (mikrotikDevices ?? []).length > 0 && (
              <div className="space-y-1">
                {(mikrotikDevices ?? []).map((device) => (
                  <NavLink
                    key={device.id}
                    onClick={onNavigate}
                    to={`/mikrotik/${device.id}`}
                    className={({ isActive }) => cn(subNavBase, isActive && subNavActive)}
                  >
                    <Router className="h-3.5 w-3.5" />
                    <span className="truncate">{device.name || device.host}</span>
                  </NavLink>
                ))}
              </div>
            )}
          </React.Fragment>
        ))}
      </nav>

      <div className="mt-4 space-y-1">
        <NavLink
          onClick={onNavigate}
          to="/hioso"
          className={() => cn(navLinkBase, isHiosoRoute && !activeHiosoDeviceId && navLinkActive)}
        >
          <OltIcon className="h-4 w-4" />
          <span>Manage OLT</span>
        </NavLink>

        {hasAnyOlt ? (
          <div className="space-y-1">
            {(hiosoDevices ?? []).map((device) => (
              <NavLink
                key={device.id}
                onClick={onNavigate}
                to={`/hioso?device=${encodeURIComponent(device.id)}`}
                className={() => cn(subNavBase, isHiosoRoute && activeHiosoDeviceId === device.id && subNavActive)}
              >
                <OltIcon className="h-3.5 w-3.5" />
                <span className="truncate">{device.name || device.host}</span>
              </NavLink>
            ))}

            {(zteConnections ?? []).map((conn) => (
              <NavLink
                key={conn.id}
                onClick={onNavigate}
                to={`/zte/${conn.olt_id}`}
                className={({ isActive }) => cn(subNavBase, isActive && subNavActive)}
              >
                <OltIcon className="h-3.5 w-3.5" />
                <span className="truncate">{conn.olt_id || conn.name}</span>
              </NavLink>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-auto space-y-4">
        {can("settings") && (
        <NavLink
          onClick={onNavigate}
          to="/settings"
          className={({ isActive }) => cn(navLinkBase, isActive && navLinkActive)}
        >
          <Settings className="h-4 w-4" />
          <span>Settings</span>
        </NavLink>
        )}

        <div className="sidebar-health-surface rounded-lg border-2 border-border bg-secondary p-4 text-secondary-foreground shadow-brutal">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.16em]">Network Health</span>
          <span className="h-3 w-3 rounded-lg border-2 border-border bg-success" />
          </div>
          <p className="mt-3 text-sm font-extrabold uppercase tracking-[0.03em]">94% nodes operational</p>
          <p className="mt-1 text-xs font-semibold text-secondary-foreground/85">Core routers and OLT uplinks are stable.</p>
        </div>
      </div>
    </aside>
  );
}
