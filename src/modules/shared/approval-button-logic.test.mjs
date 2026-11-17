import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { computed, ref } from 'vue'

const source = await readFile(new URL('../contract_management/views/ContractManagementView.vue', import.meta.url), 'utf8')
const match = source.match(/const canActOnApproval = computed\(\(\) => ([\s\S]*?)\nconst approvalRealtimeScope/)
assert.ok(match, 'canActOnApproval must exist')

function canAct({ permission = true, status = 'active', unavailable = false } = {}) {
  const expressionText = match[1].replace(/\)\s*$/, '')
  const expression = new Function('can', 'selectedApproval', 'approvalDetail', 'computed', `return computed(() => ${expressionText})`)
  return expression(
    () => permission,
    ref({ status }),
    ref({ state_unavailable: unavailable }),
    computed,
  ).value
}

test('只有当前节点 active 且有权限时才允许审批动作', () => {
  assert.equal(canAct(), true)
  assert.equal(canAct({ permission: false }), false)
  assert.equal(canAct({ status: 'approved' }), false)
  assert.equal(canAct({ status: 'pending' }), false)
  assert.equal(canAct({ unavailable: true }), false)
})
