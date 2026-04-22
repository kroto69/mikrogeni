export type OnuStatus = "online" | "offline";

export interface WifiProfile {
  index: string;
  ssid: string;
  password: string;
}

export type ClientListRow = Record<string, unknown> | string;

export interface AcsDeviceListItem {
  id: string;
  sn: string;
  vendor_type: string;
  pppoe: string;
  pppoe_username?: string;
  ip: string;
  ip_address?: string;
  rx_optical: number | null;
  rx_power?: number | null;
  temp?: number | null;
  device_uptime?: string;
  last_inform: string;
}

export interface OnuDevice {
  id: string;
  serialNumber: string;
  vendorType: string;
  pppoeUsername: string;
  ipAddress: string;
  rxDbm: number | null;
  temp: number | null;
  deviceUptime: string;
  isIncomplete: boolean;
  lastInform: string;
  lastInformAt: string;
  status: OnuStatus;
}

export function isOnuIncompleteValue(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized === "" || normalized === "-";
  }

  return false;
}

export function isAcsDeviceIncomplete(device: Pick<AcsDeviceListItem, "pppoe" | "pppoe_username" | "rx_optical" | "rx_power" | "temp" | "device_uptime">) {
  return [
    device.pppoe_username ?? device.pppoe,
    device.rx_power ?? device.rx_optical,
    device.temp ?? null,
    device.device_uptime ?? "-",
  ].some(isOnuIncompleteValue);
}

export function isOnuDetailIncomplete(detail: Pick<OnuDeviceDetail, "pppoe_username" | "rx_power" | "temp" | "device_uptime">) {
  return [detail.pppoe_username, detail.rx_power, detail.temp, detail.device_uptime].some(isOnuIncompleteValue);
}

export interface OnuDeviceDetail {
  device_id: string;
  serial_number: string;
  vendor: string;
  device_type: string;
  parameter_profile: string;
  parameter_profile_source: string;
  pppoe_username: string;
  pppoe_password: string | null;
  ip_pppoe: string;
  ip_tr069: string;
  ip_address: string;
  ipv6_address: string;
  temp: number | null;
  rx_power: number | null;
  ssid_list: string[];
  wifi_profiles: WifiProfile[];
  client_list: ClientListRow[];
  web_admin_username: string;
  web_admin_password: string;
  web_user_password: string;
  tags: string[];
  device_uptime: string;
  last_inform_at: string;
}

export interface AcsTaskActionResponse {
  success: boolean;
  message: string;
  device_id: string;
  parameter_count?: number;
  task: {
    id: string;
    status: string;
    created_at?: string;
  };
}

export interface AcsBulkRefreshPayload {
  device_ids: string[];
  object_name?: string;
}

export interface AcsBulkRefreshResponse {
  success: boolean;
  message: string;
  object_name: string;
  queued_count: number;
  total_count: number;
  results: Array<{
    device_id: string;
    success: boolean;
    error?: string;
    task?: {
      id: string;
      status: string;
      created_at?: string;
    };
  }>;
}

export interface AcsWifiConfigPayload {
  ssid_2g?: string;
  password_2g?: string;
  enabled_2g?: boolean;
  ssid_5g?: string;
  password_5g?: string;
  enabled_5g?: boolean;
  parameters?: Array<{
    name: string;
    value: string | number | boolean;
    type?: string;
  }>;
}

export interface AcsWanConfigPayload {
  pppoe_username?: string;
  pppoe_password?: string;
  nat_enabled?: boolean;
  mtu?: number;
  parameters?: Array<{
    name: string;
    value: string | number | boolean;
    type?: string;
  }>;
}

export interface AcsParameterInput {
  name: string;
  value: string | number | boolean;
  type?: string;
}

export interface AcsParameterPayload {
  parameters: AcsParameterInput[];
}

export interface AppSetting {
  key: string;
  value: string;
}
