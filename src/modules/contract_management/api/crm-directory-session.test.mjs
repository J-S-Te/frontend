import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse as parseSFC, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { parse } from '@babel/parser'
import { formatUserError } from '../../shared/utils/userError.js'
import { attachStructuredContext } from '../../platform/shared/api/requestContext.js'
import { normalizeAuthorizationSession, principalIdentityID, shouldStartSubsystemLogin, subsystemAccessMessage } from '../../shared/authz/sessionCompatibility.js'

const apiSource = await readFile(new URL('./contract.js', import.meta.url), 'utf8')
const viewSource = await readFile(new URL('../views/ContractManagementView.vue', import.meta.url), 'utf8')
const script = parseSFC(viewSource).descriptor.scriptSetup.content
const ast = parse(script, { sourceType: 'module' })
const callbacks = ['recordCRMDirectoryError', 'checkCRMDirectorySession', 'connectCRM', 'loadCustomerOptions', 'loadOpportunityOptions', 'refreshSelectedCRMAccess', 'submitNewContract']
const callbackSource = ast.program.body.filter(node => node.type === 'FunctionDeclaration' && callbacks.includes(node.id.name))
  .map(node => script.slice(node.start, node.end)).join('\n')

function client(env = {}) {
  const source = apiSource.replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
    .replaceAll('import.meta.env', `(${JSON.stringify(env)})`).replace(/^export /gm, '')
  return new Function('formatUserError', 'attachStructuredContext', 'normalizeAuthorizationSession', 'principalIdentityID', 'shouldStartSubsystemLogin', 'subsystemAccessMessage',
    `${source}; return { ensureContractCRMDirectorySession, openContractCRMLogin, listMyCustomers, listMyOpportunities, ContractAuthError };`)(
    formatUserError, attachStructuredContext, normalizeAuthorizationSession, principalIdentityID, shouldStartSubsystemLogin, subsystemAccessMessage)
}

const contractSession = { identity_id: 'identity-a', user_id: 'contract-local-a', tenant_id: 'tenant-a' }
const crmSession = { user_id: 'identity-a', tenant_id: 'tenant-a', person_id: 'person-a' }
const response = (status, data, code = 'OK') => new Response(JSON.stringify({ code, data, message: 'session missing', request_id: 'crm-request', trace_id: 'crm-trace' }), {
  status, headers: { 'Content-Type': 'application/json' },
})

async function browser(fetcher, run, open = () => null) {
  const originalFetch = globalThis.fetch, originalWindow = globalThis.window
  const calls = [], redirects = []
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return fetcher(url, options) }
  globalThis.window = { location: { origin: 'https://app.example', replace: url => redirects.push(url) }, open }
  try { await run({ calls, redirects }) }
  finally { globalThis.fetch = originalFetch; globalThis.window = originalWindow }
}

function view(api, overrides = {}) {
  const ref = value => ({ value })
  const state = {
    crmConnectionRequired: ref(false), crmForceLogin: ref(false), crmConnectionMessage: ref(''),
    newContract: ref({ title: '未保存合同', customer_id: '7', customer_name: '客户甲', opportunity_id: '', amount: '123.45', payment_terms: [], service_items: [{ name: '未保存服务' }] }),
    externalContractFile: ref(new Blob(['original docx'])), externalContractFileError: ref(''), externalContractFileInputKey: ref(0), isExternalContractMode: ref(true),
    selectedContractTemplate: ref({ id: 'template-a', fields: [] }), templatePreviewHTML: ref(''), createDialogOpen: ref(true),
    contractCreating: ref(false), draftEditConflict: ref(false), draftEditError: ref(''), editingContract: ref({ id: 'draft-a' }),
  }
  for (const kind of ['customer', 'opportunity']) {
    for (const [name, initial] of Object.entries({ Page: 0, Total: 0, HasMore: false, PickerOpen: true, Keyword: '甲', Error: '', Loading: false, Options: [] })) state[kind + name] = ref(initial)
  }
  const deps = { ...state, ...api, formatUserError, showToast: () => {}, nextTick: (fn) => fn?.(), draftErrorElement: { value: null }, syncManagedTemplateValues: () => {},
    buildNewContractPayload: form => ({ title: form.title, crm_customer_id: Number(form.customer_id || 0), payment_terms: form.payment_terms || [] }),
    validateExternalContract: () => {}, refreshSelectedCRMAccess: async () => {}, createExternalContract: async () => {},
    createContract: async () => {}, loadBusinessData: async () => {},
    saveContractResult: () => {}, pushOperationRecord: () => {},
    emptyNewContract: () => ({ title: '', customer_id: '', payment_terms: [], service_items: [] }),
    ...overrides }
  const handlers = new Function(...Object.keys(deps), `${callbackSource}; return { ${callbacks.join(',')} };`)(...Object.values(deps))
  return { ...state, ...deps, ...handlers }
}

