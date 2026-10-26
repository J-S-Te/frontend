import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { isCurrentAuthorizationRequest } from './requestVersion.js'
import { AuthorizationError } from '../api/authorization.js'
import { replacePositionAuthorizationTemplateAssignments } from '../api/positionAuthorization.js'
import { RELATED_DATA, publishRelatedDataChanged, subscribeRelatedDataChanges } from '../../shared/utils/relatedDataInvalidation.js'
import { roleCode, toRFC3339, normalizeScopeType } from './authorizationHelpers.js'

const ref = (value) => ({ value })
const plain = (value) => JSON.parse(JSON.stringify(value))
function functions(file, names, context, declarations = '') {
  const source = readFileSync(new URL(`../components/${file}.vue`, import.meta.url), 'utf8')
  const bodies = names.map((name) => {
    const start = source.search(new RegExp(`(?:async )?function ${name}\\(`))
    assert.ok(start >= 0, `missing ${name}`)
    return source.slice(start, source.indexOf('\n}', start) + 2)
  })
  return vm.runInNewContext(`${declarations}\n${bodies.join('\n')}\n({${names.join(',')}})`, context)
}
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function saveHarness() {
  const pending = deferred()
  const applied = [], toasts = [], submitted = []
  const context = {
    authorizationSubjectId: ref('A'), authorizationSubjectType: ref('USER'), selectedApplicationCode: ref('app'),
    applicationAccessSaving: ref(false), applicationAccessError: ref(''), applicationAuthorizationRequestSeq: ref(3),
    // GET/PUT 响应回填的编辑快照版本；保存时必须原样作为 expectedRevision 提交。
    applicationAccessEditRevision: ref(`v1:${'a'.repeat(64)}`),
    authorizationEntryLayerInfo: ref({ title: '个人例外授权' }), isCurrentAuthorizationRequest,
    AuthorizationError,
    userAuthorizationPreview: ref(null),
    updateApplicationAccess: (_userId, _code, payload) => { submitted.push(payload); return pending.promise }, applicationAccessPayload: () => ({ roles: [] }),
    applyApplicationAccess: (access) => applied.push(access), emitToast: (message) => toasts.push(message),
    formatUserError: (error) => error.message,
  }
  return { context, pending, applied, toasts, submitted, ...functions('IamSettingsModule', ['performSaveApplicationAccess', 'isApplicationAccessRevisionConflict'], context,
    // 组件 setup 顶层的并发冲突消息常量在函数体外，切片提取不到；此处按同一原文补声明。
    `const APPLICATION_ACCESS_REVISION_CONFLICT_MESSAGE = '应用授权已被其他管理员修改，请刷新读取最新授权后重试。';`) }
}

test('同主体正常保存回填服务器的授权结果并结束保存状态', async () => {
  const h = saveHarness()
  const saving = h.performSaveApplicationAccess()
  const access = { manual_roles: [{ role_code: 'saved' }] }
  h.pending.resolve(access)
  assert.equal(await saving, true)
  assert.deepEqual(h.applied, [access])
  assert.match(h.toasts[0], /个人例外授权已保存/)
  assert.equal(h.context.applicationAccessSaving.value, false)
})

test('保存期间切换主体、应用或重新读取同主体均不覆盖新草稿', async () => {
  for (const change of [
    (c) => { c.authorizationSubjectId.value = 'B' },
    (c) => { c.selectedApplicationCode.value = 'other' },
    (c) => { c.applicationAuthorizationRequestSeq.value++ },
  ]) {
    const h = saveHarness()
    const saving = h.performSaveApplicationAccess()
    change(h.context)
    h.pending.resolve({ manual_roles: [{ role_code: 'A' }] })
    assert.equal(await saving, true)
    assert.equal(h.applied.length, 0)
    assert.match(h.toasts[0], /不会覆盖当前草稿/)
  }
})

