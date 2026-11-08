import { computed, ref } from 'vue'
import { catalogSelectionIDs, emptyOpportunity, mergeCatalogOptions } from '../crmDisplay.js'
import { useOpportunityCustomerDirectory } from './useOpportunityCustomerDirectory.js'

/**
 * 商机新建/编辑弹窗的编辑域（前端优化计划 阶段 3-CRM，自 CustomerOpportunityView.vue 迁移）。
 *
 * 职责边界：
 * - 商机表单本体、弹窗开关、编辑态与脏检查基线都由父层创建并持有，这里通过同一引用回填/清空，
 *   因此弹窗组件异步加载、加载失败重试或重新挂载都不会产生第二份表单，已输入内容不丢；
 * - 目录读取（关联客户下拉、商机类型/来源）收在这里；读取失败只落可重试的错误态，
 *   重试只影响选项，不会触发任何业务写入；
 * - 不持有提交入口：创建/更新（更新原因、类型来源校验、幂等重放）仍由父层 submitOpportunity
 *   唯一执行，子组件只上抛 submit 事件；
 * - 关闭确认（未保存拦截）留在父层 closeOpportunityDialog。
 *
 * 注入项与组件内同名标识一一对应：form（父层 opportunityForm 同一份 reactive 对象）、
 * dialog/editMode（父层弹窗状态）、setSnapshot（父层登记脏检查基线）、
 * selectedOpportunity/selectedOpportunityOwnerOrgID（编辑态回填依据）、
 * listCustomers/listOpportunityCatalogItems/formatCRMError（父层注入的数据依赖，避免组合式函数直接绑定 API）。
 */
