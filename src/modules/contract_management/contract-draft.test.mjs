import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { canEditContractDraft, hydrateContractDraft, saveContractDraft } from './utils/contractDraft.js'

const raw = {
  id: 'draft-1', status: 'draft', version: 3, can_edit_draft: true,
  title: '销售合同', amount_minor: 12345, currency: 'CNY', owner_user_id: 'sales-1',
  crm_customer_id: 42, start_date: '2026-10-08T00:00:00Z', template_id: 'tpl-1',
  template_values: { 联系人: '测试人员' },
  service_items: [{ source_id: 'source-1', service_type: '软件测试', batch: '第二批次', systems: [{ name: '系统A', level: '三级' }] }],
}

test('draft editing requires an explicit server capability and draft status', () => {
  assert.equal(canEditContractDraft(raw), true)
  for (const denied of [{ ...raw, status: 'pending_approval' }, { ...raw, can_edit_draft: false }, { status: 'draft', owner_user_id: 'sales-1' }]) {
    assert.equal(canEditContractDraft(denied), false)
    assert.throws(() => hydrateContractDraft(denied), /不可编辑/)
  }
})

test('editing restores full values without aliasing the original or changing source identity', () => {
  const form = hydrateContractDraft(raw)
  assert.equal(form.amount, 123.45)
  assert.equal(form.customer_id, '42')
  assert.equal(form.start_date, '2026-10-08')
  assert.equal(form.service_items[0].source_id, 'source-1')
  assert.equal(form.service_items[0].batch, '第二批次')
  form.template_values.联系人 = '修改后'
  form.service_items[0].systems[0].name = '修改后'
  assert.equal(raw.template_values.联系人, '测试人员')
  assert.equal(raw.service_items[0].systems[0].name, '系统A')
  assert.equal(form.owner_user_id, undefined)
})

test('save-only updates the existing ID with expected version and never submits approval', async () => {
  const calls = []
  const result = await saveContractDraft({
    contractId: raw.id, version: raw.version, payload: { title: '修改后', expected_version: 999 }, submit: false,
    updateDraft: async (id, payload) => { calls.push([id, payload]); return { ...raw, version: 4 } },
    onSaved: (saved) => calls.push(['saved', saved.version]),
    submitApproval: async () => { assert.fail('save-only must not submit') },
  })
  assert.deepEqual(calls, [['draft-1', { title: '修改后', expected_version: 3 }], ['saved', 4]])
  assert.equal(result.approval, null)
})

test('save-and-submit submits exactly the saved revision, not the opened revision', async () => {
  const calls = []
  await saveContractDraft({
    contractId: raw.id, version: 3, payload: {}, submit: true,
    updateDraft: async () => ({ ...raw, version: 4 }), onSaved: (saved) => calls.push(['saved', saved.version]),
    submitApproval: async (id, payload) => { calls.push([id, payload]); return { approval_id: 'approval-1' } },
  })
  assert.deepEqual(calls, [['saved', 4], ['draft-1', { expected_version: 4 }]])
})

test('save conflict never submits and approval failure retains the saved version', async () => {
  const conflict = Object.assign(new Error('版本冲突'), { status: 409 })
  await assert.rejects(saveContractDraft({ contractId: raw.id, version: 3, payload: {}, submit: true,
    updateDraft: async () => { throw conflict }, onSaved: () => assert.fail('not saved'), submitApproval: () => assert.fail('must not submit'),
  }), /版本冲突/)
  let latestVersion = 3
  await assert.rejects(saveContractDraft({ contractId: raw.id, version: 3, payload: {}, submit: true,
    updateDraft: async () => ({ ...raw, version: 4 }), onSaved: (saved) => { latestVersion = saved.version },
    submitApproval: async () => { throw new Error('审批依赖失败') },
  }), /审批依赖失败/)
  assert.equal(latestVersion, 4)
})

test('invalid version or malformed save response cannot initiate approval', async () => {
  await assert.rejects(saveContractDraft({ contractId: raw.id, version: 0 }), /版本无效/)
  await assert.rejects(saveContractDraft({ contractId: raw.id, version: 3, payload: {}, submit: true,
    updateDraft: async () => ({ ...raw, version: 3 }), onSaved: () => assert.fail('invalid result'), submitApproval: () => assert.fail('invalid result'),
  }), /保存结果不完整/)
})

test('draft UI provides back-to-edit, version-aware save/submit, conflict reload and preserved source', async () => {
  const source = await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')
  assert.match(source, /v-if="selectedContract.canEditDraft"[\s\S]*返回上一步编辑/)
  assert.match(source, /getContract\(contract.recordId \|\| contract.id\)/)
  assert.match(source, /hydrateContractDraft\(raw\)/)
  assert.match(source, /:disabled="Boolean\(editingContract\)" required @change="selectContractTemplate"/)
  assert.match(source, /保存为草稿/)
  assert.match(source, /data-action="approval"/)
  assert.match(source, /重新载入草稿（放弃未保存修改）/)
  assert.match(source, /expected_version: submittedContract.version/)
})
