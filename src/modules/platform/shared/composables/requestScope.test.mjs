import assert from 'node:assert/strict'
import test from 'node:test'
import { effectScope } from 'vue'
import { createRequestScope } from './requestScope.js'

test('begin 返回包含业务对象 key 与请求序号的票据，且发起后立即视为当前', () => {
  const scope = createRequestScope()
  const ticket = scope.begin('USER:u-1:contract_management')
  assert.equal(ticket.key, 'USER:u-1:contract_management')
  assert.equal(typeof ticket.seq, 'number')
  assert.equal(scope.isCurrent(ticket), true)
})

test('同一对象重复读取：新 begin 使旧票据失效，只采纳最后一次响应', () => {
  const scope = createRequestScope()
  const first = scope.begin('USER:u-1:contract_management')
  const second = scope.begin('USER:u-1:contract_management')
  assert.equal(scope.isCurrent(first), false, '重复读取必须丢弃前一次结果')
  assert.equal(scope.isCurrent(second), true)
})

test('切换业务对象后旧对象票据失效（R04：旧响应不得污染新对象）', () => {
  const scope = createRequestScope()
  const previous = scope.begin('USER:u-1:contract_management')
  scope.begin('USER:u-2:contract_management')
  assert.equal(scope.isCurrent(previous), false)
  const current = scope.begin('USER:u-2:contract_management')
  assert.equal(scope.isCurrent(current), true)
})

test('invalidate 使当前票据失效；之后再次 begin 恢复可用（切换对象不销毁作用域）', () => {
  const scope = createRequestScope()
  const ticket = scope.begin('USER:u-1:contract_management')
  scope.invalidate()
  assert.equal(scope.isCurrent(ticket), false, '关闭弹窗 / 切换对象时主动失效')
  const next = scope.begin('USER:u-2:contract_management')
  assert.equal(scope.isCurrent(next), true)
})

test('非票据输入与其他作用域的票据都不视为当前', () => {
  const scopeA = createRequestScope()
  const scopeB = createRequestScope()
  const ticketA = scopeA.begin('USER:u-1:contract_management')
  const ticketB = scopeB.begin('USER:u-1:contract_management')
  assert.equal(scopeA.isCurrent(ticketB), false, '作用域实例相互独立')
  assert.equal(scopeB.isCurrent(ticketA), false)
  assert.equal(scopeA.isCurrent(null), false)
  assert.equal(scopeA.isCurrent(undefined), false)
  assert.equal(scopeA.isCurrent({ key: 'USER:u-1:contract_management', seq: Number.MAX_SAFE_INTEGER }), false)
})

test('组件作用域销毁（卸载）时自动失效既有票据，且不再接受新票据', () => {
  const vueScope = effectScope()
  let requests
  vueScope.run(() => { requests = createRequestScope() })
  const ticket = requests.begin('USER:u-1:contract_management')
  assert.equal(requests.isCurrent(ticket), true)
  vueScope.stop()
  assert.equal(requests.isCurrent(ticket), false, '组件卸载后在途响应必须全部失效')
  const late = requests.begin('USER:u-1:contract_management')
  assert.equal(requests.isCurrent(late), false, '卸载后误发的新请求也不得回写')
})

test('无 Vue 作用域环境（单元测试）创建后可手动 invalidate 模拟卸载', () => {
  const scope = createRequestScope()
  const ticket = scope.begin('USER:u-1:contract_management')
  scope.invalidate()
  assert.equal(scope.isCurrent(ticket), false)
})
