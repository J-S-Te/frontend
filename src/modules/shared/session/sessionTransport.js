const SYSTEMS = [
  ['Platform', 'VITE_API_BASE_URL', '/api/v1'],
  ['Contract', 'VITE_CONTRACT_PUBLIC_PATH_PREFIX', '/contract_management'],
  ['Project', 'VITE_PROJECT_PUBLIC_PATH_PREFIX', '/project_management'],
  ['Settlement', 'VITE_SETTLEMENT_PUBLIC_PATH_PREFIX', '/settlement'],
  ['CRM', 'VITE_CRM_PUBLIC_PATH_PREFIX', '/customer-opportunity'],
  ['Portal', 'VITE_CUSTOMER_PORTAL_PUBLIC_PATH_PREFIX', '/customer-portal'],
  ['DataAnalysis', 'VITE_DATA_ANALYSIS_PUBLIC_PATH_PREFIX', '/data_analysis'],
]

// sessionTargetForRoute 按明确的路由认证边界选择入口，不以平台Cookie代替子系统Cookie。
// 参数：meta为路由元信息，environment为构建时公开路径配置。
// 返回值：该入口的状态、活动和登录地址；公开页面返回null，冲突配置抛错。
export function sessionTargetForRoute(meta, environment = import.meta.env || {}) {
  const matched = SYSTEMS.filter(([name]) => meta?.[`requires${name}Session`] === true)
  if (matched.length > 1) throw new Error('路由存在冲突的会话入口')
  if (!matched.length) return null
  const [key, setting, fallback] = matched[0]
  const prefix = String(environment[setting] || fallback).replace(/\/+$/, '')
  return {
    key,
    stateURL: `${prefix}/auth/${key === 'Platform' ? 'me' : 'session'}`,
    activityURL: `${prefix}/auth/activity`,
    loginURL: key === 'Platform' ? '/login' : `${prefix}/auth/login`,
  }
}

// unavailable 构造不包含响应正文、凭据和内部地址的会话错误。
// 参数：status为HTTP状态；确定未认证保留401，其余依赖异常统一503。
// 返回值：可由协调器区分退出与重试的错误。
function unavailable(status = 503) {
  return Object.assign(new Error('会话服务暂不可用，请稍后重试'), { status: status === 401 ? 401 : 503 })
}

// createSessionTransport 通过同源Cookie代理会话管理，浏览器不接触中央绑定或OAuth令牌。
// 参数：options包含站点origin与可替换的标准fetch实现。
// 返回值：只读状态和显式交互请求接口。
export function createSessionTransport({ origin = globalThis.location?.origin,
  fetchImpl = globalThis.fetch } = {}) {
  // request 发送限定同源的技术请求，保留故障现场和未提交表单。
  // 参数：target为当前入口，interact区分真实活动，options包含取消信号。
  // 返回值：服务端原始生命周期上下文；失败抛出401或503。
  async function request(target, interact, options = {}) {
    try {
      const url = new URL(interact ? target.activityURL : target.stateURL, origin)
      if (url.origin !== origin || url.username || url.password || url.hash || url.search) throw unavailable()
      const response = await fetchImpl(url.href, {
        method: interact ? 'POST' : 'GET', credentials: 'include', redirect: 'error', cache: 'no-store',
        headers: { Accept: 'application/json', ...(interact ? { 'X-CSRF-Token': '1' } : {}) },
        signal: options.signal,
      })
      if (!response.ok) throw unavailable(response.status)
      if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) throw unavailable()
      const body = await response.json()
      const data = body?.data
      if (!data || typeof data !== 'object') throw unavailable()
      return data.session_context || data
    } catch (error) {
      if (error?.status === 401) throw error
      throw unavailable()
    }
  }
  return {
    // read 只读核对当前Cookie绑定的统一会话。
    // 参数：target为入口，options为取消控制。
    // 返回值：统一生命周期Promise，不延长空闲时间。
    read(target, options) { return request(target, false, options) },
    // activity 将可见页面的真实操作代理给基础平台。
    // 参数：target为入口，options为取消控制。
    // 返回值：统一生命周期Promise，不延长原始八小时上限。
    activity(target, options) { return request(target, true, options) },
  }
}
