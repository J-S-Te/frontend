import test from 'node:test'
import assert from 'node:assert/strict'
import { workspaceQuery, uploadFiles, safeNotificationPath,claimChanges,submittedClaimStatuses } from './workspace.js'

test('一期列表查询保留筛选坐标和分页，异常池/我发起的绑定正式查询', () => {
  assert.equal(workspaceQuery('claims',{q:' EXP 1 ',date_from:'2026-11-01'},2,20,''),
    'page=2&page_size=20&q=EXP+1&date_from=2026-11-01')
  assert.equal(workspaceQuery('invoice-abnormal',{},1,20,''),'page=1&page_size=20&exception_only=true')
  const submitted = new URLSearchParams(workspaceQuery('submitted',{},1,20,''))
  assert.equal(submitted.get('mine'),'true')
  assert.equal(submitted.get('status'),submittedClaimStatuses.join(','))
})

test('我发起的审批默认覆盖全部已提交状态，选中页签只传所选状态', () => {
  // 默认请求不能退化成只查审批中，否则已退回/已付款/已作废单据会从入口消失。
  const defaults = new URLSearchParams(workspaceQuery('submitted',{},1,20,'')).get('status').split(',')
  for (const status of ['IN_APPROVAL','RETURNED','APPROVED_PENDING_PAYMENT','PAID','VOID']) {
    assert.ok(defaults.includes(status),`默认状态缺少 ${status}`)
  }
  assert.equal(defaults.includes('DRAFT'),false,'草稿不属于我发起的审批')
  for (const status of ['IN_APPROVAL','RETURNED','APPROVED_PENDING_PAYMENT','PAID','VOID']) {
    const query = new URLSearchParams(workspaceQuery('submitted',{status},1,20,''))
    assert.equal(query.get('status'),status)
    assert.equal(query.get('mine'),'true')
  }
  // 普通「我的报销单」仍按手工筛选传状态，不受我发起的审批入口约束。
  const claims = new URLSearchParams(workspaceQuery('claims',{status:'RETURNED'},1,20,''))
  assert.equal(claims.get('status'),'RETURNED')
  assert.equal(claims.has('mine'),false)
})

test('原件批量支持20张图片PDF/OFD，不截断、不把文件大小与数量混淆', () => {
  const files = Array.from({length:20},(_,n)=>({ name:n+'.png',type:'image/png',size:1024 }))
  assert.equal(uploadFiles(files,'reimbursement.invoice.original').length,20)
  assert.throws(()=>uploadFiles([...files,files[0]],'reimbursement.invoice.original'),/20/)
  assert.throws(()=>uploadFiles([{name:'bad.exe',type:'application/x-msdownload',size:1}],
    'reimbursement.invoice.original'),/格式/)
  assert.throws(()=>uploadFiles([{name:'large.pdf',type:'application/pdf',size:21*1024*1024}],
    'reimbursement.invoice.original'),/20MiB/)
})

test('通知深链仅保留应用内路径，拒绝外部及脚本地址',()=>{
  assert.equal(safeNotificationPath('/reimbursement/claims?claim_id=c'),'/reimbursement/claims?claim_id=c')
  for(const value of ['https://evil.invalid','//evil.invalid','/\\evil.invalid','javascript:alert(1)','/a\nb']) {
    assert.equal(safeNotificationPath(value),'')
  }
})

test('轮次关键字段差异来自真实快照，不把受限范围变化当费用增删',()=>{
  const before={title:'原申请',payable_minor:'100',items:[{id:'i',fee_type:'TRAVEL',requested_minor:'100'}]}
  const after={title:'补充申请',payable_minor:'200',items:[{id:'i',fee_type:'TRAVEL',requested_minor:'200'},{id:'j',requested_minor:'1'}]}
  const changes=claimChanges(before,after)
  assert.ok(changes.some(row=>row.label==='标题' && row.before==='原申请' && row.after==='补充申请'))
  assert.ok(changes.some(row=>row.label==='费用i金额' && row.before==='1.00 元' && row.after==='2.00 元'))
  assert.ok(changes.some(row=>row.label==='费用j' && row.before==='无' && row.after==='新增'))
  assert.equal(claimChanges({...before,scope_limited:true},after).some(row=>row.label==='费用j'),false)
})
