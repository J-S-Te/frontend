import test from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, reactive, nextTick } from 'vue'

const moduleURL = new URL('./commercialRecords.js', import.meta.url)

// 用途：挂载实际人工资料状态逻辑并隔离HTTP边界。
// 参数：api 为本用例接口行为，overrides 为商机与权限输入。
// 返回值：响应式输入、面板状态和清理方法。
async function fixture(api = {}, overrides = {}) {
  const { useCommercialRecords } = await import(moduleURL.href)
  const props = reactive({ opportunityId: '1', opportunityStatus: 'ACTIVE',
    permissions: ['opportunity.read', 'opportunity.update', 'opportunity.attachment.read'],
    attachments: [], ...overrides })
  const scope = effectScope()
  const state = scope.run(() => useCommercialRecords(props, () => {}, {
    listCommercialRecords: async () => ({ items: [], total: 0 }),
    createCommercialRecord: async () => ({ id: 'r1', version: 1 }),
    ...api,
  }))
  await nextTick()
  await new Promise(resolve => setImmediate(resolve))
  return { props, ...state, stop: () => scope.stop() }
}

test('登记校验逐字段阻断非法金额/日期/状态/附件且不发出写请求', async () => {
  let writes = 0
  const h = await fixture({ createCommercialRecord: async () => { writes++ } })
  try {
    h.openCreate('QUOTATION')
    await h.save()
    assert.match(h.formError.value, /主题/)
    Object.assign(h.form.value, { title: '报价', amount: '9999999999999999.999' })
    await h.save()
    assert.match(h.formError.value, /金额/)
    Object.assign(h.form.value, { amount: '', record_date: '2026-02-30' })
    await h.save()
    assert.match(h.formError.value, /业务日期/)
    Object.assign(h.form.value, { record_date: '2026-12-30', status: 'WON' })
    await h.save()
    assert.match(h.formError.value, /状态/)
    Object.assign(h.form.value, { status: 'DRAFT', attachment_ids: ['unknown'] })
    await h.save()
    assert.match(h.formError.value, /附件/)
    assert.equal(writes, 0)
  } finally { h.stop() }
})

test('纯资料登记保持金额精度，确认保存后读取失败仍提示成功且不重新创建', async () => {
  const calls = []
  let failRead = false
  const h = await fixture({
    listCommercialRecords: async () => { if (failRead) throw new Error('读取失败'); return { items: [], total: 0 } },
    createCommercialRecord: async (id, payload, key) => {
      calls.push({ id, payload, key }); failRead = true
      return { id: 'r1', ...payload, amount: '9999999999999999.01', version: 1 }
    },
  })
  try {
    h.openCreate('BID')
    Object.assign(h.form.value, { title: '投标', amount: '9999999999999999.01' })
    await h.save()
    assert.equal(calls.length, 1)
    assert.equal(calls[0].payload.amount, '9999999999999999.01')
    assert.deepEqual(calls[0].payload.attachment_ids, [])
    assert.equal(calls[0].payload.status, 'PREPARING')
    assert.ok(calls[0].key)
    assert.match(h.notice.value, /已保存/)
    assert.ok(h.readError.value)
    assert.equal(h.form.value, null)
    assert.equal(h.rows.value[0].id, 'r1')
    await h.save()
    assert.equal(calls.length, 1)
  } finally { h.stop() }
})

test('未知创建结果先核对，再复用原幂等键和原载荷，期间阻止重复点击', async () => {
  const calls = []
  let release
  const h = await fixture({ createCommercialRecord: (id, payload, key) => {
    calls.push({ id, payload, key })
    if (calls.length === 1) return new Promise((resolve, reject) => { release = reject })
    return Promise.resolve({ id: 'r1', ...payload, version: 1 })
  } })
  try {
    h.openCreate('QUOTATION'); h.form.value.title = '报价'
    const first = h.save()
    await h.save()
    assert.equal(calls.length, 1)
    release(Object.assign(new Error('网络中断'), { status: 0 }))
    await first
    await h.save()
    assert.equal(calls.length, 1, '未核对前不可重发')
    assert.equal(h.uncertain.value, true)
    h.closeForm()
    assert.ok(h.form.value, '未知结果不得丢弃原创建命令')
    await h.verifyUnknown()
    await h.save()
    assert.equal(calls.length, 2)
    assert.equal(calls[0].key, calls[1].key)
    assert.deepEqual(calls[0].payload, calls[1].payload)
    assert.equal(h.uncertain.value, false)
  } finally { h.stop() }
})

