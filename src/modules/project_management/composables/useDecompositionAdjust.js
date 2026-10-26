import { ref } from 'vue'
import { createRequestScope } from '@/modules/platform/shared/composables/requestScope'
import { adjustDecomposition, listDetectionCategories, listSupplementContracts } from '@/modules/project_management/api/projectManagement'
import { formatUserError } from '@/modules/shared/utils/userError.js'
import { emptyAdjustForm, emptyAdjustItem } from '@/modules/project_management/projectDisplay'

/**
 * 拆解调整弹窗域（治理批次 4 项目，自 ProjectManagementView.vue 逐字迁移）。
 * 收编：调整表单、补充协议候选、检测类别装载与请求作用域守卫、提交与刷新衔接。
 *
 * 注入项与组件内同名标识一一对应：decompositionProject/detectionCategories/
 * activeDetectionCategoryOptions/supplementContractOptions/saving/showToast/formatUserError/
 * refreshAfterWrite。
 */
export function useDecompositionAdjust({ decompositionProject, detectionCategories, activeDetectionCategoryOptions, supplementContractOptions, saving, showToast, formatUserError, refreshAfterWrite }) {
  const adjustOpen = ref(false)
  const adjustForm = ref(emptyAdjustForm())
  const supplementContracts = ref([])
  const adjustProjectID = ref('')
  const adjustScope = createRequestScope()

async function openDecompositionAdjust() {
  if (!decompositionProject.value) { showToast('请先选择要调整拆解的项目', 'warning'); return }
  const projectID = decompositionProject.value.id
  const ticket = adjustScope.begin(`ADJUST:${projectID}`)
  adjustOpen.value = false
  supplementContracts.value = []
  adjustProjectID.value = ''
  try {
    const [categories, contracts] = await Promise.all([
      listDetectionCategories(),
      listSupplementContracts(projectID, { limit: 200 }),
    ])
    if (!adjustScope.isCurrent(ticket) || decompositionProject.value?.id !== projectID) return
    detectionCategories.value = categories
    supplementContracts.value = contracts
    adjustProjectID.value = projectID
  } catch (error) {
    if (!adjustScope.isCurrent(ticket) || decompositionProject.value?.id !== projectID) return
    showToast(formatUserError(error, { fallback: '检测类别或已审批合同加载失败，暂时不能调整拆解' }), 'error')
    return
  }
  if (!activeDetectionCategoryOptions.value.length) { showToast('没有启用的检测类别，请先在拆解规则中配置', 'warning'); return }
  if (!supplementContractOptions.value.length) { showToast('当前客户没有可用的已审批补充协议', 'warning'); return }
  adjustForm.value = emptyAdjustForm()
  adjustOpen.value = true
}
function addAdjustItem() { adjustForm.value.items.push(emptyAdjustItem()) }
function removeAdjustItem(index) {
  if (adjustForm.value.items.length === 1) adjustForm.value.items[0] = emptyAdjustItem()
  else adjustForm.value.items.splice(index, 1)
}
async function submitDecompositionAdjust() {
  if (saving.value) return
  const project = decompositionProject.value
  if (!project) { showToast('请先选择要调整拆解的项目', 'warning'); return }
  if (project.id !== adjustProjectID.value) { adjustOpen.value = false; showToast('项目已切换，请重新打开调整拆解', 'warning'); return }
  const items = adjustForm.value.items.map((row, index) => ({
    source_id: row.sourceID || `ADJUST-${String(index + 1).padStart(3, '0')}`,
    batch: row.batch, site: row.site, category: row.category, system: row.system,
    system_level: row.systemLevel, requirement: row.requirement, test_mode: row.testMode,
  }))
  if (items.some((row) => !row.site || !row.batch || !row.category)) {
    showToast('每个服务项都要填写场所、批次与检测类别'); return
  }
  saving.value = true
  try {
    await adjustDecomposition(project.id, { reason: adjustForm.value.reason, supplement_contract_id: adjustForm.value.supplementContractID, items })
    adjustOpen.value = false
    showToast('拆解已调整，项目进入补充协议处理中')
    await refreshAfterWrite()
  } catch (error) { showToast(formatUserError(error, { fallback: '调整拆解失败' }), 'error') }
  finally { saving.value = false }
}

  return {
    adjustOpen, adjustForm, supplementContracts, adjustProjectID,
    openDecompositionAdjust, addAdjustItem, removeAdjustItem, submitDecompositionAdjust,
  }
}
