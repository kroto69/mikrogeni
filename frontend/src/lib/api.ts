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
import type {
  BillingCustomer,
  BillingCustomerStatus,
  BillingInvoice,
  BillingInvoiceStatus,
  BillingOverdueResult,
  BillingPayment,
  BillingPaymentResult,
  BillingRecurringResult,
  BillingServicePlan,
  CreateBillingCustomerPayload,
  CreateBillingPaymentPayload,
  CreateBillingServicePlanPayload,
} from "@/types/billing";

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

export type AcsUserRole = "admin" | "teknisi";

export type AcsUser = {
  id: number;
  username: string;
  role: AcsUserRole;
  created_at?: string;
  updated_at?: string;
};

export type CreateAcsUserPayload = {
  username: string;
  role: AcsUserRole;
  password: string;
};

export type UpdateAcsUserPayload = {
  username: string;
  role: AcsUserRole;
  password?: string;
};

export type HiosoPluginStatus = {
  enabled?: boolean;
  host?: string;
};

export type HiosoPluginHealth = {
  online?: boolean;
  detail?: string;
};

export type HiosoOnuRow = {
  index: string;
  web_id?: string;
  port?: number;
  onu_id?: number;
  name?: string;
  sn?: string;
  status?: string;
  tx_power?: number;
  rx_power?: number;
  profile?: string;
};

export type HiosoOltProfile = {
  id: string;
  name: string;
  snmp_host: string;
  snmp_port: number;
  snmp_version: string;
  snmp_community: string;
  web_host: string;
  web_port: number;
  username: string;
  password?: string;
  is_active?: boolean;
  active?: boolean;
  created_at?: string;
  updated_at?: string;
};

type BackendHiosoOltProfile = {
  id: string;
  name: string;
  host: string;
  port: string;
  snmp_version: string;
  snmp_community: string;
  web_host: string;
  web_port: string;
  username: string;
  password?: string;
};

type BackendHiosoOltProfilesResponse = {
  profiles: BackendHiosoOltProfile[];
  active_id: string;
};

export type CreateHiosoOltProfilePayload = {
  name: string;
  snmp_host: string;
  snmp_port: number;
  snmp_version: string;
  snmp_community: string;
  web_host: string;
  web_port: number;
  username: string;
  password: string;
};

export type UpdateHiosoOltProfilePayload = {
  name: string;
  snmp_host: string;
  snmp_port: number;
  snmp_version: string;
  snmp_community: string;
  web_host: string;
  web_port: number;
  username: string;
  password?: string;
};

