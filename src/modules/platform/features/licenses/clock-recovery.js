// 时钟恢复是授权页唯一能解除“时钟保护”的写操作，也是一次性凭据：
// 这里只放与界面无关的纯逻辑（门禁、文案、提交后的状态复位），便于脱离 DOM 验证。
// 交互约束：必须「勾选确认 + 显式提交」两步，任何一步缺失都不能发出请求。

export const CLOCK_RECOVERY_RISKS = Object.freeze([
  '恢复凭据由供应商签发，只能使用一次；提交后立即被消费，重复提交会被服务端拒绝。',
  '恢复只解除时间回拨保护，不会补发许可证、不会延长到期时间、也不会改变授权范围。',
  '凭据只在本次提交中使用，不写入浏览器存储、地址栏或日志；提交后输入框自动清空。',
])

export const CLOCK_RECOVERY_CONFIRMATION = '我已核对部署实例，并确认本次恢复凭据来源可信、只提交一次'

export const CLOCK_RECOVERY_SUCCESS = '恢复凭据已消费，不可重复使用；授权状态与事件已刷新。'

// 提交失败时不能假设服务端没有消费凭据，下一步必须先核对状态。
export const CLOCK_RECOVERY_FAILURE_NEXT = '先刷新授权状态确认凭据是否已被消费；如仍需恢复，请向供应商重新申请恢复凭据。'

export const CLOCK_RECOVERY_READONLY_HINT = '需要商业授权管理权限（platform:license:manage）才能提交恢复凭据，请联系授权管理员。'

const trimmed = value => (typeof value === 'string' ? value.trim() : '')

/**
 * clockRecoveryReady 用途：两步确认后的唯一提交门禁。
 * 参数：canManage 为写权限，raw 为粘贴的恢复凭据，confirmed 为显式勾选，busy 为写操作进行中。
 * 返回值：四项全部满足才允许提交；任一缺失都不发出请求。
 */
export function clockRecoveryReady({ canManage = false, raw = '', confirmed = false, busy = false } = {}) {
  return canManage === true && confirmed === true && busy !== true && trimmed(raw).length > 0
}

/**
 * clockRecoverySubmitted 用途：任何一次提交尝试结束后都复位凭据输入与勾选。
 * 参数：无。
 * 返回值：返回复位后的表单片段，避免凭据在输入框里长期停留。
 */
export function clockRecoverySubmitted() {
  return { raw: '', confirmed: false }
}

/**
 * clockRecoveryEntryVisible 用途：是否展示可点击的恢复入口。
 * 参数：status 为授权状态投影，canManage 为写权限。
 * 返回值：只有时钟保护中且有管理权限时才出现可点按钮；只读账号只看指引。
 */
export function clockRecoveryEntryVisible({ status = null, canManage = false } = {}) {
  return canManage === true && status?.clock_blocked === true
}

/**
 * clockRecoverySummary 用途：把一次恢复结果收敛成一句话，供 toast 与页面提示复用。
 * 参数：ok 表示请求是否成功。
 * 返回值：成功提示强调“凭据已消费不可重复使用”。
 */
export function clockRecoverySummary(ok) {
  return ok === true
    ? CLOCK_RECOVERY_SUCCESS
    : `时钟恢复未完成。${CLOCK_RECOVERY_FAILURE_NEXT}`
}
