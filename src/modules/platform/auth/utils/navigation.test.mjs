import assert from 'node:assert/strict'
import test from 'node:test'

import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./navigation.js', import.meta.url), 'utf8')
const navigation = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const origin = 'https://platform.example.com'

test('普通 return_to 只允许当前站点', () => {
  assert.equal(navigation.resolveSameOriginRedirect('/console?tab=iam', origin), '/console?tab=iam')
  assert.equal(navigation.resolveSameOriginRedirect('https://business.example.com/home', origin), '/')
  assert.equal(navigation.resolveSameOriginRedirect('javascript:alert(1)', origin), '/')
})

// SEC-X7：跨源回跳仅校验 scheme，必须留下浏览器端告警以便审计核对注册表。
test('跨源回跳输出安全告警，同源跳转不告警 [SEC-X7]', () => {
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings.push(args.map(String).join(' '))
  try {
    navigation.resolveServerApprovedRedirect('https://business.example.com/home', origin)
    assert.equal(warnings.length, 1)
    assert.ok(warnings[0].includes('https://business.example.com/home'))

    navigation.resolveServerApprovedRedirect('/console', origin)
    navigation.resolveSameOriginRedirect('https://evil.example.com/x', origin)
    assert.equal(warnings.length, 1, '同源解析与被拒目标不应产生额外告警')
  } finally {
    console.warn = originalWarn
  }
})

test('服务端已登记登录目标允许 HTTPS 跨应用跳转', () => {
  assert.equal(
    navigation.resolveServerApprovedRedirect('https://business.example.com/home?from=platform', origin),
    'https://business.example.com/home?from=platform',
  )
  assert.equal(navigation.resolveServerApprovedRedirect('/console', origin), '/console')
  assert.equal(navigation.resolveServerApprovedRedirect('http://business.example.com/home', origin), '/')
  assert.equal(navigation.resolveServerApprovedRedirect('https://user:secret@business.example.com/home', origin), '/')
  assert.equal(navigation.resolveServerApprovedRedirect('javascript:alert(1)', origin), '/')
})
