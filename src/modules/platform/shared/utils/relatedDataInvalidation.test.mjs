import assert from 'node:assert/strict'
import test from 'node:test'
import {
  RELATED_DATA,
  loadRelatedDataOnce,
  loadRelatedDataSafely,
  publishRelatedDataChanged,
  relatedDataSessionEpoch,
  relatedDataSessionScope,
  relatedDataStamp,
  relatedDataVersion,
  resetRelatedDataInvalidation,
  setRelatedDataSessionScope,
  subscribeRelatedDataChanges,
} from './relatedDataInvalidation.js'

async function withReset(run) {
  resetRelatedDataInvalidation()
  try {
    await run()
  } finally {
    resetRelatedDataInvalidation()
  }
}

test('publish bumps only the announced kinds and keeps session scope out of the payload', async () => withReset(async () => {
  setRelatedDataSessionScope('tenant-1|user-1')
  const events = []
  const unsubscribe = subscribeRelatedDataChanges((event) => events.push(event))

  publishRelatedDataChanged([RELATED_DATA.ORGANIZATIONS, RELATED_DATA.POSITIONS])

  assert.equal(events.length, 1)
  assert.deepEqual([...events[0].kinds].sort(), ['organizations', 'positions'])
  assert.equal(events[0].scope, 'tenant-1|user-1')
  assert.equal(relatedDataVersion(RELATED_DATA.ORGANIZATIONS), 1)
  assert.equal(relatedDataVersion(RELATED_DATA.POSITIONS), 1)
  assert.equal(relatedDataVersion(RELATED_DATA.PEOPLE), 0)
  // 通知只携带资源类别与会话范围，不携带员工、角色或凭据明细。
  assert.deepEqual(Object.keys(events[0]).sort(), ['epoch', 'kinds', 'scope', 'type', 'versions'])
  unsubscribe()
}))

test('unknown kinds and duplicate kinds never create phantom invalidations', async () => withReset(async () => {
  publishRelatedDataChanged(['unknown-kind', RELATED_DATA.PEOPLE, RELATED_DATA.PEOPLE, ''])
  assert.equal(relatedDataVersion(RELATED_DATA.PEOPLE), 1)
  assert.equal(relatedDataVersion('unknown-kind'), 0)
  assert.equal(publishRelatedDataChanged([]), 0)
}))

test('subscription filters by kind and unsubscribe stops delivery', async () => withReset(async () => {
  const seen = []
  const unsubscribe = subscribeRelatedDataChanges((event) => seen.push(event.kinds), { kinds: [RELATED_DATA.POSITIONS] })

  publishRelatedDataChanged([RELATED_DATA.ORGANIZATIONS])
  publishRelatedDataChanged([RELATED_DATA.POSITIONS])
  unsubscribe()
  publishRelatedDataChanged([RELATED_DATA.POSITIONS])

  assert.deepEqual(seen, [['positions']])
}))

test('a listener that unsubscribes during delivery does not break later listeners', async () => withReset(async () => {
  const order = []
  const first = subscribeRelatedDataChanges(() => { order.push('first'); first() })
  subscribeRelatedDataChanges(() => order.push('second'))

  publishRelatedDataChanged([RELATED_DATA.PEOPLE])

  assert.deepEqual(order, ['first', 'second'])
}))

test('session scope change advances the epoch, clears versions and tells subscribers to drop caches', async () => withReset(async () => {
  setRelatedDataSessionScope('tenant-1|user-1')
  publishRelatedDataChanged([RELATED_DATA.PEOPLE])
  const previousEpoch = relatedDataSessionEpoch()
  const events = []
  subscribeRelatedDataChanges((event) => events.push(event))

  setRelatedDataSessionScope('tenant-2|user-9')

  assert.equal(relatedDataSessionScope(), 'tenant-2|user-9')
  assert.ok(relatedDataSessionEpoch() > previousEpoch)
  assert.equal(relatedDataVersion(RELATED_DATA.PEOPLE), 0)
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'session')
  assert.equal(events[0].scope, 'tenant-2|user-9')

  // 同一范围重复设置不产生假事件。
  setRelatedDataSessionScope('tenant-2|user-9')
  assert.equal(events.length, 1)
}))

