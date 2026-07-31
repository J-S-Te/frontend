import { ref, computed } from 'vue'
import { getCurrentPrincipal } from '@/modules/platform/auth/api/auth'
import {
  AUTHORIZATION_REFRESHED_EVENT,
  dispatchAuthorizationRefreshed,
  principalFingerprint,
} from '@/modules/platform/auth/utils/authorizationRefresh'
import { checkAnyPermission, checkPermission } from '@/modules/platform/auth/utils/permissions'

// 单一来源的当前认证主体缓存。所有需要按权限控制 UI 的组件都应使用
// `useCurrentPrincipal()`，避免每个组件各自 fetch / 维护副本。
//
// 后端是权限权威：UI 隐藏不可见按钮只是体验优化，禁用和最终拒绝仍由后端执行。
const principal = ref(null)
const lastFingerprint = ref('')
let pendingFetch = null

function applyPrincipal(next) {
  principal.value = next
  lastFingerprint.value = principalFingerprint(next)
}

if (typeof window !== 'undefined') {
  window.addEventListener(AUTHORIZATION_REFRESHED_EVENT, (event) => {
    const next = event?.detail?.principal
    if (next && typeof next === 'object') applyPrincipal(next)
  })
}

async function refreshPrincipal({ force = false } = {}) {
  if (typeof window === 'undefined') return null
  if (!force && principal.value) return principal.value
  if (pendingFetch) return pendingFetch
  pendingFetch = (async () => {
    try {
      const next = await getCurrentPrincipal()
      applyPrincipal(next)
      dispatchAuthorizationRefreshed(next, { changed: true })
      return next
    } catch (error) {
      principal.value = null
      lastFingerprint.value = ''
      throw error
    } finally {
      pendingFetch = null
    }
  })()
  return pendingFetch
}

function resetPrincipal() {
  principal.value = null
  lastFingerprint.value = ''
  pendingFetch = null
}

export function useCurrentPrincipal() {
  return {
    principal: computed(() => principal.value),
    lastFingerprint: computed(() => lastFingerprint.value),
    refreshPrincipal,
    resetPrincipal,
  }
}

/**
 * 检查当前 principal 是否拥有指定权限码。
 * `code` 形如 `platform:user:delete`、`iam:role:write`。
 *
 * 默认 fail-open：当 principal 已加载但 permission_codes 为空数组时（兼容尚未下放
 * 显式权限的后端），返回 true。一旦后端开始下发非空权限列表，未命中即视为不通过。
 * principal 未加载时也返回 true，避免刷新瞬间按钮集体消失导致误点。
 *
 * 真正的禁用/拒绝仍由后端 403 执行，UI 隐藏只是体验优化。
 */
export function hasPermission(code) {
  return checkPermission(principal.value, code)
}

export function hasAnyPermission(codes) {
  return checkAnyPermission(principal.value, codes)
}
