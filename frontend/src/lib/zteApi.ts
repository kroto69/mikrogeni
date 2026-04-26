import axios, { type InternalAxiosRequestConfig } from "axios";
import type {
  ZteApiEnvelope,
  ZteConnectionConfig,
  ZteOlt,
  ZteOltConnectionTest,
  ZteOltCreatePayload,
  ZteOltUpdatePayload,
  ZteOltSystem,
  ZteOnuDetail,
  ZteOnuRow,
  ZtePon,
  ZteRebootPayload,
  ZteSearchStats,
} from "@/types/zte";

// ── Storage ──────────────────────────────────────────────────────────────

const ZTE_CONFIG_STORAGE_KEY = "network-core.zte.config";

function isBrowser() {
  return typeof window !== "undefined";
}

function getStoredZteConfig(): ZteConnectionConfig | null {
  if (!isBrowser()) return null;
  const raw = window.localStorage.getItem(ZTE_CONFIG_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ZteConnectionConfig;
  } catch {
    window.localStorage.removeItem(ZTE_CONFIG_STORAGE_KEY);
    return null;
  }
}

export function setStoredZteConfig(config: ZteConnectionConfig) {
  if (!isBrowser()) return;
  window.localStorage.setItem(ZTE_CONFIG_STORAGE_KEY, JSON.stringify(config));
}

function clearStoredZteConfig() {
  if (!isBrowser()) return;
  window.localStorage.removeItem(ZTE_CONFIG_STORAGE_KEY);
}

function buildBaseURL(config: ZteConnectionConfig): string {
  const base = config.baseUrl.replace(/\/+$/, "");
  const prefix = config.apiPrefix.startsWith("/") ? config.apiPrefix : `/${config.apiPrefix}`;
  return `${base}${prefix}`;
}

// ── Axios Instance ───────────────────────────────────────────────────────

function attachZteConfig(config: InternalAxiosRequestConfig) {
  const connConfig = getStoredZteConfig();
  if (connConfig) {
    config.baseURL = buildBaseURL(connConfig);
  }
  return config;
}

export const zteApi = axios.create({
  headers: { "Content-Type": "application/json" },
});

zteApi.interceptors.request.use(attachZteConfig);

// ── Helpers ──────────────────────────────────────────────────────────────

function unwrapData<T>(payload: ZteApiEnvelope<T> | T): T {
  if (payload && typeof payload === "object" && "data" in (payload as ZteApiEnvelope<T>)) {
    const envelope = payload as ZteApiEnvelope<T>;
    return envelope.data as T;
  }
  return payload as T;
}

export function getZteApiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const response = error.response?.data as ZteApiEnvelope<unknown> | undefined;
    return response?.error || error.message || "ZTE API request failed";
  }
  if (error instanceof Error) return error.message;
  return "ZTE API request failed";
}

// ── Connection ───────────────────────────────────────────────────────────

export function connectZte(config: ZteConnectionConfig): void {
  setStoredZteConfig(config);
  zteApi.defaults.baseURL = buildBaseURL(config);
}

export function disconnectZte() {
  clearStoredZteConfig();
  delete zteApi.defaults.baseURL;
}

export function isZteConnected(): boolean {
  return Boolean(getStoredZteConfig());
}

export function getZteConfig(): ZteConnectionConfig | null {
  return getStoredZteConfig();
}

// ── OLT CRUD ─────────────────────────────────────────────────────────────

export async function getZteOlts(): Promise<ZteOlt[]> {
  const { data } = await zteApi.get<ZteApiEnvelope<ZteOlt[]> | ZteOlt[]>("/olts");
  return unwrapData(data) ?? [];
}

export async function getZteOlt(oltId: string): Promise<ZteOlt> {
  const { data } = await zteApi.get<ZteApiEnvelope<ZteOlt> | ZteOlt>(`/olt/${encodeURIComponent(oltId)}`);
  return unwrapData(data);
}

