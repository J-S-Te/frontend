import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkAnyPermission, checkPermission, hasAnyPermission, hasPermission } from './permissions.js'

// 严格策略：principal / code 任意一项缺失或不合法都直接拒绝，避免空码意外放行。
// 真正的安全边界仍是后端 403；前端只是用来隐藏入口和按钮。

test('checkPermission 缺 code → 拒绝', () => {
  assert.equal(checkPermission({ permission_codes: [] }, ''), false)
  assert.equal(checkPermission({ permission_codes: [] }, null), false)
  assert.equal(checkPermission({ permission_codes: [] }, undefined), false)
})

test('checkPermission principal 缺失或非对象 → 拒绝', () => {
  assert.equal(checkPermission(null, 'platform:user:read'), false)
  assert.equal(checkPermission(undefined, 'platform:user:read'), false)
  assert.equal(checkPermission('not-an-object', 'platform:user:read'), false)
  assert.equal(checkPermission(42, 'platform:user:read'), false)
})

test('checkPermission permission_codes 缺失或非数组 → 拒绝', () => {
  assert.equal(checkPermission({}, 'platform:user:read'), false)
  assert.equal(checkPermission({ permission_codes: 'oops' }, 'platform:user:read'), false)
  assert.equal(checkPermission({ permission_codes: null }, 'platform:user:read'), false)
})

test('checkPermission permission_codes 是空数组 → 拒绝（strict 模式）', () => {
  // 一旦后端开始下发非空列表，未命中即视为不通过；空数组也按"未授权"处理。
  assert.equal(checkPermission({ permission_codes: [] }, 'platform:user:read'), false)
})

test('checkPermission 非空权限列表 + 命中 → 通过', () => {
  assert.equal(
    checkPermission({ permission_codes: ['platform:user:read', 'platform:user:write'] }, 'platform:user:write'),
    true,
  )
})

test('checkPermission 非空权限列表 + 未命中 → 拒绝', () => {
  assert.equal(
    checkPermission({ permission_codes: ['platform:user:read'] }, 'platform:user:delete'),
    false,
  )
})

test('checkPermission * 和 all 是通配', () => {
  assert.equal(checkPermission({ permission_codes: ['*'] }, 'platform:user:delete'), true)
  assert.equal(checkPermission({ permission_codes: ['all'] }, 'platform:organization:write'), true)
  // 配合通配时其他权限码共存也仍然放行
  assert.equal(
    checkPermission({ permission_codes: ['*', 'platform:user:read'] },
      'platform:user:write'),
    true,
  )
})

test('checkPermission permission_codes 包含非字符串项时不影响命中', () => {
  // 后端如果混入 null/对象，正确实现应能容忍；只对字符串做命中比对。
  const principal = { permission_codes: [null, 'platform:user:read', { code: 'x' }] }
  assert.equal(checkPermission(principal, 'platform:user:read'), true)
  assert.equal(checkPermission(principal, 'platform:user:write'), false)
})

test('checkAnyPermission 缺 code 列表 → 拒绝', () => {
  assert.equal(checkAnyPermission({ permission_codes: [] }, null), false)
  assert.equal(checkAnyPermission({ permission_codes: [] }, []), false)
  assert.equal(checkAnyPermission({ permission_codes: [] }, undefined), false)
})

test('checkAnyPermission principal 缺失 → 拒绝', () => {
  assert.equal(checkAnyPermission(null, ['platform:user:read']), false)
  assert.equal(checkAnyPermission(undefined, ['platform:user:read']), false)
})

test('checkAnyPermission 至少一个 code 命中即通过', () => {
  const principal = { permission_codes: ['platform:user:read'] }
  assert.equal(checkAnyPermission(principal, ['platform:user:write', 'platform:user:read']), true)
  assert.equal(checkAnyPermission(principal, ['platform:user:write', 'platform:user:delete']), false)
})

test('checkAnyPermission 通配放行', () => {
  assert.equal(
    checkAnyPermission({ permission_codes: ['*'] }, ['platform:user:delete', 'platform:role:write']),
    true,
  )
})

test('checkAnyPermission 全部未命中且非空权限列表 → 拒绝', () => {
  const principal = { permission_codes: ['platform:user:read'] }
  assert.equal(checkAnyPermission(principal, ['platform:user:write', 'platform:user:delete']), false)
})

test('strict 边界：空数组权限码在 hasPermission / hasAnyPermission 也拒绝', () => {
  // 便捷别名与 checkX 共享同一种语义，不能因为加了薄壳就把"严格"绕过。
  const principal = { permission_codes: [] }
  assert.equal(hasPermission(principal, 'platform:user:delete'), false)
  assert.equal(hasAnyPermission(principal, ['platform:user:delete', 'platform:role:write']), false)
})

test('strict 边界：一旦下发非空列表，未命中立即拒绝', () => {
  // 这是后端开始下发权限后的关键行为：未授权用户看不到危险按钮。
  const principal = { permission_codes: ['platform:user:read'] }
  assert.equal(checkPermission(principal, 'platform:user:delete'), false)
  assert.equal(checkAnyPermission(principal, ['platform:user:delete', 'platform:role:write']), false)
})
