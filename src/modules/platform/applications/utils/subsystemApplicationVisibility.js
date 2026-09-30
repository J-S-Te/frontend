const platformApplicationCodes = new Set(['platform', 'basic_platform'])

function normalizedCode(value) {
  return String(value || '').trim().toLowerCase()
}

export function isPlatformApplication(application) {
  return platformApplicationCodes.has(normalizedCode(application?.code))
}

// Production delivery assets contain every reviewed subsystem manifest so a later incremental
// package can be adopted without replacing the deployment scripts. That allow-list is broader
// than the current delivery: only prepared targets (plus applications that already own a visible
// environment) belong in the application registry UI.
export function visibleSubsystemApplications(applications, options = {}) {
  const items = Array.isArray(applications) ? applications : []
  if (!options.capabilitiesResolved || options.capabilitiesAvailable === false) {
    return items.filter(isPlatformApplication)
  }
  if (!options.production) return items

  const visibleCodes = new Set(platformApplicationCodes)
  for (const value of options.supportedApplicationCodes || []) {
    const code = normalizedCode(value)
    if (code) visibleCodes.add(code)
  }
  for (const value of options.registeredApplicationCodes || []) {
    const code = normalizedCode(value)
    if (code) visibleCodes.add(code)
  }
  return items.filter((application) => visibleCodes.has(normalizedCode(application?.code)))
}
