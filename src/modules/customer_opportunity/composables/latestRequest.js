/**
 * Small request-generation guard for views that cannot cancel an in-flight
 * request. A completed request may mutate state only when it is still the
 * latest generation.
 */
export function createLatestRequestGuard() {
  let generation = 0

  return {
    begin() {
      generation += 1
      return generation
    },
    isCurrent(candidate) {
      return candidate === generation
    },
    invalidate() {
      generation += 1
      return generation
    },
  }
}
