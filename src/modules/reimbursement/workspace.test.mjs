import test from 'node:test'
import assert from 'node:assert/strict'
import { workspaceQuery, uploadFiles, safeNotificationPath,claimChanges } from './workspace.js'

test('一期列表查询保留筛选坐标和分页，异常池/我发起的绑定正式查询', () => {
  assert.equal(workspaceQuery('claims',{q:' EXP 1 ',date_from:'2026-11-01'},2,20,''),
    'page=2&page_size=20&q=EXP+1&date_from=2026-11-01')
  assert.equal(workspaceQuery('invoice-abnormal',{},1,20,''),'page=1&page_size=20&exception_only=true')
  assert.equal(workspaceQuery('submitted',{},1,20,''),'page=1&page_size=20&mine=true&status=IN_APPROVAL')
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
  assert.ok(changes.some(row=>row.label==='费用i金额' && row.before==='100' && row.after==='200'))
  assert.ok(changes.some(row=>row.label==='费用j' && row.before==='无' && row.after==='新增'))
  assert.equal(claimChanges({...before,scope_limited:true},after).some(row=>row.label==='费用j'),false)
})
