import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
test('IAM统计说明简化展示，不携带接口路径，完整说明可查看', () => {
 const source=read('../platform/iam/components/IamSettingsModule.vue')
 const metrics=source.slice(source.indexOf("const metrics ="),source.indexOf("const metrics =")+1600)
 assert.ok(!metrics.includes('/api/v1/'))
 assert.ok(source.includes(':title="metric.description || metric.note"'))
})
test('统计文字容器可以收缩，避免省略号被flex最小内容宽度撑破',()=>{
 const css=read('./styles/global-ux.css')
 for(const selector of ['.iam-summary-card','.pm-kpi','.crm-kpi','.contract-stat-grid','.settlement-detail-kpis','.da-native-metric']) assert.ok(css.includes(selector),selector)
 assert.match(css,/min-width:\s*0/)
 assert.match(css,/overflow-wrap:\s*anywhere/)
})

test('弹窗标题说明和业务编号允许换行，关闭按钮保持可见',()=>{
 const css=read('./styles/global-ux.css')
 for(const selector of ['.iam-modal','.crm-detail','.contract-detail-modal','.pm-dialog','.da-modal','.portal-dialog > article']) assert.ok(css.includes(selector))
 assert.match(css, /header > button\s*\{\s*flex:\s*0 0 auto/)
 const result=read('./components/OperationResultBanner.vue')
 assert.match(result,/\.operation-result-main > div\s*\{[^}]*min-width:\s*0[^}]*overflow-wrap:\s*anywhere/)
})
