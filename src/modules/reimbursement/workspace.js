import { formatMinor } from './api/client.js'

export const claimTypes = Object.freeze({ TRAVEL:'差旅', DAILY:'日常', PROJECT_EXECUTION:'项目执行' })

// 「我发起的审批」只展示已经提交过的单据：草稿尚未进入审批，不属于该入口。
// 与后端 /claims 的合法状态字符串保持完全一致（大小写敏感），多值由逗号分隔。
export const submittedClaimStatuses = Object.freeze([
  'IN_APPROVAL', 'RETURNED', 'APPROVED_PENDING_PAYMENT', 'PAID', 'VOID',
])

// 用途：仅接收站内路径，防止通知深链跳到外站或脚本协议。
// 参数：value为平台返回的业务目标路径。
// 返回值：安全路径；非法或缺失时返回空串。
export function safeNotificationPath(value) {
  return typeof value==='string' && value.startsWith('/') && !value.startsWith('//')
    && !/[\\\u0000-\u0020]/.test(value) ? value : ''
}

// 用途：按通知单据坐标读取本人当前待办，不依赖列表当前页。
// 参数：query 为通知的单据和任务标识；request 为经过认证的报销读取接口。
// 返回值：唯一任务标识或空串；非法坐标、读取异常和多任务需用户选择时抛错。
export async function notificationApprovalTaskID(query, request) {
  for (const key of ['task_id', 'claim_id']) {
    const value = query[key]
    if (value !== undefined && (typeof value !== 'string' || value.length > 128
      || /[\u0000-\u0020]/.test(value))) throw new Error('提醒中的审批坐标无效，请从待办列表重新选择。')
  }
  if (query.task_id) return query.task_id
  if (!query.claim_id) return ''
  const params = new URLSearchParams({ claim_id: query.claim_id, status: 'PENDING',
    page: '1', page_size: '100' })
  const result = await request(`/approval-tasks?${params}`)
  if (!Array.isArray(result?.items) || !Number.isFinite(result.total)) {
    throw new Error('审批待办响应不完整，请重新读取。')
  }
  const matches = result.items.filter(row => row.claim_id === query.claim_id && row.status === 'PENDING')
  if (matches.length > 1 || result.total > result.items.length) {
    throw new Error('该单据关联多项审批待办，请从当前任务列表选择对应节点。')
  }
  return matches[0]?.id || ''
}

// 用途：把服务端整数分渲染为元，供轮次差异对照使用。
// 参数：value 为服务端金额字段（整数分）或其它可读文本。
// 返回值：元金额文本；非整数分保持原文，空值显示未设置。
function moneyLabel(value) {
  const text = String(value ?? '').trim()
  if (!text) return '未设置'
  return /^-?\d+$/.test(text) ? `${formatMinor(text)} 元` : text
}

// 用途：比较两个已授权快照的关键可写字段，不把范围裁剪当业务增删。
// 参数：before为旧快照，after为新快照，两者均由受控接口提供。
// 返回值：带字段标签及前后原值的差异；金额统一以元展示，受限视图仅比较共同费用。
export function claimChanges(before,after) {
  if(!before || !after)return []
  const changes=[]
  for(const [key,label] of [['title','标题'],['claim_type','报销类型'],['remark','备注'],['org_id','费用组织']]) {
    if((before[key] || '')!==(after[key] || ''))changes.push({label,before:before[key] || '未设置',after:after[key] || '未设置'})
  }
  const left=new Map((before.items || []).map(row=>[row.id,row]))
  const right=new Map((after.items || []).map(row=>[row.id,row]))
  const limited=before.scope_limited || after.scope_limited
  for(const id of new Set([...left.keys(),...right.keys()])) {
    const old=left.get(id),current=right.get(id)
    if(!old || !current) {
      if(!limited)changes.push({label:`费用${id}`,before:old?'原费用':'无',after:current?'新增':'已移除'})
      continue
    }
    for(const [key,label] of [['fee_type','类别'],['occurred_date','日期'],['requested_minor','金额'],['exception_reason','例外说明']]) {
      const before=key==='requested_minor'?moneyLabel(old[key]):(old[key] || '未设置')
      const after=key==='requested_minor'?moneyLabel(current[key]):(current[key] || '未设置')
      if(before!==after)changes.push({label:`费用${id}${label}`,before,after})
    }
  }
  return changes
}

// 用途：将业务子入口映射到现有数据区，保留独立导航语义。
// 参数：workspace 为路由中选择的工作区。
// 返回值：现有列表和表单所属区域。
export function workspaceSection(workspace) {
  if (['invoice-upload','invoice-abnormal'].includes(workspace)) return 'invoices'
  if (workspace === 'submitted') return 'claims'
  return workspace
}

// 用途：构造有界业务筛选查询，特殊入口不能丢失固有约束。
// 参数：workspace为入口，filters为表单，page/size为分页，project为来源项目。
// 返回值：URL编码查询；无效日期等由服务端做权威拒绝。
export function workspaceQuery(workspace, filters, page, size, project) {
  const query = new URLSearchParams({page:String(page),page_size:String(size)})
  for (const key of ['q','status','claim_type','applicant_subject_id','date_from','date_to',
    'invoice_type','verification_status','review_status','route_type']) {
    const value = String(filters[key] || '').trim()
    if (value) query.set(key,value)
  }
  if (project) query.set('project_id',String(project))
  if (workspace==='invoice-abnormal') query.set('exception_only','true')
  if (workspace==='submitted') {
    query.set('mine','true')
    // 兼容旧深链的多状态筛选，同时维持审批入口的已提交范围。
    const statuses = (query.get('status') || '').split(',')
      .map(status => status.trim()).filter(status => submittedClaimStatuses.includes(status))
    query.set('status', (statuses.length ? statuses : submittedClaimStatuses).join(','))
  }
  return query.toString()
}

// 用途：上传前一次校验整批文件，不截断列表或启动半批非法请求。
// 参数：files为用户选择或拖入文件，purpose为受控原件/证据用途。
// 返回值：文件和真实声明格式；数量、大小或格式非法时抛错。
export function uploadFiles(files, purpose) {
  const values = Array.from(files || [])
  if (!values.length || values.length>20) throw new Error('每批请选择1至20个文件')
  const original = purpose === 'reimbursement.invoice.original'
  return values.map(file=>{
    if (!file.size || file.size>20*1024*1024) throw new Error('每个文件必须在20MiB以内')
    const extension = String(file.name).split('.').pop().toLowerCase()
    const media = file.type || ({pdf:'application/pdf',ofd:'application/ofd',png:'image/png',
      jpg:'image/jpeg',jpeg:'image/jpeg'})[extension]
    const allowed = ['application/pdf','image/png','image/jpeg',
      ...(original ? ['application/ofd','application/vnd.ofd']:[])]
    if (!allowed.includes(media)) throw new Error('请选择PDF、PNG、JPEG或票据OFD格式')
    return {file,media_type:media}
  })
}
