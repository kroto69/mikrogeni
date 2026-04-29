import { Blocks, LayoutDashboard, Plus, ReceiptText, Router, Settings, Wifi } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getZTEConnections } from "@/lib/zteApi";
import { cn } from "@/lib/utils";

const navigation = [
  { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
  { label: "Mikrotik", to: "/mikrotik", icon: Router },
  { label: "Billing", to: "/billing", icon: ReceiptText },
  { label: "Acs/ONU Device", to: "/onu", icon: Wifi },
  { label: "Hioso", to: "/hioso", icon: Blocks },
];

type SidebarProps = {
  className?: string;
  onNavigate?: () => void;
};

export default function Sidebar({ className, onNavigate }: SidebarProps) {
  const navLinkBase = "neo-panel neo-interactive relative flex items-center gap-3 rounded-lg border-2 border-border bg-card px-4 py-3 text-xs font-extrabold uppercase tracking-[0.08em] text-foreground shadow-brutal-sm transition-all hover:-translate-x-[1px] hover:-translate-y-[1px] hover:bg-muted/40 hover:shadow-brutal";
  const navLinkActive = "bg-primary text-primary-foreground shadow-brutal";

  const { data: zteConnections } = useQuery({
    queryKey: ['zte-connections'],
    queryFn: getZTEConnections,
    staleTime: 60_000,
  })

  return (
    <aside className={cn("sidebar-surface neo-panel data-grid-line flex h-full w-full flex-col border-r-2 border-border bg-card/95 px-4 py-5", className)}>
      <div className="sidebar-brand-surface flex items-center gap-3 rounded-xl border-2 border-border bg-primary p-3 text-primary-foreground shadow-brutal">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg border-2 border-border bg-card font-display text-sm uppercase text-card-foreground shadow-brutal-sm">
          NC
        </div>
        <div>
          <p className="font-display text-sm uppercase tracking-[0.08em] text-primary-foreground">MIKROGENI</p>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-primary-foreground/90">v4.1</p>
        </div>
      </div>

      <nav className="mt-6 space-y-2">
        {navigation.map(({ label, to, icon: Icon }) => (
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
        <p className="px-2 text-[11px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">ZTE OLT</p>
        {(!zteConnections || zteConnections.length === 0) ? (
          <NavLink
            onClick={onNavigate}
            to="/settings/zte"
            className={({ isActive }) => cn(navLinkBase, isActive && navLinkActive)}
          >
            <Plus className="h-4 w-4" />
            <span>Tambah OLT</span>
          </NavLink>
        ) : (
          zteConnections.map((conn) => (
            <NavLink
              key={conn.id}
              onClick={onNavigate}
              to={`/zte/${conn.olt_id}`}
              className={({ isActive }) => cn(navLinkBase, isActive && navLinkActive)}
            >
              <Router className="h-4 w-4" />
              <span className="truncate">{conn.olt_id}</span>
            </NavLink>
          ))
        )}
      </div>

      <div className="mt-auto space-y-4">
        <NavLink
          onClick={onNavigate}
          to="/settings"
          className={({ isActive }) => cn(navLinkBase, isActive && navLinkActive)}
        >
          <Settings className="h-4 w-4" />
          <span>Settings</span>
        </NavLink>

        <div className="sidebar-health-surface rounded-xl border-2 border-border bg-secondary p-4 text-secondary-foreground shadow-brutal">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.16em]">Network Health</span>
            <span className="h-3 w-3 rounded-full border-2 border-border bg-success" />
          </div>
          <p className="mt-3 text-sm font-extrabold uppercase tracking-[0.03em]">94% nodes operational</p>
          <p className="mt-1 text-xs font-semibold text-secondary-foreground/85">Core routers and OLT uplinks are stable.</p>
        </div>
      </div>
    </aside>
  );
}
