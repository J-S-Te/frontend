import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./components/ContractReportsPanel.vue', import.meta.url), 'utf8')

test('contract reports show summaries, distributions and complete business details', () => {
  for (const label of ['合同总额', '合同数量', '平均合同金额', '有效 / 超期', '合同状态分布', '合同类型分布', '合同详细信息']) {
    assert.match(source, new RegExp(label))
  }
  for (const field of ['合同编号', '合同名称', '合同类型', '服务类型', '客户信用等级', '金额 / 币种', '负责人', '开始日期', '到期日期', '创建日期', '更新日期', '状态', '合同内容']) {
    assert.match(source, new RegExp(`<th>${field.replace('/', '\\/')}</th>`))
  }
  assert.match(source, /emit\('open-contract', contract\)/)
})

test('contract reports do not render internal tenancy or integrity fields', () => {
  assert.doesNotMatch(source, /tenant_id|content_hash|owner_user_id|template_id|recordId }}|数据版本/)
})
