import { getCurrentPrincipal } from '../../platform/auth/api/auth'
import { principalIdentityID } from '../../shared/authz/sessionCompatibility.js'
import { createClient } from './client.js'

const env = import.meta.env || {}
export const publicPrefix = (env.VITE_REIMBURSEMENT_PUBLIC_PATH_PREFIX || '/reimbursement').replace(/\/$/, '')
export const reimbursementAPI = createClient({ base: env.VITE_REIMBURSEMENT_API_BASE_URL || `${publicPrefix}/api/v1` })
const authAPI = createClient({ base: publicPrefix })
let redirecting = false

// 用途：发起独立报销应用登录并保留当前业务地址。
// 参数：force 为是否强制重新选择平台主体。
// 返回值：无；浏览器跳转到服务端OIDC入口。
export function startReimbursementLogin(force = false) {
  if (redirecting) return
  redirecting = true
  const query = new URLSearchParams({ return_to: window.location.pathname + window.location.search })
  if (force) query.set('prompt', 'login')
  window.location.replace(`${publicPrefix}/auth/login?${query}`)
}

// 用途：读取报销服务器会话。
// 参数：无。
// 返回值：会话及权威权限；失败原样抛出。
export function getReimbursementSession() { return authAPI.request('/auth/session') }

// 用途：为已核对为同一用户和租户的报销会话补充真实账号展示资料。
// 参数：session 为报销授权会话，principal 为平台当前主体，matched 表示身份绑定已通过。
// 返回值：仅补充账号及姓名的新对象；未绑定或资料缺失时保留原会话。
function withCurrentUserProfile(session, principal, matched) {
  if (!matched) return session
  const profile = {}
  for (const [field, values] of [
    ['username', [principal.account?.name, principal.account?.code]],
    ['display_name', [principal.user?.name]],
  ]) {
    const value = values.find(item => typeof item === 'string' && item.trim())
    if (value) profile[field] = value.trim()
  }
  return Object.keys(profile).length ? { ...session, ...profile } : session
}

// 用途：建立目标应用会话并核对平台与报销主体一致性。
// 参数：无。
// 返回值：带绑定用户展示资料的真实会话；已跳转登录时返回null。
export async function ensureReimbursementSession() {
  try {
    const [session, principal] = await Promise.all([
      getReimbursementSession(), getCurrentPrincipal().catch(() => null),
    ])
    const identity = session.subject_id || principalIdentityID(session)
    if (!session.tenant_id || !identity || !Array.isArray(session.permissions)) {
      throw Object.assign(new Error('报销会话响应不完整'), { status: 503, code: 'INVALID_SESSION' })
    }
    const platformIdentity = principalIdentityID(principal)
    const platformTenant = principal?.tenant_id || principal?.tenant?.id || ''
    if (principal && ((platformIdentity && platformIdentity !== identity)
      || (platformTenant && platformTenant !== session.tenant_id))) {
      await authAPI.request('/auth/local-logout', { method: 'POST' })
      startReimbursementLogin(true)
      return null
    }
    return withCurrentUserProfile(session, principal,
      platformIdentity === identity && platformTenant === session.tenant_id)
  } catch (error) {
    if (error.status === 401) { startReimbursementLogin(); return null }
    throw error
  }
}

// 用途：退出报销应用的独立会话。
// 参数：无。
// 返回值：登出回执；失败时保留页面并抛错。
export async function logoutReimbursement() {
  await authAPI.request('/auth/local-logout', { method: 'POST' })
  window.location.assign('/portal')
}
