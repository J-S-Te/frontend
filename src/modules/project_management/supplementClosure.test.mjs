import assert from 'node:assert/strict'
import test from 'node:test'
import {
  eligibleClosureContracts,
  emptyClosureForm,
  supplementClosureAvailability,
  supplementRequired,
  SUPPLEMENT_CLOSURE_CONFIRM_NOTE,
  validateSupplementClosure,
} from './supplementClosure.js'

const required = { id: 'PJ-1', supplement_status: 'REQUIRED', customer_id: 'C-1', contract_id: 'HT-ORIGINAL', contract: 'HT-ORIGINAL' }
const permissions = new Set(['project.decomposition.manage'])

test('只有 supplement_status=REQUIRED 的项目显示关账入口', () => {
  assert.equal(supplementRequired(required), true)
  assert.equal(supplementRequired({ supplement_status: ' required ' }), true)
  assert.equal(supplementRequired({ supplement_status: 'NONE' }), false)
  assert.equal(supplementRequired({ status: '补充协议处理中' }), false)
  assert.equal(supplementRequired(null), false)

  assert.deepEqual(supplementClosureAvailability(required, permissions), { visible: true, allowed: true, reason: '' })
  assert.equal(supplementClosureAvailability({ ...required, supplement_status: 'NONE' }, permissions).visible, false)
  assert.equal(supplementClosureAvailability(null, permissions).visible, false)
})

test('处于补充协议分支但没有拆解管理权限时保留入口并说明原因', () => {
  const denied = supplementClosureAvailability(required, new Set(['project.read']))
  assert.equal(denied.visible, true)
  assert.equal(denied.allowed, false)
  assert.match(denied.reason, /project\.decomposition\.manage/)
  assert.equal(supplementClosureAvailability(required, undefined).allowed, false)
})

test('候选补充协议复核审批状态、原合同排除与客户归属', () => {
  const contracts = [
    { id: 'SUP-VALID', contract_number: 'HT-SUP', customer_id: 'C-1', status: 'active', approval_passed: true },
    { id: 'SUP-APPROVED', contract_number: 'HT-SUP-2', customer_id: 'C-1', status: 'approved', approval_passed: true },
    { id: 'SUP-ORIGINAL-ID', contract_number: 'HT-SUP-3', customer_id: 'C-1', status: 'active', approval_passed: true },
    { id: 'SUP-ORIGINAL-NUMBER', contract_number: 'HT-ORIGINAL', customer_id: 'C-1', status: 'active', approval_passed: true },
    { id: 'SUP-OTHER-CUSTOMER', contract_number: 'HT-X', customer_id: 'C-2', status: 'active', approval_passed: true },
    { id: 'SUP-PENDING', contract_number: 'HT-P', customer_id: 'C-1', status: 'pending', approval_passed: true },
    { id: 'SUP-UNAPPROVED', contract_number: 'HT-U', customer_id: 'C-1', status: 'active', approval_passed: false },
    { contract_number: 'HT-NO-ID', customer_id: 'C-1', status: 'active', approval_passed: true },
  ]
  const project = { ...required, contract_id: 'SUP-ORIGINAL-ID', contract: 'HT-ORIGINAL' }
  assert.deepEqual(eligibleClosureContracts(project, contracts).map((item) => item.id), ['SUP-VALID', 'SUP-APPROVED'])
  // 客户 ID 缺失时退回客户名称比对，且缺少客户名时失败关闭。
  assert.deepEqual(eligibleClosureContracts({ ...project, customer_id: '', customer: '示例客户' }, [
    { id: 'A', contract_number: 'A', customer_name: '示例客户', status: 'active', approval_passed: true },
    { id: 'B', contract_number: 'B', customer_name: '其他客户', status: 'active', approval_passed: true },
  ]).map((item) => item.id), ['A'])
  assert.deepEqual(eligibleClosureContracts({ ...project, customer_id: '', customer: '' }, contracts), [])
  assert.deepEqual(eligibleClosureContracts(project, null), [])
})

test('关账表单要求已审批补充协议与必填原因，并限制长度', () => {
  assert.equal(validateSupplementClosure(emptyClosureForm()), '请选择已审批的补充协议')
  assert.equal(validateSupplementClosure({ supplementContractID: 'SUP', reason: '   ' }), '请填写关闭补充协议的原因')
  assert.equal(validateSupplementClosure({ supplementContractID: '', reason: '原因' }), '请选择已审批的补充协议')
  assert.equal(validateSupplementClosure({ supplementContractID: 'SUP', reason: '原因' }), '')
  assert.equal(validateSupplementClosure({ supplementContractID: 'SUP', reason: ' 原因 ' }), '')
  assert.match(validateSupplementClosure({ supplementContractID: 'SUP', reason: 'x'.repeat(1001) }), /1000/)
})

test('二次确认文案明确范围指纹基准与不能再用确认拆解清除', () => {
  assert.match(SUPPLEMENT_CLOSURE_CONFIRM_NOTE, /范围指纹/)
  assert.match(SUPPLEMENT_CLOSURE_CONFIRM_NOTE, /不能再通过「确认拆解」清除/)
})
