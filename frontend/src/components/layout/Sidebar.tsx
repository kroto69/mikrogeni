import { Blocks, ClipboardList, LayoutDashboard, Plus, ReceiptText, Router, Settings, Wifi } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getZTEConnections } from "@/lib/zteApi";
import { getHiosoDevices } from "@/lib/api";
import { useRole } from "@/hooks/useRole";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { cn } from "@/lib/utils";
import SidebarLogo from "@/images/logo.png";

type SidebarFeature = Parameters<ReturnType<typeof useRole>["can"]>[0];

const navigation = [
  { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
  { label: "Mikrotik", to: "/mikrotik", icon: Router },
  { label: "Billing", to: "/billing", icon: ReceiptText, feature: "billing" as const },
  { label: "Acs/ONU Device", to: "/onu", icon: Wifi },
  { label: "Logs", to: "/logs", icon: ClipboardList },
] satisfies ReadonlyArray<{ label: string; to: string; icon: typeof LayoutDashboard; feature?: SidebarFeature }>;

type SidebarProps = {
  className?: string;
  onNavigate?: () => void;
};

export default function Sidebar({ className, onNavigate }: SidebarProps) {
  const navLinkBase = "neo-panel neo-interactive relative flex items-center gap-3 rounded-lg border-2 border-border bg-card px-4 py-3 text-xs font-extrabold uppercase tracking-[0.08em] text-foreground shadow-brutal-sm transition-all hover:-translate-x-[1px] hover:-translate-y-[1px] hover:bg-muted/40 hover:shadow-brutal";
  const navLinkActive = "border-foreground bg-primary text-primary-foreground shadow-brutal";

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

  const hasAnyOlt = (zteConnections?.length ?? 0) > 0 || (hiosoDevices?.length ?? 0) > 0;
  const activeHiosoDeviceId = new URLSearchParams(location.search).get("device");
  const isHiosoRoute = location.pathname === "/hioso";

  return (
    <aside className={cn("sidebar-surface neo-panel data-grid-line flex h-full w-full flex-col border-r-2 border-border bg-card/95 px-4 py-5", className)}>
      <div className="sidebar-brand-surface rounded-lg border-2 border-border bg-primary p-3 text-primary-foreground shadow-brutal">
        <div className="flex items-center justify-center rounded-lg border-2 border-border bg-primary p-2 shadow-brutal-sm">
          <img alt="NC MIKROGENI" className="h-16 w-auto object-contain" src={SidebarLogo} />
        </div>
        <p className="mt-2 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-primary-foreground/90">v4.1</p>
      </div>

      <nav className="mt-6 space-y-2">
        {navigation.filter((item) => {
          if (item.feature && !can(item.feature)) return false;
          if (item.to === "/billing" && !billingEnabled) return false;
          if (item.to === "/onu" && !genieacsEnabled) return false;
          return true;
        }).map(({ label, to, icon: Icon }) => (
          <NavLink
            key={to}
            onClick={onNavigate}
            to={to}
            className={({ isActive }) =>
              cn(
                navLinkBase,
                isActive && navLinkActive,
              )
            }
          >
            <Icon className="h-4 w-4" />
            <span className="truncate">{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="mt-4 space-y-2">
        <p className="px-2 text-[11px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">MANAGE OLT</p>

        {can("zte_connections_crud") ? (
          <NavLink
            onClick={onNavigate}
            to="/hioso"
            className={() => cn(navLinkBase, isHiosoRoute && !activeHiosoDeviceId && navLinkActive)}
          >
            <Plus className="h-4 w-4" />
            <span>Tambah OLT</span>
          </NavLink>
        ) : null}

        {hasAnyOlt ? (
          <>
            {(hiosoDevices ?? []).map((device) => (
              <NavLink
                key={device.id}
                onClick={onNavigate}
                to={`/hioso?device=${encodeURIComponent(device.id)}`}
                className={() => cn(navLinkBase, isHiosoRoute && activeHiosoDeviceId === device.id && navLinkActive)}
              >
                <Blocks className="h-4 w-4" />
                <span className="truncate">{device.name || device.host}</span>
              </NavLink>
            ))}

            {(zteConnections ?? []).map((conn) => (
              <NavLink
                key={conn.id}
                onClick={onNavigate}
                to={`/zte/${conn.olt_id}`}
                className={({ isActive }) => cn(navLinkBase, isActive && navLinkActive)}
              >
                <Router className="h-4 w-4" />
                <span className="truncate">{conn.olt_id || conn.name}</span>
              </NavLink>
            ))}
          </>
        ) : (
          <p className="neo-panel rounded-lg border-2 border-dashed border-border bg-muted/20 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">No OLT connections</p>
        )}
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
