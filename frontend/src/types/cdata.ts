export type CDataOLT = {
  id: string
  name: string
}

export type CDataPONInfo = {
  board: number
  pon: number
  description: string
}

export type CDataONUListItem = {
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

export type CDataONUDetail = {
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
  laserTxPower: number
  distanceM: number
  temperature: number
  voltage: number
  biasCurrent: number
  lastOnline: string
  lastOffline: string
  offlineReason: string
  wanIp: string
}
