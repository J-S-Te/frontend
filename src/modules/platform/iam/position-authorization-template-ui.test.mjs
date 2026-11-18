import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { inspectPositionTemplateDuplicates } from './utils/positionAuthorizationDuplicates.js'

const source = await readFile(new URL('./components/PositionAuthorizationTemplates.vue', import.meta.url), 'utf8')

// 用途：执行真实页面查重和保存逻辑，仅替换网络与预览边界。
// 参数：assignments 为岗位已有模板映射，保留其原始期限供页面查重和保存。
// 返回值：页面控制器、响应式状态及提交和提醒记录。
function duplicateCheckController(assignments) {
  const submitted = [], messages = []
  const templates = ['A', 'B'].map((template_id) => ({
    template_id, status: 'ACTIVE',
    roles: [{ application_id: 'app', role_id: 'reviewer', scope_type: 'TENANT' }],
  }))
  const state = {
    selectedPositionId: { value: 'position' }, activeTemplates: { value: templates },
    assignedTemplateIds: { value: ['A', 'B'] }, assignedTemplateEntries: { value: assignments },
    duplicateCheckResult: { value: null }, canManageAuthorization: { value: true },
    saving: { value: false }, savingAssignments: { value: false },
    assignmentsLoading: { value: false }, loadedAssignmentsPositionId: { value: 'position' },
    assignmentsRevision: { value: 'revision' }, assignmentsNotice: { value: '' },
    assignmentsRequestSeq: 0, inspectPositionTemplateDuplicates,
    replacePositionAuthorizationTemplateAssignments: async (positionId, entries, revision) => {
      submitted.push({ positionId, entries, revision })
      return { items: entries, total: entries.length, revision: 'saved-revision' }
    },
    loadPreview: async () => {}, loadEditorPreview: async () => {},
    emit: (_event, message) => messages.push(message), formatUserError: (error) => error.message,
  }
  const names = ['runAssignmentDuplicateCheck', 'saveAssignments', 'isCurrentAssignmentsRequest']
  const bodies = names.map((name) => {
    const start = source.search(new RegExp(`(?:async )?function ${name}\\(`))
    assert.ok(start >= 0, `missing ${name}`)
    return source.slice(start, source.indexOf('\n}', start) + 2)
  })
  const controls = vm.runInNewContext(`${bodies.join('\n')}\n({${names.join(',')}})`, state)
  return { ...controls, state, submitted, messages }
}

test('页面查重纳入已读取的岗位映射期限', (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-03-01T00:00:00Z'))
  const controller = duplicateCheckController([
    { template_id: 'A', status: 'ACTIVE', valid_until: '2026-06-01T00:00:00Z' },
    { template_id: 'B', status: 'ACTIVE', valid_from: '2026-07-01T00:00:00Z' },
  ])

  controller.runAssignmentDuplicateCheck()

  assert.equal(controller.state.duplicateCheckResult.value.duplicate_group_count, 0)
  assert.equal(controller.submitted.length, 0)
  assert.match(controller.messages[0], /没有重复权限/)
})

test('页面发现重复只提醒，仍保存完整岗位映射及原始有效期', async (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-03-01T00:00:00Z'))
  const controller = duplicateCheckController([
    { template_id: 'A', status: 'ACTIVE', valid_until: '2026-08-01T00:00:00Z' },
    { template_id: 'B', status: 'ACTIVE', valid_from: '2026-07-01T00:00:00Z' },
  ])

  controller.runAssignmentDuplicateCheck()
  assert.equal(controller.state.duplicateCheckResult.value.duplicate_group_count, 1)
  assert.match(controller.messages[0], /发现 1 组重复权限/)
  await controller.saveAssignments()

  assert.equal(controller.submitted.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(controller.submitted[0])), {
    positionId: 'position', revision: 'revision',
    entries: [
      { template_id: 'A', status: 'ACTIVE', valid_from: null, valid_until: '2026-08-01T00:00:00Z' },
      { template_id: 'B', status: 'ACTIVE', valid_from: '2026-07-01T00:00:00Z', valid_until: null },
    ],
  })
  assert.equal(controller.state.duplicateCheckResult.value.duplicate_group_count, 1)
  assert.match(controller.messages.at(-1), /映射已保存/)
})

test('template editor groups all saved application roles and normalizes legacy IDs', () => {
  assert.match(source, /function templateEditorForm\(template\)/)
  assert.match(source, /function roleId\(role\)/)
  assert.match(source, /const \[primary, \.\.\.additional\] = \[\.\.\.groups\.values\(\)\]/)
  assert.match(source, /additional_roles: additional/)
})

test('position template assignments use compact role summaries and pagination', () => {
  assert.match(source, /const templatePageSize = 6/)
  assert.match(source, /const pagedActiveTemplates = computed\(\(\) =>/)
  assert.match(source, /class="iam-template-pagination"/)
  assert.match(source, /templateRoleLabels\(template\)\.slice\(0, 2\)/)
})

test('template editing resolves legacy role records through the loaded target catalog', () => {
  assert.match(source, /function resolveTemplateRole\(role\)/)
  assert.match(source, /itemCode === applicationCode/)
  assert.match(source, /itemName === roleName/)
  assert.match(source, /roleId\(targetRole\)/)
})

test('岗位模板映射提供一键查重并展示重复权限来源', () => {
  assert.match(source, /inspectPositionTemplateDuplicates/)
  assert.match(source, /function runAssignmentDuplicateCheck\(notify = true\)/)
  assert.match(source, />一键查重<\/button>/)
  assert.match(source, /发现 \$\{duplicateCheckResult\.value\.duplicate_group_count\} 组重复权限/)
  assert.match(source, /查重依据为应用、角色、授权范围及有效期交集/)
  assert.match(source, /重复来源：\{\{ duplicate\.templates\.map/)
  assert.match(source, /watch\(assignedTemplateIds, \(\) => \{ duplicateCheckResult\.value = null \}/)
})
test('追加子系统下拉排除已选应用', () => {
  assert.match(source, /from '@\/modules\/platform\/iam\/utils\/positionAuthorizationApplicationOptions'/)
  assert.match(source, /function additionalApplicationOptions\(row\)/)
  assert.match(source, /v-for="app in additionalApplicationOptions\(row\)"/)
})
