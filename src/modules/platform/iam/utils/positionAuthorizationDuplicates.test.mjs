import assert from 'node:assert/strict'
import test from 'node:test'

import { inspectPositionTemplateDuplicates } from './positionAuthorizationDuplicates.js'

function role(overrides = {}) {
  return {
    application_id: 'app-contract',
    application_name: '合同管理',
    role_id: 'role-reviewer',
    role_name: '合同审批人',
    scope_type: 'TENANT',
    status: 'ACTIVE',
    ...overrides,
  }
}

function template(id, roles, overrides = {}) {
  return { template_id: id, name: `模板${id}`, status: 'ACTIVE', roles, ...overrides }
}

test('查出不同模板中有效期重叠的相同应用角色与范围', () => {
  const result = inspectPositionTemplateDuplicates([
    template('A', [role({ valid_from: '2026-01-01T00:00:00Z' })]),
    template('B', [role({ valid_until: '2026-12-31T00:00:00Z' })]),
  ], ['A', 'B'])

  assert.equal(result.duplicate_group_count, 1)
  assert.equal(result.duplicate_assignment_count, 1)
  assert.deepEqual(result.duplicates[0].templates.map((item) => item.template_id), ['A', 'B'])
  assert.equal(result.duplicates[0].application_name, '合同管理')
  assert.equal(result.duplicates[0].role_name, '合同审批人')
})

test('不同授权范围或互不重叠的有效期不判为重复', () => {
  const result = inspectPositionTemplateDuplicates([
    template('tenant', [role({ valid_until: '2026-06-01T00:00:00Z' })]),
    template('future', [role({ valid_from: '2026-06-01T00:00:00Z' })]),
    template('environment', [role({ scope_type: 'ENVIRONMENT', scope_id: 'prod' })]),
  ], ['tenant', 'future', 'environment'])

  assert.equal(result.duplicate_group_count, 0)
  assert.equal(result.checked_role_count, 3)
})

test('忽略停用角色并报告缺失模板和没有有效角色的模板', () => {
  const result = inspectPositionTemplateDuplicates([
    template('empty', [role({ status: 'DISABLED' })]),
  ], ['empty', 'missing', 'missing'])

  assert.deepEqual(result.missing_template_ids, ['missing'])
  assert.deepEqual(result.empty_templates, [{ template_id: 'empty', template_name: '模板empty' }])
  assert.equal(result.checked_role_count, 0)
})
