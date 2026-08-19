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
  async function load() {
    reportFilterOptionsLoading.value = true
    reportFilterOptionsError.value = ''
    try {
      const [filterOptions, directory] = await Promise.all([
        getPresaleReportFilterOptions({ ...reportParams(), dimension: undefined }),
        listOwnerDirectory({ page: 1, page_size: 50 }),
      ])
      if (!showReport.value) return
      rememberOwnerDirectory(directory?.items)
      reportFilterOptions.value = {
        opportunities: filterOptions?.opportunities || [],
        assignees: filterOptions?.assignees || [],
      }
      const organizations = new Map()
      for (const user of directory?.items || []) {
        for (const organization of user.organizations || []) organizations.set(organization.organization_id, organization)
      }
      reportOrganizationOptions.value = [...organizations.values()].sort((left, right) => left.organization_name.localeCompare(right.organization_name, 'zh-CN'))
      if (reportFilters.organization_id && !organizations.has(reportFilters.organization_id)) reportFilters.organization_id = ''
      if (reportFilters.person_id && !reportFilterOptions.value.assignees.some((item) => item.value === reportFilters.person_id)) reportFilters.person_id = ''
      if (reportFilters.opportunity_id && !reportFilterOptions.value.opportunities.some((item) => String(item.value) === String(reportFilters.opportunity_id))) reportFilters.opportunity_id = ''
    } catch (value) {
      if (showReport.value) reportFilterOptionsError.value = directoryErrorMessage(value)
    } finally {
      reportFilterOptionsLoading.value = false
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
