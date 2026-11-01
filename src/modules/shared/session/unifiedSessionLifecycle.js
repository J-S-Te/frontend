// scrollTo等程序滚动也会产生可信scroll事件；仅记录真实滚轮、按键和指针输入。
const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'input', 'compositionend', 'touchstart', 'wheel']
const INPUT_OPTIONS = { capture: true, passive: true }
const POLL_MS = 30000
const TOUCH_MS = 20000
const REQUEST_TIMEOUT_MS = 8000

// sessionIdentity 标识服务端绑定的原始登录，策略更新不视为切换账号。
// 参数：context为服务端返回的统一会话上下文。
// 返回值：租户、主体和原始会话的组合键。
function sessionIdentity(context) {
  return JSON.stringify([context.session_id, context.tenant_id, context.subject_id])
}

// validateContext 校验权威剩余时间，拒绝以浏览器当前时间重建登录期限。
// 参数：context为平台或子系统返回的统一会话上下文。
// 返回值：合法上下文；协议异常抛出可重试的503错误。
function validateContext(context) {
  const valid = context && ['session_id', 'tenant_id', 'subject_id'].every(key =>
    typeof context[key] === 'string' && context[key].length > 0)
    && Number.isInteger(context.policy_version) && context.policy_version > 0
    && Number.isFinite(context.idle_timeout_seconds) && context.idle_timeout_seconds > 0
    && context.idle_timeout_seconds <= 1800
    && Number.isFinite(context.idle_remaining_ms) && context.idle_remaining_ms >= 0
    && context.idle_remaining_ms <= context.idle_timeout_seconds * 1000
    && Number.isFinite(context.absolute_remaining_ms) && context.absolute_remaining_ms >= 0
    && context.absolute_remaining_ms <= 28800000
    && context.idle_remaining_ms <= context.absolute_remaining_ms
    && Number.isFinite(Date.parse(context.absolute_expires_at))
  if (!valid) throw Object.assign(new Error('统一会话状态暂不可用'), { status: 503 })
  return context
}

