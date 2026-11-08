import { computed, ref } from 'vue'
import { formatUserError } from '../../shared/utils/userError.js'
import { toggleCodeSelection } from '../projectDisplay.js'
import { useProjectAuxiliaryResource } from './useProjectAuxiliaryResource.js'

// 用途：设备维护表单的空状态；设备编号由业务用户填写，不使用自动编号。
export function emptyEquipmentForm() {
  return { resourceID: '', resourceName: '', codes: [], originalCodes: [], validFrom: '', validUntil: '', status: 'ACTIVE', usageScope: 'ANY' }
}

// 用途：把设备目录（辅助数据）与设备维护状态从项目主页面拆出，目录改为按需读取。
// 设计约束（阶段 2 / 阶段 3-项目）：
//   1) 目录只在进入「设备能力」「实施准备」或打开设备候选选择器时读取（ensure）；
//      维护成功后立即失效，下次使用重新确认；
//   2) 读取失败保留可重试错误，未确认前不得把目录当成可选设备来源；
//   3) 设备占用是独立读取，不能用目录内容代替（本组合式不读取占用，仅归还时通过回调刷新）；
//   4) 写操作失败只提示操作失败；写成功但目录读取失败提示「已保存，但读取失败」，不重发写入。
// 参数：context 为租户/用户/授权隔离键；saving 为页面级写操作标志；其余为页面既有能力注入。
// 返回值：目录读取态、维护表单状态与维护动作。
export function useProjectEquipment({
  context,
  saving,
  canManage,
  askConfirm,
  notify,
  closeMulti,
  describeError,
  codeOptions,
  canonicalCodes,
  validateCodes,
  formatDate,
  reservationFor,
  reloadReservations,
  listEquipment,
  upsertEquipment,
  deleteEquipment,
  returnServiceItemEquipment,
}) {
  const equipment = ref([])
  const {
    loading: equipmentLoading,
    error: equipmentError,
    confirmed: equipmentConfirmed,
    ensure: ensureEquipmentCatalog,
    retry: retryEquipmentCatalog,
    invalidate: invalidateEquipmentCatalog,
    load: loadEquipmentCatalog,
  } = useProjectAuxiliaryResource({
    context,
    loader: () => listEquipment(),
    apply: (rows) => { equipment.value = Array.isArray(rows) ? rows : [] },
    reset: () => { equipment.value = [] },
    describe: (cause, fallback) => describeError(cause, fallback),
  })

  const equipmentForm = ref(emptyEquipmentForm())
  const equipmentImportOpen = ref(false)
  // 表单里的能力编码多选：写入码值数组，选项由系统配置目录供给（不在本组合式里另建目录）。
  const equipmentCodeSelection = computed({
    get: () => Array.isArray(equipmentForm.value.codes) ? equipmentForm.value.codes : [],
    set: (values) => { equipmentForm.value.codes = [...values] },
  })
  const equipmentCodeOptions = computed(() => codeOptions(equipmentCodeSelection.value))
  function toggleEquipmentCode(code) {
    toggleCodeSelection(equipmentCodeSelection.value, (values) => { equipmentCodeSelection.value = values }, code)
  }

  // 用途：进入编辑态；清空页面上仍打开的旧式多选菜单。
  // 参数：item 为设备目录行。
  // 返回值：无。
  function editEquipment(item) {
    if (!canManage.value || !item) return
    const codes = canonicalCodes(item.codes || [])
    equipmentForm.value = {
      resourceID: item.resource_id,
      resourceName: item.resource_name,
      codes,
      originalCodes: [...codes],
      validFrom: formatDate(item.valid_from),
      validUntil: formatDate(item.valid_until),
      status: item.status || 'ACTIVE',
      usageScope: item.usage_scope || 'ANY',
    }
    closeMulti()
  }

  // 用途：写成功后让目录失效；随后按需重新确认，读取失败按「已保存但读取失败」提示。
  // 参数：savedMessage 为写操作本身的成功文案。
  // 返回值：无；不重发业务写入。
  async function confirmAfterWrite(savedMessage) {
    notify(savedMessage)
    invalidateEquipmentCatalog()
    const refreshed = await loadEquipmentCatalog({ force: true })
    if (!refreshed) notify('已保存，但最新设备目录读取失败；请稍后点击「重试读取目录」核对。', 'warning')
  }

  // 用途：保存设备档案（新增或更新）。
  // 参数：无；读取 equipmentForm 与能力编码选择。
  // 返回值：保存完成；失败只提示操作失败。
  async function saveEquipment() {
    if (saving.value || !canManage.value) return
    if (!validateCodes(equipmentCodeSelection.value, equipmentForm.value.originalCodes || [])) return
    saving.value = true
    try {
      const item = await upsertEquipment({
        resource_id: equipmentForm.value.resourceID,
        resource_name: equipmentForm.value.resourceName,
        codes: [...equipmentCodeSelection.value],
        valid_from: equipmentForm.value.validFrom ? new Date(equipmentForm.value.validFrom).toISOString() : '',
        valid_until: equipmentForm.value.validUntil ? new Date(equipmentForm.value.validUntil).toISOString() : '',
        status: equipmentForm.value.status,
        usage_scope: equipmentForm.value.usageScope,
      })
      // 服务端已确认的写入结果先落到本地快照，避免等待刷新造成“看起来没保存”。
      equipment.value = [item, ...equipment.value.filter((row) => row.resource_id !== item.resource_id)]
      await confirmAfterWrite('设备信息已保存')
    } catch (error) {
      notify(formatUserError(error, { fallback: '设备信息保存失败' }), 'error')
    } finally {
      saving.value = false
    }
  }

  // 用途：删除设备档案（历史快照不受影响，由服务端保证）。
  // 参数：item 为设备目录行。
  // 返回值：删除完成；取消或失败不改动本地快照。
  async function removeEquipment(item) {
    if (saving.value || !canManage.value || !item?.resource_id) return
    const ok = await askConfirm({
      title: '删除设备？',
      description: `确定删除设备「${item.resource_name || item.resource_id}」吗？已归还或已完成项目中的历史设备快照不会受影响。`,
      confirmText: '删除设备',
      cancelText: '取消',
      danger: true,
    })
    if (!ok) return
    saving.value = true
    try {
      await deleteEquipment(item.resource_id)
      equipment.value = equipment.value.filter((row) => row.resource_id !== item.resource_id)
      await confirmAfterWrite(`设备 ${item.resource_name || item.resource_id} 已删除`)
    } catch (error) {
      notify(formatUserError(error, { fallback: '设备删除失败，请先确认设备未被实施计划占用' }), 'error')
    } finally {
      saving.value = false
    }
  }

  // 用途：归还设备：释放借出它的服务项占用；设备维护人员也能操作（现场可能提前寄回）。
  // 参数：item 为设备目录行。
  // 返回值：归还完成；占用读取独立于设备目录，失败不冒充“无占用”。
  async function returnEquipment(item) {
    if (saving.value) return
    const serviceItemID = item?.borrowed_service_item_id || reservationFor(item?.resource_id)?.service_item_id
    if (!serviceItemID) { notify('未找到借出该设备的服务项，请刷新后重试', 'warning'); return }
    saving.value = true
    try {
      await returnServiceItemEquipment(serviceItemID, item.resource_id)
      await Promise.all([confirmAfterWrite(`设备 ${item.resource_name || item.resource_id} 已归还`), reloadReservations()])
    } catch (error) {
      notify(formatUserError(error, { fallback: '归还失败，请稍后重试' }), 'error')
    } finally {
      saving.value = false
    }
  }

  // 用途：导入结果已由服务端写入，刷新台账失败不得说成导入失败。
  // 参数：result 为导入结果统计。
  // 返回值：导入完成；不重发导入请求。
  async function importEquipmentFile(result) {
    saving.value = true
    notify(`设备导入完成：成功 ${result.imported} 条${result.skipped ? `，失败 ${result.skipped} 条，请查看逐行结果` : ''}`, result.skipped ? 'warning' : 'success')
    try {
      invalidateEquipmentCatalog()
      const refreshed = await loadEquipmentCatalog({ force: true })
      if (!refreshed) notify('导入结果已保存，但最新设备目录读取失败；请稍后点击「重试读取目录」核对。', 'warning')
    } finally {
      saving.value = false
    }
  }

  return {
    equipment,
    equipmentLoading,
    equipmentError,
    equipmentConfirmed,
    ensureEquipmentCatalog,
    retryEquipmentCatalog,
    invalidateEquipmentCatalog,
    equipmentForm,
    equipmentImportOpen,
    equipmentCodeSelection,
    equipmentCodeOptions,
    toggleEquipmentCode,
    editEquipment,
    saveEquipment,
    removeEquipment,
    returnEquipment,
    importEquipmentFile,
  }
}
