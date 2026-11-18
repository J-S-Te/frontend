import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { parse, compileScript } from '@vue/compiler-sfc'
import { nextTick, reactive, ref, watch } from 'vue'
import { formatUserError } from '../../../shared/utils/userError.js'

const source = readFileSync(new URL('./PersonnelChangeCenter.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const setup = compileScript(descriptor, { id: 'personnel-change-reference' })

// 用途：截取真实组件函数，避免替身掩盖通知定位与流程分支。
// 参数：name 为需要执行的函数名称。
// 返回值：该函数的原始声明；缺少函数时断言失败。
function extractFunction(name) {
  const node = setup.scriptSetupAst.find((item) =>
    item.type === 'FunctionDeclaration' && item.id.name === name)
  assert.ok(node, `PersonnelChangeCenter.vue 必须定义 ${name}`)
  return descriptor.scriptSetup.content.slice(node.start, node.end)
}

// 用途：创建可控制异步完成顺序的服务响应。
// 参数：无。
// 返回值：待完成的 Promise 及其完成函数。
function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

// 用途：运行真实定位函数和 Vue 属性监听，仅替换远端读取边界。
// 参数：list 为授权列表；id 为异动标识；allowed、canApprove 为读取、审批权限。
// 返回值：真实状态、可变属性、写入计数与监听清理函数。
function fixture(list, id = 'change-1', allowed = true, canApprove = true) {
  const props = reactive({ initialRequestId: id })
  let writes = 0
  const context = vm.createContext({
    props, watch, ref, formatUserError,
    canRead: ref(allowed), canProcessApproval: ref(canApprove),
    listPersonnelChanges: list,
    runSubmit: () => { writes++ },
    workflowAction: ref(null), workflowReference: ref(''), workflowSaving: ref(false),
    handoverItems: ref([]), handoverItemsLoaded: ref(false),
    handoverRetryPending: ref(false), handoverTargetUserId: ref(''),
    error: ref(''),
  })
  const declarations = setup.scriptSetupAst.filter((node) =>
    node.type === 'VariableDeclaration' && node.declarations.some((item) =>
      ['referencedRecord', 'requestReferenceLoading', 'requestReferenceNotice',
        'requestReferenceError', 'requestReferenceSeq'].includes(item.id.name)))
    .map((node) => descriptor.scriptSetup.content.slice(node.start, node.end)).join('\n')
  const code = ['recordId', 'openWorkflowAction', 'closeWorkflowAction',
    'openReferencedRequest'].map(extractFunction).join('\n')
  const state = vm.runInContext(`${declarations}\n${code}\n;({
    referencedRecord, requestReferenceLoading, requestReferenceNotice, requestReferenceError,
    workflowAction, workflowSaving, openReferencedRequest,
  })`, context)
  const watcher = setup.scriptSetupAst.find((node) =>
    node.type === 'ExpressionStatement'
    && descriptor.scriptSetup.content.slice(node.start, node.end)
      .startsWith('watch(() => props.initialRequestId'))
  assert.ok(watcher, '组件必须监听通知异动编号并处理首次进入')
  const stop = vm.runInContext(
    descriptor.scriptSetup.content.slice(watcher.start, watcher.end), context)
  return { props, state, writes: () => writes, stop }
}

// 用途：等待响应式监听与读取 Promise 的微任务完成。
// 参数：无。
// 返回值：无。
async function settle() {
  await nextTick()
  await nextTick()
}

test('通知按真实异动编号过滤并打开待审弹窗，打开不会提交或审批', async () => {
  const calls = []
  const record = { id: 'change-1', user_id: 'user-1', status: 'PENDING_APPROVAL' }
  const h = fixture(async (query) => {
    calls.push(query)
    return { items: [{ id: 'change-10', status: 'DRAFT' }, record], total: 2 }
  })
  await settle()
  assert.equal(calls[0].keyword, 'change-1')
  assert.equal(h.state.referencedRecord.value.id, 'change-1')
  assert.equal(h.state.workflowAction.value.kind, 'approval')
  assert.equal(h.state.workflowAction.value.item.id, 'change-1')
  assert.equal(h.writes(), 0)
  h.stop()
})

test('已处理或草稿通知展示权威状态，不自动提交草稿或推进交接', async () => {
  for (const status of ['EXECUTED', 'CANCELLED', 'REJECTED', 'DRAFT', 'PENDING_HANDOVER']) {
    const h = fixture(async () => ({ items: [{ id: 'change-1', status }], total: 1 }))
    await settle()
    assert.equal(h.state.referencedRecord.value.status, status)
    assert.equal(h.state.workflowAction.value, null)
    assert.equal(h.writes(), 0)
    h.stop()
  }
})

test('同页通知换编号后迟到响应不能打开旧异动或覆盖新状态', async () => {
  const old = deferred()
  const h = fixture((query) => query.keyword === 'change-1' ? old.promise
    : Promise.resolve({ items: [{ id: 'change-2', status: 'EXECUTED' }], total: 1 }))
  h.props.initialRequestId = 'change-2'
  await settle()
  old.resolve({ items: [{ id: 'change-1', status: 'PENDING_APPROVAL' }], total: 1 })
  await settle()
  assert.equal(h.state.referencedRecord.value.id, 'change-2')
  assert.equal(h.state.workflowAction.value, null)
  assert.equal(h.state.requestReferenceLoading.value, false)
  h.props.initialRequestId = ''
  await settle()
  assert.equal(h.state.referencedRecord.value, null)
  h.stop()
})

test('流程正在处理时通知只展示详情，不替换正在处理的异动弹窗', async () => {
  const pending = deferred()
  const h = fixture(() => pending.promise)
  h.state.workflowAction.value = { item: { id: 'another-change' }, kind: 'handover' }
  h.state.workflowSaving.value = true
  pending.resolve({ items: [{ id: 'change-1', status: 'PENDING_APPROVAL' }], total: 1 })
  await settle()
  assert.equal(h.state.referencedRecord.value.id, 'change-1')
  assert.equal(h.state.workflowAction.value.item.id, 'another-change')
  assert.equal(h.writes(), 0)
  h.stop()
})

test('没有读取权限不查询；查无匹配或读取失败不误报记录不存在', async () => {
  let requests = 0
  const denied = fixture(async () => { requests++; return { items: [], total: 0 } },
    'change-1', false)
  await settle()
  assert.equal(requests, 0)
  assert.match(denied.state.requestReferenceNotice.value, /权限/)
  denied.stop()

  const readOnly = fixture(async () => ({
    items: [{ id: 'change-1', status: 'PENDING_APPROVAL' }], total: 1,
  }), 'change-1', true, false)
  await settle()
  assert.equal(readOnly.state.referencedRecord.value.status, 'PENDING_APPROVAL')
  assert.equal(readOnly.state.workflowAction.value, null)
  readOnly.stop()

  const missing = fixture(async () => ({ items: [{ id: 'change-10' }], total: 1 }))
  await settle()
  assert.equal(missing.state.referencedRecord.value, null)
  assert.match(missing.state.requestReferenceNotice.value, /未定位|未找到/)
  assert.doesNotMatch(missing.state.requestReferenceNotice.value, /不存在/)
  missing.stop()

  const failed = fixture(async () => { throw Error('connection failed') })
  await settle()
  assert.equal(failed.state.referencedRecord.value, null)
  assert.ok(failed.state.requestReferenceError.value)
  assert.doesNotMatch(failed.state.requestReferenceError.value, /不存在/)
  assert.equal(failed.state.requestReferenceLoading.value, false)
  failed.stop()
})