// createUnifiedSessionLifecycle 按当前路由维护唯一活动时钟，期限始终取自基础平台。
// 参数：dependencies包含只读查询、真实交互代理、页面对象、时钟及状态回调。
// 返回值：路由切换、只读校准、嵌入交互和销毁接口。
export function createUnifiedSessionLifecycle({ read, activity, onEnded, onError,
  onIdentityChanged, windowRef = globalThis.window, documentRef = globalThis.document,
  clock = { now: () => performance.now(), setTimeout, clearTimeout } }) {
  let target = null
  let context = null
  let generation = 0
  let busy = null
  let pollTimer = null
  let touchTimer = null
  let nextTouchAt = 0
  let pendingActivity = false
  let failures = 0
  let destroyed = false

  // clearTimers 清除当前路由的校准和节流任务。
  // 参数：无。
  // 返回值：无。
  function clearTimers() {
    clock.clearTimeout(pollTimer); clock.clearTimeout(touchTimer)
    pollTimer = null; touchTimer = null
  }

  // stop 失效旧请求并停止当前路由，避免迟到回包覆盖新身份。
  // 参数：无。
  // 返回值：无。
  function stop() {
    generation += 1
    clearTimers()
    busy?.controller.abort()
    target = null; context = null; busy = null
    pendingActivity = false; nextTouchAt = 0; failures = 0
  }

  // scheduleProbe 安排只读校准；后台轮询不会发送活动信号。
  // 参数：delay为下次校准的毫秒延迟。
  // 返回值：无。
  function scheduleProbe(delay) {
    clock.clearTimeout(pollTimer)
    if (target && !destroyed) pollTimer = clock.setTimeout(() => { void execute('state') }, delay)
  }

  // finish 仅在权威确认失效时结束当前路由，不调用账号全局登出。
  // 参数：reason为失效原因。
  // 返回值：无。
  function finish(reason) {
    const endedTarget = target
    if (!endedTarget) return
    stop()
    onEnded?.(reason, endedTarget)
  }

  // flushActivity 消费实际交互产生的待发信号，不生成定时心跳。
  // 参数：无。
  // 返回值：无。
  function flushActivity() {
    clock.clearTimeout(touchTimer); touchTimer = null
    if (!target || !pendingActivity || busy || failures > 0 || !context) return
    if (documentRef?.visibilityState !== 'visible') { pendingActivity = false; return }
    const delay = nextTouchAt - clock.now()
    if (delay > 0) touchTimer = clock.setTimeout(flushActivity, delay)
    else void execute('activity')
  }

  // execute 串行处理状态和活动请求，超时后释放槽位并保留编辑状态。
  // 参数：kind为state只读校准或activity真实交互。
  // 返回值：请求处理完成的Promise；临时失败交由有界退避重试。
  async function execute(kind) {
    if (!target || busy || destroyed) return
    clock.clearTimeout(pollTimer)
    const slot = { generation, controller: new AbortController(), target, started: clock.now() }
    busy = slot
    if (kind === 'activity') pendingActivity = false
    let timeout
    try {
      const timedOut = new Promise((_, reject) => {
        timeout = clock.setTimeout(() => {
          slot.controller.abort()
          reject(Object.assign(new Error('统一会话查询超时'), { status: 503 }))
        }, REQUEST_TIMEOUT_MS)
      })
      const operation = kind === 'activity' ? activity : read
      const response = await Promise.race([
        Promise.resolve().then(() => operation(slot.target, { signal: slot.controller.signal })), timedOut,
      ])
      if (slot.generation !== generation) return
      const next = validateContext(response)
      if (context && sessionIdentity(context) !== sessionIdentity(next)) {
        const previous = context
        stop()
        onIdentityChanged?.(previous, next, slot.target)
        return
      }
      context = next; failures = 0
      if (next.idle_remaining_ms === 0 || next.absolute_remaining_ms === 0) { finish('expired'); return }
      if (kind === 'activity') nextTouchAt = slot.started + TOUCH_MS
      const remaining = Math.min(next.idle_remaining_ms, next.absolute_remaining_ms)
        - (clock.now() - slot.started)
      scheduleProbe(Math.min(POLL_MS, Math.max(100, remaining)))
    } catch (error) {
      if (slot.generation !== generation) return
      if (error?.status === 401) { finish('unauthenticated'); return }
      failures += 1
      onError?.(error, slot.target)
      scheduleProbe(Math.min(POLL_MS, 1000 * 2 ** Math.min(failures - 1, 5)))
    } finally {
      clock.clearTimeout(timeout)
      if (busy === slot) { busy = null; flushActivity() }
    }
  }

  // noteActivity 标记可见页面的真实操作，节流期间仅保留一个待发信号。
  // 参数：无；嵌入页面必须先由调用方验证来源、窗口及本代nonce。
  // 返回值：无。
  function noteActivity() {
    if (!target || documentRef?.visibilityState !== 'visible') return
    pendingActivity = true
    flushActivity()
  }

  // onInput 拒绝脚本合成事件，捕获内层滚动、输入法及PDF画布操作。
  // 参数：event为浏览器产生的输入事件。
  // 返回值：无。
  function onInput(event) { if (event.isTrusted === true) noteActivity() }

  // calibrate 在切回页面时只读核对，隐藏页面丢弃尚未发出的交互。
  // 参数：无。
  // 返回值：无。
  function calibrate() {
    if (documentRef?.visibilityState !== 'visible') {
      pendingActivity = false; clock.clearTimeout(touchTimer); touchTimer = null
    } else void execute('state')
  }

  INPUT_EVENTS.forEach(name => windowRef?.addEventListener(name, onInput, INPUT_OPTIONS))
  windowRef?.addEventListener('focus', calibrate)
  documentRef?.addEventListener?.('visibilitychange', calibrate)

  return {
    // setTarget 切换独立Cookie入口，保留同一入口内页面跳转的权威期限。
    // 参数：next为路由对应入口或公开页的null。
    // 返回值：首次状态校准的Promise。
    async setTarget(next) {
      if (destroyed || target?.key === next?.key) return
      stop(); target = next
      if (target) await execute('state')
    },
    stop,
    recordEmbeddedActivity: noteActivity,
    probe: () => execute('state'),
    // destroy 释放页面监听、请求和定时器。
    // 参数：无。
    // 返回值：无。
    destroy() {
      stop(); destroyed = true
      INPUT_EVENTS.forEach(name => windowRef?.removeEventListener(name, onInput, INPUT_OPTIONS))
      windowRef?.removeEventListener('focus', calibrate)
      documentRef?.removeEventListener?.('visibilitychange', calibrate)
    },
  }
}
