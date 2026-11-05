import { request } from './client.js'

// 用途：读取当前有权查看商机的本地赢单依据。
// 参数：id 为商机标识。
// 返回值：当前确认模式、可选历史证据及业务日期；服务端拒绝时抛错。
export function getOpportunityWinConfirmation(id) {
  return request(`/opportunities/${encodeURIComponent(id)}/win-confirmation`)
}