test('CRM 401 has fixed Chinese guidance, explicit login marker and full diagnostics without navigation', async () => {
  for (const method of ['listMyCustomers', 'listMyOpportunities']) {
    await browser(async () => response(401, null, 'COMMON_UNAUTHENTICATED'), async ({ calls, redirects }) => {
      await assert.rejects(client()[method](), error => {
        assert.equal(error.status, 401)
        assert.equal(error.code, 'COMMON_UNAUTHENTICATED')
        assert.equal(error.crmLoginRequired, true)
        assert.equal(error.requestID, 'crm-request')
        assert.equal(error.context.traceId, 'crm-trace')
        assert.match(formatUserError(error), /连接 CRM.*新标签页.*重试搜索/)
        assert.doesNotMatch(error.message, /session missing/)
        return true
      })
      assert.equal(calls.length, 1)
      assert.equal(calls[0].options.credentials, 'include')
      assert.equal(calls[0].options.cache, 'no-store')
      assert.deepEqual(redirects, [])
    })
  }
})

test('fresh contract identity_id is compared with real CRM user_id, not contract local user_id or person_id', async () => {
  await browser(async url => response(200, url.startsWith('/contract_management/') ? contractSession : crmSession), async ({ calls, redirects }) => {
    await client().ensureContractCRMDirectorySession()
    assert.deepEqual(calls.map(call => call.url), ['/contract_management/api/v1/auth/me', '/customer-opportunity/api/v1/auth/me'])
    assert.ok(calls.every(call => call.options.cache === 'no-store' && call.options.credentials === 'include'))
    assert.deepEqual(redirects, [])
  })
})

test('different CRM account or tenant blocks directory reads and requests forced login', async () => {
  for (const session of [{ ...crmSession, user_id: 'identity-b' }, { ...crmSession, tenant_id: 'tenant-b' }]) {
    await browser(async url => response(200, url.startsWith('/contract_management/') ? contractSession : session), async ({ calls }) => {
      const ui = view(client())
      await ui.loadCustomerOptions()
      assert.equal(ui.crmConnectionRequired.value, true)
      assert.equal(ui.crmForceLogin.value, true)
      assert.match(ui.customerError.value, /账号或租户.*不一致/)
      assert.equal(calls.length, 2)
      assert.equal(ui.customerOptions.value.length, 0)
    })
  }
})

test('missing CRM identity, missing tenant, HTML and invalid envelopes fail closed', async () => {
  for (const makeResponse of [
    () => response(200, { identity_id: 'identity-a', tenant_id: 'tenant-a' }),
    () => response(200, { user_id: 'identity-a' }),
    () => new Response('<html>SPA fallback</html>', { headers: { 'Content-Type': 'text/html' } }),
    () => response(200, crmSession, 'ERROR'),
    () => new Response(JSON.stringify(crmSession), { headers: { 'Content-Type': 'application/json' } }),
  ]) {
    await browser(async url => url.startsWith('/contract_management/') ? response(200, contractSession) : makeResponse(), async () => {
      await assert.rejects(client().ensureContractCRMDirectorySession(), error => error.code === 'INVALID_DIRECTORY_RESPONSE')
    })
  }
})

test('contract 401 does not redirect or open CRM and unverified contract identity fails closed', async () => {
  await browser(async () => response(401, null, 'CONTRACT_UNAUTHENTICATED'), async ({ calls, redirects }) => {
    await assert.rejects(client().ensureContractCRMDirectorySession(), error => error.status === 401 && !error.crmLoginRequired)
    assert.equal(calls.length, 1)
    assert.deepEqual(redirects, [])
  })
  await browser(async url => response(200, url.startsWith('/contract_management/') ? { tenant_id: 'tenant-a' } : crmSession), async () => {
    await assert.rejects(client().ensureContractCRMDirectorySession(), error => error.code === 'CONTRACT_IDENTITY_UNVERIFIED')
  })
})

