import { getCurrentScope, onScopeDispose } from 'vue'

// 作用域实例序号：让票据绑定创建它的作用域，跨实例的票据永远不互相匹配。
let scopeCounter = 0

/**
 * createRequestScope 创建“请求作用域”票据管理器，用于成对管理一次异步读取的
 * 发起与回写：切换业务对象或重复读取时，让在途旧响应整体失效，而不是逐字段比对。 *
 * 用法（组件 setup 内）：
 *   const scope = createRequestScope()                 // 组件卸载时自动失效
 *   const ticket = scope.begin(`USER:${userId}:${applicationCode}`) // 开启一次读取
 *   const access = await getApplicationAccess(userId, applicationCode)
 *   if (scope.isCurrent(ticket)) ...                   // 回写数据、错误与 finally 清理前先校验
 *   scope.invalidate()                                 // 切换对象 / 关闭弹窗时主动失效
 *
 * 规则：
 * - begin(contextKey) 的 contextKey 必须包含当前业务对象（如 user+application），
 *   返回本次请求票据 { scope, key, seq }。每次 begin 都会让既有票据失效——同一对象的
 *   重复读取只采纳最后一次（丢弃前一次结果），切到其他对象则旧请求整体作废。
 * - isCurrent(ticket) 仅当作用域未销毁、业务对象未切换且没有更新的 begin/invalidate
 *   时为 true。数据更新、错误更新和 finally 清理都必须先经它校验，避免旧请求返回
 *   污染新对象，或旧请求的 finally 关闭新请求的 loading。
 * - invalidate() 使当前所有票据失效；之后再次 begin 可正常使用（切对象不销毁作用域）。
 *   在 Vue 响应式作用域（组件 setup）内创建时，组件卸载会经 onScopeDispose 自动销毁
 *   作用域——此后所有票据（含新 begin）永久失效；无作用域环境（单元测试）需手动调用。
 *
 * @returns {{begin: (contextKey: string) => {scope: number, key: string, seq: number}, isCurrent: (ticket: {scope: number, key: string, seq: number} | null | undefined) => boolean, invalidate: () => void}}
 */
export function createRequestScope() {
  const scopeId = ++scopeCounter
  let currentKey = ''
  let currentSeq = 0
  let disposed = false

  function begin(contextKey) {
    currentKey = String(contextKey ?? '')
    currentSeq += 1
    return { scope: scopeId, key: currentKey, seq: currentSeq }
  }

  function isCurrent(ticket) {
    if (disposed || !ticket || typeof ticket !== 'object' || ticket.scope !== scopeId) return false
    return ticket.key === currentKey && Number(ticket.seq) === currentSeq
  }

  function invalidate() {
    currentKey = ''
    currentSeq += 1
  }

  if (getCurrentScope()) onScopeDispose(() => { disposed = true })

  return { begin, isCurrent, invalidate }
}
