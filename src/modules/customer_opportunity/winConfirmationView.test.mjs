import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { ref } from 'vue'
import { createWinEvidenceForm, winConfirmationPayload } from './winConfirmation.js'

const source = await readFile(new URL('./views/CustomerOpportunityView.vue', import.meta.url), 'utf8')

// 用途：运行真实主View提交函数，核验模式选择后的实际API载荷。
// 参数：mode为当前能力模式，subscribed控制转合同订阅。
// 返回值：函数、观察到的写请求和错误，不连接业务服务。
function harness(mode, subscribed = false) {
  const calls = [], errors = []
  const context = {
    selectedOpportunity: ref({ id: 7, version: 2, terminal_pending_type: 'WIN_EVIDENCE' }),
    stageForm: { target_stage: '已签约', reason: '受控验收', contract_ref: '旧表单残留',
      win_evidence: { ...createWinEvidenceForm(), evidence_reference: 'PO-001',
        confirmed_amount: '100.00', evidence_note: '合成采购依据' } },
    terminalForm: { reason: '受控补全', contract_ref: '', win_evidence: {} },
    winConfirmationMode: ref(mode), contractTransferAvailable: ref(subscribed),
    winConfirmationPayload, stageDialog: ref(true), terminalDialog: ref(true), notice: ref(''),
    changeOpportunityStage: async (id, payload) => { calls.push({ id, payload }); return { id, version: 3 } },
    completeOpportunityTerminalTodo: async (id, payload) => { calls.push({ id, payload }); return { id, version: 3 } },
    openOpportunity: async () => {}, loadCurrent: async () => {}, showError: (error) => errors.push(error),
    canTransferOpportunity: ref(true), contractTransferLoading: ref(false),
    askReason: () => calls.push({ askReason: true }),
  }
  const functions = ['submitStage', 'submitTerminal', 'submitContractTransfer'].map((name) => {
    const start = source.search(new RegExp(`(?:async )?function ${name}\\(`))
    return source.slice(start, source.indexOf('\n}', start) + 2)
  })
  const ui = vm.runInNewContext(`${functions.join('\n')}\n;({submitStage, submitTerminal,
    submitContractTransfer})`, context)
  return { ui, context, calls, errors }
}

test('主页面本地赢单提交证据并丢弃旧合同字段，合同模式继续提交编号', async () => {
  const local = harness('local_evidence')
  await local.ui.submitStage()
  assert.equal(local.errors.length, 0)
  assert.equal(local.calls[0].payload.contract_ref, undefined)
  assert.equal(local.calls[0].payload.win_evidence.evidence_reference, 'PO-001')
  const linked = harness('contract')
  await linked.ui.submitStage()
  assert.equal(linked.calls[0].payload.contract_ref, '旧表单残留')
  assert.equal(linked.calls[0].payload.win_evidence, undefined)
})

test('本地终态待办走证据路径，未订阅转合同不进入确认或写请求', async () => {
  const h = harness('local_evidence')
  h.context.terminalForm.win_evidence = h.context.stageForm.win_evidence
  await h.ui.submitTerminal()
  assert.equal(h.calls[0].payload.win_evidence.evidence_type, 'CUSTOMER_CONFIRMATION')
  h.calls.length = 0
  h.ui.submitContractTransfer()
  assert.equal(h.calls.length, 0)
})