export function useOpportunityEditor({
  form, dialog, editMode, setSnapshot,
  selectedOpportunity, selectedOpportunityOwnerOrgID,
  listCustomers, listOpportunityCatalogItems, formatCRMError,
}) {
  // 类型/来源是结构化多选：勾选值留在弹窗域，提交时再同步成表单里的展示文本与 ID 列表。
  const typeSelections = ref([])
  const sourceSelections = ref([])
  const typeOptions = ref([])
  const sourceOptions = ref([])
  const catalogLoading = ref(false)
  const catalogError = ref('')

  const {
    opportunityCustomerOptions: customerOptions,
    opportunityCustomerOptionsLoading: customerOptionsLoading,
    opportunityCustomerOptionsError: customerOptionsError,
    opportunityCustomerOptionsTotal: customerOptionsTotal,
    opportunityCustomerKeyword: customerKeyword,
    loadOpportunityCustomerOptions: loadCustomerOptions,
  } = useOpportunityCustomerDirectory({
    listCustomers,
    formatCRMError,
    // 与拆分前一致：编辑态不回填客户下拉（编辑时客户只读展示，不允许改归属）。
    isDialogOpen: () => editMode.value,
    selectedCustomerID: () => form.customer_id,
    clearSelectedCustomer: () => { form.customer_id = '' },
  })

  // 停用的目录项只在历史商机的已选集合里保留，新建时不可再选。
  const typeSelectOptions = computed(() => mergeCatalogOptions(typeOptions.value, editMode.value ? selectedOpportunity.value?.types : []))
  const sourceSelectOptions = computed(() => mergeCatalogOptions(sourceOptions.value, editMode.value ? selectedOpportunity.value?.sources : []))

  // 用途：读取商机类型与来源目录；失败清空选项并保留可重试错误，不伪装成“没有可选项”。
  // 参数：无。
  // 返回值：无。
  async function loadCatalogOptions() {
    catalogLoading.value = true
    catalogError.value = ''
    try {
      const [types, sources] = await Promise.all([listOpportunityCatalogItems('TYPE'), listOpportunityCatalogItems('SOURCE')])
      typeOptions.value = Array.isArray(types) ? types : []
      sourceOptions.value = Array.isArray(sources) ? sources : []
      if (!typeOptions.value.length || !sourceOptions.value.length) throw new Error('商机基础数据为空，请联系有权限的管理员配置。')
    } catch (value) {
      typeOptions.value = []
      sourceOptions.value = []
      catalogError.value = formatCRMError(value, { fallback: '商机类型和来源加载失败。' })
    } finally {
      catalogLoading.value = false
    }
  }

  // 用途：把勾选集合同步成表单里的类型/来源 ID 与展示名，提交载荷仍读表单。
  // 参数：无。
  // 返回值：无。
  function syncSelections() {
    const typeIDs = typeSelections.value.map(Number)
    const sourceIDs = sourceSelections.value.map(Number)
    form.type_ids = typeIDs
    form.source_ids = sourceIDs
    form.type = typeSelectOptions.value.filter((item) => typeIDs.includes(Number(item.id))).map((item) => item.name).join('、')
    form.source = sourceSelectOptions.value.filter((item) => sourceIDs.includes(Number(item.id))).map((item) => item.name).join('、')
  }

  // 用途：切换一个多选项并立即同步表单；顺序沿用原 v-model 数组的追加语义。
  // 参数：target 为勾选集合 ref；id 为目录项 ID；checked 为勾选状态。
  // 返回值：无。
  function toggleSelection(target, id, checked) {
    const next = new Set(target.value.map(Number))
    if (checked) next.add(Number(id))
    else next.delete(Number(id))
    target.value = [...next]
    syncSelections()
  }

  function toggleType(id, checked) { return toggleSelection(typeSelections, id, checked) }
  function toggleSource(id, checked) { return toggleSelection(sourceSelections, id, checked) }

  // 用途：登记打开时的表单快照并显示弹窗。
  // 参数：无。
  // 返回值：无。
  function markOpened() {
    setSnapshot(JSON.stringify(form))
    dialog.value = true
  }

  // 用途：打开空白的新建商机表单，并加载客户下拉与类型/来源目录。
  // 参数：无。
  // 返回值：无；目录读取失败只落错误态，表单保持打开。
  async function openNew() {
    Object.assign(form, emptyOpportunity())
    typeSelections.value = []
    sourceSelections.value = []
    editMode.value = false
    customerKeyword.value = ''
    customerOptions.value = []
    customerOptionsTotal.value = 0
    markOpened()
    await Promise.all([loadCustomerOptions(), loadCatalogOptions()])
  }

  // 用途：用当前选中商机回填编辑表单；负责人组织取服务端返回的组织归属。
  // 参数：opportunity 为当前选中商机详情。
  // 返回值：无；目录读取失败同样保留表单并显示可重试错误。
  async function openEdit(opportunity) {
    await loadCatalogOptions()
    Object.assign(form, {
      name: opportunity.name, customer_id: opportunity.customer_id, type: opportunity.type, source: opportunity.source,
      expected_amount: opportunity.expected_amount, expected_sign_date: opportunity.expected_sign_date,
      requirement_summary: opportunity.requirement_summary, system_count: opportunity.system_count || 0,
      pain_points: opportunity.pain_points || '', competitor_info: opportunity.competitor_info || '',
      owner_user_id: opportunity.owner_user_id, owner_org_id: selectedOpportunityOwnerOrgID.value, reason: '',
    })
    typeSelections.value = catalogSelectionIDs(opportunity.types, opportunity.type, typeSelectOptions.value)
    sourceSelections.value = catalogSelectionIDs(opportunity.sources, opportunity.source, sourceSelectOptions.value)
    syncSelections()
    editMode.value = true
    markOpened()
  }

  return {
    typeSelections, sourceSelections,
    typeSelectOptions, sourceSelectOptions,
    catalogLoading, catalogError,
    customerOptions, customerOptionsLoading, customerOptionsError, customerOptionsTotal, customerKeyword,
    loadCustomerOptions, loadCatalogOptions, syncSelections, toggleType, toggleSource,
    openNew, openEdit,
  }
}
