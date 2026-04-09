import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Search, Settings2 } from "lucide-react";
import { useParams } from "react-router-dom";
import { useAsyncTask } from "@/hooks/useAsyncTask";
import {
  createMikrotikProfile,
  createMikrotikSecret,
  deleteMikrotikProfile,
  deleteMikrotikSecret,
  getApiErrorMessage,
  getMikrotikDeviceDetail,
  getMikrotikDevices,
  getMikrotikInterfaceTraffic,
  getMikrotikInterfaces,
  getMikrotikPppActive,
  getMikrotikProfiles,
  getMikrotikSecrets,
  kickMikrotikPppSession,
  updateMikrotikDevice,
  updateMikrotikProfile,
  updateMikrotikSecret,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type {
  MikrotikAsyncActionResponse,
  MikrotikDeviceSettingsPayload,
  MikrotikInterfaceTraffic,
  MikrotikInterfaceRow,
  MikrotikPppActiveRow,
  MikrotikProfileRow,
  MikrotikProfileUpsertPayload,
  MikrotikRegistryDevice,
  MikrotikSecretRow,
  MikrotikSecretUpsertPayload,
  MikrotikStatus,
} from "@/types/mikrotik";

type DetailTab = "interface" | "ppp-active" | "secret" | "profile";

type InterfaceFilter = "all" | "ether" | "vlan" | "pppoe";

type PendingTask = {
  taskId: string;
  message: string;
  invalidateKeys: string[];
};

type InterfaceTrafficHistory = Record<string, MikrotikInterfaceTraffic[]>;

const TAB_ITEMS: Array<{ key: DetailTab; label: string }> = [
  { key: "interface", label: "Interface" },
  { key: "ppp-active", label: "PPP Active" },
  { key: "secret", label: "Secret" },
  { key: "profile", label: "Profile" },
];

const EMPTY_SECRET_FORM: MikrotikSecretUpsertPayload = {
  name: "",
  password: "",
  profile: "default",
  service: "pppoe",
  local_address: "",
  remote_address: "",
  comment: "",
  disabled: false,
};

const EMPTY_PROFILE_FORM: MikrotikProfileUpsertPayload = {
  name: "",
  local_address: "",
  remote_pool: "",
  rate_limit: "",
  dns_server: "",
  only_one: false,
  change_tcp_mss: false,
  comment: "",
};

const PPP_SERVICE_OPTIONS = ["any", "pppoe", "l2tp", "pptp", "ovpn", "sstp"] as const;

function normalizeStatus(status?: string): MikrotikStatus {
  const normalized = status?.toLowerCase();
  if (normalized === "online") return "online";
  if (normalized === "offline" || normalized === "down") return "offline";
  return "unknown";
}

function getStatusVariant(status: MikrotikStatus) {
  if (status === "online") return "success" as const;
  if (status === "offline" || status === "down") return "destructive" as const;
  return "secondary" as const;
}

function parsePercent(value: string) {
  const parsed = Number.parseFloat(value.replace("%", ""));
  return Number.isNaN(parsed) ? 0 : Math.max(0, Math.min(parsed, 100));
}

function formatTrafficCompact(value?: number) {
  if (value === undefined || Number.isNaN(value)) {
    return "0 bps";
  }

  if (value <= 0) {
    return "0 bps";
  }

  if (value < 1) {
    return `${(value * 1000).toFixed(0)} Kbps`;
  }

  return `${value.toFixed(1)}M`;
}

function isTruthy(value: string | boolean | undefined) {
  return value === true || value === "true";
}

function matchesInterfaceFilter(item: { name: string; type?: string }, filter: InterfaceFilter) {
  if (filter === "all") {
    return true;
  }

  const value = `${item.name} ${item.type ?? ""}`.toLowerCase();
  return value.includes(filter);
}

function toOptionalString(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function matchesSearchTerm(values: Array<string | number | boolean | null | undefined>, searchTerm: string) {
  if (!searchTerm) {
    return true;
  }

  return values.some((value) => String(value ?? "").toLowerCase().includes(searchTerm));
}

function getInterfaceMacAddress(item: MikrotikInterfaceRow) {
  const raw = item as MikrotikInterfaceRow & {
    "mac-address"?: string;
    mac_address?: string;
    macAddress?: string;
  };

  return raw["mac-address"]?.trim() || raw.mac_address?.trim() || raw.macAddress?.trim() || "-";
}

function getInterfaceStatus(item: MikrotikInterfaceRow) {
  const disabled = isTruthy(item.disabled);
  const running = isTruthy(item.running);

  if (disabled) {
    return {
      label: "Disabled",
      dotClassName: "text-slate-400",
      chipClassName: "border-slate-200 bg-slate-100 text-slate-600",
      accentClassName: "from-slate-300 via-slate-200 to-transparent",
    };
  }

  if (running) {
    return {
      label: "Running",
      dotClassName: "text-emerald-600",
      chipClassName: "border-emerald-200 bg-emerald-50 text-emerald-700",
      accentClassName: "from-emerald-500/70 via-emerald-300/30 to-transparent",
    };
  }

  return {
    label: "Down",
    dotClassName: "text-amber-500",
    chipClassName: "border-amber-200 bg-amber-50 text-amber-700",
    accentClassName: "from-amber-500/70 via-amber-300/30 to-transparent",
  };
}

function formatSampledAt(value?: string) {
  if (!value) {
    return "Waiting for live sample";
  }

  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatInterfaceValue(value?: string | number | null) {
  if (value === null || value === undefined) {
    return "-";
  }

  const normalized = String(value).trim();
  return normalized ? normalized : "-";
}

function formatRegistryTimestamp(value?: string) {
  if (!value) {
    return "Never synced";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function buildTrafficLinePoints(samples: MikrotikInterfaceTraffic[], key: "rx_mbps" | "tx_mbps", ceiling: number) {
  if (samples.length === 0) {
    return [];
  }

  const normalizedSamples = samples.length === 1 ? [samples[0], samples[0]] : samples;
  const step = normalizedSamples.length > 1 ? 100 / (normalizedSamples.length - 1) : 100;

  return normalizedSamples.map((sample, index) => {
    const rawValue = sample[key];
    const value = Number.isFinite(rawValue) && rawValue > 0 ? rawValue : 0;
    const ratio = ceiling > 0 ? Math.min(value / ceiling, 1) : 0;

    return {
      x: index * step,
      y: 86 - ratio * 66,
      value,
      sampledAt: sample.sampled_at,
    };
  });
}

function buildTrafficPath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) {
    return "";
  }

  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function toSecretPayload(values: MikrotikSecretUpsertPayload) {
  return {
    name: values.name.trim(),
    password: toOptionalString(values.password),
    profile: toOptionalString(values.profile),
    service: toOptionalString(values.service),
    local_address: toOptionalString(values.local_address),
    remote_address: toOptionalString(values.remote_address),
    comment: toOptionalString(values.comment),
    disabled: values.disabled,
  } satisfies MikrotikSecretUpsertPayload;
}

function toProfilePayload(values: MikrotikProfileUpsertPayload) {
  return {
    name: values.name.trim(),
    local_address: toOptionalString(values.local_address),
    remote_pool: toOptionalString(values.remote_pool),
    rate_limit: toOptionalString(values.rate_limit),
    dns_server: toOptionalString(values.dns_server),
    only_one: values.only_one,
    change_tcp_mss: values.change_tcp_mss,
    comment: toOptionalString(values.comment),
  } satisfies MikrotikProfileUpsertPayload;
}

function SecretForm({
  title,
  values,
  profileOptions,
  onChange,
  onSubmit,
  submitLabel,
  onCancel,
  isPending,
}: {
  title: string;
  values: MikrotikSecretUpsertPayload;
  profileOptions: string[];
  onChange: (next: MikrotikSecretUpsertPayload) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitLabel: string;
  onCancel?: () => void;
  isPending: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={onSubmit}>
          <Input placeholder="Name" required value={values.name} onChange={(event) => onChange({ ...values, name: event.target.value })} />
          <Input placeholder="Password" value={values.password ?? ""} onChange={(event) => onChange({ ...values, password: event.target.value })} />
          <select
            className="h-11 rounded-xl border border-input bg-background px-3 text-sm text-foreground shadow-sm"
            value={values.profile ?? ""}
            onChange={(event) => onChange({ ...values, profile: event.target.value })}
          >
            <option value="">Select Profile</option>
            {profileOptions.map((profile) => (
              <option key={profile} value={profile}>
                {profile}
              </option>
            ))}
          </select>
          <select
            className="h-11 rounded-xl border border-input bg-background px-3 text-sm text-foreground shadow-sm"
            value={values.service ?? ""}
            onChange={(event) => onChange({ ...values, service: event.target.value })}
          >
            <option value="">Select Service</option>
            {PPP_SERVICE_OPTIONS.map((service) => (
              <option key={service} value={service}>
                {service}
              </option>
            ))}
          </select>
          <Input placeholder="Local Address" value={values.local_address ?? ""} onChange={(event) => onChange({ ...values, local_address: event.target.value })} />
          <Input placeholder="Remote Address" value={values.remote_address ?? ""} onChange={(event) => onChange({ ...values, remote_address: event.target.value })} />
          <Input placeholder="Comment" value={values.comment ?? ""} onChange={(event) => onChange({ ...values, comment: event.target.value })} />
          <label className="flex items-center gap-3 text-sm text-slate-600 xl:col-span-2">
            <input checked={values.disabled ?? false} onChange={(event) => onChange({ ...values, disabled: event.target.checked })} type="checkbox" />
            Disabled
          </label>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap xl:col-span-2">
            <Button className="w-full sm:w-auto" disabled={isPending} type="submit">{submitLabel}</Button>
            {onCancel ? <Button className="w-full sm:w-auto" onClick={onCancel} type="button" variant="outline">Cancel</Button> : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ProfileForm({
  title,
  values,
  remotePoolOptions,
  onChange,
  onSubmit,
  submitLabel,
  onCancel,
  isPending,
}: {
  title: string;
  values: MikrotikProfileUpsertPayload;
  remotePoolOptions: string[];
  onChange: (next: MikrotikProfileUpsertPayload) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitLabel: string;
  onCancel?: () => void;
  isPending: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={onSubmit}>
          <Input placeholder="Name" required value={values.name} onChange={(event) => onChange({ ...values, name: event.target.value })} />
          <Input placeholder="Local Address" value={values.local_address ?? ""} onChange={(event) => onChange({ ...values, local_address: event.target.value })} />
          <select
            className="h-11 rounded-xl border border-input bg-background px-3 text-sm text-foreground shadow-sm"
            value={values.remote_pool ?? ""}
            onChange={(event) => onChange({ ...values, remote_pool: event.target.value })}
          >
            <option value="">Select Remote Pool</option>
            {remotePoolOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <Input placeholder="Rate Limit" value={values.rate_limit ?? ""} onChange={(event) => onChange({ ...values, rate_limit: event.target.value })} />
          <Input placeholder="DNS Server" value={values.dns_server ?? ""} onChange={(event) => onChange({ ...values, dns_server: event.target.value })} />
          <Input placeholder="Comment" value={values.comment ?? ""} onChange={(event) => onChange({ ...values, comment: event.target.value })} />
          <label className="flex items-center gap-3 text-sm text-slate-600">
            <input checked={values.only_one ?? false} onChange={(event) => onChange({ ...values, only_one: event.target.checked })} type="checkbox" />
            Only one session
          </label>
          <label className="flex items-center gap-3 text-sm text-slate-600">
            <input checked={values.change_tcp_mss ?? false} onChange={(event) => onChange({ ...values, change_tcp_mss: event.target.checked })} type="checkbox" />
            Change TCP MSS
          </label>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap xl:col-span-2">
            <Button className="w-full sm:w-auto" disabled={isPending} type="submit">{submitLabel}</Button>
            {onCancel ? <Button className="w-full sm:w-auto" onClick={onCancel} type="button" variant="outline">Cancel</Button> : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function OverlayPanel({
  open,
  title,
  description,
  onClose,
  children,
  panelClassName,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  panelClassName?: string;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-slate-950/35 p-3 sm:items-center sm:p-6">
      <button aria-label="Close overlay" className="absolute inset-0" onClick={onClose} type="button" />
      <div className={cn("relative z-10 max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-t-[28px] border border-border bg-card/95 text-foreground shadow-2xl sm:rounded-[28px]", panelClassName)}>
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
          <div>
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
            {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
          </div>
          <Button className="h-8 px-3 text-[11px]" onClick={onClose} type="button" variant="outline">
            Close
          </Button>
        </div>
        <div className="px-5 py-5 sm:px-6">{children}</div>
      </div>
    </div>
  );
}

export default function MikrotikDetail() {
  const { deviceId = "" } = useParams();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<DetailTab>("interface");
  const [tabSearchTerm, setTabSearchTerm] = useState("");
  const [interfaceFilter, setInterfaceFilter] = useState<InterfaceFilter>("all");
  const [showSettings, setShowSettings] = useState(false);
  const [pendingTask, setPendingTask] = useState<PendingTask | null>(null);
  const [settingsForm, setSettingsForm] = useState<MikrotikDeviceSettingsPayload>({});
  const [newSecret, setNewSecret] = useState<MikrotikSecretUpsertPayload>(EMPTY_SECRET_FORM);
  const [editingSecretId, setEditingSecretId] = useState<string | null>(null);
  const [editingSecretForm, setEditingSecretForm] = useState<MikrotikSecretUpsertPayload>(EMPTY_SECRET_FORM);
  const [newProfile, setNewProfile] = useState<MikrotikProfileUpsertPayload>(EMPTY_PROFILE_FORM);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [editingProfileForm, setEditingProfileForm] = useState<MikrotikProfileUpsertPayload>(EMPTY_PROFILE_FORM);
  const [secretModalOpen, setSecretModalOpen] = useState<"none" | "create" | "edit">("none");
  const [profileModalOpen, setProfileModalOpen] = useState<"none" | "create" | "edit">("none");
  const [selectedInterfaceName, setSelectedInterfaceName] = useState<string | null>(null);
  const [selectedInterfaceId, setSelectedInterfaceId] = useState<string | null>(null);
  const [interfaceTrafficHistory, setInterfaceTrafficHistory] = useState<InterfaceTrafficHistory>({});
  const [selectedInterfaceTraffic, setSelectedInterfaceTraffic] = useState<MikrotikInterfaceTraffic | null>(null);
  const [selectedInterfaceTrafficUpdatedAt, setSelectedInterfaceTrafficUpdatedAt] = useState(0);

  const detailQuery = useQuery({
    queryKey: ["mikrotik-device-detail", deviceId],
    queryFn: () => getMikrotikDeviceDetail(deviceId),
    enabled: Boolean(deviceId),
  });

  const registryQuery = useQuery({
    queryKey: ["mikrotik-devices"],
    queryFn: getMikrotikDevices,
  });

  const interfacesQuery = useQuery({
    queryKey: ["mikrotik-interfaces", deviceId],
    queryFn: () => getMikrotikInterfaces(deviceId),
    enabled: Boolean(deviceId),
  });

  const pppActiveQuery = useQuery({
    queryKey: ["mikrotik-ppp-active", deviceId],
    queryFn: () => getMikrotikPppActive(deviceId),
    enabled: Boolean(deviceId),
  });

  const secretsQuery = useQuery({
    queryKey: ["mikrotik-secrets", deviceId],
    queryFn: () => getMikrotikSecrets(deviceId),
    enabled: Boolean(deviceId),
  });

  const profilesQuery = useQuery({
    queryKey: ["mikrotik-profiles", deviceId],
    queryFn: () => getMikrotikProfiles(deviceId),
    enabled: Boolean(deviceId),
  });

  const registryDevice = useMemo<MikrotikRegistryDevice | undefined>(
    () => (registryQuery.data ?? []).find((item) => item.id === deviceId),
    [deviceId, registryQuery.data],
  );

  useEffect(() => {
    if (!registryDevice) {
      return;
    }

    setSettingsForm({
      name: registryDevice.name,
      host: registryDevice.host,
      port: registryDevice.port,
      username: registryDevice.username,
      password: "",
      site: registryDevice.site ?? "",
      tags: registryDevice.tags ?? [],
    });
  }, [registryDevice]);

  const interfaceFilterCounts = useMemo(
    () => ({
      all: (interfacesQuery.data ?? []).length,
      ether: (interfacesQuery.data ?? []).filter((item) => matchesInterfaceFilter(item, "ether")).length,
      vlan: (interfacesQuery.data ?? []).filter((item) => matchesInterfaceFilter(item, "vlan")).length,
      pppoe: (interfacesQuery.data ?? []).filter((item) => matchesInterfaceFilter(item, "pppoe")).length,
    }),
    [interfacesQuery.data],
  );

  const filteredInterfaces = useMemo(
    () => {
      const normalizedSearch = tabSearchTerm.trim().toLowerCase();

      return (interfacesQuery.data ?? []).filter((item) => (
        matchesInterfaceFilter(item, interfaceFilter)
        && matchesSearchTerm([
          item.name,
          item.type,
          item.comment,
          item.mtu,
          getInterfaceMacAddress(item),
        ], normalizedSearch)
      ));
    },
    [interfaceFilter, interfacesQuery.data, tabSearchTerm],
  );

  useEffect(() => {
    if (!deviceId || activeTab !== "interface" || !selectedInterfaceName || !selectedInterfaceId) {
      setSelectedInterfaceTraffic(null);
      setSelectedInterfaceTrafficUpdatedAt(0);
      return;
    }

    let cancelled = false;
    let timeoutId: number | null = null;

    const fetchTraffic = async () => {
      if (typeof document !== "undefined" && document.hidden) {
        if (!cancelled) {
          timeoutId = window.setTimeout(() => {
            void fetchTraffic();
          }, 1500);
        }
        return;
      }

      try {
        const sample = await getMikrotikInterfaceTraffic(deviceId, selectedInterfaceId);
        if (cancelled) {
          return;
        }

        setSelectedInterfaceTraffic(sample);
        setSelectedInterfaceTrafficUpdatedAt(Date.now());
      } catch {
      } finally {
        if (!cancelled) {
          timeoutId = window.setTimeout(() => {
            void fetchTraffic();
          }, 1500);
        }
      }
    };

    void fetchTraffic();

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [activeTab, deviceId, selectedInterfaceId, selectedInterfaceName]);

  useEffect(() => {
    setInterfaceTrafficHistory((current) => {
      if (!selectedInterfaceName || !selectedInterfaceTraffic) {
        return current;
      }

      const effectiveSampledAt = selectedInterfaceTraffic.sampled_at
        || (selectedInterfaceTrafficUpdatedAt
          ? new Date(selectedInterfaceTrafficUpdatedAt).toISOString()
          : undefined);

      if (!effectiveSampledAt) {
        return current;
      }

      const normalizedSample = {
        ...selectedInterfaceTraffic,
        sampled_at: effectiveSampledAt,
      };

      const previous = current[selectedInterfaceName] ?? [];
      const lastSample = previous[previous.length - 1];
      if (
        lastSample
        && lastSample.sampled_at === normalizedSample.sampled_at
        && lastSample.tx_mbps === normalizedSample.tx_mbps
        && lastSample.rx_mbps === normalizedSample.rx_mbps
        && lastSample.tx_pps === normalizedSample.tx_pps
        && lastSample.rx_pps === normalizedSample.rx_pps
      ) {
        return current;
      }

      return {
        ...current,
        [selectedInterfaceName]: [...previous, normalizedSample].slice(-14),
      };
    });
  }, [selectedInterfaceName, selectedInterfaceTraffic, selectedInterfaceTrafficUpdatedAt]);

  const openInterfaceMonitor = async (interfaceName: string, interfaceId?: string) => {
    setSelectedInterfaceName(interfaceName);
    setSelectedInterfaceId(interfaceId ?? interfaceName);

    try {
      const sample = await getMikrotikInterfaceTraffic(deviceId, interfaceId ?? interfaceName);
      setSelectedInterfaceTraffic(sample);
      setSelectedInterfaceTrafficUpdatedAt(Date.now());
    } catch {
      setSelectedInterfaceTraffic(null);
      setSelectedInterfaceTrafficUpdatedAt(0);
    }
  };

  useEffect(() => {
    if (filteredInterfaces.length === 0) {
      if (selectedInterfaceName !== null) {
        setSelectedInterfaceName(null);
        setSelectedInterfaceId(null);
      }
      return;
    }

    if (selectedInterfaceName && !filteredInterfaces.some((item) => item.name === selectedInterfaceName)) {
      setSelectedInterfaceName(null);
      setSelectedInterfaceId(null);
    }
  }, [filteredInterfaces, selectedInterfaceName]);

  const selectedInterface = useMemo(
    () => filteredInterfaces.find((item) => item.name === selectedInterfaceName),
    [filteredInterfaces, selectedInterfaceName],
  );

  const taskStatusQuery = useAsyncTask({
    path: "/mikrotik/tasks",
    taskId: pendingTask?.taskId,
    enabled: Boolean(pendingTask?.taskId),
  });

  useEffect(() => {
    if (taskStatusQuery.data?.status !== "success" || !pendingTask) {
      return;
    }

    pendingTask.invalidateKeys.forEach((key) => {
      void queryClient.invalidateQueries({ queryKey: [key, deviceId] });
    });
    void queryClient.invalidateQueries({ queryKey: ["mikrotik-devices"] });
  }, [deviceId, pendingTask, queryClient, taskStatusQuery.data?.status]);

  function registerAsyncTask(response: MikrotikAsyncActionResponse, invalidateKeys: string[]) {
    setPendingTask({
      taskId: response.task.id,
      message: response.message,
      invalidateKeys,
    });
  }

  const settingsMutation = useMutation({
    mutationFn: (payload: MikrotikDeviceSettingsPayload) => updateMikrotikDevice(deviceId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["mikrotik-devices"] });
      await queryClient.invalidateQueries({ queryKey: ["mikrotik-device-detail", deviceId] });
      setShowSettings(false);
    },
  });

  const createSecretMutation = useMutation({
    mutationFn: (payload: MikrotikSecretUpsertPayload) => createMikrotikSecret(deviceId, payload),
    onSuccess: (response) => {
      registerAsyncTask(response, ["mikrotik-secrets"]);
      setNewSecret(EMPTY_SECRET_FORM);
      setSecretModalOpen("none");
    },
  });

  const updateSecretMutation = useMutation({
    mutationFn: ({ secretId, payload }: { secretId: string; payload: Partial<MikrotikSecretUpsertPayload> }) =>
      updateMikrotikSecret(deviceId, secretId, payload),
    onSuccess: (response) => {
      registerAsyncTask(response, ["mikrotik-secrets"]);
      setEditingSecretId(null);
      setEditingSecretForm(EMPTY_SECRET_FORM);
      setSecretModalOpen("none");
    },
  });

  const deleteSecretMutation = useMutation({
    mutationFn: (secretId: string) => deleteMikrotikSecret(deviceId, secretId),
    onSuccess: (response) => registerAsyncTask(response, ["mikrotik-secrets"]),
  });

  const createProfileMutation = useMutation({
    mutationFn: (payload: MikrotikProfileUpsertPayload) => createMikrotikProfile(deviceId, payload),
    onSuccess: (response) => {
      registerAsyncTask(response, ["mikrotik-profiles"]);
      setNewProfile(EMPTY_PROFILE_FORM);
      setProfileModalOpen("none");
    },
  });

  const updateProfileMutation = useMutation({
    mutationFn: ({ profileId, payload }: { profileId: string; payload: Partial<MikrotikProfileUpsertPayload> }) =>
      updateMikrotikProfile(deviceId, profileId, payload),
    onSuccess: (response) => {
      registerAsyncTask(response, ["mikrotik-profiles"]);
      setEditingProfileId(null);
      setEditingProfileForm(EMPTY_PROFILE_FORM);
      setProfileModalOpen("none");
    },
  });

  const deleteProfileMutation = useMutation({
    mutationFn: (profileId: string) => deleteMikrotikProfile(deviceId, profileId),
    onSuccess: (response) => registerAsyncTask(response, ["mikrotik-profiles"]),
  });

  const pppInterfaceActionMutation = useMutation({
    mutationFn: (identifier: string) => kickMikrotikPppSession(deviceId, identifier),
    onSuccess: (response) => registerAsyncTask(response, ["mikrotik-ppp-active"]),
  });

  const headerStatus = normalizeStatus(registryDevice?.status);
  const cpuPercent = parsePercent(detailQuery.data?.cpu_load ?? "0%");

  const errorMessage =
    detailQuery.isError
      ? getApiErrorMessage(detailQuery.error)
      : registryQuery.isError
        ? getApiErrorMessage(registryQuery.error)
        : null;

  const secretRows = secretsQuery.data ?? [];
  const profileRows = profilesQuery.data ?? [];
  const pppRows = pppActiveQuery.data ?? [];
  const remotePoolOptions = useMemo(
    () => Array.from(new Set(profileRows.map((profile) => profile["remote-address"]?.trim()).filter((value): value is string => Boolean(value)))),
    [profileRows],
  );
  const normalizedTabSearchTerm = tabSearchTerm.trim().toLowerCase();
  const filteredPppRows = useMemo(
    () => pppRows.filter((session) => matchesSearchTerm([
      session.name,
      session.service,
      session["caller-id"],
      session.address,
      session.uptime,
      session["session-id"],
      session[".id"],
    ], normalizedTabSearchTerm)),
    [normalizedTabSearchTerm, pppRows],
  );
  const filteredSecretRows = useMemo(
    () => secretRows.filter((secret) => matchesSearchTerm([
      secret.name,
      secret.profile,
      secret.service,
      secret["local-address"],
      secret["remote-address"],
      secret.comment,
      secret.disabled,
      secret[".id"],
    ], normalizedTabSearchTerm)),
    [normalizedTabSearchTerm, secretRows],
  );
  const filteredProfileRows = useMemo(
    () => profileRows.filter((profile) => matchesSearchTerm([
      profile.name,
      profile["local-address"],
      profile["remote-address"],
      profile["rate-limit"],
      profile["dns-server"],
      profile.comment,
      profile[".id"],
    ], normalizedTabSearchTerm)),
    [normalizedTabSearchTerm, profileRows],
  );
  const tabCounts = {
    interface: (interfacesQuery.data ?? []).length,
    "ppp-active": pppRows.length,
    secret: secretRows.length,
    profile: profileRows.length,
  } satisfies Record<DetailTab, number>;
  const deviceTitle = detailQuery.data?.identity ?? registryDevice?.name ?? "MikroTik Detail";
  const routerOsLabel = detailQuery.data?.ros_version ?? registryDevice?.ros_version ?? "-";
  const modelLabel = detailQuery.data?.model_type ?? "Router";
  const managementIpLabel = detailQuery.data?.management_ip ?? registryDevice?.host ?? "-";
  const uptimeLabel = detailQuery.data?.uptime ?? "-";
  const registrySyncLabel = formatRegistryTimestamp(registryDevice?.last_sync_at);
  const operationalSummaryItems: Array<{
    label: string;
    value: string;
    valueClassName: string;
    meterPercent?: number;
    meterClassName?: string;
  }> = [
    {
      label: "Management IP",
      value: managementIpLabel,
      valueClassName: "break-all text-[13px] sm:text-[14px]",
      meterPercent: undefined,
      meterClassName: undefined,
    },
    {
      label: "Uptime",
      value: uptimeLabel,
      valueClassName: "font-mono text-[13px] sm:text-[14px]",
      meterPercent: undefined,
      meterClassName: undefined,
    },
    {
      label: "CPU Load",
      value: detailQuery.data?.cpu_load ?? "0%",
      valueClassName: "font-mono text-[13px] sm:text-[14px]",
      meterPercent: cpuPercent,
      meterClassName: cpuPercent > 80 ? "bg-rose-500" : cpuPercent > 60 ? "bg-amber-500" : "bg-sky-600",
    },
    {
      label: "Free Memory",
      value: detailQuery.data?.free_memory ?? "-",
      valueClassName: "font-mono text-[13px] sm:text-[14px]",
      meterPercent: undefined,
      meterClassName: undefined,
    },
  ];
  const activeTabSearchMeta = {
    interface: {
      placeholder: "Search interface name, MAC, type...",
      resultCount: filteredInterfaces.length,
      totalCount: interfaceFilterCounts.all,
      emptyLabel: "No interfaces match this search.",
    },
    "ppp-active": {
      placeholder: "Search PPP name, caller ID, IP...",
      resultCount: filteredPppRows.length,
      totalCount: pppRows.length,
      emptyLabel: "No active PPP sessions match this search.",
    },
    secret: {
      placeholder: "Search secret, profile, remote address...",
      resultCount: filteredSecretRows.length,
      totalCount: secretRows.length,
      emptyLabel: "No PPP secrets match this search.",
    },
    profile: {
      placeholder: "Search profile, pool, rate limit...",
      resultCount: filteredProfileRows.length,
      totalCount: profileRows.length,
      emptyLabel: "No PPP profiles match this search.",
    },
  } satisfies Record<DetailTab, { placeholder: string; resultCount: number; totalCount: number; emptyLabel: string }>;

  if (!deviceId) {
    return <Card><CardContent className="p-6 text-sm text-rose-600">Missing MikroTik device id.</CardContent></Card>;
  }

  const renderSelectedInterfaceContent = () => {
    if (!selectedInterface) {
      return null;
    }

    const liveTraffic = selectedInterfaceTraffic;
    const effectiveSampledAt = liveTraffic?.sampled_at
      || (selectedInterfaceTrafficUpdatedAt ? new Date(selectedInterfaceTrafficUpdatedAt).toISOString() : "");
    const traffic: MikrotikInterfaceTraffic | undefined = liveTraffic && effectiveSampledAt
      ? {
          ...liveTraffic,
          sampled_at: effectiveSampledAt,
        }
      : undefined;
    const status = getInterfaceStatus(selectedInterface);
    const macAddress = getInterfaceMacAddress(selectedInterface);
    const history = interfaceTrafficHistory[selectedInterface.name] ?? [];
    const nextSamples: MikrotikInterfaceTraffic[] = traffic ? [...history, traffic] : history;
    const chartSamples = (history.length > 0 && history[history.length - 1]?.sampled_at === traffic?.sampled_at
      ? history
      : nextSamples
    ).slice(-12);
    const throughputCeiling = Math.max(1, ...chartSamples.flatMap((sample) => [sample.rx_mbps, sample.tx_mbps]));
    const rxLinePoints = buildTrafficLinePoints(chartSamples, "rx_mbps", throughputCeiling);
    const txLinePoints = buildTrafficLinePoints(chartSamples, "tx_mbps", throughputCeiling);
    const rxLinePath = buildTrafficPath(rxLinePoints);
    const txLinePath = buildTrafficPath(txLinePoints);
    const detailRows = [
      ["Name", formatInterfaceValue(selectedInterface.name)],
      ["Type", formatInterfaceValue(selectedInterface.type)],
      ["MAC", formatInterfaceValue(macAddress)],
      ["Status", status.label],
      ["MTU", formatInterfaceValue(selectedInterface.mtu)],
    ];

    return (
      <div className="space-y-4">
        <div className="rounded-[26px] border border-border/70 bg-card/95 p-4 shadow-[0_18px_44px_-34px_rgba(15,23,42,0.28)] sm:p-5">
          <div className="flex flex-col gap-3 border-b border-border/70 pb-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="break-all text-lg font-semibold text-foreground">{selectedInterface.name}</h4>
                <span className="inline-flex rounded-full bg-muted/20 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {formatInterfaceValue(selectedInterface.type)}
                </span>
              </div>
            </div>

            <span className={cn("inline-flex w-fit rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]", status.chipClassName)}>
              {status.label}
            </span>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(16rem,0.95fr)]">
            <div className="rounded-[22px] border border-border/70 bg-card/90 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  <div className="rounded-2xl border border-sky-400/30 bg-sky-500/10 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-700">TX</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{traffic ? formatTrafficCompact(traffic.tx_mbps) : "—"}</p>
                  </div>
                  <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700">RX</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{traffic ? formatTrafficCompact(traffic.rx_mbps) : "—"}</p>
                  </div>
                </div>

                <div className="space-y-1 text-right text-xs text-muted-foreground">
                  <p>TX PPS {traffic ? traffic.tx_pps.toLocaleString() : "—"}</p>
                  <p>RX PPS {traffic ? traffic.rx_pps.toLocaleString() : "—"}</p>
                </div>
              </div>

              <div className="mt-4 rounded-[22px] border border-border bg-muted/10 p-3 sm:p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[11px] font-medium text-muted-foreground">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-orange-500" />
                    TX line
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-blue-500" />
                    RX line
                  </span>
                  <span>Peak {formatTrafficCompact(throughputCeiling)}</span>
                </div>

                <div className="relative h-52 overflow-hidden rounded-[8px] border border-border bg-muted/10">
                  {chartSamples.length === 0 ? null : (
                    <svg
                      aria-label={`Traffic chart for ${selectedInterface.name}`}
                      className="absolute inset-0 h-full w-full"
                      preserveAspectRatio="none"
                      role="img"
                      viewBox="0 0 100 100"
                    >
                      <title>{`Traffic chart for ${selectedInterface.name}`}</title>

                      {[0, 20, 40, 60, 80, 100].map((pos) => (
                        <line key={`h-${pos}`} stroke="rgb(203 213 225)" strokeWidth="0.6" x1="0" x2="100" y1={pos} y2={pos} />
                      ))}
                      {[0, 20, 40, 60, 80, 100].map((pos) => (
                        <line key={`v-${pos}`} stroke="rgb(203 213 225)" strokeWidth="0.6" x1={pos} x2={pos} y1="0" y2="100" />
                      ))}

                      {txLinePath ? (
                        <path
                          d={txLinePath}
                          fill="none"
                          stroke="rgb(249 115 22)"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.6"
                        />
                      ) : null}
                      {rxLinePath ? (
                        <path
                          d={rxLinePath}
                          fill="none"
                          stroke="rgb(59 130 246)"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.6"
                        />
                      ) : null}
                    </svg>
                  )}
                </div>

              </div>
            </div>

            <div className="rounded-[22px] border border-border/70 bg-card/95 p-4">
              <div className="space-y-3">
                {detailRows.map(([label, value]) => (
                  <div className="flex items-start justify-between gap-3 border-b border-border/60 pb-3 last:border-b-0 last:pb-0" key={label}>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
                    <span className="max-w-[68%] break-all text-right text-sm font-medium text-foreground">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderInterfaceTab = () => (
    <div className="overflow-hidden rounded-[28px] border border-border bg-card/95 shadow-[0_20px_52px_-36px_rgba(15,23,42,0.24)]">
      <div className="border-b border-border bg-card/90 px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Interfaces</p>
              <h3 className="mt-1 text-lg font-semibold text-foreground">Live Interface Inventory</h3>
              <p className="mt-1 text-sm text-muted-foreground">Desktop uses a denser table layout, while mobile keeps compact operational cards.</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-semibold text-muted-foreground">
                Showing {filteredInterfaces.length} / {interfaceFilterCounts.all}
              </span>
              <Button
                className="h-9 rounded-full px-4 text-[12px]"
                disabled={interfaceFilter === "all"}
                onClick={() => setInterfaceFilter("all")}
                type="button"
                variant="outline"
              >
                View All
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {([
              ["all", "All", interfaceFilterCounts.all],
              ["ether", "Ether", interfaceFilterCounts.ether],
              ["vlan", "VLAN", interfaceFilterCounts.vlan],
              ["pppoe", "PPPoE", interfaceFilterCounts.pppoe],
            ] as const).map(([key, label, count]) => (
              <button
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-[11px] font-semibold transition-colors",
                  interfaceFilter === key
                    ? "border-sky-900 bg-sky-900 text-white"
                    : "border-border bg-card text-muted-foreground hover:border-border hover:text-foreground",
                )}
                key={key}
                onClick={() => setInterfaceFilter(key)}
                type="button"
              >
                {label} ({count})
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="p-3 sm:p-4">
        {filteredInterfaces.length === 0 ? (
          <div className="rounded-[22px] border border-dashed border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
            No interfaces found for the selected filter.
          </div>
        ) : null}

        {filteredInterfaces.length > 0 ? (
          <>
            <div className="hidden overflow-hidden rounded-[24px] border border-border bg-card lg:block">
              <div className="grid grid-cols-[minmax(0,1.6fr)_0.9fr_1.35fr_1.7fr_0.6fr_0.85fr_0.8fr] gap-4 bg-muted/15 px-6 py-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <span>Name</span>
                <span>Type</span>
                <span>MAC Address</span>
                <span>Traffic (TX/RX)</span>
                <span>MTU</span>
                <span>Status</span>
                <span className="text-right">Actions</span>
              </div>

              <div className="divide-y divide-border/70">
                {filteredInterfaces.map((item) => {
                  const traffic = selectedInterfaceName === item.name ? selectedInterfaceTraffic ?? undefined : undefined;
                  const status = getInterfaceStatus(item);
                  const macAddress = getInterfaceMacAddress(item);
                  const isSelected = selectedInterfaceName === item.name;
                  const statusDotClass = status.label === "Running"
                    ? "bg-emerald-500"
                    : status.label === "Disabled"
                      ? "bg-slate-400"
                      : "bg-amber-500";

                  return (
                    <div className={cn("grid grid-cols-[minmax(0,1.6fr)_0.9fr_1.35fr_1.7fr_0.6fr_0.85fr_0.8fr] gap-4 px-6 py-4 transition-colors", isSelected ? "bg-sky-500/10" : "bg-card hover:bg-muted/10")} key={item[".id"]}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-3">
                          <span className={cn("h-2.5 w-2.5 rounded-full", statusDotClass)} />
                          <div className="min-w-0">
                            <p className="truncate text-base font-semibold text-foreground">{item.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{toOptionalString(item.comment) ?? "No comment"}</p>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center">
                        <span className="inline-flex rounded-lg bg-sky-500/15 px-2.5 py-1 text-[11px] font-semibold uppercase text-sky-300">
                          {formatInterfaceValue(item.type)}
                        </span>
                      </div>

                      <div className="flex items-center">
                        <p className="truncate font-mono text-sm text-muted-foreground">{macAddress}</p>
                      </div>

                      <div className="space-y-2 py-1">
                        <div>
                          <div className="flex items-center justify-between gap-3 text-[11px] font-semibold">
                            <span className="text-sky-800">TX: {traffic ? formatTrafficCompact(traffic.tx_mbps) : "—"}</span>
                            <span className="text-emerald-700">RX: {traffic ? formatTrafficCompact(traffic.rx_mbps) : "—"}</span>
                          </div>
                          <div className="mt-2 h-2 overflow-hidden rounded-full bg-sky-500/10">
                            <div className="flex h-full rounded-full overflow-hidden">
                              <div className="bg-sky-500" style={{ width: `${Math.min((traffic?.tx_mbps ?? 0) * 12, 100)}%` }} />
                              <div className="bg-emerald-400" style={{ width: `${Math.min((traffic?.rx_mbps ?? 0) * 12, 100)}%` }} />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center text-sm font-semibold text-foreground">{formatInterfaceValue(item.mtu)}</div>

                      <div className="flex items-center">
                        <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]", status.chipClassName)}>
                          {status.label}
                        </span>
                      </div>

                      <div className="flex items-center justify-end">
                        <Button className="h-9 px-4 text-[12px]" onClick={() => void openInterfaceMonitor(item.name, item[".id"])} type="button" variant="outline">
                          View
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/10 px-6 py-4 text-sm text-muted-foreground">
                <span>Showing {filteredInterfaces.length} of {interfaceFilterCounts.all} interfaces</span>
                <span>Traffic refreshes every 5s</span>
              </div>
            </div>

            <div className="space-y-3 lg:hidden">
              {filteredInterfaces.map((item) => {
                const traffic = selectedInterfaceName === item.name ? selectedInterfaceTraffic ?? undefined : undefined;
                const status = getInterfaceStatus(item);
                const isRunning = status.label === "Running";
                const subtitle = toOptionalString(item.comment)
                  ?? (traffic
                    ? `Up since ${formatSampledAt(traffic.sampled_at)}`
                    : isRunning
                      ? "View for live traffic"
                      : status.label === "Disabled"
                        ? "Disabled"
                        : "No comment");

                return (
                  <article className="rounded-[24px] border border-border bg-card px-4 py-4 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.18)]" key={item[".id"]}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 gap-3">
                        <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] border", isRunning ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300" : "border-border bg-muted/20 text-muted-foreground")}>
                          <Activity className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="truncate text-[16px] font-semibold text-foreground">{item.name}</h4>
                          <p className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</p>
                        </div>
                      </div>

                      <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]", status.chipClassName)}>
                        {status.label}
                      </span>
                    </div>

                    <div className="mt-4 border-t border-border/60 pt-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">RX Traffic</p>
                          <p className="mt-1 text-xl font-semibold tracking-[-0.02em] text-foreground">{traffic ? formatTrafficCompact(traffic.rx_mbps) : "—"}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">TX Traffic</p>
                          <p className="mt-1 text-xl font-semibold tracking-[-0.02em] text-foreground">{traffic ? formatTrafficCompact(traffic.tx_mbps) : "—"}</p>
                        </div>
                      </div>

                      <div className="mt-4 flex items-center justify-between gap-3">
                        <p className="text-[11px] text-muted-foreground">{formatInterfaceValue(item.type)} · {formatInterfaceValue(item.mtu)}</p>
                        <Button className="h-8 px-3 text-[12px]" onClick={() => void openInterfaceMonitor(item.name, item[".id"])} type="button" variant="outline">
                          View
                        </Button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );

  const renderPppActiveTab = () => (
    <div className="overflow-hidden rounded-[24px] border border-violet-200/40 bg-card/95 shadow-[0_20px_48px_-38px_rgba(76,29,149,0.16)]">
      <div className="border-b border-violet-200/40 bg-card/90 px-4 py-3 sm:px-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-foreground">PPP Active</h3>
          </div>
          <Badge variant="secondary">{filteredPppRows.length} / {pppRows.length}</Badge>
        </div>
      </div>

      <div className="space-y-2 bg-card/80 p-3 sm:p-4">
        {filteredPppRows.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-violet-200/40 bg-card/90 px-4 py-12 text-center text-sm text-muted-foreground">
            {normalizedTabSearchTerm ? activeTabSearchMeta["ppp-active"].emptyLabel : "No active PPP sessions found."}
          </div>
        ) : null}

        {filteredPppRows.map((session: MikrotikPppActiveRow) => {
          const sessionId = session["session-id"] || session[".id"] || session.name || "-";
          const metaItems = [
            ["Caller ID", session["caller-id"] || "-"],
            ["Uptime", session.uptime || "-"],
            ["IP", session.address || "-"],
          ] as const;

          return (
            <div className="rounded-2xl border border-border/70 bg-card/95 px-3 py-2.5 shadow-[0_12px_24px_-24px_rgba(15,23,42,0.24)]" key={sessionId}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex rounded-full bg-violet-500/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-300 dark:text-violet-200">
                      {session.service || "PPP"}
                    </span>
                    <span className="inline-flex rounded-full border border-emerald-300/40 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-300">
                      Active
                    </span>
                  </div>

                  <h4 className="break-all text-[14px] font-semibold leading-tight text-foreground">{session.name || "-"}</h4>

                  <div className="flex flex-wrap gap-1.5">
                    {metaItems.map(([label, value]) => (
                      <div className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-muted/20 px-2.5 py-1.5 text-[11px] text-muted-foreground" key={label}>
                        <span className="font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</span>
                        <span className="break-all font-medium text-foreground">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-24">
                  <Button
                    className="h-8 w-full text-[12px] sm:w-full"
                    disabled={pppInterfaceActionMutation.isPending}
                    onClick={() => void pppInterfaceActionMutation.mutateAsync(session["session-id"] || session.name || sessionId)}
                    variant="outline"
                  >
                    Kick
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderSecretTab = () => (
    <div className="space-y-4">
      <Card>
        <CardHeader className="sticky top-0 z-10 flex flex-col gap-2.5 border-b border-border/80 bg-card/95 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Secret Inventory</CardTitle>
          <Button
            className="w-full sm:w-auto"
            onClick={() => {
              setNewSecret(EMPTY_SECRET_FORM);
              setSecretModalOpen("create");
            }}
            type="button"
          >
            Add Secret
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {filteredSecretRows.length === 0 ? <p className="text-sm text-muted-foreground">{normalizedTabSearchTerm ? activeTabSearchMeta.secret.emptyLabel : "No PPP secrets found."}</p> : null}
          {filteredSecretRows.map((secret: MikrotikSecretRow) => {
            const secretId = secret[".id"] || secret.name;
            const metaItems = [
              ["Profile", secret.profile || "-"],
              ["Service", secret.service || "-"],
              ["Local", secret["local-address"] || "-"],
              ["Remote", secret["remote-address"] || "-"],
            ] as const;

            return (
              <div className="rounded-2xl border border-border/80 p-3" key={secretId}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <h4 className="truncate text-[15px] font-semibold text-foreground">{secret.name}</h4>
                      <Badge variant={isTruthy(secret.disabled) ? "secondary" : "success"}>{isTruthy(secret.disabled) ? "Disabled" : "Enabled"}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {metaItems.map(([label, value]) => (
                        <div className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-muted/20 px-2.5 py-1.5 text-[11px] text-muted-foreground" key={label}>
                          <span className="font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</span>
                          <span className="break-all font-medium text-foreground">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-row gap-2 sm:w-auto">
                    <Button
                      className="h-8 w-full text-[12px] sm:w-24"
                      onClick={() => {
                        setEditingSecretId(secretId);
                        setEditingSecretForm({
                          name: secret.name,
                          password: secret.password ?? "",
                          profile: secret.profile ?? "",
                          service: secret.service ?? "",
                          local_address: secret["local-address"] ?? "",
                          remote_address: secret["remote-address"] ?? "",
                          comment: secret.comment ?? "",
                          disabled: isTruthy(secret.disabled),
                        });
                        setSecretModalOpen("edit");
                      }}
                      variant="outline"
                    >
                      Edit
                    </Button>
                    <Button
                      className="h-8 w-full border-rose-200 text-[12px] text-rose-600 hover:bg-rose-50 sm:w-24"
                      disabled={deleteSecretMutation.isPending}
                      onClick={() => void deleteSecretMutation.mutateAsync(secretId)}
                      variant="outline"
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );

  const renderProfileTab = () => (
    <div className="space-y-4">
      <Card>
        <CardHeader className="sticky top-0 z-10 flex flex-col gap-2.5 border-b border-border/80 bg-card/95 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Profile Inventory</CardTitle>
          <Button
            className="w-full sm:w-auto"
            onClick={() => {
              setNewProfile(EMPTY_PROFILE_FORM);
              setProfileModalOpen("create");
            }}
            type="button"
          >
            Add Profile
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {filteredProfileRows.length === 0 ? <p className="text-sm text-muted-foreground">{normalizedTabSearchTerm ? activeTabSearchMeta.profile.emptyLabel : "No PPP profiles found."}</p> : null}
          {filteredProfileRows.map((profile: MikrotikProfileRow) => {
            const profileId = profile[".id"] || profile.name;
            const metaItems = [
              ["Local", profile["local-address"] || "-"],
              ["Pool", profile["remote-address"] || "-"],
              ["Rate", profile["rate-limit"] || "-"],
              ["DNS", profile["dns-server"] || "-"],
            ] as const;

            return (
              <div className="rounded-2xl border border-border/80 p-3" key={profileId}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <h4 className="truncate text-[15px] font-semibold text-foreground">{profile.name}</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {metaItems.map(([label, value]) => (
                        <div className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-muted/20 px-2.5 py-1.5 text-[11px] text-muted-foreground" key={label}>
                          <span className="font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</span>
                          <span className="break-all font-medium text-foreground">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-row gap-2 sm:w-auto">
                    <Button
                      className="h-8 w-full text-[12px] sm:w-24"
                      onClick={() => {
                        setEditingProfileId(profileId);
                        setEditingProfileForm({
                          name: profile.name,
                          local_address: profile["local-address"] ?? "",
                          remote_pool: profile["remote-address"] ?? "",
                          rate_limit: profile["rate-limit"] ?? "",
                          dns_server: profile["dns-server"] ?? "",
                          only_one: isTruthy(profile["only-one"]),
                          change_tcp_mss: isTruthy(profile["change-tcp-mss"]),
                          comment: profile.comment ?? "",
                        });
                        setProfileModalOpen("edit");
                      }}
                      variant="outline"
                    >
                      Edit
                    </Button>
                    <Button
                      className="h-8 w-full border-rose-200 text-[12px] text-rose-600 hover:bg-rose-50 sm:w-24"
                      disabled={deleteProfileMutation.isPending}
                      onClick={() => void deleteProfileMutation.mutateAsync(profileId)}
                      variant="outline"
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );

  const renderTabRail = () => (
      <div className="space-y-1.5 rounded-[20px] border border-border bg-card/95 p-1 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.22)] backdrop-blur">
      <div className="grid grid-cols-4 gap-1.5">
        {TAB_ITEMS.map((tab) => (
          <button
            className={cn(
              "flex min-h-[72px] min-w-0 flex-col items-start justify-between gap-2 rounded-[16px] px-2.5 py-2.5 text-left transition-all sm:min-h-0 sm:flex-row sm:items-center sm:justify-between sm:px-3",
              activeTab === tab.key
                ? "bg-sky-600 text-white ring-1 ring-inset ring-sky-500 shadow-[0_18px_32px_-24px_rgba(2,132,199,0.95)]"
                : "bg-card/80 text-muted-foreground ring-1 ring-inset ring-border/80 hover:bg-muted/20 hover:text-foreground hover:ring-border",
            )}
            key={tab.key}
            onClick={() => {
              setActiveTab(tab.key);
              setTabSearchTerm("");
            }}
            type="button"
          >
            <span className="text-[12px] font-semibold leading-tight text-inherit sm:text-sm">{tab.label}</span>
                <span className={cn("inline-flex min-w-8 items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold", activeTab === tab.key ? "bg-white/20 text-white" : "bg-muted/20 text-muted-foreground")}>
              {tabCounts[tab.key]}
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 rounded-[16px] border border-border/80 bg-muted/10 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative block w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={`${activeTab} search`}
            className="h-9 rounded-full border-border bg-background pl-9 pr-3 text-[13px] shadow-none"
            onChange={(event) => setTabSearchTerm(event.target.value)}
            placeholder={activeTabSearchMeta[activeTab].placeholder}
            type="search"
            value={tabSearchTerm}
          />
        </div>

        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <span className="text-[11px] font-medium text-muted-foreground">
            Showing {activeTabSearchMeta[activeTab].resultCount} / {activeTabSearchMeta[activeTab].totalCount}
          </span>
          {tabSearchTerm ? (
            <Button className="h-8 rounded-full px-3 text-[12px]" onClick={() => setTabSearchTerm("")} type="button" variant="outline">
              Clear
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-border bg-card/95 shadow-[0_26px_64px_-46px_rgba(15,23,42,0.26)]">
        <div className="space-y-3 p-4 sm:p-5">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(18rem,0.95fr)] xl:items-start">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex rounded-full border border-sky-400/30 bg-sky-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-300">
                  MikroTik detail
                </span>
                <span className="inline-flex rounded-full border border-border bg-card/90 px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
                  Live operator view
                </span>
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 className="break-words text-[1.65rem] font-semibold tracking-[-0.03em] text-foreground sm:text-[2rem]">{deviceTitle}</h2>
                  <Badge variant={getStatusVariant(headerStatus)}>{headerStatus}</Badge>
                </div>

                <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground sm:text-xs">
                  <span className="rounded-full border border-border bg-card/90 px-2.5 py-1 font-medium text-foreground">{modelLabel}</span>
                  <span className="rounded-full border border-border bg-card/90 px-2.5 py-1 font-medium text-foreground">RouterOS {routerOsLabel}</span>
                  <span className="rounded-full border border-border bg-card/90 px-2.5 py-1 font-medium text-foreground">Identity {registryDevice?.name ?? deviceTitle}</span>
                </div>
              </div>
            </div>

            <div className="rounded-[22px] border border-border bg-card/92 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between xl:flex-col xl:items-stretch">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Registry sync</span>
                    <span className={cn(
                      "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
                      registryDevice?.last_error
                        ? "border-rose-400/30 bg-rose-500/10 text-rose-300"
                        : "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
                    )}>
                      {registryDevice?.last_error ? "Needs attention" : "Ready"}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-foreground">{registrySyncLabel}</p>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {registryDevice?.last_error ? registryDevice.last_error : "Registry access is ready for live actions and polling."}
                  </p>
                </div>

                <Button className="h-9 w-full border-border bg-primary px-4 text-[12px] text-primary-foreground hover:bg-primary/90 sm:w-auto xl:w-full" onClick={() => setShowSettings((current) => !current)} variant="outline">
                  <Settings2 className="mr-2 h-4 w-4" />
                  {showSettings ? "Close settings" : "Open settings"}
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {operationalSummaryItems.map((item) => (
              <div className="rounded-[18px] border border-border bg-card/88 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]" key={item.label}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{item.label}</p>
                  {item.meterPercent !== undefined ? <span className="text-[11px] font-semibold text-muted-foreground">{item.meterPercent}%</span> : null}
                </div>
                <p className={cn("mt-1.5 font-semibold text-foreground", item.valueClassName)}>{item.value}</p>
                {item.meterPercent !== undefined ? (
                  <div className="mt-2 h-1.5 rounded-full bg-muted/20">
                    <div className={cn("h-1.5 rounded-full transition-all", item.meterClassName)} style={{ width: `${item.meterPercent}%` }} />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      {pendingTask ? (
        <Card>
          <CardContent className="flex flex-col gap-2 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-foreground">{pendingTask.message}</p>
              <p className="text-muted-foreground">Task {pendingTask.taskId}</p>
            </div>
            <Badge variant={taskStatusQuery.data?.status === "failed" ? "destructive" : taskStatusQuery.data?.status === "success" ? "success" : "secondary"}>
              {taskStatusQuery.data?.status ?? "queued"}
            </Badge>
          </CardContent>
        </Card>
      ) : null}

      {errorMessage ? (
        <Card>
          <CardContent className="p-6 text-sm text-rose-600">{errorMessage}</CardContent>
        </Card>
      ) : null}

      {showSettings ? (
        <Card>
          <CardHeader>
            <CardTitle>Device Settings</CardTitle>
            <CardDescription>Update registry connection settings for this router.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                void settingsMutation.mutateAsync({
                  name: toOptionalString(settingsForm.name),
                  host: toOptionalString(settingsForm.host),
                  port: settingsForm.port,
                  username: toOptionalString(settingsForm.username),
                  password: toOptionalString(settingsForm.password),
                  site: toOptionalString(settingsForm.site),
                  tags: settingsForm.tags?.filter(Boolean),
                });
              }}
            >
              <Input placeholder="Name" value={settingsForm.name ?? ""} onChange={(event) => setSettingsForm({ ...settingsForm, name: event.target.value })} />
              <Input placeholder="Host" value={settingsForm.host ?? ""} onChange={(event) => setSettingsForm({ ...settingsForm, host: event.target.value })} />
              <Input
                placeholder="Port"
                type="number"
                value={settingsForm.port ?? ""}
                onChange={(event) => setSettingsForm({ ...settingsForm, port: Number(event.target.value) })}
              />
              <Input placeholder="Username" value={settingsForm.username ?? ""} onChange={(event) => setSettingsForm({ ...settingsForm, username: event.target.value })} />
              <Input placeholder="Password" type="password" value={settingsForm.password ?? ""} onChange={(event) => setSettingsForm({ ...settingsForm, password: event.target.value })} />
              <Input placeholder="Site" value={settingsForm.site ?? ""} onChange={(event) => setSettingsForm({ ...settingsForm, site: event.target.value })} />
              <Input
                className="xl:col-span-2"
                placeholder="Tags, comma separated"
                value={(settingsForm.tags ?? []).join(", ")}
                onChange={(event) => setSettingsForm({
                  ...settingsForm,
                  tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean),
                })}
              />
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap xl:col-span-2">
                <Button className="w-full sm:w-auto" disabled={settingsMutation.isPending} type="submit">Save settings</Button>
                <Button className="w-full sm:w-auto" onClick={() => setShowSettings(false)} type="button" variant="outline">Close</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {renderTabRail()}

      <div className="max-h-[62vh] overflow-y-auto overscroll-contain pr-1 sm:max-h-[66vh] xl:max-h-[68vh]">
        {activeTab === "interface" ? renderInterfaceTab() : null}
        {activeTab === "ppp-active" ? renderPppActiveTab() : null}
        {activeTab === "secret" ? renderSecretTab() : null}
        {activeTab === "profile" ? renderProfileTab() : null}
      </div>

      <OverlayPanel
        description="Live traffic graph and interface detail shown in a popup so the main list stays compact."
        onClose={() => setSelectedInterfaceName(null)}
        open={Boolean(selectedInterface)}
        panelClassName="max-w-5xl"
        title={selectedInterface ? `Interface · ${selectedInterface.name}` : "Interface Detail"}
      >
        {renderSelectedInterfaceContent()}
      </OverlayPanel>

      <OverlayPanel
        description="Create a new PPP secret in a focused modal instead of an inline form."
        onClose={() => setSecretModalOpen("none")}
        open={secretModalOpen === "create"}
        title="Add PPP Secret"
      >
        <SecretForm
          isPending={createSecretMutation.isPending}
          onChange={setNewSecret}
          profileOptions={profileRows.map((profile) => profile.name)}
          onSubmit={(event) => {
            event.preventDefault();
            void createSecretMutation.mutateAsync(toSecretPayload(newSecret));
          }}
          submitLabel="Add Secret"
          title="New Secret"
          values={newSecret}
        />
      </OverlayPanel>

      <OverlayPanel
        description="Edit the selected PPP secret in a popup editor."
        onClose={() => {
          setEditingSecretId(null);
          setSecretModalOpen("none");
        }}
        open={secretModalOpen === "edit" && Boolean(editingSecretId)}
        title="Edit PPP Secret"
      >
        <SecretForm
          isPending={updateSecretMutation.isPending}
          onCancel={() => {
            setEditingSecretId(null);
            setSecretModalOpen("none");
          }}
          onChange={setEditingSecretForm}
          profileOptions={profileRows.map((profile) => profile.name)}
          onSubmit={(event) => {
            event.preventDefault();
            if (!editingSecretId) {
              return;
            }
            void updateSecretMutation.mutateAsync({
              secretId: editingSecretId,
              payload: toSecretPayload(editingSecretForm),
            });
          }}
          submitLabel="Save Secret"
          title="Secret Editor"
          values={editingSecretForm}
        />
      </OverlayPanel>

      <OverlayPanel
        description="Create a new PPP profile in a focused modal instead of an inline form."
        onClose={() => setProfileModalOpen("none")}
        open={profileModalOpen === "create"}
        title="Add PPP Profile"
      >
        <ProfileForm
          isPending={createProfileMutation.isPending}
          onChange={setNewProfile}
          remotePoolOptions={remotePoolOptions}
          onSubmit={(event) => {
            event.preventDefault();
            void createProfileMutation.mutateAsync(toProfilePayload(newProfile));
          }}
          submitLabel="Add Profile"
          title="New Profile"
          values={newProfile}
        />
      </OverlayPanel>

      <OverlayPanel
        description="Edit the selected PPP profile in a popup editor."
        onClose={() => {
          setEditingProfileId(null);
          setProfileModalOpen("none");
        }}
        open={profileModalOpen === "edit" && Boolean(editingProfileId)}
        title="Edit PPP Profile"
      >
        <ProfileForm
          isPending={updateProfileMutation.isPending}
          onCancel={() => {
            setEditingProfileId(null);
            setProfileModalOpen("none");
          }}
          onChange={setEditingProfileForm}
          remotePoolOptions={remotePoolOptions}
          onSubmit={(event) => {
            event.preventDefault();
            if (!editingProfileId) {
              return;
            }
            void updateProfileMutation.mutateAsync({
              profileId: editingProfileId,
              payload: toProfilePayload(editingProfileForm),
            });
          }}
          submitLabel="Save Profile"
          title="Profile Editor"
          values={editingProfileForm}
        />
      </OverlayPanel>
    </div>
  );
}
