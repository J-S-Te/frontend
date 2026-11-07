import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { formatUserError } from '../../shared/utils/userError.js'
import { attachStructuredContext } from '../../platform/shared/api/requestContext.js'

// 合同 API 模块使用 Vite 的 import.meta.env 与浏览器导航，测试里剥掉 import 语句、
// 把环境对象替换成空对象，再用真实 request() 封装验证路径、请求体与响应解析。
const source = (await readFile(new URL('./contract.js', import.meta.url), 'utf8'))
  .replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
  .replaceAll('import.meta.env', '({})')
  .replace(/^export /gm, '')

function client() {
  return new Function('formatUserError', 'attachStructuredContext', 'subsystemAccessMessage',
    `${source}; return { getImportAutoApproveSetting, setImportAutoApproveSetting };\n//# sourceURL=contract-api-auto-approve-under-test.js`)(
    formatUserError,
    attachStructuredContext,
    (error, message) => message,
  )
}

const envelope = (data) => JSON.stringify({ code: 'OK', data })
const jsonResponse = (status, body) => new Response(
  typeof body === 'string' ? body : JSON.stringify(body),
  { status, headers: { 'content-type': 'application/json' } },
)

// withFetch 固定全局 fetch，收集每次请求的地址与方法，并在结束后恢复。
async function withFetch(respond, run) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: String(options.method || 'GET'), body: options.body, credentials: options.credentials })
    return respond(url, options)
  }
  try { return await run(calls) } finally { globalThis.fetch = original }
}

const SETTING = { capability_enabled: true, enabled: false, version: 3, updated_by: '合同超级管理员', updated_at: '2026-11-06T02:30:00Z' }

test('自动审批设置按合同导入路径读取并原样返回服务端字段', async () => {
  await withFetch(() => jsonResponse(200, envelope(SETTING)), async (calls) => {
    const data = await client().getImportAutoApproveSetting()
    assert.equal(calls.length, 1)
    assert.equal(calls[0].method, 'GET')
    assert.match(calls[0].url, /\/api\/v1\/contract-import\/auto-approve$/)
    assert.equal(calls[0].credentials, 'include')
    assert.deepEqual(data, SETTING)
  })
})

test('保存自动审批设置 PUT 同一路径并提交 enabled 与 expected_version', async () => {
  const saved = { ...SETTING, enabled: true, version: 4 }
  await withFetch(() => jsonResponse(200, envelope(saved)), async (calls) => {
    const data = await client().setImportAutoApproveSetting({ enabled: true, expectedVersion: 3 })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].method, 'PUT')
    assert.match(calls[0].url, /\/api\/v1\/contract-import\/auto-approve$/)
    assert.deepEqual(JSON.parse(calls[0].body), { enabled: true, expected_version: 3 })
    assert.deepEqual(data, saved)
  })
})

test('非法参数不会发出请求，避免拿本地未知版本覆盖服务端设置', async () => {
  await withFetch(() => jsonResponse(200, envelope(SETTING)), async (calls) => {
    const api = client()
    for (const payload of [undefined, {}, { enabled: true }, { enabled: true, expectedVersion: -1 }, { enabled: 'true', expectedVersion: 1 }]) {
      // 参数校验是同步抛出，包成 thunk 才能断言“没有发出请求”。
      assert.throws(() => api.setImportAutoApproveSetting(payload), /自动审批设置参数不合法/)
    }
    assert.equal(calls.length, 0)
  })
})

test('缺字段或版本非整数的自动审批响应按协议错误拒绝，不显示猜测状态', async () => {
  const invalid = [
    '{}',
    envelope({ enabled: true, version: 1, updated_by: '', updated_at: null }),
    envelope({ capability_enabled: true, version: 1, updated_by: '', updated_at: null }),
    envelope({ capability_enabled: 'true', enabled: true, version: 1, updated_by: '', updated_at: null }),
    envelope({ capability_enabled: true, enabled: true, version: '1', updated_by: '', updated_at: null }),
    envelope({ capability_enabled: true, enabled: true, version: 1, updated_at: null }),
    envelope({ capability_enabled: true, enabled: true, version: 1, updated_by: '', updated_at: 0 }),
    envelope(null),
  ]
  for (const body of invalid) {
    await withFetch(() => jsonResponse(200, body), async () => {
      await assert.rejects(client().getImportAutoApproveSetting(), (error) => error.code === 'INVALID_CONTRACT_RESPONSE')
    })
  }
})

test('版本冲突与能力未开启保留服务端错误码，供页面区分刷新与联系运维', async () => {
  const cases = [
    [409, 'IMPORT_REVISION_CONFLICT'],
    [422, 'IMPORT_AUTO_APPROVE_DISABLED'],
  ]
  for (const [status, code] of cases) {
    await withFetch(() => jsonResponse(status, { code, message: '服务端拒绝本次自动审批设置变更', request_id: 'req-auto-approve' }), async () => {
      await assert.rejects(client().setImportAutoApproveSetting({ enabled: true, expectedVersion: 5 }), (error) => {
        assert.equal(error.status, status)
        assert.equal(error.code, code)
        assert.equal(error.requestID, 'req-auto-approve')
        // 页面按 code 展示刷新或部署配置说明，所以错误码不能被中文文案吞掉。
        assert.match(error.message, /[\u4e00-\u9fff]/)
        assert.doesNotMatch(error.message, new RegExp(`HTTP ${status}`))
        return true
      })
    })
  }
})
