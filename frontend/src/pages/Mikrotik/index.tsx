import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getApiErrorMessage, getMikrotikDevices } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { MikrotikRegistryDevice, MikrotikStatus } from "@/types/mikrotik";
import { PageSectionHeader } from "@/components/page/section-header";

function normalizeDeviceStatus(status?: string): MikrotikStatus {
  const normalized = status?.toLowerCase();

  if (normalized === "online") {
    return "online";
  }

  if (normalized === "offline" || normalized === "down") {
    return "offline";
  }

  return "unknown";
}

function formatSyncTime(value?: string) {
  if (!value) {
    return "Never synced";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function getDeviceTone(status: MikrotikStatus) {
  if (status === "online") {
    return {
      cardClassName:
        "border-border bg-card",
      badgeClassName:
        "border-border bg-success text-success-foreground",
      accentClassName: "bg-success",
    };
  }

  if (status === "offline") {
    return {
      cardClassName:
        "border-border bg-card",
      badgeClassName:
        "border-border bg-warning text-warning-foreground",
      accentClassName: "bg-warning",
    };
  }

  return {
    cardClassName:
      "border-border bg-card",
    badgeClassName:
      "border-border bg-secondary text-secondary-foreground",
    accentClassName: "bg-secondary",
  };
}

function DeviceCard({ device }: { device: MikrotikRegistryDevice }) {
  const status = normalizeDeviceStatus(device.status);
  const tone = getDeviceTone(status);
  const detailRows = [
    ["Management", device.host],
    ["Username", device.username],
    ["Site", device.site || "Unassigned"],
    ["RouterOS", device.ros_version ?? "Unknown"],
  ] as const;
  const syncLabel = formatSyncTime(device.last_sync_at);

  return (
    <Link className="block h-full" to={`/mikrotik/${device.id}`}>
      <Card className={cn("group h-full overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-brutal-lg", tone.cardClassName)}>
        <CardContent className="space-y-2.5 p-3 sm:p-3.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]", tone.badgeClassName)}>
                  {status}
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <span className={cn("h-2 w-2 rounded-full", tone.accentClassName)} />
                  {device.site || "Unassigned"}
                </span>
              </div>

              <div>
                <h3 className="break-words text-[15px] font-semibold leading-tight text-foreground sm:text-base">
                  {device.name}
                </h3>
                <p className="mt-0.5 break-words text-[12px] leading-4 text-muted-foreground">{device.host}</p>
              </div>
            </div>

            <span className="inline-flex w-fit shrink-0 items-center rounded-full border-2 border-border bg-primary px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary-foreground transition-colors">Open</span>
          </div>

          <div className="space-y-1.5 sm:grid sm:grid-cols-2 sm:gap-2 sm:space-y-0">
            {detailRows.map(([label, value]) => (
              <div className="rounded-xl border-2 border-border bg-card px-2.5 py-2 shadow-brutal-sm sm:block" key={label}>
                <div className="flex items-start justify-between gap-3 sm:block">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
                  <p className="max-w-[62%] break-words text-right text-[12px] font-semibold leading-tight text-foreground sm:mt-1 sm:max-w-none sm:text-left">{value}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1.5 border-t-2 border-border pt-2 text-[11px] sm:flex-row sm:items-center sm:justify-between sm:gap-2">
            <span className="break-words text-muted-foreground">{syncLabel}</span>
            <span
              className={cn(
                "shrink-0 font-medium",
                device.last_error ? "text-destructive" : "text-success"
              )}
            >
              {device.last_error ? "Needs attention" : "Healthy"}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function MikrotikIndex() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["mikrotik-devices"],
    queryFn: getMikrotikDevices,
  });

  const devices = data ?? [];

  const summary = useMemo(() => {
    return {
      total: devices.length,
      online: devices.filter((device) => normalizeDeviceStatus(device.status) === "online").length,
      offline: devices.filter((device) => normalizeDeviceStatus(device.status) === "offline").length,
      attention: devices.filter((device) => normalizeDeviceStatus(device.status) !== "online" || Boolean(device.last_error)).length,
    };
  }, [devices]);

  return (
    <div className="route-shell-page route-shell-mikrotik space-y-4 sm:space-y-5">
      <section className="route-shell-panel relative overflow-hidden rounded-[26px] border-2 border-border bg-primary/20 shadow-[12px_12px_0_0_hsl(var(--border))]">
        <div className="pointer-events-none absolute -right-8 top-4 h-24 w-24 rotate-[15deg] border-2 border-border bg-accent/70" />
        <div className="pointer-events-none absolute bottom-3 left-5 h-4 w-20 -rotate-6 border-2 border-border bg-secondary/80" />
        <div className="flex flex-col gap-3 p-3.5 sm:p-4">
          <PageSectionHeader
            title={<h2 className="font-display text-xl font-black uppercase tracking-[0.04em] text-foreground sm:text-3xl">MikroTik Fleet</h2>}
            description={<p className="text-[13px] font-semibold text-muted-foreground">Gateway, concentrator, and edge router inventory.</p>}
            meta={<span className="inline-flex rounded-full border-2 border-border bg-card px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground">Live registry view</span>}
          />

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Devices", summary.total, "Total registry targets", "default"],
              ["Online", summary.online, "Healthy and reachable", "success"],
              ["Offline", summary.offline, "Need operator attention", "destructive"],
              ["Attention", summary.attention, "Offline or error state", "secondary"],
            ].map(([label, value, caption, variant]) => (
              <div key={String(label)} className="rounded-[16px] border-2 border-border bg-card px-3 py-2 shadow-brutal-sm sm:min-h-[74px]">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
                    <p className="mt-1 text-lg font-semibold tracking-[-0.03em] text-foreground sm:text-xl">{value}</p>
                  </div>
                  <Badge variant={variant as "default" | "success" | "destructive" | "secondary"}>{label}</Badge>
                </div>
                <p className="mt-1 hidden text-[10px] leading-4 text-muted-foreground sm:block">{caption}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {isLoading ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Loading MikroTik devices...</CardContent>
        </Card>
      ) : null}
      {isError ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">{getApiErrorMessage(error)}</CardContent>
        </Card>
      ) : null}

      {!isLoading && !isError ? (
        <section className={cn("grid gap-2.5", "md:grid-cols-2", "xl:grid-cols-3", "2xl:grid-cols-4")}>
          {devices.map((device) => (
            <DeviceCard device={device} key={device.id} />
          ))}
        </section>
      ) : null}

      {!isLoading && !isError && devices.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No MikroTik devices found in the registry.
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
