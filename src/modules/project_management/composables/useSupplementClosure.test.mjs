import assert from 'node:assert/strict'
import test from 'node:test'
import { useSupplementClosure } from './useSupplementClosure.js'
import { formatUserError } from '../../shared/utils/userError.js'

const PROJECT = {
  id: 'PJ-1',
  name: '园区环境检测',
  status: '补充协议处理中',
  supplement_status: 'REQUIRED',
  customer_id: 'C-1',
  contract_id: 'HT-ORIGINAL',
  contract: 'HT-ORIGINAL',
}
const CONTRACTS = [
  { id: 'SUP-1', contract_number: 'HT-SUP', title: '补充协议', customer_id: 'C-1', customer_name: '示例客户', status: 'active', approval_passed: true },
  { id: 'SUP-ORIGINAL', contract_number: 'HT-ORIGINAL', title: '原合同', customer_id: 'C-1', customer_name: '示例客户', status: 'active', approval_passed: true },
]

function harness({ contracts = CONTRACTS, loadError = null, closeError = null, confirm = true } = {}) {
  const calls = { list: [], close: [], toasts: [], refresh: 0, confirm: [] }
  const deps = {
    listSupplementContracts: async (projectID, options) => {
      calls.list.push([projectID, options])
      if (loadError) throw loadError
      return contracts
    },
    closeSupplement: async (projectID, payload) => {
      calls.close.push([projectID, payload])
      if (closeError) throw closeError
      return { status: '待分配' }
    },
    formatUserError,
    showToast: (message, type) => calls.toasts.push({ message, type }),
    refreshAfterWrite: async () => { calls.refresh += 1 },
    askConfirm: async (options) => { calls.confirm.push(options); return confirm },
  }
  return { calls, deps, ...useSupplementClosure(deps) }
}

function fillForm(closure, { contract = 'SUP-1', reason = '补充协议范围已全部回写，拆解已推进到实施阶段' } = {}) {
  closure.closureForm.value.supplementContractID = contract
  closure.closureForm.value.reason = reason
}

test('非补充协议处理中的项目不打开关账弹窗，也不请求补充协议目录', async () => {
  const closure = harness()
  await closure.openSupplementClosure({ ...PROJECT, supplement_status: 'NONE' })
  assert.equal(closure.closureOpen.value, false)
  assert.deepEqual(closure.calls.list, [])
  assert.equal(closure.calls.toasts[0].type, 'warning')
})

test('打开关账时按项目读取补充协议目录并只保留可提交候选', async () => {
  const closure = harness()
  await closure.openSupplementClosure(PROJECT)
  assert.equal(closure.closureProject.value.id, 'PJ-1')
  assert.equal(closure.closureOpen.value, true)
  assert.deepEqual(closure.calls.list, [['PJ-1', { limit: 200 }]])
  assert.deepEqual(closure.closureContracts.value.map((item) => item.id), ['SUP-1'])
  assert.equal(closure.closureLoading.value, false)
  assert.equal(closure.closureLoadError.value, '')
})

test('目录加载失败时弹窗保留错误并允许重试', async () => {
  let attempts = 0
  const calls = { list: 0 }
  const closure = useSupplementClosure({
    listSupplementContracts: async () => {
      calls.list += 1
      if (attempts++ === 0) throw Object.assign(new Error('合同服务暂不可用'), { status: 503, code: 'PM_CONTRACT_UNAVAILABLE' })
      return CONTRACTS
    },
    closeSupplement: async () => ({ status: '待分配' }),
    formatUserError,
    showToast: () => {},
    refreshAfterWrite: async () => {},
    askConfirm: async () => true,
  })
  await closure.openSupplementClosure(PROJECT)
  assert.equal(closure.closureOpen.value, true)
  assert.equal(closure.closureLoading.value, false)
  assert.ok(closure.closureLoadError.value.length > 0)
  assert.deepEqual(closure.closureContracts.value, [])

  await closure.reloadSupplementClosure()
  assert.equal(calls.list, 2)
  assert.equal(closure.closureLoadError.value, '')
  assert.deepEqual(closure.closureContracts.value.map((item) => item.id), ['SUP-1'])
})

test('原因必填：未填原因不发请求、不弹二次确认，并把原因显示在弹窗内', async () => {
  const closure = harness()
  await closure.openSupplementClosure(PROJECT)
  fillForm(closure, { reason: '   ' })
  await closure.submitSupplementClosure()
  assert.equal(closure.closureError.value, '请填写关闭补充协议的原因')
  assert.deepEqual(closure.calls.confirm, [])
  assert.deepEqual(closure.calls.close, [])
  assert.equal(closure.closureOpen.value, true)
  assert.equal(closure.calls.toasts.at(-1).type, 'warning')
})

test('提交前必须二次确认：取消时保留弹窗且不调用关账接口', async () => {
  const closure = harness({ confirm: false })
  await closure.openSupplementClosure(PROJECT)
  fillForm(closure)
  await closure.submitSupplementClosure()
  assert.equal(closure.calls.confirm.length, 1)
  assert.equal(closure.calls.confirm[0].title, '确认关闭补充协议？')
  assert.match(closure.calls.confirm[0].description, /范围指纹/)
  assert.match(closure.calls.confirm[0].description, /不能再通过「确认拆解」清除/)
  assert.match(closure.calls.confirm[0].description, /PJ-1/)
  assert.deepEqual(closure.calls.close, [])
  assert.equal(closure.closureOpen.value, true)
  assert.equal(closure.closureSaving.value, false)
})

