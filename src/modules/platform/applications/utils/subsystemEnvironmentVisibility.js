function isTrue(value) {
  return value === true || value === 1 || String(value || '').trim().toLowerCase() === 'true'
}

// 仅向前执行的迁移会先标记历史上不依赖交付包的种子环境，
// 再尝试物理删除。旧安装可能因审计、
// OAuth 或配置证据的引用而需要保留数据库记录；这些已退役记录
// 不得在生产接入控制台中重新显示为可部署环境。
export function isHiddenFromSubsystemOnboarding(environment) {
  return isTrue(environment?.metadata?.hidden_from_onboarding)
}

export function visibleSubsystemEnvironments(environments) {
  return (Array.isArray(environments) ? environments : []).filter((environment) => !isHiddenFromSubsystemOnboarding(environment))
}
