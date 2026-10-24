import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createOrgUnit, createPosition } from './iam.js'
import {
  RELATED_DATA,
  loadRelatedDataSafely,
  publishRelatedDataChanged,
  relatedDataVersion,
  resetRelatedDataInvalidation,
  setRelatedDataSessionScope,
  subscribeRelatedDataChanges,
} from '../../shared/utils/relatedDataInvalidation.js'

// 端到端回归：复现原始问题“已经载入过非空目录，再创建组织 / 岗位后重新打开表单看不到新数据”。
// 这里用真实 API 封装（写入确认后发布失效）+ 真实的目录读取函数，只有服务端被替换成内存实现。

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  resetRelatedDataInvalidation()
})

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => '',
  }
}

test('创建组织后重新打开表单能看到新组织，不需要整页刷新', async () => {
  resetRelatedDataInvalidation()
  setRelatedDataSessionScope('tenant-1|user-1')

  const server = { organizations: [{ org_unit_id: 'org-1', name: '研发中心' }] }
  globalThis.fetch = async (url, options) => {
    if (options?.method === 'POST' && url === '/api/v1/org-units') {
      const created = { org_unit_id: `org-${server.organizations.length + 1}`, name: '销售中心' }
      server.organizations = [...server.organizations, created]
      return jsonResponse({ data: created })
    }
    return jsonResponse({ data: {} })
  }

  // 表单每次打开都重新读取；第一次读取后目录非空，这正是旧实现会永久复用的状态。
  const openForm = () => loadRelatedDataSafely('form:organizations', async () => [...server.organizations])
  const first = await openForm()
  assert.deepEqual(first.items.map((item) => item.org_unit_id), ['org-1'])

  let invalidations = 0
  subscribeRelatedDataChanges(() => { invalidations += 1 }, { kinds: [RELATED_DATA.ORGANIZATIONS] })
  await createOrgUnit({ name: '销售中心' })

  assert.equal(invalidations, 1, '写入确认成功后必须发布失效通知')
  assert.equal(relatedDataVersion(RELATED_DATA.ORGANIZATIONS), 1)

  const second = await openForm()
  assert.deepEqual(second.items.map((item) => item.org_unit_id), ['org-1', 'org-2'])
  assert.equal(second.error, null)
})

test('写入失败时不发布失效，也不会让下一次打开读到不存在的数据', async () => {
  resetRelatedDataInvalidation()
  setRelatedDataSessionScope('tenant-1|user-1')

  const server = { positions: [{ position_id: 'position-1', org_unit_id: 'org-1', name: '研发经理' }] }
  globalThis.fetch = async () => jsonResponse({ code: 'IAM_CONFLICT', message: '岗位名称已存在' }, { ok: false, status: 409 })

  let invalidations = 0
  subscribeRelatedDataChanges(() => { invalidations += 1 }, { kinds: [RELATED_DATA.POSITIONS] })
  await assert.rejects(() => createPosition({ orgUnitId: 'org-1', name: '研发经理' }))

  assert.equal(invalidations, 0)
  const opened = await loadRelatedDataSafely('form:positions', async () => [...server.positions])
  assert.deepEqual(opened.items.map((item) => item.position_id), ['position-1'])
})

test('写入成功但目录读取失败时保留写入结果、给出重试，并允许后续读取恢复', async () => {
  resetRelatedDataInvalidation()
  setRelatedDataSessionScope('tenant-2|user-9')

  let serverOrganizations = [{ org_unit_id: 'org-1', name: '研发中心' }]
  let failReads = true
  globalThis.fetch = async (url, options) => {
    if (options?.method === 'POST' && url === '/api/v1/org-units') {
      const created = { org_unit_id: 'org-2', name: '销售中心' }
      serverOrganizations = [...serverOrganizations, created]
      return jsonResponse({ data: created })
    }
    return jsonResponse({ data: {} })
  }
  const openForm = () => loadRelatedDataSafely('form:organizations', async () => {
    if (failReads) throw Object.assign(new Error('offline'), { status: 503 })
    return [...serverOrganizations]
  })

  const created = await createOrgUnit({ name: '销售中心' })
  assert.equal(created.org_unit_id, 'org-2', '写入本身已成功')

  const failedRead = await openForm()
  assert.equal(failedRead.items, null)
  assert.ok(failedRead.error, '读取失败必须显式报告，不能伪装成空目录')

  failReads = false
  const retried = await openForm()
  assert.deepEqual(retried.items.map((item) => item.org_unit_id), ['org-1', 'org-2'])
  assert.equal(retried.error, null)
})

test('会话切换后旧目录不会回填新会话', async () => {
  resetRelatedDataInvalidation()
  setRelatedDataSessionScope('tenant-1|user-1')

  let release = null
  const staleRead = loadRelatedDataSafely('form:organizations', () => new Promise((resolve) => { release = resolve }))
  await Promise.resolve()
  setRelatedDataSessionScope('tenant-2|user-9')
  release([{ org_unit_id: 'tenant-1-org' }])

  const stale = await staleRead
  assert.equal(stale.stale, true)
  assert.equal(stale.items, null)

  const fresh = await loadRelatedDataSafely('form:organizations', async () => [{ org_unit_id: 'tenant-2-org' }])
  assert.deepEqual(fresh.items.map((item) => item.org_unit_id), ['tenant-2-org'])
})

test('发布的通知里不包含员工、角色或凭据明细', async () => {
  resetRelatedDataInvalidation()
  setRelatedDataSessionScope('tenant-1|user-1')
  const events = []
  subscribeRelatedDataChanges((event) => events.push(event))
  publishRelatedDataChanged([RELATED_DATA.PEOPLE])

  assert.equal(events.length, 1)
  assert.deepEqual(Object.keys(events[0]).sort(), ['epoch', 'kinds', 'scope', 'type', 'versions'])
  assert.deepEqual(events[0].versions, { people: 1 })
  assert.equal(events[0].scope, 'tenant-1|user-1')
})
