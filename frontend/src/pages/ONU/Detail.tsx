import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Clock3,
  Eye,
  EyeOff,
  Globe2,
  Radio,
  MoreHorizontal,
  Power,
  RefreshCcw,
  Shield,
  SlidersHorizontal,
  Thermometer,
  Wifi,
} from "lucide-react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/retroui/Select";
import { useAsyncTask } from "@/hooks/useAsyncTask";
import { useGlobalLoaderOverlay } from "@/hooks/useGlobalLoaderOverlay";
import {
  getAcsDeviceDetail,
  getApiErrorMessage,
} from "@/lib/api";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type {
  AcsParameterInput,
  AcsParameterPayload,
  AcsWanConfigPayload,
  AcsWifiConfigPayload,
  ClientListRow,
  WifiProfile,
} from "@/types/onu";
import { isOnuDetailIncomplete } from "@/types/onu";

type OnuModal = "none" | "reboot" | "wifi" | "wan" | "security" | "parameter";

type WifiFormState = {
  profileIndex: string;
  ssid: string;
  password: string;
  band: "2.4GHz" | "5GHz";
  enabled: boolean;
};

type WanFormState = {
  username: string;
  password: string;
  mtu: string;
  vpi: string;
  vci: string;
};

type ParameterRow = {
  id: string;
  name: string;
  value: string;
  type: string;
};

const DEFAULT_WIFI_FORM: WifiFormState = {
  profileIndex: "",
  ssid: "",
  password: "",
  band: "2.4GHz",
  enabled: true,
};

const DEFAULT_WAN_FORM: WanFormState = {
  username: "",
  password: "",
  mtu: "",
  vpi: "",
  vci: "",
};

function createParameterRow(): ParameterRow {
  return {
    id: Math.random().toString(36).slice(2, 11),
    name: "",
    value: "",
    type: "xsd:string",
  };
}

function isMutedValue(value: string | null | undefined) {
  return value === null || value === undefined || value === "" || value === "-";
}

function formatDisplayValue(value: string | null | undefined) {
  return isMutedValue(value) ? "-" : value;
}

function formatPreciseTimestamp(value: string) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function getRxBadge(value: number | null) {
  if (value === null) {
    return { label: "Unknown", variant: "secondary" as const };
  }

  if (value >= -20) {
    return { label: "Good", variant: "success" as const };
  }

  if (value >= -27) {
    return { label: "Warning", variant: "warning" as const };
  }

  return { label: "Critical", variant: "destructive" as const };
}

function getTempBadge(value: number | null) {
  if (value === null) {
    return { label: "Unknown", variant: "secondary" as const };
  }

  if (value >= 70) {
    return { label: "Hot", variant: "destructive" as const };
  }

  if (value >= 50) {
    return { label: "Warm", variant: "warning" as const };
  }

  return { label: "Normal", variant: "success" as const };
}

function normalizeClientValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}

function getClientColumns(rows: ClientListRow[]) {
  const columns = new Set<string>();

  rows.forEach((row) => {
    if (typeof row === "string") {
      columns.add("value");
    } else {
      Object.keys(row).forEach((key) => {
        columns.add(key);
      });
    }
  });

  return columns.size > 0 ? Array.from(columns) : ["value"];
}

function inferWifiBand(profile: WifiProfile): WifiFormState["band"] {
  const normalized = `${profile.index} ${profile.ssid}`.toLowerCase();
  return normalized.includes("5g") || normalized.includes("5 ghz") || normalized.includes("5ghz")
    ? "5GHz"
    : "2.4GHz";
}

function buildWifiFormFromProfile(profile?: WifiProfile, activeSsids: string[] = []): WifiFormState {
  if (!profile) {
    return DEFAULT_WIFI_FORM;
  }

  return {
    profileIndex: profile.index,
    ssid: profile.ssid,
    password: profile.password,
    band: inferWifiBand(profile),
    enabled: activeSsids.includes(profile.ssid),
  };
}

function InfoItem({ label, value, action, muted = false }: { label: string; value: ReactNode; action?: ReactNode; muted?: boolean }) {
  return (
    <div className="space-y-1.5 rounded-xl border-2 border-border bg-card/95 p-3 shadow-brutal-sm sm:p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground sm:text-xs">{label}</p>
      <div className="flex items-center justify-between gap-3">
        <div className={cn("break-all text-[13px] font-medium text-foreground sm:text-sm", muted && "text-muted-foreground")}>{value}</div>
        {action}
      </div>
    </div>
  );
}

function SkeletonCard({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl border-2 border-border bg-card/70", className)} />;
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <SkeletonCard className="h-24 w-full" />
      <div className="grid gap-6 lg:grid-cols-2">
        <SkeletonCard className="h-72 w-full" />
        <SkeletonCard className="h-72 w-full" />
        <SkeletonCard className="h-80 w-full lg:col-span-2" />
        <SkeletonCard className="h-96 w-full lg:col-span-2" />
        <SkeletonCard className="h-48 w-full" />
        <SkeletonCard className="h-56 w-full" />
      </div>
    </div>
  );
}

