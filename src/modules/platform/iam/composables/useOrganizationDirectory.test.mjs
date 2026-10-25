import assert from 'node:assert/strict'
import test from 'node:test'
import { reactive } from 'vue'
import { useOrganizationDirectory } from './useOrganizationDirectory.js'

function harness({ canRead = true, filter = '' } = {}) {
  const calls = []
  const requestSeq = { organizations: 0 }
  const pagination = { organizations: { page: 0, pageSize: 0, total: 0, serverPagingSupported: false } }
  // 与组件一致使用 reactive：filteredOrganizations 依赖 panelFilters.organizations 的响应式。
  const panelFilters = reactive({ organizations: filter })
  const panels = [{ key: 'organizations', label: '组织单元' }]
  const deps = {
    canReadPanel: () => canRead,
    panels,
    requestSeq,
    pagination,
    safeCall: async (kind, fn) => {
      calls.push(['safeCall', kind])
      return fn()
    },
    panelFilters,
  }
  const listOrgUnitsArgs = []
  return { deps, pagination, panelFilters, requestSeq, calls, listOrgUnitsArgs }
}

test('loadOrganizations paginates until total, dedupes and updates pagination', async () => {
  const pageA = [{ org_unit_id: 'org-1', name: '总部', code: 'HQ' }]
  const pageB = [{ org_unit_id: 'org-2', name: '研发', code: 'RD' }, { org_unit_id: 'org-1', name: '重复', code: 'DUP' }]
  const h = harness({})
  h.deps.listOrgUnits = async (args) => {
    h.listOrgUnitsArgs.push(args)
    const page = h.listOrgUnitsArgs.length
    return { items: [pageA, pageB][page - 1] || [], total: 3 }
  }
  const { organizations, loadOrganizations } = useOrganizationDirectory(h.deps)
  await loadOrganizations()
  assert.deepEqual(organizations.value.map(item => item.org_unit_id), ['org-1', 'org-2'], '重复 id 必须去重')
  assert.equal(h.pagination.organizations.total, 3)
  assert.equal(h.pagination.organizations.serverPagingSupported, false, '取满 2 条 < 总数 3 时不得声称服务端分页完整')
  assert.deepEqual(h.listOrgUnitsArgs[0], { page: 1, pageSize: 100, status: 'ACTIVE' })
})

test('loadOrganizations skips request without panel read permission', async () => {
  const h = harness({ canRead: false })
  let apiCalls = 0
  h.deps.listOrgUnits = async () => { apiCalls += 1; return { items: [], total: 0 } }
  const { organizations, loadOrganizations } = useOrganizationDirectory(h.deps)
  await loadOrganizations()
  assert.equal(apiCalls, 0)
  assert.deepEqual(organizations.value, [])
})

test('filteredOrganizations filters by keyword across code and name fields', () => {
  const h = harness({ filter: '', __pages__: [[
    { org_unit_id: 'org-1', name: '总部', code: 'HQ' },
    { org_unit_id: 'org-2', name: '研发中心', code: 'RD' },
  ]], filter: '研发' })
  h.deps.listOrgUnits = async () => ({ items: h.deps.panelFilters && [], total: 2 })
  const { organizations, filteredOrganizations, loadOrganizations } = useOrganizationDirectory(h.deps)
  organizations.value = [
    { org_unit_id: 'org-1', name: '总部', code: 'HQ' },
    { org_unit_id: 'org-2', name: '研发中心', code: 'RD' },
  ]
  assert.deepEqual(filteredOrganizations.value.map(item => item.code), ['RD'])
  h.panelFilters.organizations = ''
  assert.equal(filteredOrganizations.value.length, 2)
})

test('export context maps parent name, path and depth from the tree', async () => {
  const h = harness({})
  // 依赖在 composable 创建时解构：必须先设桩再创建，事后再挂不生效。
  h.deps.listOrgUnits = async () => ({ items: [
    { org_unit_id: 'org-1', name: '总部', code: 'HQ' },
    { org_unit_id: 'org-2', name: '研发', code: 'RD', parent_id: 'org-1' },
  ], total: 2 })
  const { organizationExportContext, organizationExportRows, loadOrganizations } = useOrganizationDirectory(h.deps)
  await loadOrganizations()
  const context = organizationExportContext.value
  assert.equal(context.get('org-1').path, '总部')
  assert.equal(context.get('org-2').parentName, '总部')
  assert.equal(context.get('org-2').path, '总部 / 研发')
  assert.equal(context.get('org-2').depth, 1)
  assert.ok(organizationExportRows.value)
})
