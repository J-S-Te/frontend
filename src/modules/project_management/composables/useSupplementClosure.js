import { ref } from 'vue'
import { createRequestScope } from '../../platform/shared/composables/requestScope.js'
import {
  eligibleClosureContracts,
  emptyClosureForm,
  supplementRequired,
  SUPPLEMENT_CLOSURE_CONFIRM_NOTE,
  SUPPLEMENT_CLOSURE_CONFIRM_TITLE,
  validateSupplementClosure,
} from '../supplementClosure.js'

/**
 * 项目页「补充协议关账」弹窗域（BIZ-PROJECT-04 前端受控入口）。
 * 收编：候选补充协议装载、表单校验、二次确认、提交与写后刷新衔接。
 *
 * 注入项与组件内同名标识一一对应：closeSupplement/listSupplementContracts/
 * formatUserError/showToast/refreshAfterWrite/askConfirm；不直接导入 API 模块，
 * 保持可独立测试。入口可见性由视图按 supplement_status 与权限判定后调用这里。
 */
export function useSupplementClosure({ closeSupplement, listSupplementContracts, formatUserError, showToast, refreshAfterWrite, askConfirm }) {
  const closureOpen = ref(false)
  const closureProject = ref(null)
  const closureContracts = ref([])
  const closureForm = ref(emptyClosureForm())
  const closureLoading = ref(false)
  const closureLoadError = ref('')
  const closureSaving = ref(false)
  const closureError = ref('')
  const closureScope = createRequestScope()

  function closeSupplementClosure() {
    closureOpen.value = false
    closureScope.invalidate()
    closureLoading.value = false
  }

  async function loadClosureContracts(project) {
    const projectID = project.id
    const ticket = closureScope.begin(`CLOSURE:${projectID}`)
    closureContracts.value = []
    closureLoadError.value = ''
    closureError.value = ''
    closureLoading.value = true
    try {
      const contracts = await listSupplementContracts(projectID, { limit: 200 })
      if (!closureScope.isCurrent(ticket)) return
      closureContracts.value = eligibleClosureContracts(project, contracts)
      if (!closureContracts.value.length) {
        closureLoadError.value = '当前客户没有可用的已审批补充协议：必须已审批、属于同一客户且不同于原合同，否则不能关账。'
      }
    } catch (error) {
      if (!closureScope.isCurrent(ticket)) return
      closureLoadError.value = formatUserError(error, { fallback: '补充协议目录加载失败，暂时不能关账' })
    } finally {
      if (closureScope.isCurrent(ticket)) closureLoading.value = false
    }
  }

  async function openSupplementClosure(project) {
    if (!project?.id) { showToast('请先选择需要关账的项目', 'warning'); return }
    // 入口通常已按状态门控；这里再校验一次，避免旧列表行或迟到的项目对象绕过。
    if (!supplementRequired(project)) { showToast('当前项目不在补充协议处理中，无需关账', 'warning'); return }
    closureProject.value = project
    closureForm.value = emptyClosureForm()
    closureError.value = ''
    closureOpen.value = true
    await loadClosureContracts(project)
  }

  async function reloadSupplementClosure() {
    const project = closureProject.value
    if (!project?.id) return
    await loadClosureContracts(project)
  }

  async function submitSupplementClosure() {
    if (closureSaving.value || closureLoading.value) return
    const project = closureProject.value
    if (!project?.id) return
    const invalid = validateSupplementClosure(closureForm.value)
    if (invalid) {
      closureError.value = invalid
      showToast(invalid, 'warning')
      return
    }
    // 二次确认：关账把“当前拆解范围”钉成新的权威基准，且不能靠再确认一次拆解撤销。
    const confirmed = await askConfirm({
      title: SUPPLEMENT_CLOSURE_CONFIRM_TITLE,
      description: `目标项目 ${project.id}${project.name ? ` · ${project.name}` : ''}。${SUPPLEMENT_CLOSURE_CONFIRM_NOTE}`,
      confirmText: '确认关账',
      cancelText: '再核对一下',
      danger: true,
    })
    if (!confirmed) return
    closureSaving.value = true
    closureError.value = ''
    try {
      const result = await closeSupplement(project.id, {
        supplement_contract_id: String(closureForm.value.supplementContractID).trim(),
        reason: String(closureForm.value.reason).trim(),
      })
      closureOpen.value = false
      closureScope.invalidate()
      const status = String(result?.status || '').trim()
      showToast(`补充协议已关账${status ? `，项目状态：${status}` : ''}；当前拆解范围已成为新的比对基准`, 'success')
      await refreshAfterWrite()
    } catch (error) {
      // 403/409 等业务拒绝保留在弹窗里：用户可以直接修正选择或刷新，不需要重新打开。
      closureError.value = formatUserError(error, { fallback: '补充协议关账失败' })
      showToast(closureError.value, 'error')
    } finally {
      closureSaving.value = false
    }
  }

  return {
    closureOpen, closureProject, closureContracts, closureForm,
    closureLoading, closureLoadError, closureSaving, closureError,
    openSupplementClosure, closeSupplementClosure, reloadSupplementClosure, submitSupplementClosure,
  }
}
