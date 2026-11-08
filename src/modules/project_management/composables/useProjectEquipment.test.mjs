import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectScope, nextTick, ref } from 'vue'
import { useProjectEquipment } from './useProjectEquipment.js'

// 用途：创建设备组合式夹具：目录读取可控结算，维护动作记录调用。
// 参数：deferred 为 true 时目录请求由用例手动结算。
// 返回值：响应式上下文、调用记录与组合式返回值。
async function fixture({ deferred = false, listRejects = false, canManage = true } = {}) {
  const scope = effectScope()
  const context = ref('tenant-a|user-a|rev1')
  const saving = ref(false)
  const pending = []
  const calls = { list: 0, upsert: [], remove: [], returned: [], confirm: [], notify: [], reloadReservations: 0 }
  // 服务端权威目录：写操作改变它，后续强制重读必须反映服务端事实（不被本地乐观更新掩盖）。
  const serverRows = [{ resource_id: 'EQ-1', resource_name: '设备一' }]
  const state = scope.run(() => useProjectEquipment({
    context,
    saving,
    canManage: ref(canManage),
    askConfirm: async (options) => { calls.confirm.push(options); return true },
    notify: (message, type) => calls.notify.push({ message, type }),
    closeMulti: () => { calls.closed = (calls.closed || 0) + 1 },
    describeError: (cause, fallback) => String(cause?.message || fallback),
    codeOptions: () => [{ code: 'EQ-SCAN', name: 'EQ-SCAN · 扫描' }],
    canonicalCodes: (codes) => codes,
    validateCodes: () => true,
    formatDate: (value) => String(value || '').slice(0, 10),
    reservationFor: (resourceID) => resourceID === 'EQ-1' ? { service_item_id: 'SI-1' } : undefined,
    reloadReservations: async () => { calls.reloadReservations += 1 },
    listEquipment: () => {
      calls.list += 1
      if (!deferred) return listRejects ? Promise.reject(new Error('设备目录暂不可用')) : Promise.resolve(serverRows.map((row) => ({ ...row })))
      return new Promise((resolve, reject) => pending.push({ resolve, reject }))
    },
    upsertEquipment: async (payload) => {
      calls.upsert.push(payload)
      const saved = { ...payload, resource_id: payload.resource_id || 'EQ-9' }
      const index = serverRows.findIndex((row) => row.resource_id === saved.resource_id)
      if (index >= 0) serverRows[index] = saved
      else serverRows.unshift(saved)
      return saved
    },
    deleteEquipment: async (resourceID) => {
      calls.remove.push(resourceID)
      const index = serverRows.findIndex((row) => row.resource_id === resourceID)
      if (index >= 0) serverRows.splice(index, 1)
    },
    returnServiceItemEquipment: async (itemID, resourceID) => { calls.returned.push([itemID, resourceID]) },
  }))
  return { scope, context, saving, calls, pending, state }
}

test('设备目录不预读：进入区域（ensure）才读取，已确认后复用', async () => {
  const view = await fixture()
  try {
    await nextTick()
    assert.equal(view.calls.list, 0, '创建组合式不得预读设备目录')
    assert.equal(view.state.equipmentConfirmed.value, false)
    assert.equal(await view.state.ensureEquipmentCatalog(), true)
    assert.equal(view.calls.list, 1)
    assert.equal(view.state.equipment.value.length, 1)
    assert.equal(view.state.equipmentConfirmed.value, true)
    await view.state.ensureEquipmentCatalog()
    assert.equal(view.calls.list, 1, '已确认的目录按新鲜度复用，不重复请求')
  } finally { view.scope.stop() }
})

test('目录读取失败保留可重试错误，重试入口强制重读', async () => {
  const view = await fixture({ listRejects: true })
  try {
    assert.equal(await view.state.ensureEquipmentCatalog(), false)
    assert.match(view.state.equipmentError.value, /设备目录暂不可用/)
    assert.equal(view.state.equipmentConfirmed.value, false, '失败不得被当成已确认目录')
    assert.equal(view.state.equipment.value.length, 0)
    assert.equal(await view.state.retryEquipmentCatalog(), false)
    assert.equal(view.calls.list, 2, '失败后重试必须重新发起读取')
  } finally { view.scope.stop() }
})

test('维护成功后目录失效并重新确认；维护写成功但目录读取失败时提示已保存', async () => {
  const view = await fixture()
  try {
    await view.state.ensureEquipmentCatalog()
    view.state.equipmentForm.value = { resourceID: 'EQ-2', resourceName: '设备二', codes: ['EQ-SCAN'], originalCodes: [], validFrom: '', validUntil: '', status: 'ACTIVE', usageScope: 'ANY' }
    await view.state.saveEquipment()
    assert.equal(view.calls.upsert.length, 1)
    assert.match(view.state.equipment.value[0].resource_id, /EQ-2/)
    assert.equal(view.calls.list, 2, '维护成功后必须重新确认目录')
    assert.equal(view.saving.value, false)
    assert.equal(view.calls.notify.at(-1).message, '设备信息已保存')
  } finally { view.scope.stop() }
})

