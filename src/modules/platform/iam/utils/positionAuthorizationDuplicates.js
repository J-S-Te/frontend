function normalizedId(value) {
  return String(value ?? '').trim()
}

function itemId(item, ...keys) {
  for (const key of keys) {
    const value = normalizedId(item?.[key])
    if (value) return value
  }
  return ''
}

function active(item) {
  const status = normalizedId(item?.status).toUpperCase()
  return !status || status === 'ACTIVE'
}

function timeBoundary(value, fallback) {
  if (!value) return fallback
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

// 用途：计算模板、岗位映射和角色条目从当前时刻起的有效期交集。
// 参数：template 为模板，role 为条目，assignment 为映射，now 为当前毫秒时间。
// 返回值：尚未到期的交集起止时间；无交集或已到期时返回 null。
function effectiveRange(template, role, assignment, now) {
  const start = Math.max(
    now,
    timeBoundary(template?.valid_from, Number.NEGATIVE_INFINITY),
    timeBoundary(assignment?.valid_from, Number.NEGATIVE_INFINITY),
    timeBoundary(role?.valid_from, Number.NEGATIVE_INFINITY),
  )
  const end = Math.min(
    timeBoundary(template?.valid_until, Number.POSITIVE_INFINITY),
    timeBoundary(assignment?.valid_until, Number.POSITIVE_INFINITY),
    timeBoundary(role?.valid_until, Number.POSITIVE_INFINITY),
  )
  return end > start ? { start, end } : null
}

function rangesOverlap(left, right) {
  return left.start < right.end && right.start < left.end
}

function roleItems(template) {
  return Array.isArray(template?.roles) ? template.roles : []
}

// 用途：检查岗位所选模板在未过期时间窗内是否重复授予相同应用角色与范围。
// 参数：templates 为模板目录，selectedTemplateIds 为勾选 ID；
//   options.assignments 为已有岗位映射，options.now 为当前毫秒时间，默认读取当前时钟。
// 返回值：查重计数、重复来源与不可用模板，不修改输入或阻止保存。
export function inspectPositionTemplateDuplicates(
  templates,
  selectedTemplateIds,
  { assignments = [], now = Date.now() } = {},
) {
  const templateList = Array.isArray(templates) ? templates : []
  const selectedIds = [...new Set((Array.isArray(selectedTemplateIds) ? selectedTemplateIds : []).map(normalizedId).filter(Boolean))]
  const byTemplateId = new Map(templateList.map((template) => [itemId(template, 'template_id', 'id'), template]))
  const missingTemplateIds = selectedIds.filter((templateId) => !byTemplateId.has(templateId))
  const selectedTemplates = selectedIds.map((templateId) => byTemplateId.get(templateId)).filter(Boolean)
  const byAssignedTemplateId = new Map(
    (Array.isArray(assignments) ? assignments : []).map((assignment) => [
      itemId(assignment?.template, 'template_id', 'id') || itemId(assignment, 'template_id'),
      assignment,
    ]),
  )
  const occurrencesByKey = new Map()
  const emptyTemplates = []
  let checkedRoleCount = 0

  selectedTemplates.forEach((template) => {
    let eligibleRoleCount = 0
    // 尚未保存的新勾选没有映射期限，与页面保存时的长期默认值保持一致。
    const assignment = byAssignedTemplateId.get(itemId(template, 'template_id', 'id'))
    if (active(template)) {
      roleItems(template).forEach((role) => {
        if (!active(role)) return
        const applicationId = itemId(role, 'application_id', 'applicationId')
        const roleId = itemId(role, 'role_id', 'roleId', 'id')
        const scopeType = normalizedId(role?.scope_type || role?.scopeType || 'TENANT').toUpperCase() || 'TENANT'
        const scopeId = scopeType === 'ENVIRONMENT' ? normalizedId(role?.scope_id || role?.scopeId) : ''
        const range = effectiveRange(template, role, assignment, now)
        if (!applicationId || !roleId || !range) return
        const key = `${applicationId}|${roleId}|${scopeType}|${scopeId}`
        const occurrence = {
          template_id: itemId(template, 'template_id', 'id'),
          template_name: template?.name || template?.code || itemId(template, 'template_id', 'id'),
          application_id: applicationId,
          application_name: role?.application_name || role?.application_code || applicationId,
          role_id: roleId,
          role_name: role?.role_name || role?.role_code || roleId,
          scope_type: scopeType,
          scope_id: scopeId,
          range,
        }
        if (!occurrencesByKey.has(key)) occurrencesByKey.set(key, [])
        occurrencesByKey.get(key).push(occurrence)
        eligibleRoleCount += 1
        checkedRoleCount += 1
      })
    }
    if (!eligibleRoleCount) {
      emptyTemplates.push({
        template_id: itemId(template, 'template_id', 'id'),
        template_name: template?.name || template?.code || itemId(template, 'template_id', 'id'),
      })
    }
  })

  const duplicates = []
  for (const [key, occurrences] of occurrencesByKey) {
    const overlapping = new Set()
    for (let left = 0; left < occurrences.length; left += 1) {
      for (let right = left + 1; right < occurrences.length; right += 1) {
        if (rangesOverlap(occurrences[left].range, occurrences[right].range)) {
          overlapping.add(left)
          overlapping.add(right)
        }
      }
    }
    if (!overlapping.size) continue
    const sources = [...overlapping].map((index) => occurrences[index])
    const sample = sources[0]
    duplicates.push({
      key,
      application_id: sample.application_id,
      application_name: sample.application_name,
      role_id: sample.role_id,
      role_name: sample.role_name,
      scope_type: sample.scope_type,
      scope_id: sample.scope_id,
      templates: sources.map((source) => ({ template_id: source.template_id, template_name: source.template_name })),
    })
  }

  duplicates.sort((left, right) => `${left.application_name}/${left.role_name}`.localeCompare(`${right.application_name}/${right.role_name}`, 'zh-CN'))
  return {
    selected_template_count: selectedIds.length,
    checked_role_count: checkedRoleCount,
    unique_role_count: occurrencesByKey.size,
    duplicate_group_count: duplicates.length,
    duplicate_assignment_count: duplicates.reduce((total, duplicate) => total + Math.max(0, duplicate.templates.length - 1), 0),
    duplicates,
    missing_template_ids: missingTemplateIds,
    empty_templates: emptyTemplates,
  }
}
