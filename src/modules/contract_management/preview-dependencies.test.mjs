import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { effectScope, nextTick, ref, watch } from 'vue'

const source = readFileSync(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')
const body = source.slice(source.indexOf('watch(createDialogOpen, (open)'), source.indexOf('\nasync function previewNewContract'))

// 用途：执行页面实际侦听声明，验证正文失效范围与草稿回填。
// 参数：无。
// 返回值：真实 Vue 作用域和预览状态。
function fixture() {
  const scope = effectScope()
  const state = { newContract: ref({ template_id: 't1', template_values: { party: '甲方' }, service_items: [{ site: 'A' }], note: '' }),
    createDialogOpen: ref(true), templatePreviewing: ref(false), templatePreviewHTML: ref('已生成正文') }
  const run = new Function('watch', ...Object.keys(state), 'syncManagedTemplateValues', 'resetCRMDirectoryConnection',
    `let templatePreviewSequence=0;${body}
return () => templatePreviewSequence`)
  const sequence = scope.run(() => run(watch, ...Object.values(state), () => {}, () => {}))
  return { scope, state, sequence }
}

test('不影响正文的服务项编辑保留现有预览', async () => {
  const view = fixture()
  try {
    view.state.newContract.value.service_items[0].site = 'B'
    await nextTick()
    assert.equal(view.state.templatePreviewHTML.value, '已生成正文')
    assert.equal(view.sequence(), 0)
  } finally { view.scope.stop() }
})

test('模板替换值改变或恢复草稿使旧正文立即失效', async () => {
  const view = fixture()
  try {
    view.state.newContract.value.template_values.party = '乙方'
    assert.equal(view.state.templatePreviewHTML.value, '')
    view.state.templatePreviewHTML.value = '第二份正文'
    view.state.newContract.value = { template_id: 't2', template_values: { party: '恢复草稿' } }
    await nextTick()
    assert.equal(view.state.templatePreviewHTML.value, '')
    assert.ok(view.sequence() >= 2)
  } finally { view.scope.stop() }
})
