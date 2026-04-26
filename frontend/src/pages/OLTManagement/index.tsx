import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react";
import OLTFormModal from "@/components/olt/OLTFormModal";
import OLTSelector from "@/components/olt/OLTSelector";
import OLTTable from "@/components/olt/OLTTable";
import { PageSectionHeader } from "@/components/page/section-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useOltSelector } from "@/hooks/useOltSelector";
import {
  checkOLTHealth,
  createDBAProfile,
  createONUVLANConfig,
  deleteOLTDevice,
  getApiErrorMessage,
  getOLTDevices,
  getOLTMonitoring,
  getONUMonitoring,
  getONUBoardPonMonitoring,
  getPONMonitoring,
  registerONU,
  rebootONUManagement,
} from "@/lib/api";
import { showToast } from "@/lib/toast";

type JsonRecord = Record<string, unknown>;

type OnuBoardRow = {
  onuId: string;
  name: string;
  serialNumber: string;
  model: string;
  statusLabel: string;
  rxPower: string;
  txPower: string;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function unwrapData(value: unknown): unknown {
  let current = value;

  for (let i = 0; i < 3; i += 1) {
    if (!isRecord(current) || !("data" in current)) {
      break;
    }

    current = current.data;
  }

  return current;
}

function toDisplayString(value: unknown, fallback = "-") {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? fallback : trimmed;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return fallback;
}

function extractRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!isRecord(payload)) {
    return [];
  }

  const buckets = [payload.onus, payload.items, payload.list, payload.results];
  for (const bucket of buckets) {
    if (Array.isArray(bucket)) {
      return bucket;
    }
  }

  return [];
}

function normalizeOnuStatus(value: unknown) {
  if (typeof value === "number") {
    return value === 1 ? "online" : "offline";
  }

  if (typeof value === "boolean") {
    return value ? "online" : "offline";
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "online", "up", "connected"].includes(normalized)) {
      return "online";
    }
    if (["0", "offline", "down", "disconnected"].includes(normalized)) {
      return "offline";
    }
    if (normalized !== "") {
      return normalized;
    }
  }

  return "unknown";
}

function normalizeBoardRows(payload: unknown): OnuBoardRow[] {
  const items = extractRows(payload);

  return items.map((item, index) => {
    const row = isRecord(item) ? item : {};
    const optical = isRecord(row.optical) ? row.optical : {};

    const onuIdRaw = row.onu_id ?? row.id ?? index + 1;
    const statusLabel = normalizeOnuStatus(row.online_status ?? row.status);

    return {
      onuId: toDisplayString(onuIdRaw, String(index + 1)),
      name: toDisplayString(row.name),
      serialNumber: toDisplayString(row.serial_number ?? row.sn),
      model: toDisplayString(row.model ?? row.onu_type),
      statusLabel,
      rxPower: toDisplayString(optical.rx_power ?? row.rx_power),
      txPower: toDisplayString(optical.tx_power ?? row.tx_power),
    };
  });
}

