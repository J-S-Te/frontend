// SubsystemAccessErrorView 行为约定测试（source-check，对齐其他模块的 *-ui.test.mjs 模式）
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(
  new URL('./SubsystemAccessErrorView.vue', import.meta.url),
  'utf8',
)

test('CALLBACK_FAILED 走重新登录而不是重试', () => {
  // 回调失败时 from 是 /<subs>/auth/callback，浏览器刷新它没有意义
  // （state/code 已过期），必须重新发起 OIDC 登录拿新 state/code。
  assert.match(source, /SUBSYSTEM_ACCESS_REASON\.CALLBACK_FAILED/)
  assert.match(source, /const canRelogin = computed/)
  assert.match(source, /SUBSYSTEM_ACCESS_REASON\.CALLBACK_FAILED/)
})

test('诊断面板渲染 stage / code / request_id', () => {
  assert.match(source, /errorStage/)
  assert.match(source, /query\.stage/)
  assert.match(source, /错误阶段/)
  assert.match(source, /errorCode/)
  assert.match(source, /requestID/)
})

test('重新登录按钮只对真正需要重新 OIDC 的 reason 展示', () => {
  // CALLBACK_FAILED 必须出现在 canRelogin 数组里（用户需要走新的 OIDC 流程）；
  // DEPENDENCY_UNAVAILABLE 不能展示重新登录（依赖故障时重新登录无意义）。
  assert.match(
    source,
    /SUBSYSTEM_ACCESS_REASON\.OIDC_CLAIMS_INVALID,\s*\n\s*SUBSYSTEM_ACCESS_REASON\.UNAUTHENTICATED,\s*\n\s*SUBSYSTEM_ACCESS_REASON\.CALLBACK_FAILED/,
  )
  // canRetry 仍然只对 DEPENDENCY_UNAVAILABLE 开启，回调失败不出"重试访问"
  // 因为 from 是 callback 路径，刷新它只会再触发一次失败。
  assert.match(
    source,
    /reason\.value === SUBSYSTEM_ACCESS_REASON\.DEPENDENCY_UNAVAILABLE/,
  )
})