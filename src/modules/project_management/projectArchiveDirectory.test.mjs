import test from 'node:test'
import assert from 'node:assert/strict'
import { projectArchiveEntries, loadReimbursementArchiveIndex } from './projectArchiveDirectory.js'

test('统一目录仅编目已授权项目快照，报告阶段不冒充原件封存', () => {
  const rows=projectArchiveEntries({id:'p',contract_id:'c',contract:'HT-1'},[
    {id:'i',project_id:'p',status:'ACTIVE',report_status:'ARCHIVED',report_revision:2},
    {id:'hidden',project_id:'other',report_status:'ARCHIVED'},
  ],[{id:'event',project_id:'p',service_item_id:'i',type:'DEVIATION_REPORTED'}])
  assert.deepEqual(rows.map(row=>row.kind),['CONTRACT','TASK','REPORT','EVENT'])
  assert.equal(rows.some(row=>row.id==='hidden'),false)
  assert.equal(rows.find(row=>row.kind==='REPORT').version,2)
  assert.equal(rows.find(row=>row.kind==='CONTRACT').target.query.keyword,'HT-1')
  assert.deepEqual(projectArchiveEntries(null,[],[]),[])
})

test('目录先核对独立报销会话主体与租户，再查原权限范围的归档聚合', async () => {
  const calls=[]
  const fetcher=async path=>{calls.push(path);return {ok:true,json:async()=>({data:path.endsWith('/auth/session')?
    {tenant_id:'t',subject_id:'u',permissions:['expense.archive.read','expense.claim.read']}:
    {items:[{project_id:'p',claim_count:2}],total:1,page:1,page_size:20,viewer:{tenant_id:'t',subject_id:'u'}}})}}
  const result=await loadReimbursementArchiveIndex(fetcher,'/reimbursement',{tenant_id:'t',identity_id:'u'},'p')
  assert.equal(result.items[0].claim_count,2)
  assert.deepEqual(calls,['/reimbursement/auth/session','/reimbursement/api/v1/archive-projects?project_id=p&page=1&page_size=20'])
  calls.length=0
  await assert.rejects(loadReimbursementArchiveIndex(fetcher,'/reimbursement',{tenant_id:'other',identity_id:'u'},'p'),/主体或租户/)
  assert.equal(calls.length,1)
  await assert.rejects(loadReimbursementArchiveIndex(fetcher,'//other',{tenant_id:'t',identity_id:'u'},'p'),/地址/)
})

test('目录无报销归档能力不读业务目录，服务失败不能变空目录',async()=>{
  const calls=[]
  await assert.rejects(loadReimbursementArchiveIndex(async path=>{calls.push(path);return {ok:true,json:async()=>({data:{
    tenant_id:'t',subject_id:'u',permissions:[]}})}},'/reimbursement',{tenant_id:'t',identity_id:'u'},'p'),/读取能力/)
  assert.equal(calls.length,1)
  await assert.rejects(loadReimbursementArchiveIndex(async()=>({ok:false,status:503,json:async()=>({message:'目录暂不可用'})}),
    '/reimbursement',{tenant_id:'t',identity_id:'u'},'p'),/目录暂不可用/)
})


test('报销会话在核对后切换，目录按响应绑定主体拒绝其他主体数据',async()=>{
  const fetcher=async path=>({ok:true,json:async()=>({data:path.endsWith('/auth/session')?
    {tenant_id:'t',subject_id:'u',permissions:['expense.archive.read','expense.claim.read']}:
    {items:[{project_id:'p',claim_count:7}],total:1,viewer:{tenant_id:'t',subject_id:'other'}}})})
  await assert.rejects(loadReimbursementArchiveIndex(fetcher,'/reimbursement',{tenant_id:'t',identity_id:'u'},'p'),/主体或租户/)
})
