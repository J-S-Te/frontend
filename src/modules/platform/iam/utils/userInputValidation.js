import { IamError } from '../api/iam.js'
import { instantToBusinessWallClock } from '../../../shared/utils/businessTime.js'

// 从 IamSettingsModule 提取的输入校验与规范化纯函数（治理批次 2 第一步）。
// 行为契约与提取前逐字一致：所有校验失败抛 IamError，中文文案保持原样。

// 账号有效期默认值：当前时间 +24 小时，用北京墙钟表示（与提交侧 resolveExpiresAt
// 的北京口径对称）。旧实现按浏览器本地墙钟，UTC 浏览器下默认值会偏 8 小时，
// 保存后又按北京解释，导致有效期整体偏移。
export function defaultAccountValidUntil(now = new Date()) {
  return instantToBusinessWallClock(new Date(now.getTime() + 24 * 60 * 60 * 1000))
}

export function resolveExpiresAt(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function optionalText(value) {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

export function validateUserInput({ displayName, email, mobile, status }, rowLabel = '') {
  const prefix = rowLabel ? `${rowLabel}：` : ''
  const normalizedName = String(displayName ?? '').trim()
  if (!normalizedName) throw new IamError(`${prefix}请填写用户姓名。`)
  if (Array.from(normalizedName).length > 100) throw new IamError(`${prefix}用户姓名不能超过 100 个字符。`)

  const normalizedEmail = optionalText(email)
  if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new IamError(`${prefix}邮箱格式不正确。`)
  }

  const normalizedMobile = optionalText(mobile)
  if (normalizedMobile) {
    if (Array.from(normalizedMobile).length > 32) throw new IamError(`${prefix}手机号不能超过 32 个字符。`)
    const compactMobile = normalizedMobile.replace(/[\s-]/g, '')
    if (!/^\+?\d+$/.test(compactMobile)) throw new IamError(`${prefix}手机号只能包含数字、空格、连字符或开头的加号。`)
  }

  return {
    displayName: normalizedName,
    email: normalizedEmail,
    mobile: normalizedMobile,
    status: status || 'ACTIVE',
  }
}

export function parseBatchUserRows(value, status) {
  const rows = String(value ?? '')
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)
  if (!rows.length) throw new IamError('请至少填写一行用户数据。')
  if (rows.length > 100) throw new IamError('一次最多批量创建 100 位用户。')

  return rows.map((row, index) => {
    const columns = row.split(/[,，]/).map((column) => column.trim())
    if (columns.length > 3) throw new IamError(`第 ${index + 1} 行：字段过多，请使用“姓名,邮箱,手机号”格式。`)
    return validateUserInput({
      displayName: columns[0],
      email: columns[1],
      mobile: columns[2],
      status,
    }, `第 ${index + 1} 行`)
  })
}

export function validateLocalAccountInput(accountName, password) {
  const normalizedAccountName = String(accountName ?? '').trim()
  const accountLength = Array.from(normalizedAccountName).length
  if (accountLength < 3 || accountLength > 64) throw new IamError('账号名长度必须为 3–64 个字符。')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalizedAccountName)) {
    throw new IamError('账号名必须以字母或数字开头，且只能包含字母、数字、点、下划线和连字符。')
  }

  const normalizedPassword = String(password ?? '')
  const passwordLength = Array.from(normalizedPassword).length
  if (passwordLength < 8 || passwordLength > 128) throw new IamError('初始密码长度必须为 8–128 个字符。')
  if (/\s/.test(normalizedPassword)) throw new IamError('初始密码不能包含空白字符。')
  if (!/[A-Z]/.test(normalizedPassword) || !/[a-z]/.test(normalizedPassword) || !/\d/.test(normalizedPassword) || !/[^A-Za-z0-9]/.test(normalizedPassword)) {
    throw new IamError('初始密码必须同时包含大写字母、小写字母、数字和特殊字符。')
  }
  return { accountName: normalizedAccountName, password: normalizedPassword }
}
