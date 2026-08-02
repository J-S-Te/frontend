function text(value) {
  return String(value ?? '').trim()
}

function normalizedCreatePayload(payload) {
  return {
    file_name: text(payload?.file_name),
    size_bytes: Number(payload?.size_bytes),
    mime_type: text(payload?.mime_type).toLowerCase(),
    sha256: text(payload?.sha256).toLowerCase(),
  }
}

/**
 * Keeps an attachment upload's ambiguous create and complete commands stable
 * for this page lifetime. No key, file fingerprint, or upload session is
 * written to browser storage.
 */
export function createAttachmentUploadRetryState(createKey) {
  const entries = new Map()

  function flowFor(opportunityID, payload) {
    const normalized = normalizedCreatePayload(payload)
    const fingerprint = JSON.stringify({ opportunity_id: Number(opportunityID), payload: normalized })
    let entry = entries.get(fingerprint)
    if (!entry) {
      entry = { fingerprint, opportunityID: Number(opportunityID), payload: normalized, createKey: createKey(), session: null, uploaded: false, completeKey: '' }
      entries.set(fingerprint, entry)
    }
    return entry
  }

  function confirmCreate(flow, session) {
    const current = entries.get(flow?.fingerprint)
    if (current !== flow) return
    current.session = session
    current.completeKey ||= createKey()
  }

  function markUploaded(flow) {
    const current = entries.get(flow?.fingerprint)
    if (current === flow) current.uploaded = true
  }

  function confirmComplete(flow) {
    if (entries.get(flow?.fingerprint) === flow) entries.delete(flow.fingerprint)
  }

  return { flowFor, confirmCreate, markUploaded, confirmComplete }
}