test('写成功但目录读取失败：提示「已保存，但读取失败」，不重发业务写入', async () => {
  let listCalls = 0
  const scope = effectScope()
  const calls = { notify: [], upsert: 0 }
  const state = scope.run(() => useProjectEquipment({
    context: ref('t|u|r1'),
    saving: ref(false),
    canManage: ref(true),
    askConfirm: async () => true,
    notify: (message, type) => calls.notify.push({ message, type }),
    closeMulti: () => {},
    describeError: (cause, fallback) => String(cause?.message || fallback),
    codeOptions: () => [],
    canonicalCodes: (codes) => codes,
    validateCodes: () => true,
    formatDate: () => '',
    reservationFor: () => undefined,
    reloadReservations: async () => {},
    listEquipment: () => { listCalls += 1; return listCalls === 1 ? Promise.resolve([]) : Promise.reject(new Error('读取超时')) },
    upsertEquipment: async () => { calls.upsert += 1; return { resource_id: 'EQ-3', resource_name: '设备三' } },
    deleteEquipment: async () => {},
    returnServiceItemEquipment: async () => {},
  }))
  try {
    await state.ensureEquipmentCatalog()
    state.equipmentForm.value = { resourceID: 'EQ-3', resourceName: '设备三', codes: [], originalCodes: [], validFrom: '', validUntil: '', status: 'ACTIVE', usageScope: 'ANY' }
    await state.saveEquipment()
    assert.equal(calls.upsert, 1, '写成功后不得重发业务写入')
    assert.ok(calls.notify.some((entry) => /已保存，但最新设备目录读取失败/.test(entry.message)))
    assert.match(state.equipmentError.value, /读取超时/)
    assert.equal(state.equipmentConfirmed.value, false)
  } finally { scope.stop() }
})

test('删除需二次确认；确认后删除并失效目录，取消则不改动', async () => {
  const view = await fixture()
  try {
    await view.state.ensureEquipmentCatalog()
    await view.state.removeEquipment({ resource_id: 'EQ-1', resource_name: '设备一' })
    assert.equal(view.calls.confirm.length, 1)
    assert.deepEqual(view.calls.remove, ['EQ-1'])
    assert.equal(view.state.equipment.value.length, 0)
    assert.equal(view.calls.list, 2, '删除成功后目录失效并重新确认')
  } finally { view.scope.stop() }
})

test('归还使用独立的占用信息定位服务项，并刷新占用与目录', async () => {
  const view = await fixture()
  try {
    await view.state.ensureEquipmentCatalog()
    await view.state.returnEquipment({ resource_id: 'EQ-1', resource_name: '设备一' })
    assert.deepEqual(view.calls.returned, [['SI-1', 'EQ-1']], '归还必须按占用记录定位服务项，不能用设备目录代替')
    assert.equal(view.calls.reloadReservations, 1)
    assert.ok(view.calls.notify.some((entry) => /已归还/.test(entry.message)))
  } finally { view.scope.stop() }
})

test('无维护权限时保存/删除/编辑都不写服务端', async () => {
  const view = await fixture({ canManage: false })
  try {
    await view.state.ensureEquipmentCatalog()
    await view.state.saveEquipment()
    await view.state.removeEquipment({ resource_id: 'EQ-1' })
    view.state.editEquipment({ resource_id: 'EQ-1', codes: [] })
    assert.equal(view.calls.upsert.length, 0)
    assert.deepEqual(view.calls.remove, [])
    assert.equal(view.calls.confirm.length, 0)
    assert.equal(view.state.equipmentForm.value.resourceID, '')
  } finally { view.scope.stop() }
})

test('换用户后旧目录响应不得回写，数据与确认状态都清空', async () => {
  const view = await fixture({ deferred: true })
  try {
    const read = view.state.ensureEquipmentCatalog()
    await nextTick()
    assert.equal(view.state.equipmentLoading.value, true)
    view.context.value = 'tenant-a|user-b|rev2'
    assert.equal(view.state.equipmentLoading.value, false)
    assert.equal(view.state.equipmentConfirmed.value, false)
    view.pending[0].resolve([{ resource_id: 'EQ-OLD' }])
    assert.equal(await read, false)
    assert.equal(view.state.equipment.value.length, 0, '旧身份的迟到响应不得发布')
    assert.equal(view.state.equipmentError.value, '')
  } finally { view.scope.stop() }
})
