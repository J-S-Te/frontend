import { computed, ref, unref, watch } from 'vue'
import {
  getCurrentPrincipal,
  invalidateCurrentPrincipalCache,
} from '../../platform/auth/api/auth.js'
import { loginIdentityID, loginUsername } from '../loginUsername.mjs'
import { sessionScopeOf } from '../utils/sessionScopedStorage.js'

// 用途：为子系统侧栏读取同一身份的平台登录账号，并隔离换号期间的迟到响应。
// 参数：session 为当前子系统的响应式认证会话。
// 返回值：响应式用户名；平台资料不可用时使用本系统账号字段或明确占位。
export function useLoginUsername(session) {
  const principal = ref(null)
  const scope = computed(() => {
    const source = unref(session)
    return sessionScopeOf({
      ...source, identity_id: loginIdentityID(source),
    })
  })
  watch(scope, async (current, previous, onCleanup) => {
    let active = true
    onCleanup(() => { active = false })
    principal.value = null
    // 换号后不能复用上一主体的短缓存或在途请求；首次读取仍复用现有认证单飞。
    if (previous) invalidateCurrentPrincipalCache()
    if (!current) return
    try {
      const next = await getCurrentPrincipal()
      if (active) principal.value = next
    } catch {
      // 展示资料失败时不冒充读取成功；保留独立会话的账号或“当前用户”占位。
      // 认证与业务请求继续由各系统自己的服务端校验。
    }
  }, { immediate: true, flush: 'sync' })
  return computed(() => loginUsername(unref(session), principal.value))
}
