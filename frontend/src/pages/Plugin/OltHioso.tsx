import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageSectionHeader } from "@/components/page/section-header";
import {
  createHiosoDevice,
  deleteHiosoDevice,
  getApiErrorMessage,
  getHiosoDevices,
  getHiosoOnuDetail,
  getHiosoOnus,
  getHiosoPluginHealth,
  rebootHiosoOnu,
  renameHiosoOnu,
  testHiosoDevice,
  updateHiosoDevice,
  type HiosoOLTDevice,
  type HiosoOnuRow,
} from "@/lib/api";
import { showToast } from "@/lib/toast";

type DeviceFormState = {
  name: string;
  host: string;
  port: string;
  snmp_version: string;
  snmp_community: string;
  web_host: string;
  web_port: string;
  username: string;
  password: string;
};

const EMPTY_DEVICE_FORM: DeviceFormState = {
  name: "",
  host: "",
  port: "161",
  snmp_version: "2c",
  snmp_community: "public",
  web_host: "",
  web_port: "80",
  username: "admin",
  password: "",
};

function buildDeviceForm(device?: HiosoOLTDevice): DeviceFormState {
  if (!device) {
    return { ...EMPTY_DEVICE_FORM };
  }
  return {
    name: device.name ?? "",
    host: device.host ?? "",
    port: String(device.port ?? 161),
    snmp_version: device.snmp_version ?? "2c",
    snmp_community: device.snmp_community ?? "",
    web_host: device.web_host ?? "",
    web_port: String(device.web_port ?? 80),
    username: device.username ?? "",
    password: "",
  };
}