test('切换商机丢弃旧读取与旧保存响应，同时保留原商机未知创建命令', async () => {
  let releaseRead
  let releaseSave
  let listCount = 0
  const h = await fixture({
    listCommercialRecords: async (id) => {
      if (id === '1' && ++listCount > 1) return new Promise(resolve => { releaseRead = resolve })
      return { items: [{ id: `row-${id}` }], total: 1 }
    },
    createCommercialRecord: () => new Promise((resolve, reject) => { releaseSave = reject }),
  })
  try {
    const oldRead = h.load()
    h.openCreate('QUOTATION'); h.form.value.title = '旧商机'
    const oldSave = h.save()
    h.props.opportunityId = '2'; await nextTick()
    await new Promise(resolve => setImmediate(resolve))
    releaseRead({ items: [{ id: 'stale' }], total: 1 }); await oldRead
    releaseSave(Object.assign(new Error('断网'), { status: 0 })); await oldSave
    assert.deepEqual(h.rows.value.map(row => row.id), ['row-2'])
    assert.equal(h.form.value, null)
    assert.equal(h.notice.value, '')
    h.props.opportunityId = '1'; await nextTick()
    assert.equal(h.form.value.title, '旧商机')
    assert.equal(h.uncertain.value, true)
  } finally { h.stop() }
})

test('更正与作废携带原版本，已作废记录及无权限/已作废商机不能写入', async () => {
  const calls = []
  const row = { id: 'r1', type: 'QUOTATION', title: '原资料', status: 'DRAFT',
    record_date: '2026-11-16', version: 3, attachments: [] }
  const h = await fixture({
    updateCommercialRecord: async (...args) => { calls.push(args); return { ...row, version: 4 } },
    voidCommercialRecord: async (...args) => { calls.push(args); return { ...row, version: 5, is_void: true } },
  })
  try {
    h.openEdit(row); h.form.value.title = '更正资料'; await h.save()
    assert.equal(calls[0][2].version, 3)
    h.openVoid({ ...row, version: 4 }); await h.confirmVoid()
    assert.match(h.formError.value, /作废说明/)
    h.voidReason.value = '重复登记'; await h.confirmVoid()
    assert.deepEqual(calls[1], ['1', 'r1', { version: 4, reason: '重复登记' }])
    h.openEdit({ ...row, is_void: true }); assert.equal(h.form.value, null)
    h.props.permissions = ['opportunity.read']; await nextTick()
    h.openCreate('BID'); assert.equal(h.form.value, null)
    h.props.permissions = ['opportunity.read', 'opportunity.update']
    h.props.opportunityStatus = 'VOID'; await nextTick()
    h.openCreate('BID'); assert.equal(h.form.value, null)
    assert.equal(calls.length, 2)
  } finally { h.stop() }
})

test('只选择CLEAN附件，空主题默认文件名，缺读取权限时不关联', async () => {
  let writes = 0
  const h = await fixture({ createCommercialRecord: async () => { writes++ } }, { attachments: [
    { id: 'clean', file_name: '报价.pdf', scan_status: 'CLEAN' },
    { id: 'waiting', file_name: '等待.pdf', scan_status: 'PENDING', file_status: 'READY' },
  ] })
  try {
    h.openCreate('QUOTATION'); h.selectAttachment('clean', true)
    assert.equal(h.form.value.title, '报价.pdf')
    assert.deepEqual(h.form.value.attachment_ids, ['clean'])
    assert.deepEqual(h.availableAttachments.value.map(item => item.id), ['clean'])
    h.props.permissions = ['opportunity.read', 'opportunity.update']; await nextTick()
    assert.deepEqual(h.availableAttachments.value, [])
    assert.equal(h.form.value, null)
    assert.match(h.notice.value, /附件读取权限已变化/)
    await h.save(); assert.equal(writes, 0)
  } finally { h.stop() }
})

