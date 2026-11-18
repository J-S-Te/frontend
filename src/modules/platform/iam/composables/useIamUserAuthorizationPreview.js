import { ref } from 'vue'
import { getApplicationAccess } from '@/modules/platform/iam/api/authorization'
import { formatUserError } from '@/modules/shared/utils/userError.js'
import { buildUserAuthorizationOverview } from '@/modules/platform/iam/utils/userAuthorizationOverview'

/**
 * 用途：维护用户有效授权总览，隔离全量刷新与单应用重试的迟到响应。
 * 参数：detail 为用户详情，detailAuthorizationRequestSeq 为详情代际；
 *   applications 为应用目录，canReadApplicationAuthorization 为授权读取权限。
 * 返回值：总览状态及读取、刷新、重试和重置方法，不产生业务写入。
 */
export function useIamUserAuthorizationPreview({ detail, detailAuthorizationRequestSeq, applications, canReadApplicationAuthorization }) {
  const userAuthorizationPreview = ref(null)
  const userAuthorizationPreviewLoading = ref(false)
  const userAuthorizationPreviewUnavailable = ref(false)
  const userAuthorizationPreviewErrorCount = ref(0)
  const userAuthorizationPreviewEntries = ref([])
  const userAuthorizationPreviewTargetApplications = ref([])
  const userAuthorizationPreviewRetryVersions = new Map()
  let userAuthorizationPreviewRequestSeq = 0

/**
 * 用途：读取用户在完整目标应用集合中的当前有效角色和来源。
 * 参数：userId 为用户 ID，targetApplications 为应用集合，detailRequestId 为详情代际。
 * 返回值：无；仅最新且仍属于当前用户详情的响应可以更新总览状态。
 */
async function loadUserAuthorizationPreview(userId, targetApplications = applications.value, detailRequestId = detailAuthorizationRequestSeq.value) {
  const requestVersion = ++userAuthorizationPreviewRequestSeq
  // 按应用读取后端已经计算好的用户有效授权。岗位模板预览接口只接受 position_id，
  // 不能拿 user_id 代替；这里必须使用真实的用户应用访问接口做跨应用聚合。
  userAuthorizationPreview.value = null
  userAuthorizationPreviewUnavailable.value = false
  userAuthorizationPreviewErrorCount.value = 0
  const isCurrentRequest = () => requestVersion === userAuthorizationPreviewRequestSeq
    && detailRequestId === detailAuthorizationRequestSeq.value
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

/**
 * 用途：重读单个应用并合并该应用结果，保留其他应用已刷新的授权。
 * 参数：applicationCode 为应用编码，silent 为是否保留读取过程中的原展示。
 * 返回值：无；过期的全量或单应用请求不更新数据，失败仅标记目标应用。
 */
async function retryUserAuthorizationPreview(applicationCode, { silent = false } = {}) {
  const code = String(applicationCode || '').trim()
  const userId = detail.value?.kind === 'user' ? detail.value?.item?.user_id : ''
  if (!code || !userId) return
  const entries = userAuthorizationPreviewEntries.value
  const index = entries.findIndex((entry) => String(entry?.application?.code || '').trim() === code)
  if (index < 0) return
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
  const requestVersion = userAuthorizationPreviewRequestSeq
  const isCurrentRequest = () => requestId === detailAuthorizationRequestSeq.value &&
    requestVersion === userAuthorizationPreviewRequestSeq &&
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
      const current = userAuthorizationPreviewEntries.value.map((entry) =>
        String(entry?.application?.code || '').trim() === code ? next[index] : entry)
      userAuthorizationPreviewEntries.value = current
      applyUserAuthorizationPreviewEntries(current)
      userAuthorizationPreviewUnavailable.value = current.length > 0 && current.every((entry) => entry.error)
    }
  }
}

/**
 * 用途：刷新当前用户完整目标集合，允许写入通知替换仍在途的旧读取。
 * 参数：无；优先沿用首次读取记录的完整应用集合。
 * 返回值：无；无用户、无权限或没有目标应用时不发起请求。
 */
async function refreshUserAuthorizationPreview() {
  const userId = detail.value?.kind === 'user' ? detail.value?.item?.user_id : ''
  const targets = userAuthorizationPreviewTargetApplications.value.length
    ? userAuthorizationPreviewTargetApplications.value
    : applications.value
  if (!userId || !canReadApplicationAuthorization.value || !targets.length) return
  await loadUserAuthorizationPreview(userId, targets, detailAuthorizationRequestSeq.value)
}

/**
 * 用途：清空总览并使全部在途读取失效。
 * 参数：无。
 * 返回值：无；保留组合函数实例供下一次用户详情读取复用。
 */
function resetUserAuthorizationPreview() {
  userAuthorizationPreviewRequestSeq += 1
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
