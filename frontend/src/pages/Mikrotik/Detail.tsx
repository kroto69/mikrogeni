import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRole } from "@/hooks/useRole";
import { Eye, EyeOff, MoreHorizontal, Plus, Search, Settings2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
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
import { OnuStatusPill } from "@/components/nms/pastel";
import { pastelCycleBg, pastelCycleMeta } from "@/lib/pastel";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/retroui/Select";
import { Table } from "@/components/retroui/Table";
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
type PppActiveFilterMode = "all" | "latest-uptime" | "ip";

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
  disabled: false,
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

function parsePercent(value: string) {
  const parsed = Number.parseFloat(value.replace("%", ""));
  return Number.isNaN(parsed) ? 0 : Math.max(0, Math.min(parsed, 100));
}

function parseUptimeSeconds(value?: string) {
  const uptime = (value ?? "").toLowerCase();
  const parts = uptime.match(/(\d+)([wdhms])/g) ?? [];

  return parts.reduce((total, part) => {
    const unit = part.slice(-1);
    const amount = Number.parseInt(part.slice(0, -1), 10);
    if (Number.isNaN(amount)) {
      return total;
    }

    if (unit === "w") return total + amount * 604800;
    if (unit === "d") return total + amount * 86400;
    if (unit === "h") return total + amount * 3600;
    if (unit === "m") return total + amount * 60;
    if (unit === "s") return total + amount;
    return total;
  }, 0);
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
    "actual-mac-address"?: string;
    "orig-mac-address"?: string;
    "current-mac-address"?: string;
    "radio-mac"?: string;
    mac_address?: string;
    macAddress?: string;
    orig_mac_address?: string;
    current_mac_address?: string;
    radio_mac?: string;
  };

  const values = [
    raw["mac-address"],
    raw["actual-mac-address"],
    raw["orig-mac-address"],
    raw["current-mac-address"],
    raw["radio-mac"],
    raw.mac_address,
    raw.macAddress,
    raw.orig_mac_address,
    raw.current_mac_address,
    raw.radio_mac,
  ];

  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) {
      return normalized;
    }
  }

  return "-";
}

function getInterfaceSelectionKey(item: Pick<MikrotikInterfaceRow, ".id" | "name">) {
  return item[".id"] || item.name;
}

function getInterfaceStatus(item: MikrotikInterfaceRow) {
  const disabled = isTruthy(item.disabled);
  const running = isTruthy(item.running);

  if (disabled) {
    return {
      label: "Disabled",
      dotClassName: "bg-pastel-grey",
      chipClassName: "rounded-full bg-pastel-lavender px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#131313]",
    };
  }

  if (running) {
    return {
      label: "Up",
      dotClassName: "bg-pastel-mint",
      chipClassName: "rounded-full bg-pastel-mint px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#131313]",
    };
  }

  return {
    label: "Down",
    dotClassName: "bg-pastel-red",
    chipClassName: "rounded-full bg-pastel-red px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#131313]",
  };
}

