import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')

test('approval center switches between tasks and initiated approvals', () => {
  assert.match(source, /const approvalTab = ref\('tasks'\)/)
  assert.match(source, /@click="approvalTab = 'initiated'"/)
  assert.match(source, /:class="\{ active: approvalTab === 'initiated' \}"/)
  assert.match(source, /v-if="approvalTab === 'tasks'"/)
  assert.match(source, /<section v-else class="contract-approval-list" role="tabpanel">/)
})
