/**
 * ZTE OLT microservice API types.
 * Based on api-zte.md — separate backend at configurable base URL.
 */

// ── Connection Config ───────────────────────────────────────────────────

export type ZteConnectionConfig = {
  baseUrl: string;
  apiPrefix: string;
};

// ── OLT ─────────────────────────────────────────────────────────────────

export type ZteOlt = {
  id: string;
  name: string;
  snmp?: {
    host: string;
    port: number;
    community: string;
    timeout?: number;
    retries?: number;
  };
  telnet?: {
    user: string;
    password: string;
    port: number;
  };
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  created_at?: string;
  updated_at?: string;
};

export type ZteOltCreatePayload = {
  id: string;
  name: string;
  snmp: {
    host: string;
    port: number;
    community: string;
    timeout?: number;
    retries?: number;
  };
  telnet?: {
    user?: string;
    password?: string;
    port?: number;
  };
};

export type ZteOltUpdatePayload = Partial<ZteOltCreatePayload>;

export type ZteOltConnectionTest = {
  success: boolean;
  message?: string;
};

// ── OLT System / Monitoring ─────────────────────────────────────────────

export type ZteOltSystem = {
  id?: string;
  name?: string;
  cpuUsage?: number;
  memoryUsage?: number;
  uptime?: string;
  isOnline?: boolean;
  host?: string;
  model?: string;
  firmware?: string;
  serial?: string;
  mac_address?: string;
};

// ── Board / PON ─────────────────────────────────────────────────────────

export type ZteBoard = {
  board_id: string;
  description?: string;
};

export type ZtePon = {
  pon_id: string;
  description?: string;
  onu_count?: number;
};

// ── ONU ──────────────────────────────────────────────────────────────────

/** ONU status codes from ZTE API */
export const ZteOnuStatus = {
  Offline: 1,
  Ranging: 2,
  Online: 3,
  LOS: 4,
  DyingGasp: 5,
  PowerOff: 6,
  Unauthorized: 7,
  AutoConfig: 8,
  FirmwareUpgrade: 9,
} as const;

export type ZteOnuStatusValue = (typeof ZteOnuStatus)[keyof typeof ZteOnuStatus];

export function zteOnuStatusLabel(code: number): string {
  const labels: Record<number, string> = {
    1: "Offline",
    2: "Ranging",
    3: "Online",
    4: "LOS",
    5: "Dying Gasp",
    6: "Power Off",
    7: "Unauthorized",
    8: "Auto Config",
    9: "Firmware Upgrade",
  };
  return labels[code] ?? `Unknown (${code})`;
}

export function isZteOnuOnline(statusCode?: number): boolean {
  return statusCode === ZteOnuStatus.Online;
}

export type ZteOnuRow = {
  onu_id?: string;
  sn?: string;
  name?: string;
  status?: number;
  type?: string;
  rx_power?: number;
  tx_power?: number;
  distance?: string;
  description?: string;
  online_date?: string;
  offline_date?: string;
  last_down_time?: string;
  last_down_reason?: string;
  wan_ip?: string;
};

export type ZteOnuDetail = ZteOnuRow & {
  olt_id?: string;
  board?: string;
  pon?: string;
  location?: string;
  serial_number?: string;
  firmware_version?: string;
  line_profile?: string;
  srv_profile?: string;
  mac_address?: string;
};

// ── Search ──────────────────────────────────────────────────────────────

export type ZteSearchStats = {
  total: number;
  online: number;
  offline: number;
  los: number;
};

// ── Reboot ───────────────────────────────────────────────────────────────

export type ZteRebootPayload = {
  olt_id: string;
  board: string;
  pon: string;
  onu_id: string;
};

// ── API Envelope ─────────────────────────────────────────────────────────

export type ZteApiEnvelope<T> = {
  success?: boolean;
  data?: T;
  error?: string;
};