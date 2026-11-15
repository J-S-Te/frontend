import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { nextTick, reactive } from 'vue'
import { mountSFC } from '../../test/helpers/mountSFC.mjs'

const panel = resolve('src/modules/project_management/components/ReimbursementSpendPanel.vue')
const api = resolve('src/modules/project_management/api/projectManagement.js')
const router = resolve('node_modules/vue-router/dist/vue-router.mjs')
const registry = resolve('src/modules/registry/compiledModules.js')
const session = { permissions: ['project.expense_participant.manage'] }
const defaults = [{ subject_id: 'implementer', display_name: '叶工', resource_id: 'P-17', service_item_id: 'a' }]

async function settlePanel() {
  await new Promise((resolve) => setImmediate(resolve))
  await nextTick()
}

async function mountExpensePanel(responses, props = { projectId: 'p', session }) {
  return mountSFC(panel, {
    [api]: {
      getProjectExpenseParticipants: async () => ({ items: [], implementation_participants: { items: defaults } }),
      putProjectExpenseParticipant: async () => { throw new Error('读取默认资格不得产生写入') },
      getProjectReimbursementSpend: async () => ({ items: [], metric: 'paid_net_minor' }),
      listPersonnel: async () => ({ items: [{ user_id: 'outsider', display_name: '其他人员' }] }),
      ...responses,
    },
    [router]: { useRouter: () => ({ push() {} }) },
    [registry]: { frontendModules: [{ code: 'reimbursement' }] },
  }, props)
}

test('实施人员默认显示，打开面板不拉全员目录也不要求手输版本', async () => {
  let directoryReads = 0
  const mounted = await mountExpensePanel({
    listPersonnel: async () => { directoryReads++; return { items: [] } },
  })
  try {
    await settlePanel()
    assert.deepEqual(mounted.state.implementationParticipants?.value, defaults)
    assert.equal(directoryReads, 0)
    assert.equal(mounted.state.exceptionForm.value.subject_id, '')
    assert.ok(mounted.state.eligibilityRows.value.some((row) => row.sourceLabel === '实施计划'))
  } finally { mounted.unmount() }
})

test('自动名单翻页保留前页人员，例外名单独立展示并可移除', async () => {
  const explicit = [{ subject_id: 'extra', version: 3, status: 'ACTIVE', valid_until: '2027-11-10T00:00:00Z' }]
  const mounted = await mountExpensePanel({
    getProjectExpenseParticipants: async (_project, _cursor, implementationCursor) => ({
      items: explicit,
      implementation_participants: implementationCursor
        ? { items: [{ subject_id: 'second', display_name: '赵工', resource_id: 'P-18', service_item_id: 'b' }] }
        : { items: defaults, next_cursor: 'next-implementation' },
    }),
  })
  try {
    await settlePanel()
    assert.equal(mounted.state.implementationCursor?.value, 'next-implementation')
    await mounted.state.loadParticipants(false, true)
    assert.deepEqual(mounted.state.implementationParticipants.value.map((row) => row.subject_id), ['implementer', 'second'])
    assert.deepEqual(mounted.state.participants.value, explicit)
    const extra = mounted.state.eligibilityRows.value.find((row) => row.subject_id === 'extra')
    assert.equal(extra.explicit, true)
    assert.equal(extra.sourceLabel, '项目例外')
  } finally { mounted.unmount() }
})

test('缺少管理权限或项目标识时不读取默认人员和目录', async () => {
  let reads = 0
  let writes = 0
  const responses = {
    getProjectExpenseParticipants: async () => { reads++; return {} },
    listPersonnel: async () => { reads++; return {} },
    putProjectExpenseParticipant: async () => { writes++; return {} },
  }
  for (const props of [{ projectId: 'p', session: { permissions: [] } }, { projectId: '', session }]) {
    const mounted = await mountExpensePanel(responses, props)
    await settlePanel()
    await mounted.state.loadParticipants()
    await mounted.state.loadPersonnel()
    await mounted.state.addException()
    await mounted.state.removeException({ subject_id: 'x', person: { version: 1 } })
    assert.equal(reads, 0)
    assert.equal(writes, 0)
    mounted.unmount()
  }
})

test('管理权限撤销后忽略仍在途的默认名单，旧响应不恢复人员或忙碌状态', async () => {
  let complete
  const currentSession = reactive({ permissions: ['project.expense_participant.manage'] })
  const mounted = await mountExpensePanel({
    getProjectExpenseParticipants: () => new Promise((resolve) => { complete = resolve }),
  }, { projectId: 'p', session: currentSession })
  try {
    assert.equal(mounted.state.participantBusy.value, true)
    currentSession.permissions = []
    await nextTick()
    complete({ items: [{ subject_id: 'old' }], implementation_participants: { items: defaults } })
    await settlePanel()
    assert.deepEqual(mounted.state.implementationParticipants.value, [])
    assert.deepEqual(mounted.state.participants.value, [])
    assert.equal(mounted.state.participantBusy.value, false)
  } finally { mounted.unmount() }
})

test('人员会话切换时丢弃旧名单，即使项目和权限名称相同', async () => {
  const pending = []
  const currentSession = reactive({ tenant_id: 't', user_id: 'first', permissions: session.permissions })
  const mounted = await mountExpensePanel({
    getProjectExpenseParticipants: () => new Promise((resolve) => { pending.push(resolve) }),
  }, { projectId: 'p', session: currentSession })
  try {
    currentSession.user_id = 'second'
    await nextTick()
    pending[0]({ items: [], implementation_participants: { items: defaults } })
    await settlePanel()
    assert.deepEqual(mounted.state.implementationParticipants.value, [])
    assert.equal(pending.length, 2)
    pending[1]({ items: [], implementation_participants: { items: [] } })
    await settlePanel()
    assert.deepEqual(mounted.state.implementationParticipants.value, [])
  } finally { mounted.unmount() }
})
