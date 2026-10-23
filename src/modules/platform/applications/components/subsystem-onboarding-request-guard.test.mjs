import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 切换应用后，较早发出的环境加载可能后返回并覆盖新应用的环境列表：
// 必须用请求序号丢弃过期响应（老大审计第六类第 1 条）。
const source = readFileSync(fileURLToPath(new URL('./SubsystemOnboardingModule.vue', import.meta.url)), 'utf8')

test('环境加载带请求序号并在返回后校验', () => {
  assert.match(source, /const environmentRequestSeq = ref\(0\)/)
  const body = source.slice(source.indexOf('async function loadEnvironments()'))
  assert.match(body.slice(0, 400), /const requestSeq = \+\+environmentRequestSeq\.value/)
  assert.match(body, /if \(requestSeq !== environmentRequestSeq\.value\) return/)
})

test('过期响应不会写入环境与部署状态', () => {
  const body = source.slice(source.indexOf('async function loadEnvironments()'), source.indexOf('async function loadEnvironments()') + 3000)
  const firstWrite = body.indexOf('environments.value = visibleSubsystemEnvironments')
  assert.ok(firstWrite > 0)
  const guardBeforeWrite = body.lastIndexOf('requestSeq !== environmentRequestSeq.value', firstWrite)
  assert.ok(guardBeforeWrite > 0 && guardBeforeWrite < firstWrite, '写入环境列表前必须先校验序号')
})
