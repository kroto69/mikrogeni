import React, { useState } from "react";
import { ChevronDown, LayoutDashboard, ReceiptText, Router, Settings } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getZTEConnections } from "@/lib/zteApi";
import { getDashboardSummary, getHiosoDevices, getMikrotikDevices } from "@/lib/api";
import { useRole } from "@/hooks/useRole";
import { preloadRoute, type RouteLoaderKey } from "@/lib/routePreload";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { cn } from "@/lib/utils";
import { OltIcon } from "@/components/icons/OltIcon";
import { AcsIcon } from "@/components/icons/AcsIcon";
import { LogsIcon } from "@/components/icons/LogsIcon";
import SidebarLogo from "@/images/logo.png";

type SidebarFeature = Parameters<ReturnType<typeof useRole>["can"]>[0];

const navigation: ReadonlyArray<{ label: string; to: string; icon: React.FC<{ className?: string }>; feature?: SidebarFeature; preload: RouteLoaderKey }> = [
  { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard, preload: "dashboard" },
  { label: "Mikrotik", to: "/mikrotik", icon: Router, preload: "mikrotik" },
  { label: "Billing", to: "/billing", icon: ReceiptText, feature: "billing" as const, preload: "billing" },
  { label: "Acs/ONU Device", to: "/onu", icon: AcsIcon, preload: "onu" },
  { label: "Logs", to: "/logs", icon: LogsIcon, preload: "logs" },
];

type SidebarProps = {
  className?: string;
  onNavigate?: () => void;
};

