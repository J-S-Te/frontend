import { getCurrentScope, onScopeDispose } from 'vue'
import { subscribeRelatedDataChanges } from '../utils/relatedDataInvalidation.js'

/**
 * 在组件（或任何 副作用作用域）内订阅关联数据失效，并在作用域销毁时自动退订。
 *
 * 用法：
 *   useRelatedDataInvalidation((event) => { ... }, { kinds: [RELATED_DATA.POSITIONS] })
 *
 * 订阅方必须把通知当作“需要重新读取”的信号，而不是真的数据：只有读取成功后才能更新
 * 页面选项；读取失败要保留写入结果并给出重试入口。
 *
 * @param {(event: {type: string, kinds: string[], scope: string, epoch: number}) => void} handler
 * @param {{kinds?: string[]}} [options]
 * @returns {() => void} 退订函数；在无 Vue 作用域的环境（单元测试）中需手动调用。
 */
export function useRelatedDataInvalidation(handler, options = {}) {
  const unsubscribe = subscribeRelatedDataChanges(handler, options)
  if (getCurrentScope()) onScopeDispose(unsubscribe)
  return unsubscribe
}
