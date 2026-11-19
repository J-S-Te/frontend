import { computed, onScopeDispose, ref, watch } from 'vue'

// 用途：区分本地已审阅的定位提示与远端不可直接展示的错误原因。
// 参数：message 为固定的中文业务提示。
// 返回值：可安全展示的定位错误，不携带远端内部详情。
function targetReadError(message) {
  return Object.assign(new Error(message), { approvalTargetValidation: true })
}

// 用途：解析原业务页审批实例，拒绝重复或冲突查询坐标。
// 参数：section 为当前栏目，query 为路由查询参数。
// 返回值：已知精确坐标或空值；非法参数抛出可理解错误。
function coordinates(section, query) {
  const enabled = (section === 'methods' && (Object.hasOwn(query, 'service_item_id')
    || Object.hasOwn(query, 'review_id')))
    || (section === 'exceptions' && Object.hasOwn(query, 'deviation_id'))
    || (section === 'project_detail' && Object.hasOwn(query, 'scope_change_id'))
  if (!enabled) return null
  const keys = ['service_item_id', 'project', 'deviation_id', 'scope_change_id', 'review_id']
  const values = {}
  for (const key of keys) {
    if (!Object.hasOwn(query, key)) continue
    if (typeof query[key] !== 'string'
      || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(query[key])) {
      throw new Error('审批通知参数格式不正确，请从待办重新进入。')
    }
    values[key] = query[key]
  }
  const itemID = values.service_item_id || '', projectID = values.project || ''
  if (section === 'methods' && (itemID || values.review_id)) {
    return { type: 'SPECIAL_METHOD_REVIEW', id: values.review_id || itemID,
      itemID, projectID, historical: !!values.review_id }
  }
  if (section === 'exceptions' && values.deviation_id) {
    return { type: 'FIELD_DEVIATION', id: values.deviation_id, itemID, projectID }
  }
  if (section === 'project_detail' && values.scope_change_id) {
    return { type: 'NATIVE_SCOPE_CHANGE', id: values.scope_change_id, itemID, projectID }
  }
  return null
}

// 用途：精确读取审批及原业务资源，避免有界工作区和历史链接选到另一申请。
// 参数：route/section 为页面坐标，context 为身份范围，ready/busy 为加载及保存门禁，api 为授权读取。
// 返回值：精确申请与原资源、可处理状态和重读动作；失败显式保留未知状态。
export function useProjectApprovalDeepLink({ route, section, context, ready, busy, api }) {
  const task = ref(null), serviceItem = ref(null), project = ref(null)
  const loading = ref(false), error = ref('')
  let generation = 0, disposed = false, selection = ''
  const requested = computed(() => {
    try { return coordinates(section.value, route.query) }
    catch (cause) { return { invalid: cause.message } }
  })
  const canProcess = computed(() => !loading.value && !busy.value && !error.value
    && !requested.value?.historical && task.value?.status === 'PENDING'
    && task.value.can_decide === true)

  // 用途：读取指定类型的唯一授权申请及单条业务资源，不依赖当前分页。
  // 参数：无；使用当前路由与授权上下文。
  // 返回值：无；迟到响应作废，已处理记录保留只读结果。
  async function load() {
    const ticket = ++generation, target = requested.value
    const signature = JSON.stringify([target, context.value])
    const changed = signature !== selection
    selection = signature
    if (busy.value) {
      if (changed) { task.value = null; serviceItem.value = null; project.value = null; error.value = '' }
      loading.value = false
      return
    }
    task.value = null; serviceItem.value = null; project.value = null; error.value = ''
    loading.value = false
    if (!target || !ready.value || disposed) return
    if (target.invalid) { error.value = target.invalid; return }
    loading.value = true
    try {
      const page = await api.listApprovalTasks({ request_id: target.id, task_type: target.type,
        page: 1, page_size: 1, view: 'assigned' })
      if (disposed || ticket !== generation) return
      if (!Array.isArray(page?.items) || page.items.length !== 1 || Number(page.total) !== 1) {
        throw targetReadError('该申请不存在或当前账号无权查看，请返回待办核对。')
      }
      const value = page.items[0]
      if (value.id !== target.id || value.type !== target.type || !value.project_id
        || (target.projectID && value.project_id !== target.projectID)
        || (target.itemID && value.service_item_id !== target.itemID)) {
        throw targetReadError('申请与通知业务坐标不一致，请返回待办核对。')
      }
      const parent = await api.getProject(value.project_id)
      if (disposed || ticket !== generation) return
      if (parent?.id !== value.project_id) throw targetReadError('项目读取结果无法确认，请重新读取。')
      let item = null
      if (target.type !== 'NATIVE_SCOPE_CHANGE') {
        const snapshot = await api.listServiceItemsSnapshot(value.project_id, value.service_item_id)
        if (disposed || ticket !== generation) return
        if (!Array.isArray(snapshot?.items) || snapshot.items.length !== 1
          || snapshot.items[0].id !== value.service_item_id
          || snapshot.items[0].project_id !== value.project_id) {
          throw targetReadError('服务项读取结果无法确认，请重新读取。')
        }
        item = snapshot.items[0]
      }
      project.value = parent; serviceItem.value = item; task.value = value
    } catch (cause) {
      if (disposed || ticket !== generation) return
      error.value = cause?.status === 403 || cause?.status === 404
        ? '该申请不存在或当前账号无权查看，请返回待办核对。'
        : cause?.approvalTargetValidation === true ? cause.message
          : '审批详情暂时读取失败，请稍后重试。'
    } finally { if (!disposed && ticket === generation) loading.value = false }
  }
  watch([requested, context, ready, busy], load, { immediate: true, flush: 'sync' })
  onScopeDispose(() => { disposed = true; generation += 1 })
  return { task, serviceItem, project, loading, error, requested, canProcess, load }
}
