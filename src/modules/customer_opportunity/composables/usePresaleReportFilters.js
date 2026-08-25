/**
 * Report filter option loading and dependent-filter validation.
 * The report uses worklog participation as its source of truth, so this
 * loader is intentionally separate from the presale-list filter options.
 */
export function createPresaleReportFilters({
  showReport,
  reportFilters,
  reportParams,
  reportFilterOptions,
  reportFilterOptionsLoading,
  reportFilterOptionsError,
  reportOrganizationOptions,
  getPresaleReportFilterOptions,
  listOwnerDirectory,
  rememberOwnerDirectory,
  directoryErrorMessage,
}) {
  const directoryPageSize = 50
  const directoryMaxPages = 200
  const loadGuard = createLatestRequestGuard()

  async function loadOwnerDirectory() {
    const firstPage = await listOwnerDirectory({ page: 1, page_size: directoryPageSize })
    const users = [...(firstPage?.items || [])]
    const total = Number(firstPage?.total)
    const expectedTotal = Number.isFinite(total) && total >= 0 ? total : null

    // 基础平台目录接口单页最多 50 人；报表组织筛选不能只拿首屏数据，否则人数较多的
    // 租户会遗漏组织，并把用户已选择的有效组织误判为无效后清空。
    for (let page = 2; page <= directoryMaxPages; page += 1) {
      if ((expectedTotal !== null && users.length >= expectedTotal) || users.length % directoryPageSize !== 0) break
      const result = await listOwnerDirectory({ page, page_size: directoryPageSize })
      const items = result?.items || []
      users.push(...items)
      if (items.length < directoryPageSize) break
    }
    return users
  }

  async function load() {
    const requestGeneration = loadGuard.begin()
    reportFilterOptionsLoading.value = true
    reportFilterOptionsError.value = ''
    try {
      const [filterOptions, directoryUsers] = await Promise.all([
        getPresaleReportFilterOptions({ ...reportParams(), dimension: undefined }),
        loadOwnerDirectory(),
      ])
      if (!loadGuard.isCurrent(requestGeneration) || !showReport.value) return
      rememberOwnerDirectory(directoryUsers)
      reportFilterOptions.value = {
        opportunities: filterOptions?.opportunities || [],
        assignees: filterOptions?.assignees || [],
      }
      const organizations = new Map()
      for (const user of directoryUsers) {
        for (const organization of user.organizations || []) organizations.set(organization.organization_id, organization)
      }
      reportOrganizationOptions.value = [...organizations.values()].sort((left, right) => left.organization_name.localeCompare(right.organization_name, 'zh-CN'))
      if (reportFilters.organization_id && !organizations.has(reportFilters.organization_id)) reportFilters.organization_id = ''
      if (reportFilters.person_id && !reportFilterOptions.value.assignees.some((item) => item.value === reportFilters.person_id)) reportFilters.person_id = ''
      if (reportFilters.opportunity_id && !reportFilterOptions.value.opportunities.some((item) => String(item.value) === String(reportFilters.opportunity_id))) reportFilters.opportunity_id = ''
    } catch (value) {
      if (loadGuard.isCurrent(requestGeneration) && showReport.value) reportFilterOptionsError.value = directoryErrorMessage(value)
    } finally {
      if (loadGuard.isCurrent(requestGeneration)) reportFilterOptionsLoading.value = false
    }
  }

  async function onPersonChange() {
    reportFilters.opportunity_id = ''
    await load()
  }

  async function onOrganizationChange() {
    reportFilters.person_id = ''
    reportFilters.opportunity_id = ''
    await load()
  }

  return { load, onPersonChange, onOrganizationChange }
}
import { createLatestRequestGuard } from './latestRequest.js'
