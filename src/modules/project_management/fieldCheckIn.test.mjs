import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { processFieldQueue } from './offlineFieldQueue.js'
import { formatUserError } from '../shared/utils/userError.js'

const source = await readFile(new URL('./views/ProjectManagementView.vue', import.meta.url), 'utf8')

// 用途：装载真实页面函数，以请求和存储边界替身验证可见结果。
// 参数：name 为页面函数名，dependencies 为其外部依赖。
// 返回值：可执行的真实函数；函数不存在时立即失败。
function pageFunction(name, dependencies) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'))
  assert.ok(start >= 0, `页面应提供 ${name}`)
  const rest = source.slice(start)
  const end = rest.slice(1).search(/^(?:async )?function \w+\(/m)
  const body = end < 0 ? rest.split('</script>')[0] : rest.slice(0, end + 1)
  return new Function(...Object.keys(dependencies), `let fieldLocationController = null; ${body}; return ${name}`)(...Object.values(dependencies))
}

// 用途：真实执行离线队列处理，隔离 IndexedDB 和远端签到请求。
// 参数：online 为联网状态，submit 为远端请求边界，existing 为本地已有作业。
// 返回值：页面持久化入口、队列和通知记录。
function persistenceFixture({ online = true, submit = async () => {}, existing = [], afterFlush = () => {} } = {}) {
  const operations = new Map(existing.map(row => [row.id, { ...row }]))
  const notices = []
  let flushes = 0
  const dependencies = {
    navigator: { onLine: online }, fieldQueueOwner: () => 'tenant-1:user-1',
    fieldSyncing: { value: false }, processFieldQueue, submitStoredFieldOperation: submit,
    refreshAfterWrite: async () => {},
    saveFieldOperation: async operation => operations.set(operation.id, { ...operation }),
    removeFieldOperation: async id => operations.delete(id),
    removeRejectedFieldOperation: async id => {
      const current = operations.get(id)
      if (!current || current.resultUncertain || current.lastErrorStatus !== 422) return false
      return operations.delete(id)
    },
    listFieldOperations: async () => [...operations.values()],
    refreshFieldQueueCount: async () => {},
    showToast: (message, type) => notices.push({ message, type }), formatUserError,
  }
  const flush = pageFunction('flushFieldOperations', dependencies)
  dependencies.flushFieldOperations = async () => {
    flushes++
    const result = await flush()
    afterFlush(operations)
    return result
  }
  return { persist: pageFunction('persistAndSyncFieldOperation', dependencies), operations, notices, flushes: () => flushes }
}

const operation = { id: 'checkin-test-1', kind: 'check-in', itemID: 'SI-1', capturedAt: '2026-11-18T08:00:00Z', payload: { latitude: 30.2741, longitude: 120.1551, accuracy_meters: 18, deviation_reason: '' } }

test('只有本次签到被服务端确认并移出队列才返回成功', async () => {
  const f = persistenceFixture()
  assert.deepEqual(await f.persist(operation), { status: 'synced' })
  assert.equal(f.operations.size, 0)
})

test('其他作业同步成功不能冒充本次签到成功，保留同一编号等待重试', async () => {
  const f = persistenceFixture({ existing: [{ id: 'other', kind: 'record' }],
    submit: async current => { if (current.id === operation.id) throw new Error('网络暂时不可用') } })
  const result = await f.persist(operation)
  assert.equal(result.status, 'pending')
  assert.match(result.message, /网络|同步/)
  assert.equal(f.operations.size, 1)
  assert.equal(f.operations.get(operation.id).id, 'checkin-test-1')
})

test('离线落盘只返回待同步，禁止宣称签到成功', async () => {
  const f = persistenceFixture({ online: false })
  const result = await f.persist(operation)
  assert.equal(result.status, 'pending')
  assert.equal(f.flushes(), 0)
  assert.equal(f.operations.size, 1)
})

test('另一个标签页删除明确拒绝项不能被当成本次签到成功', async () => {
  const f = persistenceFixture({ submit: async () => { throw Object.assign(new Error('请填写偏离原因'), { status: 422 }) },
    afterFlush: operations => operations.delete(operation.id) })
  await assert.rejects(f.persist(operation), /偏离原因|确认|核对/)
})

test('明确的签到参数拒绝回传原因并释放失败项，用户可补填后重新采集', async () => {
  const f = persistenceFixture({ submit: async () => { throw Object.assign(new Error('签到位置超出阈值；请填写偏离原因后再提交'), { status: 422 }) } })
  await assert.rejects(f.persist(operation), error => error.status === 422 && /偏离原因/.test(error.message))
  assert.equal(f.operations.size, 0, '已明确拒绝且未形成事件的输入不应永久阻塞完成')
})

test('先前结果未知的签到即使后来被拒绝，也保留原记录等待核对', async () => {
  const f = persistenceFixture({ submit: async () => { throw Object.assign(new Error('请先核对原签到结果'), { status: 422 }) } })
  const result = await f.persist({ ...operation, resultUncertain: true })
  assert.equal(result.status, 'pending')
  assert.equal(f.operations.get(operation.id).resultUncertain, true)
})

test('只有明确的签到业务回执才能显示服务端已确认', async () => {
  const state = { value: null }
  const dependencies = { fieldQueueOwner: () => 'tenant-1:user-1', fieldCheckInState: state,
    checkInField: async () => ({ status: 'UNKNOWN' }) }
  const submit = pageFunction('submitStoredFieldOperation', dependencies)
  await assert.rejects(submit({ ...operation, ownerKey: 'tenant-1:user-1' }), /确认|回执/)
  assert.equal(state.value, null)
})

