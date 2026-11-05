import { onScopeDispose, ref } from 'vue'
import { requireActionLabel } from '../utils/actionLabel.js'

// usePromptDialog 管理需要输入信息的操作弹窗及取消生命周期。
// 参数：无。
// 返回值：弹窗状态、异步打开方法、提交方法及取消方法。
export function usePromptDialog() {
  const dialog = ref(null)
  let resolver = null
  let generation = 0

  // settle 结束当前输入请求，先清理状态再通知调用方。
  // 参数：value 为输入内容或表示取消的 null。
  // 返回值：无。
  function settle(value) {
    const resolve = resolver
    resolver = null
    dialog.value = null
    resolve?.(value)
  }

  onScopeDispose(() => settle(null))

  // askPrompt 打开操作输入框，并取消被替换的旧请求。
  // 参数：options 为标题、明确动作按钮及单输入或多字段配置。
  // 返回值：输入结果的 Promise；关闭或宿主销毁时返回 null。
  function askPrompt(options) {
    const confirmText = requireActionLabel(options?.confirmText)
    if (resolver) settle(null)
    dialog.value = { ...options, confirmText, key: ++generation }
    return new Promise((resolve) => { resolver = resolve })
  }

  // accept 把用户填写的结果交给当前操作。
  // 参数：value 为单输入字符串或按字段名称组织的对象。
  // 返回值：无。
  function accept(value) {
    settle(value)
  }

  // cancel 关闭输入框且不执行操作。
  // 参数：无。
  // 返回值：无。
  function cancel() {
    settle(null)
  }

  return { dialog, askPrompt, accept, cancel }
}
