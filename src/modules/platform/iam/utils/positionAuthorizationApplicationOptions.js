// 岗位授权模板追加子系统下拉选项。
// 已选应用不能再次出现在其他行的选项中；当前行保留自己的值，避免编辑旧模板时
// 因选项被过滤而显示空白。
function normalizeApplicationId(value) {
  return String(value ?? '').trim()
}

export function applicationIdOf(application) {
  return normalizeApplicationId(application?.application_id ?? application?.id)
}

export function additionalApplicationOptions(applications, primaryApplicationId, additionalRoles, currentRow) {
  const selected = new Set()
  const primary = normalizeApplicationId(primaryApplicationId)
  if (primary) selected.add(primary)

  const rows = Array.isArray(additionalRoles) ? additionalRoles : []
  rows.forEach((row) => {
    if (row === currentRow) return
    const id = normalizeApplicationId(row?.application_id)
    if (id) selected.add(id)
  })

  const current = normalizeApplicationId(currentRow?.application_id)
  return (Array.isArray(applications) ? applications : []).filter((application) => {
    const id = applicationIdOf(application)
    if (!id) return false
    return id === current || !selected.has(id)
  })
}
