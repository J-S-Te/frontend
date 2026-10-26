// 多弹窗共享的 body 滚动锁：按计数配对 acquire/release，归零才恢复滚动。
// 修复前 ConfirmDialog/PromptDialog 各自直接置 overflow，两弹窗叠加时先关者
// 会把滚动错误地恢复（后关者仍在展示但页面已可滚动）。

let depth = 0
let previousOverflow = ''

export function acquireBodyScrollLock() {
  if (typeof document === 'undefined') return
  if (depth === 0) {
    previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  depth += 1
}

export function releaseBodyScrollLock() {
  if (typeof document === 'undefined' || depth === 0) return
  depth -= 1
  if (depth === 0) document.body.style.overflow = previousOverflow
}

// 仅测试使用：重置内部计数状态；不触碰 body 样式（现场由测试自行准备）。
export function resetBodyScrollLockForTest() {
  depth = 0
  previousOverflow = ''
}
