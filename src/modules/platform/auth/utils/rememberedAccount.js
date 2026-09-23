// SEC-X3：登录页“记住的账号”集中管理。
// 安全理由：localStorage 没有过期时间、同源任意脚本可读（一旦出现 XSS 即被拖走），
// 共享设备上登出后残留的明文账号属于信息泄露。约定：
// 1) 只存登录名本身，绝不存密码（登录页密码框始终为空）；
// 2) 任何会话终结路径都必须清除该 key——由 sessionLifecycle.notifySessionEnded
//    统一兜底（显式登出、空闲超时、服务端撤销、跨标签页广播），登录页在
//    reason=session-ended 进入时再兜底清一次；
// 3) 登录成功且用户勾选“记住账号”时重新写入，正常回填体验不受影响。
export const REMEMBERED_ACCOUNT_STORAGE_KEY = 'basic-platform.remembered-account'

function storageAvailable() {
  return typeof window !== 'undefined' && window.localStorage
}

export function readRememberedAccount() {
  try {
    return storageAvailable() ? String(window.localStorage.getItem(REMEMBERED_ACCOUNT_STORAGE_KEY) || '') : ''
  } catch {
    // 隐私模式等场景下存储不可用时按“无记忆账号”处理，不影响登录。
    return ''
  }
}

export function writeRememberedAccount(account) {
  try {
    const value = String(account || '').trim()
    if (!value || !storageAvailable()) return
    window.localStorage.setItem(REMEMBERED_ACCOUNT_STORAGE_KEY, value)
  } catch {
    // 存储失败不阻断登录流程。
  }
}

export function clearRememberedAccount() {
  try {
    if (storageAvailable()) window.localStorage.removeItem(REMEMBERED_ACCOUNT_STORAGE_KEY)
  } catch {
    // 清除失败时保持静默；下一次成功登录会按最新勾选覆盖。
  }
}
