function isTrue(value) {
  return value === true || value === 1 || String(value || '').trim().toLowerCase() === 'true'
}

// A forward-only migration marks historical package-independent seed environments before it
// attempts physical deletion. Older installations may need to retain the DB row because audit,
// OAuth or configuration evidence references it; those retired rows must not reappear as a
// deployable environment in the production onboarding console.
export function isHiddenFromSubsystemOnboarding(environment) {
  return isTrue(environment?.metadata?.hidden_from_onboarding)
}

export function visibleSubsystemEnvironments(environments) {
  return (Array.isArray(environments) ? environments : []).filter((environment) => !isHiddenFromSubsystemOnboarding(environment))
}
