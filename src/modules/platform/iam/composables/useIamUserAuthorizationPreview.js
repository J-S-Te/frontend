import { ref } from 'vue'
import { getApplicationAccess } from '@/modules/platform/iam/api/authorization'
import { formatUserError } from '@/modules/shared/utils/userError.js'
import { buildUserAuthorizationOverview } from '@/modules/platform/iam/utils/userAuthorizationOverview'

/**
 * 用户详情「有效授权总览」预览域（治理批次 4 IAM，自 IamSettingsModule.vue 逐字迁移）。
 * 收编：跨应用有效授权聚合读取、单应用重试版本守卫、不可用/错误计数与目标应用集合。
 *
 * 注入项与组件内同名标识一一对应：detail/detailAuthorizationRequestSeq/applications/
 * canReadApplicationAuthorization；不直接依赖组件状态。
 */
export function useIamUserAuthorizationPreview({ detail, detailAuthorizationRequestSeq, applications, canReadApplicationAuthorization }) {
  const userAuthorizationPreview = ref(null)
  const userAuthorizationPreviewLoading = ref(false)
  const userAuthorizationPreviewUnavailable = ref(false)
  const userAuthorizationPreviewErrorCount = ref(0)
  const userAuthorizationPreviewEntries = ref([])
  const userAuthorizationPreviewTargetApplications = ref([])
  const userAuthorizationPreviewRetryVersions = new Map()

async function loadUserAuthorizationPreview(userId, targetApplications = applications.value, detailRequestId = detailAuthorizationRequestSeq.value) {
  // 按应用读取后端已经计算好的用户有效授权。岗位模板预览接口只接受 position_id，
  // 不能拿 user_id 代替；这里必须使用真实的用户应用访问接口做跨应用聚合。
  userAuthorizationPreview.value = null
  userAuthorizationPreviewUnavailable.value = false
  userAuthorizationPreviewErrorCount.value = 0
  const isCurrentRequest = () => detailRequestId === detailAuthorizationRequestSeq.value
    && detail.value?.kind === 'user'
    && String(detail.value?.item?.user_id || '') === String(userId || '')
  if (!userId) {
    userAuthorizationPreviewLoading.value = false
    userAuthorizationPreviewUnavailable.value = true
    return
  }
  if (!Array.isArray(targetApplications)) {
    userAuthorizationPreviewLoading.value = false
    userAuthorizationPreviewUnavailable.value = true
    return
  }
  if (isCurrentRequest()) userAuthorizationPreviewTargetApplications.value = [...targetApplications]
  userAuthorizationPreviewLoading.value = true
  userAuthorizationPreviewEntries.value = []
  userAuthorizationPreviewRetryVersions.clear()
  userAuthorizationPreview.value = null
  userAuthorizationPreviewErrorCount.value = 0
  try {
    const entries = await Promise.all((Array.isArray(targetApplications) ? targetApplications : []).map(async (application) => {
      try {
        return { application, access: await getApplicationAccess(userId, application.code) }
      } catch (error) {
        return { application, error: formatUserError(error, { fallback: '读取应用授权失败。' }) }
      }
    }))
    if (!isCurrentRequest()) return
    userAuthorizationPreviewEntries.value = entries
    applyUserAuthorizationPreviewEntries(entries)
    userAuthorizationPreviewUnavailable.value = entries.length > 0 && entries.every((entry) => entry.error)
  } catch (_error) {
    if (isCurrentRequest()) userAuthorizationPreviewUnavailable.value = true
  } finally {
    if (isCurrentRequest()) userAuthorizationPreviewLoading.value = false
  }
}

function applyUserAuthorizationPreviewEntries(entries) {
  userAuthorizationPreview.value = buildUserAuthorizationOverview(entries)
  userAuthorizationPreviewErrorCount.value = entries.filter((entry) => entry.error).length
}

async function retryUserAuthorizationPreview(applicationCode, { silent = false } = {}) {
  const code = String(applicationCode || '').trim()
  const userId = detail.value?.kind === 'user' ? detail.value?.item?.user_id : ''
  if (!code || !userId) return
  const entries = userAuthorizationPreviewEntries.value
  const index = entries.findIndex((entry) => String(entry?.application?.code || '').trim() === code)
  if (index < 0 || entries[index].loading) return
  const application = entries[index].application
  const retryVersion = (userAuthorizationPreviewRetryVersions.get(code) || 0) + 1
  userAuthorizationPreviewRetryVersions.set(code, retryVersion)
  const next = silent
    ? entries.map((entry) => ({ ...entry }))
    : entries.map((entry, entryIndex) => entryIndex === index ? { application, loading: true } : entry)
  if (!silent) {
    userAuthorizationPreviewEntries.value = next
    applyUserAuthorizationPreviewEntries(next)
  }
  const requestId = detailAuthorizationRequestSeq.value
  const isCurrentRequest = () => requestId === detailAuthorizationRequestSeq.value &&
    userAuthorizationPreviewRetryVersions.get(code) === retryVersion &&
    detail.value?.kind === 'user' && detail.value?.item?.user_id === userId
  try {
    const access = await getApplicationAccess(userId, code)
    if (!isCurrentRequest()) return
    next[index] = { application, access }
  } catch (error) {
    if (!isCurrentRequest()) return
    next[index] = { application, error: formatUserError(error, { fallback: '读取应用授权失败。' }) }
  } finally {
    if (isCurrentRequest()) {
      userAuthorizationPreviewEntries.value = next
      applyUserAuthorizationPreviewEntries(next)
      userAuthorizationPreviewUnavailable.value = next.length > 0 && next.every((entry) => entry.error)
    }
  }
}

async function refreshUserAuthorizationPreview() {
  const userId = detail.value?.kind === 'user' ? detail.value?.item?.user_id : ''
  const targets = userAuthorizationPreviewTargetApplications.value.length
    ? userAuthorizationPreviewTargetApplications.value
    : applications.value
  if (!userId || !canReadApplicationAuthorization.value || !targets.length || userAuthorizationPreviewLoading.value) return
  await loadUserAuthorizationPreview(userId, targets, detailAuthorizationRequestSeq.value)
}

function resetUserAuthorizationPreview() {
  userAuthorizationPreview.value = null
  userAuthorizationPreviewLoading.value = false
  userAuthorizationPreviewUnavailable.value = false
  userAuthorizationPreviewErrorCount.value = 0
  userAuthorizationPreviewEntries.value = []
  userAuthorizationPreviewTargetApplications.value = []
  userAuthorizationPreviewRetryVersions.clear()
}

  return {
    userAuthorizationPreview, userAuthorizationPreviewLoading, userAuthorizationPreviewUnavailable,
    userAuthorizationPreviewErrorCount, userAuthorizationPreviewEntries, userAuthorizationPreviewTargetApplications,
    loadUserAuthorizationPreview, retryUserAuthorizationPreview, refreshUserAuthorizationPreview,
    resetUserAuthorizationPreview,
  }
}
