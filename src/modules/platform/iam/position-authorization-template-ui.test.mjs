import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./components/PositionAuthorizationTemplates.vue', import.meta.url), 'utf8')

test('template editor groups all saved application roles and normalizes legacy IDs', () => {
  assert.match(source, /function templateEditorForm\(template\)/)
  assert.match(source, /String\(role\?\.role_id \|\| role\?\.roleId \|\| role\?\.id \|\| ''\)/)
  assert.match(source, /const \[primary, \.\.\.additional\] = \[\.\.\.groups\.values\(\)\]/)
  assert.match(source, /additional_roles: additional/)
})
