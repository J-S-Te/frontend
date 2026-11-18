import assert from 'node:assert/strict'
import test from 'node:test'

import { inspectPositionTemplateDuplicates } from './positionAuthorizationDuplicates.js'

const now = Date.parse('2026-03-01T00:00:00Z')

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
  ], ['A', 'B'], { now })

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
  ], ['tenant', 'future', 'environment'], { now })

  assert.equal(result.duplicate_group_count, 0)
  assert.equal(result.checked_role_count, 3)
})

test('忽略停用角色并报告缺失模板和没有有效角色的模板', () => {
  const result = inspectPositionTemplateDuplicates([
    template('empty', [role({ status: 'DISABLED' })]),
  ], ['empty', 'missing', 'missing'], { now })

  assert.deepEqual(result.missing_template_ids, ['missing'])
  assert.deepEqual(result.empty_templates, [{ template_id: 'empty', template_name: '模板empty' }])
  assert.equal(result.checked_role_count, 0)
})

for (const [label, start] of [
  ['互不重叠', '2026-07-01T00:00:00Z'],
  ['首尾相接', '2026-06-01T00:00:00Z'],
]) {
  test(`岗位映射有效期${label}时不提示重复`, () => {
    const result = inspectPositionTemplateDuplicates([
      template('A', [role()]),
      template('B', [role()]),
    ], ['A', 'B'], {
      now,
      assignments: [
        { template_id: 'A', valid_until: '2026-06-01T00:00:00Z' },
        { template: { template_id: 'B' }, valid_from: start },
      ],
    })

    assert.equal(result.duplicate_group_count, 0)
    assert.equal(result.checked_role_count, 2)
  })
}

test('岗位映射有效期重叠时仍提示相同应用角色与范围重复', () => {
  const result = inspectPositionTemplateDuplicates([
    template('A', [role()]),
    template('B', [role()]),
  ], ['A', 'B'], {
    now,
    assignments: [
      { template_id: 'A', valid_until: '2026-08-01T00:00:00Z' },
      { template_id: 'B', valid_from: '2026-07-01T00:00:00Z' },
    ],
  })

  assert.equal(result.duplicate_group_count, 1)
  assert.deepEqual(result.duplicates[0].templates.map((item) => item.template_id), ['A', 'B'])
})

test('岗位映射必须同时与模板和角色条目的有效期存在交集', () => {
  const valid_until = '2026-06-01T00:00:00Z'
  for (const limited of [
    template('A', [role()], { valid_until }),
    template('A', [role({ valid_until })]),
  ]) {
    const result = inspectPositionTemplateDuplicates([
      limited,
      template('B', [role()]),
    ], ['A', 'B'], {
      now,
      assignments: [{ template_id: 'A', valid_from: '2026-07-01T00:00:00Z' }],
    })

    assert.equal(result.duplicate_group_count, 0)
    assert.equal(result.checked_role_count, 1)
    assert.deepEqual(result.empty_templates, [{ template_id: 'A', template_name: '模板A' }])
  }
})

for (const layer of ['模板', '岗位映射', '角色条目']) {
  test(`${layer}已经到期或恰好到期时不参与查重`, () => {
    for (const valid_until of ['2026-02-28T23:59:59Z', '2026-03-01T00:00:00Z']) {
      const result = inspectPositionTemplateDuplicates([
        template('A', [role(layer === '角色条目' ? { valid_until } : {})],
          layer === '模板' ? { valid_until } : {}),
        template('B', [role()]),
      ], ['A', 'B'], {
        now,
        assignments: layer === '岗位映射' ? [{ template_id: 'A', valid_until }] : [],
      })

      assert.equal(result.duplicate_group_count, 0)
      assert.equal(result.checked_role_count, 1)
      assert.deepEqual(result.empty_templates, [{ template_id: 'A', template_name: '模板A' }])
    }
  })
}

test('未来生效映射与新勾选的长期模板仍参与查重且不修改输入', () => {
  const templates = [template('A', [role()]), template('new', [role()])]
  const selectedIds = ['A', 'new']
  const assignments = [{ template_id: 'A', valid_from: '2026-07-01T00:00:00Z' }]
  const before = structuredClone({ templates, selectedIds, assignments })
  const result = inspectPositionTemplateDuplicates(templates, selectedIds, { assignments, now })

  assert.equal(result.duplicate_group_count, 1)
  assert.equal(result.checked_role_count, 2)
  assert.deepEqual({ templates, selectedIds, assignments }, before)
})

test('未显式传入时间时按本次查重的当前时间排除过期配置', (t) => {
  t.mock.method(Date, 'now', () => now)
  const result = inspectPositionTemplateDuplicates([
    template('A', [role()], { valid_until: '2026-02-28T23:59:59Z' }),
    template('B', [role()]),
  ], ['A', 'B'])

  assert.equal(result.duplicate_group_count, 0)
  assert.equal(result.checked_role_count, 1)
})
