const DB_NAME = 'project-management-field-operations'
const STORE_NAME = 'operations'
const DB_VERSION = 2

function database() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('当前浏览器不支持离线作业队列')); return }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? request.transaction.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      if (!store.indexNames.contains('ownerKey')) store.createIndex('ownerKey', 'ownerKey', { unique: false })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('无法打开离线作业队列'))
  })
}

function transaction(mode, action) {
  return database().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode)
    const store = tx.objectStore(STORE_NAME)
    let result
    try { result = action(store) } catch (error) { db.close(); reject(error); return }
    tx.oncomplete = () => { db.close(); resolve(result?.result) }
    tx.onerror = () => { db.close(); reject(tx.error || new Error('离线作业队列写入失败')) }
    tx.onabort = tx.onerror
  }))
}

// 用途：原子保存现场作业并保留已知的未知结果，避免并发旧快照覆盖重试边界。
// 参数：operation 为当前账号的现场作业及最新载荷或失败信息。
// 返回值：实际保存的作业；打开或写入队列失败时拒绝 Promise。
export function saveFieldOperation(operation) {
  return transaction('readwrite', (store) => {
    const output = {}
    const request = store.get(operation.id)
    request.onsuccess = () => {
      const previous = request.result
      const current = { ...previous, ...operation, updatedAt: new Date().toISOString(),
        resultUncertain: Boolean(previous?.resultUncertain || operation.resultUncertain
          || (previous?.lastError && !previous.lastErrorStatus)) }
      store.put(current)
      output.result = current
    }
    return output
  })
}

export function removeFieldOperation(id) {
  return transaction('readwrite', (store) => store.delete(id))
}

// 用途：仅在事务内仍明确被拒绝且从未结果未知时移除签到，防止并发丢失原编号。
// 参数：id 为需要补正的签到操作编号。
// 返回值：确实移除返回 true；状态变化、未知或不存在返回 false；存储失败拒绝 Promise。
export function removeRejectedFieldOperation(id) {
  return transaction('readwrite', (store) => {
    const output = { result: false }
    const request = store.get(id)
    request.onsuccess = () => {
      const current = request.result
      if (current?.kind !== 'check-in' || current.lastErrorStatus !== 422 || current.resultUncertain) return
      store.delete(id)
      output.result = true
    }
    return output
  })
}

export async function listFieldOperations(ownerKey) {
  if (!ownerKey) return []
  const items = await transaction('readonly', (store) => store.index('ownerKey').getAll(ownerKey))
  return (Array.isArray(items) ? items : []).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
}

export async function countFieldOperations(ownerKey) {
  if (!ownerKey) return 0
  const count = await transaction('readonly', (store) => store.index('ownerKey').count(ownerKey))
  return Number(count || 0)
}

// 用途：逐项同步离线现场作业，保留文件回执和服务端失败状态以便安全重试。
// 参数：operations 为队列，submit 提交并更新 holder.current，remove 删除成功项，save 保存失败项，formatError 转换提示，onResult 接收逐项实测结果。
// 返回值：成功和失败条数；本地队列读写失败继续抛出，不冒充远端业务成功。
export async function processFieldQueue({ operations, submit, remove, save, formatError = (error) => String(error?.message || error || '同步失败'), onResult }) {
  let synced = 0
  let failed = 0
  for (const operation of Array.isArray(operations) ? operations : []) {
    const holder = { current: operation }
    let outcome
    try {
      await submit(operation, holder)
      await remove(operation.id)
      synced += 1
      outcome = { operation: holder.current, status: 'synced' }
    } catch (error) {
      failed += 1
      const status = Number(error?.status) || 0
      const current = { ...holder.current, lastError: formatError(error), lastErrorStatus: status,
        resultUncertain: Boolean(operation.resultUncertain || error?.outcomeUnknown || !status || status >= 500
          || (operation.lastError && !operation.lastErrorStatus)) }
      const persisted = await save(current)
      outcome = { operation: persisted?.id === current.id ? persisted : current, status: 'failed' }
    }
    onResult?.(outcome)
  }
  return { synced, failed }
}
