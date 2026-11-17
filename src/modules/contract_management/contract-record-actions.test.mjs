import test from 'node:test'
import assert from 'node:assert/strict'
import { useContractRecordActions } from './composables/useContractRecordActions.js'
import { canManageContractRecords, isContractRecordMutation } from './utils/contractRecord.js'

test('合同管理必须有管理员与两个精确权限', () => {
  assert.equal(canManageContractRecords({ roles: ['admin'], permissions: ['all'] }), false)
  assert.equal(canManageContractRecords({ roles: ['sales'], permissions: ['contract.read', 'contract.delete'] }), false)
  assert.equal(canManageContractRecords({ roles: ['admin'], permissions: ['contract.read', 'contract.delete'] }), true)
})

test('同目标回执可证明当前状态而不冒充再次升版', () => {
  assert.equal(isContractRecordMutation({ id:'C',version:3,record_state:'deleted',changed:false },'C',3,'deleted'),true)
  assert.equal(isContractRecordMutation({ id:'C',version:3,record_state:'deleted',changed:true },'C',3,'deleted'),false)
})

test('冲突重新预检但保留原因，并发点击只写一次', async () => {
  let reads=0,writes=0,release
  const api={previewContractDeletion:async()=>({id:'C',version:++reads,can_delete:true,record_state:'active'}),
    deleteContractRecord:async()=>{writes++;await new Promise((resolve)=>{release=resolve});throw Object.assign(new Error('版本变化'),{status:409})}}
  const action=useContractRecordActions({api})
  await action.openRecord('C');action.reason.value='误建合同'
  const first=action.submit();await action.submit();release();await first
  assert.equal(writes,1);assert.equal(reads,2);assert.equal(action.reason.value,'误建合同')
  assert.equal(action.preview.value.version,2);assert.equal(action.opened.value,true)
})

test('未知结果仅允许人工读取核对，不重发删除', async () => {
  let writes=0,reads=0,verified=0
  const api={previewContractDeletion:async()=>({id:'C',version:++reads,can_delete:reads===1,record_state:reads===1?'active':'deleted'}),
    deleteContractRecord:async()=>{writes++;throw Object.assign(new Error('连接中断'),{outcomeUnknown:true})}}
  const action=useContractRecordActions({api,onChanged:()=>{verified++}})
  await action.openRecord('C');action.reason.value='误建'
  await action.submit();await action.submit()
  assert.equal(writes,1);assert.equal(action.unknown.value,true)
  await action.refresh();assert.equal(writes,1);assert.equal(verified,1);assert.equal(action.opened.value,false)
})

test('迟到预检不能覆盖新合同的弹窗', async () => {
  let finish
  const api={previewContractDeletion:(id)=>id==='old'?new Promise((resolve)=>{finish=resolve}):Promise.resolve({id,version:1,can_delete:true})}
  const action=useContractRecordActions({api})
  const old=action.openRecord('old');await action.openRecord('new');finish({id:'old',version:8,can_delete:true});await old
  assert.equal(action.preview.value.id,'new')
})
