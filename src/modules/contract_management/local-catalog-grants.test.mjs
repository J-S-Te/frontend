import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import * as Vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

// 用途：运行真实目录组件脚本，观察授权提交而非复制产品逻辑。
// 参数：无。
// 返回值：真实函数、状态和受控网络边界记录。
async function harness() {
 const { descriptor } = parse(await readFile(new URL('./components/LocalContractCatalogPanel.vue',import.meta.url),'utf8'))
 const compiled = compileScript(descriptor,{id:'catalog-grants'})
 assert.deepEqual(compileTemplate({source:descriptor.template.content,filename:'catalog.vue',id:'catalog-grants',compilerOptions:{bindingMetadata:compiled.bindings}}).errors,[])
 const calls=[]
 const context={...Vue,defineProps:()=>({permissions:['contract.catalog.manage']}),onMounted:()=>{},
 listLocalContractCounterparties:async()=>[],listLocalContractCategories:async()=>[],
 saveLocalContractCounterparty:async()=>{},saveLocalContractCategory:async()=>{},
 listLocalCatalogGrantTargets:async()=>[{subject_type:'USER',subject_id:'sales-valid',name:'有效销售'},{subject_type:'ORG',subject_id:'org-valid',name:'有效组织'}],
 listLocalCatalogGrants:async()=>[{subject_type:'USER',subject_id:'sales-valid',subject_name:'有效销售',enabled:true,version:2}],
 saveLocalCatalogGrant:async(kind,id,input)=>{calls.push({kind,id,input});return{...input,version:3}},
 formatUserError:error=>error.message,
 }
 const script=descriptor.scriptSetup.content.replace(/^import .*$/gm,'')
 const ui=vm.runInNewContext(`${script}\n;({ openGrants: typeof openGrants === 'function' ? openGrants : null, submitGrant: typeof submitGrant === 'function' ? submitGrant : null, revokeGrant: typeof revokeGrant === 'function' ? revokeGrant : null, grantTarget: typeof grantTarget === 'undefined' ? null : grantTarget })`,context)
 return {ui,calls}
}

test('目录组件从真实候选选择USER/ORG，授权与撤销携带当前CAS且拒绝自由ID',async()=>{
 const {ui,calls}=await harness()
 assert.equal(typeof ui.openGrants,'function','缺少条目显式授权入口')
 await ui.openGrants({id:'entry',name:'交易对方'})
 ui.grantTarget.value='USER:forged'
 await ui.submitGrant()
 assert.equal(calls.length,0)
 ui.grantTarget.value='ORG:org-valid'
 await ui.submitGrant()
 assert.equal(calls[0].input.subject_id,'org-valid')
 assert.equal(calls[0].input.enabled,true)
 assert.equal(calls[0].input.expected_version,0)
 await ui.revokeGrant({subject_type:'USER',subject_id:'sales-valid',enabled:true,version:2})
 assert.equal(calls[1].input.enabled,false)
 assert.equal(calls[1].input.expected_version,2)
})

test('授权API复用原transport并只发送稳定目标、显式启停和版本',async()=>{
 const source=await readFile(new URL('./api/contract.js',import.meta.url),'utf8')
 const names=['listLocalCatalogGrantTargets','listLocalCatalogGrants','saveLocalCatalogGrant']
 const functions=names.map(name=>{
  const start=source.indexOf(`export function ${name}(`)
  assert.ok(start>=0,`缺少实际API ${name}`)
  return source.slice(start,source.indexOf('\n}',start)+2).replace('export ','')
 })
 const calls=[]
 const api=vm.runInNewContext(`${functions.join('\n')}\n;({${names.join(',')}})`,{
  request:async(path,options)=>{calls.push({path,options});return{}},
  Array,Number,JSON,encodeURIComponent,
 })
 await api.listLocalCatalogGrantTargets()
 await api.saveLocalCatalogGrant('categories','entry/1',{subject_type:'ORG',subject_id:'org',enabled:false,expected_version:2,tenant_id:'forged'})
 assert.equal(calls[0].path,'/local-catalog/grant-targets')
 assert.equal(calls[1].path,'/local-catalog/categories/entry%2F1/grants')
 assert.deepEqual(JSON.parse(calls[1].options.body),{subject_type:'ORG',subject_id:'org',enabled:false,expected_version:2})
 assert.throws(()=>api.listLocalCatalogGrants('invalid','entry'))
})