test('403 permission, 503 dependency and network errors remain distinct and never request login', async () => {
  for (const [status, code, text] of [[403, 'COMMON_FORBIDDEN', /权限/], [503, 'COMMON_DEPENDENCY_UNAVAILABLE', /服务|稍后/], [0, 'NETWORK_ERROR', /核对 CRM/]]) {
    await browser(async url => {
      if (url.startsWith('/contract_management/')) return response(200, contractSession)
      if (!status) throw new TypeError('Failed to fetch')
      return response(status, null, code)
    }, async ({ redirects }) => {
      await assert.rejects(client().ensureContractCRMDirectorySession(), error => {
        assert.equal(error.status || 0, status)
        assert.equal(error.code, code)
        assert.equal(error.crmLoginRequired, undefined)
        assert.match(error.message, text)
        return true
      })
      assert.deepEqual(redirects, [])
    })
  }
})

test('missing CRM session preserves form and file, click works without UI session, retry succeeds for both pickers', async () => {
  for (const kind of ['Customer', 'Opportunity']) {
    let connected = false, opens = 0
    const tab = { opener: 'original', location: { replace(path) { assert.equal(tab.opener, null); assert.equal(path, '/customer-opportunity/auth/login') } } }
    await browser(async url => {
      if (url.startsWith('/contract_management/')) return response(200, contractSession)
      if (!connected) return response(401, null, 'COMMON_UNAUTHENTICATED')
      return response(200, url.endsWith('/auth/me') ? crmSession : { items: [{ id: '7', customer_id: '7', name: '客户甲' }], total: 1, page: 1, page_size: 50 })
    }, async ({ calls, redirects }) => {
      const ui = view(client()), form = ui.newContract.value, file = ui.externalContractFile.value
      await ui[`load${kind}Options`]()
      assert.equal(ui.crmConnectionRequired.value, true)
      assert.equal(opens, 0)
      ui.connectCRM()
      assert.equal(opens, 1)
      assert.match(ui.crmConnectionMessage.value, /返回点击“搜索”/)
      assert.equal(calls.length, 2) // 点击后进入 SSO；不轮询，也不在后台重试目录查询。
      connected = true
      await ui[`load${kind}Options`]()
      assert.equal(ui.crmConnectionRequired.value, false)
      assert.equal(ui[kind.toLowerCase() + 'Options'].value.length, 1)
      assert.equal(ui.newContract.value, form)
      assert.equal(form.title, '未保存合同')
      assert.equal(form.amount, '123.45')
      assert.equal(ui.externalContractFile.value, file)
      assert.deepEqual(redirects, [])
    }, () => { opens++; return tab })
  }
})

test('popup blocked or throwing shows Chinese guidance and retains form', async () => {
  for (const open of [() => null, () => { throw new Error('blocked') }]) {
    await browser(async () => { throw new Error('unexpected fetch') }, async () => {
      const ui = view(client()), form = ui.newContract.value
      ui.connectCRM()
      assert.match(ui.crmConnectionMessage.value, /允许浏览器弹出窗口.*再次点击/)
      assert.equal(ui.newContract.value, form)
    }, open)
  }
})

test('login is same-origin, custom mounted prefix is supported and mismatch uses prompt=login', async () => {
  const paths = []
  const tab = { opener: null, location: { replace: path => paths.push(path) } }
  await browser(async () => { throw new Error('unexpected fetch') }, async () => {
    assert.equal(client().openContractCRMLogin({ force: true }), true)
    assert.equal(client({ VITE_CUSTOMER_API_BASE_URL: '/crm/api/v1' }).openContractCRMLogin(), true)
    assert.deepEqual(paths, ['/customer-opportunity/auth/login?prompt=login', '/crm/auth/login'])
    for (const base of ['https://external.example/api/v1', '//external.example/api/v1', '/crm/unknown', '/crm/api/v1?x=1', '/crm/api/v1#hash']) {
      assert.equal(client({ VITE_CUSTOMER_API_BASE_URL: base }).openContractCRMLogin(), false)
    }
    assert.equal(paths.length, 2)
  }, () => tab)
})

