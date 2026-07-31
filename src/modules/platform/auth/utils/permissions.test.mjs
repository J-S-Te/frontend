import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkAnyPermission, checkPermission } from './permissions.js'

test('checkPermission 短路：未提供 code 直接通过', () => {
  assert.equal(checkPermission({ permission_codes: [] }, ''), true)
  assert.equal(checkPermission({ permission_codes: [] }, null), true)
  assert.equal(checkPermission({ permission_codes: [] }, undefined), true)
})

test('checkPermission principal 缺失或非对象 → fail-open', () => {
  assert.equal(checkPermission(null, 'iam:user:read'), true)
  assert.equal(checkPermission(undefined, 'iam:user:read'), true)
  assert.equal(checkPermission('not-an-object', 'iam:user:read'), true)
  assert.equal(checkPermission(42, 'iam:user:read'), true)
})

test('checkPermission permission_codes 缺失或非数组 → fail-open', () => {
  assert.equal(checkPermission({}, 'iam:user:read'), true)
  assert.equal(checkPermission({ permission_codes: 'oops' }, 'iam:user:read'), true)
  assert.equal(checkPermission({ permission_codes: null }, 'iam:user:read'), true)
})

test('checkPermission permission_codes 是空数组 → fail-open（兼容过渡期）', () => {
  assert.equal(checkPermission({ permission_codes: [] }, 'iam:user:read'), true)
})

test('checkPermission 非空权限列表 + 命中 → 通过', () => {
  assert.equal(
    checkPermission({ permission_codes: ['iam:user:read', 'iam:user:write'] }, 'iam:user:write'),
    true,
  )
})

test('checkPermission 非空权限列表 + 未命中 → 拒绝', () => {
  assert.equal(
    checkPermission({ permission_codes: ['iam:user:read'] }, 'iam:user:delete'),
    false,
  )
})

test('checkPermission * 和 all 是通配', () => {
  assert.equal(checkPermission({ permission_codes: ['*'] }, 'iam:user:delete'), true)
  assert.equal(checkPermission({ permission_codes: ['all'] }, 'iam:organization:write'), true)
  // 配合通配时其他权限码共存也仍然放行
  assert.equal(
    checkPermission({ permission_codes: ['*', 'iam:user:read'] },
      'iam:user:write'),
    true,
  )
})

test('checkPermission permission_codes 包含非字符串项时不影响命中', () => {
  // 后端如果混入 null/对象，正确实现应能容忍；只对字符串做命中比对。
  const principal = { permission_codes: [null, 'iam:user:read', { code: 'x' }] }
  assert.equal(checkPermission(principal, 'iam:user:read'), true)
  assert.equal(checkPermission(principal, 'iam:user:write'), false)
})

test('checkAnyPermission 缺失 code 列表 → 通过', () => {
  assert.equal(checkAnyPermission({ permission_codes: [] }, null), true)
  assert.equal(checkAnyPermission({ permission_codes: [] }, []), true)
  assert.equal(checkAnyPermission({ permission_codes: [] }, undefined), true)
})

test('checkAnyPermission principal 缺失 → fail-open', () => {
  assert.equal(checkAnyPermission(null, ['iam:user:read']), true)
  assert.equal(checkAnyPermission(undefined, ['iam:user:read']), true)
})

test('checkAnyPermission 至少一个 code 命中即通过', () => {
  const principal = { permission_codes: ['iam:user:read'] }
  assert.equal(checkAnyPermission(principal, ['iam:user:write', 'iam:user:read']), true)
  assert.equal(checkAnyPermission(principal, ['iam:user:write', 'iam:user:delete']), false)
})

test('checkAnyPermission 通配放行', () => {
  assert.equal(
    checkAnyPermission({ permission_codes: ['*'] }, ['iam:user:delete', 'iam:role:write']),
    true,
  )
})

test('checkAnyPermission 全部未命中且非空权限列表 → 拒绝', () => {
  const principal = { permission_codes: ['iam:user:read'] }
  assert.equal(checkAnyPermission(principal, ['iam:user:write', 'iam:user:delete']), false)
})

test('fail-open 边界：permission_codes 空数组仍视为放行', () => {
  // 这是过渡期的关键行为：后端还没下发显式权限时，前端不能突然把所有按钮都藏起来。
  const principal = { permission_codes: [] }
  assert.equal(checkPermission(principal, 'iam:user:delete'), true)
  assert.equal(checkAnyPermission(principal, ['iam:user:delete', 'iam:role:write']), true)
})

test('fail-open 关闭边界：一旦下发非空列表，未命中立即拒绝', () => {
  // 这是后端开始下发权限后的关键行为：未授权用户看不到危险按钮。
  const principal = { permission_codes: ['iam:user:read'] }
  assert.equal(checkPermission(principal, 'iam:user:delete'), false)
  assert.equal(checkAnyPermission(principal, ['iam:user:delete', 'iam:role:write']), false)
})