test('确认后提交绑定补充协议与去空白原因，成功后关闭弹窗并刷新项目数据', async () => {
  const closure = harness()
  await closure.openSupplementClosure(PROJECT)
  fillForm(closure, { reason: '  补充协议范围已回写  ' })
  await closure.submitSupplementClosure()
  assert.deepEqual(closure.calls.close, [['PJ-1', { supplement_contract_id: 'SUP-1', reason: '补充协议范围已回写' }]])
  assert.equal(closure.closureOpen.value, false)
  assert.equal(closure.closureSaving.value, false)
  assert.equal(closure.calls.refresh, 1)
  assert.match(closure.calls.toasts.at(-1).message, /补充协议已关账/)
  assert.match(closure.calls.toasts.at(-1).message, /待分配/)
  assert.equal(closure.calls.toasts.at(-1).type, 'success')
})

test('403 无权限与 409 状态冲突都保留在弹窗内，不能伪装成功', async () => {
  const denied = harness({ closeError: Object.assign(new Error('当前用户没有执行此操作的权限'), { status: 403, code: 'PM_FORBIDDEN' }) })
  await denied.openSupplementClosure(PROJECT)
  fillForm(denied)
  await denied.submitSupplementClosure()
  assert.match(denied.closureError.value, /权限/)
  assert.equal(denied.closureOpen.value, true)
  assert.equal(denied.calls.refresh, 0)
  assert.equal(denied.calls.toasts.at(-1).type, 'error')

  const conflict = harness({ closeError: Object.assign(new Error('当前项目不在补充协议处理中，无需关账'), { status: 409, code: 'PM_PRECONDITION_FAILED' }) })
  await conflict.openSupplementClosure(PROJECT)
  fillForm(conflict)
  await conflict.submitSupplementClosure()
  assert.match(conflict.closureError.value, /补充协议处理中/)
  assert.equal(conflict.closureOpen.value, true)
  assert.equal(conflict.calls.refresh, 0)
  assert.equal(conflict.closureSaving.value, false)
})

test('切换项目时迟到的旧目录响应不能覆盖新项目', async () => {
  const requested = []
  let releaseFirst
  const closure = useSupplementClosure({
    listSupplementContracts: (projectID) => {
      requested.push(projectID)
      if (requested.length === 1) return new Promise((resolve) => { releaseFirst = resolve })
      return Promise.resolve([{ ...CONTRACTS[0], id: 'SUP-NEW', contract_number: 'HT-SUP-NEW' }])
    },
    closeSupplement: async () => ({ status: '待分配' }),
    formatUserError,
    showToast: () => {},
    refreshAfterWrite: async () => {},
    askConfirm: async () => true,
  })
  const first = closure.openSupplementClosure({ ...PROJECT, id: 'PJ-OLD' })
  const second = closure.openSupplementClosure({ ...PROJECT, id: 'PJ-NEW' })
  releaseFirst([{ ...CONTRACTS[0], id: 'SUP-OLD', contract_number: 'HT-SUP-OLD' }])
  await first
  await second
  assert.equal(closure.closureProject.value.id, 'PJ-NEW')
  assert.deepEqual(closure.closureContracts.value.map((item) => item.id), ['SUP-NEW'])
  assert.equal(closure.closureLoading.value, false)
})

for (const change of ['close', 'form', 'project', 'version']) {
  test(`关账二次确认期间 ${change} 改变：不执行未确认范围`, async () => {
    let resolve
    const closure = harness()
    closure.deps.askConfirm = () => new Promise((yes) => { resolve = yes })
    // 使用延迟确认依赖重新建立真实组合函数实例。
    Object.assign(closure, useSupplementClosure(closure.deps))
    await closure.openSupplementClosure({ ...PROJECT, version: 3 })
    fillForm(closure)
    const pending = closure.submitSupplementClosure()
    if (change === 'close') closure.closeSupplementClosure()
    if (change === 'form') closure.closureForm.value.reason = '未经确认的新原因'
    if (change === 'project') await closure.openSupplementClosure({ ...PROJECT, id: 'PJ-2' })
    if (change === 'version') closure.closureProject.value.version += 1
    resolve(true)
    await pending
    assert.equal(closure.calls.close.length, 0)
  })
}

test('关账二次确认期间重复提交只开启一次确认', async () => {
  let resolve
  const closure = harness()
  closure.deps.askConfirm = () => { closure.calls.confirm.push({}); return new Promise((yes) => { resolve = yes }) }
  Object.assign(closure, useSupplementClosure(closure.deps))
  await closure.openSupplementClosure(PROJECT)
  fillForm(closure)
  const pending = closure.submitSupplementClosure()
  const duplicate = closure.submitSupplementClosure()
  assert.equal(closure.calls.confirm.length, 1)
  resolve(false)
  await Promise.all([pending, duplicate])
  assert.equal(closure.calls.close.length, 0)
})

for (const change of ['permission', 'busy']) {
  test(`关账二次确认期间 ${change} 失效：复核后不写入`, async () => {
    let resolve
    let allowed = true
    const closure = harness()
    closure.deps.askConfirm = () => new Promise((yes) => { resolve = yes })
    closure.deps.closureAllowed = () => allowed
    Object.assign(closure, useSupplementClosure(closure.deps))
    await closure.openSupplementClosure(PROJECT)
    fillForm(closure)
    const pending = closure.submitSupplementClosure()
    if (change === 'permission') allowed = false
    if (change === 'busy') closure.closureSaving.value = true
    resolve(true)
    await pending
    assert.equal(closure.calls.close.length, 0)
  })
}
