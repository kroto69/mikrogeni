import { api, getApiErrorMessage } from '@/lib/api'
import type { CDataOLT, CDataPONInfo, CDataONUListItem, CDataONUDetail } from '@/types/cdata'

type ApiEnvelope<T> = { success: boolean; data: T; error: string }

function unwrap<T>(payload: ApiEnvelope<T> | T): T {
  if (payload && typeof payload === 'object' && 'data' in (payload as ApiEnvelope<T>)) {
    return (payload as ApiEnvelope<T>).data as T
  }
  return payload as T
}

export async function getCDataOLTs(connId: string): Promise<CDataOLT[]> {
  const { data } = await api.get<ApiEnvelope<CDataOLT[]> | CDataOLT[]>(`/cdata/olt/${encodeURIComponent(connId)}/olts`)
  return unwrap(data) ?? []
}

export async function getCDataPONList(connId: string): Promise<CDataPONInfo[]> {
  const { data } = await api.get<ApiEnvelope<CDataPONInfo[]> | CDataPONInfo[]>(`/cdata/olt/${encodeURIComponent(connId)}/pon`)
  return unwrap(data) ?? []
}

export async function getCDataONUList(connId: string, pon: number): Promise<CDataONUListItem[]> {
  const { data } = await api.get<ApiEnvelope<CDataONUListItem[]> | CDataONUListItem[]>(
    `/cdata/olt/${encodeURIComponent(connId)}/pon/${pon}`
  )
  return unwrap(data) ?? []
}

export async function getCDataONUDetail(connId: string, pon: number, onuId: number): Promise<CDataONUDetail> {
  const { data } = await api.get<ApiEnvelope<CDataONUDetail> | CDataONUDetail>(
    `/cdata/olt/${encodeURIComponent(connId)}/pon/${pon}/onu/${onuId}`
  )
  return unwrap(data)
}

export async function rebootCDataONU(connId: string, pon: number, onuId: number): Promise<{ success: boolean; message: string }> {
  const { data } = await api.post<ApiEnvelope<{ success: boolean; message: string }> | { success: boolean; message: string }>(
    `/cdata/olt/${encodeURIComponent(connId)}/reboot`,
    { oltId: connId, pon, onuId }
  )
  return unwrap(data)
}

export { getApiErrorMessage }
