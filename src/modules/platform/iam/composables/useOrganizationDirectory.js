import { computed, ref } from 'vue'
import { includesFilter } from '../utils/listFilter.js'
import { buildOrganizationExportContext } from '../utils/organizationTree.js'
import { buildOrganizationExportRows } from '../utils/treeExport.js'

/**
 * 组织目录面板的内部状态与请求（治理批次 2 第二步）。
 * 收编：organizations 列表、全量分页加载、关键字过滤与导出行/上下文计算。
 * 仍属父组件的职责（不在此处）：组织编辑器（与统一 editor/form 耦合）、
 * 删除编排（跨面板刷新）、parentOptions（依赖编辑器状态）。
 *
 * 注入项与组件内同名标识一一对应：canReadPanel/panels/requestSeq/pagination/
 * safeCall/panelFilters/listOrgUnits；不直接导入 API 模块，保持可独立测试。
 */
export function useOrganizationDirectory({ canReadPanel, panels, requestSeq, pagination, safeCall, panelFilters, listOrgUnits }) {
  const organizations = ref([])

  async function loadOrganizations() {
    if (!canReadPanel(panels.find((item) => item.key === 'organizations'))) return
    const seq = ++requestSeq.organizations
    // 树结构必须同时拥有父节点和子节点。按后端允许的最大页长读取全部授权可见组织，
    // 搜索留在前端执行，避免服务端关键字过滤后只返回子节点而丢失其祖先上下文。
    const treePageSize = 100
    const data = await safeCall('organizations', async () => {
      const items = []
      const seenIds = new Set()
      let page = 1
      let total = 0

      while (page === 1 || items.length < total) {
        const result = await listOrgUnits({ page, pageSize: treePageSize, status: 'ACTIVE' })
        total = result.total
        let added = 0
        for (const item of result.items) {
          const id = String(item.org_unit_id || item.id || '')
          if (!id || seenIds.has(id)) continue
          seenIds.add(id)
          items.push(item)
          added += 1
        }
        if (!result.items.length || added === 0) break
        page += 1
      }

      const complete = items.length >= total
      return { items, total, page: 1, pageSize: complete ? Math.max(total, treePageSize) : treePageSize }
    })
    if (seq !== requestSeq.organizations) return
    if (data) {
      pagination.organizations.page = 1
      pagination.organizations.pageSize = data.pageSize
      pagination.organizations.total = data.total
      pagination.organizations.serverPagingSupported = data.items.length >= data.total
      organizations.value = data.items
    }
  }

  const filteredOrganizations = computed(() => includesFilter(organizations.value, panelFilters.organizations, ['code', 'name']))
  const organizationExportRows = computed(() => buildOrganizationExportRows(
    organizations.value,
    new Set(filteredOrganizations.value.map((item) => String(item.org_unit_id || item.id || ''))),
  ))
  const organizationExportContext = computed(() => buildOrganizationExportContext(organizations.value))

  return { organizations, loadOrganizations, filteredOrganizations, organizationExportRows, organizationExportContext }
}
