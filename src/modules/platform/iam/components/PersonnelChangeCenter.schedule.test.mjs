// A10 排期恢复入口：交接项全部完成后仍需允许直接重试排期，已完成项不得重复写入。
// 参考 dashboard-scope-ui.test.mjs 的 SFC 编译方式，直接执行组件中的纯函数。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const source = readFileSync(new URL('./PersonnelChangeCenter.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const setup = compileScript(descriptor, { id: 'personnel-change-schedule' })

function extractFunction(name) {
  const node = setup.scriptSetupAst.find((item) => item.type === 'FunctionDeclaration' && item.id.name === name)
  assert.ok(node, `PersonnelChangeCenter.vue 必须定义 ${name}`)
  return descriptor.scriptSetup.content.slice(node.start, node.end)
}

function evaluateFunction(name, context = {}) {
  return vm.runInNewContext(`(${extractFunction(name)})`, context)
}

const isHandoverItemDone = evaluateFunction('isHandoverItemDone')
const unfinishedHandoverItems = evaluateFunction('unfinishedHandoverItems', { isHandoverItemDone })
const handoverFailureMessage = evaluateFunction('handoverFailureMessage')

test('交接排期模板可编译，全部完成时不再强制选择接收人', () => {
  const compiled = compileTemplate({
    source: descriptor.template.content,
    filename: 'PersonnelChangeCenter.vue',
    id: 'personnel-change-schedule',
    compilerOptions: { bindingMetadata: setup.bindings },
  })
  assert.deepEqual(compiled.errors, [])
})

test('已完成交接项不进入待提交集合，重试不会重复写入', () => {
  const items = [
    { id: 'item-1', status: 'COMPLETED' },
    { id: 'item-2', status: 'PENDING' },
    { id: 'item-3', status: 'completed' },
    { id: 'item-4' },
    { id: 'item-5', status: 'TRANSFERRED' },
    { id: 'item-6', status: 'skipped' },
  ]
  assert.deepEqual(unfinishedHandoverItems(items).map((item) => item.id), ['item-2', 'item-4'])
  assert.equal(isHandoverItemDone({ status: 'TRANSFERRED' }), true)
  assert.equal(isHandoverItemDone({ status: 'SKIPPED' }), true)
  assert.equal(isHandoverItemDone({ status: 'PENDING' }), false)
  // 非数组输入按“没有待完成项”处理，而不是抛错阻断排期恢复。
  assert.equal(unfinishedHandoverItems(undefined).length, 0)
  assert.equal(unfinishedHandoverItems(null).length, 0)
})

test('交接项全部完成时待提交集合为空，页面可直接重试排期', () => {
  const completed = [{ id: 'item-1', status: 'COMPLETED' }, { id: 'item-2', status: 'COMPLETED' }]
  assert.equal(unfinishedHandoverItems(completed).length, 0)
  const confirm = extractFunction('confirmWorkflowAction')
  // 修复前的提前返回会让“全部完成 + 排期失败”的异动单无法恢复。
  assert.doesNotMatch(confirm, /没有可完成的责任交接项/)
  assert.match(confirm, /const pending = unfinishedHandoverItems\(handoverItems\.value\)/)
  assert.match(confirm, /for \(const item of pending\)/)
})

test('重试前读取权威交接状态，只提交未完成项', () => {
  const confirm = extractFunction('confirmWorkflowAction')
  // 首次提交使用弹窗已读取的交接项；只有失败后的重试才回读权威状态。
  assert.match(confirm, /if \(handoverRetryPending\.value\) \{/)
  assert.match(confirm, /handoverRetryPending\.value = true/)
  assert.match(confirm, /await listPersonnelHandoverItems\(recordId\(workflowAction\.value\.item\)\)/)
  assert.match(confirm, /handoverItems\.value = .*\.items/)
  // 接收人只在确实存在待交接项时才必填；全部完成时允许不选接收人。
  assert.match(confirm, /pending\.length && !handoverTargetUserId\.value/)
  assert.match(confirm, /completePersonnelHandoverItem\(recordId\(workflowAction\.value\.item\), item\.id, handoverTargetUserId\.value\)/)
  assert.match(confirm, /Object\.assign\(item, result\)/)
  assert.equal(isHandoverItemDone({ batch_id: 'batch-1', status: 'COMPLETED' }), false)
})

test('交接或排期失败提示可直接重试，并说明已完成项不会重复提交', () => {
  const noneCompleted = handoverFailureMessage(0, '网络中断')
  assert.match(noneCompleted, /可直接重试/)
  assert.match(noneCompleted, /已完成项不会重复提交/)
  assert.match(noneCompleted, /网络中断/)

  const someCompleted = handoverFailureMessage(2, '排期请求超时')
  assert.match(someCompleted, /已确认完成 2 项责任交接/)
  assert.match(someCompleted, /可直接重试/)
  assert.match(someCompleted, /排期请求超时/)

  // 失败提示不能只让用户关闭并刷新，否则全部完成时仍无法从页面恢复。
  assert.doesNotMatch(someCompleted, /请关闭窗口并刷新/)
})