function prettyJson(value: unknown) {
  if (value === null || value === undefined) {
    return "-";
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function OLTManagementPage() {
  const queryClient = useQueryClient();
  const { selectedOltId } = useOltSelector();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [activeHealthCheckId, setActiveHealthCheckId] = useState<string | null>(null);
  const [activeDeleteId, setActiveDeleteId] = useState<string | null>(null);

  const [boardId, setBoardId] = useState("1");
  const [ponId, setPonId] = useState("1");
  const [onuIdInput, setOnuIdInput] = useState("5");
  const [monitoredOnuId, setMonitoredOnuId] = useState("5");

  const [registerPonPort, setRegisterPonPort] = useState("1/1/1");
  const [registerOnuId, setRegisterOnuId] = useState("5");
  const [registerSerial, setRegisterSerial] = useState("ZTEG1234ABCD");
  const [registerOnuType, setRegisterOnuType] = useState("ZTE-F660");
  const [registerName, setRegisterName] = useState("Customer_001");

  const [vlanPonPort, setVlanPonPort] = useState("1/1/1");
  const [vlanOnuId, setVlanOnuId] = useState("5");
  const [svlan, setSvlan] = useState("100");
  const [cvlan, setCvlan] = useState("200");
  const [vlanMode, setVlanMode] = useState("tag");
  const [priority, setPriority] = useState("0");

  const [dbaName, setDbaName] = useState("100M_Profile");
  const [dbaType, setDbaType] = useState("3");
  const [dbaAssured, setDbaAssured] = useState("51200");
  const [dbaMax, setDbaMax] = useState("102400");

  const [rebootPonPort, setRebootPonPort] = useState("1/1/1");
  const [rebootOnuId, setRebootOnuId] = useState("5");

  const boardOptions = useMemo(() => Array.from({ length: 16 }, (_, index) => String(index + 1)), []);

  useEffect(() => {
    const defaultPonPort = `1/1/${ponId}`;
    setRegisterPonPort(defaultPonPort);
    setVlanPonPort(defaultPonPort);
    setRebootPonPort(defaultPonPort);
  }, [ponId]);

  const listQuery = useQuery({
    queryKey: ["olt-devices"],
    queryFn: getOLTDevices,
    refetchInterval: 15_000,
  });

  const oltMonitoringQuery = useQuery({
    queryKey: ["olt-monitoring", selectedOltId],
    queryFn: async () => {
      if (!selectedOltId) {
        return null;
      }

      const response = await getOLTMonitoring(selectedOltId);
      return unwrapData(response);
    },
    enabled: Boolean(selectedOltId),
    refetchInterval: 15_000,
  });

  const ponMonitoringQuery = useQuery({
    queryKey: ["pon-monitoring", selectedOltId, ponId],
    queryFn: async () => {
      if (!selectedOltId) {
        return null;
      }

      const response = await getPONMonitoring(selectedOltId, ponId);
      return unwrapData(response);
    },
    enabled: Boolean(selectedOltId),
    refetchInterval: 15_000,
  });

  const boardOnuQuery = useQuery({
    queryKey: ["board-pon-onu", selectedOltId, boardId, ponId],
    queryFn: async () => {
      if (!selectedOltId) {
        return [] as OnuBoardRow[];
      }

      const response = await getONUBoardPonMonitoring(selectedOltId, boardId, ponId);
      return normalizeBoardRows(unwrapData(response));
    },
    enabled: Boolean(selectedOltId),
    refetchInterval: 15_000,
  });

  const onuMonitoringQuery = useQuery({
    queryKey: ["onu-monitoring", selectedOltId, ponId, monitoredOnuId],
    queryFn: async () => {
      if (!selectedOltId || !monitoredOnuId.trim()) {
        return null;
      }

      const response = await getONUMonitoring(selectedOltId, ponId, monitoredOnuId.trim());
      return unwrapData(response);
    },
    enabled: Boolean(selectedOltId && monitoredOnuId.trim()),
    refetchInterval: 15_000,
  });

  const healthMutation = useMutation({
    mutationFn: checkOLTHealth,
    onSuccess: (result) => {
      showToast({
        title: `Health check: ${result.status}`,
        description: result.message || "Status OLT berhasil diperbarui",
        variant: result.status === "online" ? "success" : "default",
      });
      void queryClient.invalidateQueries({ queryKey: ["olt-devices"] });
    },
    onError: (error) => {
      showToast({
        title: "Health check gagal",
        description: getApiErrorMessage(error),
        variant: "error",
      });
    },
    onSettled: () => {
      setActiveHealthCheckId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteOLTDevice,
    onSuccess: () => {
      showToast({ title: "OLT berhasil dihapus", variant: "success" });
      void queryClient.invalidateQueries({ queryKey: ["olt-devices"] });
    },
    onError: (error) => {
      showToast({
        title: "Gagal menghapus OLT",
        description: getApiErrorMessage(error),
        variant: "error",
      });
    },
    onSettled: () => {
      setActiveDeleteId(null);
    },
  });

  const registerMutation = useMutation({
    mutationFn: async () => {
      if (!selectedOltId) {
        throw new Error("Pilih OLT aktif terlebih dahulu");
      }

      return registerONU(selectedOltId, {
        pon_port: registerPonPort.trim(),
        onu_id: Number.parseInt(registerOnuId, 10),
        serial_number: registerSerial.trim(),
        onu_type: registerOnuType.trim(),
        name: registerName.trim(),
      });
    },
    onSuccess: () => {
      showToast({ title: "ONU berhasil diregister", variant: "success" });
      void boardOnuQuery.refetch();
    },
    onError: (error) => {
      showToast({ title: "Gagal register ONU", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const vlanMutation = useMutation({
    mutationFn: async () => {
      if (!selectedOltId) {
        throw new Error("Pilih OLT aktif terlebih dahulu");
      }

      return createONUVLANConfig(selectedOltId, {
        pon_port: vlanPonPort.trim(),
        onu_id: Number.parseInt(vlanOnuId, 10),
        svlan: Number.parseInt(svlan, 10),
        cvlan: Number.parseInt(cvlan, 10),
        vlan_mode: vlanMode.trim(),
        priority: Number.parseInt(priority, 10),
      });
    },
    onSuccess: () => {
      showToast({ title: "VLAN berhasil dikonfigurasi", variant: "success" });
    },
    onError: (error) => {
      showToast({ title: "Gagal konfigurasi VLAN", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const dbaMutation = useMutation({
    mutationFn: async () => {
      if (!selectedOltId) {
        throw new Error("Pilih OLT aktif terlebih dahulu");
      }

      return createDBAProfile(selectedOltId, {
        name: dbaName.trim(),
        type: Number.parseInt(dbaType, 10),
        assured_bandwidth: Number.parseInt(dbaAssured, 10),
        max_bandwidth: Number.parseInt(dbaMax, 10),
      });
    },
    onSuccess: () => {
      showToast({ title: "DBA Profile berhasil dibuat", variant: "success" });
    },
    onError: (error) => {
      showToast({ title: "Gagal membuat DBA profile", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const rebootMutation = useMutation({
    mutationFn: async () => {
      if (!selectedOltId) {
        throw new Error("Pilih OLT aktif terlebih dahulu");
      }

      return rebootONUManagement(selectedOltId, {
        pon_port: rebootPonPort.trim(),
        onu_id: Number.parseInt(rebootOnuId, 10),
      });
    },
    onSuccess: () => {
      showToast({ title: "Perintah reboot ONU dikirim", variant: "success" });
    },
    onError: (error) => {
      showToast({ title: "Gagal reboot ONU", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const selectedOltName = useMemo(() => {
    const devices = listQuery.data ?? [];
    return devices.find((device) => device.id === selectedOltId)?.name ?? "-";
  }, [listQuery.data, selectedOltId]);

  return (
    <div className="mx-auto max-w-[22rem] space-y-4 px-1 sm:max-w-none sm:space-y-6 sm:px-0">
      <section className="rounded-[26px] border-2 border-border bg-card/95 px-3.5 py-4 shadow-brutal sm:px-5 sm:py-5">
        <PageSectionHeader
          title={<h1 className="font-display text-lg font-black uppercase tracking-[0.04em] text-foreground sm:text-3xl">OLT Management</h1>}
          description={<p className="text-sm font-semibold text-muted-foreground">Kelola endpoint OLT ZTE dan pantau status koneksi service plugin.</p>}
          actions={
            <div className="grid w-full gap-3 sm:grid-cols-[minmax(220px,360px)_auto] sm:items-end">
              <OLTSelector label="OLT aktif untuk monitoring" />
              <Button onClick={() => setIsAddOpen(true)} type="button">
                <Plus className="mr-2 h-4 w-4" />
                Add OLT
              </Button>
            </div>
          }
        />
      </section>

      {listQuery.isError ? (
        <Card className="border-2 shadow-brutal-sm">
          <CardContent className="p-4 text-sm text-destructive">{getApiErrorMessage(listQuery.error)}</CardContent>
        </Card>
      ) : null}

      {listQuery.isLoading ? (
        <Card className="border-2 shadow-brutal-sm">
          <CardContent className="p-4 text-sm text-muted-foreground">Loading data OLT...</CardContent>
        </Card>
      ) : (
        <OLTTable
          activeDeleteId={activeDeleteId}
          activeHealthCheckId={activeHealthCheckId}
          devices={listQuery.data ?? []}
          onDelete={(oltId) => {
            if (!window.confirm("Yakin ingin menghapus OLT ini?")) {
              return;
            }

            setActiveDeleteId(oltId);
            deleteMutation.mutate(oltId);
          }}
          onHealthCheck={(oltId) => {
            setActiveHealthCheckId(oltId);
            healthMutation.mutate(oltId);
          }}
        />
      )}

      <Card className="border-2 shadow-brutal">
        <CardHeader className="space-y-3 pb-0">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">Real-time ONU Monitoring</CardTitle>
            <Badge variant="secondary">Phase 7.2</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Pilih <span className="font-semibold text-foreground">Board</span> dan <span className="font-semibold text-foreground">PON Port</span>, lalu lihat detail ONU, statistik optical, dan jalankan aksi provisioning.
          </p>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="grid gap-3 lg:grid-cols-[180px_180px_220px_auto] lg:items-end">
            <label className="space-y-1.5 text-sm text-muted-foreground">
              <span className="font-medium">Board</span>
              <select
                className="h-11 w-full rounded-lg border-2 border-input bg-card px-3 text-sm text-foreground shadow-brutal-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onChange={(event) => setBoardId(event.target.value)}
                value={boardId}
              >
                {boardOptions.map((value) => (
                  <option key={`board-${value}`} value={value}>{value}</option>
                ))}
              </select>
            </label>

            <label className="space-y-1.5 text-sm text-muted-foreground">
              <span className="font-medium">PON Port</span>
              <select
                className="h-11 w-full rounded-lg border-2 border-input bg-card px-3 text-sm text-foreground shadow-brutal-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onChange={(event) => setPonId(event.target.value)}
                value={ponId}
              >
                {boardOptions.map((value) => (
                  <option key={`pon-${value}`} value={value}>{value}</option>
                ))}
              </select>
            </label>

            <label className="space-y-1.5 text-sm text-muted-foreground">
              <span className="font-medium">ONU ID (detail)</span>
              <Input onChange={(event) => setOnuIdInput(event.target.value)} value={onuIdInput} />
            </label>

            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!selectedOltId || boardOnuQuery.isFetching || ponMonitoringQuery.isFetching || oltMonitoringQuery.isFetching}
                onClick={() => {
                  void boardOnuQuery.refetch();
                  void ponMonitoringQuery.refetch();
                  void oltMonitoringQuery.refetch();
                  void onuMonitoringQuery.refetch();
                }}
                type="button"
                variant="outline"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
              <Button
                disabled={!selectedOltId || !onuIdInput.trim()}
                onClick={() => setMonitoredOnuId(onuIdInput.trim())}
                type="button"
              >
                Load ONU Detail
              </Button>
            </div>
          </div>

          {!selectedOltId ? (
            <Card className="border-2 border-dashed shadow-brutal-sm">
              <CardContent className="p-4 text-sm text-muted-foreground">Pilih OLT online dulu dari dropdown di atas untuk mulai monitoring.</CardContent>
            </Card>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="border-2 shadow-brutal-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">OLT-wide Summary ({selectedOltName})</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="max-h-64 overflow-auto rounded-lg border-2 border-border bg-muted/20 p-3 text-xs text-foreground">{prettyJson(oltMonitoringQuery.data)}</pre>
                  </CardContent>
                </Card>

                <Card className="border-2 shadow-brutal-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">PON Aggregated Monitoring (PON {ponId})</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="max-h-64 overflow-auto rounded-lg border-2 border-border bg-muted/20 p-3 text-xs text-foreground">{prettyJson(ponMonitoringQuery.data)}</pre>
                  </CardContent>
                </Card>
              </div>

              <Card className="border-2 shadow-brutal-sm">
                <CardHeader className="pb-0">
                  <CardTitle className="text-sm">ONU List (Board {boardId} / PON {ponId})</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="bg-muted/30 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2">ONU ID</th>
                          <th className="px-3 py-2">Name</th>
                          <th className="px-3 py-2">Serial</th>
                          <th className="px-3 py-2">Model</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">RX</th>
                          <th className="px-3 py-2">TX</th>
                          <th className="px-3 py-2">Aksi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(boardOnuQuery.data ?? []).map((row) => (
                          <tr className="border-t border-border/70" key={`${row.onuId}-${row.serialNumber}`}>
                            <td className="px-3 py-2 font-semibold">{row.onuId}</td>
                            <td className="px-3 py-2">{row.name}</td>
                            <td className="px-3 py-2">{row.serialNumber}</td>
                            <td className="px-3 py-2">{row.model}</td>
                            <td className="px-3 py-2">
                              <Badge variant={row.statusLabel === "online" ? "success" : row.statusLabel === "offline" ? "destructive" : "secondary"}>
                                {row.statusLabel}
                              </Badge>
                            </td>
                            <td className="px-3 py-2">{row.rxPower}</td>
                            <td className="px-3 py-2">{row.txPower}</td>
                            <td className="px-3 py-2">
                              <Button
                                onClick={() => {
                                  const nextOnuId = String(row.onuId ?? "").trim();
                                  if (!nextOnuId) {
                                    return;
                                  }

                                  setOnuIdInput(nextOnuId);
                                  setMonitoredOnuId(nextOnuId);
                                  void onuMonitoringQuery.refetch();
                                }}
                                size="sm"
                                type="button"
                                variant="outline"
                              >
                                View Detail
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {(boardOnuQuery.data ?? []).length === 0 ? (
                    <p className="pt-3 text-xs text-muted-foreground">Tidak ada data ONU untuk board/port ini atau endpoint belum mengembalikan list.</p>
                  ) : null}
                </CardContent>
              </Card>

              <Card className="border-2 shadow-brutal-sm">
                <CardHeader className="pb-0">
                  <CardTitle className="text-sm">ONU Detail & Optical Power (PON {ponId}, ONU {monitoredOnuId || "-"})</CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="max-h-80 overflow-auto rounded-lg border-2 border-border bg-muted/20 p-3 text-xs text-foreground">{prettyJson(onuMonitoringQuery.data)}</pre>
                </CardContent>
              </Card>

              <div className="grid gap-4 xl:grid-cols-2">
                <Card className="border-2 shadow-brutal-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Register New ONU</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form
                      className="grid gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        registerMutation.mutate();
                      }}
                    >
                      <Input onChange={(event) => setRegisterPonPort(event.target.value)} placeholder="pon_port (contoh: 1/1/1)" value={registerPonPort} />
                      <Input onChange={(event) => setRegisterOnuId(event.target.value)} placeholder="onu_id" value={registerOnuId} />
                      <Input onChange={(event) => setRegisterSerial(event.target.value)} placeholder="serial_number" value={registerSerial} />
                      <Input onChange={(event) => setRegisterOnuType(event.target.value)} placeholder="onu_type" value={registerOnuType} />
                      <Input onChange={(event) => setRegisterName(event.target.value)} placeholder="name" value={registerName} />
                      <Button disabled={registerMutation.isPending} type="submit">{registerMutation.isPending ? "Submitting..." : "Register ONU"}</Button>
                    </form>
                  </CardContent>
                </Card>

                <Card className="border-2 shadow-brutal-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Configure VLAN</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form
                      className="grid gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        vlanMutation.mutate();
                      }}
                    >
                      <Input onChange={(event) => setVlanPonPort(event.target.value)} placeholder="pon_port" value={vlanPonPort} />
                      <Input onChange={(event) => setVlanOnuId(event.target.value)} placeholder="onu_id" value={vlanOnuId} />
                      <Input onChange={(event) => setSvlan(event.target.value)} placeholder="svlan" value={svlan} />
                      <Input onChange={(event) => setCvlan(event.target.value)} placeholder="cvlan" value={cvlan} />
                      <Input onChange={(event) => setVlanMode(event.target.value)} placeholder="vlan_mode" value={vlanMode} />
                      <Input onChange={(event) => setPriority(event.target.value)} placeholder="priority" value={priority} />
                      <Button disabled={vlanMutation.isPending} type="submit">{vlanMutation.isPending ? "Submitting..." : "Configure VLAN"}</Button>
                    </form>
                  </CardContent>
                </Card>

                <Card className="border-2 shadow-brutal-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Create DBA Profile</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form
                      className="grid gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        dbaMutation.mutate();
                      }}
                    >
                      <Input onChange={(event) => setDbaName(event.target.value)} placeholder="name" value={dbaName} />
                      <Input onChange={(event) => setDbaType(event.target.value)} placeholder="type" value={dbaType} />
                      <Input onChange={(event) => setDbaAssured(event.target.value)} placeholder="assured_bandwidth" value={dbaAssured} />
                      <Input onChange={(event) => setDbaMax(event.target.value)} placeholder="max_bandwidth" value={dbaMax} />
                      <Button disabled={dbaMutation.isPending} type="submit">{dbaMutation.isPending ? "Submitting..." : "Create DBA"}</Button>
                    </form>
                  </CardContent>
                </Card>

                <Card className="border-2 shadow-brutal-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Reboot ONU</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form
                      className="grid gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        rebootMutation.mutate();
                      }}
                    >
                      <Input onChange={(event) => setRebootPonPort(event.target.value)} placeholder="pon_port" value={rebootPonPort} />
                      <Input onChange={(event) => setRebootOnuId(event.target.value)} placeholder="onu_id" value={rebootOnuId} />
                      <Button disabled={rebootMutation.isPending} type="submit">{rebootMutation.isPending ? "Submitting..." : "Reboot ONU"}</Button>
                    </form>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <OLTFormModal
        onClose={() => setIsAddOpen(false)}
        onCreated={() => {
          void queryClient.invalidateQueries({ queryKey: ["olt-devices"] });
        }}
        open={isAddOpen}
      />
    </div>
  );
}
