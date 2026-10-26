import { ref } from 'vue'
import { createRequestScope } from '@/modules/platform/shared/composables/requestScope'
import { listSigningRecords } from '@/modules/contract_management/api/contract'

/**
 * 签署台账列表域（治理批次 5 合同页，自 ContractManagementView.vue 逐字迁移）。
 * 注入项：normalizeSigningRecord/session/showToast/formatUserError。
 */
export function useSigningLedger({ normalizeSigningRecord, session, showToast, formatUserError }) {
  const signingLoadingMore = ref(false)
  const signingLedgerLoading = ref(false)
  const signingSummary = ref(null)
  const signingHasMore = ref(false)
  const signingTotal = ref(0)
  const signingStatusFilter = ref('')
  const signingMethodFilter = ref('')
  const signingKeyword = ref('')
  const signingRecords = ref([])

  const signingLedgerScope = createRequestScope()

async function refreshSigningRecords({ append = false, limit = 50 } = {}) {
  if (append && !signingHasMore.value) return
  if (append) signingLoadingMore.value = true
  else signingLedgerLoading.value = true
  // 筛选防抖、“加载更多”与实时同步可能交错返回：以请求作用域票据为准，只采纳最后一次
  // 读取。旧筛选的迟到响应不得覆盖新筛选数据，其 finally 也不得关闭新请求的加载态。
  const ticket = signingLedgerScope.begin(`SIGNING_LEDGER:${append ? 'more' : 'page'}:${signingKeyword.value.trim()}:${signingStatusFilter.value}:${signingMethodFilter.value}`)
  const isCurrent = () => signingLedgerScope.isCurrent(ticket)
  try {
    const page = await listSigningRecords({
      limit,
      offset: append ? signingRecords.value.length : 0,
      keyword: signingKeyword.value.trim(),
      status: signingStatusFilter.value,
      method: signingMethodFilter.value,
    })
    if (!isCurrent()) return
    const items = (page.items || []).map(normalizeSigningRecord)
    signingRecords.value = append ? [...signingRecords.value, ...items] : items
    signingTotal.value = Number(page.total || items.length)
    signingHasMore.value = Boolean(page.has_more)
    signingSummary.value = page.stats && typeof page.stats === 'object' ? page.stats : null
  } finally {
    if (isCurrent()) {
      signingLedgerLoading.value = false
      signingLoadingMore.value = false
    }
  }
}

  return {
    signingRecords, signingKeyword, signingMethodFilter, signingStatusFilter,
    signingTotal, signingHasMore, signingSummary, signingLedgerLoading, signingLoadingMore,
    signingLedgerScope, refreshSigningRecords,
  }
}
