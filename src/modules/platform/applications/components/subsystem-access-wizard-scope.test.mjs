import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 切换系统/环境后必须丢弃旧预览与旧操作：否则“继续处理/重新检查”仍指向旧目标，
// 用户可能在 B 的页面里恢复 A 的操作。
const source = readFileSync(fileURLToPath(new URL('./SubsystemAccessWizard.vue', import.meta.url)), 'utf8')

test('目标变化时清空旧预览与旧操作', () => {
  assert.match(source, /watch\(\s*\(\) => \[form\.applicationCode, form\.environment\]/)
  assert.match(source, /resetFlow\(\)/)
})

test('切换到新目标会中止进行中的轮询', () => {
  const reset = source.slice(source.indexOf('function resetFlow()'))
  assert.match(reset.slice(0, 240), /stopObserver\(\)/)
})

// 受理 ≠ 完成：父视图只在状态机真正 SUCCEEDED 后刷新，否则会读到“还没有目录/环境”的中间态。
test('接入完成事件只在成功后发出', () => {
  const start = source.indexOf('async function confirmAndSubmit()')
  const body = source.slice(start, start + 1800)
  assert.match(body, /const finalStatus = await watchOperation\(result\.operation_id\)/)
  assert.match(body, /if \(finalStatus === 'SUCCEEDED'\) emit\('completed'\)/)
  assert.doesNotMatch(body, /emit\('completed'\)\s*\n\s*await watchOperation/)
})

// 操作可能来自上一次提交或从操作记录恢复，并不总是等于当前表单选择：
// 必须显式展示"当前操作目标"，避免用户以为操作的是刚选的目标。
test('进度区显式标注当前操作目标', () => {
  assert.match(source, /data-testid="operation-target"/)
  assert.match(source, /operation\.application_code \|\| form\.applicationCode/)
  assert.match(source, /operation\.environment \|\| operation\.environment_code \|\| form\.environment/)
})
