import { createRequestScope } from '../../platform/shared/composables/requestScope.js'
import { ref } from 'vue'

/**
 * useApprovalDetail 管理审批详情、快照文档和受理命令状态。
 * 参数：依赖提供详情/预览/命令读取，权限与会话，提示/错误格式化及实时刷新回调。
 * 返回值：详情和PDF/HTML预览引用、请求作用域及审批动作方法。
 */
export function useApprovalDetail({ getApproval, previewApprovalContract, commandApproval, can, session, showToast, formatUserError, refreshApprovalRealtime }) {
  const approvalDetailScope = createRequestScope()
  const approvalComment = ref('')
  const approvalDetail = ref(null)
  const approvalDetailLoading = ref(false)
  const approvalContractPreviewHTML = ref('')
  const approvalContractPreviewPDF = ref(null)
  const approvalContractPreviewLoading = ref(false)
  const approvalContractPreviewError = ref('')
  const approvalCommandBusy = ref(false)
  const approvalTargetUser = ref('')
  const approvalTargetNode = ref('')
  const selectedApproval = ref(null)
  let approvalDetailTicket = null

async function executeApprovalCommand(action, payload = {}, { close = false } = {}) {
  if (approvalCommandBusy.value) return
  if (approvalDetail.value?.state_unavailable) {
    showToast('审批工作流历史已不可查询，当前仅可查看提交快照', 'warning')
    return
  }
  // 本地判断用于收窄按钮入口并校验必填原因；待办归属、当前节点、角色和状态版本仍由
  // 命令接口按当前登录主体重新验证，不能把已打开的详情快照当作授权凭据。
  const isApplicant = approvalDetail.value?.meta?.applicant_user_id === session.value?.user_id
  const requiresActiveTask = ['approve', 'reject', 'sign', 'transfer', 'return'].includes(action)
  const allowed = requiresActiveTask
    ? can('approval.process') && selectedApproval.value?.status === 'active'
    : action === 'comments'
      ? can('approval.view') || can('approval.process') || isApplicant
      : action === 'urge'
        ? can('approval.manage') || isApplicant
        : action === 'withdraw' && isApplicant
  if (!allowed) {
    showToast(requiresActiveTask && selectedApproval.value?.status === 'pending'
      ? '该审批尚未流转到当前节点，暂时只能查看。'
      : '当前用户无权执行此审批操作。')
    return
  }
  if (['reject', 'sign', 'transfer', 'return', 'withdraw'].includes(action) && !approvalComment.value.trim()) {
    showToast('该操作必须填写审批意见或原因。')
    return
  }
  const target = selectedApproval.value
  if (!target) return
  approvalCommandBusy.value = true
  try {
    const accepted = await commandApproval(target.id, action, { comment: approvalComment.value.trim(), ...payload })
    const durable = await waitForApprovalCommand(accepted.command_id, action, target.id)
    if (close && durable) closeApproval()
    await refreshApprovalRealtime()
    const labels = { approve: '审批已通过', reject: '审批已驳回', comments: '评论已提交', urge: '催办已发送', sign: '加签请求已提交', transfer: '转交请求已提交', return: '退回请求已提交', withdraw: '审批已撤回' }
    showToast(durable ? (labels[action] || '操作已完成') : '操作已受理，流程仍在处理，状态将自动更新')
    approvalComment.value = ''
  } catch (error) {
    showToast(formatUserError(error, { fallback: '处理审批失败' }))
  } finally {
    approvalCommandBusy.value = false
  }
}

/**
 * closeApproval 关闭审批详情并失效旧文档描述。
 * 参数：无。
 * 返回值：无。
 */
function closeApproval() {
  // 使在途详情/正文预览请求失效，关闭后旧响应不得回填弹窗。
  approvalDetailScope.invalidate()
  approvalDetailTicket = null
  selectedApproval.value = null
  approvalDetail.value = null
  approvalContractPreviewHTML.value = ''
  approvalContractPreviewPDF.value = null
  approvalContractPreviewError.value = ''
  approvalContractPreviewLoading.value = false
}

/**
 * openApproval 读取审批详情及不可变文档预览。
 * 参数：approval为选中的审批记录。
 * 返回值：Promise<void>；迟到响应不回填其他详情。
 */
async function openApproval(approval) {
  const ticket = approvalDetailScope.begin(`APPROVAL:${approval.id}`)
  approvalDetailTicket = ticket
  const isCurrent = () => approvalDetailScope.isCurrent(ticket)
  // 审批状态与格式化正文分别读取：正文预览失败只降级为原始合同内容，不会把审批
  // 详情误判为不可用，也不会改变服务端的待办状态。
  selectedApproval.value = approval
  approvalDetail.value = null
  approvalContractPreviewHTML.value = ''
  approvalContractPreviewPDF.value = null
  approvalContractPreviewError.value = ''
  approvalComment.value = ''
  approvalTargetUser.value = ''
  approvalTargetNode.value = ''
  approvalDetailLoading.value = true
  try {
    const detail = await getApproval(approval.id)
    if (!isCurrent()) return
    approvalDetail.value = detail
    approvalDetailLoading.value = false
    if (approvalDetail.value?.contract) {
      approvalContractPreviewLoading.value = true
      try {
        const result = await previewApprovalContract(approval.id)
        if (!isCurrent()) return
        approvalContractPreviewPDF.value = result?.format === 'PDF' ? result : null
        approvalContractPreviewHTML.value = result?.html || ''
        if (!approvalContractPreviewHTML.value && !approvalContractPreviewPDF.value) approvalContractPreviewError.value = '该合同没有可预览的正文内容。'
      } catch (error) {
        if (isCurrent() && error?.code !== 'CON_DOCUMENT_NOT_FOUND') approvalContractPreviewError.value = formatUserError(error, { fallback: '读取格式化合同失败' })
      } finally {
        if (isCurrent()) approvalContractPreviewLoading.value = false
      }
    }
  } catch (error) {
    if (isCurrent()) showToast(formatUserError(error, { fallback: '读取审批详情失败' }))
  } finally {
    if (isCurrent()) approvalDetailLoading.value = false
  }
}

async function waitForApprovalCommand(commandID, action, approvalID) {
  const delays = [0, 150, 300, 500, 800, 1200, 1800]
  for (const delay of delays) {
    if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay))
    try {
      const detail = await getApproval(approvalID)
      if (selectedApproval.value?.id === approvalID) approvalDetail.value = detail
      if (approvalCommandIsDurable(detail, commandID, action)) return true
    } catch {
      // Temporal 已受理命令时继续等待数据库活动提交，最终以服务端快照为准。
    }
  }
  return false
}

function approvalCommandIsDurable(detail, commandID, action) {
  if (!detail?.actions?.some((item) => item.command_id === commandID)) return false
  if (action === 'approve' && detail.state?.status === 'approved') return detail.contract?.status === 'active'
  if (['reject', 'withdraw'].includes(action)) return detail.contract?.status === 'draft'
  return true
}

  return {
    approvalDetailScope, selectedApproval, approvalDetail, approvalDetailLoading,
    approvalContractPreviewHTML, approvalContractPreviewPDF, approvalContractPreviewLoading, approvalContractPreviewError,
    approvalComment, approvalTargetUser, approvalTargetNode, approvalCommandBusy,
    openApproval, closeApproval, executeApprovalCommand,
  };
}