test('API使用既有会话与幂等头且正确编码不透明资料ID', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({ code: 'OK', data: { id: 'r1' } }),
      { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const api = await import('./api/commercialRecords.js')
  await api.listCommercialRecords('9', { page: 2, page_size: 20 })
  await api.createCommercialRecord('9', { title: '报价' }, 'same-key')
  await api.updateCommercialRecord('9', 'a/b', { version: 3 })
  await api.voidCommercialRecord('9', 'a/b', { version: 4, reason: '重复' })
  assert.match(calls[0].url, /\/opportunities\/9\/commercial-records\?page=2&page_size=20$/)
  assert.equal(calls[1].options.headers['Idempotency-Key'], 'same-key')
  assert.equal(calls[1].options.credentials, 'include')
  assert.equal(calls[1].options.headers['X-CSRF-Token'], '1')
  assert.equal(calls[2].options.method, 'PUT')
  assert.match(calls[2].url, /\/a%2Fb$/)
  assert.match(calls[3].url, /\/a%2Fb\/void$/)
  assert.deepEqual(JSON.parse(calls[3].options.body), { version: 4, reason: '重复' })
})

test('返回仍在保存的原商机后接收成功确认，不再重复创建已确认的资料', async () => {
  let finish
  const keys = []
  const h = await fixture({ createCommercialRecord: async (id, payload, key) => {
    keys.push(key)
    if (keys.length === 1) return new Promise(resolve => { finish = resolve })
    return { id: 'r1', version: 1 }
  } })
  try {
    h.openCreate('QUOTATION'); h.form.value.title = '报价'
    const write = h.save()
    h.props.opportunityId = '2'; await nextTick()
    h.props.opportunityId = '1'; await nextTick()
    finish({ id: 'r1', version: 1 }); await write
    assert.equal(h.submitting.value, false)
    assert.equal(h.uncertain.value, false)
    assert.match(h.notice.value, /已保存/)
    await h.verifyUnknown(); await h.save()
    assert.equal(keys.length, 1)
  } finally { h.stop() }
})

test('实际SFC面板挂载后登记投标调用契约接口并编译完整模板', async () => {
  const { mountSFC } = await import('../../test/helpers/mountSFC.mjs')
  const { readFileSync } = await import('node:fs')
  const { parse, compileTemplate } = await import('@vue/compiler-sfc')
  let payload
  const filename = new URL('./components/OpportunityCommercialRecordsPanel.vue', import.meta.url).pathname
  const apiPath = new URL('./api/commercialRecords.js', import.meta.url).pathname
  const h = await mountSFC(filename, { [apiPath]: {
    listCommercialRecords: async () => ({ items: [], total: 0 }),
    createCommercialRecord: async (id, body) => { payload = body; return { id: 'r1', version: 1 } },
  } }, { opportunityId: '1', permissions: ['opportunity.read', 'opportunity.update'] })
  try {
    h.state.openCreate('BID'); h.state.form.value.title = '实际组件录入'
    await h.state.save()
    assert.equal(payload.title, '实际组件录入')
    assert.equal(payload.type, 'BID')
    const { descriptor } = parse(readFileSync(filename, 'utf8'))
    const result = compileTemplate({ source: descriptor.template.content, filename, id: 'commercial-test' })
    assert.deepEqual(result.errors, [])
  } finally { h.unmount() }
})

test('创建明确失败可更正后重新登记，未知结果核对失败时不能重放', async () => {
  const calls = []
  let failRead = false
  const h = await fixture({
    listCommercialRecords: async () => {
      if (failRead) throw Object.assign(new Error('读取失败'), { status: 503 })
      return { items: [], total: 0 }
    },
    createCommercialRecord: async (id, payload, key) => {
      calls.push({ payload, key })
      if (calls.length === 1) throw Object.assign(new Error('主题无效'), { status: 400 })
      failRead = true
      throw Object.assign(new Error('断网'), { status: 0 })
    },
  })
  try {
    h.openCreate('QUOTATION'); h.form.value.title = '报价'; await h.save()
    assert.equal(h.uncertain.value, false)
    h.form.value.title = '更正主题'; await h.save()
    assert.notEqual(calls[0].key, calls[1].key)
    assert.equal(calls[1].payload.title, '更正主题')
    await h.verifyUnknown(); await h.save()
    assert.equal(calls.length, 2)
    assert.equal(h.verified.value, false)
    assert.ok(h.readError.value)
  } finally { h.stop() }
})

