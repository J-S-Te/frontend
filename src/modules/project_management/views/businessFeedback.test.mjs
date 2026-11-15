import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { ref } from 'vue'
import { formatUserError } from '../../shared/utils/userError.js'

const source = readFileSync(new URL('./ProjectManagementView.vue', import.meta.url), 'utf8')

// 用途：执行真实页面函数，网络依赖仅由用例提供隔离替身。
// 参数：names 为函数名，context 为响应式状态及依赖。
// 返回值：可调用的真实函数集合。
function functions(names, context) {
  const bodies = names.map(name => {
    const start = source.search(new RegExp(`(?:async )?function ${name}\\(`))
    assert.ok(start >= 0, `缺少 ${name}`)
    return source.slice(start, source.indexOf('\n}', start) + 2)
  })
  return vm.runInNewContext(`${bodies.join('\n')}\n({${names.join(',')}})`, context)
}

for (const operation of ['submitDetectionCategory', 'removeDetectionCategory',
  'submitSplitOverride', 'removeSplitOverride']) {
  test(`${operation} 写入完成后刷新失败保留完成事实`, async () => {
    const messages = []
    let writes = 0
    const context = {
      saving: ref(false), categoryDialog: ref({ category: '类别' }),
      overrideDialog: ref({ name: '规则', match: {}, settings: {} }),
      detectionRequiredCodeSelection: ref([]), detectionCategories: ref([]), splitOverrides: ref([]),
      compactOverrideMatch: value => value, compactOverrideSettings: value => value,
      askConfirm: async () => true, formatUserError,
      saveDetectionCategory: async () => { writes++ }, deleteDetectionCategory: async () => { writes++ },
      saveSplitOverride: async () => { writes++ }, deleteSplitOverride: async () => { writes++ },
      listDetectionCategories: async () => { throw Error('目录暂不可用') },
      listSplitOverrides: async () => { throw Error('目录暂不可用') },
      showToast: (message, tone) => messages.push({ message, tone }),
    }
    await functions([operation], context)[operation]({ category: '类别', id: '规则', name: '规则' })
    assert.equal(writes, 1)
    assert.match(messages.at(-1).message, /已保存|已删除/)
    assert.match(messages.at(-1).message, /刷新.*失败|读取.*失败/)
    assert.match(messages.at(-1).message, /勿重复/)
    assert.equal(messages.at(-1).tone, 'warning')
    assert.equal(context.saving.value, false)
  })
}

for (const operation of ['revokeSelectedAssignment', 'returnSelectedToDecomposition']) {
  for (const unknown of [false, true]) {
    test(`${operation} 第二项${unknown ? '结果未知' : '明确冲突'}保留批次完成边界`, async () => {
      const items = ['SI-1', 'SI-2', 'SI-3'].map(id =>
        ({ id, version: 1, status: '待分配', team_lead_id: 'lead', project_manager_id: 'manager' }))
      const writes = [], messages = []
      let loads = 0
      const error = Object.assign(Error(unknown ? '连接中断' : '状态已变化'),
        { status: unknown ? 0 : 409, outcomeUnknown: unknown })
      const submit = async id => { writes.push(id); if (id === 'SI-2') throw error }
      const context = {
        saving: ref(false), promptDialog: ref(null), selectedServiceItems: ref(items),
        selectedServiceItemIDs: ref(items.map(item => item.id)),
        canRevokeTeam: ref(true), canRevokeExecution: ref(true), canManageDecomposition: ref(true),
        captureReasonContext: items => ({ items }), askOperationReason: async () => '撤销原因',
        revokeTeamAssignment: submit, revokeExecutionAssignment: submit,
        returnServiceItemToDecomposition: submit,
        loadWorkspace: async () => { loads++ }, formatUserError,
        showToast: (message, tone) => messages.push({ message, tone }),
      }
      await functions([operation], context)[operation]('team')
      assert.deepEqual(writes, ['SI-1', 'SI-2'], '不能继续或自动重发未知项')
      assert.equal(loads, 1, '部分完成后仍需读取权威状态')
      assert.deepEqual([...context.selectedServiceItemIDs.value], ['SI-2', 'SI-3'])
      assert.match(messages.at(-1).message, /已确认完成 1 项/)
      assert.match(messages.at(-1).message, unknown ? /SI-2.*结果未知/ : /SI-2.*未完成/)
      assert.match(messages.at(-1).message, /1 项未执行/)
      assert.match(messages.at(-1).message, /勿重复/)
      assert.equal(context.saving.value, false)
    })
  }
}

test('批次长原因和刷新失败经过真实Toast后仍保留已完成事实', async () => {
  const items = ['SI-1', 'SI-2'].map(id => ({ id, version: 1, status: '待分配', team_lead_id: 'lead' }))
  const context = {
    saving: ref(false), promptDialog: ref(null), selectedServiceItems: ref(items),
    selectedServiceItemIDs: ref(['SI-1', 'SI-2']), canRevokeTeam: ref(true), canRevokeExecution: ref(false),
    captureReasonContext: items => ({ items }), askOperationReason: async () => '撤销原因',
    revokeTeamAssignment: async id => { if (id === 'SI-2') throw Object.assign(Error('需要核对'.repeat(95)), { status: 409 }) },
    loadWorkspace: async () => { throw Error('刷新失败') }, formatUserError,
    toastMessage: ref(''), toastType: ref(''), toastTimer: 0,
    window: { clearTimeout() {}, setTimeout() { return 1 } },
  }
  Object.assign(context, functions(['showToast', 'revokeSelectedAssignment'], context))
  await context.revokeSelectedAssignment('team')
  assert.match(context.toastMessage.value, /已确认完成 1 项.*SI-2.*未完成/)
  assert.match(context.toastMessage.value, /列表刷新失败/)
  assert.equal(context.toastType.value, 'warning')
})
