import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Pencil, Plus, Router, Save, Trash2, Wifi } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageSectionHeader } from "@/components/page/section-header";
import { Input } from "@/components/ui/input";
import {
  API_BASE_URL,
  createMikrotikDevice,
  deleteMikrotikDevice,
  getAcsSettings,
  getApiErrorMessage,
  getMikrotikDevices,
  getStoredAuthSession,
  setStoredAuthSession,
  testMikrotikDeviceConnection,
  updateAcsSetting,
  updateMikrotikDevice,
} from "@/lib/api";
import { showToast } from "@/lib/toast";
import type { MikrotikDeviceCreatePayload, MikrotikRegistryDevice } from "@/types/mikrotik";

type SettingsFormState = {
  telegramBotToken: string;
  telegramChatIds: string;
  pluginVendor: string;
  pluginHost: string;
  pluginPort: string;
  pluginUsername: string;
  pluginPassword: string;
  genieacsUrl: string;
  dashboardUsername: string;
};

 type SectionKey = "dashboard" | "telegram" | "plugin" | "genieacs";

type RegistryModalMode = "closed" | "create" | "edit";

type RegistryFormState = {
  name: string;
  host: string;
  port: string;
  username: string;
  password: string;
  site: string;
};

const EMPTY_FORM: SettingsFormState = {
  telegramBotToken: "",
  telegramChatIds: "",
  pluginVendor: "hioso",
  pluginHost: "",
  pluginPort: "3000",
  pluginUsername: "admin",
  pluginPassword: "",
  genieacsUrl: "",
  dashboardUsername: "",
};

const EMPTY_REGISTRY_FORM: RegistryFormState = {
  name: "",
  host: "",
  port: "8728",
  username: "",
  password: "",
  site: "",
};

const SETTING_KEYS: Record<keyof SettingsFormState, string> = {
  telegramBotToken: "telegram_bot_token",
  telegramChatIds: "telegram_chat_ids",
  pluginVendor: "plugin_vendor",
  pluginHost: "plugin_host",
  pluginPort: "plugin_port",
  pluginUsername: "plugin_username",
  pluginPassword: "plugin_password",
  genieacsUrl: "genieacs_url",
  dashboardUsername: "dashboard_display_name",
};

const SECTION_FIELDS: Record<SectionKey, Array<keyof SettingsFormState>> = {
  dashboard: ["dashboardUsername"],
  telegram: ["telegramBotToken", "telegramChatIds"],
  plugin: ["pluginVendor", "pluginHost", "pluginPort", "pluginUsername", "pluginPassword"],
  genieacs: ["genieacsUrl"],
};

