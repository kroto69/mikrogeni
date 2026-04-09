import { Blocks, LayoutDashboard, Router, Settings, Wifi } from "lucide-react";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";

const navigation = [
  { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
  { label: "Mikrotik", to: "/mikrotik", icon: Router },
  { label: "Acs/ONU Device", to: "/onu", icon: Wifi },
  { label: "Plugin", to: "/plugin", icon: Blocks },
];

type SidebarProps = {
  className?: string;
  onNavigate?: () => void;
};

export default function Sidebar({ className, onNavigate }: SidebarProps) {
  const navLinkBase = "relative flex items-center gap-3 rounded-2xl border border-transparent px-4 py-3 text-sm font-medium text-muted-foreground transition-all hover:bg-muted/20 hover:text-foreground";
  const navLinkActive = "border-primary/25 bg-primary/10 text-foreground shadow-sm before:absolute before:left-2 before:top-1/2 before:h-6 before:w-1 before:-translate-y-1/2 before:rounded-full before:bg-primary";

  return (
    <aside className={cn("flex h-full w-full flex-col border-r border-border/70 bg-card/95 px-4 py-5 backdrop-blur", className)}>
      <div className="flex items-center gap-3 px-2">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          NC
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">Network Core</p>
          <p className="text-xs text-muted-foreground">v4.2.0</p>
        </div>
      </div>

      <nav className="mt-8 space-y-1">
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
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto space-y-4">
        <NavLink
          onClick={onNavigate}
          to="/settings"
          className={({ isActive }) => cn(navLinkBase, isActive && navLinkActive)}
        >
          <Settings className="h-4 w-4" />
          <span>Settings</span>
        </NavLink>

        <div className="rounded-3xl border border-border/70 bg-muted/15 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground">Network Health</span>
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </div>
          <p className="mt-3 text-sm font-semibold text-foreground">94% nodes operational</p>
          <p className="mt-1 text-xs text-muted-foreground">Core routers and OLT uplinks are stable.</p>
        </div>
      </div>
    </aside>
  );
}
