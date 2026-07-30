/**
 * Cross-component browser event emitted after the root application re-reads the
 * server-authoritative authenticated principal. The event never contains a token.
 *
 * Consumers must treat the supplied principal as display/navigation state only;
 * backend 401/403 responses remain the authorization authority for every action.
 */
export const AUTHORIZATION_REFRESHED_EVENT = 'platform-auth:authorization-refreshed'

export const AUTHORIZATION_REFRESH_INTERVAL_MS = 15 * 1000

export function principalFingerprint(principal) {
  if (!principal || typeof principal !== 'object') return ''

  const roles = Array.isArray(principal.roles)
    ? principal.roles
      .map((role) => String(role?.id || role?.code || role?.name || '').trim())
      .filter(Boolean)
      .sort()
    : []
  const permissions = Array.isArray(principal.permission_codes)
    ? principal.permission_codes.map((code) => String(code || '').trim()).filter(Boolean).sort()
    : []

  return JSON.stringify({
    tenant: String(principal.tenant?.id || ''),
    user: String(principal.user?.id || ''),
    account: String(principal.account?.id || ''),
    roles,
    permissions,
  })
}

export function dispatchAuthorizationRefreshed(principal, { changed = false } = {}) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(AUTHORIZATION_REFRESHED_EVENT, {
    detail: { principal, changed: Boolean(changed) },
  }))
}
