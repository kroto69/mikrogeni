export type MikrotikStatus = "online" | "offline" | "down" | "unknown";

export interface MikrotikRegistryDevice {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  has_password: boolean;
  use_tls: boolean;
  skip_tls_verify: boolean;
  site?: string;
  tags?: string[];
  ros_version?: string;
  ros_major?: string;
  status?: string;
  last_error?: string;
  last_sync_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface MikrotikDeviceDetail {
  device_id: string;
  identity: string;
  ros_version: string;
  model_type: string;
  management_ip: string;
  uptime: string;
  cpu_load: string;
  free_memory: string;
}

export interface MikrotikInterfaceRow {
	".id": string;
	name: string;
	type?: string;
	disabled?: string | boolean;
	running?: string | boolean;
	mtu?: string | number;
	comment?: string;
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
	"rx-byte"?: string | number;
	"tx-byte"?: string | number;
}

export interface MikrotikInterfaceTraffic {
  device_id: string;
  interface_id: string;
  interface: string;
  rx_bps: number;
  tx_bps: number;
  rx_mbps: number;
  tx_mbps: number;
  rx_pps: number;
  tx_pps: number;
  sampled_at: string;
}

export interface MikrotikPppActiveRow {
  ".id": string;
  name?: string;
  service?: string;
  address?: string;
  uptime?: string;
  "caller-id"?: string;
  "session-id"?: string;
}

export interface MikrotikSecretRow {
  ".id": string;
  name: string;
  password?: string;
  service?: string;
  profile?: string;
  disabled?: string | boolean;
  comment?: string;
  "local-address"?: string;
  "remote-address"?: string;
  "last-logged-out"?: string;
}

export interface MikrotikProfileRow {
  ".id": string;
  name: string;
  disabled?: string | boolean;
  "local-address"?: string;
  "remote-address"?: string;
  "rate-limit"?: string;
  "dns-server"?: string;
  "only-one"?: string | boolean;
  "change-tcp-mss"?: string | boolean;
  comment?: string;
}

export interface MikrotikSecretUpsertPayload {
  name: string;
  password?: string;
  profile?: string;
  service?: string;
  local_address?: string;
  remote_address?: string;
  comment?: string;
  disabled?: boolean;
}

export interface MikrotikProfileUpsertPayload {
  name: string;
  disabled?: boolean;
  local_address?: string;
  remote_pool?: string;
  rate_limit?: string;
  dns_server?: string;
  only_one?: boolean;
  change_tcp_mss?: boolean;
  comment?: string;
}

export interface MikrotikDeviceSettingsPayload {
  name?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  site?: string;
  tags?: string[];
}

export interface MikrotikDeviceCreatePayload {
  id?: string;
  name: string;
  host: string;
  port?: number;
  username: string;
  password: string;
  use_tls?: boolean;
  skip_tls_verify?: boolean;
  site?: string;
  tags?: string[];
}

export interface MikrotikAsyncActionResponse {
  success: boolean;
  message: string;
  device_id: string;
  action: string;
  task: {
    id: string;
    status: string;
    created_at?: string;
  };
}

export interface MikrotikInterface {
  id: string;
  name: string;
  type: string;
  macAddress: string;
  traffic: string;
  mtu: number;
  status: MikrotikStatus;
}

export interface MikrotikDevice {
  deviceId: string;
  identity: string;
  rosVersion: string;
  modelType: string;
  managementIp: string;
  uptime: string;
  cpuLoad: string;
  freeMemory: string;
  status: MikrotikStatus;
}
