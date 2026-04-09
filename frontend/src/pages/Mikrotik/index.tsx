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
        "border-emerald-200/80 bg-[linear-gradient(180deg,_rgba(240,253,244,0.92)_0%,_rgba(255,255,255,0.98)_100%)] dark:border-emerald-500/30 dark:bg-slate-900/50",
      badgeClassName:
        "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-slate-800/60 dark:text-emerald-200",
      accentClassName: "bg-emerald-500 dark:bg-emerald-400",
    };
  }

  if (status === "offline") {
    return {
      cardClassName:
        "border-amber-200/80 bg-[linear-gradient(180deg,_rgba(255,251,235,0.92)_0%,_rgba(255,255,255,0.98)_100%)] dark:border-amber-400/40 dark:bg-slate-900/55",
      badgeClassName:
        "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/40 dark:bg-slate-800/60 dark:text-amber-200",
      accentClassName: "bg-amber-500 dark:bg-amber-400",
    };
  }

  return {
    cardClassName:
      "border-slate-200 bg-[linear-gradient(180deg,_rgba(248,250,252,0.94)_0%,_rgba(255,255,255,0.98)_100%)] dark:border-slate-700/60 dark:bg-slate-900/60",
    badgeClassName:
      "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700/60 dark:bg-slate-800/50 dark:text-slate-200",
    accentClassName: "bg-slate-400 dark:bg-slate-500",
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
      <Card className={cn("group h-full overflow-hidden border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_20px_44px_-34px_rgba(15,23,42,0.26)]", tone.cardClassName)}>
        <CardContent className="space-y-2.5 p-3 sm:p-3.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]", tone.badgeClassName)}>
                  {status}
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                  <span className={cn("h-2 w-2 rounded-full", tone.accentClassName)} />
                  {device.site || "Unassigned"}
                </span>
              </div>

              <div>
                <h3 className="break-words text-[15px] font-semibold leading-tight text-slate-950 dark:text-white sm:text-base">
                  {device.name}
                </h3>
                <p className="mt-0.5 break-words text-[12px] leading-4 text-slate-500 dark:text-slate-300">{device.host}</p>
              </div>
            </div>

            <span className="inline-flex w-fit shrink-0 items-center rounded-full border border-sky-100 bg-sky-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-700 transition-colors group-hover:border-sky-200 group-hover:text-sky-900 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-sky-200 dark:group-hover:border-slate-600 dark:group-hover:text-sky-100">Open</span>
          </div>

          <div className="space-y-1.5 sm:grid sm:grid-cols-2 sm:gap-2 sm:space-y-0">
            {detailRows.map(([label, value]) => (
              <div className="rounded-xl bg-white/84 px-2.5 py-2 sm:block dark:bg-slate-900/70" key={label}>
                <div className="flex items-start justify-between gap-3 sm:block">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-400">{label}</p>
                  <p className="max-w-[62%] break-words text-right text-[12px] font-semibold leading-tight text-slate-800 dark:text-slate-100 sm:mt-1 sm:max-w-none sm:text-left">{value}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1.5 border-t border-white/70 pt-2 text-[11px] sm:flex-row sm:items-center sm:justify-between sm:gap-2 dark:border-slate-800/70">
            <span className="break-words text-slate-500 dark:text-slate-400">{syncLabel}</span>
            <span
              className={cn(
                "shrink-0 font-medium",
                device.last_error ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-300"
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
    <div className="space-y-3 sm:space-y-4">
      <section className="overflow-hidden rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,_rgba(255,255,255,0.98)_0%,_rgba(244,248,252,0.96)_100%)] shadow-[0_18px_42px_-36px_rgba(15,23,42,0.24)] dark:border-slate-800/60 dark:bg-gradient-to-b dark:from-slate-950/70 dark:via-slate-900/60 dark:to-slate-900/70">
        <div className="flex flex-col gap-3 p-3.5 sm:p-4">
          <PageSectionHeader
            title={<h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">MikroTik Fleet</h2>}
            description={<p className="text-[13px] text-slate-600 dark:text-slate-400">Gateway, concentrator, and edge router inventory.</p>}
            meta={<span className="inline-flex rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-300">Live registry view</span>}
          />

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Devices", summary.total, "Total registry targets", "default"],
              ["Online", summary.online, "Healthy and reachable", "success"],
              ["Offline", summary.offline, "Need operator attention", "destructive"],
              ["Attention", summary.attention, "Offline or error state", "secondary"],
            ].map(([label, value, caption, variant]) => (
              <div key={String(label)} className="rounded-[16px] border border-white/80 bg-white/90 px-3 py-2 sm:min-h-[74px] dark:border-slate-800/60 dark:bg-slate-900/60">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-400">{label}</p>
                    <p className="mt-1 text-lg font-semibold tracking-[-0.03em] text-slate-950 dark:text-white sm:text-xl">{value}</p>
                  </div>
                  <Badge variant={variant as "default" | "success" | "destructive" | "secondary"}>{label}</Badge>
                </div>
                <p className="mt-1 hidden text-[10px] leading-4 text-slate-500 dark:text-slate-400 sm:block">{caption}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {isLoading ? (
        <Card>
          <CardContent className="p-6 text-sm text-slate-500 dark:text-slate-300">Loading MikroTik devices...</CardContent>
        </Card>
      ) : null}
      {isError ? (
        <Card>
          <CardContent className="p-6 text-sm text-rose-600 dark:text-rose-400">{getApiErrorMessage(error)}</CardContent>
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
          <CardContent className="p-6 text-sm text-slate-500 dark:text-slate-300">
            No MikroTik devices found in the registry.
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
