export function approvalAmountMinor(value) {
  const text = String(value ?? '').trim()
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('审批金额条件必须是有效金额，最多两位小数。')
  const negative = text.startsWith('-')
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.')
  const absolute = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  if (absolute > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('审批金额条件超出可安全提交的范围。')
  return Number(negative ? -absolute : absolute)
}

export function approvalAmountInput(value) {
  if (!Number.isSafeInteger(value)) throw new Error('已保存的审批金额条件超出可安全编辑的范围。')
  const minor = BigInt(value)
  const absolute = minor < 0n ? -minor : minor
  return `${minor < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`
}

export function copyRuleExpression(expression) {
  function checkAmounts(group) {
    for (const condition of group?.conditions || []) {
      if (condition.field === 'amount_minor') approvalAmountInput(condition.value)
    }
    for (const child of group?.groups || []) checkAmounts(child)
  }
  // 超出浏览器整数范围的 JSON 数字在解析后已丢失精度。
  // 不得重新提交隐藏在只读分组中、已被舍入的金额。
  checkAmounts(expression)
  return JSON.parse(JSON.stringify(expression || { logical: 'and', conditions: [] }))
}

export function ruleExpressionSummary(expression, conditionLabel) {
  const parts = (expression?.conditions || []).map(conditionLabel)
  parts.push(...(expression?.groups || []).map((group) => `（${ruleExpressionSummary(group, conditionLabel)}）`))
  return parts.length ? parts.join(expression?.logical === 'or' ? ' 或 ' : ' 且 ') : '未配置条件'
}
