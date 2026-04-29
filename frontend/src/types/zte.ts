export type ZTEConnection = {
  id: string
  name: string
  base_url: string
  olt_id: string
  is_active: boolean
  created_at: string
}

export type ZTESystemInfo = {
  oltId: string
  name: string
  host: string
  uptime: string
  cpuUsage: number
  memoryUsage: number
  isOnline: boolean
}

export type ZTEPONInfo = {
  board: number
  pon: number
  description: string
}

export type ZTEONUListItem = {
  oltId: string
  board: number
  pon: number
  onuId: number
  name: string
  serialNumber: string
  status: string
  statusCode: number
  rxPower: number
}

export type ZTEONUDetail = {
  oltId: string
  board: number
  pon: number
  onuId: number
  name: string
  serialNumber: string
  type: string
  status: string
  statusCode: number
  rxPower: number
  txPower: number
  lastOnline: string
  lastOffline: string
  offlineReason: string
  wanIp: string
}
