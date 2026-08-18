import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOrganizationExportRows, buildPositionExportRows } from './treeExport.js'

const organizations = [
  { org_unit_id: 'root', name: '集团', sort_order: 1 },
  { org_unit_id: 'sales', parent_id: 'root', name: '销售部', sort_order: 1 },
  { org_unit_id: 'east', parent_id: 'sales', name: '华东组', sort_order: 1 },
  { org_unit_id: 'finance', parent_id: 'root', name: '财务部', sort_order: 2 },
]

test('组织导出保持实际树顺序并生成可读的树状名称', () => {
  const rows = buildOrganizationExportRows(organizations)
  assert.deepEqual(rows.map((row) => row.treeName), ['集团', '├─销售部', '  └─华东组', '└─财务部'])
  assert.equal(rows[2].path, '集团 / 销售部 / 华东组')
  assert.equal(rows[2].parentName, '销售部')
})

test('组织筛选只限制导出行但保留真实层级上下文', () => {
  const rows = buildOrganizationExportRows(organizations, ['east'])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].treeName, '  └─华东组')
  assert.equal(rows[0].path, '集团 / 销售部 / 华东组')
})

test('岗位导出按组织树排序并携带组织路径和树状名称', () => {
  const positions = [
    { position_id: 'p2', org_unit_id: 'east', name: '客户经理' },
    { position_id: 'p1', org_unit_id: 'sales', name: '销售经理' },
  ]
  const rows = buildPositionExportRows(positions, organizations)
  assert.deepEqual(rows.map((row) => row.name), ['销售经理', '客户经理'])
  assert.equal(rows[0].organization_path, '集团 / 销售部')
  assert.match(rows[1].treeName, /华东组.*客户经理/)
})