function SecretInput({
  inputId,
  label,
  value,
  onChange,
}: {
  inputId: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-muted-foreground" htmlFor={inputId}>{label}</label>
      <div className="relative">
        <Input id={inputId} className="pr-10" type={visible ? "text" : "password"} value={value} onChange={(event) => onChange(event.target.value)} />
        <button className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800" onClick={() => setVisible((current) => !current)} type="button">
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
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

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-background/80 p-3 sm:items-center sm:p-6">
      <button aria-label="Close overlay" className="absolute inset-0" onClick={onClose} type="button" />
      <div className="relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] border border-border bg-card/95 text-card-foreground shadow-2xl sm:rounded-[28px]">
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

function buildRegistryFormFromDevice(device: MikrotikRegistryDevice): RegistryFormState {
  return {
    name: device.name,
    host: device.host,
    port: String(device.port ?? 8728),
    username: device.username,
    password: "",
    site: device.site ?? "",
  };
}

function getRegistryStatusVariant(status?: string): "default" | "success" | "destructive" | "secondary" {
  const normalized = status?.toLowerCase();
  if (normalized === "online") {
    return "success";
  }
  if (normalized === "offline") {
    return "destructive";
  }
  return "secondary";
}

export default function Settings() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SettingsFormState>(EMPTY_FORM);
  const [registryModalMode, setRegistryModalMode] = useState<RegistryModalMode>("closed");
  const [registryForm, setRegistryForm] = useState<RegistryFormState>(EMPTY_REGISTRY_FORM);
  const [editingDevice, setEditingDevice] = useState<MikrotikRegistryDevice | null>(null);

  const settingsQuery = useQuery({
    queryKey: ["acs-settings"],
    queryFn: getAcsSettings,
  });

  const mikrotikDevicesQuery = useQuery({
    queryKey: ["mikrotik-devices"],
    queryFn: getMikrotikDevices,
  });

  useEffect(() => {
    if (!settingsQuery.data) {
      return;
    }

    const session = getStoredAuthSession();
    setForm({
      telegramBotToken: settingsQuery.data.telegram_bot_token ?? "",
      telegramChatIds: settingsQuery.data.telegram_chat_ids ?? "",
      pluginVendor: settingsQuery.data.plugin_vendor ?? "hioso",
      pluginHost: settingsQuery.data.plugin_host ?? "",
      pluginPort: settingsQuery.data.plugin_port ?? "3000",
      pluginUsername: settingsQuery.data.plugin_username ?? "admin",
      pluginPassword: settingsQuery.data.plugin_password ?? "",
      genieacsUrl: settingsQuery.data.genieacs_url ?? "",
      dashboardUsername: settingsQuery.data.dashboard_display_name ?? session?.username ?? "",
    });
  }, [settingsQuery.data]);

  const saveSectionMutation = useMutation({
    mutationFn: async ({ section, values }: { section: SectionKey; values: SettingsFormState }) => {
      const fields = SECTION_FIELDS[section];
      await Promise.all(fields.map((field) => updateAcsSetting(SETTING_KEYS[field], values[field])));
      return { section, values };
    },
    onSuccess: async ({ section, values }) => {
      if (section === "dashboard") {
        const session = getStoredAuthSession();
        if (session) {
          setStoredAuthSession({
            ...session,
            username: values.dashboardUsername.trim() || "Admin",
          });
        }
      }

      showToast({
        title: "Section saved",
        description: `${section[0].toUpperCase()}${section.slice(1)} settings updated successfully.`,
        variant: "success",
      });
      await queryClient.invalidateQueries({ queryKey: ["acs-settings"] });
    },
    onError: (error) => {
      showToast({ title: "Failed to save section", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const clearSectionMutation = useMutation({
    mutationFn: async (section: SectionKey) => {
      const nextForm = { ...form };
      for (const field of SECTION_FIELDS[section]) {
        nextForm[field] = field === "pluginVendor"
          ? "hioso"
          : field === "pluginPort"
            ? "3000"
            : field === "pluginUsername"
              ? "admin"
              : "";
      }
      await Promise.all(SECTION_FIELDS[section].map((field) => updateAcsSetting(SETTING_KEYS[field], nextForm[field])));
      return { section, nextForm };
    },
    onSuccess: async ({ section, nextForm }) => {
      setForm(nextForm);
      if (section === "dashboard") {
        const session = getStoredAuthSession();
        if (session) {
          setStoredAuthSession({ ...session, username: "Admin" });
        }
      }
      showToast({ title: "Section cleared", description: `${section[0].toUpperCase()}${section.slice(1)} values were cleared.`, variant: "success" });
      await queryClient.invalidateQueries({ queryKey: ["acs-settings"] });
    },
    onError: (error) => {
      showToast({ title: "Failed to clear section", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const createRegistryDeviceMutation = useMutation({
    mutationFn: async (values: RegistryFormState) => {
      const payload: MikrotikDeviceCreatePayload = {
        name: values.name.trim() || values.host.trim(),
        host: values.host.trim(),
        port: Number(values.port || "8728"),
        username: values.username.trim(),
        password: values.password,
        site: values.site.trim() || undefined,
      };

      if (!payload.name || !payload.host || !payload.username || !payload.password) {
        throw new Error("Name, host, username, and password are required to register a MikroTik device.");
      }

      return createMikrotikDevice(payload);
    },
    onSuccess: async () => {
      showToast({
        title: "MikroTik device added",
        description: "The new router has been registered and will appear on the dashboard.",
        variant: "success",
      });
      setRegistryModalMode("closed");
      setRegistryForm(EMPTY_REGISTRY_FORM);
      setEditingDevice(null);
      await queryClient.invalidateQueries({ queryKey: ["mikrotik-devices"] });
    },
    onError: (error) => {
      showToast({ title: "Failed to add MikroTik device", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const updateRegistryDeviceMutation = useMutation({
    mutationFn: async ({ deviceId, values }: { deviceId: string; values: RegistryFormState }) => {
      const payload = {
        name: values.name.trim() || values.host.trim(),
        host: values.host.trim(),
        port: Number(values.port || "8728"),
        username: values.username.trim(),
        site: values.site.trim() || undefined,
        ...(values.password ? { password: values.password } : {}),
      };

      if (!payload.name || !payload.host || !payload.username) {
        throw new Error("Name, host, and username are required to update a MikroTik device.");
      }

      return updateMikrotikDevice(deviceId, payload);
    },
    onSuccess: async () => {
      showToast({ title: "MikroTik device updated", description: "Registry device settings were saved successfully.", variant: "success" });
      setRegistryModalMode("closed");
      setRegistryForm(EMPTY_REGISTRY_FORM);
      setEditingDevice(null);
      await queryClient.invalidateQueries({ queryKey: ["mikrotik-devices"] });
    },
    onError: (error) => {
      showToast({ title: "Failed to update MikroTik device", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const deleteRegistryDeviceMutation = useMutation({
    mutationFn: (deviceId: string) => deleteMikrotikDevice(deviceId),
    onSuccess: async () => {
      showToast({ title: "MikroTik device deleted", description: "The registry device was removed from the dashboard list.", variant: "success" });
      await queryClient.invalidateQueries({ queryKey: ["mikrotik-devices"] });
    },
    onError: (error) => {
      showToast({ title: "Failed to delete MikroTik device", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const testRegistryDeviceMutation = useMutation({
    mutationFn: async () => {
      if (registryModalMode !== "create" && registryModalMode !== "edit") {
        throw new Error("No registry device available for testing.");
      }

      const host = registryForm.host.trim();
      const username = registryForm.username.trim();
      const password = registryForm.password;
      const port = registryForm.port.trim() || "8728";

      if (registryModalMode === "edit" && editingDevice && !password) {
        const normalizedPort = String(editingDevice.port ?? "8728");
        const connectionMatchesSavedDevice =
          host === editingDevice.host &&
          username === editingDevice.username &&
          port === normalizedPort;

        if (connectionMatchesSavedDevice) {
          return testMikrotikDeviceConnection(editingDevice.id);
        }

        throw new Error("Enter the password to test the revised host, port, or username before saving.");
      }

      if (!host || !username || !password) {
        throw new Error("Host, username, and password are required to test the MikroTik connection.");
      }

      const tempDeviceId = `mtk-registry-test-${Date.now()}`;
      await createMikrotikDevice({
        id: tempDeviceId,
        name: registryForm.name.trim() || host,
        host,
        port: Number(port),
        username,
        password,
        site: registryForm.site.trim() || undefined,
      });

      try {
        return await testMikrotikDeviceConnection(tempDeviceId);
      } finally {
        await deleteMikrotikDevice(tempDeviceId).catch(() => undefined);
      }
    },
    onSuccess: () => {
      showToast({ title: "MikroTik connection OK", description: "Temporary connection test completed successfully.", variant: "success" });
    },
    onError: (error) => {
      showToast({ title: "MikroTik connection failed", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const isMutating = saveSectionMutation.isPending || clearSectionMutation.isPending;
  const isRegistrySubmitting = createRegistryDeviceMutation.isPending || updateRegistryDeviceMutation.isPending;
  const isRegistryTesting = testRegistryDeviceMutation.isPending;
  const openCreateRegistryModal = () => {
    setEditingDevice(null);
    setRegistryForm(EMPTY_REGISTRY_FORM);
    setRegistryModalMode("create");
  };

  const openEditRegistryModal = (device: MikrotikRegistryDevice) => {
    setEditingDevice(device);
    setRegistryForm(buildRegistryFormFromDevice(device));
    setRegistryModalMode("edit");
  };

  const closeRegistryModal = () => {
    setRegistryModalMode("closed");
    setRegistryForm(EMPTY_REGISTRY_FORM);
    setEditingDevice(null);
  };

  const handleRegistrySubmit = () => {
    if (registryModalMode === "edit" && editingDevice) {
      updateRegistryDeviceMutation.mutate({ deviceId: editingDevice.id, values: registryForm });
      return;
    }

    createRegistryDeviceMutation.mutate(registryForm);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground sm:text-3xl">Settings Center</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage Telegram credentials, MikroTik defaults, GenieACS endpoint settings, and dashboard user preferences section by section.
        </p>
      </div>

      {settingsQuery.isError ? (
        <Card>
          <CardContent className="p-6 text-sm text-rose-600">{getApiErrorMessage(settingsQuery.error)}</CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <PageSectionHeader
            title={<CardTitle>Dashboard User</CardTitle>}
            description={<CardDescription>Update the name shown in the topbar and avatar menu.</CardDescription>}
            actions={
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <Button className="w-full sm:w-auto" disabled={isMutating} onClick={() => saveSectionMutation.mutate({ section: "dashboard", values: form })} type="button"><Save className="mr-2 h-4 w-4" />Save</Button>
                <Button className="w-full sm:w-auto" disabled={isMutating} onClick={() => clearSectionMutation.mutate("dashboard")} type="button" variant="outline"><Trash2 className="mr-2 h-4 w-4" />Clear</Button>
              </div>
            }
          />
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="dashboard-username">Dashboard Username</label>
            <Input id="dashboard-username" value={form.dashboardUsername} onChange={(event) => setForm((current) => ({ ...current, dashboardUsername: event.target.value }))} />
          </div>
          <div className="rounded-2xl border border-border/70 bg-muted/10 p-4">
            <p className="text-sm text-muted-foreground">Session storage</p>
            <div className="mt-2 flex items-center gap-2">
              <Badge>localStorage</Badge>
              <Badge variant="secondary">Bearer token</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <PageSectionHeader
            title={<CardTitle>Telegram Bot</CardTitle>}
            description={<CardDescription>Operational bot credentials for notifications and chat-based lookup flows.</CardDescription>}
            actions={
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <Button className="w-full sm:w-auto" disabled={isMutating} onClick={() => saveSectionMutation.mutate({ section: "telegram", values: form })} type="button"><Save className="mr-2 h-4 w-4" />Save</Button>
                <Button className="w-full sm:w-auto" disabled={isMutating} onClick={() => clearSectionMutation.mutate("telegram")} type="button" variant="outline"><Trash2 className="mr-2 h-4 w-4" />Clear</Button>
              </div>
            }
          />
        </CardHeader>
        <CardContent className="grid gap-4 xl:grid-cols-2">
          <SecretInput inputId="telegram-bot-token" label="Bot Token" value={form.telegramBotToken} onChange={(next) => setForm((current) => ({ ...current, telegramBotToken: next }))} />
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="telegram-chat-ids">Allowed Chat IDs</label>
            <Input id="telegram-chat-ids" placeholder="123456789,987654321" value={form.telegramChatIds} onChange={(event) => setForm((current) => ({ ...current, telegramChatIds: event.target.value }))} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <PageSectionHeader
            title={<CardTitle>Plugin</CardTitle>}
            description={<CardDescription>Vendor selection and plugin backend credentials are managed here, so the vendor pages do not need their own login form.</CardDescription>}
            actions={
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <Button className="w-full sm:w-auto" disabled={isMutating} onClick={() => saveSectionMutation.mutate({ section: "plugin", values: form })} type="button"><Save className="mr-2 h-4 w-4" />Save</Button>
                <Button className="w-full sm:w-auto" disabled={isMutating} onClick={() => clearSectionMutation.mutate("plugin")} type="button" variant="outline"><Trash2 className="mr-2 h-4 w-4" />Clear</Button>
              </div>
            }
          />
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="plugin-vendor">Vendor</label>
            <select
              className="h-10 w-full rounded-2xl border border-border bg-background px-3 text-sm text-foreground shadow-sm"
              id="plugin-vendor"
              value={form.pluginVendor}
              onChange={(event) => setForm((current) => ({ ...current, pluginVendor: event.target.value }))}
            >
              <option value="hioso">Hioso</option>
              <option value="zte">ZTE</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="plugin-host">Host / IP</label>
            <Input id="plugin-host" value={form.pluginHost} onChange={(event) => setForm((current) => ({ ...current, pluginHost: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="plugin-port">Port</label>
            <Input id="plugin-port" value={form.pluginPort} onChange={(event) => setForm((current) => ({ ...current, pluginPort: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="plugin-username">Username</label>
            <Input id="plugin-username" value={form.pluginUsername} onChange={(event) => setForm((current) => ({ ...current, pluginUsername: event.target.value }))} />
          </div>
          <SecretInput inputId="plugin-password" label="Password" value={form.pluginPassword} onChange={(next) => setForm((current) => ({ ...current, pluginPassword: next }))} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <PageSectionHeader
            title={<CardTitle>Registered MikroTik Devices</CardTitle>}
            description={<CardDescription>Real routers stored in <code>/mikrotik/devices</code>. Anything added here appears on the dashboard.</CardDescription>}
            actions={
              <Button className="w-full sm:w-auto" onClick={openCreateRegistryModal} type="button"><Plus className="mr-2 h-4 w-4" />Add Router</Button>
            }
          />
        </CardHeader>
        <CardContent className="space-y-4">
          {mikrotikDevicesQuery.isLoading ? (
            <div className="rounded-2xl border border-border/70 bg-muted/10 p-4 text-sm text-muted-foreground">Loading MikroTik registry devices...</div>
          ) : null}

          {mikrotikDevicesQuery.isError ? (
            <div className="rounded-2xl border border-border/70 bg-destructive/10 p-4 text-sm text-destructive">{getApiErrorMessage(mikrotikDevicesQuery.error)}</div>
          ) : null}

          {!mikrotikDevicesQuery.isLoading && !mikrotikDevicesQuery.isError && (mikrotikDevicesQuery.data?.length ?? 0) === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 bg-muted/10 p-6 text-sm text-muted-foreground">
              No MikroTik devices are registered yet. Use <span className="font-semibold text-foreground">Add Router</span> to create one that will appear in the dashboard.
            </div>
          ) : null}

          <div className="grid gap-3 xl:grid-cols-2">
            {(mikrotikDevicesQuery.data ?? []).map((device) => (
              <div className="rounded-2xl border border-border/70 bg-card/95 p-4 shadow-sm" key={device.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Router className="h-4 w-4 text-primary" />
                      <p className="truncate text-base font-semibold text-foreground">{device.name}</p>
                      <Badge variant={getRegistryStatusVariant(device.status)}>{device.status ?? "unknown"}</Badge>
                    </div>
                    <p className="mt-2 break-all text-sm text-muted-foreground">{device.host}:{device.port}</p>
                  </div>
                  <Link
                    className="inline-flex h-8 items-center justify-center rounded-md border border-input bg-background px-3 text-[11px] font-medium text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                    to={`/mikrotik/${device.id}`}
                  >
                    Open
                  </Link>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-muted/10 px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">Username</p>
                    <p className="mt-1 text-sm font-medium text-foreground">{device.username}</p>
                  </div>
                  <div className="rounded-2xl bg-muted/10 px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">Site</p>
                    <p className="mt-1 text-sm font-medium text-foreground">{device.site || "Unassigned"}</p>
                  </div>
                </div>

                {device.last_error ? (
                  <div className="mt-3 rounded-2xl border border-border/70 bg-destructive/10 px-3 py-2 text-xs text-destructive">{device.last_error}</div>
                ) : null}

                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button className="w-full sm:w-auto" onClick={() => openEditRegistryModal(device)} type="button" variant="outline"><Pencil className="mr-2 h-4 w-4" />Edit</Button>
                  <Button className="w-full sm:w-auto" disabled={deleteRegistryDeviceMutation.isPending} onClick={() => deleteRegistryDeviceMutation.mutate(device.id)} type="button" variant="outline"><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <PageSectionHeader
            title={<CardTitle>GenieACS</CardTitle>}
            description={<CardDescription>Backend operational endpoint values. This does not change the frontend API base URL at runtime.</CardDescription>}
            actions={
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <Button className="w-full sm:w-auto" disabled={isMutating} onClick={() => saveSectionMutation.mutate({ section: "genieacs", values: form })} type="button"><Save className="mr-2 h-4 w-4" />Save</Button>
                <Button className="w-full sm:w-auto" disabled={isMutating} onClick={() => clearSectionMutation.mutate("genieacs")} type="button" variant="outline"><Trash2 className="mr-2 h-4 w-4" />Clear</Button>
              </div>
            }
          />
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_240px]">
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="genieacs-url">GenieACS URL</label>
            <Input id="genieacs-url" value={form.genieacsUrl} onChange={(event) => setForm((current) => ({ ...current, genieacsUrl: event.target.value }))} />
          </div>
          <div className="rounded-2xl border border-border/70 bg-muted/10 p-4">
            <p className="text-sm text-muted-foreground">Frontend API Base</p>
            <p className="mt-2 break-all text-sm font-semibold text-foreground">{API_BASE_URL}</p>
          </div>
        </CardContent>
      </Card>

      <OverlayPanel
        description={registryModalMode === "edit"
          ? "Update the saved device that feeds the MikroTik dashboard. Leave password empty to keep the current one."
          : "Create a real MikroTik registry device. Anything saved here will show up on the dashboard."}
        onClose={closeRegistryModal}
        open={registryModalMode !== "closed"}
        title={registryModalMode === "edit" ? `Edit Router · ${editingDevice?.name ?? ""}` : "Add MikroTik Router"}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="registry-name">Router Name</label>
            <Input id="registry-name" value={registryForm.name} onChange={(event) => setRegistryForm((current) => ({ ...current, name: event.target.value }))} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="registry-host">Host / IP</label>
            <Input id="registry-host" value={registryForm.host} onChange={(event) => setRegistryForm((current) => ({ ...current, host: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="registry-port">Port</label>
            <Input id="registry-port" value={registryForm.port} onChange={(event) => setRegistryForm((current) => ({ ...current, port: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="registry-site">Site</label>
            <Input id="registry-site" placeholder="POP A / Branch Office" value={registryForm.site} onChange={(event) => setRegistryForm((current) => ({ ...current, site: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="registry-username">Username</label>
            <Input id="registry-username" value={registryForm.username} onChange={(event) => setRegistryForm((current) => ({ ...current, username: event.target.value }))} />
          </div>
          <SecretInput inputId="registry-password" label={registryModalMode === "edit" ? "Password (optional)" : "Password"} value={registryForm.password} onChange={(next) => setRegistryForm((current) => ({ ...current, password: next }))} />
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button onClick={closeRegistryModal} type="button" variant="outline">Cancel</Button>
          <Button className="w-full sm:w-auto" disabled={isRegistryTesting || isRegistrySubmitting} onClick={() => testRegistryDeviceMutation.mutate()} type="button" variant="outline"><Wifi className="mr-2 h-4 w-4" />{isRegistryTesting ? "Testing..." : "Test connection"}</Button>
          <Button disabled={isRegistrySubmitting} onClick={handleRegistrySubmit} type="button">
            <Save className="mr-2 h-4 w-4" />
            {isRegistrySubmitting ? "Saving..." : registryModalMode === "edit" ? "Save Changes" : "Create Router"}
          </Button>
        </div>
      </OverlayPanel>
    </div>
  );
}
