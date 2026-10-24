import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const { descriptor } = parse(readFileSync(new URL('./IamSettingsModule.vue', import.meta.url), 'utf8'))
const setup = compileScript(descriptor, { id: 'iam-membership' })
function saveWith(overrides = {}) {
  const node = setup.scriptSetupAst.find(n => n.type === 'FunctionDeclaration' && n.id.name === 'saveMembershipInheritance')
  assert.ok(node, 'existing membership must support saving inheritance')
  const target = { kind: 'membership', item: { membership_id: 'm1', version: 2, inherit_authorization: false } }
  const state = {
    detail: { value: target }, membershipInheritanceDraft: { value: true },
    membershipInheritanceSaving: { value: false }, membershipInheritanceError: { value: '' }, membershipInheritanceConflict: { value: false },
    hasPermission: () => true, IAM_PERMISSIONS: { membershipUpdate: 'update' },
    updateMembershipInheritance: async () => ({ membership_id: 'm1', inherit_authorization: true, version: 3 }),
    emitToast: () => {}, formatUserError: e => e.message, loadMemberships: async () => {}, ...overrides,
  }
  return { state, target, save: vm.runInNewContext(`(${descriptor.scriptSetup.content.slice(node.start, node.end)})`, state) }
}

test('saving existing inheritance uses server response and new version', async () => {
  const { state, target, save } = saveWith()
  await save()
  assert.equal(target.item.inherit_authorization, true)
  assert.equal(target.item.version, 3)
  assert.equal(state.membershipInheritanceSaving.value, false)
})
test('no update permission and duplicate submits do not write', async () => {
  for (const overrides of [{ hasPermission: () => false }, { membershipInheritanceSaving: { value: true } }]) {
    let writes = 0
    const { save } = saveWith({ ...overrides, updateMembershipInheritance: async () => { writes++ } })
    await save()
    assert.equal(writes, 0)
  }
})
test('failed writes preserve checkbox draft and saved membership; conflicts require explicit reload', async () => {
  for (const status of [403, 404, 409, 500]) {
    const { state, target, save } = saveWith({ updateMembershipInheritance: async () => { throw Object.assign(new Error('failed'), { status }) } })
    await save()
    assert.equal(target.item.inherit_authorization, false)
    assert.equal(target.item.version, 2)
    assert.equal(state.membershipInheritanceDraft.value, true)
    assert.ok(state.membershipInheritanceError.value)
    if (status === 409 || status === 404) assert.equal(state.membershipInheritanceConflict.value, true)
    assert.equal(state.membershipInheritanceSaving.value, false)
  }
})
test('late response cannot change another membership detail', async () => {
  let resolve
  const { state, target, save } = saveWith({ updateMembershipInheritance: () => new Promise(r => { resolve = r }) })
  const pending = save()
  const other = { kind: 'membership', item: { membership_id: 'm2', version: 1 } }
  state.detail.value = other
  resolve({ membership_id: 'm1', version: 3, inherit_authorization: true })
  await pending
  assert.equal(other.item.version, 1)
  assert.equal(target.item.version, 2)
})
test('conflicted draft cannot be automatically resubmitted', async () => {
  let writes = 0
  const { save } = saveWith({ membershipInheritanceConflict: { value: true }, updateMembershipInheritance: async () => { writes++ } })
  await save()
  assert.equal(writes, 0)
})
test('membership details template compiles', () => {
  const result = compileTemplate({ source: descriptor.template.content, filename: 'IamSettingsModule.vue', id: 'iam-membership', compilerOptions: { bindingMetadata: setup.bindings } })
  assert.deepEqual(result.errors, [])
})

test('disabling inheritance sends false and retains other membership details', async () => {
  let requested
  const { state, target, save } = saveWith({ membershipInheritanceDraft: { value: false }, updateMembershipInheritance: async (membership, enabled) => {
    requested = enabled
    return { ...membership, inherit_authorization: enabled, version: 3 }
  } })
  target.item.inherit_authorization = true
  target.item.effective_to = '2026-12-31'
  await save()
  assert.equal(requested, false)
  assert.equal(target.item.inherit_authorization, false)
  assert.equal(target.item.effective_to, '2026-12-31')
  assert.equal(state.membershipInheritanceDraft.value, false)
})

test('unchanged inheritance makes no request', async () => {
  let writes = 0
  const { save } = saveWith({ membershipInheritanceDraft: { value: false }, updateMembershipInheritance: async () => { writes++ } })
  await save()
  assert.equal(writes, 0)
})

test('late failure after closing details does not leave an error in another dialog', async () => {
  let reject
  const { state, save } = saveWith({ updateMembershipInheritance: () => new Promise((_, r) => { reject = r }) })
  const pending = save()
  state.detail.value = null
  reject(Object.assign(new Error('old error'), { status: 409 }))
  await pending
  assert.equal(state.membershipInheritanceError.value, '')
  assert.equal(state.membershipInheritanceConflict.value, false)
})