function positionHarness() {
  const pending = []
  const context = {
    selectedPositionId: ref('A'), preview: ref(null), editorPreview: ref(null), editorPreviewLoading: ref(false), editorPreviewUnavailable: ref(false),
    assignedTemplateIds: ref([]), loadedAssignmentsPositionId: ref(''), assignmentsLoading: ref(false), assignmentsRevision: ref(''), assignmentsNotice: ref(''),
    canReadAuthorization: ref(true), duplicateCheckResult: ref(null), assignedTemplateEntries: ref([]),
    items: (data) => data.items || data,
    listPositionAuthorizationTemplateAssignments: (positionId) => new Promise((resolve, reject) => pending.push({ kind: 'assignments', positionId, resolve, reject })),
    previewPositionAuthorization: ({ position_id }) => new Promise((resolve, reject) => pending.push({ kind: 'preview', positionId: position_id, resolve, reject })),
    emit() {}, formatUserError: (error) => error.message,
  }
  const api = functions('PositionAuthorizationTemplates', ['loadPreview', 'loadEditorPreview', 'loadAssignments', 'isCurrentAssignmentsRequest'], context,
    'let previewRequest = 0; let editorPreviewRequest = 0; let assignmentsRequestSeq = 0;')
  return { ...api, context, pending }
}

for (const method of ['loadPreview', 'loadEditorPreview']) {
  test(`${method}: B先返回、A迟到时仅显示B`, async () => {
    const h = positionHarness()
    const a = h[method]()
    h.context.selectedPositionId.value = 'B'
    const b = h[method]()
    h.pending[1].resolve({ position_id: 'B' })
    await b
    h.pending[0].resolve({ position_id: 'A' })
    await a
    const key = method === 'loadPreview' ? 'preview' : 'editorPreview'
    assert.deepEqual(plain(h.context[key].value), { position_id: 'B' })
  })
  test(`${method}: 切空后迟到成功或失败都不能恢复旧预览`, async () => {
    for (const fail of [false, true]) {
      const h = positionHarness()
      const a = h[method]()
      h.context.selectedPositionId.value = ''
      await h[method]()
      if (fail) h.pending[0].reject(new Error('late'))
      else h.pending[0].resolve({ position_id: 'A' })
      await a
      assert.equal(h.context.preview.value, null)
      assert.equal(h.context.editorPreview.value, null)
      assert.equal(h.context.editorPreviewLoading.value, false)
      assert.equal(h.context.editorPreviewUnavailable.value, false)
    }
  })
}

test('岗位映射请求迟到时不覆盖新岗位且加载中清空旧勾选', async () => {
  const h = positionHarness()
  h.context.assignedTemplateIds.value = ['old']
  const a = h.loadAssignments()
  assert.deepEqual(plain(h.context.assignedTemplateIds.value), [])
  assert.equal(h.context.assignmentsLoading.value, true)
  h.context.selectedPositionId.value = 'B'
  const b = h.loadAssignments()
  h.pending[0].resolve({ items: [{ template_id: 'A-template', status: 'ACTIVE' }], total: 1, revision: 'revision-A' })
  await a
  assert.deepEqual(plain(h.context.assignedTemplateIds.value), [])
  h.pending[1].resolve({ items: [{ template_id: 'B-template', status: 'ACTIVE' }], total: 1, revision: 'revision-B' })
  await new Promise((resolve) => setImmediate(resolve))
  h.pending.filter((request) => request.kind === 'preview').forEach((request) => request.resolve({ position_id: 'B' }))
  await b
  assert.deepEqual(plain(h.context.assignedTemplateIds.value), ['B-template'])
  assert.equal(h.context.loadedAssignmentsPositionId.value, 'B')
  assert.equal(h.context.assignmentsRevision.value, 'revision-B')
})


