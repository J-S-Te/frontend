// 初始密码仅保留在导入结果中，绝不缓存，也不加入
// 提示或完成事件；导出必须由操作人员显式触发。
export function initialCredentialsForImport(result, createdCount) {
  const values = result?.initial_credentials
  if (!Array.isArray(values) || createdCount < 1 || values.length !== createdCount) return null
  const names = new Set()
  const credentials = []
  for (const item of values) {
    const accountName = typeof item?.account_name === 'string' ? item.account_name.trim() : ''
    const initialPassword = typeof item?.initial_password === 'string' ? item.initial_password : ''
    if (!accountName || accountName.length > 256 || !initialPassword || initialPassword.length > 1024
      || /[\u0000-\u001f\u007f]/.test(accountName + initialPassword) || names.has(accountName)) return null
    names.add(accountName)
    credentials.push({ accountName, initialPassword })
  }
  return credentials
}

export function initialCredentialsDocument(credentials) {
  return JSON.stringify({ initial_credentials: credentials.map(item => ({
    account_name: item.accountName,
    initial_password: item.initialPassword,
    must_change_password: true,
  })) }, null, 2) + '\n'
}

export function clearInitialCredentials(result) {
  for (const item of result?.initialCredentials || []) item.initialPassword = ''
  if (result) result.initialCredentials = []
}
