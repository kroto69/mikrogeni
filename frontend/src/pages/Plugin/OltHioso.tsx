import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { createPortal } from "react-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/retroui/Select";
import { Loader } from "@/components/retroui/Loader";
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
  type HiosoOLTDevice,
  type HiosoOnuRow,
  type HiosoOnuDetail,
} from "@/lib/api";
import { addZTEConnection, deleteZTEConnection, getZTEConnections, healthCheckZTE, testZTEConnection, updateZTEConnection } from "@/lib/zteApi";
import type { ZTEConnection } from "@/types/zte";
import { showToast } from "@/lib/toast";
import { useRole } from "@/hooks/useRole";
import { MoreHorizontal } from "lucide-react";
import { useGlobalLoaderOverlay } from "@/hooks/useGlobalLoaderOverlay";

// Parse ONU index "1/3:1" atau "0/3:1" → { port: 3, id: 1 }
function parseOnuIndex(index: string): { port: number; id: number } {
  const match = index.match(/\d+\/(\d+):(\d+)/);
  if (match) {
    return { port: Number(match[1]), id: Number(match[2]) };
  }
  return { port: 1, id: 1 };
}

type DeviceFormState = {
  name: string;
  host: string;
  port: string;
  firmware_type: string;
  username: string;
  password: string;
};

type OltType = "hioso" | "zte";

type ZteFormState = {
  name: string;
  baseUrl: string;
};

const EMPTY_DEVICE_FORM: DeviceFormState = {
  name: "",
  host: "",
  port: "80",
  firmware_type: "0",
  username: "admin",
  password: "",
};

const EMPTY_ZTE_FORM: ZteFormState = {
  name: "",
  baseUrl: "",
};

function buildDeviceForm(device?: HiosoOLTDevice): DeviceFormState {
  if (!device) {
    return { ...EMPTY_DEVICE_FORM };
  }
  return {
    name: device.name ?? "",
    host: device.host ?? "",
    port: String(device.port ?? 80),
    firmware_type: device.firmware_type === "legacy_html" ? "1" : "0",
    username: device.username ?? "",
    password: "",
  };
}