test('submit revalidates CRM identity, preserves draft and does not confuse mismatch with draft version conflict', async () => {
  await browser(async url => response(200, url.startsWith('/contract_management/') ? contractSession : { ...crmSession, user_id: 'other' }), async ({ calls }) => {
    const ui = view(client()), form = ui.newContract.value
    await ui.submitNewContract({ submitter: { value: 'save' } })
    assert.equal(ui.crmConnectionRequired.value, true)
    assert.equal(ui.draftEditConflict.value, false)
    assert.equal(ui.contractCreating.value, false)
    assert.equal(ui.newContract.value, form)
    assert.match(ui.draftEditError.value, /账号或租户.*不一致/)
    assert.ok(calls.every(call => call.url.endsWith('/auth/me')))
  })
})


test('external submission freezes form and file before CRM validation completes', async () => {
  let release, startedResolve
  const gate = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { startedResolve = resolve })
  await browser(async url => {
    if (url.startsWith('/contract_management/')) return response(200, contractSession)
    if (url.includes('/customers?')) {
      startedResolve()
      await gate
      return response(200, { items: [{ id: '7', customer_id: '7', name: '客户甲' }], total: 1, page: 1, page_size: 100 })
    }
    return response(200, crmSession)
  }, async () => {
    let created
    const ui = view(client(), {
      editingContract: { value: null },
      createExternalContract: async (file, payload) => { created = { file, payload } },
    })
    ui.newContract.value = { title: '合同 A', customer_id: '7', customer_name: '客户甲', opportunity_id: '', amount: '100', payment_terms: [], service_items: [] }
    const fileA = new Blob(['file-a'])
    ui.externalContractFile.value = fileA
    const pending = ui.submitNewContract({ submitter: { value: 'save' } })
    await started
    // CRM 校验等待期间用户改表单、换文件：请求必须保持提交瞬间的完整快照。
    ui.newContract.value.title = '合同 B'
    ui.newContract.value.customer_id = '8'
    ui.externalContractFile.value = new Blob(['file-b'])
    release()
    await pending

    assert.equal(ui.draftEditError.value, '')
    assert.equal(created.payload.title, '合同 A')
    assert.equal(created.payload.crm_customer_id, 7)
    assert.equal(created.file, fileA)
  })
})

test('connection buttons are real non-submit controls in the customer picker and form, with no session disable', () => {
  const result = compileTemplate({ source: parseSFC(viewSource).descriptor.template.content, filename: 'ContractManagementView.vue', id: 'crm-directory' })
  assert.deepEqual(result.errors, [])
  const buttons = viewSource.match(/<button[^>]*@click="connectCRM"[^>]*>连接 CRM<\/button>/g)
  // 商机关的关联已改为表单内下拉选择，不再有独立弹层；剩余两处是 CRM 客户弹层与表单内的连接入口。
  assert.equal(buttons.length, 2)
  for (const button of buttons) { assert.match(button, /type="button"/); assert.doesNotMatch(button, /disabled/) }
})

test('compiled opportunity import executes the real picker without an unbound API reference', async () => {
  const compiled = compileScript(parseSFC(viewSource).descriptor, { id: 'crm-directory-imports' })
  const binding = compiled.imports.listMyOpportunities
  assert.equal(binding.source, '@/modules/contract_management/api/contract')
  assert.equal(binding.imported, 'listMyOpportunities')
  assert.equal(binding.isFromSetup, true)
  await browser(async url => response(200, url.startsWith('/contract_management/') ? contractSession
    : url.endsWith('/auth/me') ? crmSession
      : { items: [{ id: 'opportunity-7', customer_id: '7', name: '商机甲' }], total: 1, page: 1, page_size: 50 }), async ({ calls }) => {
    const exports = client()
    const imports = Object.fromEntries(Object.entries(compiled.imports)
      .filter(([, item]) => item.source === binding.source && Object.hasOwn(exports, item.imported))
      .map(([local, item]) => [local, exports[item.imported]]))
    const ui = view(imports)
    await ui.loadOpportunityOptions()
    assert.equal(ui.opportunityError.value, '')
    assert.equal(ui.opportunityLoading.value, false)
    assert.equal(ui.opportunityOptions.value[0].id, 'opportunity-7')
    assert.equal(calls.length, 3)
    assert.match(calls[2].url, /^\/customer-opportunity\/api\/v1\/opportunities\?/)
  })
})
