// 仅使用服务端已认证会话的账号字段；姓名和内部主体 ID 不是登录用户名。
export function loginUsername(session) {
  for (const key of ['username', 'preferred_username', 'user_name', 'account_name']) {
    const value = session?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return '当前用户'
}
