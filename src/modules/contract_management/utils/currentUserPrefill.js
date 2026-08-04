const NAME_ALIASES = new Set([
  'displayname', 'currentuser', 'currentusername', 'owner', 'ownername',
  'applicant', 'applicantname', 'creator', 'creatorname', 'handler', 'handlername',
  '当前用户', '当前用户姓名', '负责人', '负责人姓名', '申请人', '申请人姓名',
  '创建人', '创建人姓名', '经办人', '经办人姓名',
])

const ACCOUNT_ALIASES = new Set([
  'username', 'useraccount', 'account', 'accountname', 'loginname',
  '用户账号', '账号', '登录账号',
])

const EMAIL_ALIASES = new Set(['email', 'useremail', '邮箱', '电子邮箱'])

function normalizedFieldIdentifier(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '')
}

export function currentUserValueForTemplateField(field, session) {
  const identifiers = [field?.name, field?.label].map(normalizedFieldIdentifier)
  if (identifiers.some((item) => NAME_ALIASES.has(item))) {
    return String(session?.display_name || '').trim()
  }
  if (identifiers.some((item) => ACCOUNT_ALIASES.has(item))) {
    return String(session?.user_name || '').trim()
  }
  if (identifiers.some((item) => EMAIL_ALIASES.has(item))) {
    return String(session?.email || '').trim()
  }
  return ''
}

export function buildTemplateValues(fields, session, existingValues = {}) {
  return Object.fromEntries((fields || []).map((field) => {
    const existing = String(existingValues?.[field.name] ?? '')
    const value = existing || String(field.default || '') || currentUserValueForTemplateField(field, session)
    return [field.name, value]
  }))
}
