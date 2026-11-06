// 全局提示总线：把"没人接住"的错误变成界面上的一条提示。
//
// 与各业务视图的 showToast 是两条独立通道：
//   - 业务视图接住的错误 → 各自本地 showToast → OperationToast（有业务上下文，文案精准）；
//   - 谁都没接住的错误（unhandledrejection / window error / 路由失败）→ 这里。
// 两条通道不共享状态，所以不会出现同一个错误弹两次；边界组件也会返回 false
// 把错误留在边界内，不再进这条通道。
import { ref } from 'vue'
import { createToastQueue } from './toastQueue.js'

/**
 * 创建一个带 Vue 响应式可见列表的提示总线。
 * @param {object} options 见 toastQueue 的限额；另可注入 now/schedule/cancel 便于测试。
 * @returns {{items: import('vue').Ref<object[]>, limits: object, push: Function, dismiss: Function, clear: Function, sweep: Function}}
 */
export function createGlobalToastBus(options = {}) {
  const queue = createToastQueue(options)
  const items = ref([])
  const timers = new Map()
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const schedule = typeof options.schedule === 'function'
    ? options.schedule
    : (callback, delay) => {
      const handle = setTimeout(callback, delay)
      // Node 环境下别让 6 秒的消失定时器把测试进程挂住；浏览器里 setTimeout 返回数字，无 unref。
      handle?.unref?.()
      return handle
    }
  const cancel = typeof options.cancel === 'function'
    ? options.cancel
    : (handle) => clearTimeout(handle)

  function disarm(id) {
    const handle = timers.get(id)
    if (handle === undefined) return
    cancel(handle)
    timers.delete(id)
  }

  function disarmAll() {
    for (const id of [...timers.keys()]) disarm(id)
  }

  function arm(item) {
    disarm(item.id)
    const delay = Math.max(0, item.expiresAt - now())
    timers.set(item.id, schedule(() => {
      timers.delete(item.id)
      dismiss(item.id)
    }, delay))
  }

  function publish(list) {
    items.value = list
  }

  /**
   * 入列一条提示。
   * @param {{message: string, tone?: string, detail?: string, key?: string}} input
   * @param {number} at 当前时间戳
   * @returns {{accepted: boolean, reason: string, item: object|null, items: object[], dropped: object[]}}
   */
  function push(input, at = now()) {
    const result = queue.push(input, at)
    for (const dropped of result.dropped) disarm(dropped.id)
    if (result.accepted) {
      publish(result.items)
      arm(result.item)
    }
    return result
  }

  function dismiss(id) {
    disarm(id)
    publish(queue.dismiss(id))
    return items.value
  }

  function sweep(at = now()) {
    const next = queue.sweep(at)
    for (const id of [...timers.keys()]) {
      if (!next.some((item) => item.id === id)) disarm(id)
    }
    publish(next)
    return items.value
  }

  function clear() {
    disarmAll()
    publish(queue.clear())
    return items.value
  }

  return { items, limits: queue.limits, push, dismiss, sweep, clear }
}

// 全应用一个实例：故障态下任何模块都能找到同一条通道。
export const globalToastBus = createGlobalToastBus()

/** 给 installGlobalErrorHandlers 的默认落地：直接进全局提示总线。 */
export function notifyGlobalError(payload) {
  return globalToastBus.push(payload)
}
