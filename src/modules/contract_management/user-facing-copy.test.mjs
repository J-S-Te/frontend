import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const viewSource = await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')
const apiSource = await readFile(new URL('./api/contract.js', import.meta.url), 'utf8')

test('contract pages use business language instead of exposing integration status', () => {
  for (const copy of [
    '来自合同 API',
    '合同 API 当前未返回可见合同',
    '合同后端尚未提供客户查询接口',
    '合同后端尚未提供签署台账接口',
    '暂无独立统计接口',
    '刷新真实数据',
    '真实合同记录',
  ]) {
    assert.doesNotMatch(viewSource, new RegExp(copy))
  }
})

test('request failures never fall back to an HTTP status string', () => {
  assert.doesNotMatch(apiSource, /`HTTP \$\{response\.status\}`/)
  assert.match(apiSource, /userSafeErrorMessage\(body\?\.message\)/)
  assert.match(apiSource, /操作失败，请稍后重试。/)
})

test('partial loading failures are limited to related business pages', () => {
  assert.match(viewSource, /businessDataErrors\.value\[activeSection\.value\]/)
  assert.match(viewSource, /const addRequest = \(label, sections, promise\) =>/)
  assert.match(viewSource, /Promise\.allSettled\(requests\.map\(\(request\) => request\.promise\)\)/)
  assert.match(viewSource, /addRequest\('合同统计', \['dashboard', 'reports'\]/)
  assert.match(viewSource, /addRequest\('合同模板', \['templates', 'contracts'\]/)
  assert.doesNotMatch(viewSource, /failures\.map\(\(result\) => result\.reason\?\.message/)
})

test('statistics render complete contract business details', () => {
  assert.match(viewSource, /<ContractReportsPanel/)
  assert.match(viewSource, /:contracts="reportContracts"/)
  assert.match(viewSource, /:enterprise-scope="isAdmin"/)
})

test('approval and template screens hide internal identifiers', () => {
  for (const copy of ['节点 ID', '已通过节点 ID', '字段标识', '规则版本']) {
    assert.doesNotMatch(viewSource, new RegExp(copy))
  }
  assert.doesNotMatch(viewSource, /selectedApproval\.id }}|selectedApproval\.contractId/)
  assert.match(viewSource, /approvalActionLabel\(action\.action\)/)
})
