import { request, toQuery } from './client.js'

/**
 * 列出基础平台授权给本子系统的 CRM 负责人候选人。
 * 浏览器不调用平台管理 API，也不处理机器凭据。
 */
export const listOwnerDirectory = (params = {}) => request(`/owner-directory${toQuery(params)}`, {
  cache: 'no-store',
  headers: { 'Cache-Control': 'no-cache' },
})
