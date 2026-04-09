import axios, { type InternalAxiosRequestConfig } from "axios";
import type {
  HiosoDeviceRow,
  HiosoDeviceStatus,
  HiosoLoginPayload,
  HiosoOnuDetail,
  HiosoOnuRow,
  HiosoPonRow,
  HiosoSystemInfo,
  PluginAuthSession,
} from "@/types/plugin-olt";

type PluginApiEnvelope<T> = {
  success?: boolean;
  data?: T;
  error?: string;
};

type PluginLoginResponse = {
  access_token?: string;
  token?: string;
  data?: {
    access_token?: string;
    token?: string;
  };
};

export const PLUGIN_API_BASE_URL = import.meta.env.VITE_PLUGIN_API_BASE_URL ?? "/plugin-api";
export const PLUGIN_AUTH_STORAGE_KEY = "network-core.plugin.auth";

function isBrowser() {
  return typeof window !== "undefined";
}

export function getStoredPluginSession(): PluginAuthSession | null {
  if (!isBrowser()) {
    return null;
  }

  const raw = window.localStorage.getItem(PLUGIN_AUTH_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PluginAuthSession>;
    if (typeof parsed.accessToken !== "string" || parsed.accessToken.length === 0) {
      return null;
    }

    return { accessToken: parsed.accessToken };
  } catch {
    window.localStorage.removeItem(PLUGIN_AUTH_STORAGE_KEY);
    return null;
  }
}

export function setStoredPluginSession(session: PluginAuthSession) {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(PLUGIN_AUTH_STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredPluginSession() {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.removeItem(PLUGIN_AUTH_STORAGE_KEY);
}

function attachPluginAuthHeader(config: InternalAxiosRequestConfig) {
  const session = getStoredPluginSession();
  if (session?.accessToken && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${session.accessToken}`;
  }

  return config;
}

export const pluginApi = axios.create({
  baseURL: PLUGIN_API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

pluginApi.interceptors.request.use(attachPluginAuthHeader);

function unwrapData<T>(payload: PluginApiEnvelope<T> | T): T {
  if (payload && typeof payload === "object" && "data" in (payload as PluginApiEnvelope<T>)) {
    const envelope = payload as PluginApiEnvelope<T>;
    return envelope.data as T;
  }

  return payload as T;
}

export function getPluginApiErrorMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    const response = error.response?.data as PluginApiEnvelope<unknown> | undefined;
    return response?.error || error.message || "Plugin request failed";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Plugin request failed";
}

export async function loginHiosoPlugin(payload: HiosoLoginPayload) {
  const { data } = await pluginApi.post<PluginLoginResponse>("/auth/login", payload);
  const accessToken = data.access_token ?? data.token ?? data.data?.access_token ?? data.data?.token;

  if (!accessToken) {
    throw new Error("Plugin login did not return an access token.");
  }

  const session = { accessToken } satisfies PluginAuthSession;
  setStoredPluginSession(session);
  return session;
}

export async function getHiosoDevices() {
  const { data } = await pluginApi.get<PluginApiEnvelope<HiosoDeviceRow[]> | HiosoDeviceRow[]>("/devices");
  return unwrapData(data) ?? [];
}

export async function getHiosoDeviceDetail(deviceId: string) {
  const { data } = await pluginApi.get<PluginApiEnvelope<HiosoDeviceRow> | HiosoDeviceRow>(`/devices/${deviceId}`);
  return unwrapData(data);
}

export async function getHiosoDeviceStatus(deviceId: string) {
  const { data } = await pluginApi.get<PluginApiEnvelope<HiosoDeviceStatus> | HiosoDeviceStatus>(`/devices/${deviceId}/status`);
  return unwrapData(data);
}

export async function getHiosoSystem(deviceId: string) {
  const { data } = await pluginApi.get<PluginApiEnvelope<HiosoSystemInfo> | HiosoSystemInfo>(`/devices/${deviceId}/system`);
  return unwrapData(data);
}

export async function getHiosoPons(deviceId: string) {
  const { data } = await pluginApi.get<PluginApiEnvelope<HiosoPonRow[]> | HiosoPonRow[]>(`/devices/${deviceId}/pons`);
  return unwrapData(data) ?? [];
}

export async function getHiosoOnus(deviceId: string, ponId: string, filter?: "online" | "offline") {
  const { data } = await pluginApi.get<PluginApiEnvelope<HiosoOnuRow[]> | HiosoOnuRow[]>(`/devices/${deviceId}/pons/${ponId}/onus`, {
    params: filter ? { filter } : undefined,
  });
  return unwrapData(data) ?? [];
}

export async function getHiosoOnuDetail(deviceId: string, onuId: string) {
  const { data } = await pluginApi.get<PluginApiEnvelope<HiosoOnuDetail> | HiosoOnuDetail>(`/devices/${deviceId}/onus/${onuId}`);
  return unwrapData(data);
}

export async function updateHiosoOnuName(deviceId: string, onuId: string, name: string) {
  const { data } = await pluginApi.put<PluginApiEnvelope<HiosoOnuDetail> | HiosoOnuDetail>(`/devices/${deviceId}/onus/${onuId}`, { name });
  return unwrapData(data);
}