function PluginOverlay({ open, title, description, onClose, children }: { open: boolean; title: string; description?: string; onClose: () => void; children: React.ReactNode }) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-foreground/35 p-3 sm:items-center sm:p-6">
      <button aria-label="Close overlay" className="absolute inset-0" onClick={onClose} type="button" />
      <div className="relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] border-2 border-border bg-card shadow-brutal-lg sm:rounded-[28px]">
        <div className="flex items-center justify-between gap-3 border-b-2 border-border px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
            {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
          </div>
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

function getDeviceStatusVariant(status?: string): "success" | "destructive" | "secondary" {
  const normalized = (status ?? "").toLowerCase();
  if (normalized === "online" || normalized === "healthy") {
    return "success";
  }
  if (normalized === "offline" || normalized === "error" || normalized === "unhealthy") {
    return "destructive";
  }
  return "secondary";
}

export default function OltHiosoPage() {
  const queryClient = useQueryClient();
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [onuFilter, setOnuFilter] = useState<"all" | "online" | "offline">("all");
  const [onuSearch, setOnuSearch] = useState("");
  const [portFilter, setPortFilter] = useState<number>(1);
  const [detailOnuIndex, setDetailOnuIndex] = useState<string | null>(null);
  const [editOnu, setEditOnu] = useState<{ index: string; name: string } | null>(null);
  const [deviceModalMode, setDeviceModalMode] = useState<"closed" | "create" | "edit">("closed");
  const [deviceForm, setDeviceForm] = useState<DeviceFormState>(EMPTY_DEVICE_FORM);
  const [editingDevice, setEditingDevice] = useState<HiosoOLTDevice | null>(null);

  const devicesQuery = useQuery({
    queryKey: ["hioso-devices"],
    queryFn: getHiosoDevices,
  });

  const selectedDevice = (devicesQuery.data ?? []).find((d) => d.id === selectedDeviceId) ?? null;
  const deviceId = selectedDeviceId ?? undefined;

  const healthQuery = useQuery({
    queryKey: ["hioso-health", deviceId],
    queryFn: () => getHiosoPluginHealth(deviceId),
    enabled: Boolean(deviceId),
  });

  const ports = [1, 2, 3, 4];

  const onusQuery = useQuery({
    queryKey: ["hioso-onus", deviceId, portFilter],
    queryFn: () => getHiosoOnus(deviceId!, portFilter),
    enabled: Boolean(deviceId),
  });

  useEffect(() => {
    if (!ports.includes(portFilter)) {
      setPortFilter(ports[0]);
    }
  }, [portFilter]);

  const onuDetailQuery = useQuery({
    queryKey: ["hioso-onu-detail", deviceId, detailOnuIndex],
    queryFn: () => getHiosoOnuDetail(deviceId!, detailOnuIndex!),
    enabled: Boolean(deviceId) && Boolean(detailOnuIndex),
  });

  const renameOnuMutation = useMutation({
    mutationFn: ({ index, name }: { index: string; name: string }) => renameHiosoOnu(deviceId!, index, name),
    onSuccess: async () => {
      showToast({ title: "ONU name updated", description: "The ONU name was saved successfully.", variant: "success" });
      setEditOnu(null);
      await queryClient.invalidateQueries({ queryKey: ["hioso-onus", deviceId] });
      await queryClient.invalidateQueries({ queryKey: ["hioso-onu-detail", deviceId] });
    },
    onError: (error) => {
      showToast({ title: "Failed to update ONU name", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const rebootOnuMutation = useMutation({
    mutationFn: (index: string) => rebootHiosoOnu(deviceId!, index),
    onSuccess: () => {
      showToast({ title: "ONU reboot queued", description: "Reboot command was sent to the ONU.", variant: "success" });
    },
    onError: (error) => {
      showToast({ title: "Failed to reboot ONU", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const createDeviceMutation = useMutation({
    mutationFn: (values: DeviceFormState) => {
      const payload = {
        name: values.name.trim(),
        host: values.host.trim(),
        port: Number(values.port || "161"),
        snmp_version: values.snmp_version || "2c",
        snmp_community: values.snmp_community.trim(),
        web_host: values.web_host.trim(),
        web_port: Number(values.web_port || "80"),
        username: values.username.trim(),
        password: values.password,
      };
      if (!payload.name || !payload.host || !payload.snmp_community) {
        throw new Error("Name, host, and SNMP community are required.");
      }
      return createHiosoDevice(payload);
    },
    onSuccess: async (newDevice) => {
      showToast({ title: "Device created", description: "New OLT device was added.", variant: "success" });
      closeDeviceModal();
      await queryClient.invalidateQueries({ queryKey: ["hioso-devices"] });
      if (newDevice?.id) {
        setSelectedDeviceId(newDevice.id);
      }
    },
    onError: (error) => {
      showToast({ title: "Failed to create device", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const updateDeviceMutation = useMutation({
    mutationFn: ({ deviceId: id, values }: { deviceId: string; values: DeviceFormState }) => {
      const payload: Record<string, string | number> = {
        name: values.name.trim(),
        host: values.host.trim(),
        port: Number(values.port || "161"),
        snmp_version: values.snmp_version || "2c",
        snmp_community: values.snmp_community.trim(),
        web_host: values.web_host.trim(),
        web_port: Number(values.web_port || "80"),
        username: values.username.trim(),
      };
      if (values.password.trim()) {
        payload.password = values.password;
      }
      return updateHiosoDevice(id, payload);
    },
    onSuccess: async () => {
      showToast({ title: "Device updated", description: "Device settings were saved.", variant: "success" });
      closeDeviceModal();
      await queryClient.invalidateQueries({ queryKey: ["hioso-devices"] });
    },
    onError: (error) => {
      showToast({ title: "Failed to update device", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const deleteDeviceMutation = useMutation({
    mutationFn: (id: string) => deleteHiosoDevice(id),
    onSuccess: async () => {
      showToast({ title: "Device deleted", description: "OLT device was removed.", variant: "success" });
      if (selectedDeviceId !== null) {
        const remaining = (devicesQuery.data ?? []).filter((d) => d.id !== selectedDeviceId);
        setSelectedDeviceId(remaining.length > 0 ? remaining[0].id : null);
      }
      await queryClient.invalidateQueries({ queryKey: ["hioso-devices"] });
    },
    onError: (error) => {
      showToast({ title: "Failed to delete device", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const testDeviceMutation = useMutation({
    mutationFn: (id: string) => testHiosoDevice(id),
    onSuccess: () => {
      showToast({ title: "Connection test OK", description: "OLT device is reachable via SNMP.", variant: "success" });
      void queryClient.invalidateQueries({ queryKey: ["hioso-devices"] });
    },
    onError: (error) => {
      showToast({ title: "Connection test failed", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const isDeviceSubmitting = createDeviceMutation.isPending || updateDeviceMutation.isPending;

  const openCreateDeviceModal = () => {
    setEditingDevice(null);
    setDeviceForm({ ...EMPTY_DEVICE_FORM });
    setDeviceModalMode("create");
  };

  const openEditDeviceModal = (device: HiosoOLTDevice) => {
    setEditingDevice(device);
    setDeviceForm(buildDeviceForm(device));
    setDeviceModalMode("edit");
  };

  const closeDeviceModal = () => {
    setEditingDevice(null);
    setDeviceForm({ ...EMPTY_DEVICE_FORM });
    setDeviceModalMode("closed");
  };

  const handleDeviceSubmit = () => {
    if (deviceModalMode === "edit" && editingDevice) {
      updateDeviceMutation.mutate({ deviceId: editingDevice.id, values: deviceForm });
      return;
    }
    createDeviceMutation.mutate(deviceForm);
  };

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
  const healthOnline = Boolean(healthQuery.data?.online);
  const healthDetail = healthQuery.data?.detail || (healthOnline ? "OLT reachable" : "Health status unavailable");

  const devices = devicesQuery.data ?? [];
  if (!selectedDeviceId && devices.length > 0 && !devicesQuery.isLoading) {
    setSelectedDeviceId(devices[0].id);
  }

  return (
    <div className="route-shell-page route-shell-plugin-hioso space-y-5">
      <section className="route-shell-panel relative overflow-hidden rounded-[26px] border-2 border-border bg-primary/20 px-4 py-5 shadow-[12px_12px_0_0_hsl(var(--border))] sm:px-6 sm:py-6">
        <div className="pointer-events-none absolute -right-5 top-4 h-20 w-20 rotate-12 border-2 border-border bg-primary/90" />
        <div className="pointer-events-none absolute bottom-3 left-5 h-4 w-16 -rotate-6 border-2 border-border bg-accent" />
        <PageSectionHeader
          badge={<Badge>Plugin</Badge>}
          description={selectedDevice ? `HIOSO OLT · ${selectedDevice.host}` : "Select or add an OLT device to view data."}
          title={<h2 className="text-2xl font-black uppercase tracking-[0.05em] text-foreground sm:text-4xl">OLT HIOSO</h2>}
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              {selectedDeviceId ? (
                <>
                  <Button
                    onClick={() => {
                      void devicesQuery.refetch();
                      void healthQuery.refetch();
                      void onusQuery.refetch();
                    }}
                    type="button"
                    variant="outline"
                  >
                    Refresh
                  </Button>
                  <Button
                    disabled={testDeviceMutation.isPending}
                    onClick={() => testDeviceMutation.mutate(selectedDeviceId!)}
                    type="button"
                    variant="outline"
                  >
                    Test
                  </Button>
                  <Button
                    onClick={() => openEditDeviceModal(selectedDevice!)}
                    type="button"
                    variant="outline"
                  >
                    Edit Device
                  </Button>
                </>
              ) : null}
              <Button onClick={openCreateDeviceModal} type="button">
                + Add Device
              </Button>
            </div>
          )}
          meta={selectedDeviceId ? <Badge variant={getDeviceStatusVariant(selectedDevice?.status)}>{selectedDevice?.status || "unknown"}</Badge> : undefined}
        />
      </section>

      {devices.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {devices.map((device) => (
            <button
              className={`rounded-lg border-2 border-border px-3 py-1.5 text-sm font-black uppercase tracking-[0.04em] shadow-[4px_4px_0_0_hsl(var(--border))] ${selectedDeviceId === device.id ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}
              key={device.id}
              onClick={() => setSelectedDeviceId(device.id)}
              type="button"
            >
              {device.name || device.host}
            </button>
          ))}
        </div>
      )}

      {devices.length === 0 && !devicesQuery.isLoading ? (
        <Card className="overflow-hidden border-2 shadow-brutal">
          <CardContent className="space-y-2 p-5 text-sm text-muted-foreground">
            <p>No OLT devices registered yet.</p>
            <p>Use <span className="font-semibold text-foreground">+ Add Device</span> to register your first Hioso OLT.</p>
          </CardContent>
        </Card>
      ) : null}

      {devicesQuery.isError ? (
        <Card className="overflow-hidden border-2 shadow-brutal">
          <CardContent className="p-5 text-sm text-destructive">{getApiErrorMessage(devicesQuery.error)}</CardContent>
        </Card>
      ) : null}

      {selectedDeviceId ? (
        <Card className="overflow-hidden border-2 shadow-brutal">
          <CardContent className="space-y-4 p-5">
            <div className="flex justify-end gap-2">
              <div className="h-3 w-5 rotate-6 border-2 border-border bg-primary" />
              <div className="h-3 w-10 -rotate-3 border-2 border-border bg-accent" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Input placeholder="Search index, name, serial, port, profile" value={onuSearch} onChange={(event) => setOnuSearch(event.target.value)} />
              <div className="flex flex-wrap items-center gap-2">
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
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {ports.map((p) => (
                  <button
                    className={`rounded-lg border-2 border-border px-3 py-1.5 text-sm font-black tracking-[0.04em] shadow-[4px_4px_0_0_hsl(var(--border))] ${portFilter === p ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}
                    key={p}
                    onClick={() => setPortFilter(p)}
                    type="button"
                  >
                    P{p}
                  </button>
                ))}
              </div>
              <div className="rounded-2xl border-2 border-border bg-card/90 px-3 py-2 text-sm font-black uppercase tracking-[0.04em] text-muted-foreground shadow-[4px_4px_0_0_hsl(var(--border))]">Total: {totalCount}</div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-2xl border-2 border-border bg-card/90 px-3 py-2 text-sm font-black uppercase tracking-[0.04em] text-muted-foreground shadow-[4px_4px_0_0_hsl(var(--border))]">Online: {onlineCount}</div>
              <div className="rounded-2xl border-2 border-border bg-card/90 px-3 py-2 text-sm font-black uppercase tracking-[0.04em] text-muted-foreground shadow-[4px_4px_0_0_hsl(var(--border))]">Down: {downCount}</div>
            </div>

            <div className="rounded-2xl border-2 border-border bg-muted/10 px-4 py-3 text-sm font-semibold text-muted-foreground shadow-[4px_4px_0_0_hsl(var(--border))]">
              {healthDetail}
            </div>

            {onusQuery.isError ? (
              <div className="rounded-2xl border-2 border-border bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive shadow-[4px_4px_0_0_hsl(var(--border))]">
                {getApiErrorMessage(onusQuery.error)}
              </div>
            ) : null}

            <div className="space-y-2 md:hidden">
              {filteredOnus.map((onu: HiosoOnuRow) => (
                <div className="rounded-2xl border-2 border-border bg-card px-3 py-3 shadow-[4px_4px_0_0_hsl(var(--border))]" key={onu.index}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-black uppercase tracking-[0.04em] text-foreground">{onu.name || "ONU"}</p>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        IDX {onu.index} · P{onu.port ?? "-"}
                      </p>
                    </div>
                    <Badge variant={isOnuOnline(onu.status) ? "success" : "secondary"}>{onu.status || "Unknown"}</Badge>
                  </div>

                  <div className="mt-2 space-y-1 text-xs font-semibold text-muted-foreground">
                    <p className="break-all">SN: {onu.sn || "-"}</p>
                    <p>TX {onu.tx_power ?? "-"} / RX {onu.rx_power ?? "-"}</p>
                    <p className="break-all">Profile: {onu.profile || "-"}</p>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2">
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
                </div>
              ))}

              {filteredOnus.length === 0 ? (
                <div className="rounded-2xl border-2 border-border bg-card px-4 py-8 text-center text-sm font-semibold text-muted-foreground shadow-[4px_4px_0_0_hsl(var(--border))]">
                  {onusQuery.isLoading ? "Loading ONU data..." : "No ONU matched current filter."}
                </div>
              ) : null}
            </div>

            <div className="hidden overflow-x-auto rounded-2xl border-2 border-border shadow-[6px_6px_0_0_hsl(var(--border))] md:block">
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

      {selectedDeviceId && selectedDevice ? (
        <div className="flex justify-end">
          <Button
            disabled={deleteDeviceMutation.isPending}
            onClick={() => {
              if (!window.confirm(`Delete device ${selectedDevice.name || selectedDevice.host}? This cannot be undone.`)) {
                return;
              }
              deleteDeviceMutation.mutate(selectedDeviceId);
            }}
            type="button"
            variant="outline"
          >
            Delete Device
          </Button>
        </div>
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

      <PluginOverlay
        description={deviceModalMode === "edit" ? "Update OLT device SNMP and WebUI credentials." : "Register a new Hioso OLT device for monitoring."}
        onClose={closeDeviceModal}
        open={deviceModalMode !== "closed"}
        title={deviceModalMode === "edit" ? `Edit Device · ${editingDevice?.name ?? ""}` : "Add OLT Device"}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="device-name">Device Name</label>
            <Input id="device-name" value={deviceForm.name} onChange={(event) => setDeviceForm((current) => ({ ...current, name: event.target.value }))} />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">SNMP</p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="device-host">Host / IP</label>
            <Input id="device-host" value={deviceForm.host} onChange={(event) => setDeviceForm((current) => ({ ...current, host: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="device-port">Port</label>
            <Input id="device-port" value={deviceForm.port} onChange={(event) => setDeviceForm((current) => ({ ...current, port: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="device-snmp-version">Version</label>
            <select
              className="h-11 w-full rounded-lg border-2 border-input bg-card px-3 text-sm text-foreground shadow-brutal-sm focus-visible:-translate-x-[1px] focus-visible:-translate-y-[1px] focus-visible:shadow-brutal focus-visible:ring-2 focus-visible:ring-ring"
              id="device-snmp-version"
              value={deviceForm.snmp_version}
              onChange={(event) => setDeviceForm((current) => ({ ...current, snmp_version: event.target.value }))}
            >
              <option value="1">v1</option>
              <option value="2c">v2c</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="device-snmp-community">Community</label>
            <Input id="device-snmp-community" value={deviceForm.snmp_community} onChange={(event) => setDeviceForm((current) => ({ ...current, snmp_community: event.target.value }))} />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">WebUI</p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="device-web-host">Host / IP</label>
            <Input id="device-web-host" value={deviceForm.web_host} onChange={(event) => setDeviceForm((current) => ({ ...current, web_host: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="device-web-port">Port</label>
            <Input id="device-web-port" value={deviceForm.web_port} onChange={(event) => setDeviceForm((current) => ({ ...current, web_port: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="device-username">Username</label>
            <Input id="device-username" value={deviceForm.username} onChange={(event) => setDeviceForm((current) => ({ ...current, username: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="device-password">{deviceModalMode === "edit" ? "Password (leave empty to keep)" : "Password"}</label>
            <Input id="device-password" type="password" value={deviceForm.password} onChange={(event) => setDeviceForm((current) => ({ ...current, password: event.target.value }))} />
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button onClick={closeDeviceModal} type="button" variant="outline">Cancel</Button>
          <Button disabled={isDeviceSubmitting} onClick={handleDeviceSubmit} type="button">
            {isDeviceSubmitting ? "Saving..." : deviceModalMode === "edit" ? "Save Changes" : "Create Device"}
          </Button>
        </div>
      </PluginOverlay>
    </div>
  );
}