test('无商机读取权限时不取资料；翻页失败保留当前页，作废冲突保留更正入口', async () => {
  let reads = 0
  const h = await fixture({
    listCommercialRecords: async (id, query) => {
      reads++
      if (query.page === 2) throw Object.assign(new Error('读取失败'), { status: 503 })
      return { items: [{ id: 'r1' }], total: 21 }
    },
    voidCommercialRecord: async () => { throw Object.assign(new Error('资料版本已变化'), { status: 409 }) },
  }, { permissions: [] })
  try {
    assert.equal(reads, 0)
    h.props.permissions = ['opportunity.read', 'opportunity.update']; await nextTick()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(reads, 1)
    await h.load(2)
    assert.equal(h.page.value, 1)
    assert.deepEqual(h.rows.value.map(row => row.id), ['r1'])
    h.openVoid({ id: 'r1', version: 2 }); h.voidReason.value = '错误录入'
    await h.confirmVoid()
    assert.equal(h.voidTarget.value.id, 'r1')
    assert.ok(h.formError.value)
    assert.equal(h.submitting.value, false)
    assert.equal(h.notice.value, '')
  } finally { h.stop() }
})

test('关闭重开详情保留未知创建的原键与载荷，候选文件变化不阻断核对重放', async () => {
  const commandStore = reactive(new Map())
  const calls = []
  const api = { createCommercialRecord: async (id, payload, key) => {
    calls.push({ id, payload, key })
    if (calls.length === 1) throw Object.assign(new Error('回执丢失'), { status: 0 })
    return { id: 'saved', version: 1 }
  } }
  const options = { commandStore, commandScope: 'tenant-a/user-a' }
  const first = await fixture(api, { ...options,
    attachments: [{ id: 'file-a', file_name: '报价.pdf', scan_status: 'CLEAN' }] })
  first.openCreate('QUOTATION')
  first.selectAttachment('file-a', true)
  await first.save()
  assert.equal(first.uncertain.value, true)
  first.stop()
  const reopened = await fixture(api, options)
  try {
    assert.equal(reopened.uncertain.value, true)
    assert.equal(reopened.form.value.title, '报价.pdf')
    await reopened.verifyUnknown()
    await reopened.save()
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[1], calls[0])
    assert.equal(reopened.uncertain.value, false)
  } finally { reopened.stop() }
})

test('卸载期间仍在保存的命令由新实例接收确认，其他租户或用户看不到命令', async () => {
  const commandStore = reactive(new Map())
  let finish
  let writes = 0
  const api = { createCommercialRecord: () => {
    writes++
    return new Promise(resolve => { finish = resolve })
  } }
  const options = { commandStore, commandScope: 'tenant-a/user-a' }
  const first = await fixture(api, options)
  first.openCreate('BID'); first.form.value.title = '投标原命令'
  const write = first.save()
  first.stop()
  for (const scope of ['tenant-b/user-a', 'tenant-a/user-b']) {
    const foreign = await fixture(api, { commandStore, commandScope: scope })
    assert.equal(foreign.form.value, null)
    assert.equal(foreign.submitting.value, false)
    foreign.stop()
  }
  const reopened = await fixture(api, options)
  try {
    assert.equal(reopened.submitting.value, true)
    finish({ id: 'saved', version: 1 })
    await write; await nextTick()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(reopened.submitting.value, false)
    assert.equal(reopened.form.value, null)
    assert.match(reopened.notice.value, /已保存/)
    assert.equal(writes, 1)
  } finally { reopened.stop() }
})

