import { request, toQuery } from './client.js'

// 用途：读取平台授权给 CRM 的有效负责人，不接触机器凭据。
// 参数：params 为查询条件；options.signal 为调用方的读取取消信号。
// 返回值：负责人分页结果；服务端错误或取消由现有请求管道抛出。
export const listOwnerDirectory = (params = {}, { signal } = {}) => request(`/owner-directory${toQuery(params)}`, {
  cache: 'no-store',
  signal,
  headers: { 'Cache-Control': 'no-cache' },
})
