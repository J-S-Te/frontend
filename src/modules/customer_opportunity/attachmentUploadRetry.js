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
 * 上传由“创建会话—传输文件—确认完成”三段组成。这里按文件元数据和商机生成
 * 稳定流程，分别保留创建键与完成键，使任一阶段响应丢失后都能安全重试，且
 * 已上传文件无需再次传输。键、文件指纹和上传会话均不写入浏览器存储。
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
    // 完成命令必须有独立幂等键，不能复用创建会话的键；二者是不同服务端写操作。
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
