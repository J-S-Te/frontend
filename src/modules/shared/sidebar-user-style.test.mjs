import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8')
for(const path of ['settlement/views/SettlementView.vue','project_management/views/ProjectManagementView.vue','contract_management/views/ContractManagementView.vue','customer_opportunity/views/CustomerOpportunityView.vue','customer_portal/views/CustomerPortalView.vue','data_analysis/views/DashboardShellView.vue']) {
 test(`${path} 侧栏用户区接入统一样式`,()=>assert.match(read('../'+path),/class="[^"]*subsystem-sidebar-user/))
}
test('统一侧栏用户区约束头像、文本和退出按钮，保留窄侧栏退出入口',()=>{
 const css=read('./styles/global-ux.css')
 assert.match(css,/\.subsystem-sidebar-user\.subsystem-sidebar-user/)
 assert.match(css,/subsystem-sidebar-user[^}]+text-overflow:\s*ellipsis/s)
 assert.match(css,/\.settlement-sidebar \.subsystem-sidebar-user/)
})
