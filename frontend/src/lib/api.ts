import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import type {
  AcsBulkRefreshPayload,
  AcsBulkRefreshResponse,
  AcsDeviceListItem,
  AcsParameterPayload,
  AcsTaskActionResponse,
  AcsWanConfigPayload,
  AcsWifiConfigPayload,
  OnuDeviceDetail,
} from "@/types/onu";
import type {
  MikrotikAsyncActionResponse,
  MikrotikDeviceCreatePayload,
  MikrotikDeviceDetail,
  MikrotikDeviceSettingsPayload,
  MikrotikInterfaceRow,
  MikrotikInterfaceTraffic,
  MikrotikPppActiveRow,
  MikrotikProfileRow,
  MikrotikProfileUpsertPayload,
  MikrotikRegistryDevice,
  MikrotikSecretRow,
  MikrotikSecretUpsertPayload,
} from "@/types/mikrotik";

export type LoginPayload = {
  username: string;
  password: string;
};

export type LoginResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

type ApiErrorResponse = {
  error?: string;
  detail?: string;
};

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  username: string;
};

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "/api";
export const AUTH_STORAGE_KEY = "network-core.auth";
export const AUTH_CHANGE_EVENT = "network-core:auth-change";

const isBrowser = typeof window !== "undefined";

function emitAuthChange() {
  if (isBrowser) {
    window.dispatchEvent(new CustomEvent(AUTH_CHANGE_EVENT));
  }
}

export function getStoredAuthSession(): AuthSession | null {
  if (!isBrowser) {
    return null;
  }

  const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    if (typeof parsed.accessToken !== "string" || parsed.accessToken.length === 0) {
      return null;
    }

    return {
      accessToken: parsed.accessToken,
      refreshToken: typeof parsed.refreshToken === "string" ? parsed.refreshToken : "",
      expiresIn: typeof parsed.expiresIn === "number" ? parsed.expiresIn : 3600,
      username: typeof parsed.username === "string" ? parsed.username : "Admin",
    };
  } catch {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    return null;
  }
}

export function setStoredAuthSession(session: AuthSession) {
  if (!isBrowser) {
    return;
  }

  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  emitAuthChange();
}

export function clearStoredAuthSession() {
  if (!isBrowser) {
    return;
  }

  window.localStorage.removeItem(AUTH_STORAGE_KEY);
  emitAuthChange();
}

function attachAuthHeader(config: InternalAxiosRequestConfig) {
  const session = getStoredAuthSession();
  if (session?.accessToken && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return config;
}

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use(attachAuthHeader);

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiErrorResponse>) => {
    if (error.response?.status === 401) {
      clearStoredAuthSession();

      if (isBrowser && window.location.pathname !== "/login") {
        window.location.assign("/login");
      }
    }

    return Promise.reject(error);
  },
);

export async function loginRequest(payload: LoginPayload) {
  const { data } = await api.post<LoginResponse>("/login", payload);
  return data;
}

export async function getAcsDevices() {
  const { data } = await api.get<AcsDeviceListItem[]>("/acs/devices");
  return data;
}

export async function getAcsDeviceDetail(deviceId: string, options?: { activeOnly?: boolean; refreshWait?: boolean }) {
  const { data } = await api.get<OnuDeviceDetail>(`/acs/devices/${deviceId}`, {
    params: {
      ...(options?.activeOnly === false ? { active_only: 0 } : {}),
      ...(options?.refreshWait ? { refresh_wait: 1 } : {}),
    },
  });
  return data;
}

export async function rebootAcsDevice(deviceId: string) {
  const { data } = await api.post<AcsTaskActionResponse>(`/acs/devices/${deviceId}/reboot`);
  return data;
}

export async function configureAcsWifi(deviceId: string, payload: AcsWifiConfigPayload) {
  const { data } = await api.post<AcsTaskActionResponse>(`/acs/devices/${deviceId}/config/wifi`, payload);
  return data;
}

export async function configureAcsWan(deviceId: string, payload: AcsWanConfigPayload) {
  const { data } = await api.post<AcsTaskActionResponse>(`/acs/devices/${deviceId}/config/wan`, payload);
  return data;
}

export async function configureAcsSecurity(deviceId: string, payload: AcsParameterPayload) {
  const { data } = await api.post<AcsTaskActionResponse>(`/acs/devices/${deviceId}/config/security`, payload);
  return data;
}

export async function configureAcsParameters(deviceId: string, payload: AcsParameterPayload) {
  const { data } = await api.post<AcsTaskActionResponse>(`/acs/devices/${deviceId}/config/parameters`, payload);
  return data;
}

export async function refreshAcsDevices(payload: AcsBulkRefreshPayload) {
  const { data } = await api.post<AcsBulkRefreshResponse>("/acs/devices/refresh", payload);
  return data;
}

export async function getAcsSettings() {
  const { data } = await api.get<Record<string, string>>("/acs/settings");
  return data;
}

