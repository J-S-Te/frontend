import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { CRMAPIError } from './api/client.js'
import { useCustomerImportWizard } from './composables/useCustomerImportWizard.js'

test('商机终态冻结和重复转合同说明处理路径，刷新不能解除业务冻结', () => {
  for (const [code, expected] of [
    ['CRM_OPPORTUNITY_TERMINAL_STAGE_LOCKED', /终态.*受控更正/],
    ['CRM_OPPORTUNITY_TERMINAL_AMOUNT_FROZEN', /金额.*签约.*冻结/],
    ['CRM_OPPORTUNITY_CONTRACT_TRANSFER_ALREADY_LINKED', /已.*转.*合同.*核对/],
  ]) {
    const error = new CRMAPIError('operation is not allowed', { status: 409, code, method: 'POST' })
    assert.match(error.message, expected)
    assert.doesNotMatch(error.message, /刷新列表后检查记录，再重新操作/)
    assert.equal(error.code, code)
  }
})

test('客户导入显示服务端已有的表头列原因，不能被通用文件格式消息覆盖', () => {
  const error = ref('')
  const wizard = useCustomerImportWizard({ error, notice: ref(''), actionLoading: ref(false), runtimeCapability: () => ({ available: true }) })
  wizard.showCustomerImportError({ code: 'CRM_CUSTOMER_IMPORT_FILE_INVALID', details: { column: '客户名称', code: 'INVALID_HEADER', message: '只接受固定中文表头且表头不得包含公式' } })
  assert.match(error.value, /客户名称.*表头.*公式/)
  wizard.showCustomerImportError({ code: 'CRM_CUSTOMER_IMPORT_FILE_INVALID', details: { column: '表头', code: 'INVALID_HEADERS', message: '表头数量不正确' } })
  assert.match(error.value, /表头数量不正确/)
  wizard.showCustomerImportError({ code: 'CRM_CUSTOMER_IMPORT_FILE_INVALID', details: { column: 'secret SQLSTATE', code: 'UNTRUSTED', message: 'SQLSTATE: secret' } })
  assert.doesNotMatch(error.value, /SQLSTATE|secret/)
})
