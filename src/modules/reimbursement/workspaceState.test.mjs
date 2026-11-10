import test from 'node:test'
import assert from 'node:assert/strict'

test('报销对象深链只携带业务坐标并过滤恶意返回目标',async()=>{
 const {claimLocation,returnProjectLocation}=await import('./workspaceState.js')
 assert.deepEqual(claimLocation('claim/1','project/1'),{name:'reimbursement',params:{section:'claims'},query:{claim_id:'claim/1',project_id:'project/1'}})
 assert.deepEqual(returnProjectLocation({project_id:'p',return_to:'https://evil'}),{name:'project_management',params:{section:'project_detail'},query:{project:'p'}})
 assert.equal(returnProjectLocation({project_id:['p','q']}),null)
})

test('字段错误保留服务端费用行坐标且不接受任意对象渲染',async()=>{
 const {validationFields}=await import('./workspaceState.js')
 assert.deepEqual(validationFields([{field:'items[2].city_code',message:'城市编码无效'}]),[{field:'items[2].city_code',message:'城市编码无效'}])
 assert.deepEqual(validationFields({items:'invalid'}),[])
})