function getInterfaceNameChipClass(statusLabel: string) {
  if (statusLabel === "Up") {
    return "bg-pastel-mint text-[#131313]";
  }

  if (statusLabel === "Down") {
    return "bg-pastel-red text-[#131313]";
  }

  return "bg-pastel-lavender text-[#131313]";
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
    disabled: values.disabled,
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
  extraActions,
  isPending,
}: {
  title: string;
  values: MikrotikSecretUpsertPayload;
  profileOptions: string[];
  onChange: (next: MikrotikSecretUpsertPayload) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitLabel: string;
  onCancel?: () => void;
  extraActions?: ReactNode;
  isPending: boolean;
}) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={onSubmit}>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="secret-name">Name</label>
            <Input id="secret-name" placeholder="budi01" required value={values.name} onChange={(event) => onChange({ ...values, name: event.target.value })} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="secret-password">Password</label>
            <div className="relative">
              <Input
                id="secret-password"
                className="pr-10"
                placeholder="••••••••"
                type={showPassword ? "text" : "password"}
                value={values.password ?? ""}
                onChange={(event) => onChange({ ...values, password: event.target.value })}
              />
              <button
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPassword((current) => !current)}
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="secret-profile">Profile</label>
          <Select
            value={values.profile ?? undefined}
            onValueChange={(value) => onChange({ ...values, profile: value })}
          >
            <Select.Trigger id="secret-profile" className="h-11 rounded-lg border-2 border-input bg-card px-3 text-sm text-foreground shadow-brutal-sm">
              <Select.Value placeholder="Select Profile" />
            </Select.Trigger>
            <Select.Content>
              {profileOptions.map((profile) => (
                <Select.Item key={profile} value={profile}>
                  {profile}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="secret-service">Service</label>
          <Select
            value={values.service ?? undefined}
            onValueChange={(value) => onChange({ ...values, service: value })}
          >
            <Select.Trigger id="secret-service" className="h-11 rounded-lg border-2 border-input bg-card px-3 text-sm text-foreground shadow-brutal-sm">
              <Select.Value placeholder="Select Service" />
            </Select.Trigger>
            <Select.Content>
              {PPP_SERVICE_OPTIONS.map((service) => (
                <Select.Item key={service} value={service}>
                  {service}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="secret-local-address">Local Address</label>
            <Input id="secret-local-address" placeholder="10.0.0.1" value={values.local_address ?? ""} onChange={(event) => onChange({ ...values, local_address: event.target.value })} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="secret-remote-address">Remote Address</label>
            <Input id="secret-remote-address" placeholder="10.0.0.2" value={values.remote_address ?? ""} onChange={(event) => onChange({ ...values, remote_address: event.target.value })} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="secret-comment">Comment</label>
            <Input id="secret-comment" placeholder="Pelanggan Budi" value={values.comment ?? ""} onChange={(event) => onChange({ ...values, comment: event.target.value })} />
          </div>
          <label className="flex items-center gap-3 text-sm text-muted-foreground xl:col-span-2">
            <input checked={values.disabled ?? false} onChange={(event) => onChange({ ...values, disabled: event.target.checked })} type="checkbox" />
            Disabled
          </label>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap xl:col-span-2">
            <Button className="w-full sm:w-auto" disabled={isPending} type="submit">{submitLabel}</Button>
            {onCancel ? <Button className="w-full sm:w-auto" onClick={onCancel} type="button" variant="outline">Cancel</Button> : null}
            {extraActions}
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
  extraActions,
  isPending,
}: {
  title: string;
  values: MikrotikProfileUpsertPayload;
  remotePoolOptions: string[];
  onChange: (next: MikrotikProfileUpsertPayload) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitLabel: string;
  onCancel?: () => void;
  extraActions?: ReactNode;
  isPending: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={onSubmit}>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="profile-name">Name</label>
            <Input id="profile-name" placeholder="default" required value={values.name} onChange={(event) => onChange({ ...values, name: event.target.value })} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="profile-local-address">Local Address</label>
            <Input id="profile-local-address" placeholder="10.0.0.1" value={values.local_address ?? ""} onChange={(event) => onChange({ ...values, local_address: event.target.value })} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="profile-remote-pool">Remote Pool</label>
          <Select
            value={values.remote_pool ?? undefined}
            onValueChange={(value) => onChange({ ...values, remote_pool: value })}
          >
            <Select.Trigger id="profile-remote-pool" className="h-11 rounded-lg border-2 border-input bg-card px-3 text-sm text-foreground shadow-brutal-sm">
              <Select.Value placeholder="Select Remote Pool" />
            </Select.Trigger>
            <Select.Content>
              {remotePoolOptions.map((option) => (
                <Select.Item key={option} value={option}>{option}</Select.Item>
              ))}
            </Select.Content>
          </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="profile-rate-limit">Rate Limit</label>
            <Input id="profile-rate-limit" placeholder="10M/10M" value={values.rate_limit ?? ""} onChange={(event) => onChange({ ...values, rate_limit: event.target.value })} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="profile-dns">DNS Server</label>
            <Input id="profile-dns" placeholder="8.8.8.8" value={values.dns_server ?? ""} onChange={(event) => onChange({ ...values, dns_server: event.target.value })} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="profile-comment">Comment</label>
            <Input id="profile-comment" placeholder="Paket Home 20 Mbps" value={values.comment ?? ""} onChange={(event) => onChange({ ...values, comment: event.target.value })} />
          </div>
          <label className="flex items-center gap-3 text-sm text-muted-foreground">
            <input checked={values.only_one ?? false} onChange={(event) => onChange({ ...values, only_one: event.target.checked })} type="checkbox" />
            Only one session
          </label>
          <label className="flex items-center gap-3 text-sm text-muted-foreground">
            <input checked={values.change_tcp_mss ?? false} onChange={(event) => onChange({ ...values, change_tcp_mss: event.target.checked })} type="checkbox" />
            Change TCP MSS
          </label>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap xl:col-span-2">
            <Button className="w-full sm:w-auto" disabled={isPending} type="submit">{submitLabel}</Button>
            {onCancel ? <Button className="w-full sm:w-auto" onClick={onCancel} type="button" variant="outline">Cancel</Button> : null}
            {extraActions}
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
  useEffect(() => {
    if (!open || typeof window === "undefined") {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const overlayContent = (
    <div className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-foreground/35 p-3 sm:items-center sm:p-6">
      <button aria-label="Close overlay" className="absolute inset-0" onClick={onClose} type="button" />
      <div aria-modal="true" className={cn("relative z-10 box-border max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100vw-1.5rem)] overflow-x-hidden overflow-y-auto rounded-[28px] border-2 border-border bg-card text-foreground shadow-brutal-lg sm:max-h-[90vh] sm:max-w-3xl", panelClassName)} role="dialog">
        <div className="flex items-start justify-between gap-4 border-b-2 border-border px-5 py-4 sm:px-6">
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

  if (typeof document === "undefined") {
    return overlayContent;
  }

  return createPortal(overlayContent, document.body);
}

export default function MikrotikDetail() {
  const { deviceId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useRole();
  const [activeTab, setActiveTab] = useState<DetailTab>("interface");
  const [tabSearchTerm, setTabSearchTerm] = useState("");
  const [pppActiveFilterMode, setPppActiveFilterMode] = useState<PppActiveFilterMode>("all");
  const [pppActiveIpFilter, setPppActiveIpFilter] = useState("");
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
  const [confirmProfileDelete, setConfirmProfileDelete] = useState(false);
  const [secretModalOpen, setSecretModalOpen] = useState<"none" | "create" | "edit">("none");
  const [profileModalOpen, setProfileModalOpen] = useState<"none" | "create" | "edit">("none");
  const [selectedInterfaceKey, setSelectedInterfaceKey] = useState<string | null>(null);
  const [selectedInterfaceLabel, setSelectedInterfaceLabel] = useState<string | null>(null);
  const [interfaceTrafficHistory, setInterfaceTrafficHistory] = useState<InterfaceTrafficHistory>({});
  const [selectedInterfaceTraffic, setSelectedInterfaceTraffic] = useState<MikrotikInterfaceTraffic | null>(null);
  const [selectedInterfaceTrafficUpdatedAt, setSelectedInterfaceTrafficUpdatedAt] = useState(0);

  const handleBackNavigation = () => {
    const hasBrowserHistory = typeof window !== "undefined" && window.history.length > 1;

    if (hasBrowserHistory) {
      navigate(-1);
      return;
    }

    navigate("/mikrotik");
  };

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
    if (!deviceId || activeTab !== "interface" || !selectedInterfaceKey) {
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
        const sample = await getMikrotikInterfaceTraffic(deviceId, selectedInterfaceKey);
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
  }, [activeTab, deviceId, selectedInterfaceKey]);

  useEffect(() => {
    setInterfaceTrafficHistory((current) => {
      if (!selectedInterfaceKey || !selectedInterfaceTraffic) {
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

      const previous = current[selectedInterfaceKey] ?? [];
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
        [selectedInterfaceKey]: [...previous, normalizedSample].slice(-14),
      };
    });
  }, [selectedInterfaceKey, selectedInterfaceTraffic, selectedInterfaceTrafficUpdatedAt]);

  const openInterfaceMonitor = async (item: MikrotikInterfaceRow) => {
    const interfaceSelectionKey = getInterfaceSelectionKey(item);
    setSelectedInterfaceKey(interfaceSelectionKey);
    setSelectedInterfaceLabel(item.name);

    try {
      const sample = await getMikrotikInterfaceTraffic(deviceId, interfaceSelectionKey);
      setSelectedInterfaceTraffic(sample);
      setSelectedInterfaceTrafficUpdatedAt(Date.now());
    } catch {
      setSelectedInterfaceTraffic(null);
      setSelectedInterfaceTrafficUpdatedAt(0);
    }
  };

  const closeInterfaceMonitor = () => {
    setSelectedInterfaceKey(null);
    setSelectedInterfaceLabel(null);
    setSelectedInterfaceTraffic(null);
    setSelectedInterfaceTrafficUpdatedAt(0);
  };

  const openSecretEditOverlay = (secret: MikrotikSecretRow) => {
    const secretId = secret[".id"] || secret.name;

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
  };

  const closeSecretEditOverlay = () => {
    setEditingSecretId(null);
    setSecretModalOpen("none");
  };

  const openProfileEditOverlay = (profile: MikrotikProfileRow) => {
    const profileId = profile[".id"] || profile.name;

    setEditingProfileId(profileId);
    setEditingProfileForm({
      name: profile.name,
      disabled: isTruthy(profile.disabled),
      local_address: profile["local-address"] ?? "",
      remote_pool: profile["remote-address"] ?? "",
      rate_limit: profile["rate-limit"] ?? "",
      dns_server: profile["dns-server"] ?? "",
      only_one: isTruthy(profile["only-one"]),
      change_tcp_mss: isTruthy(profile["change-tcp-mss"]),
      comment: profile.comment ?? "",
    });
    setConfirmProfileDelete(false);
    setProfileModalOpen("edit");
  };

  const closeProfileEditOverlay = () => {
    setEditingProfileId(null);
    setEditingProfileForm(EMPTY_PROFILE_FORM);
    setConfirmProfileDelete(false);
    setProfileModalOpen("none");
  };

  useEffect(() => {
    if (!selectedInterfaceKey) {
      return;
    }

    const interfaceRows = interfacesQuery.data ?? [];
    const stillExists = interfaceRows.some((item) => getInterfaceSelectionKey(item) === selectedInterfaceKey);
    if (!stillExists) {
      setSelectedInterfaceKey(null);
      setSelectedInterfaceLabel(null);
      setSelectedInterfaceTraffic(null);
      setSelectedInterfaceTrafficUpdatedAt(0);
    }
  }, [interfacesQuery.data, selectedInterfaceKey]);

  const selectedInterface = useMemo(
    () => {
      if (!selectedInterfaceKey) {
        return null;
      }

      return (interfacesQuery.data ?? []).find((item) => getInterfaceSelectionKey(item) === selectedInterfaceKey) ?? null;
    },
    [interfacesQuery.data, selectedInterfaceKey],
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
    onSuccess: (response) => {
      registerAsyncTask(response, ["mikrotik-secrets"]);
      setEditingSecretId(null);
      setEditingSecretForm(EMPTY_SECRET_FORM);
      setSecretModalOpen("none");
    },
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
    onSuccess: (response) => {
      registerAsyncTask(response, ["mikrotik-profiles"]);
      closeProfileEditOverlay();
    },
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
  const normalizedPppActiveIpFilter = pppActiveIpFilter.trim().toLowerCase();
  const filteredPppRows = useMemo(
    () => {
      const searched = pppRows.filter((session) => matchesSearchTerm([
        session.name,
        session.service,
        session["caller-id"],
        session.address,
        session.uptime,
        session["session-id"],
        session[".id"],
      ], normalizedTabSearchTerm));

      const filteredByIp =
        pppActiveFilterMode === "ip" && normalizedPppActiveIpFilter
          ? searched.filter((session) => String(session.address ?? "").toLowerCase().includes(normalizedPppActiveIpFilter))
          : searched;

      if (pppActiveFilterMode === "latest-uptime") {
        return [...filteredByIp].sort((a, b) => parseUptimeSeconds(a.uptime) - parseUptimeSeconds(b.uptime));
      }

      return filteredByIp;
    },
    [normalizedPppActiveIpFilter, normalizedTabSearchTerm, pppActiveFilterMode, pppRows],
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
  const cpuLoadLabel = detailQuery.data?.cpu_load ?? "0%";
  const freeMemoryLabel = detailQuery.data?.free_memory ?? "-";
  const cpuMeterClassName = cpuPercent > 80 ? "bg-pastel-red" : cpuPercent > 60 ? "bg-pastel-yellow" : "bg-pastel-mint";
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
    return <Card><CardContent className="p-6 text-sm text-destructive">Missing MikroTik device id.</CardContent></Card>;
  }

  const renderSelectedInterfaceContent = () => {
    if (!selectedInterface) {
      return (
        <Card>
          <CardContent className="space-y-2 p-5 text-sm">
            <p className="font-semibold text-foreground">Selected interface data is not available right now.</p>
            <p className="text-muted-foreground">This can happen after live sync or filter updates. Close this dialog and open the interface again.</p>
          </CardContent>
        </Card>
      );
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
    const history = interfaceTrafficHistory[selectedInterfaceKey ?? selectedInterface.name] ?? [];
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
      ["Type", formatInterfaceValue(selectedInterface.type)],
      ["MAC", formatInterfaceValue(macAddress)],
      ["MTU", formatInterfaceValue(selectedInterface.mtu)],
    ];

    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className={cn(
            "inline-flex items-center gap-2 rounded-full border-2 px-2.5 py-1",
            getInterfaceNameChipClass(status.label)
          )}>
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground">Interface</span>
            <span className="font-mono text-xs font-semibold">{formatInterfaceValue(selectedInterface.name)}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-border/70 bg-muted/15 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground">TX</p>
            <p className="mt-1 text-sm font-bold text-foreground">{traffic ? formatTrafficCompact(traffic.tx_mbps) : "—"}</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-muted/15 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground">RX</p>
            <p className="mt-1 text-sm font-bold text-foreground">{traffic ? formatTrafficCompact(traffic.rx_mbps) : "—"}</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-muted/15 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground">TX PPS</p>
            <p className="mt-1 text-sm font-bold text-foreground">{traffic ? traffic.tx_pps.toLocaleString() : "—"}</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-muted/15 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground">RX PPS</p>
            <p className="mt-1 text-sm font-bold text-foreground">{traffic ? traffic.rx_pps.toLocaleString() : "—"}</p>
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-card/95 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-medium text-muted-foreground">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-orange-500" />
                TX
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-blue-500" />
                RX
              </span>
            </div>
            <span>Peak {formatTrafficCompact(throughputCeiling)}</span>
          </div>

          <div className="relative h-28 overflow-hidden rounded-lg bg-muted/10">
            {chartSamples.length === 0 ? null : (
              <svg
                aria-label={`Traffic chart for ${selectedInterface.name}`}
                className="absolute inset-0 h-full w-full"
                preserveAspectRatio="none"
                role="img"
                viewBox="0 0 100 100"
              >
                <title>{`Traffic chart for ${selectedInterface.name}`}</title>

                {[0, 25, 50, 75, 100].map((pos) => (
                  <line key={`h-${pos}`} stroke="rgb(203 213 225)" strokeWidth="0.6" x1="0" x2="100" y1={pos} y2={pos} />
                ))}

                {txLinePath ? (
                  <path
                    d={txLinePath}
                    fill="none"
                    stroke="rgb(249 115 22)"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.7"
                  />
                ) : null}
                {rxLinePath ? (
                  <path
                    d={rxLinePath}
                    fill="none"
                    stroke="rgb(59 130 246)"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.7"
                  />
                ) : null}
              </svg>
            )}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          {detailRows.map(([label, value]) => (
            <div className="rounded-lg border border-border/60 bg-card px-3 py-2" key={label}>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground">{label}</span>
              <span className="mt-1 block break-all text-sm font-medium text-foreground">{value}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderInterfaceTab = () => {
    return (
      <div className="overflow-hidden rounded-[20px] bg-card">
        <div className="z-10 border-b border-border/80 bg-card/95 px-4 py-3 backdrop-blur lg:sticky lg:top-0 sm:px-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-base font-semibold text-foreground">Interface</h3>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {([
                ["all", "All", interfaceFilterCounts.all],
                ["ether", "Ether", interfaceFilterCounts.ether],
                ["vlan", "VLAN", interfaceFilterCounts.vlan],
                ["pppoe", "PPPoE", interfaceFilterCounts.pppoe],
              ] as const).map(([key, label, count]) => (
                <button
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors",
                    interfaceFilter === key
                      ? "bg-pastel-mint text-[#131313]"
                      : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
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

        <div className="space-y-2 p-3 sm:p-4">
          {filteredInterfaces.length === 0 ? (
            <div className="rounded-[20px] border border-dashed border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
              No interfaces found for the selected filter.
            </div>
          ) : null}

          {filteredInterfaces.map((item) => {
            const interfaceSelectionKey = getInterfaceSelectionKey(item);
            const status = getInterfaceStatus(item);
            const interfaceCardBg = status.label === "Up" ? "bg-pastel-mint" : status.label === "Down" ? "bg-pastel-red" : "bg-pastel-grey";
            const interfaceMeta = status.label === "Up" ? "text-[#4a5a50]" : status.label === "Down" ? "text-[#6b3a35]" : "text-[#6b6b6b]";
            const commentValue = formatInterfaceValue(item.comment);
            const hasComment = commentValue !== "-";

            return (
              <div key={interfaceSelectionKey}>
                <div className={cn("rounded-[20px] px-4 py-3 sm:hidden", interfaceCardBg)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex max-w-[75%] truncate text-[13px] font-extrabold text-[#131313]">{item.name}</span>
                        <span className={cn("inline-flex rounded-full bg-[#131313] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em]", status.label === "Up" ? "text-pastel-mint" : status.label === "Down" ? "text-pastel-red" : "text-pastel-grey")}>{status.label}</span>
                      </div>
                      <p className={cn("mt-1 truncate text-[11px] font-semibold uppercase tracking-[0.1em]", interfaceMeta)}>Type | {formatInterfaceValue(item.type)}</p>
                      {hasComment ? <p className={cn("mt-0.5 truncate text-[10px]", interfaceMeta)}>{commentValue}</p> : null}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className={cn("font-mono text-[10px]", interfaceMeta)}>MAC {getInterfaceMacAddress(item)}</span>
                    <Button
                      aria-haspopup="dialog"
                      className="h-7 rounded-full border-0 bg-[#131313] px-3 text-[10px] font-bold text-pastel-mint hover:bg-[#131313]/85 hover:text-pastel-mint"
                      onClick={() => void openInterfaceMonitor(item)}
                      type="button"
                      variant="outline"
                    >
                      View
                    </Button>
                  </div>
                </div>

                <div className={cn("hidden rounded-[20px] p-4 sm:block", interfaceCardBg)}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex text-[13px] font-extrabold text-[#131313]">{item.name}</span>
                        <span className={cn("inline-flex rounded-full bg-[#131313] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em]", status.label === "Up" ? "text-pastel-mint" : status.label === "Down" ? "text-pastel-red" : "text-pastel-grey")}>{status.label}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {([
                          ["Type", formatInterfaceValue(item.type)],
                          ["MAC", getInterfaceMacAddress(item)],
                          ["MTU", formatInterfaceValue(item.mtu)],
                        ] as const).map(([label, value]) => (
                          <div className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/60 px-2.5 py-1.5 font-mono text-[11px] text-[#131313]" key={label}>
                            <span className={cn("font-semibold uppercase tracking-[0.1em]", interfaceMeta)}>{label}</span>
                            <span className="break-all font-medium text-[#131313]">{value}</span>
                          </div>
                        ))}
                        {hasComment ? (
                          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/60 px-2.5 py-1.5 font-mono text-[11px] text-[#131313]">
                            <span className={cn("font-semibold uppercase tracking-[0.1em]", interfaceMeta)}>Note</span>
                            <span className="font-medium text-[#131313]">{commentValue}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-24">
                      <Button
                        aria-haspopup="dialog"
                        className="h-8 w-full rounded-full border-0 bg-[#131313] text-[12px] font-bold text-pastel-mint hover:bg-[#131313]/85 hover:text-pastel-mint sm:w-full"
                        onClick={() => void openInterfaceMonitor(item)}
                        type="button"
                        variant="outline"
                      >
                        View
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t border-border/50 px-4 py-2 sm:px-5">
          <span className="text-[11px] font-medium text-muted-foreground">
            Showing {filteredInterfaces.length} of {interfaceFilterCounts.all} interfaces
          </span>
        </div>
      </div>
    );
  };

  const renderPppActiveTab = () => (
    <div className="overflow-hidden rounded-[20px] bg-card">
      <div className="z-10 border-b border-border/80 bg-card/95 px-4 py-3 backdrop-blur lg:sticky lg:top-0 sm:px-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-foreground">PPP Active</h3>
          </div>
          <span className="inline-flex rounded-full bg-pastel-yellow px-3 py-1 font-mono text-[11px] font-bold text-[#131313]">{filteredPppRows.length} / {pppRows.length}</span>
        </div>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Select value={pppActiveFilterMode} onValueChange={(value) => setPppActiveFilterMode(value as PppActiveFilterMode)}>
            <Select.Trigger className="h-9 w-full rounded-lg bg-card px-3 text-xs font-bold uppercase sm:w-[220px]">
              <Select.Value placeholder="Filter mode" />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="all">Semua Session</Select.Item>
              <Select.Item value="latest-uptime">Uptime Terbaru</Select.Item>
              <Select.Item value="ip">Filter by IP</Select.Item>
            </Select.Content>
          </Select>

          {pppActiveFilterMode === "ip" ? (
            <Input
              aria-label="Filter PPP by IP"
              className="h-9 w-full text-xs sm:w-[260px]"
              onChange={(event) => setPppActiveIpFilter(event.target.value)}
              placeholder="Contoh: 10.10.10.2"
              value={pppActiveIpFilter}
            />
          ) : null}
        </div>
      </div>

      <div className="space-y-2 p-3 sm:p-4">
        {filteredPppRows.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
            {normalizedTabSearchTerm ? activeTabSearchMeta["ppp-active"].emptyLabel : "No active PPP sessions found."}
          </div>
        ) : null}

        {filteredPppRows.map((session: MikrotikPppActiveRow) => {
          const sessionId = session[".id"] || session["session-id"] || session.name || "-";
          const metaItems = [
            ["Caller ID", session["caller-id"] || "-"],
            ["Uptime", session.uptime || "-"],
            ["IP", session.address || "-"],
          ] as const;

          return (
            <div key={sessionId}>
              <div className="rounded-[20px] bg-pastel-mint px-4 py-3 sm:hidden">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="inline-flex max-w-[75%] truncate text-[13px] font-extrabold text-[#131313]">{session.name || "-"}</span>
                    <p className="mt-1 truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-[#4a5a50]">Type | {session.service || "PPP"}</p>
                    <p className="mt-1 truncate font-mono text-[11px] text-[#4a5a50]">Caller {session["caller-id"] || "-"} · Uptime {session.uptime || "-"}</p>
                    <p className="mt-1 truncate font-mono text-[11px] text-[#4a5a50]">Remote IP {session.address || "-"}</p>
                  </div>
                  <Button
                    className="h-8 rounded-full border-0 bg-[#131313] px-4 text-[11px] font-bold text-pastel-mint hover:bg-[#131313]/85 hover:text-pastel-mint"
                    disabled={pppInterfaceActionMutation.isPending}
                    onClick={() => void pppInterfaceActionMutation.mutateAsync(session[".id"] || session["session-id"] || session.name || sessionId)}
                    variant="outline"
                  >
                    Kick
                  </Button>
                </div>
              </div>

              <div className="hidden rounded-[20px] bg-pastel-mint px-4 py-3 sm:block">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <span className="inline-flex max-w-fit break-all text-[13px] font-extrabold text-[#131313]">{session.name || "-"}</span>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#4a5a50]">Type | {session.service || "PPP"}</p>

                    <div className="flex flex-wrap gap-1.5">
                      {metaItems.map(([label, value]) => (
                        <div className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/60 px-2.5 py-1.5 font-mono text-[11px] text-[#131313]" key={label}>
                          <span className="font-semibold uppercase tracking-[0.1em] text-[#4a5a50]">{label}</span>
                          <span className="break-all font-medium text-[#131313]">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-24">
                    <Button
                      className="h-8 w-full rounded-full border-0 bg-[#131313] text-[12px] font-bold text-pastel-mint hover:bg-[#131313]/85 hover:text-pastel-mint sm:w-full"
                      disabled={pppInterfaceActionMutation.isPending}
                      onClick={() => void pppInterfaceActionMutation.mutateAsync(session[".id"] || session["session-id"] || session.name || sessionId)}
                      variant="outline"
                    >
                      Kick
                    </Button>
                  </div>
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
        <CardHeader className="z-10 flex flex-col gap-2 border-b border-border/80 bg-card/95 backdrop-blur lg:sticky lg:top-0 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base sm:text-lg">Secret Inventory</CardTitle>
          {can("mikrotik_ppp_write") && (
          <Button
            aria-label="Add Secret"
            className="h-8 w-8 self-start p-0"
            onClick={() => {
              setNewSecret(EMPTY_SECRET_FORM);
              setSecretModalOpen("create");
            }}
            type="button"
          >
            <Plus className="h-4 w-4" />
          </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {filteredSecretRows.length === 0 ? <p className="text-sm text-muted-foreground">{normalizedTabSearchTerm ? activeTabSearchMeta.secret.emptyLabel : "No PPP secrets found."}</p> : null}
          <div className="rounded-2xl border border-border/80">
            <div className="max-h-[62vh] overflow-y-auto overflow-x-hidden lg:hidden">
              <div className="divide-y divide-border/60">
                {filteredSecretRows.map((secret: MikrotikSecretRow) => {
                  const secretId = secret[".id"] || secret.name;
                  const isDisabled = isTruthy(secret.disabled);

                  return (
                    <div className="space-y-2 px-3 py-2.5" key={secretId}>
                      <div className="flex items-start justify-between gap-2">
                        <span className={cn(
                          "inline-flex max-w-[75%] break-all rounded-full px-3 py-1 text-xs font-extrabold",
                          isDisabled
                            ? "bg-pastel-grey text-[#131313]"
                            : "bg-pastel-mint text-[#131313]"
                        )}>
                          {secret.name || "-"}
                        </span>
                        {can("mikrotik_ppp_write") ? (
                          <Button
                            aria-label="Open secret detail"
                            className="h-7 w-7 p-0"
                            onClick={() => openSecretEditOverlay(secret)}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>

                      <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground">
                        {(secret.service || "-")} | {(secret.profile || "-")}
                      </div>

                      <div className="grid gap-1.5 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="min-w-12 text-[10px] font-bold uppercase tracking-[0.12em] text-foreground">Local</span>
                          <span className="break-all text-foreground">{secret["local-address"] || "-"}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="min-w-12 text-[10px] font-bold uppercase tracking-[0.12em] text-foreground">Remote</span>
                          <span className="break-all text-foreground">{secret["remote-address"] || "-"}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="hidden max-h-[62vh] overflow-auto lg:block">
              <Table className="min-w-[760px]">
                <Table.Header className="sticky top-0 z-10 bg-accent/70 backdrop-blur">
                  <Table.Row className="border-b-2 border-border bg-accent/70 hover:bg-accent/70">
                    <Table.Head className="text-[10px] font-black uppercase tracking-[0.12em] text-foreground sm:text-[11px]">Name</Table.Head>
                    <Table.Head className="text-[10px] font-black uppercase tracking-[0.12em] text-foreground sm:text-[11px]">Profile</Table.Head>
                    <Table.Head className="text-[10px] font-black uppercase tracking-[0.12em] text-foreground sm:text-[11px]">Service</Table.Head>
                    <Table.Head className="text-[10px] font-black uppercase tracking-[0.12em] text-foreground sm:text-[11px]">Local</Table.Head>
                    <Table.Head className="text-[10px] font-black uppercase tracking-[0.12em] text-foreground sm:text-[11px]">Remote</Table.Head>
                    {can("mikrotik_ppp_write") ? <Table.Head className="text-right text-[10px] font-black uppercase tracking-[0.12em] text-foreground sm:text-[11px]">Actions</Table.Head> : null}
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {filteredSecretRows.map((secret: MikrotikSecretRow) => {
                    const secretId = secret[".id"] || secret.name;
                    const isDisabled = isTruthy(secret.disabled);

                    return (
                      <Table.Row key={secretId}>
                        <Table.Cell>
                          <span className={cn(
                            "inline-flex break-all rounded-full px-3 py-1 text-xs font-extrabold sm:text-sm",
                            isDisabled
                              ? "bg-pastel-grey text-[#131313]"
                              : "bg-pastel-mint text-[#131313]"
                          )}>
                            {secret.name || "-"}
                          </span>
                        </Table.Cell>
                        <Table.Cell className="break-all text-xs sm:text-sm">{secret.profile || "-"}</Table.Cell>
                        <Table.Cell className="text-xs sm:text-sm">{secret.service || "-"}</Table.Cell>
                        <Table.Cell className="break-all text-xs sm:text-sm">{secret["local-address"] || "-"}</Table.Cell>
                        <Table.Cell className="break-all text-xs sm:text-sm">{secret["remote-address"] || "-"}</Table.Cell>
                        {can("mikrotik_ppp_write") ? (
                          <Table.Cell>
                            <div className="flex justify-end">
                              <Button
                                aria-label="Open secret detail"
                                className="h-8 w-8 p-0"
                                onClick={() => openSecretEditOverlay(secret)}
                                size="sm"
                                type="button"
                                variant="outline"
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </div>
                          </Table.Cell>
                        ) : null}
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderProfileTab = () => (
    <div className="space-y-4">
      <Card>
        <CardHeader className="z-10 flex flex-col gap-2 border-b border-border/80 bg-card/95 backdrop-blur lg:sticky lg:top-0 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base sm:text-lg">Profile Inventory</CardTitle>
          {can("mikrotik_ppp_write") && (
          <Button
            aria-label="Add Profile"
            className="h-8 w-8 self-start p-0"
            onClick={() => {
              setNewProfile(EMPTY_PROFILE_FORM);
              setProfileModalOpen("create");
            }}
            type="button"
          >
            <Plus className="h-4 w-4" />
          </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {filteredProfileRows.length === 0 ? <p className="text-sm text-muted-foreground">{normalizedTabSearchTerm ? activeTabSearchMeta.profile.emptyLabel : "No PPP profiles found."}</p> : null}
          {filteredProfileRows.map((profile: MikrotikProfileRow, profileIndex: number) => {
            const profileId = profile[".id"] || profile.name;
            const metaItems = [
              ["Local", profile["local-address"] || "-"],
              ["Pool", profile["remote-address"] || "-"],
              ["Rate", profile["rate-limit"] || "-"],
              ["DNS", profile["dns-server"] || "-"],
            ] as const;

            return (
              <div key={profileId}>
                <div className={cn("rounded-[20px] px-4 py-3 sm:hidden", pastelCycleBg(profileIndex))}>
                  <div className="min-w-0">
                    <span className="inline-flex max-w-full truncate text-[14px] font-extrabold text-[#131313]">{profile.name}</span>
                    <p className={cn("mt-1 truncate font-mono text-[11px]", pastelCycleMeta(profileIndex))}>Local {profile["local-address"] || "-"} · Pool {profile["remote-address"] || "-"}</p>
                    <p className={cn("mt-1 truncate font-mono text-[11px]", pastelCycleMeta(profileIndex))}>Rate {profile["rate-limit"] || "-"}</p>
                  </div>
                  <div className="mt-2 flex justify-end">
                    {can("mikrotik_ppp_write") ? (
                      <Button
                        aria-label="Profile actions"
                        className="h-8 w-8 rounded-full border-0 bg-[#131313] p-0 text-pastel-mint hover:bg-[#131313]/85 hover:text-pastel-mint"
                        onClick={() => openProfileEditOverlay(profile)}
                        type="button"
                        variant="outline"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className={cn("hidden rounded-[20px] p-4 sm:block", pastelCycleBg(profileIndex))}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <span className="inline-flex max-w-full truncate text-[14px] font-extrabold text-[#131313]">{profile.name}</span>
                      <div className="flex flex-wrap gap-1.5">
                        {metaItems.map(([label, value]) => (
                          <div className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/60 px-2.5 py-1.5 font-mono text-[11px] text-[#131313]" key={label}>
                            <span className={cn("font-semibold uppercase tracking-[0.1em]", pastelCycleMeta(profileIndex))}>{label}</span>
                            <span className="break-all font-medium text-[#131313]">{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex justify-end sm:w-auto">
                      {can("mikrotik_ppp_write") ? (
                        <Button
                          aria-label="Profile actions"
                          className="h-8 w-8 rounded-full border-0 bg-[#131313] p-0 text-pastel-mint hover:bg-[#131313]/85 hover:text-pastel-mint"
                          onClick={() => openProfileEditOverlay(profile)}
                          type="button"
                          variant="outline"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );

  const renderTabRail = () => {
    return (
      <Card className="rounded-[20px] bg-card">
        <CardContent className="space-y-2.5 p-2.5 sm:p-3">
          <div className="overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex min-w-max flex-nowrap gap-2 pr-1">
              {TAB_ITEMS.map((tab) => (
                <button
                  className={cn(
                    "inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors",
                    activeTab === tab.key
                      ? "bg-pastel-mint text-[#131313]"
                      : "bg-muted text-foreground hover:bg-muted/70"
                  )}
                  key={tab.key}
                  onClick={() => {
                    setActiveTab(tab.key);
                    setTabSearchTerm("");
                  }}
                  type="button"
                >
                  <span>{tab.label}</span>
                  <span className={cn(
                    "inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-black tabular-nums",
                    activeTab === tab.key ? "bg-[#131313] text-pastel-mint" : "bg-black/10 text-foreground"
                  )}>
                    {tabCounts[tab.key]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label={`${activeTab} search`}
                className="h-9 w-full pl-9 pr-3"
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
                <Button
                  className="h-8 text-[11px]"
                  onClick={() => setTabSearchTerm("")}
                  type="button"
                  variant="outline"
                >
                  Clear
                </Button>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="route-shell-page route-shell-mikrotik-detail space-y-4">
      <Card className="rounded-[20px] bg-card">
        <CardContent className="space-y-3 p-3 sm:p-3.5">
          <div className="flex items-center justify-between gap-2">
            <Button className="h-8 rounded-full px-3 text-[11px]" onClick={handleBackNavigation} type="button" variant="outline">
              BACK
            </Button>

            <Button className="h-8 border-border bg-primary px-3 text-[11px] text-primary-foreground hover:bg-primary/90" onClick={() => setShowSettings((current) => !current)} variant="outline">
              <Settings2 className="mr-1.5 h-3.5 w-3.5" />
              <span className="sm:hidden">SETTINGS</span>
              <span className="hidden sm:inline">OPEN SETTINGS</span>
            </Button>
          </div>

          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="break-words text-[1.35rem] font-black tracking-[-0.02em] text-foreground sm:text-[1.6rem]">{deviceTitle}</h2>
                <OnuStatusPill
                  className="px-3 py-1.5 text-[11px]"
                  dotClass={headerStatus === "online" ? "bg-pastel-mint" : headerStatus === "offline" || headerStatus === "down" ? "bg-pastel-grey" : "bg-pastel-lavender"}
                  label={headerStatus.toUpperCase()}
                  textClass={headerStatus === "online" ? "text-pastel-mint" : headerStatus === "offline" || headerStatus === "down" ? "text-pastel-grey" : "text-pastel-lavender"}
                />
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-[12px] font-semibold text-foreground">
                <span>Router {modelLabel}</span>
                <span aria-hidden="true" className="text-muted-foreground">·</span>
                <span>RouterOS {routerOsLabel}</span>
                <span aria-hidden="true" className="text-muted-foreground">·</span>
                <span>IP {managementIpLabel}</span>
              </div>
            </div>

            <span className={cn(
              "inline-flex self-start rounded-full bg-[#131313] px-3 py-1.5 font-mono text-[11px] font-bold tracking-[0.04em]",
              registryDevice?.last_error
                ? "text-pastel-red"
                : "text-pastel-mint",
            )}>
              {registryDevice?.last_error ? "Sync needs attention" : `Synced ${registrySyncLabel}`}
            </span>
          </div>

          <div className="mt-1 overflow-x-auto">
            <div className="flex min-w-max items-center gap-2 text-[11px] sm:text-[12px]">
              <span className="font-semibold uppercase tracking-[0.12em] text-foreground">Uptime</span>
              <span className="font-mono font-semibold text-foreground">{uptimeLabel}</span>

              <span aria-hidden="true" className="text-muted-foreground">·</span>

              <span className="font-semibold uppercase tracking-[0.12em] text-foreground">CPU</span>
              <span className="font-mono font-semibold text-foreground">{cpuLoadLabel}</span>
              <div className="h-1.5 w-14 rounded-full bg-muted/25">
                <div className={cn("h-1.5 rounded-full transition-all", cpuMeterClassName)} style={{ width: `${cpuPercent}%` }} />
              </div>

              <span aria-hidden="true" className="text-muted-foreground">·</span>

              <span className="font-semibold uppercase tracking-[0.12em] text-foreground">Memory</span>
              <span className="font-mono font-semibold text-foreground">{freeMemoryLabel}</span>
            </div>
          </div>
        </CardContent>
      </Card>

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
          <CardContent className="p-6 text-sm text-destructive">{errorMessage}</CardContent>
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
                <Button className="w-full sm:w-auto bg-primary hover:bg-primary-hover text-primary-foreground" disabled={settingsMutation.isPending} type="submit">Save settings</Button>
                <Button className="w-full sm:w-auto" onClick={() => setShowSettings(false)} type="button" variant="outline">Close</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {renderTabRail()}

      <div className="pr-1 lg:max-h-[68vh] lg:overflow-y-auto lg:overscroll-contain">
        {activeTab === "interface" ? renderInterfaceTab() : null}
        {activeTab === "ppp-active" ? renderPppActiveTab() : null}
        {activeTab === "secret" ? renderSecretTab() : null}
        {activeTab === "profile" ? renderProfileTab() : null}
      </div>

      <OverlayPanel
        description={selectedInterface ? selectedInterface.name : selectedInterfaceLabel ?? undefined}
        onClose={closeInterfaceMonitor}
        open={Boolean(selectedInterfaceKey)}
        panelClassName="max-w-5xl"
        title="Interface Monitor"
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
        onClose={closeSecretEditOverlay}
        open={secretModalOpen === "edit" && Boolean(editingSecretId)}
        title="Edit PPP Secret"
      >
        <SecretForm
          isPending={updateSecretMutation.isPending}
          onCancel={closeSecretEditOverlay}
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
          extraActions={editingSecretId ? (
            <>
              <Button
                className="w-full sm:w-auto"
                disabled={updateSecretMutation.isPending || deleteSecretMutation.isPending}
                onClick={() => {
                  void updateSecretMutation.mutateAsync({
                    secretId: editingSecretId,
                    payload: { disabled: !editingSecretForm.disabled },
                  });
                }}
                type="button"
                variant="secondary"
              >
                {editingSecretForm.disabled ? "Enable" : "Disable"}
              </Button>
              <Button
                className="w-full sm:w-auto"
                disabled={deleteSecretMutation.isPending || updateSecretMutation.isPending}
                onClick={() => deleteSecretMutation.mutate(editingSecretId)}
                type="button"
                variant="destructive"
              >
                Delete
              </Button>
            </>
          ) : undefined}
          submitLabel="Save Secret"
          title="Secret Editor"
          values={editingSecretForm}
        />
      </OverlayPanel>

      <OverlayPanel
        description="Create a new PPP profile in a focused modal instead of an inline form."
        onClose={closeProfileEditOverlay}
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
        onClose={closeProfileEditOverlay}
        open={profileModalOpen === "edit" && Boolean(editingProfileId)}
        title="Edit PPP Profile"
      >
        <ProfileForm
          isPending={updateProfileMutation.isPending || deleteProfileMutation.isPending}
          onCancel={closeProfileEditOverlay}
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
          extraActions={editingProfileId ? (
            <>
              <Button
                className="w-full sm:w-auto"
                disabled={updateProfileMutation.isPending || deleteProfileMutation.isPending}
                onClick={() => {
                  void updateProfileMutation.mutateAsync({
                    profileId: editingProfileId,
                    payload: { disabled: !editingProfileForm.disabled },
                  });
                }}
                type="button"
                variant="secondary"
              >
                {editingProfileForm.disabled ? "Enable" : "Disable"}
              </Button>
              <Button
                className="w-full sm:w-auto"
                disabled={updateProfileMutation.isPending || deleteProfileMutation.isPending}
                onClick={() => {
                  if (!confirmProfileDelete) {
                    setConfirmProfileDelete(true);
                    return;
                  }
                  deleteProfileMutation.mutate(editingProfileId);
                }}
                type="button"
                variant="destructive"
              >
                {confirmProfileDelete ? "Confirm Delete" : "Delete"}
              </Button>
              {confirmProfileDelete ? (
                <Button
                  className="w-full sm:w-auto"
                  onClick={() => setConfirmProfileDelete(false)}
                  type="button"
                  variant="outline"
                >
                  Cancel Delete
                </Button>
              ) : null}
            </>
          ) : undefined}
        />
      </OverlayPanel>
    </div>
  );
}
