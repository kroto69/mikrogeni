import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageSectionHeader } from "@/components/page/section-header";
import {
  clearStoredPluginSession,
  getPluginApiErrorMessage,
  getHiosoDevices,
  getHiosoDeviceDetail,
  getHiosoDeviceStatus,
  getHiosoOnuDetail,
  getHiosoOnus,
  getHiosoPons,
  getHiosoSystem,
  getStoredPluginSession,
  loginHiosoPlugin,
  updateHiosoOnuName,
} from "@/lib/pluginApi";
import { getAcsSettings } from "@/lib/api";
import { showToast } from "@/lib/toast";
import type { HiosoOnuRow } from "@/types/plugin-olt";

function PluginOverlay({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/40 p-3 sm:items-center sm:p-6">
      <button aria-label="Close overlay" className="absolute inset-0" onClick={onClose} type="button" />
      <div className="relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] border border-border bg-card shadow-2xl sm:rounded-[28px]">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          <Button onClick={onClose} type="button" variant="outline">Close</Button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

export default function OltHiosoPage() {
  const queryClient = useQueryClient();
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [selectedPonId, setSelectedPonId] = useState<string | null>(null);
  const [onuFilter, setOnuFilter] = useState<"all" | "online" | "offline">("all");
  const [onuSearch, setOnuSearch] = useState("");
  const [detailOnuId, setDetailOnuId] = useState<string | null>(null);
  const [editOnu, setEditOnu] = useState<{ id: string; name: string } | null>(null);
  const [isPluginAuthenticated, setIsPluginAuthenticated] = useState(Boolean(getStoredPluginSession()));

  const pluginSettingsQuery = useQuery({
    queryKey: ["acs-settings"],
    queryFn: getAcsSettings,
  });

  const loginMutation = useMutation({
    mutationFn: loginHiosoPlugin,
    onSuccess: () => {
      setIsPluginAuthenticated(true);
      showToast({ title: "Plugin login successful", description: "HIOSOO OLT backend is now connected.", variant: "success" });
      void queryClient.invalidateQueries({ queryKey: ["hioso-devices"] });
    },
    onError: (error) => {
      showToast({ title: "Plugin login failed", description: getPluginApiErrorMessage(error), variant: "error" });
    },
  });

  useEffect(() => {
    if (isPluginAuthenticated || loginMutation.isPending || !pluginSettingsQuery.data) {
      return;
    }

    const configuredVendor = (pluginSettingsQuery.data.plugin_vendor ?? "hioso").toLowerCase();
    const username = pluginSettingsQuery.data.plugin_username ?? "";
    const password = pluginSettingsQuery.data.plugin_password ?? "";

    if (configuredVendor !== "hioso" || !username.trim() || !password.trim()) {
      return;
    }

    loginMutation.mutate({ username: username.trim(), password });
  }, [isPluginAuthenticated, loginMutation, pluginSettingsQuery.data]);

  const devicesQuery = useQuery({
    queryKey: ["hioso-devices"],
    queryFn: getHiosoDevices,
    enabled: isPluginAuthenticated,
  });

  useEffect(() => {
    if (!selectedDeviceId && devicesQuery.data?.[0]?.id) {
      setSelectedDeviceId(devicesQuery.data[0].id);
    }
  }, [devicesQuery.data, selectedDeviceId]);

  const detailQuery = useQuery({
    queryKey: ["hioso-device-detail", selectedDeviceId],
    queryFn: () => getHiosoDeviceDetail(selectedDeviceId ?? ""),
    enabled: Boolean(isPluginAuthenticated && selectedDeviceId),
  });

  const statusQuery = useQuery({
    queryKey: ["hioso-device-status", selectedDeviceId],
    queryFn: () => getHiosoDeviceStatus(selectedDeviceId ?? ""),
    enabled: Boolean(isPluginAuthenticated && selectedDeviceId),
  });

  const systemQuery = useQuery({
    queryKey: ["hioso-device-system", selectedDeviceId],
    queryFn: () => getHiosoSystem(selectedDeviceId ?? ""),
    enabled: Boolean(isPluginAuthenticated && selectedDeviceId),
  });

  const ponsQuery = useQuery({
    queryKey: ["hioso-device-pons", selectedDeviceId],
    queryFn: () => getHiosoPons(selectedDeviceId ?? ""),
    enabled: Boolean(isPluginAuthenticated && selectedDeviceId),
  });

  useEffect(() => {
    if (!selectedPonId && ponsQuery.data?.[0]?.pon_id) {
      setSelectedPonId(ponsQuery.data[0].pon_id);
    }
  }, [ponsQuery.data, selectedPonId]);

  const onusQuery = useQuery({
    queryKey: ["hioso-device-onus", selectedDeviceId, selectedPonId, onuFilter],
    queryFn: () => getHiosoOnus(selectedDeviceId ?? "", selectedPonId ?? "", onuFilter === "all" ? undefined : onuFilter),
    enabled: Boolean(isPluginAuthenticated && selectedDeviceId && selectedPonId),
  });

  const onuDetailQuery = useQuery({
    queryKey: ["hioso-onu-detail", selectedDeviceId, detailOnuId],
    queryFn: () => getHiosoOnuDetail(selectedDeviceId ?? "", detailOnuId ?? ""),
    enabled: Boolean(isPluginAuthenticated && selectedDeviceId && detailOnuId),
  });

  const renameOnuMutation = useMutation({
    mutationFn: ({ onuId, name }: { onuId: string; name: string }) => updateHiosoOnuName(selectedDeviceId ?? "", onuId, name),
    onSuccess: async () => {
      showToast({ title: "ONU name updated", description: "The ONU name was saved successfully.", variant: "success" });
      setEditOnu(null);
      await queryClient.invalidateQueries({ queryKey: ["hioso-device-onus", selectedDeviceId] });
      await queryClient.invalidateQueries({ queryKey: ["hioso-onu-detail", selectedDeviceId] });
    },
    onError: (error) => {
      showToast({ title: "Failed to update ONU name", description: getPluginApiErrorMessage(error), variant: "error" });
    },
  });

  const filteredOnus = useMemo(() => {
    const term = onuSearch.trim().toLowerCase();
    return (onusQuery.data ?? []).filter((onu) => [onu.onu_id, onu.name, onu.mac_address]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(term));
  }, [onuSearch, onusQuery.data]);

  const onlineCount = (onusQuery.data ?? []).filter((onu) => String(onu.status || "").toLowerCase().includes("up") || String(onu.status || "").toLowerCase().includes("online")).length;
  const totalCount = onusQuery.data?.length ?? 0;
  const downCount = Math.max(totalCount - onlineCount, 0);

  if (!isPluginAuthenticated) {
    const configuredVendor = (pluginSettingsQuery.data?.plugin_vendor ?? "hioso").toLowerCase();
    const hasPluginCredentials = Boolean(pluginSettingsQuery.data?.plugin_username?.trim() && pluginSettingsQuery.data?.plugin_password?.trim());

    return (
      <div className="space-y-4">
        <section className="rounded-[24px] border border-border/80 bg-card/95 px-4 py-4 shadow-panel sm:px-5">
          <PageSectionHeader badge={<Badge>Plugin</Badge>} description="Plugin credentials are managed in Settings, so this page connects automatically when HIOSOO is configured." title="OLT HIOSOO" />
        </section>

        <Card>
          <CardContent className="p-5">
            {!pluginSettingsQuery.data ? (
              <p className="text-sm text-muted-foreground">Loading plugin settings...</p>
            ) : configuredVendor !== "hioso" ? (
              <p className="text-sm text-muted-foreground">Plugin vendor in Settings is not set to HIOSOO yet. Change it in Settings → Plugin to activate this page.</p>
            ) : !hasPluginCredentials ? (
              <p className="text-sm text-muted-foreground">Set plugin username and password in Settings → Plugin first.</p>
            ) : loginMutation.isPending ? (
              <p className="text-sm text-muted-foreground">Connecting to the HIOSOO plugin backend...</p>
            ) : (
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>Automatic plugin login failed.</p>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => loginMutation.mutate({ username: pluginSettingsQuery.data.plugin_username.trim(), password: pluginSettingsQuery.data.plugin_password })} type="button">Retry</Button>
                  <Button onClick={() => clearStoredPluginSession()} type="button" variant="outline">Reset Plugin Session</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const activeDevice = devicesQuery.data?.find((device) => device.id === selectedDeviceId) ?? detailQuery.data;
  const system = systemQuery.data;
  const statusLabel = statusQuery.data?.status || (statusQuery.data?.online ? "Online" : "Unknown");

  return (
    <div className="space-y-4">
      <section className="rounded-[24px] border border-border/80 bg-card/95 px-4 py-4 shadow-panel sm:px-5">
        <PageSectionHeader
          badge={<Badge>Plugin</Badge>}
          description={activeDevice?.base_url || "HIOSOO OLT monitoring through plugin backend."}
          title="OLT Detail"
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => { void detailQuery.refetch(); void systemQuery.refetch(); void ponsQuery.refetch(); void onusQuery.refetch(); }} type="button" variant="outline">Refresh</Button>
              <Button onClick={() => { clearStoredPluginSession(); setIsPluginAuthenticated(false); setSelectedDeviceId(null); setSelectedPonId(null); }} type="button" variant="outline">Logout Plugin</Button>
            </div>
          )}
          meta={<Badge variant={String(statusLabel).toLowerCase().includes("online") ? "success" : "secondary"}>{statusLabel}</Badge>}
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <Card>
          <CardContent className="space-y-2 p-4">
            <p className="text-sm font-semibold text-foreground">Devices</p>
            {(devicesQuery.data ?? []).map((device) => (
              <button
                className={`w-full rounded-2xl border px-3 py-2 text-left text-sm ${selectedDeviceId === device.id ? "border-sky-500 bg-sky-50 text-sky-900" : "border-border bg-card text-foreground"}`}
                key={device.id}
                onClick={() => {
                  setSelectedDeviceId(device.id);
                  setSelectedPonId(null);
                }}
                type="button"
              >
                <div className="font-semibold">{device.name}</div>
                <div className="text-xs text-muted-foreground">ID: {device.id}</div>
              </button>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-semibold text-foreground">{activeDevice?.name || "OLT Detail"}</h2>
                  <p className="text-sm text-muted-foreground">{activeDevice?.base_url || "-"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">ID: {activeDevice?.id || "-"}</p>
                </div>
                <Badge variant={String(statusLabel).toLowerCase().includes("online") ? "success" : "secondary"}>{statusLabel}</Badge>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {[
                  ["System", system?.system_name || "-"],
                  ["Switch", system?.switch_type || "-"],
                  ["Software", system?.software_version || "-"],
                  ["Uptime", system?.uptime || "-"],
                  ["IP", system?.ip_address || "-"],
                  ["MAC", system?.mac_address || "-"],
                ].map(([label, value]) => (
                  <div className="rounded-2xl border border-border/80 bg-card/90 px-3 py-2.5" key={String(label)}>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
                    <p className="mt-1 text-sm font-semibold text-foreground break-all">{value}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="flex flex-wrap gap-2">
                {(ponsQuery.data ?? []).map((pon) => (
                  <button
                    className={`rounded-full px-3 py-1.5 text-sm font-medium ${selectedPonId === pon.pon_id ? "bg-sky-600 text-white" : "bg-muted text-foreground"}`}
                    key={pon.pon_id}
                    onClick={() => setSelectedPonId(pon.pon_id)}
                    type="button"
                  >
                    PON {pon.full_id}
                  </button>
                ))}
              </div>

              <div className="space-y-4">
                <PageSectionHeader
                  description="Klik row untuk detail atau action cepat."
                  title={`ONU Table - PON ${ponsQuery.data?.find((pon) => pon.pon_id === selectedPonId)?.full_id ?? "-"}`}
                  actions={<Button onClick={() => void onusQuery.refetch()} type="button" variant="outline">Refresh ONU</Button>}
                />

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Input placeholder="Cari ID, nama, atau MAC" value={onuSearch} onChange={(event) => setOnuSearch(event.target.value)} />
                  <div className="flex items-center gap-2">
                    {(["all", "online", "offline"] as const).map((filter) => (
                      <button
                        className={`rounded-full px-3 py-1.5 text-sm font-medium ${onuFilter === filter ? "bg-sky-600 text-white" : "bg-muted text-foreground"}`}
                        key={filter}
                        onClick={() => setOnuFilter(filter)}
                        type="button"
                      >
                        {filter === "all" ? "Semua" : filter}
                      </button>
                    ))}
                  </div>
                  <div className="text-sm text-muted-foreground">Total: {totalCount}</div>
                  <div className="text-sm text-muted-foreground">Online: {onlineCount} · Down: {downCount}</div>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-border/80">
                  <table className="min-w-full text-sm">
                    <thead className="bg-muted/30 text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">ID</th>
                        <th className="px-4 py-3">Nama</th>
                        <th className="px-4 py-3">MAC</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Signals</th>
                        <th className="px-4 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOnus.map((onu: HiosoOnuRow) => (
                        <tr className="border-t border-border/80" key={onu.onu_id || onu.id}>
                          <td className="px-4 py-3 font-medium text-foreground">{onu.onu_id || onu.id || "-"}</td>
                          <td className="px-4 py-3 text-foreground">{onu.name || "-"}</td>
                          <td className="px-4 py-3 text-muted-foreground">{onu.mac_address || "-"}</td>
                          <td className="px-4 py-3"><Badge variant={String(onu.status || "").toLowerCase().includes("up") || String(onu.status || "").toLowerCase().includes("online") ? "success" : "secondary"}>{onu.status || "Unknown"}</Badge></td>
                          <td className="px-4 py-3 text-muted-foreground">Rx {onu.rx_power ?? "-"} dBm</td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2">
                              <Button onClick={() => setDetailOnuId(onu.onu_id || onu.id || null)} size="sm" type="button" variant="outline">Detail</Button>
                              <Button onClick={() => setEditOnu({ id: onu.onu_id || onu.id || "", name: onu.name || "" })} size="sm" type="button" variant="outline">Edit</Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <PluginOverlay open={Boolean(detailOnuId)} title="ONU Detail" onClose={() => setDetailOnuId(null)}>
        <div className="space-y-3 text-sm text-muted-foreground">
          <div><span className="font-semibold text-foreground">ONU ID:</span> {onuDetailQuery.data?.onu_id || "-"}</div>
          <div><span className="font-semibold text-foreground">Name:</span> {onuDetailQuery.data?.name || "-"}</div>
          <div><span className="font-semibold text-foreground">MAC:</span> {onuDetailQuery.data?.mac_address || "-"}</div>
          <div><span className="font-semibold text-foreground">Status:</span> {onuDetailQuery.data?.status || "-"}</div>
          <div><span className="font-semibold text-foreground">First Uptime:</span> {onuDetailQuery.data?.first_uptime || "-"}</div>
          <div><span className="font-semibold text-foreground">Last Uptime:</span> {onuDetailQuery.data?.last_uptime || "-"}</div>
          <div><span className="font-semibold text-foreground">Temperature:</span> {onuDetailQuery.data?.optical_module?.temperature ?? "-"}</div>
          <div><span className="font-semibold text-foreground">TX Power:</span> {onuDetailQuery.data?.optical_module?.tx_power ?? "-"}</div>
          <div><span className="font-semibold text-foreground">RX Power:</span> {onuDetailQuery.data?.optical_module?.rx_power ?? "-"}</div>
        </div>
      </PluginOverlay>

      <PluginOverlay open={Boolean(editOnu)} title="Edit ONU Name" onClose={() => setEditOnu(null)}>
        <form className="space-y-4" onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (!editOnu) {
            return;
          }
          renameOnuMutation.mutate({ onuId: editOnu.id, name: editOnu.name });
        }}>
          <Input value={editOnu?.name || ""} onChange={(event) => setEditOnu((current) => current ? { ...current, name: event.target.value } : current)} />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditOnu(null)} type="button" variant="outline">Cancel</Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </PluginOverlay>
    </div>
  );
}