export async function createZteOlt(payload: ZteOltCreatePayload): Promise<ZteOlt> {
  const { data } = await zteApi.post<ZteApiEnvelope<ZteOlt> | ZteOlt>("/olt", payload);
  return unwrapData(data);
}

export async function updateZteOlt(oltId: string, payload: ZteOltUpdatePayload): Promise<ZteOlt> {
  const { data } = await zteApi.put<ZteApiEnvelope<ZteOlt> | ZteOlt>(`/olt/${encodeURIComponent(oltId)}`, payload);
  return unwrapData(data);
}

export async function deleteZteOlt(oltId: string): Promise<void> {
  await zteApi.delete(`/olt/${encodeURIComponent(oltId)}`);
}

export async function testZteOltConnection(oltId: string): Promise<ZteOltConnectionTest> {
  const { data } = await zteApi.post<ZteApiEnvelope<ZteOltConnectionTest> | ZteOltConnectionTest>(
    `/olt/${encodeURIComponent(oltId)}/test-connection`,
  );
  return unwrapData(data);
}

// ── OLT System / Monitoring ──────────────────────────────────────────────

export async function getZteOltSystem(oltId: string): Promise<ZteOltSystem> {
  const { data } = await zteApi.get<ZteApiEnvelope<ZteOltSystem> | ZteOltSystem>(
    `/system/olt/${encodeURIComponent(oltId)}`,
  );
  return unwrapData(data);
}

export async function getZteOltSystems(): Promise<ZteOltSystem[]> {
  const { data } = await zteApi.get<ZteApiEnvelope<ZteOltSystem[]> | ZteOltSystem[]>("/system/olts");
  return unwrapData(data) ?? [];
}

// ── PON ──────────────────────────────────────────────────────────────────

export async function getZtePons(oltId: string, board: string): Promise<ZtePon[]> {
  const { data } = await zteApi.get<ZteApiEnvelope<ZtePon[]> | ZtePon[]>(
    `/olt/${encodeURIComponent(oltId)}/board/${encodeURIComponent(board)}/pon`,
  );
  return unwrapData(data) ?? [];
}

// ── ONU ───────────────────────────────────────────────────────────────────

export async function getZteOnus(oltId: string, board: string, pon: string): Promise<ZteOnuRow[]> {
  const { data } = await zteApi.get<ZteApiEnvelope<ZteOnuRow[]> | ZteOnuRow[]>(
    `/olt/${encodeURIComponent(oltId)}/board/${encodeURIComponent(board)}/pon/${encodeURIComponent(pon)}`,
  );
  return unwrapData(data) ?? [];
}

export async function getZteOnuDetail(
  oltId: string,
  board: string,
  pon: string,
  onuId: string,
): Promise<ZteOnuDetail> {
  const { data } = await zteApi.get<ZteApiEnvelope<ZteOnuDetail> | ZteOnuDetail>(
    `/olt/${encodeURIComponent(oltId)}/board/${encodeURIComponent(board)}/pon/${encodeURIComponent(pon)}/onu/${encodeURIComponent(onuId)}`,
  );
  return unwrapData(data);
}

// ── Search ────────────────────────────────────────────────────────────────

export async function searchZteOnus(query: string): Promise<ZteOnuRow[]> {
  const { data } = await zteApi.get<ZteApiEnvelope<ZteOnuRow[]> | ZteOnuRow[]>("/search", {
    params: { q: query },
  });
  return unwrapData(data) ?? [];
}

export async function getZteSearchStats(): Promise<ZteSearchStats> {
  const { data } = await zteApi.get<ZteApiEnvelope<ZteSearchStats> | ZteSearchStats>("/search/stats");
  return unwrapData(data);
}

// ── Reboot ────────────────────────────────────────────────────────────────

export async function rebootZteOnu(payload: ZteRebootPayload): Promise<void> {
  await zteApi.post("/onu/reboot", payload);
}



export async function checkZteHealth(): Promise<{ status: string }> {
  const { data } = await zteApi.get<ZteApiEnvelope<{ status: string }> | { status: string }>("/health");
  return unwrapData(data);
}