export type PluginVendor = "hioso" | "zte";

export type PluginAuthSession = {
  accessToken: string;
};

export type HiosoLoginPayload = {
  username: string;
  password: string;
};

export type HiosoDeviceRow = {
  id: string;
  name: string;
  base_url: string;
  port?: number;
  username?: string;
  password?: string;
};

export type HiosoDeviceStatus = {
  id?: string;
  name?: string;
  online?: boolean;
  status?: string;
  detail?: string;
};

export type HiosoSystemInfo = {
  system_name?: string;
  switch_type?: string;
  software_version?: string;
  mac_address?: string;
  ip_address?: string;
  uptime?: string;
};

export type HiosoPonRow = {
  pon_id: string;
  full_id: string;
  info?: string;
};

export type HiosoOnuRow = {
  id?: string;
  onu_id?: string;
  name?: string;
  mac_address?: string;
  status?: string;
  rx_power?: number | string | null;
};

export type HiosoOnuDetail = {
  onu_id?: string;
  name?: string;
  mac_address?: string;
  status?: string;
  first_uptime?: string;
  last_uptime?: string;
  optical_module?: {
    temperature?: number;
    tx_power?: number;
    rx_power?: number;
  };
};
