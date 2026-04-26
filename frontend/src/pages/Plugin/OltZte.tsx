import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageSectionHeader } from "@/components/page/section-header";
import { showToast } from "@/lib/toast";
import {
  getZteApiErrorMessage,
  getZteOltSystem,
  getZteOlts,
  getZteOnuDetail,
  getZteOnus,
  isZteConnected,
  rebootZteOnu,
} from "@/lib/zteApi";
import {
  isZteOnuOnline,
  type ZteOlt,
  type ZteOnuDetail,
  type ZteOnuRow,
  zteOnuStatusLabel,
} from "@/types/zte";

function PluginOverlay({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-foreground/35 p-3 sm:items-center sm:p-6">
      <button aria-label="Close overlay" className="absolute inset-0" onClick={onClose} type="button" />
      <div className="relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] border-2 border-border bg-card shadow-brutal-lg sm:rounded-[28px]">
        <div className="flex items-center justify-between gap-3 border-b-2 border-border px-5 py-4">
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          <Button onClick={onClose} type="button" variant="outline">Close</Button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

function formatPower(raw: number | undefined | null): string {
  if (raw == null) return "-";
  return `${((raw - 10000) / 100).toFixed(2)} dBm`;
}

export default function OltZtePage() {
  const [selectedOltId, setSelectedOltId] = useState<string | null>(null);
  const [selectedBoard, setSelectedBoard] = useState("1");
  const [selectedPon, setSelectedPon] = useState("1");
  const [onuFilter, setOnuFilter] = useState<"all" | "online" | "offline" | "los">("all");
  const [onuSearch, setOnuSearch] = useState("");
  const [detailOnu, setDetailOnu] = useState<ZteOnuDetail | null>(null);

  const connected = isZteConnected();

  const oltsQuery = useQuery({
    queryKey: ["zte-olts"],
    queryFn: getZteOlts,
    enabled: connected,
  });

  const systemQuery = useQuery({
    queryKey: ["zte-olt-system", selectedOltId],
    queryFn: () => getZteOltSystem(selectedOltId!),
    enabled: connected && Boolean(selectedOltId),
  });

  const onusQuery = useQuery({
    queryKey: ["zte-onus", selectedOltId, selectedBoard, selectedPon],
    queryFn: () => getZteOnus(selectedOltId!, selectedBoard, selectedPon),
    enabled: connected && Boolean(selectedOltId),
  });

  const onuDetailQuery = useQuery({
    queryKey: ["zte-onu-detail", selectedOltId, selectedBoard, selectedPon, detailOnu?.onu_id],
    queryFn: () => getZteOnuDetail(selectedOltId!, selectedBoard, selectedPon, detailOnu!.onu_id!),
    enabled: connected && Boolean(selectedOltId) && Boolean(detailOnu?.onu_id),
  });

  const rebootOnuMutation = useMutation({
    mutationFn: () => {
      if (!selectedOltId || !detailOnu?.onu_id) throw new Error("Missing OLT or ONU context");
      return rebootZteOnu({ olt_id: selectedOltId, board: selectedBoard, pon: selectedPon, onu_id: detailOnu.onu_id });
    },
    onSuccess: () => {
      showToast({ title: "ONU reboot queued", description: "Reboot command was sent to the ONU.", variant: "success" });
    },
    onError: (error) => {
      showToast({ title: "Failed to reboot ONU", description: getZteApiErrorMessage(error), variant: "error" });
    },
  });

  const filteredOnus = useMemo(() => {
    const source = onusQuery.data ?? [];
    const term = onuSearch.trim().toLowerCase();

    return source
      .filter((onu) => {
        if (onuFilter === "all") return true;
        if (onuFilter === "online") return isZteOnuOnline(onu.status);
        if (onuFilter === "offline") return !isZteOnuOnline(onu.status);
        if (onuFilter === "los") return onu.status === 4;
        return true;
      })
      .filter((onu) => {
        if (!term) return true;
        const haystack = [onu.onu_id, onu.name, onu.sn, onu.description].filter(Boolean).join(" ").toLowerCase();
        return haystack.includes(term);
      });
  }, [onuFilter, onuSearch, onusQuery.data]);

  const selectedOlt: ZteOlt | undefined = oltsQuery.data?.find((olt) => olt.id === selectedOltId);

  if (!connected) {
    return (
      <div className="route-shell-page route-shell-zte space-y-5">
        <section className="route-shell-panel relative overflow-hidden rounded-[28px] border-2 border-border bg-primary/20 px-5 py-6 shadow-[12px_12px_0_0_hsl(var(--border))] sm:px-7 sm:py-8">
          <div className="pointer-events-none absolute -right-8 top-4 h-24 w-24 rotate-[18deg] border-2 border-border bg-primary/90" />
          <div className="pointer-events-none absolute bottom-3 left-6 h-10 w-20 -rotate-6 border-2 border-border bg-accent" />
          <PageSectionHeader
            badge={<Badge variant="secondary">ZTE</Badge>}
            description="ZTE OLT microservice — configure the endpoint in Settings to connect."
            title={<h2 className="text-2xl font-black uppercase tracking-[0.05em] text-foreground sm:text-4xl">OLT ZTE</h2>}
          />
        </section>

        <Card className="overflow-hidden border-2 shadow-brutal">
          <CardContent className="flex flex-col items-center justify-center gap-4 p-10 text-center">
            <p className="text-sm text-muted-foreground">No ZTE connection configured.</p>
            <Link to="/settings">
              <Button type="button" variant="outline">Go to Settings</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="route-shell-page route-shell-zte space-y-5">
      <section className="route-shell-panel relative overflow-hidden rounded-[28px] border-2 border-border bg-primary/20 px-5 py-6 shadow-[12px_12px_0_0_hsl(var(--border))] sm:px-7 sm:py-8">
        <div className="pointer-events-none absolute -right-8 top-4 h-24 w-24 rotate-[18deg] border-2 border-border bg-primary/90" />
        <div className="pointer-events-none absolute bottom-3 left-6 h-10 w-20 -rotate-6 border-2 border-border bg-accent" />
        <PageSectionHeader
          badge={<Badge>ZTE</Badge>}
          description={selectedOlt ? `ZTE OLT · ${selectedOlt.name}` : "ZTE OLT — select an OLT to begin."}
          title={<h2 className="text-2xl font-black uppercase tracking-[0.05em] text-foreground sm:text-4xl">OLT ZTE</h2>}
          actions={
            <Button onClick={() => { void oltsQuery.refetch(); void systemQuery.refetch(); void onusQuery.refetch(); }} type="button" variant="outline">Refresh</Button>
          }
          meta={<Badge variant="success">Connected</Badge>}
        />
      </section>

      {oltsQuery.isError ? (
        <div className="rounded-2xl border-2 border-border bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive shadow-[4px_4px_0_0_hsl(var(--border))]">
          {getZteApiErrorMessage(oltsQuery.error)}
        </div>
      ) : null}

      <Card className="overflow-hidden border-2 shadow-brutal">
        <CardContent className="space-y-4 p-5">
          <h3 className="text-sm font-black uppercase tracking-[0.08em] text-foreground">OLT Device</h3>
          {oltsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading OLTs...</p>
          ) : (oltsQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No OLT devices found. Add one in Settings to get started.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <select
                className="h-11 flex-1 rounded-lg border-2 border-input bg-card px-3 text-sm text-foreground shadow-brutal-sm focus-visible:-translate-x-[1px] focus-visible:-translate-y-[1px] focus-visible:shadow-brutal focus-visible:ring-2 focus-visible:ring-ring"
                value={selectedOltId ?? ""}
                onChange={(e) => { setSelectedOltId(e.target.value || null); setSelectedBoard("1"); setSelectedPon("1"); }}
              >
                <option value="">-- Select OLT --</option>
                {(oltsQuery.data ?? []).map((olt) => (
                  <option key={olt.id} value={olt.id}>{olt.name} ({olt.id})</option>
                ))}
              </select>
              {selectedOltId && systemQuery.data ? (
                <Badge variant={systemQuery.data.isOnline ? "success" : "destructive"}>
                  {selectedOltId} — {systemQuery.data.isOnline ? "Online" : "Offline"}
                </Badge>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedOltId ? (
        <>
          {systemQuery.data ? (
            <Card className="overflow-hidden border-2 shadow-brutal">
              <CardContent className="space-y-3 p-5">
                <h3 className="text-sm font-black uppercase tracking-[0.08em] text-foreground">System Info</h3>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border-2 border-border bg-card/90 px-3 py-2 shadow-[4px_4px_0_0_hsl(var(--border))]">
                    <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">Host</div>
                    <div className="mt-1 text-sm font-black text-foreground">{systemQuery.data?.host ?? selectedOlt?.snmp?.host ?? "-"}</div>
                  </div>
                  <div className="rounded-2xl border-2 border-border bg-card/90 px-3 py-2 shadow-[4px_4px_0_0_hsl(var(--border))]">
                    <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">Status</div>
                    <div className="mt-1"><Badge variant={systemQuery.data?.isOnline ? "success" : "secondary"}>{systemQuery.data?.isOnline ? "Online" : "Offline"}</Badge></div>
                  </div>
                  <div className="rounded-2xl border-2 border-border bg-card/90 px-3 py-2 shadow-[4px_4px_0_0_hsl(var(--border))]">
                    <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">CPU Usage</div>
                    <div className="mt-1 text-sm font-black text-foreground">{systemQuery.data?.cpuUsage != null ? `${systemQuery.data.cpuUsage}%` : "-"}</div>
                  </div>
                  <div className="rounded-2xl border-2 border-border bg-card/90 px-3 py-2 shadow-[4px_4px_0_0_hsl(var(--border))]">
                    <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">MEM Usage</div>
                    <div className="mt-1 text-sm font-black text-foreground">{systemQuery.data?.memoryUsage != null ? `${systemQuery.data.memoryUsage}%` : "-"}</div>
                  </div>
                </div>
                {systemQuery.data?.uptime ? (
                  <div className="rounded-2xl border-2 border-border bg-muted/10 px-4 py-2 text-sm font-semibold text-muted-foreground shadow-[4px_4px_0_0_hsl(var(--border))]">
                    Uptime: {systemQuery.data.uptime}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card className="overflow-hidden border-2 shadow-brutal">
            <CardContent className="space-y-4 p-5">
              <h3 className="text-sm font-black uppercase tracking-[0.08em] text-foreground">Board & PON</h3>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-extrabold uppercase tracking-[0.08em] text-muted-foreground" htmlFor="board-select">Board</label>
                  <select
                    id="board-select"
                    className="h-11 w-28 rounded-lg border-2 border-input bg-card px-3 text-sm text-foreground shadow-brutal-sm focus-visible:-translate-x-[1px] focus-visible:-translate-y-[1px] focus-visible:shadow-brutal focus-visible:ring-2 focus-visible:ring-ring"
                    value={selectedBoard}
                    onChange={(e) => { setSelectedBoard(e.target.value); setSelectedPon("1"); }}
                  >
                    <option value="1">1</option>
                    <option value="2">2</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs font-extrabold uppercase tracking-[0.08em] text-muted-foreground" htmlFor="pon-select">PON</label>
                  <select
                    id="pon-select"
                    className="h-11 w-28 rounded-lg border-2 border-input bg-card px-3 text-sm text-foreground shadow-brutal-sm focus-visible:-translate-x-[1px] focus-visible:-translate-y-[1px] focus-visible:shadow-brutal focus-visible:ring-2 focus-visible:ring-ring"
                    value={selectedPon}
                    onChange={(e) => setSelectedPon(e.target.value)}
                  >
                    {Array.from({ length: 16 }, (_, i) => String(i + 1)).map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
                <Button
                  disabled={!selectedOltId || onusQuery.isFetching}
                  onClick={() => { void onusQuery.refetch(); }}
                  type="button"
                  variant="outline"
                >
                  {onusQuery.isFetching ? "Loading..." : "Load"}
                </Button>
              </div>

              {selectedOltId ? (
                <>
                  <div className="flex justify-end gap-2">
                    <div className="h-3 w-5 rotate-6 border-2 border-border bg-primary" />
                    <div className="h-3 w-10 -rotate-3 border-2 border-border bg-accent" />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <Input placeholder="Search name, SN, ID" value={onuSearch} onChange={(e) => setOnuSearch(e.target.value)} />
                    <div className="flex items-center gap-2">
                      {(["all", "online", "offline", "los"] as const).map((filter) => (
                        <button
                          className={`rounded-lg border-2 border-border px-3 py-1.5 text-sm font-black uppercase tracking-[0.04em] shadow-[4px_4px_0_0_hsl(var(--border))] ${
                            onuFilter === filter ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                          }`}
                          key={filter}
                          onClick={() => setOnuFilter(filter)}
                          type="button"
                        >
                          {filter === "all" ? "All" : filter.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>

                  {onusQuery.isError ? (
                    <div className="rounded-2xl border-2 border-border bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive shadow-[4px_4px_0_0_hsl(var(--border))]">
                      {getZteApiErrorMessage(onusQuery.error)}
                    </div>
                  ) : null}

                  <div className="overflow-x-auto rounded-2xl border-2 border-border shadow-[6px_6px_0_0_hsl(var(--border))]">
                    <table className="min-w-full text-sm">
                      <thead className="bg-muted/30 text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                        <tr>
                          <th className="px-4 py-3">ID</th>
                          <th className="px-4 py-3">Name</th>
                          <th className="px-4 py-3">Serial Number</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">RX Power</th>
                          <th className="px-4 py-3">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredOnus.map((onu: ZteOnuRow) => (
                          <tr className="border-t-2 border-border/80" key={`${onu.onu_id ?? ""}-${onu.sn ?? ""}-${onu.name ?? ""}`}>
                            <td className="px-4 py-3 font-semibold text-foreground">{onu.onu_id ?? "-"}</td>
                            <td className="px-4 py-3 text-foreground">{onu.name || "-"}</td>
                            <td className="px-4 py-3 text-muted-foreground">{onu.sn || "-"}</td>
                            <td className="px-4 py-3">
                              <Badge variant={isZteOnuOnline(onu.status) ? "success" : onu.status === 4 ? "destructive" : "secondary"}>
                                {zteOnuStatusLabel(onu.status ?? 0)}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">{formatPower(onu.rx_power)}</td>
                            <td className="px-4 py-3">
                              <Button onClick={() => setDetailOnu(onu as ZteOnuDetail)} size="sm" type="button" variant="outline">View</Button>
                            </td>
                          </tr>
                        ))}
                        {filteredOnus.length === 0 ? (
                          <tr>
                            <td className="px-4 py-8 text-center text-sm font-semibold text-muted-foreground" colSpan={6}>
                              {onusQuery.isLoading ? "Loading ONU data..." : "No ONU matched current filter."}
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border-2 border-dashed border-border bg-muted/10 p-6 text-center text-sm font-semibold text-muted-foreground">
                  Select Board and PON to view ONU list.
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card className="overflow-hidden border-2 shadow-brutal">
          <CardContent className="p-5 text-sm text-muted-foreground">
            Select an OLT device above to view PON/ONU details.
          </CardContent>
        </Card>
      )}

      <PluginOverlay open={Boolean(detailOnu)} title={`${detailOnu?.name ?? "ONU"} — ONU Detail View`} onClose={() => setDetailOnu(null)}>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border-2 border-border bg-muted/10 px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Location</div>
              <div className="mt-1 text-sm font-medium text-foreground">{onuDetailQuery.data?.location ?? "-"}</div>
            </div>
            <div className="rounded-2xl border-2 border-border bg-muted/10 px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Status</div>
              <div className="mt-1">
                <Badge variant={isZteOnuOnline(onuDetailQuery.data?.status ?? detailOnu?.status) ? "success" : "secondary"}>
                  {zteOnuStatusLabel(onuDetailQuery.data?.status ?? detailOnu?.status ?? 0)}
                </Badge>
              </div>
            </div>
            <div className="rounded-2xl border-2 border-border bg-muted/10 px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Type</div>
              <div className="mt-1 text-sm font-medium text-foreground">{onuDetailQuery.data?.type ?? detailOnu?.type ?? "-"}</div>
            </div>
            <div className="rounded-2xl border-2 border-border bg-muted/10 px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Serial Number</div>
              <div className="mt-1 text-sm font-medium text-foreground">{onuDetailQuery.data?.sn ?? detailOnu?.sn ?? "-"}</div>
            </div>
            <div className="rounded-2xl border-2 border-border bg-muted/10 px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Rx Power</div>
              <div className="mt-1 text-sm font-medium text-foreground">{formatPower(onuDetailQuery.data?.rx_power ?? detailOnu?.rx_power)}</div>
            </div>
            <div className="rounded-2xl border-2 border-border bg-muted/10 px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Tx Power</div>
              <div className="mt-1 text-sm font-medium text-foreground">{formatPower(onuDetailQuery.data?.tx_power ?? detailOnu?.tx_power)}</div>
            </div>
            <div className="rounded-2xl border-2 border-border bg-muted/10 px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Last Online</div>
              <div className="mt-1 text-sm font-medium text-foreground">{onuDetailQuery.data?.online_date ?? detailOnu?.online_date ?? "-"}</div>
            </div>
            <div className="rounded-2xl border-2 border-border bg-muted/10 px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Last Offline</div>
              <div className="mt-1 text-sm font-medium text-foreground">{onuDetailQuery.data?.offline_date ?? detailOnu?.offline_date ?? "-"}</div>
            </div>
            <div className="rounded-2xl border-2 border-border bg-muted/10 px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">WAN IP</div>
              <div className="mt-1 text-sm font-medium text-foreground">{onuDetailQuery.data?.wan_ip ?? detailOnu?.wan_ip ?? "-"}</div>
            </div>
            <div className="rounded-2xl border-2 border-border bg-muted/10 px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Offline Reason</div>
              <div className="mt-1 text-sm font-medium text-foreground">{onuDetailQuery.data?.last_down_reason ?? detailOnu?.last_down_reason ?? "-"}</div>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end pt-2">
            <Button onClick={() => { void onuDetailQuery.refetch(); }} type="button" variant="outline">Refresh</Button>
            <Button disabled={rebootOnuMutation.isPending} onClick={() => rebootOnuMutation.mutate()} type="button" variant="destructive">Reboot ONU</Button>
          </div>
        </div>
      </PluginOverlay>
    </div>
  );
}
