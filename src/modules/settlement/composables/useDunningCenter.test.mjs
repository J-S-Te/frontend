import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { computed, ref, toRaw } from 'vue'

// useDunningCenter 直接导入 ../api/settlement（含 @/ 别名，Node 无法解析），
// 沿 friendly-errors.test.mjs 的 viewHarness 做法：剥掉 import 后整段求值，API 以桩注入，
// 验证真实闭包接线（弹窗状态在 open/confirm/cancel 之间共享）而非切片复述。
const source = await readFile(new URL('./useDunningCenter.js', import.meta.url), 'utf8')
const script = source.replace(/^import[\s\S]*?;\n/gm, '').replace(/^export /gm, '')
// 回归断言只看代码，不看 JSDoc（注释里会提到被替换掉的 window.prompt）。
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
// vm 另一 realm 生成的数组/对象原型不同，严格 deepEqual 会判原型不等；比较前归一化为纯数据。
const plain = (value) => JSON.parse(JSON.stringify(value))

function harness({ refreshed = true, failure = null, session = {}, permissions = [] } = {}) {
  const calls = { complete: [], load: 0, notify: [], act: [], policy: [] }
  const context = vm.createContext({
    ref, computed,
    completeDunningActionAPI: async (id, payload) => { calls.complete.push({ id, payload }); if (failure) throw failure },
    createDunningPolicy: async (payload) => { calls.policy.push(payload) },
  })
  vm.runInContext(`${script}\nglobalThis.useDunningCenter = useDunningCenter;`, context)
  const deps = {
    saving: ref(false),
    notify: (value) => calls.notify.push(value),
    load: async () => { calls.load++; return refreshed },
    act: async (callback, success) => { calls.act.push(success); await callback() },
    formatSettlementError: (cause, options) => `${options.fallback}|${cause.code}`,
    settlementSession: ref(session),
    sessionPermissions: computed(() => new Set(permissions)),
  }
  return { deps, calls, ...context.useDunningCenter(deps) }
}
const pending = (overrides = {}) => ({ id: 'act-1', version: '3', status: 'PENDING', recipient_user_id: 'u1', ...overrides })

test('源码回归：完成跟进不再使用阻塞式 window.prompt，写路径保留版本乐观锁与 note 字段', () => {
  assert.doesNotMatch(code, /window\.prompt/)
  assert.match(code, /completeDunningActionAPI\(dialog\.item\.id, \{\s*version: Number\(dialog\.item\.version\),\s*note: normalized,\s*\}\)/)
  assert.match(code, /const refreshed = await load\(\)/, '成功后必须强制刷新')
})

test('六份列表状态、收件人加载态与策略表单的初始形状', () => {
  const h = harness()
  assert.deepEqual(plain(h.dunningPolicies.value), [])
  assert.deepEqual(plain(h.dunningRecipients.value), [])
  assert.deepEqual(plain(h.dunningCases.value), [])
  assert.deepEqual(plain(h.dunningActions.value), [])
  assert.deepEqual(plain(h.dunningOverview.value), {})
  assert.deepEqual(plain(h.dunningCoverage.value), { policies: [], gaps: [] })
  assert.equal(h.dunningRecipientsLoading.value, false)
  assert.equal(h.dunningRecipientsError.value, '')
  assert.equal(h.dunningActionDialog.value, null)
  assert.deepEqual(plain(h.policyForm.value), {
    name: '逾期升级提醒', aging_from_days: 1, aging_to_days: 30, action_type: 'REMIND',
    recipient_rule: 'USER:', channel: 'LOCAL', repeat_interval_days: 7, priority: 'NORMAL',
  })
})

test('canCompleteDunningAction：仅 PENDING 且本人收件或持有 settlement.admin', () => {
  const own = harness({ session: { user_id: 'u1' } })
  assert.equal(own.canCompleteDunningAction(pending()), true)
  assert.equal(own.canCompleteDunningAction(pending({ recipient_user_id: 'u2' })), false)
  assert.equal(own.canCompleteDunningAction(pending({ status: 'COMPLETED' })), false)
  const admin = harness({ session: { user_id: 'u1' }, permissions: ['settlement.admin'] })
  assert.equal(admin.canCompleteDunningAction(pending({ recipient_user_id: 'u2' })), true)
  assert.equal(admin.canCompleteDunningAction(pending({ status: 'COMPLETED', recipient_user_id: 'u2' })), false)
})

test('completeDunningAction 仅打开弹窗并携带目标项；saving 忙时拒绝打开', () => {
  const h = harness()
  const item = pending()
  h.completeDunningAction(item)
  // ref 会把弹窗对象深度包成 reactive，item 取回的是代理，需 toRaw 后比对原引用。
  assert.equal(toRaw(h.dunningActionDialog.value.item), item, '弹窗携带目标项引用')
  assert.equal(h.dunningActionDialog.value.error, '')
  assert.equal(h.calls.complete.length, 0, '打开弹窗不得发请求')

  const busy = harness()
  busy.deps.saving.value = true
  busy.completeDunningAction(item)
  assert.equal(busy.dunningActionDialog.value, null)
})

