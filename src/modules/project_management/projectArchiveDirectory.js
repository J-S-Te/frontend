import { principalIdentityID } from '../shared/authz/sessionCompatibility.js'
import { createDownloadTimeoutSignal } from '../shared/utils/downloadTimeout.js'

// 用途：从当前已授权项目快照编目引用，不宣称业务记录已封存成文件。
// 参数：project为可见项目，items/events为相同范围内的服务项和交付记录。
// 返回值：统一来源目录；不生成下载票据或扩大任何子系统权限。
export function projectArchiveEntries(project, items = [], events = []) {
  if (!project?.id) return []
  const rows=[]
  if (project.contract_id) rows.push({kind:'CONTRACT',id:project.contract_id,
    label:project.contract || project.contract_id,version:project.contract_version,
    status:'引用；原件状态以合同系统为准',target:{name:'contract_management',params:{section:'contracts'},
      query:{keyword:project.contract || project.contract_id}}})
  const visible=items.filter(item=>item.project_id===project.id)
  for (const item of visible) {
    rows.push({kind:'TASK',id:item.id,label:`${item.category || '服务项'} · ${item.id}`,
      version:item.version,status:item.status,service:item})
    if(item.report_status)rows.push({kind:'REPORT',id:item.id,label:`服务项 ${item.id} 报告`,
      version:item.report_revision,status:item.report_status,service:item})
  }
  const ids=new Set(visible.map(item=>item.id))
  for(const event of events) {
    if(event.project_id!==project.id && !ids.has(event.service_item_id))continue
    rows.push({kind:'EVENT',id:event.id,label:event.type || '交付记录',
      version:event.version,status:event.created_at || event.occurred_at || '项目记录',event})
  }
  return rows
}

// 用途：读取独立系统的标准data信封，保留认证、权限与依赖失败语义。
// 参数：fetcher为同源请求，path为固定路径。
// 返回值：服务端data；HTTP/信封错误时抛出明确错误。
async function directoryData(fetcher,path) {
  // 旧版 Safari 没有 AbortSignal.timeout，统一走共享的降级超时信号，避免请求全部失败。
  const timeout=createDownloadTimeoutSignal(15000)
  try {
    const response=await fetcher(path,{credentials:'include',cache:'no-store',signal:timeout.signal})
    const value=await response.json().catch(()=>null)
    if(!response.ok || !value || !Object.hasOwn(value,'data')) {
      throw new Error(value?.message || '目录读取失败，请先打开对应子系统确认登录和权限')
    }
    return value.data
  } finally {
    timeout.dispose()
  }
}

// 用途：核对两个独立会话主体后读取报销自己的当前授权档案目录。
// 参数：fetcher为同源网络边界，prefix为报销公开前缀，session为项目会话，projectID为项目坐标。
// 返回值：报销侧授权聚合；身份不一致或无能力时不读取业务目录。
export async function loadReimbursementArchiveIndex(fetcher,prefix,session,projectID) {
  if(!/^\/[A-Za-z0-9_/-]+$/.test(prefix) || prefix.startsWith('//'))throw new Error('报销目录地址无效')
  if(!projectID || projectID.length>128)throw new Error('项目坐标无效')
  const current=await directoryData(fetcher,`${prefix}/auth/session`)
  const identity=session?.subject_id || principalIdentityID(session)
  if(!identity || !session?.tenant_id || current.tenant_id!==session.tenant_id || current.subject_id!==identity) {
    throw new Error('项目与报销当前主体或租户不一致，请分别确认登录')
  }
  if(!Array.isArray(current.permissions) || !['expense.archive.read','expense.claim.read'].every(code=>current.permissions?.includes(code))) {
    throw new Error('当前报销会话没有档案读取能力，请在报销系统申请授权')
  }
  const query=new URLSearchParams({project_id:projectID,page:'1',page_size:'20'})
  const result=await directoryData(fetcher,`${prefix}/api/v1/archive-projects?${query}`)
  if(result?.viewer?.tenant_id!==session.tenant_id || result?.viewer?.subject_id!==identity) {
    throw new Error('目录响应的主体或租户已变化，请重新确认报销登录')
  }
  if(!Array.isArray(result?.items) || result.items.length>20 || !Number.isInteger(result.total)) {
    throw new Error('报销档案目录响应不完整')
  }
  if(result.items.some(row=>row.project_id!==projectID))throw new Error('报销目录返回其他项目，已拒绝展示')
  return result
}
