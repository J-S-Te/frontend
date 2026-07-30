import assert from 'node:assert/strict'
import { test } from 'node:test'
import { authorizationEntryLayer, duplicatedInheritedRoleCodes } from './authorizationEntryLayer.js'

test('authorization entry layers separate standard position templates from direct exceptions', () => {
  assert.equal(authorizationEntryLayer('USER').title, '个人例外授权')
  assert.match(authorizationEntryLayer('POSITION').standard, /岗位授权模板/)
  assert.match(authorizationEntryLayer('ORG_UNIT').risk, /影响该组织内多名有效成员/)
  assert.equal(authorizationEntryLayer('unknown').title, '应用例外授权')
})

test('duplicated inherited role codes identifies a manual role already produced by inheritance', () => {
  assert.deepEqual(duplicatedInheritedRoleCodes(
    ['sales', { role_code: 'audit_admin' }, 'sales'],
    [{ code: 'sales' }, { role_code: 'tech_director' }],
  ), ['sales'])
  assert.deepEqual(duplicatedInheritedRoleCodes(['audit_admin'], [{ code: 'sales' }]), [])
})
