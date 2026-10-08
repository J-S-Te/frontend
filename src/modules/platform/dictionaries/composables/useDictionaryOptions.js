import { ref } from 'vue'
import { DictionaryError, listActiveItemsByCode } from '@/modules/platform/dictionaries/api/dictionaries'

// 模块级缓存按字典编码共享，控制台内多个表单复用同一次请求；
// 会话内字典被管理员修改后需要刷新页面才能看到，业务表单可接受该时延。
const cache = new Map()

function normalizeItems(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : []
  return items.map((item) => ({
    value: String(item.value ?? item.code ?? ''),
    label: String(item.label ?? item.code ?? ''),
    code: String(item.code ?? ''),
    sortOrder: Number(item.sort_order || 0),
  })).filter((item) => item.value !== '')
}

/**
 * 按编码消费业务字典的启用项。运行时读取端点对已认证用户开放（无需字典管理权限），
 * 因此主要消费方是业务子系统表单；加载失败（平台会话过期、网络、字典不存在）时
 * 静默回退到 fallback，表单始终可用，错误只记录在控制台，不打断用户操作。
 */
export function useDictionaryOptions(dictionaryCode, { fallback = [] } = {}) {
  const options = ref([])
  const loading = ref(false)

  async function load() {
    if (!dictionaryCode) {
      options.value = [...fallback]
      return
    }

    if (cache.has(dictionaryCode)) {
      options.value = cache.get(dictionaryCode)
      return
    }

    loading.value = true
    try {
      const normalized = normalizeItems(await listActiveItemsByCode(dictionaryCode, { page: 1, pageSize: 100 }))
      // 字典存在但被清空时同样回退，避免业务表单出现空下拉。
      options.value = normalized.length ? normalized : [...fallback]
      cache.set(dictionaryCode, options.value)
    } catch (error) {
      const status = error instanceof DictionaryError ? error.status : 0
      console.warn(`[dictionary] 读取字典 ${dictionaryCode} 失败（status=${status}），使用内置默认项。`, error)
      options.value = [...fallback]
    } finally {
      loading.value = false
    }
  }

  load()

  return { options, loading }
}

/** 测试与热更新场景下清空共享缓存。 */
export function clearDictionaryOptionsCache() {
  cache.clear()
}
