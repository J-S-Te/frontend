import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const view = await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')
const api = await readFile(new URL('./api/contract.js', import.meta.url), 'utf8')

// 后端已有 GET /approvals/:id/contract-source（按审批参与范围下载不可变快照），
// 前端此前只能看 PDF 预览；这里补 DOCX/PDF 原件下载入口。
test('审批合同原件下载使用审批快照端点并接受 DOCX/PDF', () => {
  assert.ok(api.includes('export function downloadApprovalContractSource(approvalId)'))
  assert.ok(api.includes('/approvals/${encodeURIComponent(approvalId)}/contract-source'))
  assert.ok(api.includes('application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document'))
  assert.ok(api.includes("feature: 'contract_approval_source'"))
})

test('审批详情提供下载按钮，下载失败留在弹窗提示', () => {
  assert.ok(view.includes('downloadApprovalContractSource,'))
  assert.ok(view.includes('async function downloadApprovalSource() {'))
  assert.ok(view.includes('downloadApprovalContractSource(approval.id)'))
  assert.ok(view.includes('审批合同原件下载失败，请稍后重试。'))
  assert.ok(view.includes(':disabled="approvalSourceBusy"') || view.includes(':disabled="approvalSourceBusy" @click'))
  assert.ok(view.includes('下载合同原件'))
  // 下载必须走 Blob + 受控文件名，不允许整页导航到接口地址。
  const start = view.indexOf('async function downloadApprovalSource() {')
  const body = view.slice(start, view.indexOf('\n}', start))
  assert.match(body, /URL\.createObjectURL\(blob\)/)
  assert.match(body, /link\.download = filename/)
  assert.doesNotMatch(body, /window\.location/)
})
