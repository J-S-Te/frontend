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

export function saveFieldOperation(operation) {
  return transaction('readwrite', (store) => store.put({ ...operation, updatedAt: new Date().toISOString() }))
}

export function removeFieldOperation(id) {
  return transaction('readwrite', (store) => store.delete(id))
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

/**
 * 逐项隔离失败，处理排队的离线现场操作列表。
 * `submit(operation, holder)` 必须在文件上传成功后推进 `holder.current`，
 * 以便事件请求失败后复用已有产物重试，避免重复上传同一证据。
 *
 * @returns {Promise<{synced:number, failed:number}>}
 */
export async function processFieldQueue({ operations, submit, remove, save, formatError = (error) => String(error?.message || error || '同步失败') }) {
  let synced = 0
  let failed = 0
  for (const operation of Array.isArray(operations) ? operations : []) {
    const holder = { current: operation }
    try {
      await submit(operation, holder)
      await remove(operation.id)
      synced += 1
    } catch (error) {
      failed += 1
      await save({ ...holder.current, lastError: formatError(error) })
    }
  }
  return { synced, failed }
}
