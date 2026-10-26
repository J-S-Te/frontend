// Shared dirty-form detection. Keeping this independent of Vue makes it usable in
// editors and directly testable without mounting a component.
export function canonicalValue(value) {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonicalValue)
  const result = {}
  for (const key of Object.keys(value).sort()) {
    const item = value[key]
    if (typeof item === 'function' || typeof item === 'undefined') continue
    result[key] = canonicalValue(item)
  }
  return result
}

export function createFormSnapshot(value) {
  return JSON.stringify(canonicalValue(value))
}

export function hasUnsavedChanges(initialSnapshot, currentValue) {
  return typeof initialSnapshot === 'string' && initialSnapshot !== createFormSnapshot(currentValue)
}
