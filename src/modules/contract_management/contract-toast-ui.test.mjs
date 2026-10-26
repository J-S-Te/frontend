import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
const source = await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')
const toast = await readFile(new URL('../shared/components/OperationToast.vue', import.meta.url), 'utf8')
test('合同操作提示使用顶层共享组件，位置不受合同样式重复覆盖', () => {
  assert.match(source, /<OperationToast :message="toast"/)
  assert.doesNotMatch(source, /class="contract-toast"/)
  assert.match(toast, /<Teleport to="body">/)
  assert.match(toast, /z-index: 12000/)
})