const from = '2030-01-02T03:04:05.123Z'
const until = '2031-02-03T04:05:06.789Z'
function templateHarness() {
  const submitted = [], messages = []
  const context = {
    applications: ref([]), canManageAuthorization: ref(true), canReadAuthorization: ref(true), saving: ref(false),
    editingTemplateId: ref('template-A'), editingTemplateVersion: ref(7), form: ref({}),
    selectedPositionId: ref('A'), loadedAssignmentsPositionId: ref('A'), assignmentsLoading: ref(false),
    assignmentsRevision: ref('revision-A'), assignmentsNotice: ref(''), savingAssignments: ref(false),
    assignmentsRequestSeq: 0,
    assignedTemplateIds: ref([]), assignedTemplateEntries: ref([]),
    updatePositionAuthorizationTemplate: async (id, payload) => { submitted.push({ id, payload }) },
    replacePositionAuthorizationTemplateAssignments: async (id, assignments, expectedRevision) => { submitted.push({ id, assignments, expectedRevision }); return { items: assignments, total: assignments.length, revision: 'saved-revision-A' } },
    resetTemplateForm() {}, load: async () => {}, loadPreview: async () => {}, loadEditorPreview: async () => {},
    runAssignmentDuplicateCheck() {}, emit: (_event, message) => messages.push(message), formatUserError: (error) => error.message,
  }
  const names = ['items', 'id', 'applicationId', 'roleId', 'templateRoles', 'templateRoleApplicationId', 'templateRoleScopeType', 'templateRoleScopeId', 'resolveTemplateRole', 'templateEditorForm', 'createTemplate', 'saveAssignments', 'isCurrentAssignmentsRequest']
  return { ...functions('PositionAuthorizationTemplates', names, context), context, submitted, messages }
}
test('模板编辑仅改名称仍原样保留模板和两组同应用不同有效期角色', async () => {
  const h = templateHarness()
  const template = { valid_from: from, valid_until: until, roles: [
    { application_id: 'app', role_id: 'r1', scope_type: 'TENANT', valid_from: from, valid_until: until },
    { application_id: 'app', role_id: 'r2', scope_type: 'TENANT', valid_from: null, valid_until: until },
  ] }
  h.context.form.value = { name: '仅改名称', description: '', ...h.templateEditorForm(template) }
  await h.createTemplate()
  const payload = plain(h.submitted[0].payload)
  assert.equal(payload.valid_from, from)
  assert.equal(payload.valid_until, until)
  assert.deepEqual(payload.roles, template.roles.map((role) => ({ ...role, scope_id: '' })))
})
test('岗位映射保存保留已有分配有效期，新分配默认长期', async () => {
  const h = templateHarness()
  h.context.assignedTemplateIds.value = ['old', 'new']
  h.context.assignedTemplateEntries.value = [{ template_id: 'old', status: 'ACTIVE', valid_from: from, valid_until: until }]
  await h.saveAssignments()
  assert.deepEqual(plain(h.submitted[0].assignments), [
    { template_id: 'old', status: 'ACTIVE', valid_from: from, valid_until: until },
    { template_id: 'new', status: 'ACTIVE', valid_from: null, valid_until: null },
  ])
})
test('岗位映射仍在加载时不允许把旧勾选保存到新岗位', async () => {
  const h = templateHarness()
  h.context.assignmentsLoading.value = true
  await h.saveAssignments()
  assert.equal(h.submitted.length, 0)
})

function payloadHarness(manualRoles) {
  const context = {
    authorizationDraft: { role_codes: ['A', 'B'], scope_type: 'APPLICATION', environment_code: '', validity_mode: 'PERMANENT', valid_from: '', valid_until: '', apply_to_existing: false },
    applicationManualRoles: ref(manualRoles), authorizationRoleOptions: ref([{ code: 'A' }, { code: 'B' }]),
    roleCode, toRFC3339, normalizeScopeType, // 已迁 authorizationHelpers.js（治理批次 4）；真实实现直接注入
  }
  return { ...functions('IamSettingsModule', ['applicationAccessPayload'], context), context }
}
test('新增B默认保留未来A的范围和毫秒精度有效期', () => {
  const h = payloadHarness([{ code: 'A', scope_type: 'ENVIRONMENT', environment_code: 'prod', valid_from: from, valid_until: until }])
  assert.deepEqual(plain(h.applicationAccessPayload()), { roles: [
    { role_code: 'A', scope_type: 'ENVIRONMENT', environment_code: 'prod', valid_from: from, valid_until: until },
    { role_code: 'B', scope_type: 'APPLICATION', environment_code: null, valid_from: null, valid_until: null },
  ] })
})
test('同码历史条目在序列化时逐条保留；取消该角色可显式撤销全部条目', () => {
  const h = payloadHarness([
    { code: 'A', scope_type: 'ENVIRONMENT', environment_code: 'prod', valid_from: from, valid_until: until },
    { code: 'A', scope_type: 'APPLICATION', valid_from: null, valid_until: until },
  ])
  assert.equal(h.applicationAccessPayload().roles.length, 3)
  h.context.authorizationDraft.role_codes = ['B']
  assert.deepEqual(plain(h.applicationAccessPayload()).roles, [{ role_code: 'B', scope_type: 'APPLICATION', environment_code: null, valid_from: null, valid_until: null }])
})
test('只有显式统一设置才用当前表单覆盖已有角色条目', () => {
  const h = payloadHarness([{ code: 'A', scope_type: 'ENVIRONMENT', environment_code: 'prod', valid_from: from, valid_until: until }])
  h.context.authorizationDraft.apply_to_existing = true
  assert.deepEqual(plain(h.applicationAccessPayload()), { roles: [
    { role_code: 'A', scope_type: 'APPLICATION', environment_code: null, valid_from: null, valid_until: null },
    { role_code: 'B', scope_type: 'APPLICATION', environment_code: null, valid_from: null, valid_until: null },
  ] })
})

