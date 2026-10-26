import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { initialCredentialsForImport, initialCredentialsDocument, clearInitialCredentials } from './employeeInitialCredentials.js'

const source = await readFile(new URL('../components/BatchUserImportDialog.vue', import.meta.url), 'utf8')
const submit = source.slice(source.indexOf('async function submit() {'), source.indexOf('// ---- 关闭 ----'))
const controls = source.slice(source.indexOf('// ---- 关闭 ----'), source.indexOf('function formatFileSize'))
const credential = { account_name: 'fixture-account', initial_password: 'isolated-fixture-only' }

function fixture(result) {
  const events = []
  const state = {
    submitting: { value: false }, submitError: { value: '' }, credentialsVisible: { value: false },
    selectedValidRows: { value: [{ displayName: 'fixture', lineNo: 2, applicationRoles: [] }] },
    selectedFile: { value: null }, submitResult: { value: null }, step: { value: 2 }, BATCH_LIMIT: 100,
    createEmployeesBatch: async () => result,
    emit: (name, payload) => events.push({ name, payload }),
    // 提交前的关联目录闸门：目录读取中 / 失败 / 预览过期时不得提交。
    // 这里只提供夹具，目录一致性本身由 relatedDataRefresh.test.mjs 与
    // batchUserImport 的目录重核验断言覆盖。
    props: { catalogsLoading: false, catalogsError: '' },
    previewStale: { value: false },
    revalidatePreview: () => {},
    catalogNotice: { value: '' },
    previewCatalogSignature: { value: '' },
    IamError: class IamError extends Error {}, formatBatchError: () => 'fixture-error',
    closeConfirm: { value: null }, askConfirm: async () => true, acceptClose: () => {}, cancelClose: () => {},
    initialCredentialsForImport, initialCredentialsDocument, clearInitialCredentials,
    rows: [], rawText: { value: '' }, fileName: { value: '' }, fileSize: { value: 0 }, parseError: { value: '' }, filterMode: { value: 'all' },
  }
  const controller = vm.runInNewContext(`${submit}\n${controls}\n({ submit, close, restart, onBackdropClick, onKeydown, downloadInitialCredentials })`, state)
  return { state, controller, events }
}

test('successful batch preserves returned credentials only in the result, initially masked', async () => {
  const { state, controller, events } = fixture({ items: [{ user_id: 'fixture-user', line_no: 2 }], initial_credentials: [credential] })
  await controller.submit()
  assert.equal(state.submitResult.value.createdCount, 1)
  assert.equal(state.submitResult.value.initialCredentials[0].initialPassword, credential.initial_password)
  assert.equal(state.credentialsVisible.value, false)
  assert.equal(state.submitResult.value.credentialsUnavailable, false)
  assert.ok(events.some(e => e.name === 'completed'))
  assert.ok(!JSON.stringify(events).includes(credential.initial_password), 'toast/completion must not copy credentials')
  assert.ok(!source.includes('!QAZxsw@1234'), 'result must not advertise a shared default password')
  assert.match(source, /:type="credentialsVisible \? 'text' : 'password'"/)
  assert.match(source, /onBeforeUnmount\(\(\) => clearInitialCredentials/)
  assert.match(source, /if \(props\.catalogsLoading\)/)
  assert.match(source, /if \(previewStale\.value\)/)
})

test('missing or malformed credentials do not falsely tell the operator to repeat a successful import', async () => {
  for (const values of [undefined, [], [null], [credential, credential]]) {
    const { state, controller, events } = fixture({ items: [{ user_id: 'fixture-user', line_no: 2 }], initial_credentials: values })
    await controller.submit()
    assert.equal(state.submitResult.value.createdCount, 1)
    assert.equal(state.submitResult.value.failedCount, 0)
    assert.equal(state.submitResult.value.credentialsUnavailable, true)
    assert.equal(state.submitResult.value.initialCredentials.length, 0)
    assert.ok(events.some(e => e.name === 'completed'))
  }
})

test('credential handoff rejects duplicate names, count mismatch and control characters', () => {
  assert.equal(initialCredentialsForImport({ initial_credentials: [credential, credential] }, 2), null)
  assert.equal(initialCredentialsForImport({ initial_credentials: [credential] }, 2), null)
  assert.equal(initialCredentialsForImport({ initial_credentials: [{ ...credential, account_name: 'fixture\naccount' }] }, 1), null)
  assert.equal(initialCredentialsForImport({ initial_credentials: [{ ...credential, initial_password: '' }] }, 1), null)
  assert.equal(initialCredentialsForImport({ initial_credentials: [credential] }, 0), null)
})

test('explicit export preserves exact passwords as JSON rather than spreadsheet formulas', () => {
  const records = [{ accountName: 'fixture-account', initialPassword: '@fixture,\"password' }]
  const value = JSON.parse(initialCredentialsDocument(records))
  assert.equal(value.initial_credentials[0].initial_password, records[0].initialPassword)
  assert.equal(value.initial_credentials[0].account_name, records[0].accountName)
  assert.equal(value.initial_credentials[0].must_change_password, true)
})

test('close, backdrop, escape and restart erase held result secrets', async () => {
  for (const action of ['close', 'onBackdropClick', 'escape', 'restart']) {
    const { state, controller } = fixture({ items: [{ user_id: 'fixture-user', line_no: 2 }], initial_credentials: [credential] })
    await controller.submit()
    const held = state.submitResult.value.initialCredentials[0]
    state.credentialsVisible.value = true
    if (action === 'escape') await controller.onKeydown({ key: 'Escape', stopPropagation() {} })
    else await controller[action]()
    assert.equal(held.initialPassword, '')
    assert.equal(state.credentialsVisible.value, false)
    assert.ok(!state.submitResult.value || state.submitResult.value.initialCredentials.length === 0)
  }
})

test('explicit browser export removes its link and revokes the object URL', async () => {
  const { state, controller } = fixture({ items: [{ user_id: 'fixture-user', line_no: 2 }], initial_credentials: [credential] })
  await controller.submit()
  let blob, clicks = 0, removes = 0, revokes = 0
  const link = { click() { clicks++ }, remove() { removes++ } }
  state.Blob = Blob
  state.URL = { createObjectURL(value) { blob = value; return 'blob:fixture' }, revokeObjectURL(url) { assert.equal(url, 'blob:fixture'); revokes++ } }
  state.document = { createElement() { return link }, body: { appendChild(value) { assert.equal(value, link) } } }
  controller.downloadInitialCredentials()
  assert.equal(clicks, 1)
  assert.equal(removes, 1)
  assert.equal(revokes, 1)
  assert.equal(JSON.parse(await blob.text()).initial_credentials[0].initial_password, credential.initial_password)
})
