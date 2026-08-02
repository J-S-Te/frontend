// 与平台后端 validLoginTargetURI（application/login_target.go）保持一致的校验：
//   - 绝对地址：仅接受 https，且不允许 userinfo；
//   - 相对路径：必须以单个 / 开头、无 //、无 query/fragment、仅允许安全字符，
//     登录时由后端按应用环境的 Public BaseURL + PathPrefix 自动补全。
const MAX_TARGET_URI_LENGTH = 2048
const RELATIVE_ALLOWED_CHARS = new Set('/._~!+-'.split(''))

function isPrintableAscii(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code < 0x21 || code > 0x7e) return false
  }
  return true
}

function isAsciiAlphaNumeric(code) {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a)
  )
}

function isValidPortalPath(value) {
  if (
    !value ||
    value.length > MAX_TARGET_URI_LENGTH ||
    !value.startsWith('/') ||
    value.includes('//')
  ) {
    return false
  }
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (!isAsciiAlphaNumeric(code) && !RELATIVE_ALLOWED_CHARS.has(value[i])) return false
  }
  for (const segment of value.split('/')) {
    if (segment === '.' || segment === '..') return false
  }
  try {
    const url = new URL(value, 'https://platform.invalid')
    return url.pathname !== '' && url.search === '' && url.hash === ''
  } catch {
    return false
  }
}

function isValidAbsoluteHttps(value) {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.hostname !== '' &&
      url.username === '' &&
      url.password === ''
    )
  } catch {
    return false
  }
}

export function isValidTargetUri(value) {
  if (
    typeof value !== 'string' ||
    value === '' ||
    value.length > MAX_TARGET_URI_LENGTH ||
    !isPrintableAscii(value)
  ) {
    return false
  }
  return isValidPortalPath(value) || isValidAbsoluteHttps(value)
}

export function targetUriValidationMessage(value) {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return '请填写批准跳转地址。'
  if (!isValidTargetUri(trimmed)) {
    return '请输入 https 绝对地址，或以 / 开头的相对路径（例如 /customer-portal/）。'
  }
  return ''
}
