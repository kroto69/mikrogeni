import { api, getApiErrorMessage } from '@/lib/api'
import type { ZTEConnection, ZTESystemInfo, ZTEPONInfo, ZTEONUListItem, ZTEONUDetail } from '@/types/zte'

type ApiEnvelope<T> = { success: boolean; data: T; error: string }

function unwrap<T>(payload: ApiEnvelope<T> | T): T {
  if (payload && typeof payload === 'object' && 'data' in (payload as ApiEnvelope<T>)) {
    return (payload as ApiEnvelope<T>).data as T
  }
  return payload as T
}

export async function getZTEConnections(): Promise<ZTEConnection[]> {
  const { data } = await api.get<ApiEnvelope<ZTEConnection[]> | ZTEConnection[]>('/zte/connections')
  return unwrap(data) ?? []
}

export async function addZTEConnection(payload: { name?: string; base_url: string }): Promise<ZTEConnection> {
  const { data } = await api.post<ApiEnvelope<ZTEConnection> | ZTEConnection>('/zte/connections', payload)
  return unwrap(data)
}

export async function deleteZTEConnection(id: string): Promise<void> {
  await api.delete(`/zte/connections/${encodeURIComponent(id)}`)
}

export async function updateZTEConnection(id: string, payload: { name?: string; base_url?: string }): Promise<ZTEConnection> {
  const { data } = await api.patch<ApiEnvelope<ZTEConnection> | ZTEConnection>(`/zte/connections/${encodeURIComponent(id)}`, payload)
  return unwrap(data)
}

export async function healthCheckZTE(id: string): Promise<{ status: string; latency_ms: number }> {
  const { data } = await api.post<ApiEnvelope<{ status: string; latency_ms: number }> | { status: string; latency_ms: number }>(`/zte/connections/${encodeURIComponent(id)}/health`)
  return unwrap(data)
}

export async function testZTEConnection(baseUrl: string): Promise<{ status: string; latency_ms: number }> {
  const { data } = await api.post<ApiEnvelope<{ status: string; latency_ms: number }> | { status: string; latency_ms: number }>('/zte/connections/test', { base_url: baseUrl })
  return unwrap(data)
}

export async function getZTESystemInfo(connId: string): Promise<ZTESystemInfo> {
  const { data } = await api.get<ApiEnvelope<ZTESystemInfo[]> | ZTESystemInfo[]>(
    `/zte/olt/${encodeURIComponent(connId)}/system`
  )
  const result = unwrap(data)
  return Array.isArray(result) ? result[0] : result
}

export async function getZTEPONList(connId: string, board: number): Promise<ZTEPONInfo[]> {
  const { data } = await api.get<ApiEnvelope<ZTEPONInfo[]> | ZTEPONInfo[]>(`/zte/olt/${encodeURIComponent(connId)}/board/${board}/pon`)
  return unwrap(data) ?? []
}

export async function getZTEONUList(connId: string, board: number, pon: number, fresh?: boolean): Promise<ZTEONUListItem[]> {
  const { data } = await api.get<ApiEnvelope<ZTEONUListItem[]> | ZTEONUListItem[]>(
    `/zte/olt/${encodeURIComponent(connId)}/board/${board}/pon/${pon}`,
    { params: fresh ? { fresh: 'true' } : undefined }
  )
  return unwrap(data) ?? []
}

export async function getZTEONUDetail(connId: string, board: number, pon: number, onuId: number, fresh?: boolean): Promise<ZTEONUDetail> {
  const { data } = await api.get<ApiEnvelope<ZTEONUDetail> | ZTEONUDetail>(
    `/zte/olt/${encodeURIComponent(connId)}/board/${board}/pon/${pon}/onu/${onuId}`,
    { params: fresh ? { fresh: 'true' } : undefined }
  )
  return unwrap(data)
}

export async function rebootZTEONU(connId: string, board: number, pon: number, onuId: number): Promise<{ success: boolean; message: string }> {
  const { data } = await api.post<ApiEnvelope<{ success: boolean; message: string }> | { success: boolean; message: string }>(
    `/zte/olt/${encodeURIComponent(connId)}/reboot`,
    { olt_id: connId, board, pon, onu_id: onuId }
  )
  return unwrap(data)
}

export async function searchZTEONU(connId: string, q: string): Promise<ZTEONUListItem[]> {
  const { data } = await api.get<ApiEnvelope<ZTEONUListItem[]> | ZTEONUListItem[]>(
    `/zte/olt/${encodeURIComponent(connId)}/search`,
    { params: { q } }
  )
  return unwrap(data) ?? []
}

export { getApiErrorMessage }
