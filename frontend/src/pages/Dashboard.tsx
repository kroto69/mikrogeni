import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Activity, Router, Wifi } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getAcsDevices, getApiErrorMessage, getMikrotikDeviceDetail, getMikrotikDevices, getMikrotikPppActive } from "@/lib/api";
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
      badgeVariant: "success" as const,
      chipClassName: "bg-success/15 text-success",
    };
  }

  if (status === "offline" || status === "down") {
    return {
      badgeVariant: "destructive" as const,
      chipClassName: "bg-destructive/15 text-destructive",
    };
  }

  return {
    badgeVariant: "secondary" as const,
    chipClassName: "bg-muted/20 text-muted-foreground",
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
  ];

  return (
    <div className="route-shell-page route-shell-dashboard space-y-5">
      <Card className="route-shell-panel border-2 bg-card/95 shadow-brutal">
        <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="mt-0 text-2xl font-black uppercase tracking-[0.04em] text-foreground sm:text-3xl">Operations</h2>
            <p className="text-sm font-semibold text-muted-foreground">Live network summary across ACS and MikroTik.</p>
          </div>
          <span className="inline-flex rounded-full border-2 border-border bg-card px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground">Network Core</span>
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
                  <div className="rounded-2xl border-2 border-border bg-primary/15 p-2.5 text-primary shadow-brutal-sm">
                    <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                  </div>
                </div>
              <div className="mt-3 text-sm text-muted-foreground">{change}</div>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="route-shell-panel space-y-3 rounded-[24px] border-2 border-border bg-card/95 p-4 shadow-brutal sm:p-5">
        <div className="flex items-center justify-between gap-3 border-b-2 border-border/70 pb-3">
          <div>
            <h3 className="text-lg font-black uppercase tracking-[0.03em] text-foreground">MikroTik PPP Active Summary</h3>
            <p className="text-sm text-muted-foreground">Per-router active PPPoE session overview.</p>
          </div>
          <Badge variant="secondary">{totalPppActive} total sessions</Badge>
        </div>

        {mikrotikDevicesQuery.isError ? (
          <Card>
            <CardContent className="p-4 text-sm text-rose-600">{getApiErrorMessage(mikrotikDevicesQuery.error)}</CardContent>
          </Card>
        ) : null}

        {mikrotikDevicesQuery.isLoading ? (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">Loading MikroTik PPP summaries...</CardContent>
          </Card>
        ) : null}

        {!mikrotikDevicesQuery.isLoading && !mikrotikDevicesQuery.isError && mikrotikPppSummaries.length === 0 ? (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">No MikroTik devices linked yet.</CardContent>
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
                      <div className={cn("inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-right", tone.chipClassName)}>
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
                      <div className="rounded-xl border border-border/70 px-3 py-2 text-sm text-muted-foreground">
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
    </div>
  );
}
