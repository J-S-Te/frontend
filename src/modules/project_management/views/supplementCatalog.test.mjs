import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createRequestScope } from '../../platform/shared/composables/requestScope.js'

const view = await readFile(new URL('./ProjectManagementView.vue', import.meta.url), 'utf8')
const body = view.slice(view.indexOf('async function openDecompositionAdjust()'), view.indexOf('function addAdjustItem()'))
function context() {
  return {
    decompositionProject: { value: { id: 'PJ-1' } },
    adjustProjectID: { value: '' }, supplementContracts: { value: [] },
    approvedContracts: { value: [] }, detectionCategories: { value: [] },
    activeDetectionCategoryOptions: { value: ['等保'] }, supplementContractOptions: { value: [{ id: 'SUP' }] },
    adjustForm: { value: {} }, adjustOpen: { value: false }, adjustScope: createRequestScope(), saving: { value: false },
    emptyAdjustForm: () => ({ reason: '', supplementContractID: '' }),
    showToast: () => {}, formatUserError: () => 'error', listDetectionCategories: async () => ['等保'],
    // 自动创建成功后，旧的待建项目目录为空。
    listApprovedContracts: async () => [],
    listSupplementContracts: async (projectID, options) => {
      assert.equal(projectID, 'PJ-1'); assert.equal(options.limit, 200)
      return [{ id: 'SUP', contract_number: 'HT-SUP', status: 'active', approval_passed: true }]
    },
  }
}
test('调整弹窗使用独立项目资格目录，已自动建项补充协议仍可选择', async () => {
  const c = context()
  await vm.runInNewContext(`${body}; openDecompositionAdjust()`, c)
  assert.equal(c.supplementContracts.value[0]?.id, 'SUP')
  assert.equal(c.adjustProjectID.value, 'PJ-1')
  assert.equal(c.adjustOpen.value, true)
  assert.deepEqual(c.approvedContracts.value, [])
})
test('目录响应迟到且用户已切换项目时不打开旧项目调整', async () => {
  const c = context()
  c.listSupplementContracts = async () => { c.decompositionProject.value = { id: 'PJ-2' }; return [{ id: 'SUP' }] }
  await vm.runInNewContext(`${body}; openDecompositionAdjust()`, c)
  assert.equal(c.adjustOpen.value, false)
  assert.equal(c.supplementContracts.value.length, 0)
})
test('资格目录失败关闭并清空旧候选', async () => {
  const c = context()
  c.supplementContracts.value = [{ id: 'OLD' }]
  c.listSupplementContracts = async () => { throw new Error('unavailable') }
  await vm.runInNewContext(`${body}; openDecompositionAdjust()`, c)
  assert.equal(c.adjustOpen.value, false)
  assert.equal(c.supplementContracts.value.length, 0)
})

test('补充协议选项复核历史原编号、客户及审批状态，并绑定目录目标项目', () => {
  const start = view.indexOf('const supplementContractOptions = computed(')
  const end = view.indexOf('const canConfirmCurrentDecomposition', start)
  const c = context()
  c.computed = (getter) => ({ get value() { return getter() } })
  c.adjustProjectID.value = 'PJ-1'
  c.decompositionProject.value = { id: 'PJ-1', contract_id: '', contract: 'HT-ORIGINAL', customer_id: 'customer' }
  c.supplementContracts.value = [
    { id: 'canonical-original', contract_number: 'HT-ORIGINAL', customer_id: 'customer', status: 'active', approval_passed: true },
    { id: 'valid', contract_number: 'HT-SUP', customer_id: 'customer', status: 'active', approval_passed: true },
    { id: 'other', customer_id: 'other', status: 'approved', approval_passed: true },
    { id: 'pending', customer_id: 'customer', status: 'pending', approval_passed: true },
    { id: 'unapproved', customer_id: 'customer', status: 'active', approval_passed: false },
  ]
  vm.runInNewContext(`${view.slice(start, end)}; result = supplementContractOptions`, c)
  assert.deepEqual(Array.from(c.result.value, (item) => item.id), ['valid'])
  c.decompositionProject.value = { id: 'PJ-2', customer_id: 'customer' }
  assert.equal(c.result.value.length, 0)
})

test('项目切换后不能提交旧项目补充协议草稿', async () => {
  const start = view.indexOf('async function submitDecompositionAdjust()')
  const end = view.indexOf('async function toggleRule(', start)
  const c = context()
  let writes = 0
  c.adjustProjectID.value = 'PJ-OLD'
  c.adjustOpen.value = true
  c.adjustDecomposition = async () => { writes++ }
  await vm.runInNewContext(`${view.slice(start, end)}; submitDecompositionAdjust()`, c)
  assert.equal(writes, 0)
  assert.equal(c.adjustOpen.value, false)
})

test('同项目连续打开时，旧请求迟到不能覆盖新目录', async () => {
  const c = context()
  let releaseFirst
  let calls = 0
  c.listSupplementContracts = async () => {
    if (++calls === 1) return new Promise((resolve) => { releaseFirst = resolve })
    return [{ id: 'NEW' }]
  }
  const first = vm.runInNewContext(`${body}; openDecompositionAdjust()`, c)
  await vm.runInNewContext('openDecompositionAdjust()', c)
  releaseFirst([{ id: 'OLD' }])
  await first
  assert.equal(c.supplementContracts.value[0].id, 'NEW')
})