test('文件读取权限撤销立即隐藏缓存与表单，在途旧读取不能恢复文件信息', async () => {
  const attachment = { id: 'file-a', opportunity_id: 1, file_name: '受控报价.pdf', scan_status: 'CLEAN' }
  const row = { id: 'r1', type: 'QUOTATION', title: '资料', record_date: '2026-11-16',
    status: 'DRAFT', version: 1, attachments: [attachment] }
  let reads = 0, release
  const h = await fixture({ listCommercialRecords: async () => {
    if (++reads === 2) return new Promise(resolve => { release = resolve })
    return { items: [row], total: 1 }
  } }, { attachments: [attachment] })
  try {
    h.openEdit(h.rows.value[0])
    const oldRead = h.load()
    h.props.permissions = ['opportunity.read', 'opportunity.update', 'opportunity.attachment.download']
    await nextTick()
    assert.equal(h.rows.value[0].attachments.length, 0)
    assert.equal(h.form.value?.attachments?.length || 0, 0)
    assert.equal(h.availableAttachments.value.length, 0)
    release({ items: [row], total: 1 }); await oldRead
    assert.equal(h.rows.value[0].attachments.length, 0)
    h.props.permissions.push('opportunity.attachment.read')
    await nextTick(); await new Promise(resolve => setImmediate(resolve))
    assert.equal(h.rows.value[0].attachments[0].id, attachment.id)
  } finally { h.stop() }
})

test('已关联但不在最近附件列表中的可信历史文件可保留或解除，文字更正正常保存', async () => {
  const attachment = { id: 'old-file', opportunity_id: 1, file_name: '历史报价.pdf', scan_status: 'CLEAN' }
  const row = { id: 'r1', type: 'QUOTATION', title: '历史报价', record_date: '2026-11-16',
    status: 'DRAFT', version: 1, attachments: [attachment] }
  const calls = []
  const h = await fixture({ updateCommercialRecord: async (id, recordID, payload) => {
    calls.push(payload); return { ...row, version: 2 }
  } })
  try {
    h.openEdit(row); h.form.value.title = '更正主题'
    assert.equal(h.availableAttachments.value[0]?.id, 'old-file')
    await h.save()
    assert.deepEqual(calls[0]?.attachment_ids, ['old-file'])
    h.openEdit({ ...row, version: 2 })
    h.selectAttachment('old-file', false)
    await h.save()
    assert.deepEqual(calls[1]?.attachment_ids, [])
  } finally { h.stop() }
})

test('实际面板下载同时要求文件读取、下载权限和服务端能力就绪', async () => {
  const { mountSFC } = await import('../../test/helpers/mountSFC.mjs')
  const filename = new URL('./components/OpportunityCommercialRecordsPanel.vue', import.meta.url).pathname
  const apiPath = new URL('./api/commercialRecords.js', import.meta.url).pathname
  const permissions = ['opportunity.read', 'opportunity.attachment.read', 'opportunity.attachment.download']
  for (const [available, rights, expected] of [
    [false, permissions, false], [true, permissions, true],
    [true, ['opportunity.read', 'opportunity.attachment.download'], false],
  ]) {
    const h = await mountSFC(filename, { [apiPath]: {
      listCommercialRecords: async () => ({ items: [], total: 0 }),
    } }, { opportunityId: 1, permissions: rights, downloadAvailable: available })
    try { assert.equal(h.state.canDownload.value, expected) }
    finally { h.unmount() }
  }
})

test('未知创建重放被当前权限拒绝仍保留原命令，恢复权限后不得换键新建', async () => {
  const calls = []
  const h = await fixture({ createCommercialRecord: async (id, payload, key) => {
    calls.push({ payload, key })
    if (calls.length === 1) throw Object.assign(new Error('原回执丢失'), { status: 0 })
    if (calls.length === 2) throw Object.assign(new Error('权限暂不可用'), { status: 403 })
    return { id: 'original-record', version: 1 }
  } })
  try {
    h.openCreate('QUOTATION'); h.form.value.title = '原报价'
    await h.save(); await h.verifyUnknown(); await h.save()
    assert.equal(h.uncertain.value, true)
    h.openCreate('BID')
    assert.equal(h.form.value.type, 'QUOTATION')
    await h.verifyUnknown(); await h.save()
    assert.equal(calls.length, 3)
    assert.deepEqual(calls, [calls[0], calls[0], calls[0]])
    assert.match(h.notice.value, /已保存/)
  } finally { h.stop() }
})
