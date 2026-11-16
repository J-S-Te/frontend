import { request, toQuery } from './client.js'

// 用途：读取当前商机的人工报价与投标资料分页。
// 参数：id 为父商机标识，params 为页码和每页条数。
// 返回值：资料分页；读取失败抛出现有 CRM 错误。
export function listCommercialRecords(id, params = { page: 1, page_size: 20 }) {
  return request(`/opportunities/${encodeURIComponent(id)}/commercial-records${toQuery(params)}`)
}

// 用途：按稳定幂等键登记人工资料。
// 参数：id 为父商机，payload 为资料内容，idempotencyKey 为本次登记原始键。
// 返回值：已确认创建的资料；失败保留现有 CRM 错误语义。
export function createCommercialRecord(id, payload, idempotencyKey) {
  return request(`/opportunities/${encodeURIComponent(id)}/commercial-records`, {
    method: 'POST', body: JSON.stringify(payload), idempotent: true, idempotencyKey,
  })
}

// 用途：按资料版本更正人工资料。
// 参数：id 为父商机，recordID 为不透明资料标识，payload 含新内容和原版本。
// 返回值：已确认更正的资料；冲突或失败抛出现有 CRM 错误。
export function updateCommercialRecord(id, recordID, payload) {
  return request(`/opportunities/${encodeURIComponent(id)}/commercial-records/${encodeURIComponent(recordID)}`, {
    method: 'PUT', body: JSON.stringify(payload),
  })
}

// 用途：保留痕迹地作废错误登记。
// 参数：id 为父商机，recordID 为资料标识，payload 含原版本与作废原因。
// 返回值：已作废资料；冲突或失败抛出现有 CRM 错误。
export function voidCommercialRecord(id, recordID, payload) {
  return request(`/opportunities/${encodeURIComponent(id)}/commercial-records/${encodeURIComponent(recordID)}/void`, {
    method: 'POST', body: JSON.stringify(payload),
  })
}
