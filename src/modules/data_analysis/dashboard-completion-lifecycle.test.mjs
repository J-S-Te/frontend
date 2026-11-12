import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import * as Vue from 'vue'

const source=readFileSync(new URL('./views/DashboardShellView.vue',import.meta.url),'utf8')

// deferred 构造可控制完成顺序的隔离网络响应。
// 参数：无。
// 返回值：promise 与 resolve 控制器。
function deferred(){let resolve;const promise=new Promise((done)=>{resolve=done});return {promise,resolve}}

// harness 执行真实外壳脚本并注入可控网络及生命周期。
// 参数：loaders 为需要覆盖的接口。
// 返回值：实际状态、路由、挂载和卸载回调。
function harness(loaders={}){
 let mounted,unmount
 const route=Vue.reactive({params:{section:'contract'},query:{}})
 const empty=async()=>({available:false,items:[],total:0,page:1,page_size:20})
 const context={...Vue,onMounted:(fn)=>{mounted=fn},onBeforeUnmount:(fn)=>{unmount=fn},inject:()=>null,
 useRoute:()=>route,useRouter:()=>({replace:async()=>{},push:()=>{}}),useUrlFilterState:()=>{},loginUsername:()=>'',
 createEmbedSessionActivity:()=>({reset:()=>{},destroy:()=>{}}),subscribeRelatedDataChanges:()=>()=>{},RELATED_DATA:{},
 getAuthMe:async()=>({tenant_id:'t',user_id:'u',permissions:['dashboard.contract.view','dashboard.project.view','dashboard.overview.view']}),
 isDashboardEmbedEnabled:()=>false,getContractDashboardSummary:empty,getContractRegions:async()=>({available:false,items:[],basis:''}),getProjectDashboardSummary:empty,getReportDashboardSummary:empty,getFinanceDashboardSummary:empty,
 getContractDetails:empty,getProjectDetails:empty,getDashboardTrend:async()=>[],getAlertSummary:empty,
 formatDataAnalysisError:(error)=>error.message,
 window:{clearTimeout,setTimeout,location:{origin:'https://test.example'}},document:{addEventListener:()=>{},removeEventListener:()=>{}},...loaders}
 const script=source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm,'')
 const state=vm.runInNewContext(script+';({me,dashboardSummary,contractDetails,projectDetails,summaryError,detailError,historyPanel,loadSummary,loadDetails,loadMe,refreshCurrentDashboard})',context)
 return {state,route,mount:()=>mounted(),unmount:()=>unmount()}
}

test('离开看板及卸载后迟到摘要不恢复旧身份数据',async()=>{
 const pending=deferred()
 const h=harness({getContractDashboardSummary:()=>pending.promise})
 const mounting=h.mount()
 await Vue.nextTick();await Vue.nextTick()
 h.route.params.section='dictionary'
 pending.resolve({available:true,total_contracts:99})
 await mounting
 assert.equal(h.state.dashboardSummary.value,null)
 const next=deferred()
 const h2=harness({getContractDashboardSummary:()=>next.promise})
 const mounting2=h2.mount()
 await Vue.nextTick();await Vue.nextTick();h2.unmount()
 next.resolve({available:true,total_contracts:88});await mounting2
 assert.equal(h2.state.dashboardSummary.value,null)
})

test('分页迟到响应在身份变化后失效，刷新同时触发历史面板',async()=>{
 const h=harness();await h.mount()
 let refreshed=0
 h.state.historyPanel.value={refresh:async()=>{refreshed++}}
 await h.state.refreshCurrentDashboard()
 assert.equal(refreshed,1)
 const detail=deferred(), started=deferred()
 const h2=harness({getContractDetails:()=>{started.resolve();return detail.promise}})
 const mounting=h2.mount()
 await started.promise
 h2.state.me.value={tenant_id:'other',user_id:'other',permissions:['dashboard.contract.view']}
 detail.resolve({items:[{title:'旧身份'}],total:1,page:1,page_size:20})
 await mounting
 assert.equal(h2.state.contractDetails.value.items.length,0)
})

test('总览无权来源静默跳过，不误报来源加载失败',async()=>{
 const h=harness({getAuthMe:async()=>({tenant_id:'t',user_id:'u',permissions:['dashboard.overview.view']})})
 h.route.params.section='overview';await h.mount()
 assert.equal(h.state.summaryError.value,'')
})
