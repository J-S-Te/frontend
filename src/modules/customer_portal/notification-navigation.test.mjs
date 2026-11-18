import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parse } from '@babel/parser'
import { computed, effectScope, nextTick, reactive, ref, watch } from 'vue'

const source = readFileSync(new URL('./views/CustomerPortalView.vue', import.meta.url), 'utf8')
const script = source.match(/<script setup>([\s\S]*?)<\/script>/)[1]
const statements = parse(script, { sourceType: 'module' }).program.body

// 用途：执行门户真实深链、已授权详情函数和查询监听。
// 参数：section 为报告或反馈栏目，read 为可控的只读接口。
// 返回值：路由、真实可见状态、读取记录及卸载入口。
function harness(section, read = null) {
  const scope = effectScope(), calls = []
  const query = section === 'reports' ? { request_id: '17' } : { feedback_id: 'FB-17' }
  const route = reactive({ params: { section }, query })
  const context = {
    route, section: computed(() => route.params.section), watch,
    session: ref({ user_id: 'portal-user' }), loading: ref(false), error: ref(''),
    canRead: ref(true), reportDetailGeneration: 0, feedbackDetailGeneration: 0,
    selectedReport: ref(null), selectedFeedback: ref(null),
    reportDetailLoading: ref(false), reportDetailError: ref(''),
    projectListError: ref(''), feedbackListError: ref(''),
    cancelReportDownload() {}, load: async () => {},
    formatPortalError: error => error.message,
    fail: error => { context.error.value = error.message },
    getReportRequest: async id => { calls.push(id); return read ? read(id) : { id, events: [] } },
    getFeedback: async id => { calls.push(id); return read ? read(id) : { feedback: { id } } },
  }
  context.hasPermission = () => context.canRead.value
  const names = ['openPortalTarget', 'reloadList', 'openReport', 'openFeedback',
    'closeReport', 'closeFeedbackDetail']
  const declarations = statements.filter(node => node.type === 'FunctionDeclaration'
    && names.includes(node.id.name)).map(node => script.slice(node.start, node.end))
  const watchers = statements.filter(node => node.type === 'ExpressionStatement'
    && script.slice(node.start, node.end).startsWith('watch(')
    && script.slice(node.start, node.end).includes('openPortalTarget'))
    .map(node => script.slice(node.start, node.end))
  const ui = scope.run(() => new Function(...Object.keys(context),
    `${declarations.join('\n')}\n${watchers.join('\n')}; return { reloadList }`)(
    ...Object.values(context)))
  return { ...ui, route, calls, context, stop: () => scope.stop() }
}

for (const section of ['reports', 'feedback']) {
  test(`${section} 冷进入深链直接读取目标详情，同路由参数更新切换对象`, async () => {
    const h = harness(section)
    try {
      await h.reloadList()
      assert.deepEqual(h.calls, [section === 'reports' ? '17' : 'FB-17'])
      const key = section === 'reports' ? 'request_id' : 'feedback_id'
      h.route.query[key] = '29'
      await nextTick()
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(h.calls.at(-1), '29')
      const detail = section === 'reports' ? h.context.selectedReport.value
        : h.context.selectedFeedback.value?.feedback
      assert.equal(detail.id, '29')
    } finally { h.stop() }
  })
}

test('门户非法或重复坐标、无读取权限不读取，缺失目标保留错误信息', async () => {
  const h = harness('reports', async () => { throw new Error('该申请不存在或当前账号不可见') })
  try {
    await h.reloadList()
    assert.match(h.context.reportDetailError.value, /不存在|不可见/)
    h.route.query.request_id = ['17', '29']
    await nextTick()
    assert.deepEqual(h.calls, ['17'])
    assert.match(h.context.error.value, /无效/)
    h.context.canRead.value = false
    h.route.query.request_id = '31'
    await nextTick()
    assert.deepEqual(h.calls, ['17'])
  } finally { h.stop() }
})

test('门户先打开慢请求再切换深链时，只保留后一个详情', async () => {
  let finishOld
  const h = harness('reports', id => id === '17'
    ? new Promise(resolve => { finishOld = resolve }) : Promise.resolve({ id, events: [] }))
  try {
    const first = h.reloadList()
    await nextTick()
    h.route.query.request_id = '29'
    await nextTick()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(typeof finishOld, 'function', '首次深链必须发起目标详情读取')
    finishOld({ id: '17', events: [] })
    await first
    assert.equal(h.context.selectedReport.value.id, '29')
  } finally { h.stop() }
})
