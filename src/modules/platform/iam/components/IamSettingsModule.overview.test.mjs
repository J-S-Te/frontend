import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { RELATED_DATA, publishRelatedDataChanged, subscribeRelatedDataChanges } from '../../shared/utils/relatedDataInvalidation.js'
import { isCurrentAuthorizationRequest } from '../utils/requestVersion.js'

const source = readFileSync(new URL('./IamSettingsModule.vue', import.meta.url), 'utf8')
const { descriptor, errors } = parse(source)
const script = compileScript(descriptor, { id: 'iam-settings-overview' })
const template = compileTemplate({
  source: descriptor.template.content,
  filename: 'IamSettingsModule.vue',
  id: 'iam-settings-overview',
  compilerOptions: { bindingMetadata: script.bindings },
})

// 用途：执行真实关联通知回调，核对总览刷新与个人例外草稿保护。
// 参数：dirty 为未保存草稿状态，saving 为写入状态，confirming 为待确认操作状态。
// 返回值：已登记的真实通知订阅、动作记录及用户上下文。
function authorizationRefreshHarness({ dirty = false, saving = false, confirming = false } = {}) {
  const calls = []
  const context = {
    RELATED_DATA, detail: { value: { kind: 'user', item: { user_id: 'user' } } },
    canReadApplicationAuthorization: { value: true }, personalExceptionDirty: { value: dirty },
    applicationAccessSaving: { value: saving }, applicationAccessRevoking: { value: false },
    confirmDialog: { value: confirming ? { title: '确认撤销个人例外' } : null },
    selectedApplicationCode: { value: 'business' },
    refreshUserAuthorizationPreview: async () => { calls.push('overview') },
    loadApplicationAuthorization: async (code) => { calls.push(`editor:${code}`) },
    loadOrganizations() {}, loadPositions() {}, loadMemberships() {}, loadUsers() {},
  }
  const node = script.scriptSetupAst.find((item) => item.type === 'ExpressionStatement'
    && item.expression?.callee?.name === 'useRelatedDataInvalidation')
  const callback = descriptor.scriptSetup.content.slice(node.start, node.end)
  const start = descriptor.scriptSetup.content.indexOf('async function refreshRelatedUserAuthorization(')
  const body = start < 0 ? '' : descriptor.scriptSetup.content.slice(start,
    descriptor.scriptSetup.content.indexOf('\n}', start) + 2)
  let unsubscribe
  new Function('useRelatedDataInvalidation', ...Object.keys(context), `${body}\n${callback}`)(
    (handler, options) => { unsubscribe = subscribeRelatedDataChanges(handler, options) },
    ...Object.values(context))
  return { calls, context, unsubscribe: () => unsubscribe() }
}

for (const options of [{}, { dirty: true }, { saving: true }, { confirming: true }]) {
  test(`模板保存通知刷新有效总览，保护个人草稿：${JSON.stringify(options)}`, async () => {
    const h = authorizationRefreshHarness(options)
    try {
      publishRelatedDataChanged(RELATED_DATA.AUTHORIZATION_TEMPLATES)
      await Promise.resolve()
      assert.deepEqual(h.calls, options.dirty || options.saving || options.confirming
        ? ['overview'] : ['overview', 'editor:business'])
    } finally {
      h.unsubscribe()
    }
  })
}

test('关联变更不对无读取权限或已关闭详情的用户请求授权', async () => {
  for (const readonly of [true, false]) {
    const h = authorizationRefreshHarness()
    if (readonly) h.context.canReadApplicationAuthorization.value = false
    else h.context.detail.value = null
    try {
      publishRelatedDataChanged(RELATED_DATA.AUTHORIZATION_TEMPLATES)
      await Promise.resolve()
      assert.deepEqual(h.calls, [])
    } finally {
      h.unsubscribe()
    }
  }
})

for (const method of ['performPersonalExceptionSave', 'revokeAllPersonalExceptions']) {
  test(`${method} 将确认操作绑定原快照版本，不随后台读取升级`, async () => {
    let confirmation
    const submitted = []
    const context = {
      authorizationSubjectId: { value: 'user' }, authorizationSubjectType: { value: 'USER' },
      selectedApplicationCode: { value: 'business' }, selectedApplication: { value: { name: '业务' } },
      applicationAccessSaving: { value: false }, applicationAccessRevoking: { value: false },
      applicationAccessError: { value: '' }, applicationAccessEditRevision: { value: 'old-revision' },
      applicationAuthorizationRequestSeq: { value: 1 }, isCurrentAuthorizationRequest,
      applicationDisplayName: (app) => app.name,
      openConfirm: (dialog) => { confirmation = dialog },
      updateApplicationAccess: async (_user, _application, payload) => {
        submitted.push(payload)
        throw new Error('controlled network failure')
      },
      deleteApplicationAccess: async (_user, _application, payload) => {
        submitted.push(payload)
        throw new Error('controlled network failure')
      },
      isApplicationAccessRevisionConflict: () => false, formatUserError: (error) => error.message,
      isCurrentApplicationAccessSubject: () => true,
    }
    const start = source.indexOf(`function ${method}(`)
    const body = source.slice(start, source.indexOf('\n}', start) + 2)
    const run = new Function(...Object.keys(context), `${body}\nreturn ${method};`)(...Object.values(context))
    run({ payload: { roles: [{ role_code: 'keep' }] }, summary: '撤销旧角色', count: 2 })
    context.applicationAccessEditRevision.value = 'revision-after-another-admin-added-role'
    await confirmation.onConfirm()

    assert.equal(submitted.length, 1)
    assert.equal(submitted[0].expectedRevision, 'old-revision')
  })
}

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
