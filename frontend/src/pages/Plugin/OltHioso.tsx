import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageSectionHeader } from "@/components/page/section-header";
import {
  getAcsSettings,
  getApiErrorMessage,
  getHiosoOnuDetail,
  getHiosoOnus,
  getHiosoPluginHealth,
  getHiosoPluginStatus,
  getHiosoPorts,
  rebootHiosoOnu,
  renameHiosoOnu,
  type HiosoOnuRow,
} from "@/lib/api";
import { showToast } from "@/lib/toast";

function PluginOverlay({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  if (!open) {
    return null;
  }

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

function isOnuOnline(status?: string) {
  const normalized = String(status ?? "").toLowerCase();
  return normalized.includes("up") || normalized.includes("online") || normalized.includes("active");
}

export default function OltHiosoPage() {
  const queryClient = useQueryClient();
  const [onuFilter, setOnuFilter] = useState<"all" | "online" | "offline">("all");
  const [onuSearch, setOnuSearch] = useState("");
  const [portFilter, setPortFilter] = useState<number | null>(null);
  const [detailOnuIndex, setDetailOnuIndex] = useState<string | null>(null);
  const [editOnu, setEditOnu] = useState<{ index: string; name: string } | null>(null);

  const pluginSettingsQuery = useQuery({
    queryKey: ["acs-settings"],
    queryFn: getAcsSettings,
  });

  const pluginStatusQuery = useQuery({
    queryKey: ["hioso-plugin-status"],
    queryFn: getHiosoPluginStatus,
  });

  const pluginHealthQuery = useQuery({
    queryKey: ["hioso-plugin-health"],
    queryFn: getHiosoPluginHealth,
    enabled: Boolean(pluginStatusQuery.data?.enabled),
  });

  const isHiosoVendor = (pluginSettingsQuery.data?.plugin_vendor ?? "hioso").trim().toLowerCase() === "hioso";
  const hasRuntimeConfig = Boolean(
    pluginSettingsQuery.data?.plugin_host?.trim() &&
    (pluginSettingsQuery.data?.plugin_snmp_community?.trim() || pluginSettingsQuery.data?.plugin_community?.trim()),
  );

  const portsQuery = useQuery({
    queryKey: ["hioso-ports"],
    queryFn: getHiosoPorts,
    enabled: isHiosoVendor && Boolean(pluginStatusQuery.data?.enabled) && hasRuntimeConfig,
  });

  const onusQuery = useQuery({
    queryKey: ["hioso-onus", portFilter],
    queryFn: () => getHiosoOnus(portFilter ?? undefined),
    enabled: isHiosoVendor && Boolean(pluginStatusQuery.data?.enabled) && hasRuntimeConfig,
  });

  const onuDetailQuery = useQuery({
    queryKey: ["hioso-onu-detail", detailOnuIndex],
    queryFn: () => getHiosoOnuDetail(detailOnuIndex ?? ""),
    enabled: Boolean(detailOnuIndex),
  });

  const renameOnuMutation = useMutation({
    mutationFn: ({ index, name }: { index: string; name: string }) => renameHiosoOnu(index, name),
    onSuccess: async () => {
      showToast({ title: "ONU name updated", description: "The ONU name was saved successfully.", variant: "success" });
      setEditOnu(null);
      await queryClient.invalidateQueries({ queryKey: ["hioso-onus"] });
      await queryClient.invalidateQueries({ queryKey: ["hioso-onu-detail"] });
    },
    onError: (error) => {
      showToast({ title: "Failed to update ONU name", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const rebootOnuMutation = useMutation({
    mutationFn: (index: string) => rebootHiosoOnu(index),
    onSuccess: () => {
      showToast({ title: "ONU reboot queued", description: "Reboot command was sent to the ONU.", variant: "success" });
    },
    onError: (error) => {
      showToast({ title: "Failed to reboot ONU", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const filteredOnus = useMemo(() => {
    const source = onusQuery.data ?? [];
    const term = onuSearch.trim().toLowerCase();

    return source
      .filter((onu) => {
        if (onuFilter === "all") {
          return true;
        }

        return onuFilter === "online" ? isOnuOnline(onu.status) : !isOnuOnline(onu.status);
      })
      .filter((onu) => {
        if (!term) {
          return true;
        }

        const haystack = [onu.index, onu.name, onu.sn, onu.profile, String(onu.port ?? ""), String(onu.onu_id ?? "")].filter(Boolean).join(" ").toLowerCase();
        return haystack.includes(term);
      });
  }, [onuFilter, onuSearch, onusQuery.data]);

  const onlineCount = (onusQuery.data ?? []).filter((onu) => isOnuOnline(onu.status)).length;
  const totalCount = onusQuery.data?.length ?? 0;
  const downCount = Math.max(totalCount - onlineCount, 0);
  const healthOnline = Boolean(pluginHealthQuery.data?.online);
  const healthDetail = pluginHealthQuery.data?.detail || (healthOnline ? "OLT reachable" : "Health status unavailable");

  return (
    <div className="route-shell-page route-shell-plugin-hioso space-y-5">
      <section className="route-shell-panel relative overflow-hidden rounded-[26px] border-2 border-border bg-primary/20 px-4 py-5 shadow-[12px_12px_0_0_hsl(var(--border))] sm:px-6 sm:py-6">
        <div className="pointer-events-none absolute -right-5 top-4 h-20 w-20 rotate-12 border-2 border-border bg-primary/90" />
        <div className="pointer-events-none absolute bottom-3 left-5 h-4 w-16 -rotate-6 border-2 border-border bg-accent" />
        <PageSectionHeader
          badge={<Badge>Plugin</Badge>}
          description={pluginSettingsQuery.data?.plugin_host?.trim() ? `HIOSOO OLT · ${pluginSettingsQuery.data.plugin_host.trim()}` : "HIOSOO OLT runtime from Settings → Plugin."}
          title={<h2 className="text-2xl font-black uppercase tracking-[0.05em] text-foreground sm:text-4xl">OLT HIOSOO</h2>}
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => {
                  void pluginStatusQuery.refetch();
                  void pluginHealthQuery.refetch();
                  void onusQuery.refetch();
                  void portsQuery.refetch();
                }}
                type="button"
                variant="outline"
              >
                Refresh
              </Button>
            </div>
          )}
          meta={<Badge variant={healthOnline ? "success" : "secondary"}>{healthOnline ? "Online" : "Offline"}</Badge>}
        />
      </section>

      {!isHiosoVendor ? (
        <Card className="overflow-hidden border-2 shadow-brutal">
          <CardContent className="p-5 text-sm text-muted-foreground">
            Plugin vendor in Settings is not set to HIOSOO. Set vendor to HIOSOO to activate this page.
          </CardContent>
        </Card>
      ) : null}

      {isHiosoVendor && !pluginStatusQuery.data?.enabled ? (
        <Card className="overflow-hidden border-2 shadow-brutal">
          <CardContent className="space-y-2 p-5 text-sm text-muted-foreground">
            <p>HIOSOO plugin runtime is currently disabled.</p>
            <p>Enable it from backend runtime control (`/api/plugin/hioso/enable`) and refresh this page.</p>
          </CardContent>
        </Card>
      ) : null}

      {isHiosoVendor && pluginStatusQuery.data?.enabled && !hasRuntimeConfig ? (
        <Card className="overflow-hidden border-2 shadow-brutal">
          <CardContent className="space-y-2 p-5 text-sm text-muted-foreground">
            <p>SNMP runtime configuration is incomplete.</p>
            <p>Set host/ip and SNMP community in Settings → Plugin, then refresh this page.</p>
          </CardContent>
        </Card>
      ) : null}

      {isHiosoVendor && pluginStatusQuery.data?.enabled && hasRuntimeConfig ? (
        <Card className="overflow-hidden border-2 shadow-brutal">
          <CardContent className="space-y-4 p-5">
            <div className="flex justify-end gap-2">
              <div className="h-3 w-5 rotate-6 border-2 border-border bg-primary" />
              <div className="h-3 w-10 -rotate-3 border-2 border-border bg-accent" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Input placeholder="Search index, name, serial, port, profile" value={onuSearch} onChange={(event) => setOnuSearch(event.target.value)} />
              <div className="flex items-center gap-2">
                {(["all", "online", "offline"] as const).map((filter) => (
                  <button
                    className={`rounded-lg border-2 border-border px-3 py-1.5 text-sm font-black uppercase tracking-[0.04em] shadow-[4px_4px_0_0_hsl(var(--border))] ${onuFilter === filter ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}
                    key={filter}
                    onClick={() => setOnuFilter(filter)}
                    type="button"
                  >
                    {filter === "all" ? "All" : filter}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 overflow-x-auto">
                <button
                  className={`rounded-lg border-2 border-border px-3 py-1.5 text-sm font-black uppercase tracking-[0.04em] shadow-[4px_4px_0_0_hsl(var(--border))] ${portFilter == null ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}
                  onClick={() => setPortFilter(null)}
                  type="button"
                >
                  All Ports
                </button>
                {(portsQuery.data ?? []).map((p) => (
                  <button
                    className={`rounded-lg border-2 border-border px-3 py-1.5 text-sm font-black tracking-[0.04em] shadow-[4px_4px_0_0_hsl(var(--border))] ${portFilter === p ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}
                    key={p}
                    onClick={() => setPortFilter(p === portFilter ? null : p)}
                    type="button"
                  >
                    P{p}
                  </button>
                ))}
              </div>
              <div className="rounded-2xl border-2 border-border bg-card/90 px-3 py-2 text-sm font-black uppercase tracking-[0.04em] text-muted-foreground shadow-[4px_4px_0_0_hsl(var(--border))]">Total: {totalCount}</div>
            </div>
            <div className="rounded-2xl border-2 border-border bg-card/90 px-3 py-2 text-sm font-black uppercase tracking-[0.04em] text-muted-foreground shadow-[4px_4px_0_0_hsl(var(--border))]">Online: {onlineCount} · Down: {downCount}</div>

            <div className="rounded-2xl border-2 border-border bg-muted/10 px-4 py-3 text-sm font-semibold text-muted-foreground shadow-[4px_4px_0_0_hsl(var(--border))]">
              {healthDetail}
            </div>

            {onusQuery.isError ? (
              <div className="rounded-2xl border-2 border-border bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive shadow-[4px_4px_0_0_hsl(var(--border))]">
                {getApiErrorMessage(onusQuery.error)}
              </div>
            ) : null}

            <div className="overflow-x-auto rounded-2xl border-2 border-border shadow-[6px_6px_0_0_hsl(var(--border))]">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/30 text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Index</th>
                    <th className="px-4 py-3">Port</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Serial</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Signals</th>
                    <th className="px-4 py-3">Profile</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOnus.map((onu: HiosoOnuRow) => (
                    <tr className="border-t-2 border-border/80" key={onu.index}>
                      <td className="px-4 py-3 font-semibold text-foreground">{onu.index}</td>
                      <td className="px-4 py-3 text-foreground">{onu.port ?? "-"}</td>
                      <td className="px-4 py-3 text-foreground">{onu.name || "-"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{onu.sn || "-"}</td>
                      <td className="px-4 py-3">
                        <Badge variant={isOnuOnline(onu.status) ? "success" : "secondary"}>{onu.status || "Unknown"}</Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">Tx {onu.tx_power ?? "-"} / Rx {onu.rx_power ?? "-"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{onu.profile || "-"}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Button onClick={() => setDetailOnuIndex(onu.index)} size="sm" type="button" variant="outline">Detail</Button>
                          <Button onClick={() => setEditOnu({ index: onu.index, name: onu.name || "" })} size="sm" type="button" variant="outline">Edit</Button>
                          <Button
                            disabled={rebootOnuMutation.isPending}
                            onClick={() => rebootOnuMutation.mutate(onu.index)}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            Reboot
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredOnus.length === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-sm font-semibold text-muted-foreground" colSpan={8}>
                        {onusQuery.isLoading ? "Loading ONU data..." : "No ONU matched current filter."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <PluginOverlay open={Boolean(detailOnuIndex)} title="ONU Detail" onClose={() => setDetailOnuIndex(null)}>
<div className="space-y-3 text-sm text-muted-foreground">
          <div><span className="font-semibold text-foreground">Index:</span> {onuDetailQuery.data?.index || "-"}</div>
          <div><span className="font-semibold text-foreground">Web ID:</span> {onuDetailQuery.data?.web_id || "-"}</div>
          <div><span className="font-semibold text-foreground">Port:</span> {onuDetailQuery.data?.port ?? "-"}</div>
          <div><span className="font-semibold text-foreground">ONU ID:</span> {onuDetailQuery.data?.onu_id ?? "-"}</div>
          <div><span className="font-semibold text-foreground">Name:</span> {onuDetailQuery.data?.name || "-"}</div>
          <div><span className="font-semibold text-foreground">Serial:</span> {onuDetailQuery.data?.sn || "-"}</div>
          <div><span className="font-semibold text-foreground">Status:</span> {onuDetailQuery.data?.status || "-"}</div>
          <div><span className="font-semibold text-foreground">TX Power:</span> {onuDetailQuery.data?.tx_power ?? "-"}</div>
          <div><span className="font-semibold text-foreground">RX Power:</span> {onuDetailQuery.data?.rx_power ?? "-"}</div>
          <div><span className="font-semibold text-foreground">Profile:</span> {onuDetailQuery.data?.profile || "-"}</div>
        </div>
      </PluginOverlay>

      <PluginOverlay open={Boolean(editOnu)} title="Edit ONU Name" onClose={() => setEditOnu(null)}>
        <form
          className="space-y-4"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (!editOnu) {
              return;
            }
            renameOnuMutation.mutate({ index: editOnu.index, name: editOnu.name });
          }}
        >
          <Input value={editOnu?.name || ""} onChange={(event) => setEditOnu((current) => current ? { ...current, name: event.target.value } : current)} />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditOnu(null)} type="button" variant="outline">Cancel</Button>
            <Button disabled={renameOnuMutation.isPending} type="submit">Save</Button>
          </div>
        </form>
      </PluginOverlay>
    </div>
  );
}
