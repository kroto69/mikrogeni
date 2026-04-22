import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Pencil, Plus, Router, Save, Trash2, UserRoundCog, Wifi } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageSectionHeader } from "@/components/page/section-header";
import { Input } from "@/components/ui/input";
import {
  API_BASE_URL,
  activateHiosoOltProfile,
  createHiosoOltProfile,
  createAcsUser,
  createMikrotikDevice,
  deleteAcsUser,
  deleteHiosoOltProfile,
  deleteMikrotikDevice,
  getAcsUsers,
  getHiosoOltProfiles,
  getAcsSettings,
  getApiErrorMessage,
  getMikrotikDevices,
  getStoredAuthSession,
  setStoredAuthSession,
  updateHiosoOltProfile,
  updateAcsUser,
  testMikrotikDeviceConnection,
  updateAcsSetting,
  updateMikrotikDevice,
  type AcsUser,
  type AcsUserRole,
  type HiosoOltProfile,
} from "@/lib/api";
import { showToast } from "@/lib/toast";
import type { MikrotikDeviceCreatePayload, MikrotikRegistryDevice } from "@/types/mikrotik";

type SettingsFormState = {
  telegramBotToken: string;
  telegramChatIds: string;
  genieacsUrl: string;
  dashboardUsername: string;
};

type SectionKey = "dashboard" | "telegram" | "genieacs";

type RegistryModalMode = "closed" | "create" | "edit";

type UserModalMode = "closed" | "create" | "edit";

type HiosoProfileModalMode = "closed" | "create" | "edit";

type UserFormState = {
  username: string;
  role: AcsUserRole;
  password: string;
};

type RegistryFormState = {
  name: string;
  host: string;
  port: string;
  username: string;
  password: string;
  site: string;
};

type HiosoProfileFormState = {
  name: string;
  snmpHost: string;
  snmpPort: string;
  snmpVersion: string;
  snmpCommunity: string;
  webHost: string;
  webPort: string;
  username: string;
  password: string;
};

const EMPTY_FORM: SettingsFormState = {
  telegramBotToken: "",
  telegramChatIds: "",
  genieacsUrl: "",
  dashboardUsername: "",
};

const EMPTY_USER_FORM: UserFormState = {
  username: "",
  role: "teknisi",
  password: "",
};

const USER_ROLE_OPTIONS: AcsUserRole[] = ["admin", "teknisi"];

const EMPTY_REGISTRY_FORM: RegistryFormState = {
  name: "",
  host: "",
  port: "8728",
  username: "",
  password: "",
  site: "",
};

const EMPTY_HIOSO_PROFILE_FORM: HiosoProfileFormState = {
  name: "",
  snmpHost: "",
  snmpPort: "161",
  snmpVersion: "2c",
  snmpCommunity: "public",
  webHost: "",
  webPort: "80",
  username: "admin",
  password: "",
};

const SETTING_KEYS: Record<keyof SettingsFormState, string> = {
  telegramBotToken: "telegram_bot_token",
  telegramChatIds: "telegram_chat_ids",
  genieacsUrl: "genieacs_url",
  dashboardUsername: "dashboard_display_name",
};

