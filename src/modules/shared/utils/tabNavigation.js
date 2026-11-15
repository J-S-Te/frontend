// activeTabIndex 确定页签组唯一的键盘入口，缺失或禁用的当前项回落到首个可用项。
// 参数：items 为页签集合；value 为业务当前值，兼容数值与字符串标识。
// 返回值：可聚焦项下标；无可用页签时返回 -1，不改变业务当前值。
export function activeTabIndex(items, value) {
  const available = items.findIndex(item => item && !item.disabled)
  const active = items.findIndex(item => item && !item.disabled
    && String(item.value) === String(value))
  return active >= 0 ? active : available
}

// nextTabIndex 计算方向键目标，跳过禁用项并在首尾循环。
// 参数：items 为页签；current 为当前下标；key 为按键；orientation 为排列方向。
// 返回值：目标下标；无可用项或不属于当前方向的按键返回 -1。
export function nextTabIndex(items, current, key, orientation = 'horizontal') {
  const previous = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft'
  const next = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight'
  if (![previous, next, 'Home', 'End'].includes(key)) return -1
  const enabled = items.flatMap((item, index) => item && !item.disabled ? [index] : [])
  if (!enabled.length) return -1
  if (key === 'Home') return enabled[0]
  if (key === 'End') return enabled.at(-1)
  const position = enabled.indexOf(current)
  if (position < 0) return key === previous ? enabled.at(-1) : enabled[0]
  const offset = key === next ? 1 : -1
  return enabled[(position + offset + enabled.length) % enabled.length]
}
