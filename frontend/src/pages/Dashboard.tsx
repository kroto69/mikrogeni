import { Activity, Radio, Router, Wifi } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getApiErrorMessage, getDashboardSummary } from "@/lib/api";
import { cn } from "@/lib/utils";

function getMikrotikStatusTone(status?: string) {
  if (status === "online") {
    return {
      badgeVariant: "online" as const,
      chipClassName: "border-2 border-success bg-success/20 text-foreground",
    };
  }

  if (status === "offline" || status === "down") {
    return {
      badgeVariant: "offline" as const,
      chipClassName: "border-2 border-destructive bg-destructive/15 text-foreground",
    };
  }

  return {
    badgeVariant: "disabled" as const,
    chipClassName: "border-2 border-border bg-muted/20 text-muted-foreground",
  };
}

export default function Dashboard() {
  // Single aggregated request (backend computes per-device data in parallel
  // and caches it for 30s) — replaces the old N+1 fan-out of per-router
  // ppp/active + detail and per-OLT health queries.
  const summaryQuery = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: getDashboardSummary,
    refetchInterval: 30_000,
  });

  const summary = summaryQuery.data;
  const acs = summary?.acs;
  const mikrotik = summary?.mikrotik;
  const olt = summary?.olt;

  const mikrotikDevices = mikrotik?.devices ?? [];
  const hiosoDevices = olt?.hioso ?? [];
  const zteConnections = olt?.zte ?? [];
  const totalOltCount = olt?.total ?? hiosoDevices.length + zteConnections.length;

  const stats = [
    {
      label: "ONU online",
      value: String(acs?.online_devices ?? "-"),
      change: `${acs?.total_devices ?? "-"} discovered`,
      icon: Wifi,
      ratio: acs?.total_devices ? (acs.online_devices / acs.total_devices) : null,
      barClass: "bg-success",
    },
    {
      label: "MikroTik linked",
      value: String(mikrotik?.total ?? "-"),
      change: `${mikrotik?.online ?? "-"} online`,
      icon: Router,
      ratio: mikrotik?.total ? (mikrotik.online / mikrotik.total) : null,
      barClass: "bg-primary",
    },
    {
      label: "PPPoE active",
      value: String(mikrotik?.total_ppp_active ?? "-"),
      change: `${mikrotikDevices.length} routers tracked`,
      icon: Activity,
      ratio: null,
      barClass: "bg-secondary",
    },
    {
      label: "OLT managed",
      value: String(totalOltCount),
      change: `${hiosoDevices.length} Hioso · ${zteConnections.length} ZTE`,
      icon: Radio,
      ratio: null,
      barClass: "bg-accent",
    },
  ];

  return (
    <div className="route-shell-page route-shell-dashboard space-y-5">
      <Card className="route-shell-panel overflow-hidden border-2 bg-card/95 shadow-brutal">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="mt-0 font-display text-2xl uppercase tracking-[0.04em] text-foreground sm:text-3xl">Operations</h2>
              <span className="inline-flex items-center gap-1.5 rounded-full border-2 border-border bg-success/20 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.14em] text-foreground">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full border border-border bg-success" />
                </span>
                Live
              </span>
            </div>
            <p className="mt-1 text-sm font-semibold text-muted-foreground">Network summary across ACS, MikroTik & OLT — refreshes every 30s.</p>
          </div>
          <span className="hidden shrink-0 rounded-lg border-2 border-border bg-secondary px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.14em] text-secondary-foreground sm:inline-flex">Mikrogeni NMS</span>
        </CardContent>
      </Card>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {stats.map(({ label, value, change, icon: Icon, ratio, barClass }) => (
            <Card className="neo-panel neo-interactive relative overflow-hidden border-2 shadow-brutal" key={label}>
              <CardContent className="p-3.5 sm:p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground sm:text-[11px]">{label}</p>
                    <p className="mt-1.5 font-display text-2xl text-foreground sm:text-3xl">{value}</p>
                  </div>
                  <div className="shrink-0 rounded-lg border-2 border-border bg-primary/15 p-2 text-primary shadow-brutal-sm">
                    <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                  </div>
                </div>
                <div className="mt-2 truncate text-xs font-semibold text-muted-foreground sm:text-sm">{change}</div>
                {ratio != null ? (
                  <div className="mt-2.5 h-2 overflow-hidden rounded-full border-2 border-border bg-muted/40" role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
                    <div className={cn("h-full rounded-full", barClass)} style={{ width: `${Math.round(ratio * 100)}%` }} />
                  </div>
                ) : null}
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="route-shell-panel space-y-3 rounded-none border-2 border-border bg-card/95 p-4 shadow-brutal sm:p-5">
        <div className="flex items-center justify-between gap-3 border-b-2 border-border/70 pb-3">
          <div>
            <h3 className="text-lg font-black uppercase tracking-[0.03em] text-foreground">MikroTik PPP Active Summary</h3>
            <p className="text-sm text-muted-foreground">Per-router active PPPoE session overview.</p>
          </div>
          <Badge variant="secondary">{mikrotik?.total_ppp_active ?? "-"} total sessions</Badge>
        </div>

        {summaryQuery.isError ? (
          <Card className="border-destructive bg-destructive/10">
            <CardContent className="p-4 text-sm font-semibold text-destructive">{getApiErrorMessage(summaryQuery.error)}</CardContent>
          </Card>
        ) : null}

        {summaryQuery.isLoading ? (
          <Card className="bg-muted/20">
            <CardContent className="p-4 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">Loading MikroTik PPP summaries...</CardContent>
          </Card>
        ) : null}

        {!summaryQuery.isLoading && !summaryQuery.isError && mikrotikDevices.length === 0 ? (
          <Card className="border-dashed bg-muted/20">
            <CardContent className="p-4 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">No MikroTik devices linked yet.</CardContent>
          </Card>
        ) : null}

        <div className="grid gap-3 xl:grid-cols-2">
          {mikrotikDevices.map((device) => {
            const tone = getMikrotikStatusTone(device.status);

            return (
              <Link className="block" key={device.id} to={`/mikrotik/${device.id}`}>
                <Card className="neo-panel neo-interactive h-full border-2 transition-colors hover:border-primary/40">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <p className="break-all text-base font-semibold text-foreground">{device.host}</p>
                        <Badge variant={tone.badgeVariant}>{device.status ?? "unknown"}</Badge>
                      </div>
                      <div className={cn("inline-flex items-center gap-2 rounded-none px-3 py-2 text-right", tone.chipClassName)}>
                        <span className="text-[10px] font-semibold uppercase tracking-[0.14em]">PPPoE Active</span>
                        <span className="text-lg font-semibold">{device.ppp_active}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">{device.identity || device.name}</span>
                      <span>CPU {device.cpu_load || "-"}</span>
                      <span>Uptime {device.uptime || "-"}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>
      <section className="route-shell-panel space-y-3 rounded-none border-2 border-border bg-card/95 p-4 shadow-brutal sm:p-5">
        <div className="flex items-center justify-between gap-3 border-b-2 border-border/70 pb-3">
          <div>
            <h3 className="text-lg font-black uppercase tracking-[0.03em] text-foreground">OLT Summary</h3>
            <p className="text-sm text-muted-foreground">Per-OLT health overview.</p>
          </div>
          <Badge variant="secondary">{totalOltCount} OLT</Badge>
        </div>

        {totalOltCount === 0 && !summaryQuery.isLoading ? (
          <Card className="border-dashed bg-muted/20">
            <CardContent className="p-4 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">No OLT devices configured yet.</CardContent>
          </Card>
        ) : null}

        <div className="grid gap-3 xl:grid-cols-2">
          {hiosoDevices.map((device) => {
            return (
              <Link className="block" key={device.id} to={`/hioso?device=${encodeURIComponent(device.id)}`}>
                <Card className="neo-panel neo-interactive h-full border-2 transition-colors hover:border-primary/40">
                  <CardContent className="space-y-2 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <p className="break-all text-base font-semibold text-foreground">{device.name || device.host}</p>
                        <Badge variant={device.online ? "online" : "offline"}>{device.online ? "online" : "down"}</Badge>
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">HIOSO</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">{device.model || "-"}</span>
                      <span>ONU {device.onu_online ?? 0}/{device.onu_total ?? 0}</span>
                      <span>CPU {device.cpu || "-"}</span>
                      <span>Uptime {device.uptime || "-"}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
          {zteConnections.map((conn) => {
            return (
              <Link className="block" key={conn.id} to={`/zte/${encodeURIComponent(conn.olt_id || conn.id)}`}>
                <Card className="neo-panel neo-interactive h-full border-2 transition-colors hover:border-primary/40">
                  <CardContent className="space-y-2 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <p className="break-all text-base font-semibold text-foreground">{conn.name || conn.base_url}</p>
                        <Badge variant={conn.online ? "online" : "offline"}>{conn.online ? "online" : "down"}</Badge>
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">ZTE</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">{conn.name || "-"}</span>
                      <span>CPU {conn.online ? `${conn.cpu_usage}%` : "-"}</span>
                      <span>MEM {conn.online ? `${conn.memory_usage}%` : "-"}</span>
                      <span>Uptime {conn.uptime || "-"}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
