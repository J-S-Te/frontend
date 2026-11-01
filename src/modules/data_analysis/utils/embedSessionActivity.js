const INPUTS = new Set(['pointerdown', 'pointermove', 'keydown', 'input', 'compositionend', 'touchstart', 'wheel'])

// createEmbedSessionActivity 校验隔离看板的来源、窗口和本代随机通道，再转发真实操作。
// 参数：options包含当前iframe和URL读取器、活动回调、页面对象和随机源。
// 返回值：iframe加载初始化、失效和销毁接口；不持有认证令牌。
export function createEmbedSessionActivity({ getFrame, getURL, onActivity,
  windowRef = globalThis.window, documentRef = globalThis.document, cryptoImpl = globalThis.crypto }) {
  let current = null

  // reset 使旧看板文档和迟到消息失效。
  // 参数：无。
  // 返回值：无。
  function reset() { current = null }

  // onMessage 校验当前文档的单调交互序号，拒绝其他来源、旧代次及后台信号。
  // 参数：event为浏览器跨窗口消息。
  // 返回值：无。
  function onMessage(event) {
    const data = event.data
    if (!current || current.frame !== getFrame() || current.url !== getURL() || event.source !== current.frame.contentWindow
      || event.origin !== current.origin || documentRef.visibilityState !== 'visible'
      || data?.type !== 'platform-session:activity' || data.nonce !== current.nonce
      || !INPUTS.has(data.input) || !Number.isSafeInteger(data.sequence) || data.sequence <= current.sequence) return
    current.sequence = data.sequence
    onActivity?.()
  }
  windowRef.addEventListener('message', onMessage)

  return {
    reset,
    // initialize 仅向当前加载完成的隔离iframe发送一次随机通道挑战。
    // 参数：frame为load事件对应元素，必须仍为当前iframe。
    // 返回值：无；加载本身不会报告活动。
    initialize(frame) {
      if (!frame?.contentWindow || frame !== getFrame()) return
      const url = new URL(getURL())
      if (frame.src !== url.href) return
      reset()
      const origin = url.origin
      const bytes = cryptoImpl.getRandomValues(new Uint8Array(32))
      const nonce = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
      current = { frame, origin, url: url.href, nonce, sequence: 0 }
      frame.contentWindow.postMessage({ type: 'platform-session:init', nonce }, origin)
    },
    // destroy 解除消息监听并使全部旧代次失效。
    // 参数：无。
    // 返回值：无。
    destroy() { reset(); windowRef.removeEventListener('message', onMessage) },
  }
}
