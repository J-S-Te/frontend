import { watch } from 'vue'

function queryValue(value) {
  if (Array.isArray(value)) return value.length ? String(value[0]) : ''
  return typeof value === 'string' ? value : ''
}

/**
 * Keep a small set of list filters in the route query so browser back/forward,
 * refresh and copied URLs restore the same working context.
 */
export function useUrlFilterState({ route, router, fields, onRestore, normalize, parse }) {
  const names = Object.keys(fields)

  function applyQuery(query, notify = true) {
    let changed = false
    for (const name of names) {
      const raw = queryValue(query?.[name])
      const normalized = normalize ? normalize(raw, name) : raw
      const next = parse ? parse(normalized, name) : normalized
      if (fields[name].value !== next) {
        fields[name].value = next
        changed = true
      }
    }
    if (changed && notify) onRestore?.()
  }

  function queryFromFields() {
    const query = { ...(route.query || {}) }
    for (const name of names) {
      const value = String(fields[name].value || '').trim()
      if (value) query[name] = value
      else delete query[name]
    }
    return query
  }

  applyQuery(route.query, false)
  watch(() => route.query, (query) => applyQuery(query))
  watch(names.map((name) => fields[name]), () => {
    const next = queryFromFields()
    const current = route.query || {}
    if (JSON.stringify(next) === JSON.stringify(current)) return
    Promise.resolve(router.replace({ query: next })).catch(() => {})
  })

  return { applyQuery }
}
