// 新手导览的最小服务端适配：配置开关与追加事件。
// 失败一律由调用方静默降级，不能因为遥测阻断导览或业务操作。
const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' }

async function readEnvelope(response) {
  if (!response.ok) throw new Error(`first-run request failed: ${response.status}`)
  if (response.status === 204) return null
  const payload = await response.json()
  return payload?.data ?? payload
}

/**
 * 读取服务端 first-run 配置。
 * @returns {Promise<{enabled:boolean,version:number}>} 配置；后端未就绪时调用方降级为开启。
 */
export async function fetchFirstRunConfig() {
  const response = await fetch('/api/v1/first-run/config', {
    credentials: 'include', headers: { Accept: 'application/json' },
  })
  return readEnvelope(response)
}

/**
 * 追加一条导览事件；keepalive 允许页面卸载时尽量送达。
 * @param {Object} event 事件字段。
 * @returns {Promise<void>} 不返回正文。
 */
export async function recordFirstRunEvent(event) {
  const response = await fetch('/api/v1/first-run/events', {
    method: 'POST', credentials: 'include', keepalive: true,
    headers: JSON_HEADERS, body: JSON.stringify(event),
  })
  if (!response.ok) throw new Error(`first-run event failed: ${response.status}`)
}