test('cancelDunningAction 关闭弹窗；saving 忙时不得关闭（防止提交中丢失上下文）', () => {
  const h = harness()
  h.completeDunningAction(pending())
  h.cancelDunningAction()
  assert.equal(h.dunningActionDialog.value, null)

  h.completeDunningAction(pending())
  h.deps.saving.value = true
  h.cancelDunningAction()
  assert.notEqual(h.dunningActionDialog.value, null)
})

test('confirmDunningAction 成功：version 转数字、note 去空白，先关弹窗再刷新并提示完成', async () => {
  const h = harness({ refreshed: true })
  h.completeDunningAction(pending({ id: 'act-7', version: '3' }))
  await h.confirmDunningAction('  已电话联系客户  ')
  assert.deepEqual(plain(h.calls.complete), [{ id: 'act-7', payload: { version: 3, note: '已电话联系客户' } }])
  assert.equal(h.dunningActionDialog.value, null, '服务端确认成功即关闭弹窗')
  assert.equal(h.calls.load, 1)
  assert.deepEqual(h.calls.notify, ['催收动作已完成。'])
  assert.equal(h.deps.saving.value, false)
})

test('confirmDunningAction 刷新失败：保留成功事实并降级提示，弹窗仍关闭', async () => {
  const h = harness({ refreshed: false })
  h.completeDunningAction(pending())
  await h.confirmDunningAction('跟进')
  assert.equal(h.calls.complete.length, 1)
  assert.equal(h.dunningActionDialog.value, null)
  assert.deepEqual(h.calls.notify, ['催收动作已完成；页面刷新失败，请手动刷新确认。'])
  assert.doesNotMatch(h.calls.notify[0], /失败。$/, '不得把刷新失败说成动作失败')
})

test('confirmDunningAction 超过 500 字：弹窗内联 error，不发请求、不关弹窗、不占用 saving', async () => {
  const h = harness()
  h.completeDunningAction(pending())
  await h.confirmDunningAction('x'.repeat(501))
  assert.equal(h.calls.complete.length, 0)
  assert.equal(h.dunningActionDialog.value.error, '催收跟进结果不能超过 500 字。')
  assert.equal(h.deps.saving.value, false)

  await h.confirmDunningAction(`  ${'x'.repeat(500)}  `)
  assert.equal(h.calls.complete.length, 1, '去空白后恰好 500 字允许提交')
  assert.equal(h.calls.complete[0].payload.note.length, 500)
})

test('confirmDunningAction 空备注沿用原 prompt 语义允许提交（note 为空串）', async () => {
  const h = harness()
  h.completeDunningAction(pending())
  await h.confirmDunningAction(undefined)
  assert.equal(h.calls.complete.length, 1)
  assert.equal(h.calls.complete[0].payload.note, '')
})

test('confirmDunningAction 接口失败：格式化文案写入弹窗 error，弹窗保持打开，不刷新不提示，saving 复位', async () => {
  const h = harness({ failure: Object.assign(new Error('boom'), { code: 'E_DUN' }) })
  const item = pending()
  h.completeDunningAction(item)
  await h.confirmDunningAction('跟进')
  assert.equal(h.calls.complete.length, 1)
  assert.notEqual(h.dunningActionDialog.value, null, '失败不得关闭弹窗，用户需能重试或取消')
  assert.equal(toRaw(h.dunningActionDialog.value.item), item)
  assert.equal(h.dunningActionDialog.value.error, '催收动作完成失败。|E_DUN')
  assert.equal(h.calls.load, 0, '写失败不得触发刷新链')
  assert.deepEqual(h.calls.notify, [])
  assert.equal(h.deps.saving.value, false)
})

test('confirmDunningAction 无弹窗或 saving 忙时直接返回，不重入', async () => {
  const none = harness()
  await none.confirmDunningAction('跟进')
  assert.equal(none.calls.complete.length, 0)

  const busy = harness()
  busy.completeDunningAction(pending())
  busy.deps.saving.value = true
  await busy.confirmDunningAction('跟进')
  assert.equal(busy.calls.complete.length, 0, '进行中必须被单飞 guard 拦截')
  assert.equal(busy.deps.saving.value, true, '不得篡改进行中标志')
  assert.equal(busy.dunningActionDialog.value.error, '')
})

test('submitPolicy 经 act 提交当前策略表单并带成功文案', async () => {
  const h = harness()
  h.policyForm.value.name = '催收升级 B'
  await h.submitPolicy()
  assert.deepEqual(h.calls.act, ['催收策略已创建。'])
  assert.equal(h.calls.policy.length, 1)
  assert.equal(h.calls.policy[0], h.policyForm.value, '提交的是当前表单对象本身')
})