test('切换为长期有效不会取消管理员显式选择的统一应用', () => {
  const context = { authorizationDraft: { validity_mode: 'PERMANENT', valid_from: from, valid_until: until, apply_to_existing: true } }
  functions('IamSettingsModule', ['onAuthorizationValidityChange'], context).onAuthorizationValidityChange()
  assert.equal(context.authorizationDraft.apply_to_existing, true)
  assert.equal(context.authorizationDraft.valid_from, '')
  assert.equal(context.authorizationDraft.valid_until, '')
})

test('切换主体后旧保存失败不污染当前主体错误状态', async () => {
  const h = saveHarness()
  const saving = h.performSaveApplicationAccess()
  h.context.authorizationSubjectId.value = 'B'
  h.context.applicationAccessError.value = 'B自己的错误'
  h.pending.reject(new Error('A保存失败'))
  assert.equal(await saving, false)
  assert.equal(h.context.applicationAccessError.value, 'B自己的错误')
})

test('保存提交读取时的快照版本，命中409版本冲突时保留草稿并展示后端消息原文', async () => {
  const h = saveHarness()
  const conflict = new AuthorizationError('应用授权已被其他管理员修改，请刷新读取最新授权后重试。', { status: 409, code: 'APPLICATION_ACCESS_REVISION_CONFLICT' })
  const saving = h.performSaveApplicationAccess()
  assert.deepEqual(plain(h.submitted), [{ roles: [], expectedRevision: `v1:${'a'.repeat(64)}` }], 'PUT 必须携带 GET 快照版本作为并发条件')
  h.pending.reject(conflict)
  assert.equal(await saving, false)
  assert.equal(h.context.applicationAccessError.value, '应用授权已被其他管理员修改，请刷新读取最新授权后重试。')
  assert.equal(h.applied.length, 0, '冲突时不得回填服务器状态，草稿保持管理员当前输入')
  assert.equal(h.toasts.length, 0, '冲突走错误区域，不宣称保存成功')
  assert.equal(h.context.applicationAccessSaving.value, false)
})

test('其他409不冒充版本冲突，仍按保存失败处理且不回填', async () => {
  const h = saveHarness()
  const other409 = new AuthorizationError('记录状态已变化，请刷新后重试。', { status: 409, code: 'SOME_OTHER_CONFLICT' })
  const saving = h.performSaveApplicationAccess()
  h.pending.reject(other409)
  assert.equal(await saving, false)
  assert.equal(h.context.applicationAccessError.value, other409.message)
  assert.equal(h.applied.length, 0)
})