// 用途：在真实签到编排函数外隔离设备定位与持久化请求。
// 参数：position 为设备采集结果，pending 为已有离线签到，persist 为存储同步边界。
// 返回值：页面状态、调用记录、签到入口和可变上下文。
function checkInFixture({ position = { coords: { latitude: 30.2741, longitude: 120.1551, accuracy: 18 }, timestamp: 1_800_000_000_000 }, pending = [], persist = async () => ({ status: 'synced' }) } = {}) {
  const item = { id: 'SI-1', version: 7, status: '实施中' }
  const form = { checkInDeviationReason: '客户临时安排在备用机房' }
  const state = {
    selectedServiceItem: { value: item }, activeSection: { value: 'implementation' },
    canExecuteField: { value: true }, fieldCheckInState: { value: null },
  }
  let ownerKey = 'tenant-1:user-1', locationCalls = 0
  const saved = [], removed = []
  const dependencies = { ...state, AbortController, formatUserError,
    fieldQueueOwner: () => ownerKey,
    listFieldOperations: async () => pending,
    removeFieldOperation: async id => removed.push(id), refreshFieldQueueCount: async () => {},
    currentPosition: async () => { locationCalls++; return typeof position === 'function' ? position() : position },
    newFieldOperationID: () => 'checkin-new-1',
    persistAndSyncFieldOperation: async current => { saved.push(current); return persist(current) },
  }
  const run = pageFunction('runFieldCheckIn', dependencies)
  return { ...state, item, form, saved, removed, run: () => run(item, form),
    setOwner: value => { ownerKey = value }, locationCalls: () => locationCalls }
}

test('签到使用设备真实坐标与采集时间，确认成功后才清空偏离说明', async () => {
  const f = checkInFixture()
  await f.run()
  assert.equal(f.saved.length, 1)
  assert.equal(f.saved[0].capturedAt, '2027-01-15T08:00:00.000Z')
  assert.equal(f.saved[0].payload.accuracy_meters, 18)
  assert.equal(f.saved[0].payload.deviation_reason, '客户临时安排在备用机房')
  assert.equal(f.fieldCheckInState.value.phase, 'confirmed')
  assert.equal(f.form.checkInDeviationReason, '')
})

test('服务端确认后的正常版本刷新不应抹掉成功状态或遗留表单', async () => {
  let f
  f = checkInFixture({ persist: async () => { f.selectedServiceItem.value = { ...f.item, version: 8 }; return { status: 'synced' } } })
  await f.run()
  assert.equal(f.fieldCheckInState.value.phase, 'confirmed')
  assert.equal(f.form.checkInDeviationReason, '')
})

test('签到尚未同步时保留说明，重试复用原编号与原始定位而不重新打卡', async () => {
  const f = checkInFixture({ pending: [{ ...operation, ownerKey: 'tenant-1:user-1', lastError: '同步失败' }], persist: async () => ({ status: 'pending', message: '同步失败' }) })
  await f.run()
  assert.equal(f.locationCalls(), 0)
  assert.equal(f.saved[0].id, 'checkin-test-1')
  assert.equal(f.saved[0].capturedAt, '2026-11-18T08:00:00Z')
  assert.equal(f.saved[0].payload.deviation_reason, '')
  assert.equal(f.fieldCheckInState.value.phase, 'pending')
  assert.equal(f.form.checkInDeviationReason, '客户临时安排在备用机房')
})

test('定位等待期间切换账号或服务项不能把旧位置写到新上下文', async () => {
  let finish
  const position = new Promise(resolve => { finish = resolve })
  const f = checkInFixture({ position: () => position })
  const pending = f.run()
  await Promise.resolve()
  await Promise.resolve()
  f.selectedServiceItem.value = { id: 'SI-2', version: 9, status: '实施中' }
  f.setOwner('tenant-2:user-2')
  finish({ coords: { latitude: 30.2741, longitude: 120.1551, accuracy: 10 }, timestamp: 1_800_000_000_000 })
  await assert.rejects(pending, /变化|切换|取消/)
  assert.equal(f.saved.length, 0)
  assert.notEqual(f.fieldCheckInState.value?.phase, 'locating')
})

test('服务端拒绝后保留输入与具体原因，不显示已签到', async () => {
  const f = checkInFixture({ persist: async () => { throw Object.assign(new Error('请填写偏离原因后再提交'), { status: 422 }) } })
  await assert.rejects(f.run(), /偏离原因/)
  assert.equal(f.fieldCheckInState.value.phase, 'error')
  assert.match(f.fieldCheckInState.value.message, /偏离原因/)
  assert.equal(f.form.checkInDeviationReason, '客户临时安排在备用机房')
})

test('本地队列读取失败保留待同步数量并明确阻断完成判定', async () => {
  const dependencies = { fieldQueueOwner: () => 'tenant:user', formatUserError,
    pendingFieldOperations: { value: [operation] }, pendingFieldSyncCount: { value: 1 }, fieldQueueError: { value: '' },
    listFieldOperations: async () => { throw new Error('本机存储不可用，请允许浏览器存储后重试') } }
  await pageFunction('refreshFieldQueueCount', dependencies)()
  assert.equal(dependencies.pendingFieldSyncCount.value, 1)
  assert.equal(dependencies.pendingFieldOperations.value.length, 1)
  assert.match(dependencies.fieldQueueError.value, /存储|队列/)
})
