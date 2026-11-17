import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { parse } from '@babel/parser'
import { parse as parseSFC } from '@vue/compiler-sfc'
import { ref } from 'vue'
import { formatUserError } from '../shared/utils/userError.js'

test('合同聚合加载保留区域具体安全原因，其他区域成功数据仍可使用', async () => {
  const source = parseSFC(await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content
  const node = parse(source, { sourceType: 'module' }).program.body.find(item => item.type === 'FunctionDeclaration' && item.id.name === 'loadBusinessData')
  const scope = {
    businessDataSequence: 0,
    approvalsKnown: ref(false), businessDataLoading: ref(false), businessDataErrors: ref({}), adminDashboard: ref(null), contracts: ref([]),
    ledgerPage: ref(1), ledgerPageSize: ref(20), keyword: ref(''), typeFilter: ref(''),
    can: permission => permission === 'contract.read', isAdmin: ref(false), contractStatusQuery: () => '', ledgerExpiryQuery: () => '',
    getContractDashboard: async () => ({ count: 7 }),
    listContracts: async () => { throw new Error('合同台账查询权限已调整，请联系管理员确认数据范围。') },
    ContractAuthError: class extends Error {}, formatUserError,
  }
  const load = new Function(...Object.keys(scope), `${source.slice(node.start, node.end)};return loadBusinessData`)(...Object.values(scope))
  await load()
  assert.equal(scope.adminDashboard.value.count, 7)
  assert.match(scope.businessDataErrors.value.contracts, /合同台账.*权限已调整.*数据范围/)
  assert.equal(scope.businessDataLoading.value, false)
})

test('合同列表旧请求迟到时不能覆盖新筛选结果', async () => {
  const source = parseSFC(await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content
  const node = parse(source, { sourceType: 'module' }).program.body.find(item => item.type === 'FunctionDeclaration' && item.id.name === 'loadBusinessData')
  const pending = []
  const scope = {
    businessDataSequence: 0,
    approvalsKnown: ref(false), businessDataLoading: ref(false), businessDataErrors: ref({}), adminDashboard: ref(null), contracts: ref([]),
    ledgerPage: ref(1), ledgerPageSize: ref(20), ledgerTotal: ref(0), ledgerPageCount: ref(1), keyword: ref(''), typeFilter: ref(''),
    can: permission => permission === 'contract.read', isAdmin: ref(false), contractStatusQuery: () => '', ledgerExpiryQuery: () => '',
    getContractDashboard: async () => ({ count: 7 }), listContracts: () => new Promise(resolve => pending.push(resolve)),
    normalizeContract: item => item, ContractAuthError: class extends Error {}, formatUserError,
  }
  const load = new Function(...Object.keys(scope), `${source.slice(node.start, node.end)};return loadBusinessData`)(...Object.values(scope))
  const old = load(), current = load()
  pending[1]({ items: [{ id: 'new' }], total: 1 })
  await current
  pending[0]({ items: [{ id: 'old' }], total: 20 })
  await old
  assert.deepEqual(scope.contracts.value, [{ id: 'new' }])
  assert.equal(scope.ledgerTotal.value, 1)
  assert.equal(scope.businessDataLoading.value, false)
})
