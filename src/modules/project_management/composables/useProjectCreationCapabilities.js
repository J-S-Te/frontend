import { ref, watch } from 'vue'
import { createRequestScope } from '../../platform/shared/composables/requestScope.js'
import { formatUserError } from '../../shared/utils/userError.js'

// 用途：读取有权查看来源模式的当前会话能力，隔离旧版本及能力读取故障。
// 参数：allowed为来源模式读取授权（读取或创建项目），session为会话引用，loader读取服务端能力。
// 返回值：原生入口开关、独立错误及刷新函数，不影响已有合同建项。
export function useProjectCreationCapabilities({ allowed, session, loader }) {
  const nativeEnabled = ref(false)
  const error = ref('')
  const scope = createRequestScope()

  // 用途：刷新当前会话的来源能力，撤权或会话切换后舍弃旧响应。
  // 参数：无。
  // 返回值：异步完成；失败保留关闭状态并显示可重试原因。
  async function refresh() {
    const ticket = scope.begin('PROJECT_CREATION_CAPABILITIES')
    nativeEnabled.value = false
    error.value = ''
    if (!allowed.value) return
    try {
      const capabilities = await loader()
      if (scope.isCurrent(ticket)) nativeEnabled.value = capabilities?.native_enabled === true
    } catch (failure) {
      if (scope.isCurrent(ticket)) {
        error.value = formatUserError(failure, { fallback: '项目来源能力读取失败，请重试。' })
      }
    }
  }

  watch([allowed, session], refresh, { immediate: true })
  return { nativeEnabled, error, refresh }
}
