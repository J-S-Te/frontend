function normalizedContact(contact) {
  return {
    id: Number(contact?.id || 0),
    name: String(contact?.name || '').trim(),
    phone: String(contact?.phone || '').trim(),
    email: String(contact?.email || '').trim().toLowerCase(),
    is_registration: Boolean(contact?.is_registration),
  }
}

/**
 * Retains an outcome-ambiguous Portal provisioning command for this page
 * lifetime. The key is never written to storage and is removed only after the
 * CRM confirms that the complete provisioning Saga and invite transaction
 * succeeded.
 */
export function createPortalInviteRetryState(createKey) {
  const pending = new Map()

  function keyFor(customerID, contact) {
    const command = { customer_id: Number(customerID), contact: normalizedContact(contact) }
    const signature = JSON.stringify(command)
    if (!pending.has(signature)) pending.set(signature, createKey())
    return { key: pending.get(signature), signature, command }
  }

  function confirmSuccess(signature, key) {
    if (pending.get(signature) === key) pending.delete(signature)
  }

  return { keyFor, confirmSuccess }
}

