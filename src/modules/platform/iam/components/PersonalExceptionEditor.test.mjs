import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const source = readFileSync(new URL('./PersonalExceptionEditor.vue', import.meta.url), 'utf8')
const { descriptor, errors } = parse(source)
const script = compileScript(descriptor, { id: 'personal-exception-editor' })
const template = compileTemplate({
  source: descriptor.template.content,
  filename: 'PersonalExceptionEditor.vue',
  id: 'personal-exception-editor',
  compilerOptions: { bindingMetadata: script.bindings },
})

test('personal exception editor compiles and exposes single-role fields', () => {
  assert.deepEqual(errors, [])
  assert.deepEqual(template.errors, [])
  assert.match(descriptor.template.content, /type="datetime-local"/)
  assert.match(descriptor.template.content, /影响确认/)
  assert.match(descriptor.template.content, /原值/)
  assert.match(descriptor.template.content, /新值/)
  assert.match(descriptor.template.content, /其他角色/)
  assert.match(descriptor.template.content, /aria-describedby/)
  assert.match(descriptor.template.content, /aria-live="polite"/)
  assert.match(descriptor.scriptSetup.content, /确认新增|保存修改|确认统一调整/)
})

test('editor preserves untouched raw times and never changes role on edit', () => {
  assert.match(descriptor.scriptSetup.content, /validFromTouched/)
  assert.match(descriptor.scriptSetup.content, /validUntilTouched/)
  assert.match(descriptor.scriptSetup.content, /resolvePersonalExceptionDraft/)
  assert.match(descriptor.scriptSetup.content, /isCreate\.value/)
  assert.doesNotMatch(descriptor.scriptSetup.content, /updateApplicationAccess|fetch\(/)
  assert.match(descriptor.template.content, /@keydown\.esc\.stop\.prevent/)
})
