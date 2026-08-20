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