type ApiEnvelope<T> = {
  success?: boolean;
  data?: T;
  error?: string;
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

export async function getHiosoOltProfiles() {
  const { data } = await api.get<ApiEnvelope<BackendHiosoOltProfilesResponse> | BackendHiosoOltProfilesResponse>("/acs/settings/hioso-olts");
  const payload = unwrapApiEnvelope(data);

  if (!payload || !Array.isArray(payload.profiles)) {
    return [] as HiosoOltProfile[];
  }

  return payload.profiles.map((profile) => mapBackendHiosoOltProfile(profile, payload.active_id));
}

export async function createHiosoOltProfile(payload: CreateHiosoOltProfilePayload) {
  const { data } = await api.post<ApiEnvelope<BackendHiosoOltProfile> | BackendHiosoOltProfile>("/acs/settings/hioso-olts", {
    name: payload.name,
    host: payload.snmp_host,
    port: String(payload.snmp_port),
    snmp_version: payload.snmp_version,
    snmp_community: payload.snmp_community,
    web_host: payload.web_host,
    web_port: String(payload.web_port),
    username: payload.username,
    password: payload.password,
  });
  return mapBackendHiosoOltProfile(unwrapApiEnvelope(data));
}

export async function updateHiosoOltProfile(profileId: string, payload: UpdateHiosoOltProfilePayload) {
  const requestPayload: Record<string, string> = {
    name: payload.name,
    host: payload.snmp_host,
    port: String(payload.snmp_port),
    snmp_version: payload.snmp_version,
    snmp_community: payload.snmp_community,
    web_host: payload.web_host,
    web_port: String(payload.web_port),
    username: payload.username,
  };

  if (payload.password && payload.password.trim() !== "") {
    requestPayload.password = payload.password;
  }

  const { data } = await api.patch<ApiEnvelope<BackendHiosoOltProfile> | BackendHiosoOltProfile>(`/acs/settings/hioso-olts/${encodeURIComponent(profileId)}`, requestPayload);
  return mapBackendHiosoOltProfile(unwrapApiEnvelope(data));
}

export async function deleteHiosoOltProfile(profileId: string) {
  const { data } = await api.delete<ApiEnvelope<{ success?: boolean; message?: string }> | { success?: boolean; message?: string }>(`/acs/settings/hioso-olts/${encodeURIComponent(profileId)}`);
  return unwrapApiEnvelope(data);
}

export async function activateHiosoOltProfile(profileId: string) {
  const { data } = await api.post<ApiEnvelope<{ success?: boolean; message?: string }> | { success?: boolean; message?: string }>(`/acs/settings/hioso-olts/${encodeURIComponent(profileId)}/activate`);
  return unwrapApiEnvelope(data);
}

function unwrapApiEnvelope<T>(payload: ApiEnvelope<T> | T): T {
  if (payload && typeof payload === "object" && "data" in (payload as ApiEnvelope<T>)) {
    return ((payload as ApiEnvelope<T>).data ?? null) as T;
  }

  return payload as T;
}

function mapBackendHiosoOltProfile(profile: BackendHiosoOltProfile | null | undefined, activeId = ""): HiosoOltProfile {
  return {
    id: profile?.id ?? "",
    name: profile?.name ?? "",
    snmp_host: profile?.host ?? "",
    snmp_port: parseInt(profile?.port ?? "161", 10) || 161,
    snmp_version: profile?.snmp_version ?? "2c",
    snmp_community: profile?.snmp_community ?? "",
    web_host: profile?.web_host ?? "",
    web_port: parseInt(profile?.web_port ?? "80", 10) || 80,
    username: profile?.username ?? "",
    password: profile?.password,
    active: (profile?.id ?? "") !== "" && (profile?.id ?? "") === activeId,
    is_active: (profile?.id ?? "") !== "" && (profile?.id ?? "") === activeId,
  };
}

export async function updateAcsSetting(key: string, value: string) {
  const normalizedValue = value.trim() === "" ? " " : value;
  const { data } = await api.post<{ success: boolean; message: string }>("/acs/settings", { key, value: normalizedValue });
  return data;
}

export async function getAcsUsers() {
  const { data } = await api.get<AcsUser[]>("/acs/users");
  return data;
}

export async function createAcsUser(payload: CreateAcsUserPayload) {
  const { data } = await api.post<{ success: boolean; message: string }>("/acs/users", payload);
  return data;
}

export async function updateAcsUser(userId: number, payload: UpdateAcsUserPayload) {
  const { data } = await api.patch<{ success: boolean; message: string }>(`/acs/users/${userId}`, payload);
  return data;
}

export async function deleteAcsUser(userId: number) {
  const { data } = await api.delete<{ success: boolean; message: string }>(`/acs/users/${userId}`);
  return data;
}

export async function getHiosoPluginStatus() {
  const { data } = await api.get<ApiEnvelope<HiosoPluginStatus> | HiosoPluginStatus>("/plugin/hioso/status");
  return unwrapApiEnvelope(data);
}

export async function getHiosoPluginHealth() {
  const { data } = await api.get<ApiEnvelope<HiosoPluginHealth> | HiosoPluginHealth>("/plugin/hioso/health");
  return unwrapApiEnvelope(data);
}

export async function getHiosoPorts() {
  const { data } = await api.get<ApiEnvelope<number[]> | number[]>("/plugin/hioso/ports");
  return unwrapApiEnvelope(data) ?? [];
}

export async function getHiosoOnus(port?: number) {
  const params = port != null ? { port } : undefined;
  const { data } = await api.get<ApiEnvelope<HiosoOnuRow[]> | HiosoOnuRow[]>("/plugin/hioso/onu", { params });
  return unwrapApiEnvelope(data) ?? [];
}

export async function getHiosoOnuDetail(onuIndex: string) {
  const { data } = await api.get<ApiEnvelope<HiosoOnuRow> | HiosoOnuRow>(`/plugin/hioso/onu/${encodeURIComponent(onuIndex)}`);
  return unwrapApiEnvelope(data);
}

export async function renameHiosoOnu(onuIndex: string, name: string) {
  const { data } = await api.post<ApiEnvelope<{ method?: string }> | { method?: string }>(
    `/plugin/hioso/onu/${encodeURIComponent(onuIndex)}/rename`,
    { name },
  );
  return unwrapApiEnvelope(data);
}

export async function rebootHiosoOnu(onuIndex: string) {
  const { data } = await api.post<ApiEnvelope<{ rebooted?: boolean }> | { rebooted?: boolean }>(
    `/plugin/hioso/onu/${encodeURIComponent(onuIndex)}/reboot`,
  );
  return unwrapApiEnvelope(data);
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

export async function getBillingServicePlans(params?: { activeOnly?: boolean }) {
	const { data } = await api.get<BillingServicePlan[]>("/billing/service-plans", {
		params: params?.activeOnly ? { active_only: 1 } : undefined,
	});
	return data;
}

export async function createBillingServicePlan(payload: CreateBillingServicePlanPayload) {
	const { data } = await api.post<BillingServicePlan>("/billing/service-plans", payload);
	return data;
}

export async function getBillingCustomers(params?: { status?: BillingCustomerStatus }) {
	const { data } = await api.get<BillingCustomer[]>("/billing/customers", {
		params: params?.status ? { status: params.status } : undefined,
	});
	return data;
}

export async function createBillingCustomer(payload: CreateBillingCustomerPayload) {
	const { data } = await api.post<BillingCustomer>("/billing/customers", payload);
	return data;
}

export async function getBillingInvoices(params?: { status?: BillingInvoiceStatus; customerId?: number }) {
	const { data } = await api.get<BillingInvoice[]>("/billing/invoices", {
		params: {
			...(params?.status ? { status: params.status } : {}),
			...(params?.customerId ? { customer_id: params.customerId } : {}),
		},
	});
	return data;
}

export async function createBillingPayment(invoiceId: number, payload: CreateBillingPaymentPayload) {
	const { data } = await api.post<BillingPaymentResult>(`/billing/invoices/${invoiceId}/payments`, payload);
	return data;
}

export async function getBillingPayments(params?: { invoiceId?: number }) {
	const { data } = await api.get<BillingPayment[]>("/billing/payments", {
		params: params?.invoiceId ? { invoice_id: params.invoiceId } : undefined,
	});
	return data;
}

export async function runRecurringBillingNow() {
	const { data } = await api.post<BillingRecurringResult>("/billing/jobs/recurring/run");
	return data;
}

export async function runOverdueCheckerNow() {
	const { data } = await api.post<BillingOverdueResult>("/billing/jobs/overdue/run");
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
