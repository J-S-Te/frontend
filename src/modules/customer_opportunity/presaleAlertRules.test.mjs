import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./views/CustomerOpportunityView.vue', import.meta.url), 'utf8')

test('售前预警规则使用真实权限并展示首次配置状态', () => {
  assert.match(source, /canConfigurePresaleAlerts = computed\(.*presale\.alert\.config/)
  assert.match(source, /v-if="canConfigurePresaleAlerts" @click="openAlertConfig"/)
  assert.match(source, /rule\.configured === false/)
  assert.match(source, /未配置 · 保存后生效，默认未启用/)
})

test('售前预警规则加载失败或旧服务返回空列表时不会显示空白弹窗', () => {
  assert.match(source, /Array\.isArray\(rules\) \|\| !rules\.length/)
  assert.match(source, /v-if="alertConfigLoading" role="status"/)
  assert.match(source, /v-if="alertConfigError" role="alert"/)
  assert.match(source, /重新加载/)
})

test('售前预警规则保存使用数据版本、校验阈值并阻止重复提交', () => {
  assert.match(source, /version: rule\.version \?\? rule\.config_version/)
  assert.match(source, /Number\.isInteger\(threshold\)/)
  assert.match(source, /threshold < 0 \|\| threshold > 8760/)
  assert.match(source, /规则已被其他管理员修改/)
  assert.match(source, /if \(!canConfigurePresaleAlerts\.value \|\| alertRuleSavingType\.value\) return/)
})
