import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const source = readFileSync(new URL('./PersonalExceptionAuthorization.vue', import.meta.url), 'utf8')
const { descriptor, errors } = parse(source)
const script = compileScript(descriptor, { id: 'personal-exception-authorization' })
const template = compileTemplate({
  source: descriptor.template.content,
  filename: 'PersonalExceptionAuthorization.vue',
  id: 'personal-exception-authorization',
  compilerOptions: { bindingMetadata: script.bindings },
})

test('personal exception panel compiles and owns list/editor orchestration', () => {
  assert.deepEqual(errors, [])
  assert.deepEqual(template.errors, [])
  assert.match(descriptor.scriptSetup.content, /PersonalExceptionEditor/)
  assert.match(descriptor.scriptSetup.content, /buildPersonalExceptionView/)
  assert.match(descriptor.scriptSetup.content, /buildPersonalExceptionPayload/)
  assert.match(descriptor.template.content, /<PersonalExceptionEditor/)
  assert.match(descriptor.template.content, /@update:draft="onDraftUpdate"/)
  assert.match(descriptor.template.content, /@submit="submitEditor"/)
  assert.match(descriptor.scriptSetup.content, /emit\('revoke-role'/)
  assert.match(descriptor.scriptSetup.content, /emit\('revoke-all'/)
  assert.match(descriptor.scriptSetup.content, /emit\('dirty-change'/)
})

test('personal exception panel does not call backend or reuse the old global checkbox form', () => {
  assert.doesNotMatch(descriptor.scriptSetup.content, /updateApplicationAccess|deleteApplicationAccess|fetch\(/)
  assert.doesNotMatch(descriptor.template.content, /role_codes|apply_to_existing|保存个人例外/)
})

test('panel exposes empty, incompatible, read-only, anomaly and inherited states', () => {
  assert.match(descriptor.template.content, /!access/)
  assert.match(descriptor.template.content, /!complete/)
  assert.match(descriptor.template.content, /!catalogReady/)
  assert.match(descriptor.template.content, /!canManage/)
  assert.match(descriptor.template.content, /anomalyGroups/)
  assert.match(descriptor.template.content, /view\.inheritedGroups/)
  assert.match(descriptor.template.content, /个人例外授权默认收起|当前没有个人例外/)
  assert.match(descriptor.template.content, /同角色/)
  assert.match(descriptor.template.content, /aria-live="polite"/)
})