const SECTION_FIELDS: Record<SectionKey, Array<keyof SettingsFormState>> = {
  dashboard: ["dashboardUsername"],
  telegram: ["telegramBotToken", "telegramChatIds"],
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
        <button className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setVisible((current) => !current)} type="button">
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
  useEffect(() => {
    if (!open || typeof window === "undefined") {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = originalOverflow;
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const overlayContent = (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-foreground/35 p-3 sm:p-6">
      <button aria-label="Close overlay" className="absolute inset-0" onClick={onClose} type="button" />
      <div className="relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[28px] border-2 border-border bg-card/95 text-card-foreground shadow-brutal-lg">
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

function getUserRoleVariant(role: AcsUserRole): "default" | "secondary" {
  return role === "admin" ? "default" : "secondary";
}

function readTrimmedSetting(settings: Record<string, string> | undefined, key: string, fallback = "") {
  const value = settings?.[key];
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed === "" ? fallback : trimmed;
}

function formatUserUpdatedAt(user: AcsUser) {
  const rawTimestamp = user.updated_at ?? user.created_at;
  if (!rawTimestamp) {
    return "-";
  }

  const parsed = new Date(rawTimestamp);
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString();
}

function buildHiosoProfileForm(profile: HiosoOltProfile): HiosoProfileFormState {
  return {
    name: profile.name ?? "",
    snmpHost: profile.snmp_host ?? "",
    snmpPort: String(profile.snmp_port ?? 161),
    snmpVersion: profile.snmp_version ?? "2c",
    snmpCommunity: profile.snmp_community ?? "public",
    webHost: profile.web_host ?? "",
    webPort: String(profile.web_port ?? 80),
    username: profile.username ?? "admin",
    password: "",
  };
}

function isHiosoProfileActive(profile: HiosoOltProfile) {
  return Boolean(profile.is_active ?? profile.active);
}

export default function Settings() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SettingsFormState>(EMPTY_FORM);
  const [hiosoProfileModalMode, setHiosoProfileModalMode] = useState<HiosoProfileModalMode>("closed");
  const [hiosoProfileForm, setHiosoProfileForm] = useState<HiosoProfileFormState>(EMPTY_HIOSO_PROFILE_FORM);
  const [editingHiosoProfile, setEditingHiosoProfile] = useState<HiosoOltProfile | null>(null);
  const [registryModalMode, setRegistryModalMode] = useState<RegistryModalMode>("closed");
  const [registryForm, setRegistryForm] = useState<RegistryFormState>(EMPTY_REGISTRY_FORM);
  const [editingDevice, setEditingDevice] = useState<MikrotikRegistryDevice | null>(null);
  const [userModalMode, setUserModalMode] = useState<UserModalMode>("closed");
  const [userForm, setUserForm] = useState<UserFormState>(EMPTY_USER_FORM);
  const [editingUser, setEditingUser] = useState<AcsUser | null>(null);

  const settingsQuery = useQuery({
    queryKey: ["acs-settings"],
    queryFn: getAcsSettings,
  });

  const mikrotikDevicesQuery = useQuery({
    queryKey: ["mikrotik-devices"],
    queryFn: getMikrotikDevices,
  });

  const usersQuery = useQuery({
    queryKey: ["acs-users"],
    queryFn: getAcsUsers,
  });

  const hiosoProfilesQuery = useQuery({
    queryKey: ["hioso-olt-profiles"],
    queryFn: getHiosoOltProfiles,
  });

  useEffect(() => {
    if (!settingsQuery.data) {
      return;
    }

    const session = getStoredAuthSession();
    const dashboardName = readTrimmedSetting(settingsQuery.data, "dashboard_display_name", session?.username ?? "");
    setForm({
      telegramBotToken: readTrimmedSetting(settingsQuery.data, "telegram_bot_token"),
      telegramChatIds: readTrimmedSetting(settingsQuery.data, "telegram_chat_ids"),
      genieacsUrl: readTrimmedSetting(settingsQuery.data, "genieacs_url"),
      dashboardUsername: dashboardName,
    });

    if (session && session.username !== (dashboardName || "Admin")) {
      setStoredAuthSession({ ...session, username: dashboardName || "Admin" });
    }
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
        nextForm[field] = field === "dashboardUsername" ? "Admin" : "";
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

  const createHiosoProfileMutation = useMutation({
    mutationFn: async (values: HiosoProfileFormState) => {
      const payload = {
        name: values.name.trim(),
        snmp_host: values.snmpHost.trim(),
        snmp_port: Number(values.snmpPort || "161"),
        snmp_version: values.snmpVersion.trim() || "2c",
        snmp_community: values.snmpCommunity.trim(),
        web_host: values.webHost.trim(),
        web_port: Number(values.webPort || "80"),
        username: values.username.trim(),
        password: values.password,
      };

      if (!payload.name || !payload.snmp_host || !payload.snmp_community || !payload.web_host || !payload.username || !payload.password) {
        throw new Error("Name, SNMP host/community, WebUI host, username, and password are required.");
      }

      if (!Number.isFinite(payload.snmp_port) || payload.snmp_port <= 0 || !Number.isFinite(payload.web_port) || payload.web_port <= 0) {
        throw new Error("SNMP and WebUI ports must be valid positive numbers.");
      }

      return createHiosoOltProfile(payload);
    },
    onSuccess: async () => {
      showToast({ title: "Hioso profile created", description: "New OLT profile was added.", variant: "success" });
      setHiosoProfileModalMode("closed");
      setEditingHiosoProfile(null);
      setHiosoProfileForm(EMPTY_HIOSO_PROFILE_FORM);
      await queryClient.invalidateQueries({ queryKey: ["hioso-olt-profiles"] });
      await queryClient.invalidateQueries({ queryKey: ["acs-settings"] });
    },
    onError: (error) => {
      showToast({ title: "Failed to create profile", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const updateHiosoProfileMutation = useMutation({
    mutationFn: async ({ profileId, values }: { profileId: string; values: HiosoProfileFormState }) => {
      const payload = {
        name: values.name.trim(),
        snmp_host: values.snmpHost.trim(),
        snmp_port: Number(values.snmpPort || "161"),
        snmp_version: values.snmpVersion.trim() || "2c",
        snmp_community: values.snmpCommunity.trim(),
        web_host: values.webHost.trim(),
        web_port: Number(values.webPort || "80"),
        username: values.username.trim(),
        ...(values.password.trim() ? { password: values.password } : {}),
      };

      if (!payload.name || !payload.snmp_host || !payload.snmp_community || !payload.web_host || !payload.username) {
        throw new Error("Name, SNMP host/community, WebUI host, and username are required.");
      }

      if (!Number.isFinite(payload.snmp_port) || payload.snmp_port <= 0 || !Number.isFinite(payload.web_port) || payload.web_port <= 0) {
        throw new Error("SNMP and WebUI ports must be valid positive numbers.");
      }

      return updateHiosoOltProfile(profileId, payload);
    },
    onSuccess: async () => {
      showToast({ title: "Hioso profile updated", description: "Profile changes were saved.", variant: "success" });
      setHiosoProfileModalMode("closed");
      setEditingHiosoProfile(null);
      setHiosoProfileForm(EMPTY_HIOSO_PROFILE_FORM);
      await queryClient.invalidateQueries({ queryKey: ["hioso-olt-profiles"] });
      await queryClient.invalidateQueries({ queryKey: ["acs-settings"] });
    },
    onError: (error) => {
      showToast({ title: "Failed to update profile", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const deleteHiosoProfileMutation = useMutation({
    mutationFn: (profileId: string) => deleteHiosoOltProfile(profileId),
    onSuccess: async () => {
      showToast({ title: "Hioso profile deleted", description: "Selected profile was removed.", variant: "success" });
      await queryClient.invalidateQueries({ queryKey: ["hioso-olt-profiles"] });
      await queryClient.invalidateQueries({ queryKey: ["acs-settings"] });
    },
    onError: (error) => {
      showToast({ title: "Failed to delete profile", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const activateHiosoProfileMutation = useMutation({
    mutationFn: (profileId: string) => activateHiosoOltProfile(profileId),
    onSuccess: async () => {
      showToast({ title: "Active profile updated", description: "Selected Hioso profile is now active.", variant: "success" });
      await queryClient.invalidateQueries({ queryKey: ["hioso-olt-profiles"] });
      await queryClient.invalidateQueries({ queryKey: ["acs-settings"] });
    },
    onError: (error) => {
      showToast({ title: "Failed to set active profile", description: getApiErrorMessage(error), variant: "error" });
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

  const createUserMutation = useMutation({
    mutationFn: (values: UserFormState) => {
      const username = values.username.trim();
      const password = values.password.trim();

      if (!username || !password) {
        throw new Error("Username and password are required to create a user.");
      }

      return createAcsUser({
        username,
        role: values.role,
        password,
      });
    },
    onSuccess: async () => {
      showToast({ title: "User created", description: "New account was created successfully.", variant: "success" });
      setUserModalMode("closed");
      setUserForm(EMPTY_USER_FORM);
      setEditingUser(null);
      await queryClient.invalidateQueries({ queryKey: ["acs-users"] });
    },
    onError: (error) => {
      showToast({ title: "Failed to create user", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: ({ userId, values }: { userId: number; values: UserFormState }) => {
      const username = values.username.trim();
      if (!username) {
        throw new Error("Username is required to update a user.");
      }

      return updateAcsUser(userId, {
        username,
        role: values.role,
        ...(values.password.trim() ? { password: values.password.trim() } : {}),
      });
    },
    onSuccess: async () => {
      showToast({ title: "User updated", description: "Account changes were saved successfully.", variant: "success" });
      setUserModalMode("closed");
      setUserForm(EMPTY_USER_FORM);
      setEditingUser(null);
      await queryClient.invalidateQueries({ queryKey: ["acs-users"] });
    },
    onError: (error) => {
      showToast({ title: "Failed to update user", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: (userId: number) => deleteAcsUser(userId),
    onSuccess: async () => {
      showToast({ title: "User deleted", description: "Selected account was removed.", variant: "success" });
      await queryClient.invalidateQueries({ queryKey: ["acs-users"] });
    },
    onError: (error) => {
      showToast({ title: "Failed to delete user", description: getApiErrorMessage(error), variant: "error" });
    },
  });

  const isMutating = saveSectionMutation.isPending || clearSectionMutation.isPending;
  const isHiosoProfileSubmitting = createHiosoProfileMutation.isPending || updateHiosoProfileMutation.isPending;
  const isRegistrySubmitting = createRegistryDeviceMutation.isPending || updateRegistryDeviceMutation.isPending;
  const isRegistryTesting = testRegistryDeviceMutation.isPending;
  const isUserSubmitting = createUserMutation.isPending || updateUserMutation.isPending;

  const openCreateHiosoProfileModal = () => {
    setEditingHiosoProfile(null);
    setHiosoProfileForm(EMPTY_HIOSO_PROFILE_FORM);
    setHiosoProfileModalMode("create");
  };

  const openEditHiosoProfileModal = (profile: HiosoOltProfile) => {
    setEditingHiosoProfile(profile);
    setHiosoProfileForm(buildHiosoProfileForm(profile));
    setHiosoProfileModalMode("edit");
  };

  const closeHiosoProfileModal = () => {
    setEditingHiosoProfile(null);
    setHiosoProfileForm(EMPTY_HIOSO_PROFILE_FORM);
    setHiosoProfileModalMode("closed");
  };

  const handleHiosoProfileSubmit = () => {
    if (hiosoProfileModalMode === "edit" && editingHiosoProfile) {
      updateHiosoProfileMutation.mutate({ profileId: String(editingHiosoProfile.id), values: hiosoProfileForm });
      return;
    }

    createHiosoProfileMutation.mutate(hiosoProfileForm);
  };

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

  const openCreateUserModal = () => {
    setEditingUser(null);
    setUserForm(EMPTY_USER_FORM);
    setUserModalMode("create");
  };

  const openEditUserModal = (user: AcsUser) => {
    setEditingUser(user);
    setUserForm({
      username: user.username,
      role: user.role,
      password: "",
    });
    setUserModalMode("edit");
  };

  const closeUserModal = () => {
    setUserModalMode("closed");
    setUserForm(EMPTY_USER_FORM);
    setEditingUser(null);
  };

  const handleUserSubmit = () => {
    if (userModalMode === "edit" && editingUser) {
      updateUserMutation.mutate({ userId: editingUser.id, values: userForm });
      return;
    }

    createUserMutation.mutate(userForm);
  };

  return (
    <div className="route-shell-page route-shell-settings space-y-7">
      <section className="route-shell-panel relative overflow-hidden rounded-[28px] border-2 border-border bg-primary/20 px-5 py-6 shadow-[12px_12px_0_0_hsl(var(--border))] sm:px-7 sm:py-8">
        <div className="pointer-events-none absolute -right-8 top-4 h-24 w-24 rotate-[18deg] border-2 border-border bg-accent/70" />
        <div className="pointer-events-none absolute -bottom-6 left-6 h-12 w-24 -rotate-6 border-2 border-border bg-secondary/80" />
        <div className="relative">
          <h2 className="text-3xl font-black uppercase tracking-[0.04em] text-foreground sm:text-5xl">Settings Center</h2>
          <p className="mt-3 max-w-3xl text-sm font-semibold text-muted-foreground sm:text-base">
            Manage dashboard display identity, app user accounts, Hioso multi-OLT profiles, MikroTik defaults, and GenieACS endpoint settings section by section.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Badge className="bg-secondary text-secondary-foreground">Configuration Core</Badge>
            <Badge variant="secondary">No Logic Changes</Badge>
          </div>
        </div>
      </section>

      {settingsQuery.isError ? (
        <Card className="overflow-hidden border-2 shadow-[10px_10px_0_0_hsl(var(--border))]">
          <CardContent className="p-6 text-sm text-destructive">{getApiErrorMessage(settingsQuery.error)}</CardContent>
        </Card>
      ) : null}

      <Card className="overflow-hidden border-2 shadow-[10px_10px_0_0_hsl(var(--border))]">
        <CardHeader>
          <div className="mb-3 flex items-center gap-2">
            <div className="h-3 w-10 border-2 border-border bg-primary" />
            <div className="h-3 w-6 border-2 border-border bg-accent" />
          </div>
          <PageSectionHeader
            title={<CardTitle className="text-xl sm:text-2xl">Dashboard User</CardTitle>}
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

      <Card className="overflow-hidden border-2 shadow-[10px_10px_0_0_hsl(var(--border))]">
        <CardHeader>
          <div className="mb-3 flex justify-end">
            <div className="h-4 w-12 -rotate-6 border-2 border-border bg-secondary" />
          </div>
          <PageSectionHeader
            title={<CardTitle className="text-xl sm:text-2xl">User Management</CardTitle>}
            description={<CardDescription>Create, edit, and delete app users. Roles are restricted to admin and teknisi only.</CardDescription>}
            actions={(
              <Button className="w-full sm:w-auto" onClick={openCreateUserModal} type="button">
                <Plus className="mr-2 h-4 w-4" />
                Add User
              </Button>
            )}
          />
        </CardHeader>
        <CardContent className="space-y-4">
          {usersQuery.isLoading ? (
            <div className="rounded-2xl border-2 border-border bg-muted/10 p-4 text-sm font-semibold text-muted-foreground shadow-brutal-sm">Loading users...</div>
          ) : null}

          {usersQuery.isError ? (
            <div className="rounded-2xl border-2 border-border bg-destructive/10 p-4 text-sm font-semibold text-destructive shadow-brutal-sm">{getApiErrorMessage(usersQuery.error)}</div>
          ) : null}

          {!usersQuery.isLoading && !usersQuery.isError && (usersQuery.data?.length ?? 0) === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-border bg-muted/10 p-6 text-sm font-semibold text-muted-foreground shadow-brutal-sm">
              No users yet. Use <span className="text-foreground">Add User</span> to create the first account.
            </div>
          ) : null}

          {!usersQuery.isLoading && !usersQuery.isError && (usersQuery.data?.length ?? 0) > 0 ? (
            <>
              <div className="hidden overflow-x-auto rounded-2xl border-2 border-border shadow-brutal-sm md:block">
                <table className="min-w-full text-sm">
                  <thead className="bg-muted/30 text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Username</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="px-4 py-3">Updated</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(usersQuery.data ?? []).map((user) => (
                      <tr className="border-t-2 border-border/80" key={user.id}>
                        <td className="px-4 py-3 font-semibold text-foreground">{user.username}</td>
                        <td className="px-4 py-3"><Badge variant={getUserRoleVariant(user.role)}>{user.role}</Badge></td>
                        <td className="px-4 py-3 text-muted-foreground">{formatUserUpdatedAt(user)}</td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <Button onClick={() => openEditUserModal(user)} size="sm" type="button" variant="outline"><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button>
                            <Button
                              disabled={deleteUserMutation.isPending}
                              onClick={() => {
                                if (!window.confirm(`Delete user ${user.username}?`)) {
                                  return;
                                }
                                deleteUserMutation.mutate(user.id);
                              }}
                              size="sm"
                              type="button"
                              variant="outline"
                            >
                              <Trash2 className="mr-1 h-3.5 w-3.5" />Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-3 md:hidden">
                {(usersQuery.data ?? []).map((user) => (
                  <div className="rounded-2xl border-2 border-border bg-card/95 p-4 shadow-brutal-sm" key={user.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold text-foreground">{user.username}</p>
                        <p className="mt-1 text-xs text-muted-foreground">Updated {formatUserUpdatedAt(user)}</p>
                      </div>
                      <Badge variant={getUserRoleVariant(user.role)}>{user.role}</Badge>
                    </div>
                    <div className="mt-4 flex gap-2">
                      <Button className="flex-1" onClick={() => openEditUserModal(user)} type="button" variant="outline"><Pencil className="mr-2 h-4 w-4" />Edit</Button>
                      <Button
                        className="flex-1"
                        disabled={deleteUserMutation.isPending}
                        onClick={() => {
                          if (!window.confirm(`Delete user ${user.username}?`)) {
                            return;
                          }
                          deleteUserMutation.mutate(user.id);
                        }}
                        type="button"
                        variant="outline"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-2 shadow-[10px_10px_0_0_hsl(var(--border))]">
        <CardHeader>
          <div className="mb-3 flex items-center gap-2">
            <div className="h-3 w-6 border-2 border-border bg-accent" />
            <div className="h-3 w-12 border-2 border-border bg-primary" />
          </div>
          <PageSectionHeader
            title={<CardTitle className="text-xl sm:text-2xl">Telegram Bot</CardTitle>}
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

      <Card className="overflow-hidden border-2 shadow-[10px_10px_0_0_hsl(var(--border))]">
        <CardHeader>
          <div className="mb-3 flex justify-end gap-2">
            <div className="h-3 w-6 rotate-6 border-2 border-border bg-secondary" />
            <div className="h-3 w-10 -rotate-3 border-2 border-border bg-accent" />
          </div>
          <PageSectionHeader
            title={<CardTitle className="text-xl sm:text-2xl">Hioso OLT Profiles</CardTitle>}
            description={<CardDescription>Manage multiple OLT profiles with split SNMP and WebUI credentials, then mark one profile as active.</CardDescription>}
            actions={<Button className="w-full sm:w-auto" onClick={openCreateHiosoProfileModal} type="button"><Plus className="mr-2 h-4 w-4" />Add OLT Profile</Button>}
          />
        </CardHeader>
        <CardContent className="space-y-4">
          {hiosoProfilesQuery.isLoading ? (
            <div className="rounded-2xl border-2 border-border bg-muted/10 p-4 text-sm font-semibold text-muted-foreground shadow-brutal-sm">Loading OLT profiles...</div>
          ) : null}

          {hiosoProfilesQuery.isError ? (
            <div className="rounded-2xl border-2 border-border bg-destructive/10 p-4 text-sm font-semibold text-destructive shadow-brutal-sm">{getApiErrorMessage(hiosoProfilesQuery.error)}</div>
          ) : null}

          {!hiosoProfilesQuery.isLoading && !hiosoProfilesQuery.isError && (hiosoProfilesQuery.data?.length ?? 0) === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-border bg-muted/10 p-6 text-sm font-semibold text-muted-foreground shadow-brutal-sm">
              No Hioso OLT profiles yet. Use <span className="text-foreground">Add OLT Profile</span> to create the first one.
            </div>
          ) : null}

          <div className="grid gap-3 xl:grid-cols-2">
            {(hiosoProfilesQuery.data ?? []).map((profile) => {
              const isActive = isHiosoProfileActive(profile);
              return (
                <div className="rounded-2xl border-2 border-border bg-card/95 p-4 shadow-brutal-sm" key={profile.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-base font-semibold text-foreground">{profile.name || `Profile ${profile.id}`}</p>
                        <Badge variant={isActive ? "success" : "secondary"}>{isActive ? "Active" : "Inactive"}</Badge>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">SNMP {profile.snmp_host}:{profile.snmp_port} · v{profile.snmp_version}</p>
                      <p className="mt-1 text-sm text-muted-foreground">WebUI {profile.web_host}:{profile.web_port}</p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl bg-muted/10 px-3 py-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">SNMP Community</p>
                      <p className="mt-1 break-all text-sm font-medium text-foreground">{profile.snmp_community}</p>
                    </div>
                    <div className="rounded-2xl bg-muted/10 px-3 py-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">WebUI User</p>
                      <p className="mt-1 text-sm font-medium text-foreground">{profile.username}</p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
                    <Button
                      className="w-full sm:w-auto"
                      disabled={isActive || activateHiosoProfileMutation.isPending}
                      onClick={() => activateHiosoProfileMutation.mutate(String(profile.id))}
                      type="button"
                      variant={isActive ? "secondary" : "outline"}
                    >
                      {isActive ? "Active Profile" : "Set Active"}
                    </Button>
                    <Button className="w-full sm:w-auto" onClick={() => openEditHiosoProfileModal(profile)} type="button" variant="outline"><Pencil className="mr-2 h-4 w-4" />Edit</Button>
                    <Button
                      className="w-full sm:w-auto"
                      disabled={deleteHiosoProfileMutation.isPending}
                      onClick={() => {
                        if (!window.confirm(`Delete OLT profile ${profile.name || profile.id}?`)) {
                          return;
                        }
                        deleteHiosoProfileMutation.mutate(String(profile.id));
                      }}
                      type="button"
                      variant="outline"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />Delete
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-2 shadow-[10px_10px_0_0_hsl(var(--border))]">
        <CardHeader>
          <div className="mb-3 flex items-center gap-2">
            <div className="h-3 w-8 border-2 border-border bg-primary" />
            <div className="h-3 w-5 border-2 border-border bg-secondary" />
          </div>
          <PageSectionHeader
            title={<CardTitle className="text-xl sm:text-2xl">Registered MikroTik Devices</CardTitle>}
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
              <div className="rounded-2xl border-2 border-border bg-card/95 p-4 shadow-brutal-sm" key={device.id}>
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
                    className="inline-flex h-8 items-center justify-center rounded-md border-2 border-input bg-background px-3 text-[11px] font-medium text-muted-foreground shadow-brutal-sm transition-colors hover:bg-accent hover:text-accent-foreground"
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

      <Card className="overflow-hidden border-2 shadow-[10px_10px_0_0_hsl(var(--border))]">
        <CardHeader>
          <div className="mb-3 flex justify-end">
            <div className="h-3 w-12 -rotate-2 border-2 border-border bg-accent" />
          </div>
          <PageSectionHeader
            title={<CardTitle className="text-xl sm:text-2xl">GenieACS</CardTitle>}
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
        description={hiosoProfileModalMode === "edit"
          ? "Update OLT profile fields. Leave password empty to keep existing password."
          : "Create a new Hioso OLT profile with split SNMP and WebUI credentials."}
        onClose={closeHiosoProfileModal}
        open={hiosoProfileModalMode !== "closed"}
        title={hiosoProfileModalMode === "edit" ? `Edit OLT Profile · ${editingHiosoProfile?.name ?? ""}` : "Create OLT Profile"}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="hioso-profile-name">Profile Name</label>
            <Input id="hioso-profile-name" value={hiosoProfileForm.name} onChange={(event) => setHiosoProfileForm((current) => ({ ...current, name: event.target.value }))} />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">SNMP</p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="hioso-snmp-host">Host / IP</label>
            <Input id="hioso-snmp-host" value={hiosoProfileForm.snmpHost} onChange={(event) => setHiosoProfileForm((current) => ({ ...current, snmpHost: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="hioso-snmp-port">Port</label>
            <Input id="hioso-snmp-port" value={hiosoProfileForm.snmpPort} onChange={(event) => setHiosoProfileForm((current) => ({ ...current, snmpPort: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="hioso-snmp-version">Version</label>
            <select
              className="h-11 w-full rounded-lg border-2 border-input bg-card px-3 text-sm text-foreground shadow-brutal-sm focus-visible:-translate-x-[1px] focus-visible:-translate-y-[1px] focus-visible:shadow-brutal focus-visible:ring-2 focus-visible:ring-ring"
              id="hioso-snmp-version"
              value={hiosoProfileForm.snmpVersion}
              onChange={(event) => setHiosoProfileForm((current) => ({ ...current, snmpVersion: event.target.value }))}
            >
              <option value="1">v1</option>
              <option value="2c">v2c</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="hioso-snmp-community">Community</label>
            <Input id="hioso-snmp-community" value={hiosoProfileForm.snmpCommunity} onChange={(event) => setHiosoProfileForm((current) => ({ ...current, snmpCommunity: event.target.value }))} />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">WebUI</p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="hioso-web-host">Host / IP</label>
            <Input id="hioso-web-host" value={hiosoProfileForm.webHost} onChange={(event) => setHiosoProfileForm((current) => ({ ...current, webHost: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="hioso-web-port">Port</label>
            <Input id="hioso-web-port" value={hiosoProfileForm.webPort} onChange={(event) => setHiosoProfileForm((current) => ({ ...current, webPort: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="hioso-web-username">Username</label>
            <Input id="hioso-web-username" value={hiosoProfileForm.username} onChange={(event) => setHiosoProfileForm((current) => ({ ...current, username: event.target.value }))} />
          </div>
          <SecretInput
            inputId="hioso-web-password"
            label={hiosoProfileModalMode === "edit" ? "Password (optional)" : "Password"}
            value={hiosoProfileForm.password}
            onChange={(next) => setHiosoProfileForm((current) => ({ ...current, password: next }))}
          />
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button onClick={closeHiosoProfileModal} type="button" variant="outline">Cancel</Button>
          <Button disabled={isHiosoProfileSubmitting} onClick={handleHiosoProfileSubmit} type="button">
            <Save className="mr-2 h-4 w-4" />
            {isHiosoProfileSubmitting ? "Saving..." : hiosoProfileModalMode === "edit" ? "Save Profile" : "Create Profile"}
          </Button>
        </div>
      </OverlayPanel>

      <OverlayPanel
        description={userModalMode === "edit"
          ? "Update username and role. Password is optional and only used if you want to change it."
          : "Create a new user with role admin or teknisi."}
        onClose={closeUserModal}
        open={userModalMode !== "closed"}
        title={userModalMode === "edit" ? `Edit User · ${editingUser?.username ?? ""}` : "Create User"}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="user-username">Username</label>
            <Input id="user-username" value={userForm.username} onChange={(event) => setUserForm((current) => ({ ...current, username: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="user-role">Role</label>
            <select
              className="h-11 w-full rounded-lg border-2 border-input bg-card px-3 text-sm text-foreground shadow-brutal-sm focus-visible:-translate-x-[1px] focus-visible:-translate-y-[1px] focus-visible:shadow-brutal focus-visible:ring-2 focus-visible:ring-ring"
              id="user-role"
              value={userForm.role}
              onChange={(event) => {
                const nextRole = event.target.value as AcsUserRole;
                if (!USER_ROLE_OPTIONS.includes(nextRole)) {
                  return;
                }
                setUserForm((current) => ({ ...current, role: nextRole }));
              }}
            >
              {USER_ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
          </div>
          <SecretInput
            inputId="user-password"
            label={userModalMode === "edit" ? "Password (optional)" : "Password"}
            value={userForm.password}
            onChange={(next) => setUserForm((current) => ({ ...current, password: next }))}
          />
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button onClick={closeUserModal} type="button" variant="outline">Cancel</Button>
          <Button disabled={isUserSubmitting} onClick={handleUserSubmit} type="button">
            <UserRoundCog className="mr-2 h-4 w-4" />
            {isUserSubmitting ? "Saving..." : userModalMode === "edit" ? "Save User" : "Create User"}
          </Button>
        </div>
      </OverlayPanel>

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
