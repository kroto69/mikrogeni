import { Activity, ArrowUpRight, Radio, Router, Wifi } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, getApiErrorMessage, getDashboardSummary } from "@/lib/api";
import { IconDisc, OnuStatusPill } from "@/components/nms/pastel";
import { useTheme } from "@/hooks/useTheme";
import { isNbStyle } from "@/lib/nb";
import { NB_ATTENTION_BG, NB_BLOCK_META, nbStatStrip } from "@/lib/nb";
import { pastelCycleBg, pastelCycleIcon, pastelCycleMeta } from "@/lib/pastel";
import { cn } from "@/lib/utils";

type RecentLog = {
  id: number;
  username: string;
  action: string;
  target: string;
  device: string;
  created_at: string;
};

export default function Dashboard() {
  const { styleMode } = useTheme();
  const nb = isNbStyle(styleMode);
  // Single aggregated request (backend computes per-device data in parallel
  // and caches it for 30s) — replaces the old N+1 fan-out of per-router
  // ppp/active + detail and per-OLT health queries.
  const summaryQuery = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: getDashboardSummary,
    refetchInterval: 30_000,
  });

  // Query key sama dengan Topbar — cache dipakai bersama, tanpa request
  // tambahan untuk kolom aktivitas.
  const { data: recentLogs } = useQuery({
    queryKey: ["activity-logs-recent"],
    queryFn: async () => {
      const { data } = await api.get<{ data: RecentLog[] }>("/activity-logs", { params: { limit: 4 } });
      return data.data ?? [];
    },
    staleTime: 30_000,
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

  const today = new Date()
    .toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    .toUpperCase();

  const firstRouter = mikrotikDevices[0];
  const stats = [
    {
      label: "ONU Online",
      value: String(acs?.online_devices ?? "-"),
      sub: `dari ${acs?.total_devices ?? "-"} ONU`,
      icon: Wifi,
      tone: "bg-pastel-mint",
      meta: "text-[#4a5a50]",
      iconTint: "text-pastel-mint",
      to: "/onu",
    },
    {
      label: "MikroTik",
      value: String(mikrotik?.total ?? "-"),
      sub: firstRouter ? `${firstRouter.name || firstRouter.host} · ${firstRouter.status ?? "unknown"}` : "-",
      icon: Router,
      tone: "bg-pastel-lavender",
      meta: "text-[#5c5170]",
      iconTint: "text-pastel-lavender",
      to: "/mikrotik",
    },
    {
      label: "PPPoE Aktif",
      value: String(mikrotik?.total_ppp_active ?? "-"),
      sub: `${mikrotikDevices.length} router terpantau`,
      icon: Activity,
      tone: "bg-pastel-yellow",
      meta: "text-[#6b5a2e]",
      iconTint: "text-pastel-yellow",
      to: "/mikrotik",
    },
    {
      label: "OLT",
      value: String(totalOltCount),
      sub: `${hiosoDevices.length} Hioso · ${zteConnections.length} ZTE`,
      icon: Radio,
      tone: "bg-pastel-pink",
      meta: "text-[#6b4a5c]",
      iconTint: "text-pastel-pink",
      to: "/hioso",
    },
  ];

  type OltBlock = {
    key: string;
    to: string;
    name: string;
    meta: string;
    count: string;
    online: boolean;
  };
  const oltBlocks: OltBlock[] = [
    ...hiosoDevices.map((device) => ({
      key: `hioso-${device.id}`,
      to: `/hioso?device=${encodeURIComponent(device.id)}`,
      name: device.name || device.host,
      meta: `${device.model || "-"} · ${device.host}`,
      count: `ONU ${device.onu_online ?? 0}/${device.onu_total ?? 0}`,
      online: device.online,
    })),
    ...zteConnections.map((conn) => {
      const isCData = (conn.vendor || "zte") === "cdata";
      return {
        key: `zte-${conn.id}`,
        to: isCData ? `/cdata/${encodeURIComponent(conn.olt_id || conn.id)}` : `/zte/${encodeURIComponent(conn.olt_id || conn.id)}`,
        name: conn.name || conn.base_url,
        meta: `${isCData ? "C-Data" : "ZTE"} · ${conn.base_url}`,
        count: conn.online ? `CPU ${conn.cpu_usage}% · MEM ${conn.memory_usage}%` : "-",
        online: conn.online,
      };
    }),
  ];

  const offlineRouters = mikrotikDevices.filter((d) => d.status && d.status !== "online");
  const offlineOlts = oltBlocks.filter((b) => !b.online);
  const attentionParts = [
    ...(offlineRouters.length > 0 ? [`${offlineRouters.length} router offline`] : []),
    ...(offlineOlts.length > 0 ? [`${offlineOlts.length} OLT offline`] : []),
  ];

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-4xl font-bold tracking-[-0.03em] text-foreground">Halo, Juragan</h1>
        <p className="mt-2 font-mono text-xs tracking-[0.04em] text-muted-foreground">{today}</p>
      </header>

      {summaryQuery.isError ? (
        <div className="rounded-[20px] border border-destructive/40 bg-destructive/10 p-4 text-sm font-semibold text-destructive">
          {getApiErrorMessage(summaryQuery.error)}
        </div>
      ) : null}

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {stats.map(({ label, value, sub, icon: Icon, tone, meta, iconTint, to }, i) => (
          <div
            key={label}
            className={cn(
              "relative overflow-hidden rounded-[20px] p-4 text-[#131313] sm:p-5",
              nb ? "border-2 border-border bg-white shadow-brutal" : tone,
            )}
          >
            {nb ? (
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 h-[6px]"
                style={{ backgroundColor: nbStatStrip(styleMode, i) }}
              />
            ) : null}
            <div className="flex items-center justify-between">
              <IconDisc iconClass={iconTint} className="h-11 w-11">
                <Icon className="h-5 w-5" />
              </IconDisc>
              <Link
                to={to}
                aria-label={`Buka ${label}`}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-full transition-opacity hover:opacity-80",
                  nb ? "border-2 border-border bg-white text-foreground shadow-brutal-sm" : "bg-[#131313] text-[#f5f5f5]",
                )}
              >
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>
            <p className="mt-4 font-display text-4xl font-bold leading-none tracking-[-0.03em]">{value}</p>
            <p className="mt-1.5 text-sm font-semibold">{label}</p>
            <p className={cn("mt-1 truncate font-mono text-[12px]", nb ? "text-foreground" : meta)}>{sub}</p>
          </div>
        ))}
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-[1fr_340px]">
        <section className="min-w-0">
          <div className="mb-3 flex items-center justify-between px-1">
            <h2 className="font-display text-xl font-bold tracking-[-0.02em] text-foreground">OLT</h2>
            <Link to="/hioso" className={cn("font-mono text-xs font-bold hover:underline", nb ? "text-foreground" : "text-[#1f7a4d] dark:text-pastel-mint")}>
              Lihat semua →
            </Link>
          </div>

          {summaryQuery.isLoading ? (
            <div className="rounded-[20px] border bg-card p-4 text-sm font-semibold text-muted-foreground">
              Memuat OLT…
            </div>
          ) : oltBlocks.length === 0 ? (
            <div className="rounded-[20px] border bg-card p-4 text-sm font-semibold text-muted-foreground">
              Belum ada OLT terdaftar.
            </div>
          ) : (
            <div className="space-y-3">
              {oltBlocks.map((block, i) => (
                <Link key={block.key} to={block.to} className={cn("flex items-center gap-4 rounded-[20px] p-4 text-[#131313]", nb ? "border-2 border-border bg-white shadow-brutal" : pastelCycleBg(i))}>
                  <IconDisc iconClass={pastelCycleIcon(i)} className="h-11 w-11">
                    <Radio className="h-5 w-5" />
                  </IconDisc>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-lg font-bold tracking-[-0.01em]">{block.name}</p>
                    <p className={cn("mt-0.5 truncate font-mono text-[12px]", nb ? NB_BLOCK_META : pastelCycleMeta(i))}>{block.meta}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="hidden font-mono text-[13px] font-bold sm:inline">{block.count}</span>
                    <OnuStatusPill
                      label={block.online ? "Online" : "Offline"}
                      textClass={block.online ? "text-pastel-mint" : "text-pastel-grey"}
                      dotClass={block.online ? "bg-pastel-mint" : "bg-pastel-grey"}
                    />
                    <span className={cn("hidden h-9 w-9 items-center justify-center rounded-full sm:flex", nb ? "border-2 border-border bg-white text-foreground shadow-brutal-sm" : "bg-[#131313] text-[#f5f5f5]")}>
                      <ArrowUpRight className="h-4 w-4" />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="min-w-0">
          <div className="mb-3 px-1">
            <h2 className="font-display text-xl font-bold tracking-[-0.02em] text-foreground">Aktivitas terakhir</h2>
          </div>

          {attentionParts.length > 0 ? (
            <div className={cn("mb-3 rounded-[20px] p-4 text-[#131313]", nb ? cn(NB_ATTENTION_BG, "border-2 border-border shadow-brutal") : "bg-pastel-yellow")}>
              <p className={cn("font-mono text-[11px] font-bold tracking-[0.05em]", nb ? "text-foreground" : "text-[#6b5a2e]")}>PERLU PERHATIAN</p>
              <p className="mt-1.5 text-sm font-semibold leading-snug">{attentionParts.join(" · ")}</p>
            </div>
          ) : null}

          {(recentLogs ?? []).length === 0 ? (
            <div className="rounded-[20px] border bg-card p-4 text-sm font-semibold text-muted-foreground">
              Belum ada aktivitas.
            </div>
          ) : (
            <div className="space-y-2.5">
              {(recentLogs ?? []).map((log) => (
                <div key={log.id} className={cn("flex items-center gap-3 rounded-[16px] p-3 text-[#131313]", nb ? "border-2 border-border bg-white shadow-brutal-sm" : "bg-pastel-mint")}>
                  <IconDisc iconClass="text-pastel-mint" className="h-9 w-9">
                    <Activity className="h-4 w-4" />
                  </IconDisc>
                  <p className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-snug">
                    {log.action.replace(/_/g, " ")} · {log.target}
                  </p>
                  <span className={cn("shrink-0 font-mono text-[11px]", nb ? "text-foreground" : "text-[#4a5a50]")}>
                    {new Date(log.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
