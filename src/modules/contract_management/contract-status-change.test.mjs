import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')
const apiSource = await readFile(new URL('./api/contract.js', import.meta.url), 'utf8')

// 回归锁定：合同详情必须给后端已有、但前端原先没有入口的状态变更一个入口。
// 只暴露 active 之后的可达运维动作；draft/pending/approved 仍走提交审批与审批动作，
// 不能从本入口绕过审批链。
test('contract detail exposes status change only for post-approval lifecycle states', () => {
  assert.ok(source.includes('changeContractStatus,'), '视图必须导入状态变更 API')
  assert.ok(source.includes('const CONTRACT_STATUS_CHANGE_TARGETS = Object.freeze({'), '缺少可达状态表')
  assert.ok(source.includes("active: ['in_progress', 'terminated', 'archived']"))
  assert.ok(source.includes("pending_pay: ['completed', 'terminated', 'archived']"))
  assert.ok(source.includes("!can('contract.edit')"), '无 contract.edit 权限时不得显示入口')
  assert.ok(source.includes('v-if="statusChangeTargets.length"'), '详情页缺少变更状态按钮')
  assert.ok(source.includes('>变更状态</button>'))
  const block = source.slice(source.indexOf('const CONTRACT_STATUS_CHANGE_TARGETS'), source.indexOf('const statusChangeOpen'))
  assert.doesNotMatch(block, /draft:|pending:|approved:/, '审批流内状态不得从本入口绕过')
})

// 目标状态、原因和提交态必须同屏；空原因禁用提交，成功后区分“已变更/已提交审批”。
test('status change dialog enforces target and reason and reports the outcome', () => {
  assert.ok(source.includes('v-if="statusChangeOpen"'), '缺少状态变更弹窗')
  assert.ok(source.includes('v-model="statusChangeTarget"'), '缺少目标状态下拉')
  assert.ok(source.includes('v-model="statusChangeReason"'), '缺少原因输入')
  assert.ok(source.includes('maxlength="1000"'), '原因必须有 1000 字上限')
  assert.ok(source.includes(':disabled="statusChangeSubmitting || !statusChangeTarget || !statusChangeReason.trim()"'), '空目标或空原因必须禁用提交')
  assert.ok(source.includes('changeContractStatus(contract.recordId, {'), '必须调用状态变更 API')
  assert.ok(source.includes('version: contract.version'), '必须提交乐观版本')
  assert.ok(source.includes('targetStatus: target'), '必须提交目标状态')
  assert.ok(source.includes('result.changed'), '必须处理直接变更结果')
  assert.ok(source.includes('状态变更已提交审批'), '启动审批时必须有明确反馈')
})

// API 契约：POST status-changes，只有 changed 或 approval_id 才算成功。
test('status change API uses the backend state machine endpoint', () => {
  assert.ok(apiSource.includes('export async function changeContractStatus'))
  assert.ok(apiSource.includes('status-changes'))
  assert.ok(apiSource.includes("method: 'POST'"))
  assert.ok(apiSource.includes("data.status === 'changed' || resourceID(data.approval_id)"))
})
