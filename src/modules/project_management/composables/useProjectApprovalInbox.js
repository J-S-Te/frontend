import { onScopeDispose, ref, watch } from 'vue'
import { formatUserError } from '../../shared/utils/userError.js'
import { approvalTypeLabel } from '../approvalTasks.js'

// 用途：独立查询审批待办并提交受版本保护的决定，隔离路由和身份变化后的旧回执。
// 参数：requestID/context/userID 为响应式申请及会话上下文，其余为真实远程读写和通知边界。
// 返回值：分页状态、可重试反馈、查询和审批入口；不在详情读取时自动写入。
export function useProjectApprovalInbox({ requestID, context, userID,
  listApprovalTasks, decideRollback, decideReportCorrection, onChanged }) {
  const items = ref([])
  const total = ref(0)
  const page = ref(1)
  const view = ref('assigned')
  const loading = ref(false)
  const saving = ref(false)
  const error = ref('')
  const success = ref('')
  const pageSize = 20
  let generation = 0
  let disposed = false

  // 用途：确认读取或写回仍属于当前页面与身份。
  // 参数：ticket 为开始操作时捕获的读取代次。
  // 返回值：当前组件未卸载且代次一致时返回 true。
  function current(ticket) {
    return !disposed && ticket === generation
  }

  // 用途：查询服务端受权分页或精确申请，清除过期结果以免重复审批。
  // 参数：无；查询条件来自当前路由、视图和页码。
  // 返回值：成功读取为 true，失败或响应失效为 false。
  async function load() {
    if (disposed) return false
    const ticket = ++generation
    const id = String(requestID.value || '')
    const query = { page: id ? 1 : page.value, page_size: pageSize, view: view.value }
    if (id) query.request_id = id
    loading.value = true
    error.value = ''
    items.value = []
    total.value = 0
    try {
      const result = await listApprovalTasks(query)
      if (!current(ticket)) return false
      if (!Array.isArray(result?.items) || !Number.isFinite(Number(result.total))) {
        throw new Error('审批待办响应异常，请重新加载。')
      }
      const rows = id ? result.items.filter(item => item.id === id) : result.items
      if (id && rows.length !== 1) throw new Error('申请不存在或当前账号无权查看。')
      items.value = rows
      total.value = Number(result.total)
      const pages = Math.max(1, Math.ceil(total.value / pageSize))
      if (!id && page.value > pages) {
        page.value = pages
        return await load()
      }
      return true
    } catch (cause) {
      if (!current(ticket)) return false
      error.value = cause?.status === 403 ? '当前账号无权查看该审批申请。'
        : cause?.status === 404 ? '申请不存在或当前账号无权查看。'
          : formatUserError(cause, { fallback: '审批待办加载失败，请重试。' })
      return false
    } finally { if (current(ticket)) loading.value = false }
  }

  // 用途：切换我的待审批和我提交的申请。
  // 参数：next 为 assigned 或 submitted。
  // 返回值：重置到首页后的读取结果；忙碌或非法视图时返回 false。
  function changeView(next) {
    if (saving.value || !['assigned', 'submitted'].includes(next)) return Promise.resolve(false)
    view.value = next
    page.value = 1
    success.value = ''
    return load()
  }

  // 用途：切换服务端分页，避免越界或忙碌时改变审批上下文。
  // 参数：next 为目标页码。
  // 返回值：合法页码的读取结果；非法或忙碌时返回 false。
  function changePage(next) {
    if (saving.value || !Number.isInteger(next) || next < 1) return Promise.resolve(false)
    page.value = next
    success.value = ''
    return load()
  }

  // 用途：依据当前受权结果决定是否展示审批操作，服务端仍做最终校验。
  // 参数：task 为当前列表内的申请。
  // 返回值：申请待处理、可审批、异人且版本有效时返回 true。
  function canDecide(task) {
    return !!userID.value && !loading.value && !saving.value && !!task
      && items.value.includes(task) && task.status === 'PENDING' && task.can_decide === true
      && task.requester_user_id !== userID.value && !!task.id && !!task.service_item_id
      && ['REPORT_REWORK', 'REPORT_CORRECTION', 'FIELD_ROLLBACK'].includes(task.type)
      && Number.isSafeInteger(task.version) && task.version >= 0
  }

  // 用途：批准或驳回当前申请；成功和后续刷新失败分别反馈，阻止重复写入。
  // 参数：task 为当前申请，decision 为决定，comment 为必填审批意见。
  // 返回值：已收到业务写成功回执时返回 true；未写入、失败或回执过期时返回 false。
  async function decide(task, decision, comment) {
    if (!canDecide(task) || !['APPROVED', 'REJECTED'].includes(decision)) return false
    const opinion = String(comment || '').trim()
    if (!opinion || opinion.length > 1000) {
      error.value = '请填写 1 至 1000 字审批意见。'
      return false
    }
    const ticket = generation
    const payload = { decision, comment: opinion, expected_version: task.version }
    saving.value = true
    error.value = ''
    success.value = ''
    try {
      const command = task.type === 'REPORT_CORRECTION' ? decideReportCorrection : decideRollback
      await command(task.service_item_id, task.id, payload)
    } catch (cause) {
      if (current(ticket)) {
        if (cause?.status === 409) {
          const reading = load(), readTicket = generation
          await reading
          if (current(readTicket)) {
            error.value = `申请状态或版本已变化，请核对最新结果。${error.value}`
          }
        } else error.value = formatUserError(cause, { fallback: '审批失败，请刷新后重试。' })
      }
      saving.value = false
      return false
    }
    if (!current(ticket)) {
      saving.value = false
      return false
    }
    success.value = `${approvalTypeLabel(task.type)}申请${decision === 'APPROVED' ? '已批准' : '已驳回'}。`
    items.value = []
    total.value = 0
    const reading = load(), readTicket = generation
    const read = await reading
    if (!current(readTicket)) {
      saving.value = false
      return false
    }
    if (!read) error.value = `审批已保存，但最新结果读取失败。${error.value}`
    onChanged?.()
    saving.value = false
    return true
  }

  watch([requestID, context, userID], () => {
    generation += 1
    items.value = []
    total.value = 0
    page.value = 1
    error.value = ''
    success.value = ''
    void load()
  }, { flush: 'sync' })
  onScopeDispose(() => {
    disposed = true
    generation += 1
  })
  return { items, total, page, view, pageSize, loading, saving, error, success,
    load, changeView, changePage, canDecide, decide }
}