function selectionComputed(name, context) {
  const source = readFileSync(new URL('../components/IamSettingsModule.vue', import.meta.url), 'utf8')
  const start = source.indexOf(`const ${name} = computed(() => {`)
  const body = source.slice(start, source.indexOf('\n})', start) + 3)
  return vm.runInNewContext(`${body}; ${name}`, { computed: (read) => ({ get value() { return read() } }), ...context })
}
test('混合日期的不同角色允许保存；同码多条必须显式统一或撤销', async () => {
  for (const repeated of [false, true]) {
    const h = payloadHarness([
      { code: 'A', scope_type: 'ENVIRONMENT', environment_code: 'prod', valid_from: from, valid_until: until },
      { code: repeated ? 'A' : 'B', scope_type: 'APPLICATION', valid_from: null, valid_until: null },
    ])
    let saves = 0
    Object.assign(h.context, {
      authorizationSubjectId: ref('A'), authorizationSubjectType: ref('USER'), selectedApplicationCode: ref('app'), applicationAccessSaving: ref(false),
      applicationAccessError: ref(''), authorizationDirectLimitExceeded: ref(false), authorizationRolesToRevoke: ref([]),
      authorizationHasMixedRoleSettings: ref(true), roleCode: (role) => role.code,
      performSaveApplicationAccess: async () => { saves++ },
    })
    h.context.authorizationHasRepeatedManualRoles = selectionComputed('authorizationHasRepeatedManualRoles', h.context)
    const { saveApplicationAccess } = functions('IamSettingsModule', ['saveApplicationAccess'], h.context)
    await saveApplicationAccess()
    assert.equal(saves, repeated ? 0 : 1)
    if (repeated) {
      assert.match(h.context.applicationAccessError.value, /同一角色含有多条人工授权/)
      h.context.authorizationDraft.apply_to_existing = true
      await saveApplicationAccess()
      assert.equal(saves, 1)
    }
  }
})

for (const method of ['loadPreview', 'loadEditorPreview']) {
  test(`${method}: 岗位已切换但新预览尚未发出时也拒绝旧响应`, async () => {
    const h = positionHarness()
    const a = h[method]()
    h.context.selectedPositionId.value = 'B'
    h.pending[0].resolve({ position_id: 'A' })
    await a
    const key = method === 'loadPreview' ? 'preview' : 'editorPreview'
    assert.equal(h.context[key].value, null)
  })
}

test('清空岗位会失效已发出的两处预览并结束编辑器加载状态', async () => {
  const h = positionHarness()
  const a = h.loadPreview()
  const editor = h.loadEditorPreview()
  h.context.selectedPositionId.value = ''
  await h.loadAssignments()
  h.pending.forEach((request) => request.resolve({ position_id: 'A' }))
  await Promise.all([a, editor])
  assert.equal(h.context.preview.value, null)
  assert.equal(h.context.editorPreview.value, null)
  assert.equal(h.context.editorPreviewLoading.value, false)
  assert.deepEqual(plain(h.context.assignedTemplateEntries.value), [])
})


test('岗位映射缺少读取版本或只读权限时不会写入', async () => {
  for (const mode of ['missing', 'readonly']) {
    const h = templateHarness()
    if (mode === 'missing') h.context.assignmentsRevision.value = ''
    else h.context.canManageAuthorization.value = false
    await h.saveAssignments()
    assert.equal(h.submitted.length, 0)
  }
})

test('岗位映射保存提交原始版本并使用PUT返回的条目和新版本，不重读映射', async () => {
  const h = templateHarness()
  h.context.assignedTemplateIds.value = ['draft']
  // 此处通过独立函数上下文替换网络边界，执行真实页面保存函数。
  const saved = [{ assignment_id: 'server-assignment', template_id: 'server-template', status: 'ACTIVE', valid_from: from, valid_until: until }]
  let calls = 0
  const api = functions('PositionAuthorizationTemplates', ['saveAssignments', 'items', 'isCurrentAssignmentsRequest'], { ...h.context, replacePositionAuthorizationTemplateAssignments: async (id, assignments, revision) => {
    calls++
    assert.equal(id, 'A')
    assert.equal(revision, 'revision-A')
    assert.deepEqual(plain(assignments), [{ template_id: 'draft', status: 'ACTIVE', valid_from: null, valid_until: null }])
    return { items: saved, total: 1, revision: 'revision-after-save' }
  } })
  await api.saveAssignments()
  assert.equal(calls, 1)
  assert.deepEqual(plain(h.context.assignedTemplateEntries.value), saved)
  assert.deepEqual(plain(h.context.assignedTemplateIds.value), ['server-template'])
  assert.equal(h.context.assignmentsRevision.value, 'revision-after-save')
})