function OverlayPanel({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) {
    return null;
  }

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-foreground/40 sm:items-center sm:p-6">
      <button aria-label="Close panel overlay" className="absolute inset-0" onClick={onClose} type="button" />
      <div className="relative z-10 h-[min(88dvh,42rem)] w-full overflow-y-auto rounded-t-[28px] border-2 border-border bg-card text-card-foreground shadow-brutal-lg sm:h-auto sm:max-h-[90dvh] sm:max-w-2xl sm:rounded-[28px]">
        <div className="sticky top-0 z-10 border-b-2 border-border bg-card px-5 py-4 sm:px-6">
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        <div className="px-5 py-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:px-6 sm:pb-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function ActionButton({ icon, label, onClick, disabled, tone = "default" }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean; tone?: "default" | "danger" }) {
  return (
    <Button
      className="w-full sm:w-auto"
      disabled={disabled}
      onClick={onClick}
      type="button"
      variant={tone === "danger" ? "destructive" : "outline"}
    >
      {icon}
      <span className="ml-2">{label}</span>
    </Button>
  );
}

export default function OnuDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { runWithGlobalLoader, isGlobalLoading } = useGlobalLoaderOverlay();
  const [activeModal, setActiveModal] = useState<OnuModal>("none");
  const [showMoreActions, setShowMoreActions] = useState(false);
  const [showPppoePassword, setShowPppoePassword] = useState(false);
  const [showWifiPassword, setShowWifiPassword] = useState(false);
  const [visibleWifiPasswords, setVisibleWifiPasswords] = useState<Record<string, boolean>>({});
  const [wifiForm, setWifiForm] = useState<WifiFormState>(DEFAULT_WIFI_FORM);
  const [wanForm, setWanForm] = useState<WanFormState>(DEFAULT_WAN_FORM);
  const [securityParameters, setSecurityParameters] = useState<ParameterRow[]>([createParameterRow()]);
  const [customParameters, setCustomParameters] = useState<ParameterRow[]>([createParameterRow()]);

  useEffect(() => {
    if (activeModal === "none") {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveModal("none");
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [activeModal]);

  const detailQuery = useQuery({
    queryKey: ["onu-detail", id],
    queryFn: () => getAcsDeviceDetail(id, { activeOnly: false }),
    enabled: Boolean(id),
  });

  const activeWifiQuery = useQuery({
    queryKey: ["onu-detail-active", id],
    queryFn: () => getAcsDeviceDetail(id),
    enabled: Boolean(id),
  });

  const invalidateDetail = async () => {
    await queryClient.invalidateQueries({ queryKey: ["onu-detail", id] });
    await queryClient.invalidateQueries({ queryKey: ["onu-detail-active", id] });
  };

  const summonDeviceMutation = useMutation({
    mutationFn: async () => {
      const [fullDetail, activeDetail] = await Promise.all([
        getAcsDeviceDetail(id, { activeOnly: false, refreshWait: true }),
        getAcsDeviceDetail(id, { refreshWait: true }),
      ]);

      return { fullDetail, activeDetail };
    },
    onSuccess: ({ fullDetail, activeDetail }) => {
      queryClient.setQueryData(["onu-detail", id], fullDetail);
      queryClient.setQueryData(["onu-detail-active", id], activeDetail);
      showToast({
        title: "Device summoned",
        description: "ONU data has been refreshed from ACS.",
        variant: "success",
      });
    },
    onError: (error) => {
      showToast({
        title: "Summon failed",
        description: getApiErrorMessage(error),
        variant: "error",
      });
    },
  });

  const rebootTask = useAsyncTask(`/acs/devices/${id}/reboot`, {
    pollInterval: 2_000,
    queuedTitle: "Reboot queued...",
    successTitle: "Reboot berhasil",
    errorTitle: "Reboot gagal",
    onSuccess: async () => {
      setActiveModal("none");
      await invalidateDetail();
    },
  });

  const wifiTask = useAsyncTask(`/acs/devices/${id}/config/wifi`, {
    pollInterval: 2_000,
    queuedTitle: "WiFi config queued...",
    successTitle: "Config WiFi berhasil",
    errorTitle: "Config WiFi gagal",
    onSuccess: async () => {
      setActiveModal("none");
      setWifiForm(DEFAULT_WIFI_FORM);
      setShowWifiPassword(false);
      await invalidateDetail();
    },
  });

  const wanTask = useAsyncTask(`/acs/devices/${id}/config/wan`, {
    pollInterval: 2_000,
    queuedTitle: "WAN config queued...",
    successTitle: "Config WAN berhasil",
    errorTitle: "Config WAN gagal",
    onSuccess: async () => {
      setActiveModal("none");
      setWanForm(DEFAULT_WAN_FORM);
      await invalidateDetail();
    },
  });

  const securityTask = useAsyncTask(`/acs/devices/${id}/config/security`, {
    pollInterval: 2_000,
    queuedTitle: "Security config queued...",
    successTitle: "Config Security berhasil",
    errorTitle: "Config Security gagal",
    onSuccess: async () => {
      setActiveModal("none");
      setSecurityParameters([createParameterRow()]);
      await invalidateDetail();
    },
  });

  const parameterTask = useAsyncTask(`/acs/devices/${id}/config/parameters`, {
    pollInterval: 2_000,
    queuedTitle: "Parameter update queued...",
    successTitle: "Set Parameter berhasil",
    errorTitle: "Set Parameter gagal",
    onSuccess: async () => {
      setActiveModal("none");
      setCustomParameters([createParameterRow()]);
      await invalidateDetail();
    },
  });

  const isActionPending = summonDeviceMutation.isPending || [rebootTask, wifiTask, wanTask, securityTask, parameterTask].some((task) => task.isPending);

  const detail = detailQuery.data;
  const activeSsidList = activeWifiQuery.data?.ssid_list ?? [];
  const wifiProfileCount = detail?.wifi_profiles.length ?? 0;
  const clientCount = detail?.client_list.length ?? 0;

  const clientColumns = useMemo(() => getClientColumns(detail?.client_list ?? []), [detail?.client_list]);

  const activeTask = [rebootTask, wifiTask, wanTask, securityTask, parameterTask].find((task) => task.isPending || task.isError || task.isSuccess);

  const openWifiModal = () => {
    const firstProfile = detail?.wifi_profiles[0];
    setWifiForm(buildWifiFormFromProfile(firstProfile, activeSsidList));
    setShowWifiPassword(false);
    setActiveModal("wifi");
  };

  const handleWifiProfileChange = (profileIndex: string) => {
    const selectedProfile = detail?.wifi_profiles.find((profile) => profile.index === profileIndex);
    setWifiForm(buildWifiFormFromProfile(selectedProfile, activeSsidList));
  };

  const handleWifiSubmit = async () => {
    const payload: AcsWifiConfigPayload =
      wifiForm.band === "2.4GHz"
        ? {
            ssid_2g: wifiForm.ssid,
            password_2g: wifiForm.password,
            enabled_2g: wifiForm.enabled,
          }
        : {
            ssid_5g: wifiForm.ssid,
            password_5g: wifiForm.password,
            enabled_5g: wifiForm.enabled,
          };

    await wifiTask.trigger(payload);
  };

  const handleWanSubmit = async () => {
    const payload: AcsWanConfigPayload = {
      pppoe_username: wanForm.username || undefined,
      pppoe_password: wanForm.password || undefined,
      mtu: wanForm.mtu ? Number(wanForm.mtu) : undefined,
    };

    await wanTask.trigger(payload);
  };

  const toParameterPayload = (rows: ParameterRow[]): AcsParameterPayload => ({
    parameters: rows
      .filter((row) => row.name.trim() && row.value.trim())
      .map<AcsParameterInput>((row) => ({
        name: row.name.trim(),
        value: row.type === "xsd:int" ? Number(row.value) : row.type === "xsd:boolean" ? row.value === "true" : row.value,
        type: row.type,
      })),
  });

  const renderParameterRows = (
    rows: ParameterRow[],
    setRows: (rows: ParameterRow[]) => void,
  ) => (
    <div className="space-y-4">
      {rows.map((row, index) => (
        <div className="grid gap-3 rounded-xl border-2 border-border p-4 sm:grid-cols-[1.3fr_1fr_0.8fr_auto]" key={row.id}>
          <Input
            placeholder="Parameter path"
            value={row.name}
            onChange={(event) => {
              const next = [...rows];
              next[index] = { ...row, name: event.target.value };
              setRows(next);
            }}
          />
          <Input
            placeholder="Value"
            value={row.value}
            onChange={(event) => {
              const next = [...rows];
              next[index] = { ...row, value: event.target.value };
              setRows(next);
            }}
          />
          <Select
            value={row.type}
            onValueChange={(value) => {
              const next = [...rows];
              next[index] = { ...row, type: value };
              setRows(next);
            }}
          >
            <Select.Trigger className="h-11 rounded-lg border-2 border-input bg-card px-3 text-sm text-foreground shadow-brutal-sm">
              <Select.Value placeholder="Select type" />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="xsd:string">String</Select.Item>
              <Select.Item value="xsd:int">Integer</Select.Item>
              <Select.Item value="xsd:boolean">Boolean</Select.Item>
            </Select.Content>
          </Select>
          <Button
            className="w-full sm:w-auto"
            onClick={() => setRows(rows.filter((_, currentIndex) => currentIndex !== index))}
            type="button"
            variant="outline"
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        className="w-full sm:w-auto"
        onClick={() => setRows([...rows, createParameterRow()])}
        type="button"
        variant="outline"
      >
        Add parameter
      </Button>
    </div>
  );

  const handleRefreshDetail = () => {
    const refreshDetailWithLoader = () => {
      void runWithGlobalLoader(async () => {
        const result = await detailQuery.refetch();
        if (result.error) {
          throw result.error;
        }
      }, "Refreshing ONU Detail...").catch((refreshError) => {
        showToast({
          title: "Refresh detail failed",
          description: getApiErrorMessage(refreshError),
          variant: "error",
        });
      });
    };

    setShowMoreActions(false);
    refreshDetailWithLoader();
  };

  const renderMoreActionButtons = () => (
    <>
      <button
        className="flex w-full items-center gap-2 rounded-lg border-2 border-transparent px-3 py-2 text-left text-sm font-semibold text-foreground hover:border-border hover:bg-muted/30"
        onClick={() => {
          setShowMoreActions(false);
          setActiveModal("security");
        }}
        type="button"
      >
        <Shield className="h-4 w-4" /> Config Security
      </button>
      <button
        className="flex w-full items-center gap-2 rounded-lg border-2 border-transparent px-3 py-2 text-left text-sm font-semibold text-foreground hover:border-border hover:bg-muted/30"
        onClick={() => {
          setShowMoreActions(false);
          setActiveModal("parameter");
        }}
        type="button"
      >
        <SlidersHorizontal className="h-4 w-4" /> Set Parameter
      </button>
      <button
        className="flex w-full items-center gap-2 rounded-lg border-2 border-transparent px-3 py-2 text-left text-sm font-semibold text-foreground hover:border-border hover:bg-muted/30 disabled:opacity-50"
        disabled={isActionPending}
        onClick={() => {
          setShowMoreActions(false);
          setActiveModal("wan");
        }}
        type="button"
      >
        <Globe2 className="h-4 w-4" /> Config WAN
      </button>
    </>
  );

  if (!id) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-destructive">Missing ONU device id.</CardContent>
      </Card>
    );
  }

  if (detailQuery.isLoading) {
    return <DetailSkeleton />;
  }

  if (detailQuery.isError || !detail) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Failed to load ONU detail</CardTitle>
          <CardDescription>{getApiErrorMessage(detailQuery.error)}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => {
              handleRefreshDetail();
            }}
            type="button"
            variant="outline"
          >
            <RefreshCcw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const rxBadge = getRxBadge(detail.rx_power);
  const tempBadge = getTempBadge(detail.temp);
  const isIncomplete = isOnuDetailIncomplete(detail);

  return (
    <>
      <div className="route-shell-page route-shell-onu-detail mx-auto max-w-[22.5rem] space-y-4 pb-24 md:max-w-none md:space-y-6 lg:pb-0">
        <div className="flex items-center justify-between rounded-2xl border-2 border-border bg-card px-3.5 py-2.5 shadow-brutal-sm md:hidden">
          <div className="flex items-center gap-3">
            <button
              className="rounded-full p-1 text-muted-foreground"
              onClick={() => {
                if (window.history.length > 1) {
                  navigate(-1);
                  return;
                }

                navigate("/onu");
              }}
              type="button"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <span className="text-[15px] font-semibold text-foreground">Network Core</span>
          </div>
        </div>

        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="hidden flex-wrap items-center gap-2 text-xs text-muted-foreground md:flex">
              <button
                className="inline-flex items-center gap-2 rounded-lg border-2 border-border bg-card px-3 py-2 text-sm font-semibold text-foreground shadow-brutal-sm transition hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-brutal"
                onClick={() => {
                  if (window.history.length > 1) {
                    navigate(-1);
                    return;
                  }

                  navigate("/onu");
                }}
                type="button"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
              <span>Home</span>
              <span>›</span>
              <span>Network</span>
              <span>›</span>
              <span>ONU Devices</span>
              <span>›</span>
              <span className="max-w-[16rem] truncate font-medium text-foreground">{detail.serial_number}</span>
            </div>
            <div className="relative overflow-hidden rounded-[28px] border-2 border-border bg-primary/20 p-3.5 shadow-[12px_12px_0_0_hsl(var(--border))] md:border-0 md:bg-transparent md:p-0 md:shadow-none">
              <div className="pointer-events-none absolute -right-7 top-3 hidden h-14 w-14 rotate-[15deg] border-2 border-border bg-accent/75 md:block" />
              <div className="pointer-events-none absolute bottom-2 left-4 hidden h-3 w-14 -rotate-6 border-2 border-border bg-secondary/80 md:block" />
              <div className="flex items-center gap-2 md:hidden">
                <h2 className="text-[clamp(1.45rem,5.4vw,1.85rem)] font-black tracking-tight text-foreground">{detail.vendor} {detail.device_type}</h2>
                <Badge variant="success">Active</Badge>
              </div>
              <h2 className="hidden break-all text-2xl font-black text-foreground sm:text-3xl md:block">{detail.serial_number}</h2>
              <p className="mt-1.5 break-all text-[12px] text-muted-foreground md:hidden">ID : {detail.device_id}</p>
              <p className="mt-2 hidden text-sm text-muted-foreground md:block">Detailed ONU diagnostics, network identity, and live ACS actions.</p>
            </div>
          </div>

        </div>

        {activeTask?.isPending || activeTask?.isError ? (
          <Card>
            <CardContent className="flex flex-col gap-2 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium text-foreground">{activeTask.isError ? activeTask.errorMessage ?? "Task failed" : activeTask.response?.message ?? "Task queued..."}</p>
                {activeTask.taskId ? <p className="text-muted-foreground">Task ID: {activeTask.taskId}</p> : null}
              </div>
              <Badge variant={activeTask.isError ? "destructive" : "secondary"}>{activeTask.isError ? "failed" : activeTask.task?.status ?? "queued"}</Badge>
            </CardContent>
          </Card>
        ) : null}

        {typeof document !== "undefined"
          ? createPortal(
            <div className="fixed inset-x-0 bottom-0 z-50 border-t-2 border-border bg-card p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] lg:hidden">
              <div className="space-y-2">
                <div className={cn("grid gap-2", isIncomplete ? "grid-cols-5" : "grid-cols-4")}>
                  {isIncomplete ? (
                    <button
                      className="flex flex-col items-center gap-1 rounded-lg border-2 border-border bg-primary px-1.5 py-2.5 text-[10px] font-semibold text-primary-foreground shadow-brutal-sm disabled:opacity-50"
                      disabled={isActionPending}
                      onClick={() => {
                        setShowMoreActions(false);
                        void summonDeviceMutation.mutateAsync();
                      }}
                      type="button"
                    >
                      <RefreshCcw className="h-3.5 w-3.5" /> Summon
                    </button>
                  ) : null}
                  <button
                    className="flex flex-col items-center gap-1 rounded-lg border-2 border-border bg-destructive px-1.5 py-2.5 text-[10px] font-semibold text-destructive-foreground shadow-brutal-sm disabled:opacity-50"
                    disabled={isActionPending}
                    onClick={() => {
                      setShowMoreActions(false);
                      setActiveModal("reboot");
                    }}
                    type="button"
                  >
                    <Power className="h-3.5 w-3.5" /> Reboot
                  </button>
                  <button
                    className="flex flex-col items-center gap-1 rounded-lg border-2 border-border bg-card px-1.5 py-2.5 text-[10px] font-semibold text-foreground shadow-brutal-sm disabled:opacity-50"
                    disabled={isActionPending}
                    onClick={() => {
                      setShowMoreActions(false);
                      openWifiModal();
                    }}
                    type="button"
                  >
                    <Wifi className="h-3.5 w-3.5" /> Config WiFi
                  </button>
                  <button
                    className="flex flex-col items-center gap-1 rounded-lg border-2 border-border bg-card px-1.5 py-2.5 text-[10px] font-semibold text-foreground shadow-brutal-sm disabled:opacity-50"
                    disabled={isActionPending || isGlobalLoading}
                    onClick={() => {
                      setShowMoreActions(false);
                      handleRefreshDetail();
                    }}
                    type="button"
                  >
                    <RefreshCcw className="h-3.5 w-3.5" /> Refresh detail
                  </button>
                  <button
                    className="flex flex-col items-center gap-1 rounded-lg border-2 border-border bg-card px-1.5 py-2.5 text-[10px] font-semibold text-foreground shadow-brutal-sm disabled:opacity-50"
                    disabled={isActionPending}
                    onClick={() => setShowMoreActions((current) => !current)}
                    type="button"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" /> More
                  </button>
                </div>
                {showMoreActions ? (
                  <div className="grid gap-2 rounded-xl border-2 border-border bg-card p-2 shadow-brutal">
                    {renderMoreActionButtons()}
                  </div>
                ) : null}
              </div>
            </div>,
            document.body,
          )
          : null}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_320px] xl:gap-6">
          <div className="space-y-5 xl:space-y-6">
            <Card className="bg-card/95">
              <CardContent className="space-y-4 p-3.5 sm:space-y-6 sm:p-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="text-[9px] sm:text-[10px]" variant="success">Active</Badge>
                      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground sm:text-[11px]">
                        {detail.parameter_profile_source || "ACS sync"}
                      </span>
                    </div>
                    <div>
                      <h3 className="break-all text-[1.35rem] font-semibold tracking-tight text-foreground sm:text-[1.55rem] xl:text-[1.7rem]">
                        {detail.device_id}
                      </h3>
                      <p className="mt-1.5 text-[12px] text-muted-foreground sm:text-[13px] xl:text-sm">
                        {detail.vendor} {detail.device_type} · GPON ONT
                      </p>
                    </div>
                  </div>

                  <div className="hidden flex-wrap items-center justify-end gap-2 lg:flex">
                    {isIncomplete ? <ActionButton disabled={isActionPending} icon={<RefreshCcw className="h-4 w-4" />} label="Summon Device" onClick={() => void summonDeviceMutation.mutateAsync()} /> : null}
                    <ActionButton disabled={isActionPending} icon={<Power className="h-4 w-4" />} label="Reboot" onClick={() => setActiveModal("reboot")} tone="danger" />
                    <ActionButton disabled={isActionPending} icon={<Wifi className="h-4 w-4" />} label="Config WiFi" onClick={openWifiModal} />
                    <ActionButton disabled={isActionPending || detailQuery.isFetching || isGlobalLoading} icon={<RefreshCcw className="h-4 w-4" />} label="Refresh detail" onClick={handleRefreshDetail} />
                    <div className="relative">
                    <Button disabled={isActionPending} onClick={() => setShowMoreActions((current) => !current)} type="button" variant="outline">
                      <MoreHorizontal className="h-4 w-4" />
                      <span className="ml-2">More</span>
                    </Button>
                    {showMoreActions ? (
                    <div className="absolute right-0 top-full z-20 mt-2 w-52 rounded-xl border-2 border-border bg-card p-2 shadow-brutal">
                        {renderMoreActionButtons()}
                      </div>
                    ) : null}
                  </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 sm:grid-cols-3 sm:gap-3 xl:grid-cols-4">
                  {[
                    ["Uptime", formatDisplayValue(detail.device_uptime)],
                    ["Temperature", detail.temp === null ? "-" : `${detail.temp}°C`],
                    ["Optical Power", detail.rx_power === null ? "-" : `${detail.rx_power} dBm`],
                  ].map(([label, value], index) => (
                    <div className="rounded-xl border-2 border-border bg-card px-2.5 py-2.5 shadow-brutal-sm sm:px-3 sm:py-3" key={label}>
                      <div className="mb-1.5 flex justify-center md:justify-start">
                        {index === 0 ? <Clock3 className="h-3.5 w-3.5 text-foreground sm:h-4 sm:w-4" /> : null}
                        {index === 1 ? <Thermometer className="h-3.5 w-3.5 text-foreground sm:h-4 sm:w-4" /> : null}
                        {index === 2 ? <Radio className="h-3.5 w-3.5 text-foreground sm:h-4 sm:w-4" /> : null}
                      </div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-foreground sm:text-[10px]">{label}</p>
                      <div className="mt-1 flex flex-col items-start gap-1 md:flex-row md:items-center md:gap-2">
                        <p className={cn(
                          "text-[13px] font-semibold text-foreground sm:text-[15px] md:text-lg",
                          index === 1 && tempBadge.variant === "warning" && "text-warning",
                          index === 1 && tempBadge.variant === "destructive" && "text-destructive",
                          index === 2 && rxBadge.variant === "warning" && "text-warning",
                          index === 2 && rxBadge.variant === "destructive" && "text-destructive",
                        )}>
                          {value}
                        </p>
                        {index === 1 ? <Badge className="text-[8px] sm:text-[9px]" variant={tempBadge.variant}>{tempBadge.label}</Badge> : null}
                        {index === 2 ? <Badge className="text-[8px] sm:text-[9px]" variant={rxBadge.variant}>{rxBadge.label}</Badge> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>PPPoE Configuration</CardTitle>
                <CardDescription>Subscriber access credentials and IP assignment.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2.5 md:grid-cols-3">
                <InfoItem label="IP PPPoE" muted={isMutedValue(detail.ip_pppoe)} value={formatDisplayValue(detail.ip_pppoe)} />
                <InfoItem label="PPPoE Username" muted={isMutedValue(detail.pppoe_username)} value={formatDisplayValue(detail.pppoe_username)} />
                <InfoItem
                  label="PPPoE Password"
                  value={detail.pppoe_password === null ? <Badge variant="secondary">Not Available</Badge> : showPppoePassword ? detail.pppoe_password : "******"}
                  action={detail.pppoe_password !== null ? (
                  <button className="text-muted-foreground hover:text-foreground" onClick={() => setShowPppoePassword((current) => !current)} type="button">
                      {showPppoePassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  ) : null}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-4">
                <div>
                  <CardTitle className="text-lg">Wi-Fi Networks</CardTitle>
                  <CardDescription className="text-xs sm:text-sm">Configured radios and active SSIDs.</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className="text-[10px] sm:text-[11px]" variant="secondary">{wifiProfileCount} profiles</Badge>
                  <Button className="hidden h-9 sm:inline-flex" disabled={isActionPending} onClick={openWifiModal} type="button" variant="ghost">
                    Configure Radios
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                {detail.wifi_profiles.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">No WiFi profiles available</div>
                ) : (
                  <div className="grid gap-2.5 md:grid-cols-2">
                    {detail.wifi_profiles.map((profile: WifiProfile) => (
                      <div className="flex flex-col gap-2.5 rounded-xl border-2 border-border bg-card px-3 py-3 shadow-brutal-sm sm:flex-row sm:items-center sm:justify-between" key={profile.index}>
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border-2 border-border bg-secondary text-secondary-foreground"><Wifi className="h-3.5 w-3.5" /></span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="truncate text-sm font-semibold text-foreground">{profile.ssid}</p>
                                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground">#{profile.index}</span>
                              </div>
                              <p className="text-[11px] text-muted-foreground">
                                {activeSsidList.includes(profile.ssid)
                                  ? "SSID aktif dan sedang broadcast"
                                  : "SSID tersimpan tapi tidak broadcast"
                                }
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2.5 sm:justify-end">
                          <Badge className="text-[10px]" variant={activeSsidList.includes(profile.ssid) ? "success" : "secondary"}>
                            {activeSsidList.includes(profile.ssid) ? "Enabled" : "Hidden / Disabled"}
                          </Badge>
                          <div className="flex items-center gap-2 rounded-lg border-2 border-border bg-card px-2.5 py-1.5 text-[13px] text-foreground shadow-brutal-sm">
                            <span>{visibleWifiPasswords[profile.index] ? profile.password : "******"}</span>
                            <button className="text-muted-foreground hover:text-foreground" onClick={() => setVisibleWifiPasswords((current) => ({ ...current, [profile.index]: !current[profile.index] }))} type="button">
                              {visibleWifiPasswords[profile.index] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-border bg-card px-3.5 py-2.5 shadow-brutal-sm">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">Active SSIDs</p>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {activeSsidList.length === 0 ? (
                        <span className="text-[13px] text-muted-foreground">No active SSID</span>
                      ) : (
                        activeSsidList.map((ssid) => (
                          <Badge className="normal-case text-[10px] tracking-normal" key={ssid} variant="secondary">
                            {ssid}
                          </Badge>
                        ))
                      )}
                    </div>
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      Kalau SSID berhasil di-disable, badge profile akan berubah jadi <span className="font-semibold">Hidden / Disabled</span> dan nama SSID akan hilang dari daftar Active SSIDs.
                    </p>
                  </div>
                  <Button className="h-9 sm:hidden" disabled={isActionPending} onClick={openWifiModal} type="button" variant="outline">
                    Configure
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                <div>
                  <CardTitle>Client List</CardTitle>
                  <CardDescription>Connected devices reported by the ONU.</CardDescription>
                </div>
                <Badge variant="secondary">{clientCount} client</Badge>
              </CardHeader>
              <CardContent>
                {detail.client_list.length === 0 ? (
                  <div className="rounded-[28px] border-2 border-dashed border-border bg-card px-4 py-14 text-center">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg border-2 border-border bg-secondary text-secondary-foreground">
                      <Wifi className="h-6 w-6" />
                    </div>
                    <p className="mt-4 text-base font-semibold text-foreground">No connected clients</p>
                    <p className="mt-2 text-sm text-muted-foreground">There are currently no wired or wireless devices connected to this ONU.</p>
                  </div>
                ) : (
                  <>
                    <div className="hidden overflow-x-auto md:block">
                      <table className="min-w-full text-left text-sm">
                        <thead className="bg-card/80 text-xs uppercase tracking-[0.15em] text-foreground dark:bg-card/70">
                          <tr>
                            {clientColumns.map((column) => (
                              <th className="px-4 py-3" key={column}>{column.replace(/_/g, " ")}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {detail.client_list.map((client) => (
                            <tr className="border-t border-border/80" key={typeof client === "string" ? client : JSON.stringify(client)}>
                              {clientColumns.map((column) => (
                                <td className="px-4 py-3 text-foreground" key={column}>
                                  {typeof client === "string" ? normalizeClientValue(client) : normalizeClientValue(client[column])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="grid gap-4 md:hidden">
                      {detail.client_list.map((client) => (
                        <div className="rounded-2xl border border-border/80 p-4" key={typeof client === "string" ? `${client}-mobile` : `${JSON.stringify(client)}-mobile`}>
                          <div className="grid gap-3 sm:grid-cols-2">
                            {clientColumns.map((column) => (
                              <div key={column}>
                                <p className="text-xs uppercase tracking-[0.14em] text-foreground">{column.replace(/_/g, " ")}</p>
                                <p className="mt-1 break-all text-sm text-foreground">{typeof client === "string" ? normalizeClientValue(client) : normalizeClientValue(client[column])}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Maintenance</CardTitle>
                <CardDescription>Sync freshness and profile metadata.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                  <InfoItem label="Last Inform" muted={isMutedValue(detail.last_inform_at)} value={<div><p>{formatPreciseTimestamp(detail.last_inform_at)}</p></div>} />
                  <InfoItem label="Profile" muted={isMutedValue(detail.parameter_profile)} value={formatDisplayValue(detail.parameter_profile)} />
                  <InfoItem label="Source" muted={isMutedValue(detail.parameter_profile_source)} value={formatDisplayValue(detail.parameter_profile_source)} />
                  <InfoItem label="Serial Number" muted={isMutedValue(detail.serial_number)} value={formatDisplayValue(detail.serial_number)} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Hardware Info</CardTitle>
                <CardDescription>Core addresses and hardware indicators.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <InfoItem label="Local IP" muted={isMutedValue(detail.ip_address)} value={formatDisplayValue(detail.ip_address)} />
                <InfoItem label="TR069 Mgmt" muted={isMutedValue(detail.ip_tr069)} value={formatDisplayValue(detail.ip_tr069)} />
                <InfoItem label="IPv6" muted={isMutedValue(detail.ipv6_address)} value={formatDisplayValue(detail.ipv6_address)} />
              </CardContent>
            </Card>

            <Card className="bg-accent text-accent-foreground">
              <CardContent className="space-y-4 p-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em]">Diagnostics</p>
                  <p className="mt-2 text-sm leading-6 text-accent-foreground/85">
                    RX sensitivity below -27 dBm may cause intermittent packet loss and unstable client sessions.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button className="bg-primary text-primary-foreground" disabled={isActionPending} onClick={() => setActiveModal("parameter")} type="button">
                    Run Diagnostics
                  </Button>
                  <Button disabled={isActionPending} onClick={() => setActiveModal("security")} type="button" variant="outline">
                    Secure Device
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <OverlayPanel open={activeModal === "reboot"} title="Reboot Device" description="Yakin ingin reboot perangkat ini?" onClose={() => setActiveModal("none")}>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button className="w-full sm:w-auto" onClick={() => setActiveModal("none")} type="button" variant="outline">Cancel</Button>
          <Button className="w-full sm:w-auto" disabled={isActionPending} onClick={() => void rebootTask.trigger()} type="button" variant="destructive">
            Confirm Reboot
          </Button>
        </div>
      </OverlayPanel>

      <OverlayPanel open={activeModal === "wifi"} title="Config WiFi" description="Select an existing SSID profile, adjust the name or password, then save." onClose={() => setActiveModal("none")}>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void handleWifiSubmit(); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              value={wifiForm.profileIndex || undefined}
              onValueChange={(value) => handleWifiProfileChange(value)}
            >
              <Select.Trigger className="h-11 rounded-lg border-2 border-input bg-card px-3 text-sm text-foreground shadow-brutal-sm sm:col-span-2">
                <Select.Value placeholder="Select profile" />
              </Select.Trigger>
              <Select.Content>
                {detail.wifi_profiles.length === 0 ? (
                  <Select.Item value="__no_profile__" disabled>
                    No profile available
                  </Select.Item>
                ) : null}
                {detail.wifi_profiles.map((profile) => (
                  <Select.Item key={profile.index} value={profile.index}>
                    {inferWifiBand(profile)} · {profile.ssid}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
            <Input placeholder="SSID" required value={wifiForm.ssid} onChange={(event) => setWifiForm((current) => ({ ...current, ssid: event.target.value }))} />
            <div className="relative">
              <Input
                className="pr-10"
                placeholder="Password"
                required
                type={showWifiPassword ? "text" : "password"}
                value={wifiForm.password}
                onChange={(event) => setWifiForm((current) => ({ ...current, password: event.target.value }))}
              />
              <button
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowWifiPassword((current) => !current)}
                type="button"
              >
                {showWifiPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <div className="flex h-11 items-center rounded-lg border-2 border-input bg-card px-3 text-sm font-medium text-foreground shadow-brutal-sm">
              {wifiForm.band}
            </div>
            <Select
              value={wifiForm.enabled ? "on" : "off"}
              onValueChange={(value) => setWifiForm((current) => ({ ...current, enabled: value === "on" }))}
            >
              <Select.Trigger className="h-11 rounded-lg border-2 border-input bg-card px-3 text-sm text-foreground shadow-brutal-sm">
                <Select.Value placeholder="Select state" />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="on">Enable SSID</Select.Item>
                <Select.Item value="off">Disable SSID</Select.Item>
              </Select.Content>
            </Select>
          </div>
          <div className="rounded-2xl bg-card/80 px-4 py-3 text-xs text-muted-foreground dark:bg-card/70">
            <p>Current profile selection loads the existing SSID name and password so you only need to edit the fields that should change.</p>
            <p className="mt-1">Band follows the selected radio/profile automatically. This form now sends only the documented WiFi fields: SSID name, password, and enable/disable state.</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Button className="w-full sm:w-auto" onClick={() => setActiveModal("none")} type="button" variant="outline">Cancel</Button>
            <Button className="w-full sm:w-auto" disabled={isActionPending} type="submit">Submit WiFi Config</Button>
          </div>
        </form>
      </OverlayPanel>

      <OverlayPanel open={activeModal === "wan"} title="Config WAN" description="Update WAN PPPoE credentials and connection profile." onClose={() => setActiveModal("none")}>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void handleWanSubmit(); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input placeholder="PPPoE Username" required value={wanForm.username} onChange={(event) => setWanForm((current) => ({ ...current, username: event.target.value }))} />
            <Input placeholder="PPPoE Password" required type="password" value={wanForm.password} onChange={(event) => setWanForm((current) => ({ ...current, password: event.target.value }))} />
            <Input placeholder="MTU (optional)" value={wanForm.mtu} onChange={(event) => setWanForm((current) => ({ ...current, mtu: event.target.value }))} />
            <Input placeholder="VPI (if available)" value={wanForm.vpi} onChange={(event) => setWanForm((current) => ({ ...current, vpi: event.target.value }))} />
            <Input className="sm:col-span-2" placeholder="VCI (if available)" value={wanForm.vci} onChange={(event) => setWanForm((current) => ({ ...current, vci: event.target.value }))} />
          </div>
          <p className="text-xs text-muted-foreground">Current backend contract applies PPPoE credentials and MTU directly. VPI/VCI are shown here for operator reference and may require vendor-specific parameter mapping.</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Button className="w-full sm:w-auto" onClick={() => setActiveModal("none")} type="button" variant="outline">Cancel</Button>
            <Button className="w-full sm:w-auto" disabled={isActionPending} type="submit">Submit WAN Config</Button>
          </div>
        </form>
      </OverlayPanel>

      <OverlayPanel open={activeModal === "security"} title="Config Security" description="Dispatch security-related TR-069 parameters to the device." onClose={() => setActiveModal("none")}>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void securityTask.trigger(toParameterPayload(securityParameters)); }}>
          {renderParameterRows(securityParameters, setSecurityParameters)}
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Button className="w-full sm:w-auto" onClick={() => setActiveModal("none")} type="button" variant="outline">Cancel</Button>
            <Button className="w-full sm:w-auto" disabled={isActionPending} type="submit">Dispatch Security Config</Button>
          </div>
        </form>
      </OverlayPanel>

      <OverlayPanel open={activeModal === "parameter"} title="Set Parameter" description="Send custom TR-069 parameter updates to the ONU." onClose={() => setActiveModal("none")}>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void parameterTask.trigger(toParameterPayload(customParameters)); }}>
          {renderParameterRows(customParameters, setCustomParameters)}
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Button className="w-full sm:w-auto" onClick={() => setActiveModal("none")} type="button" variant="outline">Cancel</Button>
            <Button className="w-full sm:w-auto" disabled={isActionPending} type="submit">Dispatch Parameters</Button>
          </div>
        </form>
      </OverlayPanel>
    </>
  );
}
