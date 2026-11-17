import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { formatUserError } from '../../shared/utils/userError.js'
import { isContractRecordPreview, isContractRecordMutation, isDeletedContractPage } from '../utils/contractRecord.js'

const source = (await readFile(new URL('./contract.js', import.meta.url), 'utf8'))
  .replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
  .replaceAll('import.meta.env', '({})').replace(/^export /gm, '')
const api = new Function('formatUserError','attachStructuredContext','isContractRecordPreview',
  'isContractRecordMutation','isDeletedContractPage',`${source};return {previewContractDeletion,deleteContractRecord,restoreContractRecord,listDeletedContractRecords}`)(
  formatUserError,()=>{},isContractRecordPreview,isContractRecordMutation,isDeletedContractPage)

// withReply 用途：通过真实客户端消费受控 HTTP 响应，记录每次调用而不连接业务环境。
// 参数：data 为响应数据，run 为最小场景，status 为真实模拟状态码。
// 返回值：异步场景结果；始终恢复全局 fetch，避免污染其他测试。
async function withReply(data, run, status = 200) {
  const before=globalThis.fetch,calls=[]
  globalThis.fetch=async(path,options)=>{calls.push({path,options});return new Response(JSON.stringify({code:status===200?'OK':'CON_VERSION_CONFLICT',data}),{status,headers:{'Content-Type':'application/json'}})}
  try{return await run(calls)}finally{globalThis.fetch=before}
}

test('记录操作消费明确回执并发送原版本和原因',async()=>{
  await withReply({id:'C',version:2,record_state:'deleted',changed:true},async(calls)=>{
    const result=await api.deleteContractRecord('C',1,'误建')
    assert.equal(result.changed,true);assert.equal(calls.length,1)
    assert.equal(calls[0].options.method,'DELETE')
    assert.deepEqual(JSON.parse(calls[0].options.body),{expected_version:1,reason:'误建'})
  })
  await withReply({id:'C',version:2,record_state:'active',changed:false},async()=>{
    assert.equal((await api.restoreContractRecord('C',2)).changed,false)
  })
})

test('错误身份或伪造升版回执视为未知写入，不重发',async()=>{
  for(const data of [{id:'other',version:2,record_state:'deleted',changed:true},{id:'C',version:1,record_state:'deleted',changed:true}]){
    await withReply(data,async(calls)=>{
      await assert.rejects(api.deleteContractRecord('C',1,'误建'),(error)=>error.outcomeUnknown===true)
      assert.equal(calls.length,1)
    })
  }
})

test('回收站拒绝旧普通列表降级，保留合法完整空集',async()=>{
  await withReply([],async()=>assert.rejects(api.listDeletedContractRecords(),(error)=>error.code==='INVALID_CONTRACT_RESPONSE'))
  await withReply({items:[],total:0,page:1,page_size:20},async(calls)=>{
    assert.equal((await api.listDeletedContractRecords({page:1})).total,0)
    assert.match(calls[0].path,/record_state=deleted/)
  })
})