test('岗位映射409保留草稿和日期，清除旧版本且提示重新加载后核对，不自动重试', async () => {
  const h = templateHarness()
  const draft = [{ template_id: 'draft', status: 'ACTIVE', valid_from: from, valid_until: until }]
  h.context.assignedTemplateIds.value = ['draft', 'new']
  h.context.assignedTemplateEntries.value = draft
  let calls = 0
  const api = functions('PositionAuthorizationTemplates', ['saveAssignments', 'items', 'isCurrentAssignmentsRequest'], { ...h.context, replacePositionAuthorizationTemplateAssignments: async () => {
    calls++
    throw Object.assign(new Error('版本冲突'), { status: 409 })
  } })
  await api.saveAssignments()
  await api.saveAssignments()
  assert.equal(calls, 1)
  assert.deepEqual(plain(h.context.assignedTemplateIds.value), ['draft', 'new'])
  assert.deepEqual(plain(h.context.assignedTemplateEntries.value), draft)
  assert.equal(h.context.assignmentsRevision.value, '')
  assert.match(h.context.assignmentsNotice.value, /重新加载.*核对/)
  assert.match(h.context.assignmentsNotice.value, /草稿/)
})

test('映射保存期间切岗或重新读取同岗位，迟到成功与冲突均不覆盖新状态', async () => {
  for (const reload of [false, true]) for (const fail of [false, true]) {
    const h = templateHarness(), pending = deferred()
    h.context.assignedTemplateIds.value = ['draft-A']
    const state = { ...h.context, replacePositionAuthorizationTemplateAssignments: () => pending.promise }
    const api = functions('PositionAuthorizationTemplates', ['saveAssignments', 'items', 'isCurrentAssignmentsRequest'], state)
    const saving = api.saveAssignments()
    if (reload) state.assignmentsRequestSeq++
    else h.context.selectedPositionId.value = 'B'
    h.context.assignmentsRevision.value = 'fresh'
    h.context.assignedTemplateIds.value = ['fresh-template']
    h.context.assignedTemplateEntries.value = [{ template_id: 'fresh-template', status: 'ACTIVE' }]
    h.context.assignmentsNotice.value = 'fresh-notice'
    if (fail) pending.reject(Object.assign(new Error('旧冲突'), { status: 409 }))
    else pending.resolve({ items: [{ template_id: 'old', status: 'ACTIVE' }], total: 1, revision: 'old' })
    await saving
    assert.equal(h.context.assignmentsRevision.value, 'fresh')
    assert.deepEqual(plain(h.context.assignedTemplateIds.value), ['fresh-template'])
    assert.equal(h.context.assignmentsNotice.value, 'fresh-notice')
    assert.equal(h.messages.length, 0)
  }
})

test('岗位映射清空、失去读取权限和当前读取失败均清除旧版本', async () => {
  for (const mode of ['empty', 'readonly', 'failure']) {
    const h = positionHarness()
    h.context.assignmentsRevision.value = 'old'
    h.context.loadedAssignmentsPositionId.value = 'A'
    if (mode === 'empty') h.context.selectedPositionId.value = ''
    if (mode === 'readonly') h.context.canReadAuthorization.value = false
    const loading = h.loadAssignments()
    if (mode === 'failure') h.pending[0].reject(new Error('读取失败'))
    await loading
    assert.equal(h.context.assignmentsRevision.value, '')
    assert.equal(h.context.loadedAssignmentsPositionId.value, '')
  }
})


test('同岗位重复读取只采纳最新请求的条目与版本，读取中不保留旧版本', async () => {
  const h = positionHarness()
  h.context.assignmentsRevision.value = 'old'
  const first = h.loadAssignments()
  assert.equal(h.context.assignmentsRevision.value, '')
  const second = h.loadAssignments()
  h.pending[1].resolve({ items: [{ template_id: 'latest', status: 'ACTIVE' }], total: 1, revision: 'latest-revision' })
  await new Promise(resolve => setImmediate(resolve))
  h.pending.filter(request => request.kind === 'preview').forEach(request => request.resolve({ position_id: 'A' }))
  await second
  h.pending[0].resolve({ items: [{ template_id: 'obsolete', status: 'ACTIVE' }], total: 1, revision: 'obsolete-revision' })
  await first
  assert.deepEqual(plain(h.context.assignedTemplateIds.value), ['latest'])
  assert.equal(h.context.assignmentsRevision.value, 'latest-revision')
})