function PluginOverlay({ open, title, description, onClose, children }: { open: boolean; title: string; description?: string; onClose: () => void; children: React.ReactNode }) {
  if (!open) {
    return null;
  }

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[220] flex items-center justify-center overflow-y-auto bg-foreground/35 p-3 sm:p-6">
      <button aria-label="Close overlay" className="absolute inset-0" onClick={onClose} type="button" />
      <div className="relative z-10 my-auto box-border max-h-[calc(100dvh-1.5rem)] w-full max-w-[calc(100vw-1.5rem)] overflow-x-hidden overflow-y-auto rounded-[28px] border-2 border-border bg-card shadow-brutal-lg sm:max-h-[90vh] sm:max-w-2xl">
        <div className="flex items-center justify-between gap-3 border-b-2 border-border px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
            {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
          </div>
          <Button onClick={onClose} type="button" variant="outline">Close</Button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>,
    document.body,
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
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { can } = useRole();
  const { runWithGlobalLoader, isGlobalLoading } = useGlobalLoaderOverlay();
  const canManageOlt = can("zte_connections_crud");
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [createOltType, setCreateOltType] = useState<OltType>("hioso");
  const [onuFilter, setOnuFilter] = useState<"all" | "online" | "offline">("all");
  const [onuSearch, setOnuSearch] = useState("");
  const [portFilter, setPortFilter] = useState<number>(1);
  const [detailOnuIndex, setDetailOnuIndex] = useState<string | null>(null);
  const [onuDraftName, setOnuDraftName] = useState("");
  const [deviceModalMode, setDeviceModalMode] = useState<"closed" | "create" | "edit">("closed");
  const [deviceForm, setDeviceForm] = useState<DeviceFormState>(EMPTY_DEVICE_FORM);
  const [editingDevice, setEditingDevice] = useState<HiosoOLTDevice | null>(null);
  const [editingZte, setEditingZte] = useState<ZTEConnection | null>(null);
  const [zteForm, setZteForm] = useState<ZteFormState>(EMPTY_ZTE_FORM);
  const [zteTesting, setZteTesting] = useState(false);
  const [zteTestResult, setZteTestResult] = useState<{ ok: boolean; latency: number } | null>(null);

  const resetOltModalState = () => {
    setEditingDevice(null);
    setEditingZte(null);
    setDeviceForm({ ...EMPTY_DEVICE_FORM });
    setZteForm(EMPTY_ZTE_FORM);
    setZteTestResult(null);
    setZteTesting(false);
    setCreateOltType("hioso");
    setDeviceModalMode("closed");
  };

  const devicesQuery = useQuery({
    queryKey: ["hioso-devices"],
    queryFn: getHiosoDevices,
  });

  const selectedDevice = (devicesQuery.data ?? []).find((d) => d.id === selectedDeviceId) ?? null;
  const deviceId = selectedDeviceId ?? undefined;

  const healthQuery = useQuery({
    queryKey: ["hioso-health", deviceId],
    queryFn: () => getHiosoPluginHealth(deviceId!),
    enabled: Boolean(deviceId),
  });

  const ports = [1, 2, 3, 4];

  const onusQuery = useQuery({
    queryKey: ["hioso-onus", deviceId, portFilter],
    queryFn: () => getHiosoOnus(deviceId!, portFilter),
    enabled: Boolean(deviceId),
    placeholderData: [],
  });

  const onuDetailQuery = useQuery({
    queryKey: ["hioso-onu-detail", deviceId, detailOnuIndex],
    queryFn: () => {
      const { port, id } = parseOnuIndex(detailOnuIndex!);
      return getHiosoOnuDetail(deviceId!, port, id);
    },
    enabled: Boolean(deviceId) && Boolean(detailOnuIndex),
  });

  const renameOnuMutation = useMutation({
    mutationFn: ({ index, name }: { index: string; name: string }) => {
      const { port, id } = parseOnuIndex(index);
      return renameHiosoOnu(deviceId!, port, id, name);
    },
    onSuccess: async () => {
      showToast({ title: "ONU name updated", description: "The ONU name was saved successfully.", variant: "success" });
      await queryClient.invalidateQueries({ queryKey: ["hioso-onus", deviceId] });
      await queryClient.invalidateQueries({ queryKey: ["hioso-onu-detail", deviceId] });
    },
    onError: (error) => {
      showToast({ title: "Failed to update ONU name", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const rebootOnuMutation = useMutation({
    mutationFn: (index: string) => {
      const { port, id } = parseOnuIndex(index);
      return rebootHiosoOnu(deviceId!, port, id);
    },
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
        port: Number(values.port || "80"),
        firmware_type: Number(values.firmware_type || "0"),
        username: values.username.trim(),
        password: values.password,
      };
      if (!payload.name || !payload.host || !payload.username) {
        throw new Error("Name, host, and username are required.");
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
    mutationFn: async ({ deviceId: id, values }: { deviceId: string; values: DeviceFormState }) => {
      await deleteHiosoDevice(id);
      return createHiosoDevice({
        name: values.name.trim(),
        host: values.host.trim(),
        port: Number(values.port || "80"),
        firmware_type: Number(values.firmware_type || "0"),
        username: values.username.trim(),
        password: values.password,
      });
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
      closeDeviceModal();
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

  const createZteMutation = useMutation({
    mutationFn: (values: ZteFormState) => addZTEConnection({ name: values.name.trim() || undefined, base_url: values.baseUrl.trim() }),
    onSuccess: async (result) => {
      const count = result.length;
      showToast({ title: count > 1 ? `${count} ZTE OLT ditambahkan` : "ZTE OLT ditambahkan", variant: "success" });
      resetOltModalState();
      await queryClient.invalidateQueries({ queryKey: ["zte-connections"] });
    },
    onError: (error) => {
      showToast({ title: "Gagal menambahkan ZTE OLT", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const updateZteMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: ZteFormState }) => {
      return updateZTEConnection(id, { name: values.name.trim(), base_url: values.baseUrl.trim() });
    },
    onSuccess: async () => {
      showToast({ title: "ZTE OLT diupdate", variant: "success" });
      resetOltModalState();
      await queryClient.invalidateQueries({ queryKey: ["zte-connections"] });
    },
    onError: (error) => {
      showToast({ title: "Gagal mengupdate ZTE OLT", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const deleteZteMutation = useMutation({
    mutationFn: (id: string) => deleteZTEConnection(id),
    onSuccess: async () => {
      showToast({ title: "ZTE OLT dihapus", variant: "success" });
      closeDeviceModal();
      await queryClient.invalidateQueries({ queryKey: ["zte-connections"] });
    },
    onError: (error) => {
      showToast({ title: "Gagal menghapus ZTE OLT", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const isDeviceSubmitting = createDeviceMutation.isPending || updateDeviceMutation.isPending;

  const openCreateDeviceModal = () => {
    resetOltModalState();
    setDeviceModalMode("create");
  };

  const openEditDeviceModal = (device: HiosoOLTDevice) => {
    setEditingDevice(device);
    setEditingZte(null);
    setDeviceForm(buildDeviceForm(device));
    setCreateOltType("hioso");
    setDeviceModalMode("edit");
  };

  const openEditZteModal = (conn: ZTEConnection) => {
    setEditingDevice(null);
    setEditingZte(conn);
    setCreateOltType("zte");
    setZteForm({
      name: conn.name ?? "",
      baseUrl: conn.base_url ?? "",
    });
    setZteTestResult(null);
    setZteTesting(false);
    setDeviceModalMode("edit");
  };

  const closeDeviceModal = () => {
    resetOltModalState();
  };

  const openOnuDetailOverlay = (onu: HiosoOnuRow) => {
    setDetailOnuIndex(onu.index);
    setOnuDraftName(onu.name || "");
  };

  const closeOnuDetailOverlay = () => {
    setDetailOnuIndex(null);
    setOnuDraftName("");
  };

  const handleZteTest = async () => {
    await runWithGlobalLoader(async () => {
      setZteTesting(true);
      setZteTestResult(null);
      try {
        const res = (deviceModalMode === "edit" && editingZte && zteForm.baseUrl.trim() === editingZte.base_url)
          ? await healthCheckZTE(editingZte.id)
          : await testZTEConnection(zteForm.baseUrl.trim());
        setZteTestResult({ ok: res.status === "ok", latency: res.latency_ms });
      } catch {
        setZteTestResult(null);
        showToast({ title: "Gagal terhubung", variant: "error" });
      } finally {
        setZteTesting(false);
      }
    }, "Refreshing OLT Data...");
  };

  const handleRefreshAll = async () => {
    if (!selectedDeviceId) {
      return;
    }

    try {
      await runWithGlobalLoader(async () => {
        const [devicesResult, healthResult, onusResult] = await Promise.all([
          devicesQuery.refetch(),
          healthQuery.refetch(),
          onusQuery.refetch(),
        ]);

        const firstError = devicesResult.error ?? healthResult.error ?? onusResult.error;
        if (firstError) {
          throw firstError;
        }
      }, "Refreshing OLT Data...");
    } catch (refreshError) {
      showToast({
        title: "Refresh OLT gagal",
        description: getApiErrorMessage(refreshError),
        variant: "error",
      });
    }
  };

  const handleDeviceTest = async () => {
    if (!selectedDeviceId) {
      return;
    }

    await runWithGlobalLoader(async () => {
      await testDeviceMutation.mutateAsync(selectedDeviceId);
    }, "Refreshing OLT Data...");
  };

  const handleDeviceSubmit = () => {
    if (deviceModalMode === "edit") {
      if (createOltType === "zte" && editingZte) {
        updateZteMutation.mutate({ id: editingZte.id, values: zteForm });
        return;
      }

      if (editingDevice) {
        updateDeviceMutation.mutate({ deviceId: editingDevice.id, values: deviceForm });
      }
      return;
    }

    if (createOltType === "zte") {
      createZteMutation.mutate(zteForm);
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

        const haystack = [onu.index, onu.name, onu.sn, onu.profile].filter(Boolean).join(" ").toLowerCase();
        return haystack.includes(term);
      });
  }, [onuFilter, onuSearch, onusQuery.data]);

  const onlineCount = (onusQuery.data ?? []).filter((onu) => isOnuOnline(onu.status)).length;
  const totalCount = onusQuery.data?.length ?? 0;
  const downCount = Math.max(totalCount - onlineCount, 0);
  const healthOnline = Boolean(healthQuery.data?.model);
  const healthDetail = healthQuery.data?.model ? `${healthQuery.data.model} - ${healthQuery.data.firmware ?? ""} (${healthQuery.data.total_onu ?? 0} ONU)` : "Health status unavailable";

  const devices = devicesQuery.data ?? [];
  useEffect(() => {
    const fromQuery = searchParams.get("device");
    if (fromQuery && devices.some((device) => device.id === fromQuery)) {
      setSelectedDeviceId(fromQuery);
      return;
    }

    if (!selectedDeviceId && devices.length > 0 && !devicesQuery.isLoading) {
      setSelectedDeviceId(devices[0].id);
    }
  }, [devices, devicesQuery.isLoading, searchParams, selectedDeviceId]);

  useEffect(() => {
    if (!selectedDeviceId) {
      return;
    }

    if (!devices.some((device) => device.id === selectedDeviceId)) {
      return;
    }

    const next = new URLSearchParams(searchParams);
    if (next.get("device") === selectedDeviceId) {
      return;
    }
    next.set("device", selectedDeviceId);
    setSearchParams(next, { replace: true });
  }, [devices, searchParams, selectedDeviceId, setSearchParams]);

  return (
    <div className="route-shell-page route-shell-plugin-hioso space-y-5">
      <section className="route-shell-panel relative overflow-hidden rounded-[26px] border-2 border-border bg-primary/20 px-4 py-5 shadow-[12px_12px_0_0_hsl(var(--border))] sm:px-6 sm:py-6">
        <div className="pointer-events-none absolute -right-5 top-4 h-20 w-20 rotate-12 border-2 border-border bg-primary/90" />
        <div className="pointer-events-none absolute bottom-3 left-5 h-4 w-16 -rotate-6 border-2 border-border bg-accent" />
        <PageSectionHeader
          badge={<Badge>Manage</Badge>}
          description={selectedDevice ? `HIOSO OLT · ${selectedDevice.host}` : "Kelola OLT HIOSO dari halaman ini."}
          title={<h2 className="text-2xl font-black uppercase tracking-[0.05em] text-foreground sm:text-4xl">MANAGE OLT</h2>}
          actions={(
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              {selectedDeviceId ? (
                <>
                  <Button
                    className="w-full sm:w-auto"
                    disabled={isGlobalLoading}
                    onClick={() => {
                      void handleRefreshAll();
                    }}
                    type="button"
                    variant="outline"
                  >
                    Refresh
                  </Button>
                  {canManageOlt ? (
                    <Button
                      className="w-full sm:w-auto"
                      onClick={() => openEditDeviceModal(selectedDevice!)}
                      type="button"
                      variant="outline"
                    >
                      Edit Device
                    </Button>
                  ) : null}
                </>
              ) : null}
              {canManageOlt ? (
                <Button
                  className="w-full sm:w-auto"
                  onClick={openCreateDeviceModal}
                  type="button"
                  variant="secondary"
                >
                  Add OLT
                </Button>
              ) : null}
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
              onClick={() => { setSelectedDeviceId(device.id); setPortFilter(1); setDetailOnuIndex(null); }}
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
            <p>Belum ada OLT HIOSO terdaftar.</p>
            <p>Klik tombol <span className="font-semibold text-foreground">Add OLT</span> untuk mulai monitoring.</p>
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
            <div className="space-y-3">
              <Input
                className="h-10"
                placeholder="Search index, name, serial, port, profile"
                value={onuSearch}
                onChange={(event) => setOnuSearch(event.target.value)}
              />

              <div className="space-y-2">
                <p className="text-[11px] font-black uppercase tracking-[0.08em] text-muted-foreground">Status Filter</p>
                <div className="overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <div className="flex min-w-max items-center gap-2">
                    {(["all", "online", "offline"] as const).map((filter) => {
                      const count = filter === "all" ? totalCount : filter === "online" ? onlineCount : downCount;
                      return (
                      <button
                        className={`shrink-0 rounded-lg border-2 border-border px-3 py-1.5 text-sm font-black uppercase tracking-[0.04em] shadow-[4px_4px_0_0_hsl(var(--border))] ${onuFilter === filter ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}
                        key={filter}
                        onClick={() => setOnuFilter(filter)}
                        type="button"
                      >
                        <span className="inline-flex items-center gap-2">
                          <span>{filter === "all" ? "All" : filter}</span>
                          <span
                            className={`inline-flex min-w-6 items-center justify-center rounded-md border-2 px-1.5 py-0.5 text-[10px] font-black leading-none ${onuFilter === filter ? "border-primary-foreground/40 bg-primary-foreground/20 text-primary-foreground" : "border-border/50 bg-card/80 text-foreground"}`}
                          >
                            {count}
                          </span>
                        </span>
                      </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-[11px] font-black uppercase tracking-[0.08em] text-muted-foreground">Port Filter</p>
                <div className="overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <div className="flex min-w-max items-center gap-2">
                    {ports.map((p) => (
                      <button
                        className={`shrink-0 rounded-lg border-2 border-border px-3 py-1.5 text-sm font-black tracking-[0.04em] shadow-[4px_4px_0_0_hsl(var(--border))] ${portFilter === p ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}
                        key={p}
                        onClick={() => setPortFilter(p)}
                        type="button"
                      >
                        P{p}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border-2 border-border bg-card/90 px-4 py-3 shadow-[4px_4px_0_0_hsl(var(--border))]">
                <div className="flex flex-wrap items-center gap-2 text-xs font-black uppercase tracking-[0.06em]">
                  <span className={`rounded-md border-2 px-2 py-1 ${healthOnline ? "border-success/40 bg-success/20 text-success" : "border-destructive/40 bg-destructive/15 text-destructive"}`}>
                    {healthOnline ? "OLT Online" : "OLT Down"}
                  </span>
                  <span className="text-muted-foreground">Status Device</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-foreground break-words">{healthDetail}</p>
              </div>
            </div>

            {onusQuery.isError ? (
              <div className="rounded-2xl border-2 border-border bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive shadow-[4px_4px_0_0_hsl(var(--border))]">
                {getApiErrorMessage(onusQuery.error)}
              </div>
            ) : null}

            <div className="space-y-2 lg:hidden">
              {filteredOnus.map((onu: HiosoOnuRow) => (
                <div className="rounded-2xl border-2 border-border bg-card px-3 py-3 shadow-[4px_4px_0_0_hsl(var(--border))]" key={onu.index}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-black uppercase tracking-[0.04em] text-foreground">{onu.name || "ONU"}</p>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        IDX {onu.index}
                      </p>
                    </div>
                    <Badge variant={isOnuOnline(onu.status) ? "success" : "secondary"}>{onu.status || "Unknown"}</Badge>
                  </div>

                  <div className="mt-2 space-y-1 text-xs font-semibold text-muted-foreground">
                    <p className="break-all">SN: {onu.sn || "-"}</p>
                    <p>TX {onu.tx_power ?? "-"} / RX {onu.rx_power ?? "-"}</p>
                    <p className="break-all">Profile: {onu.profile || "-"}</p>
                  </div>

                  <div className="mt-3 flex justify-end">
                    <Button
                      aria-label="ONU actions"
                      className="h-8 w-8 p-0"
                      onClick={() => openOnuDetailOverlay(onu)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}

              {(onusQuery.isFetching || filteredOnus.length === 0) ? (
                <div className="rounded-2xl border-2 border-border bg-card px-4 py-8 text-center text-sm font-semibold text-muted-foreground shadow-[4px_4px_0_0_hsl(var(--border))] flex flex-col items-center gap-3">
                  {onusQuery.isFetching ? <><Loader size="sm" /><span>Loading ONU data...</span></> : "No ONU matched current filter."}
                </div>
              ) : null}
            </div>

            <div className="hidden overflow-x-auto rounded-2xl border-2 border-border shadow-[6px_6px_0_0_hsl(var(--border))] lg:block">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/30 text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Index</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Serial</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">RX Power</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOnus.map((onu: HiosoOnuRow) => (
                    <tr className="border-t-2 border-border/80" key={onu.index}>
                      <td className="px-4 py-3 font-semibold text-foreground">{onu.index}</td>
                      <td className="px-4 py-3 text-foreground">{onu.name || "-"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{onu.sn || "-"}</td>
                      <td className="px-4 py-3">
                        <Badge variant={isOnuOnline(onu.status) ? "success" : "secondary"}>{onu.status || "Unknown"}</Badge>
                      </td>
                      <td className="px-4 py-3 font-bold text-foreground">{onu.rx_power ?? "-"} dBm</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <Button
                            aria-label="ONU actions"
                            className="h-8 w-8 p-0"
                            onClick={() => openOnuDetailOverlay(onu)}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {(onusQuery.isFetching || filteredOnus.length === 0) ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-sm font-semibold text-muted-foreground" colSpan={6}>
                        {onusQuery.isFetching ? <div className="flex items-center justify-center gap-3"><Loader size="sm" /><span>Loading ONU data...</span></div> : "No ONU matched current filter."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <PluginOverlay open={Boolean(detailOnuIndex)} title="ONU Detail" onClose={closeOnuDetailOverlay}>
        <form
          className="space-y-4"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (!detailOnuIndex) {
              return;
            }
            renameOnuMutation.mutate({ index: detailOnuIndex, name: onuDraftName });
          }}
        >
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <div><span className="font-semibold text-foreground">Index:</span> {onuDetailQuery.data?.index || "-"}</div>
            <div><span className="font-semibold text-foreground">Web ID:</span> {onuDetailQuery.data?.web_id || "-"}</div>
            <div><span className="font-semibold text-foreground">Firmware:</span> {onuDetailQuery.data?.firmware || "-"}</div>
            <div><span className="font-semibold text-foreground">Chip:</span> {onuDetailQuery.data?.chip_id || "-"}</div>
            <div><span className="font-semibold text-foreground">Serial:</span> {onuDetailQuery.data?.sn || "-"}</div>
            <div><span className="font-semibold text-foreground">Status:</span> {onuDetailQuery.data?.status || "-"}</div>
            <div><span className="font-semibold text-foreground">TX Power:</span> {onuDetailQuery.data?.tx_power ?? "-"} dBm</div>
            <div><span className="font-semibold text-foreground">RX Power:</span> {onuDetailQuery.data?.rx_power ?? "-"} dBm</div>
            <div><span className="font-semibold text-foreground">Temperature:</span> {onuDetailQuery.data?.temperature ?? "-"} °C</div>
            <div><span className="font-semibold text-foreground">Registered:</span> {onuDetailQuery.data?.registered_at || "-"}</div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-[0.08em] text-foreground" htmlFor="onu-name-input">ONU Name</label>
            <Input id="onu-name-input" value={onuDraftName} onChange={(event) => setOnuDraftName(event.target.value)} />
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                disabled={onuDetailQuery.isFetching || rebootOnuMutation.isPending || renameOnuMutation.isPending}
                onClick={() => {
                  void runWithGlobalLoader(async () => {
                    const result = await onuDetailQuery.refetch();
                    if (result.error) {
                      throw result.error;
                    }
                  }, "Refreshing ONU Detail...").catch((refreshError) => {
                    showToast({
                      title: "Refresh ONU gagal",
                      description: getApiErrorMessage(refreshError),
                      variant: "error",
                    });
                  });
                }}
                type="button"
                variant="outline"
              >
                Refresh
              </Button>
              <Button
                disabled={!detailOnuIndex || rebootOnuMutation.isPending || renameOnuMutation.isPending}
                onClick={() => detailOnuIndex ? rebootOnuMutation.mutate(detailOnuIndex) : undefined}
                type="button"
                variant="secondary"
              >
                Reboot
              </Button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button onClick={closeOnuDetailOverlay} type="button" variant="outline">Cancel</Button>
              <Button disabled={renameOnuMutation.isPending || rebootOnuMutation.isPending} type="submit">Save</Button>
            </div>
          </div>
        </form>
      </PluginOverlay>

      <PluginOverlay
        description={
          deviceModalMode === "edit"
            ? createOltType === "zte"
              ? "Update endpoint dan nama ZTE OLT."
              : "Update OLT device SNMP dan WebUI credentials."
            : "Pilih tipe OLT lalu isi form sesuai vendor."
        }
        onClose={closeDeviceModal}
        open={deviceModalMode !== "closed" && canManageOlt}
        title={
          deviceModalMode === "edit"
            ? createOltType === "zte"
              ? `Edit ZTE OLT · ${editingZte?.name ?? ""}`
              : `Edit Device · ${editingDevice?.name ?? ""}`
            : "Add OLT"
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {deviceModalMode === "create" ? (
            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-medium text-muted-foreground" htmlFor="device-type">Tipe OLT</label>
              <Select value={createOltType} onValueChange={(value) => setCreateOltType(value as OltType)}>
                <Select.Trigger id="device-type" className="h-11 w-full rounded-lg border-2 border-input bg-card px-3 text-sm text-foreground shadow-brutal-sm focus-visible:-translate-x-[1px] focus-visible:-translate-y-[1px] focus-visible:shadow-brutal focus-visible:ring-2 focus-visible:ring-ring">
                  <Select.Value placeholder="Pilih tipe OLT" />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="hioso">HIOSO</Select.Item>
                  <Select.Item value="zte">ZTE</Select.Item>
                </Select.Content>
              </Select>
            </div>
          ) : null}

          {(deviceModalMode === "edit" || createOltType === "hioso") ? (
            <>
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
            <label className="text-sm font-medium text-muted-foreground" htmlFor="device-firmware-type">Firmware Type</label>
            <Select
              value={deviceForm.firmware_type}
              onValueChange={(value) => setDeviceForm((current) => ({ ...current, firmware_type: value }))}
            >
              <Select.Trigger
                id="device-firmware-type"
                className="h-11 w-full rounded-lg border-2 border-input bg-card px-3 text-sm text-foreground shadow-brutal-sm focus-visible:-translate-x-[1px] focus-visible:-translate-y-[1px] focus-visible:shadow-brutal focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Select.Value placeholder="Select type" />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="0">HA7304VX</Select.Item>
                <Select.Item value="1">Other (Legacy)</Select.Item>
              </Select.Content>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="device-username">Username</label>
            <Input id="device-username" value={deviceForm.username} onChange={(event) => setDeviceForm((current) => ({ ...current, username: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="device-password">{deviceModalMode === "edit" ? "Password (leave empty to keep)" : "Password"}</label>
            <Input id="device-password" type="password" value={deviceForm.password} onChange={(event) => setDeviceForm((current) => ({ ...current, password: event.target.value }))} />
          </div>
            </>
          ) : null}

          {deviceModalMode === "create" && createOltType === "zte" ? (
            <>
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium text-muted-foreground" htmlFor="zte-name">Display Name</label>
                <Input id="zte-name" placeholder="ZTE OLT Site A" value={zteForm.name} onChange={(event) => setZteForm((current) => ({ ...current, name: event.target.value }))} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium text-muted-foreground" htmlFor="zte-baseurl">ZTE Backend URL</label>
                <Input id="zte-baseurl" placeholder="http://olt-monitor:8081" value={zteForm.baseUrl} onChange={(event) => setZteForm((current) => ({ ...current, baseUrl: event.target.value }))} />
              </div>
              <div className="sm:col-span-2">
                <div className="flex items-center gap-3">
                  <Button type="button" variant="outline" onClick={handleZteTest} disabled={zteTesting || !zteForm.baseUrl.trim()}>
                    {zteTesting ? "Testing..." : "Test Connection"}
                  </Button>
                  {zteTestResult ? (
                    <Badge variant={zteTestResult.ok ? "success" : "destructive"}>
                      {zteTestResult.ok ? `Online · ${zteTestResult.latency}ms` : "Gagal terhubung"}
                    </Badge>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}
        </div>

        <div className="mt-6 flex flex-col gap-3">
          {deviceModalMode === "edit" ? (
            <div className="flex gap-2">
              <Button
                disabled={testDeviceMutation.isPending || isGlobalLoading}
                onClick={() => void handleDeviceTest()}
                type="button"
                variant="outline"
                className="flex-1"
              >
                {testDeviceMutation.isPending ? "Testing..." : "Test Connection"}
              </Button>
              <Button
                disabled={deleteDeviceMutation.isPending || deleteZteMutation.isPending || isGlobalLoading}
                onClick={() => {
                  if (createOltType === "zte" && editingZte) {
                    if (!window.confirm(`Delete ZTE OLT ${editingZte.name}?`)) return;
                    deleteZteMutation.mutate(editingZte.id);
                    return;
                  }
                  if (editingDevice) {
                    if (!window.confirm(`Delete device ${editingDevice.name || editingDevice.host}?`)) return;
                    deleteDeviceMutation.mutate(editingDevice.id);
                  }
                }}
                type="button"
                variant="outline"
                className="flex-1 text-red-600 hover:bg-red-50"
              >
                Delete
              </Button>
            </div>
          ) : null}

          <Button disabled={isDeviceSubmitting || createZteMutation.isPending || updateZteMutation.isPending || (createOltType === "zte" && !zteForm.baseUrl.trim())} onClick={handleDeviceSubmit} type="button" className="w-full">
            {(isDeviceSubmitting || createZteMutation.isPending || updateZteMutation.isPending)
              ? "Saving..."
              : deviceModalMode === "edit"
                ? "Save Changes"
                : createOltType === "zte"
                  ? "Create ZTE OLT"
                  : "Create HIOSO OLT"}
          </Button>
        </div>
      </PluginOverlay>
    </div>
  );
}
