import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { formatUserError } from '../../shared/utils/userError.js'
import { externalContractMetadata } from '../utils/contractPayload.js'

const source = await readFile(new URL('./contract.js', import.meta.url), 'utf8')
const moduleSource = source.replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
  .replaceAll('import.meta.env', '({})').replace(/^export /gm, '')
const api = new Function('formatUserError', 'externalContractMetadata', 'attachStructuredContext', 'subsystemAccessMessage',
  `${moduleSource}; return { listContracts, listSigningRecords, listContractTemplates, listApprovalTasks, listApprovals, listApprovalRules, listOpportunityIntakes, listContractDetectionCategories, listMyCustomers, listMyOpportunities, createContract, createExternalContract, updateContractDraft, createApprovalRule, updateApprovalRule, submitContract, commandApproval };\n//# sourceURL=contract-api-under-test.js`)(
  formatUserError, externalContractMetadata, (error, context) => { error.testRequestContext = context }, (error, message) => message)

async function withResponse(body, contentType, run, status = 200) {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response(body, { status, headers: { 'Content-Type': contentType } })
  try { return await run() } finally { globalThis.fetch = original }
}

test('contract and CRM directory pages reject missing or invalid items instead of reporting no choices', async () => {
  for (const data of [{}, { unexpected: [] }, { items: {} }, { items: 'missing' }]) {
    await withResponse(JSON.stringify({ code: 'OK', data, request_id: 'directory-request' }), 'application/json', async () => {
      for (const call of [api.listOpportunityIntakes, api.listContractDetectionCategories]) {
        await assert.rejects(call(), (error) => error.code === 'INVALID_CONTRACT_RESPONSE')
      }
      for (const call of [api.listMyCustomers, api.listMyOpportunities]) {
        await assert.rejects(call(), (error) => error.code === 'INVALID_DIRECTORY_RESPONSE' && error.requestID === 'directory-request')
      }
    })
  }
})

test('directory pages keep valid empty arrays and Go nil items, including legacy CRM arrays', async () => {
  for (const items of [[], null]) {
    await withResponse(JSON.stringify({ code: 'OK', data: { items, page_size: 50, total: 0, has_more: false } }), 'application/json', async () => {
      assert.deepEqual(await api.listContractDetectionCategories(), [])
      for (const call of [api.listOpportunityIntakes, api.listMyCustomers, api.listMyOpportunities]) assert.deepEqual((await call()).items, [])
    })
  }
  await withResponse('{"code":"OK","data":[]}', 'application/json', async () => {
    for (const call of [api.listOpportunityIntakes, api.listMyCustomers, api.listMyOpportunities]) assert.deepEqual((await call()).items, [])
  })
})

test('contract reads and writes reject HTML 200, malformed JSON and missing success envelopes', async () => {
  const invalid = [
    ['<!doctype html><title>portal</title>', 'text/html'],
    ['{broken', 'application/json'],
    ['{}', 'application/json'],
    ['{"code":"OK"}', 'application/json'],
    ['{"code":"ERROR","data":{}}', 'application/json'],
    ['{"code":"OK","data":"saved"}', 'application/json'],
    ['[]', 'application/json'],
    ['null', 'application/json'],
  ]
  for (const [body, type] of invalid) {
    await withResponse(body, type, async () => {
      await assert.rejects(api.listContracts(), (error) => error.code === 'INVALID_CONTRACT_RESPONSE')
      await assert.rejects(api.createContract({ title: '测试' }), (error) => error.code === 'INVALID_CONTRACT_RESPONSE')
    })
  }
})

test('contract envelopes retain lists, null legacy lists, mutation results and JSON media parameters', async () => {
  for (const type of ['application/json; charset=utf-8', 'application/vnd.contract+json']) {
    await withResponse('{"code":"OK","data":[{"id":"one"}]}', type, async () => {
      assert.deepEqual(await api.listContracts(), [{ id: 'one' }])
    })
  }
  await withResponse('{"code":"OK","data":null}', 'application/json', async () => {
    assert.deepEqual(await api.listContracts(), [])
  })
  await withResponse('{"code":"OK","data":{"id":"one","version":1,"status":"draft"}}', 'application/json', async () => {
    assert.deepEqual(await api.createContract({ title: '测试' }), { id: 'one', version: 1, status: 'draft' })
  }, 201)
})

test('server validation errors retain their real status, code and safe field message', async () => {
  await withResponse('{"code":"CON_VALIDATION_ERROR","message":"合同开始日期不能晚于结束日期","request_id":"request-1"}', 'application/json', async () => {
    await assert.rejects(api.createContract({}), (error) => {
      assert.equal(error.status, 422)
      assert.equal(error.code, 'CON_VALIDATION_ERROR')
      assert.equal(error.requestID, 'request-1')
      assert.match(error.message, /开始日期/)
      return true
    })
  }, 422)
})

test('a successful envelope with a wrong collection shape cannot masquerade as an empty list', async () => {
  await withResponse('{"code":"OK","data":{"unexpected":"collection"}}', 'application/json', async () => {
    for (const call of [api.listContracts, api.listSigningRecords, api.listContractTemplates, api.listApprovalTasks, api.listApprovals, api.listApprovalRules]) {
      await assert.rejects(call(), (error) => error.code === 'INVALID_CONTRACT_RESPONSE')
    }
  })
})

