import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 环境读取链已从组件内请求序号迁移到批次 1 的共享 requestScope 工具：
// 切换应用后，旧响应的数据/错误回写与 finally 清理都必须先通过 isCurrent 校验（R04/R05），
// 部署轮询回写 deploymentStates 也必须校验应用与环境归属。
// 行为级用例见 subsystem-onboarding-acceptance-scope.test.mjs。
const source = readFileSync(fileURLToPath(new URL('./SubsystemOnboardingModule.vue', import.meta.url)), 'utf8')

function chainBody() {
  const start = source.indexOf('async function loadEnvironments()')
  return source.slice(start, start + 3800)
}

test('环境读取链绑定 requestScope，票据 contextKey 含当前应用', () => {
  assert.match(source, /const environmentRequestScope = createRequestScope\(\)/)
  const head = chainBody().slice(0, 500)
  assert.match(head, /environmentRequestScope\.begin\(`ENV:\$\{application\?\.application_id \|\| ''\}`\)/)
  assert.match(head, /const isCurrentRequest = \(\) => environmentRequestScope\.isCurrent\(scopeTicket\)/)
})

test('过期响应不得写入环境列表、部署状态与集成状态（R04）', () => {
  const body = chainBody()
  const writes = [
    'environments.value = visibleSubsystemEnvironments',
    'deploymentStates.value = Object.fromEntries',
    'keycloakSwitchStates.value = Object.fromEntries',
  ]
  for (const marker of writes) {
    const at = body.indexOf(marker)
    assert.ok(at > 0, `missing write: ${marker}`)
    const guard = body.lastIndexOf('if (!isCurrentRequest()) return', at)
    assert.ok(guard > 0 && guard < at, `${marker} 写入前必须先校验票据`)
  }
})

test('catch 错误回写与 finally 清理必须先校验票据（R04/R05）', () => {
  const body = chainBody()
  const catchAt = body.indexOf('} catch (error) {')
  const errorWriteAt = body.indexOf("setError(error, '读取应用环境失败。')")
  assert.ok(catchAt > 0 && errorWriteAt > catchAt)
  const catchGuard = body.lastIndexOf('if (!isCurrentRequest()) return', errorWriteAt)
  assert.ok(catchGuard > catchAt && catchGuard < errorWriteAt, 'catch 回写错误前必须校验票据')
  const finallyAt = body.indexOf('} finally {', errorWriteAt)
  assert.ok(finallyAt > 0)
  assert.match(body.slice(finallyAt), /if \(isCurrentRequest\(\)\) environmentsLoading\.value = false/, 'finally 清理前必须校验票据')
})

test('投影告警读取链受同一票据保护，旧应用的告警不得写回新页面', () => {
  const body = source.slice(source.indexOf('async function loadKeycloakProjectionOperations'))
  assert.match(body.slice(0, 300), /isCurrentRequest = \(\) => true/, '单独调用时保持既有行为')
  const writeAt = body.indexOf('keycloakProjectionAlert.value = alert')
  const guard = body.lastIndexOf('if (!isCurrentRequest()) return', writeAt)
  assert.ok(guard > 0 && guard < writeAt, '投影告警回写前必须校验票据')
  assert.match(body, /if \(isCurrentRequest\(\)\) keycloakOperationsLoading\.value = false/)
})

test('部署轮询回写 deploymentStates 前校验应用与环境归属', () => {
  const body = source.slice(source.indexOf('async function waitForDeploymentCompletion'))
  const writeAt = body.indexOf('deploymentStates.value = { ...deploymentStates.value')
  assert.ok(writeAt > 0)
  const appGuard = body.indexOf('selectedApplicationId.value === application.application_id')
  const envGuard = body.indexOf('environments.value.some((item) => item.environment === environmentName)')
  assert.ok(appGuard > 0 && appGuard < writeAt, '回写前必须校验应用归属')
  assert.ok(envGuard > 0 && envGuard < writeAt, '回写前必须校验环境仍在当前列表')
})
