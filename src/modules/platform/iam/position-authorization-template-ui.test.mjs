import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./components/PositionAuthorizationTemplates.vue', import.meta.url), 'utf8')

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