export async function updateAcsSetting(key: string, value: string) {
  const { data } = await api.post<{ success: boolean; message: string }>("/acs/settings", { key, value });
  return data;
}

export async function getMikrotikDevices() {
  const { data } = await api.get<MikrotikRegistryDevice[]>("/mikrotik/devices");
  return data;
}

export async function getMikrotikDeviceDetail(deviceId: string, options?: { cached?: boolean }) {
  const { data } = await api.get<MikrotikDeviceDetail>(`/mikrotik/devices/${deviceId}`, {
    params: options?.cached ? { cached: 1 } : undefined,
  });
  return data;
}

export async function createMikrotikDevice(payload: MikrotikDeviceCreatePayload) {
  const { data } = await api.post<MikrotikRegistryDevice>("/mikrotik/devices", payload);
  return data;
}

export async function updateMikrotikDevice(deviceId: string, payload: MikrotikDeviceSettingsPayload) {
  const { data } = await api.patch(`/mikrotik/devices/${deviceId}`, payload);
  return data;
}

export async function deleteMikrotikDevice(deviceId: string) {
  const { data } = await api.delete<{ success: boolean; message: string }>(`/mikrotik/devices/${deviceId}`);
  return data;
}

export async function testMikrotikDeviceConnection(deviceId: string) {
  const { data } = await api.post(`/mikrotik/devices/${deviceId}/test-connection`);
  return data;
}

export async function getMikrotikInterfaces(deviceId: string) {
  const { data } = await api.get<MikrotikInterfaceRow[]>(`/mikrotik/devices/${deviceId}/interfaces`);
  return data;
}

export async function getMikrotikInterfaceTraffic(deviceId: string, interfaceId: string) {
  const normalizedInterfaceId = interfaceId.trim().replace(/^<+/, "").replace(/>+$/, "");
  const { data } = await api.get<MikrotikInterfaceTraffic>(`/mikrotik/devices/${deviceId}/interfaces/${normalizedInterfaceId}/traffic`, {
    params: {
      _ts: Date.now(),
    },
  });
  return data;
}

export async function getMikrotikPppActive(deviceId: string) {
  const { data } = await api.get<MikrotikPppActiveRow[]>(`/mikrotik/devices/${deviceId}/ppp/active`);
  return data;
}

export async function kickMikrotikPppSession(deviceId: string, sessionId: string) {
  const { data } = await api.delete<MikrotikAsyncActionResponse>(`/mikrotik/devices/${deviceId}/ppp/active/${encodeURIComponent(sessionId)}`);
  return data;
}

export async function getMikrotikSecrets(deviceId: string) {
  const { data } = await api.get<MikrotikSecretRow[]>(`/mikrotik/devices/${deviceId}/ppp/secrets`);
  return data;
}

export async function createMikrotikSecret(deviceId: string, payload: MikrotikSecretUpsertPayload) {
  const { data } = await api.post<MikrotikAsyncActionResponse>(`/mikrotik/devices/${deviceId}/ppp/secrets`, payload);
  return data;
}

export async function updateMikrotikSecret(deviceId: string, secretId: string, payload: Partial<MikrotikSecretUpsertPayload>) {
  const { data } = await api.patch<MikrotikAsyncActionResponse>(`/mikrotik/devices/${deviceId}/ppp/secrets/${encodeURIComponent(secretId)}`, payload);
  return data;
}

export async function deleteMikrotikSecret(deviceId: string, secretId: string) {
  const { data } = await api.delete<MikrotikAsyncActionResponse>(`/mikrotik/devices/${deviceId}/ppp/secrets/${encodeURIComponent(secretId)}`);
  return data;
}

export async function getMikrotikProfiles(deviceId: string) {
  const { data } = await api.get<MikrotikProfileRow[]>(`/mikrotik/devices/${deviceId}/ppp/profiles`);
  return data;
}

export async function createMikrotikProfile(deviceId: string, payload: MikrotikProfileUpsertPayload) {
  const { data } = await api.post<MikrotikAsyncActionResponse>(`/mikrotik/devices/${deviceId}/ppp/profiles`, payload);
  return data;
}

export async function updateMikrotikProfile(deviceId: string, profileId: string, payload: Partial<MikrotikProfileUpsertPayload>) {
  const { data } = await api.patch<MikrotikAsyncActionResponse>(`/mikrotik/devices/${deviceId}/ppp/profiles/${encodeURIComponent(profileId)}`, payload);
  return data;
}

export async function deleteMikrotikProfile(deviceId: string, profileId: string) {
  const { data } = await api.delete<MikrotikAsyncActionResponse>(`/mikrotik/devices/${deviceId}/ppp/profiles/${encodeURIComponent(profileId)}`);
  return data;
}

export function getApiErrorMessage(error: unknown) {
  if (axios.isAxiosError<ApiErrorResponse>(error)) {
    return error.response?.data?.detail ?? error.response?.data?.error ?? error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error. Please try again.";
}