const mutationCases = [
  { name: 'createContract', call: () => api.createContract({ title: '测试' }), valid: { id: 'contract-1', version: 1, status: 'draft' } },
  { name: 'createExternalContract', call: () => api.createExternalContract(new Blob(['docx']), { title: '测试' }), valid: { id: 'contract-1', version: 1, status: 'draft' } },
  { name: 'createApprovalRule', call: () => api.createApprovalRule({ name: '测试' }), valid: { id: 'rule-1', version: 1 } },
  { name: 'updateApprovalRule', call: () => api.updateApprovalRule('rule-1', { version: 3 }), valid: { id: 'rule-1', version: 4 } },
  { name: 'submitContract', call: () => api.submitContract('contract-1'), valid: { approval_id: 'approval-1', workflow_id: 'workflow-1', run_id: 'run-1' } },
  { name: 'commandApproval', call: () => api.commandApproval('approval-1', 'approve'), valid: { status: 'accepted', command_id: 'command-1' } },
  { name: 'updateContractDraft', call: () => api.updateContractDraft('contract-1', { expected_version: 3 }), valid: { id: 'contract-1', version: 4, status: 'draft' } },
]

async function assertInvalidResource(call, data, status = 201) {
  await withResponse(JSON.stringify({ code: 'OK', data, request_id: 'resource-request', trace_id: 'resource-trace' }), 'application/json', async () => {
    await assert.rejects(call(), (error) => {
      assert.equal(error.code, 'INVALID_CONTRACT_RESPONSE')
      assert.equal(error.status, status)
      assert.equal(error.requestID, 'resource-request')
      assert.equal(error.testRequestContext.traceId, 'resource-trace')
      assert.equal(error.outcomeUnknown, true)
      assert.match(error.message, /核对是否已保存/)
      return true
    })
  }, status)
}

test('resource writes reject all 18 formerly accepted empty results and draft updates fail closed too', async (t) => {
  for (const item of mutationCases) {
    for (const data of [{}, [], null]) {
      await t.test(`${item.name} data=${JSON.stringify(data)}`, () => assertInvalidResource(item.call, data))
    }
  }
})

test('resource writes accept their real backend shapes and never forward validateData to fetch', async (t) => {
  const original = globalThis.fetch
  try {
    for (const item of mutationCases) {
      await t.test(item.name, async () => {
        let captured
        globalThis.fetch = async (url, options) => {
          captured = options
          return new Response(JSON.stringify({ code: 'OK', data: item.valid }), { status: 201, headers: { 'Content-Type': 'application/json' } })
        }
        assert.deepEqual(await item.call(), item.valid)
        assert.equal(Object.hasOwn(captured, 'validateData'), false)
        assert.equal(captured.credentials, 'include')
      })
    }
  } finally { globalThis.fetch = original }
})

test('contract and rule resources require nonempty string IDs and positive safe integer versions', async (t) => {
  for (const item of mutationCases.filter((value) => ['createContract', 'createExternalContract', 'createApprovalRule'].includes(value.name))) {
    await t.test(item.name, async () => {
      for (const id of [undefined, null, '', '   ', 123]) await assertInvalidResource(item.call, { ...item.valid, id })
      for (const version of [undefined, null, 0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) await assertInvalidResource(item.call, { ...item.valid, version })
      if (item.valid.status) for (const status of [undefined, '', 'active']) await assertInvalidResource(item.call, { ...item.valid, status })
    })
  }
})

test('versioned updates reject wrong identity, missing versions, unsafe versions and unchanged revisions', async (t) => {
  for (const item of mutationCases.filter((value) => ['updateContractDraft', 'updateApprovalRule'].includes(value.name))) {
    await t.test(item.name, async () => {
      for (const id of [undefined, '', '   ', 'other-id']) await assertInvalidResource(item.call, { ...item.valid, id }, 200)
      for (const version of [undefined, 0, 2, 3, 3.5, '4', Number.MAX_SAFE_INTEGER + 1]) await assertInvalidResource(item.call, { ...item.valid, version }, 200)
    })
  }
  await assertInvalidResource(() => api.updateContractDraft('contract-1', { expected_version: 0 }), { id: 'contract-1', version: 4, status: 'draft' })
  await assertInvalidResource(() => api.updateApprovalRule('rule-1', { version: 0 }), { id: 'rule-1', version: 4 })
})

test('approval acceptance requires its persisted approval or command identity', async () => {
  for (const approval_id of [undefined, null, '', '   ', 123]) {
    await assertInvalidResource(() => api.submitContract('contract-1'), { approval_id }, 202)
  }
  for (const command_id of [undefined, null, '', '   ', 123]) {
    await assertInvalidResource(() => api.commandApproval('approval-1', 'approve'), { status: 'accepted', command_id }, 202)
  }
  for (const status of [undefined, '', 'completed']) {
    await assertInvalidResource(() => api.commandApproval('approval-1', 'approve'), { status, command_id: 'command-1' }, 202)
  }
})

test('resource validators preserve non-success status, real error code, request ID and field diagnostics', async () => {
  const response = { code: 'CON_VERSION_CONFLICT', message: '合同版本已变化', request_id: 'real-request', details: { fields: { expected_version: '请重新载入' } } }
  await withResponse(JSON.stringify(response), 'application/json', async () => {
    await assert.rejects(api.updateContractDraft('contract-1', { expected_version: 3 }), (error) => {
      assert.equal(error.status, 409)
      assert.equal(error.code, 'CON_VERSION_CONFLICT')
      assert.equal(error.requestID, 'real-request')
      assert.deepEqual(error.fieldErrors, response.details.fields)
      assert.equal(error.outcomeUnknown, undefined)
      return true
    })
  }, 409)
})
