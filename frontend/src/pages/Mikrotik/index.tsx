import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { useTheme } from "@/hooks/useTheme";
import { isNbStyle } from "@/lib/nb";
import { OnuStatusPill } from "@/components/nms/pastel";
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

/** Kartu perangkat ikut bahasa pastel (v29/v30): latar blok pastel per
    status, teks gelap di atasnya, pill status latar gelap. */
function getDeviceTone(status: MikrotikStatus) {
  if (status === "online") {
    return {
      cardClassName: "bg-pastel-mint",
      metaClassName: "text-[#4a5a50]",
      pillTextClassName: "text-pastel-mint",
      pillDotClassName: "bg-pastel-mint",
    };
  }

  if (status === "offline") {
    return {
      cardClassName: "bg-pastel-grey",
      metaClassName: "text-[#6b6b6b]",
      pillTextClassName: "text-pastel-grey",
      pillDotClassName: "bg-pastel-grey",
    };
  }

  return {
    cardClassName: "bg-pastel-lavender",
    metaClassName: "text-[#5c5170]",
    pillTextClassName: "text-pastel-lavender",
    pillDotClassName: "bg-pastel-lavender",
  };
}

function DeviceCard({ device }: { device: MikrotikRegistryDevice }) {
  const { styleMode } = useTheme();
  const nb = isNbStyle(styleMode);
  const status = normalizeDeviceStatus(device.status);
  const tone = getDeviceTone(status);
  // Mode nb: kartu putih + border tinta + shadow keras, meta hitam pekat.
  const cardClassName = nb ? "border-2 border-border bg-white shadow-brutal" : tone.cardClassName;
  const metaClassName = nb ? "text-foreground" : tone.metaClassName;
  const detailRows = [
    ["Management", device.host],
    ["Username", device.username],
    ["Site", device.site || "Unassigned"],
    ["RouterOS", device.ros_version ?? "Unknown"],
  ] as const;
  const syncLabel = formatSyncTime(device.last_sync_at);

  return (
    <Link className="block h-full" to={`/mikrotik/${device.id}`}>
      <div className={cn("group h-full overflow-hidden rounded-[20px] transition-all duration-200 hover:-translate-y-0.5", cardClassName)}>
        <div className="space-y-2.5 p-3 sm:p-3.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <OnuStatusPill
                  className="px-3 py-1.5 text-[11px]"
                  dotClass={tone.pillDotClassName}
                  label={status.toUpperCase()}
                  textClass={tone.pillTextClassName}
                />
                <span className={cn("inline-flex items-center gap-1 text-[11px]", metaClassName)}>
                  <span className={cn("h-2 w-2 rounded-full", nb ? "bg-foreground" : "bg-[#131313]")} />
                  {device.site || "Unassigned"}
                </span>
              </div>

              <div>
                <h3 className={cn("break-words text-[15px] font-semibold leading-tight sm:text-base", nb ? "text-foreground" : "text-[#131313]")}>
                  {device.name}
                </h3>
                <p className={cn("mt-0.5 break-words text-[12px] leading-4", metaClassName)}>{device.host}</p>
              </div>
            </div>

            <span className={cn("inline-flex w-fit shrink-0 items-center rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em]", nb ? "border-2 border-border bg-white text-foreground shadow-brutal-sm" : "bg-[#131313] text-pastel-mint")}>Open</span>
          </div>

          <div className="space-y-1.5 sm:grid sm:grid-cols-2 sm:gap-2 sm:space-y-0">
            {detailRows.map(([label, value]) => (
              <div className="px-1 py-1.5 sm:block" key={label}>
                <div className="flex items-start justify-between gap-3 sm:block">
                  <p className={cn("text-[10px] font-semibold uppercase tracking-[0.12em]", metaClassName)}>{label}</p>
                  <p className={cn("max-w-[62%] break-words text-right font-mono text-[12px] font-semibold leading-tight sm:mt-1 sm:max-w-none sm:text-left", nb ? "text-foreground" : "text-[#131313]")}>{value}</p>
                </div>
              </div>
            ))}
          </div>

          <div className={cn("flex flex-col gap-1.5 border-t pt-2 text-[11px] sm:flex-row sm:items-center sm:justify-between sm:gap-2", nb ? "border-border" : "border-[#131313]/15")}>
            <span className={cn("break-words", metaClassName)}>{syncLabel}</span>
            <span
              className={cn(
                "shrink-0 font-medium",
                device.last_error ? (nb ? "text-nb-red" : "text-[#b91c1c]") : (nb ? "text-foreground" : "text-[#131313]")
              )}
            >
              {device.last_error ? "Needs attention" : "Healthy"}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function MikrotikIndex() {
  const { styleMode } = useTheme();
  const nb = isNbStyle(styleMode);
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
      <section className="relative overflow-hidden">
        <div className="flex flex-col gap-3">
          <PageSectionHeader
            title={<h2 className="font-display text-xl font-black uppercase tracking-[0.04em] text-foreground sm:text-3xl">MikroTik Fleet</h2>}
            description={<p className="text-[13px] font-semibold text-muted-foreground">Gateway, concentrator, and edge router inventory.</p>}
            meta={<span className={cn("inline-flex rounded-full px-3 py-1.5 font-mono text-[11px] font-bold tracking-[0.04em]", nb ? "border-2 border-border bg-white text-foreground shadow-brutal-sm" : "bg-[#131313] text-pastel-mint")}>Live registry view</span>}
          />

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Devices", value: summary.total, caption: "Total registry targets", bg: "bg-pastel-lavender", meta: "text-[#5c5170]" },
              { label: "Online", value: summary.online, caption: "Healthy and reachable", bg: "bg-pastel-mint", meta: "text-[#4a5a50]" },
              { label: "Offline", value: summary.offline, caption: "Need operator attention", bg: "bg-pastel-grey", meta: "text-[#6b6b6b]" },
              { label: "Attention", value: summary.attention, caption: "Offline or error state", bg: "bg-pastel-yellow", meta: "text-[#6b5a2e]" },
            ].map((tile) => (
              <div key={tile.label} className={cn("rounded-[20px] px-4 py-3 sm:min-h-[74px]", nb ? "border-2 border-border bg-white shadow-brutal" : tile.bg)}>
                <p className={cn("text-[10px] font-semibold uppercase tracking-[0.16em]", nb ? "text-foreground" : "text-[#131313]")}>{tile.label}</p>
                <p className={cn("mt-1 font-display text-lg font-bold tracking-[-0.03em] sm:text-2xl", nb ? "text-foreground" : "text-[#131313]")}>{tile.value}</p>
                <p className={cn("mt-1 hidden text-[10px] leading-4 sm:block", nb ? "text-foreground" : tile.meta)}>{tile.caption}</p>
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
