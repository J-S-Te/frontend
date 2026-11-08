import { onScopeDispose, ref, watch } from 'vue'
import { formatUserError } from '../../shared/utils/userError.js'

// 用途：为「按需读取」的辅助数据建立统一的 loading/error/confirmed 读取态。
// 设计约束（阶段 2）：
//   1) 同一隔离代次的并发读取复用同一个 Promise，不重复打服务端；
//   2) 失败不缓存——confirmed 不置位，重试入口与下一次使用都会重新发起；
//   3) 换用户/租户/授权代次（context 变化）或组件销毁后，旧请求不得回写 data/error/loading。
// 参数：context 为隔离键（租户/用户/授权代次），loader 为读取函数，apply 发布成功数据，
//      reset 清除本资源数据，describe 把异常转成用户文案。
// 返回值：load/ensure/retry/invalidate 入口与 loading/error/confirmed 状态。
export function useProjectAuxiliaryResource({ context, loader, apply, reset = () => {}, describe }) {
  const loading = ref(false)
  const error = ref('')
  // confirmed 表示「当前隔离键下已经成功读取过」，只有成功才置位；失败因此不会被当成已缓存。
  const confirmed = ref(false)
  let generation = 0
  let pending = null
  let disposed = false

  const toMessage = (cause, fallback) => describe
    ? describe(cause, fallback)
    : formatUserError(cause, { fallback })

  // 用途：使在途读取失效（维护成功、显式刷新或隔离键变化）。
  // 参数：keepData 控制是否保留已显示的数据；默认保留，由界面同时标明「待重新确认」。
  // 返回值：无；旧代次此后不得发布 data/error/loading。
  function invalidate({ keepData = true } = {}) {
    generation += 1
    pending = null
    loading.value = false
    confirmed.value = false
    error.value = ''
    if (!keepData) reset()
  }

  // 用途：读取一次；同代并发调用复用同一个 Promise。
  // 参数：force 为 true 时跳过已确认状态重新读取。
  // 返回值：成功为 true；失败、旧代次或已销毁为 false。
  async function load({ force = false } = {}) {
    if (disposed) return false
    if (!force && confirmed.value) return true
    if (pending) return pending
    const ticket = generation
    loading.value = true
    error.value = ''
    pending = Promise.resolve().then(() => loader()).then((data) => {
      if (disposed || ticket !== generation) return false
      apply(data)
      confirmed.value = true
      error.value = ''
      return true
    }).catch((cause) => {
      if (disposed || ticket !== generation) return false
      error.value = toMessage(cause, '辅助数据读取失败，请重试。')
      return false
    }).finally(() => {
      if (!disposed && ticket === generation) { loading.value = false; pending = null }
    })
    return pending
  }

  // 用途：使用方进入相关区域或打开候选选择器时按需读取。
  // 参数：options 透传给 load（例如维护成功后用 force 重新确认）；已确认的数据直接复用。
  // 返回值：同 load 的 Promise<boolean>。
  function ensure(options = {}) { return load(options) }

  // 用途：失败或显式刷新后的重试入口；强制重新读取，不复用任何缓存。
  // 参数：无。
  // 返回值：同 load 的 Promise<boolean>。
  function retry() { return load({ force: true }) }

  // 用途：组件销毁时让在途请求失效，且不再写任何响应式状态。
  // 参数：无。
  // 返回值：无。
  function dispose() {
    disposed = true
    generation += 1
    pending = null
    loading.value = false
  }

  watch(context, () => { invalidate({ keepData: false }) }, { flush: 'sync' })
  onScopeDispose(dispose)
  return { loading, error, confirmed, load, ensure, retry, invalidate, dispose }
}