test('读取成功但响应缺版本时仍可查看条目，禁止保存并说明重新加载', async () => {
  const h = positionHarness()
  const loading = h.loadAssignments()
  h.pending[0].resolve({ items: [{ template_id: 'readable', status: 'ACTIVE' }], total: 1 })
  await new Promise(resolve => setImmediate(resolve))
  h.pending.filter(request => request.kind === 'preview').forEach(request => request.resolve({ position_id: 'A' }))
  await loading
  assert.deepEqual(plain(h.context.assignedTemplateIds.value), ['readable'])
  assert.equal(h.context.assignmentsRevision.value, '')
  assert.match(h.context.assignmentsNotice.value, /重新加载.*核对/)
})

test('保存响应缺少新版本时不沿用旧版本再次写入，保留草稿和已保存事实', async () => {
  const h = templateHarness()
  h.context.assignedTemplateIds.value = ['draft']
  let calls = 0
  const api = functions('PositionAuthorizationTemplates', ['saveAssignments', 'items', 'isCurrentAssignmentsRequest'], { ...h.context, replacePositionAuthorizationTemplateAssignments: async () => {
    calls++
    return { items: [{ template_id: 'saved', status: 'ACTIVE' }], total: 1 }
  } })
  await api.saveAssignments()
  await api.saveAssignments()
  assert.equal(calls, 1)
  assert.equal(h.context.assignmentsRevision.value, '')
  assert.deepEqual(plain(h.context.assignedTemplateIds.value), ['draft'])
  assert.match(h.context.assignmentsNotice.value, /已保存.*重新加载/)
})

test('真实API保存成功通知不触发额外GET，冲突草稿也不会被目录通知覆盖', async () => {
  const h = templateHarness()
  h.context.assignedTemplateIds.value = ['draft']
  h.context.selectionNotice = ref('')
  const requests = [], reloads = []
  const api = functions('PositionAuthorizationTemplates', ['saveAssignments', 'items', 'isCurrentAssignmentsRequest', 'handleRelatedAuthorizationChange'], {
    ...h.context, replacePositionAuthorizationTemplateAssignments, load: () => reloads.push('load'),
  })
  const originalFetch = globalThis.fetch
  const unsubscribe = subscribeRelatedDataChanges(api.handleRelatedAuthorizationChange, { kinds: [RELATED_DATA.AUTHORIZATION_TEMPLATES] })
  try {
    globalThis.fetch = async (url, options) => {
      requests.push({ url, method: options.method, body: JSON.parse(options.body) })
      return new Response(JSON.stringify({ data: { items: [{ template_id: 'saved', status: 'ACTIVE' }], total: 1, revision: 'put-revision' } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    await api.saveAssignments()
    assert.deepEqual(requests, [{ url: '/api/v1/positions/A/authorization-templates', method: 'PUT', body: {
      assignments: [{ template_id: 'draft', status: 'ACTIVE', valid_from: null, valid_until: null }], expected_revision: 'revision-A',
    } }])
    assert.deepEqual(reloads, [])
    assert.equal(h.context.assignmentsRevision.value, 'put-revision')
    h.context.assignmentsNotice.value = '当前草稿已保留，请重新加载岗位映射后核对再保存。'
    publishRelatedDataChanged([RELATED_DATA.AUTHORIZATION_TEMPLATES])
    assert.deepEqual(reloads, [])
    h.context.assignmentsNotice.value = ''
    publishRelatedDataChanged([RELATED_DATA.AUTHORIZATION_TEMPLATES])
    assert.deepEqual(reloads, ['load'])
  } finally {
    unsubscribe()
    globalThis.fetch = originalFetch
  }
})
