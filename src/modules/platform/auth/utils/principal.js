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
let cacheGeneration = 0

function applyPrincipal(next) {
  principal.value = next
  lastFingerprint.value = principalFingerprint(next)
}

if (typeof window !== 'undefined') {
  window.addEventListener(AUTHORIZATION_REFRESHED_EVENT, (event) => {
    const next = event?.detail?.principal
    if (next && typeof next === 'object') {
      applyPrincipal(next)
      return
    }
    if (next === null) resetPrincipal()
  })
}

async function refreshPrincipal({ force = false } = {}) {
  if (typeof window === 'undefined') return null
  if (!force && principal.value) return principal.value
  if (pendingFetch?.generation === cacheGeneration) return pendingFetch.request
  const requestedGeneration = cacheGeneration
  const request = (async () => {
    try {
      const next = await getCurrentPrincipal()
      // 请求期间可能已完成退出或换号；世代不一致时丢弃迟到响应，禁止旧账号回填共享权限缓存。
      if (requestedGeneration !== cacheGeneration) return principal.value
      applyPrincipal(next)
      dispatchAuthorizationRefreshed(next, { changed: true })
      return next
    } catch (error) {
      if (requestedGeneration === cacheGeneration) {
        principal.value = null
        lastFingerprint.value = ''
      }
      throw error
    } finally {
      if (pendingFetch?.request === request) pendingFetch = null
    }
  })()
  pendingFetch = { generation: requestedGeneration, request }
  return request
}

function resetPrincipal() {
  cacheGeneration += 1
  principal.value = null
  lastFingerprint.value = ''
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
 * 严格失败关闭：principal 未加载、permission_codes 缺失/为空或权限码未命中时都
 * 返回 false。这样账号切换清空缓存后不会短暂显示上一用户或未授权操作入口。
 *
 * 真正的禁用/拒绝仍由后端 403 执行，UI 隐藏只是体验优化。
 */
export function hasPermission(code) {
  return checkPermission(principal.value, code)
}

export function hasAnyPermission(codes) {
  return checkAnyPermission(principal.value, codes)
}