test('relatedDataStamp changes only for the watched kinds', async () => withReset(async () => {
  const before = relatedDataStamp([RELATED_DATA.ORGANIZATIONS, RELATED_DATA.POSITIONS])
  publishRelatedDataChanged([RELATED_DATA.PEOPLE])
  assert.equal(relatedDataStamp([RELATED_DATA.ORGANIZATIONS, RELATED_DATA.POSITIONS]), before)
  publishRelatedDataChanged([RELATED_DATA.POSITIONS])
  assert.notEqual(relatedDataStamp([RELATED_DATA.ORGANIZATIONS, RELATED_DATA.POSITIONS]), before)
}))

test('loadRelatedDataOnce merges concurrent callers and allows a later reload', async () => withReset(async () => {
  let calls = 0
  let release = null
  const loader = () => {
    calls += 1
    return new Promise((resolve) => { release = resolve })
  }

  const first = loadRelatedDataOnce('organizations', loader)
  const second = loadRelatedDataOnce('organizations', loader)
  assert.equal(first, second)
  await Promise.resolve()
  assert.equal(calls, 1)
  release(['ok'])
  assert.deepEqual(await first, ['ok'])
  assert.deepEqual(await second, ['ok'])

  await loadRelatedDataOnce('organizations', async () => { calls += 1; return ['fresh'] })
  assert.equal(calls, 2)
}))

test('in-flight merges are isolated by session scope so a stale request cannot feed a new session', async () => withReset(async () => {
  setRelatedDataSessionScope('tenant-1|user-1')
  const pendingResolvers = []
  let calls = 0
  const loader = () => {
    calls += 1
    return new Promise((resolve) => { pendingResolvers.push(resolve) })
  }

  const stale = loadRelatedDataOnce('people', loader)
  // 同一会话内的第二次调用必须被合并：在 loader 真正执行前就返回同一个 Promise。
  assert.equal(loadRelatedDataOnce('people', loader), stale)
  setRelatedDataSessionScope('tenant-2|user-9')
  const fresh = loadRelatedDataOnce('people', loader)
  assert.notEqual(stale, fresh)

  await Promise.resolve()
  assert.equal(calls, 2)

  pendingResolvers.forEach((resolve) => resolve([]))
  await Promise.all([stale, fresh])
}))

test('a failed load is not cached, so retrying after an error really refetches', async () => withReset(async () => {
  let calls = 0
  await assert.rejects(() => loadRelatedDataOnce('positions', async () => { calls += 1; throw new Error('offline') }))
  const value = await loadRelatedDataOnce('positions', async () => { calls += 1; return ['recovered'] })
  assert.deepEqual(value, ['recovered'])
  assert.equal(calls, 2)
}))

test('resetRelatedDataInvalidation clears versions, in-flight merges and subscribers', async () => withReset(async () => {
  publishRelatedDataChanged([RELATED_DATA.APPLICATIONS])
  const events = []
  subscribeRelatedDataChanges((event) => events.push(event))
  await loadRelatedDataOnce('applications', async () => ['cached'])

  resetRelatedDataInvalidation()

  assert.equal(relatedDataVersion(RELATED_DATA.APPLICATIONS), 0)
  publishRelatedDataChanged([RELATED_DATA.APPLICATIONS])
  assert.equal(events.length, 0)
  let calls = 0
  await loadRelatedDataOnce('applications', async () => { calls += 1; return [] })
  assert.equal(calls, 1)
}))

test('loadRelatedDataSafely reports success once and then really refetches on the next open', async () => withReset(async () => {
  let calls = 0
  const loader = async () => {
    calls += 1
    return [{ org_unit_id: `org-${calls}` }]
  }

  const first = await loadRelatedDataSafely('organizations', loader)
  assert.equal(first.error, null)
  assert.equal(first.stale, false)
  assert.deepEqual(first.items, [{ org_unit_id: 'org-1' }])

  // 复现原问题：第一次载入过非空目录后再次打开表单，必须重新读取而不是复用旧快照。
  const second = await loadRelatedDataSafely('organizations', loader)
  assert.equal(calls, 2)
  assert.deepEqual(second.items, [{ org_unit_id: 'org-2' }])
}))

