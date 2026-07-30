export function defaultAccountValidUntil(now = new Date()) {
  const date = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const localOffset = date.getTimezoneOffset() * 60 * 1000
  return new Date(date.getTime() - localOffset).toISOString().slice(0, 16)
}

export function defaultEmployeeOnboardingForm(now = new Date()) {
  return {
    display_name: '',
    email: '',
    mobile: '',
    status: 'ACTIVE',
    create_account: true,
    account_name: '',
    initial_password: '',
    validity_mode: 'TEMPORARY',
    valid_until: defaultAccountValidUntil(now),
    create_membership: true,
    org_unit_id: '',
    position_id: '',
    membership_type: 'PRIMARY',
    membership_validity_mode: 'LONG_TERM',
    effective_from: '',
    effective_to: '',
    inherit_authorization: true,
  }
}

export function positionOptionsForOrganization(positions = [], orgUnitId = '') {
  if (!orgUnitId) return []
  return positions.filter((item) => (item?.org_unit_id || item?.organization_id || '') === orgUnitId)
}

export function resolveOnboardingExpiresAt(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function buildEmployeeOnboardingPayload(form, { account, user } = {}) {
  const createAccount = form?.create_account !== false
  const createMembership = form?.create_membership !== false
  const temporaryAccount = form?.validity_mode !== 'PERMANENT'
  const shortTermMembership = form?.membership_validity_mode === 'SHORT_TERM'

  return {
    user: user || {
      display_name: String(form?.display_name || '').trim(),
      email: optionalText(form?.email),
      mobile: optionalText(form?.mobile),
      status: form?.status || 'ACTIVE',
    },
    account: createAccount
      ? (account || {
        account_name: String(form?.account_name || '').trim(),
        initial_password: String(form?.initial_password || ''),
        valid_until: temporaryAccount ? resolveOnboardingExpiresAt(form?.valid_until) : null,
      })
      : null,
    membership: createMembership
      ? {
        org_unit_id: form?.org_unit_id || '',
        position_id: form?.position_id || '',
        membership_type: form?.membership_type || 'PRIMARY',
        effective_from: shortTermMembership ? (form?.effective_from || null) : null,
        effective_to: shortTermMembership ? (form?.effective_to || null) : null,
        inherit_authorization: form?.inherit_authorization !== false,
      }
      : null,
  }
}

function optionalText(value) {
  const normalized = String(value ?? '').trim()
  return normalized || null
}