export default function Sidebar({ className, onNavigate }: SidebarProps) {
  const navLinkBase = "relative flex items-center gap-3 rounded-full px-4 py-3 text-xs font-bold uppercase tracking-[0.08em] text-foreground transition-colors hover:bg-muted";
  const navLinkActive = "bg-[#d9edde] text-[#1f7a4d] dark:bg-[#4a5a4e] dark:text-pastel-mint";
  const subNavBase = "relative ml-3 flex items-center gap-2.5 rounded-full px-3 py-2 text-[10px] font-bold uppercase tracking-[0.06em] text-foreground transition-colors hover:bg-muted";
  const subNavActive = "bg-[#d9edde] text-[#1f7a4d] dark:bg-[#4a5a4e] dark:text-pastel-mint";

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

  // Shared cache with the Dashboard page — real network health, no dummy data.
  const { data: summary } = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: getDashboardSummary,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const hasAnyOlt = (zteConnections?.length ?? 0) > 0 || (hiosoDevices?.length ?? 0) > 0;
  const activeHiosoDeviceId = new URLSearchParams(location.search).get("device");
  const isHiosoRoute = location.pathname === "/hioso";
  const isOltRoute = location.pathname.startsWith("/hioso") || location.pathname.startsWith("/zte");
  const [oltOpen, setOltOpen] = useState(isOltRoute);

  const onuOnline = summary?.acs.online_devices;
  const onuTotal = summary?.acs.total_devices;
  const routerOnline = summary?.mikrotik.online;
  const routerTotal = summary?.mikrotik.total;
  const oltTotal = summary?.olt.total;

  return (
    <aside className={cn("sidebar-surface flex h-full w-full flex-col px-4 py-5", className)}>
      <div className="rounded-[20px] bg-primary p-2.5 text-primary-foreground">
        <img alt="MIKROGENI" className="mx-auto h-12 w-auto object-contain" src={SidebarLogo} />
      </div>

      <nav className="mt-6 space-y-2">
        {navigation.filter((item) => {
          if (item.feature && !can(item.feature)) return false;
          if (item.to === "/billing" && !billingEnabled) return false;
          if (item.to === "/onu" && !genieacsEnabled) return false;
          return true;
        }).map(({ label, to, icon: Icon, preload }) => (
          <React.Fragment key={to}>
            <NavLink
              onClick={onNavigate}
              onMouseEnter={() => preloadRoute(preload)}
              onFocus={() => preloadRoute(preload)}
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
                    onMouseEnter={() => preloadRoute("mikrotikDetail")}
                    onFocus={() => preloadRoute("mikrotikDetail")}
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
        <div className="flex gap-1">
          <NavLink
            onClick={onNavigate}
            onMouseEnter={() => preloadRoute("hioso")}
            onFocus={() => preloadRoute("hioso")}
            to="/hioso"
            className={() => cn(navLinkBase, "flex-1", isHiosoRoute && !activeHiosoDeviceId && navLinkActive)}
          >
            <OltIcon className="h-4 w-4" />
            <span>Manage OLT</span>
            {oltTotal != null && oltTotal > 0 ? (
              <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">{oltTotal}</span>
            ) : null}
          </NavLink>
          <button
            type="button"
            aria-label={oltOpen ? "Tutup daftar OLT" : "Buka daftar OLT"}
            aria-expanded={oltOpen}
            onClick={() => setOltOpen((v) => !v)}
            className="flex items-center justify-center rounded-full border border-border bg-card px-2.5"
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", oltOpen && "rotate-180")} />
          </button>
        </div>

        {oltOpen && hasAnyOlt ? (
          <div className="space-y-1">
            {(hiosoDevices ?? []).map((device) => (
              <NavLink
                key={device.id}
                onClick={onNavigate}
                onMouseEnter={() => preloadRoute("hioso")}
                onFocus={() => preloadRoute("hioso")}
                to={`/hioso?device=${encodeURIComponent(device.id)}`}
                className={() => cn(subNavBase, isHiosoRoute && activeHiosoDeviceId === device.id && subNavActive)}
              >
                <OltIcon className="h-3.5 w-3.5" />
                <span className="truncate">{device.name || device.host}</span>
              </NavLink>
            ))}

            {(zteConnections ?? []).map((conn) => {
              // Baris C-Data (vendor "cdata") menuju halaman C-Data,
              // bukan halaman ZTE — endpoint SNMP-nya beda.
              const isCData = (conn.vendor || 'zte') === 'cdata'
              return (
                <NavLink
                  key={conn.id}
                  onClick={onNavigate}
                  onMouseEnter={() => preloadRoute(isCData ? 'cdata' : 'zte')}
                  onFocus={() => preloadRoute(isCData ? 'cdata' : 'zte')}
                  to={isCData ? `/cdata/${conn.olt_id}` : `/zte/${conn.olt_id}`}
                  className={({ isActive }) => cn(subNavBase, isActive && subNavActive)}
                >
                  <OltIcon className="h-3.5 w-3.5" />
                  <span className="truncate">{conn.olt_id || conn.name}</span>
                </NavLink>
              )
            })}
          </div>
        ) : null}
      </div>

      <div className="mt-auto space-y-4">
        {can("settings") && (
        <NavLink
          onClick={onNavigate}
          onMouseEnter={() => preloadRoute("settings")}
          onFocus={() => preloadRoute("settings")}
          to="/settings"
          className={({ isActive }) => cn(navLinkBase, isActive && navLinkActive)}
        >
          <Settings className="h-4 w-4" />
          <span>Settings</span>
        </NavLink>
        )}

        <div className="rounded-[20px] bg-secondary p-4 text-secondary-foreground">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.16em]">Network Health</span>
            <span className={cn("h-3 w-3 rounded-full", summary ? "bg-success" : "bg-muted")} />
          </div>
          {summary ? (
            <dl className="mt-3 space-y-1.5 text-xs font-bold">
              <div className="flex items-center justify-between">
                <dt className="uppercase tracking-[0.06em] text-secondary-foreground/80">ONU online</dt>
                <dd>{onuOnline ?? "-"}<span className="text-secondary-foreground/60">/{onuTotal ?? "-"}</span></dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="uppercase tracking-[0.06em] text-secondary-foreground/80">Router online</dt>
                <dd>{routerOnline ?? "-"}<span className="text-secondary-foreground/60">/{routerTotal ?? "-"}</span></dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="uppercase tracking-[0.06em] text-secondary-foreground/80">OLT managed</dt>
                <dd>{oltTotal ?? "-"}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="uppercase tracking-[0.06em] text-secondary-foreground/80">PPPoE aktif</dt>
                <dd>{summary.mikrotik.total_ppp_active}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-xs font-semibold text-secondary-foreground/85">Memuat status jaringan…</p>
          )}
        </div>
      </div>
    </aside>
  );
}
