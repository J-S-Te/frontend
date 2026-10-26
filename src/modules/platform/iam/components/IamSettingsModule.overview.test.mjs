import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const source = readFileSync(new URL('./IamSettingsModule.vue', import.meta.url), 'utf8')
const { descriptor, errors } = parse(source)
const script = compileScript(descriptor, { id: 'iam-settings-overview' })
const template = compileTemplate({
  source: descriptor.template.content,
  filename: 'IamSettingsModule.vue',
  id: 'iam-settings-overview',
  compilerOptions: { bindingMetadata: script.bindings },
})

test('user detail uses application overview component and keeps personal exception collapsed by default', () => {
  assert.deepEqual(errors, [])
  assert.deepEqual(template.errors, [])
  assert.match(descriptor.scriptSetup.content, /EffectiveAuthorizationOverview/)
  assert.match(descriptor.scriptSetup.content, /applicationAccessExpanded = ref\(false\)/)
  assert.match(descriptor.scriptSetup.content, /retryUserAuthorizationPreview/)
  assert.match(descriptor.scriptSetup.content, /manageUserApplicationAccess/)
  assert.match(descriptor.scriptSetup.content, /onApplicationSelectionChange/)
  assert.match(descriptor.scriptSetup.content, /hasUnsavedAuthorizationDraft/)
  assert.match(descriptor.scriptSetup.content, /refreshUserAuthorizationPreview/)
  assert.match(descriptor.scriptSetup.content, /PersonalExceptionAuthorization/)
  assert.match(descriptor.scriptSetup.content, /personalExceptionDirty/)
  assert.match(descriptor.template.content, /刷新全部/)
  assert.match(descriptor.template.content, /<EffectiveAuthorizationOverview/)
  assert.match(descriptor.template.content, /<PersonalExceptionAuthorization/)
  assert.match(descriptor.template.content, /v-show="applicationAccessExpanded"/)
  assert.match(descriptor.template.content, /个人例外授权默认收起/)
  assert.doesNotMatch(descriptor.template.content, /userAuthorizationPreviewBySource/)
  assert.doesNotMatch(descriptor.template.content, /userAuthorizationPreviewMerged/)
})

test('user personal exception no longer uses the old global save/revoke form', () => {
  assert.doesNotMatch(descriptor.template.content, /@click="saveApplicationAccess"/)
  assert.match(descriptor.template.content, /@revoke-all="revokeAllPersonalExceptions"/)
  assert.match(descriptor.template.content, /@dirty-change="onPersonalExceptionDirtyChange"/)
})
