// requireActionLabel 校验主按钮文案是否表达操作结果。
// 参数：value 为业务调用方提供的按钮文字。
// 返回值：去除首尾空白的文案；缺失或仅表达肯定时抛出参数错误。
export function requireActionLabel(value) {
  const label = typeof value === 'string' ? value.trim() : ''
  if (!label || /^(确定|确认|是|否|OK|Yes|No)$/i.test(label)) {
    throw new TypeError('主按钮必须明确描述操作结果。')
  }
  return label
}