test('loadRelatedDataSafely surfaces read failures and allows a retry instead of faking an empty catalog', async () => withReset(async () => {
  let calls = 0
  const loader = async () => {
    calls += 1
    if (calls === 1) throw new Error('offline')
    return ['recovered']
  }

  const failed = await loadRelatedDataSafely('positions', loader)
  assert.equal(failed.items, null)
  assert.equal(failed.stale, false)
  assert.match(String(failed.error?.message), /offline/)

  const retried = await loadRelatedDataSafely('positions', loader)
  assert.deepEqual(retried.items, ['recovered'])
  assert.equal(retried.error, null)
}))

test('loadRelatedDataSafely marks a response from the previous session as stale and never returns it', async () => withReset(async () => {
  setRelatedDataSessionScope('tenant-1|user-1')
  let release = null
  const pending = loadRelatedDataSafely('people', () => new Promise((resolve) => { release = resolve }))
  // 让 loader 真正开始执行，确保请求是在旧会话下发起的。
  await Promise.resolve()

  setRelatedDataSessionScope('tenant-2|user-9')
  release([{ user_id: 'old-session-user' }])

  const result = await pending
  assert.equal(result.stale, true)
  assert.equal(result.items, null)
  assert.equal(result.error, null)
}))

// P2 回归：写入成功后的刷新不得复用"写入前就已经在途"的读取结果。
// 旧实现只按 (会话, 键) 合并，因此在途的旧请求会被后来的刷新直接复用，
// 旧目录又被当成最新目录写回页面。
test('published invalidation does not reuse a pre-write in-flight read', async () => withReset(async () => {
  let calls = 0
  const resolvers = []
  const loader = () => {
    calls += 1
    return new Promise((resolve) => { resolvers.push(resolve) })
  }

  const beforeWrite = loadRelatedDataOnce('organizations', loader, { kinds: [RELATED_DATA.ORGANIZATIONS] })
  // 写入确认成功：发布失效
  publishRelatedDataChanged([RELATED_DATA.ORGANIZATIONS])
  const afterWrite = loadRelatedDataOnce('organizations', loader, { kinds: [RELATED_DATA.ORGANIZATIONS] })

  assert.notEqual(afterWrite, beforeWrite, '写入后的刷新必须发起新读取')
  await Promise.resolve()
  assert.equal(calls, 2)

  resolvers.forEach((resolve, index) => resolve([{ org_unit_id: `org-${index}` }]))
  await Promise.all([beforeWrite, afterWrite])
}))

test('a response started before a published write is reported stale and never applied', async () => withReset(async () => {
  setRelatedDataSessionScope('tenant-1|user-1')
  let release = null
  const pending = loadRelatedDataSafely('organizations', () => new Promise((resolve) => { release = resolve }), { kinds: [RELATED_DATA.ORGANIZATIONS] })
  await Promise.resolve()

  publishRelatedDataChanged([RELATED_DATA.ORGANIZATIONS])
  release([{ org_unit_id: 'pre-write-org' }])

  const result = await pending
  assert.equal(result.stale, true)
  assert.equal(result.items, null)
}))

test('unrelated invalidations do not discard an in-flight read of other kinds', async () => withReset(async () => {
  let release = null
  const pending = loadRelatedDataSafely('positions', () => new Promise((resolve) => { release = resolve }), { kinds: [RELATED_DATA.POSITIONS] })
  await Promise.resolve()

  publishRelatedDataChanged([RELATED_DATA.PEOPLE])
  release([{ position_id: 'position-1' }])

  const result = await pending
  assert.equal(result.stale, false)
  assert.deepEqual(result.items, [{ position_id: 'position-1' }])
}))

test('without kinds the merge key stays session-scoped as before', async () => withReset(async () => {
  let calls = 0
  const loader = async () => { calls += 1; return [] }
  const first = loadRelatedDataOnce('plain', loader)
  const second = loadRelatedDataOnce('plain', loader)
  assert.equal(first, second)
  await first
  publishRelatedDataChanged([RELATED_DATA.ORGANIZATIONS])
  await loadRelatedDataOnce('plain', loader)
  assert.equal(calls, 2)
}))
