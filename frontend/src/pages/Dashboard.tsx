import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Activity, Radio, Router, Wifi } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getAcsDevices, getApiErrorMessage, getHiosoDevices, getHiosoPluginHealth, getMikrotikDeviceDetail, getMikrotikDevices, getMikrotikPppActive } from "@/lib/api";
import { getZTEConnections, getZTESystemInfo } from "@/lib/zteApi";
import { cn } from "@/lib/utils";

function isOnuOnline(lastInform: string) {
  const parsed = new Date(lastInform);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  return Date.now() - parsed.getTime() < 5 * 60 * 1000;
}

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
  const onuDevicesQuery = useQuery({
    queryKey: ["acs-devices"],
    queryFn: getAcsDevices,
  });

  const mikrotikDevicesQuery = useQuery({
    queryKey: ["mikrotik-devices"],
    queryFn: getMikrotikDevices,
  });

  const mikrotikDevices = mikrotikDevicesQuery.data ?? [];
  const mikrotikPppQueries = useQueries({
    queries: mikrotikDevices.map((device) => ({
      queryKey: ["dashboard-mikrotik-ppp", device.id],
      queryFn: () => getMikrotikPppActive(device.id),
      enabled: Boolean(device.id),
      staleTime: 15_000,
      refetchInterval: 15_000,
    })),
  });
  const mikrotikDetailQueries = useQueries({
    queries: mikrotikDevices.map((device) => ({
      queryKey: ["dashboard-mikrotik-detail", device.id],
      queryFn: () => getMikrotikDeviceDetail(device.id, { cached: true }),
      enabled: Boolean(device.id),
      staleTime: 5 * 60_000,
    })),
  });

  const onuOnlineCount = useMemo(() => (onuDevicesQuery.data ?? []).filter((device) => isOnuOnline(device.last_inform)).length, [onuDevicesQuery.data]);

  // OLT queries
  const hiosoDevicesQuery = useQuery({
    queryKey: ["hioso-devices"],
    queryFn: getHiosoDevices,
    staleTime: 60_000,
  });
  const zteConnectionsQuery = useQuery({
    queryKey: ["zte-connections"],
    queryFn: getZTEConnections,
    staleTime: 60_000,
  });

  const hiosoDevices = hiosoDevicesQuery.data ?? [];
  const zteConnections = zteConnectionsQuery.data ?? [];

  const hiosoHealthQueries = useQueries({
    queries: hiosoDevices.map((device) => ({
      queryKey: ["dashboard-hioso-health", device.id],
      queryFn: () => getHiosoPluginHealth(device.id),
      enabled: Boolean(device.id),
      staleTime: 30_000,
    })),
  });

  const zteHealthQueries = useQueries({
    queries: zteConnections.map((conn) => ({
      queryKey: ["dashboard-zte-health", conn.id],
      queryFn: () => getZTESystemInfo(conn.id),
      enabled: Boolean(conn.id),
      staleTime: 30_000,
    })),
  });

  const totalOltCount = hiosoDevices.length + zteConnections.length;

  const mikrotikPppSummaries = useMemo(() => {
    return mikrotikDevices.map((device, index) => {
      const sessions = mikrotikPppQueries[index]?.data ?? [];
      return {
        device,
        totalActive: sessions.length,
      };
    });
  }, [mikrotikDevices, mikrotikPppQueries]);

  const totalPppActive = useMemo(
    () => mikrotikPppSummaries.reduce((total, item) => total + item.totalActive, 0),
    [mikrotikPppSummaries],
  );

  const stats = [
    { label: "ONU online", value: String(onuOnlineCount), change: `${(onuDevicesQuery.data ?? []).length} discovered`, icon: Wifi },
    { label: "MikroTik linked", value: String(mikrotikDevices.length), change: `${mikrotikDevices.filter((device) => device.status === "online").length} online`, icon: Router },
    { label: "PPPoE active", value: String(totalPppActive), change: `${mikrotikPppSummaries.length} routers tracked`, icon: Activity },
    { label: "OLT managed", value: String(totalOltCount), change: `${hiosoDevices.length} Hioso · ${zteConnections.length} ZTE`, icon: Radio },
  ];

  return (
    <div className="route-shell-page route-shell-dashboard space-y-5">
      <Card className="route-shell-panel border-2 bg-card/95 shadow-brutal">
        <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="mt-0 text-2xl font-black uppercase tracking-[0.04em] text-foreground sm:text-3xl">Operations</h2>
            <p className="text-sm font-semibold text-muted-foreground">Live network summary across ACS and MikroTik.</p>
          </div>
          <span className="inline-flex rounded-none border-2 border-border bg-card px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground">Network Core</span>
        </CardContent>
      </Card>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {stats.map(({ label, value, change, icon: Icon }) => (
            <Card className="neo-panel neo-interactive relative overflow-hidden border-2 shadow-brutal" key={label}>
              <CardContent className="p-3.5 sm:p-4">
                <div className="pointer-events-none absolute right-3 top-3 h-2.5 w-8 -rotate-6 border-2 border-border bg-secondary/80" />
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
                    <p className="mt-2 text-2xl font-black text-foreground sm:text-3xl">{value}</p>
                  </div>
                  <div className="rounded-none border-2 border-border bg-primary/15 p-2.5 text-primary shadow-brutal-sm">
                    <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                  </div>
                </div>
              <div className="mt-3 text-sm text-muted-foreground">{change}</div>
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
          <Badge variant="secondary">{totalPppActive} total sessions</Badge>
        </div>

        {mikrotikDevicesQuery.isError ? (
          <Card className="border-destructive bg-destructive/10">
            <CardContent className="p-4 text-sm font-semibold text-destructive">{getApiErrorMessage(mikrotikDevicesQuery.error)}</CardContent>
          </Card>
        ) : null}

        {mikrotikDevicesQuery.isLoading ? (
          <Card className="bg-muted/20">
            <CardContent className="p-4 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">Loading MikroTik PPP summaries...</CardContent>
          </Card>
        ) : null}

        {!mikrotikDevicesQuery.isLoading && !mikrotikDevicesQuery.isError && mikrotikPppSummaries.length === 0 ? (
          <Card className="border-dashed bg-muted/20">
            <CardContent className="p-4 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">No MikroTik devices linked yet.</CardContent>
          </Card>
        ) : null}

        <div className="grid gap-3 xl:grid-cols-2">
          {mikrotikPppSummaries.map(({ device, totalActive }, index) => {
            const tone = getMikrotikStatusTone(device.status);
            const isLoadingSessions = mikrotikPppQueries[index]?.isLoading ?? false;
            const detail = mikrotikDetailQueries[index]?.data;
            const identityLabel = detail?.identity || device.name;
            const cpuLabel = detail?.cpu_load || "-";
            const uptimeLabel = detail?.uptime || "-";

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
                        <span className="text-lg font-semibold">{totalActive}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">{identityLabel}</span>
                      <span>CPU {cpuLabel}</span>
                      <span>Uptime {uptimeLabel}</span>
                    </div>

                    {isLoadingSessions ? (
                      <div className="rounded-none border-2 border-border px-3 py-2 text-sm text-muted-foreground">
                        Loading PPP active summary...
                      </div>
                    ) : null}
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

        {totalOltCount === 0 ? (
          <Card className="border-dashed bg-muted/20">
            <CardContent className="p-4 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">No OLT devices configured yet.</CardContent>
          </Card>
        ) : null}

        <div className="grid gap-3 xl:grid-cols-2">
          {hiosoDevices.map((device, index) => {
            const health = hiosoHealthQueries[index]?.data;
            const isOnline = Boolean(health?.model);
            return (
              <Link className="block" key={device.id} to={`/hioso?device=${encodeURIComponent(device.id)}`}>
                <Card className="neo-panel neo-interactive h-full border-2 transition-colors hover:border-primary/40">
                  <CardContent className="space-y-2 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <p className="break-all text-base font-semibold text-foreground">{device.name || device.host}</p>
                        <Badge variant={isOnline ? "online" : "offline"}>{isOnline ? "online" : "down"}</Badge>
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">HIOSO</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">{health?.model ?? "-"}</span>
                      <span>ONU {health?.online_onu ?? 0}/{health?.total_onu ?? 0}</span>
                      <span>CPU {health?.cpu ?? "-"}</span>
                      <span>Uptime {health?.uptime ?? "-"}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
          {zteConnections.map((conn, index) => {
            const health = zteHealthQueries[index]?.data;
            const isOnline = Boolean(health?.cpuUsage != null);
            return (
              <Link className="block" key={conn.id} to={`/zte/${encodeURIComponent(conn.id)}`}>
                <Card className="neo-panel neo-interactive h-full border-2 transition-colors hover:border-primary/40">
                  <CardContent className="space-y-2 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <p className="break-all text-base font-semibold text-foreground">{conn.name || conn.base_url}</p>
                        <Badge variant={isOnline ? "online" : "offline"}>{isOnline ? "online" : "down"}</Badge>
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">ZTE</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">{conn.name ?? "-"}</span>
                      <span>CPU {health?.cpuUsage ?? "-"}%</span>
                      <span>MEM {health?.memoryUsage ?? "-"}%</span>
                      <span>Uptime {health?.uptime ?? "-"}</span>
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
