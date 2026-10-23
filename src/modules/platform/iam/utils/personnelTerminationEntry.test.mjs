import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 旧「办理离职」入口直接 PATCH 用户为 DISABLED：既绕过人员异动审批与责任交接，
// 又会把请求里的 mobile:"" 写进后端（手机号密文与摘要被清成 NULL）。
// 现在离职入口只负责把人员带到人员异动中心，由异动申请链路执行。

function source(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

const iamSettings = source('../components/IamSettingsModule.vue')
const changeCenter = source('../components/PersonnelChangeCenter.vue')
const consoleView = source('../../views/PlatformConsoleView.vue')

test('用户详情不再直接停用用户来办理离职', () => {
  assert.doesNotMatch(iamSettings, /mobile: '', status: 'DISABLED'/)
  assert.doesNotMatch(iamSettings, /title: '确认办理离职'/)
  assert.match(iamSettings, /emit\('personnel-change'/)
  assert.match(iamSettings, /离职必须通过人员异动中心办理/)
})

test('人员异动中心接收预填人员并创建离职申请', () => {
  assert.match(changeCenter, /prefillUserId: \{ type: String, default: '' \}/)
  assert.match(changeCenter, /async function openForUser\(userId\)/)
  assert.match(changeCenter, /form\.type = 'TERMINATION'/)
  assert.match(changeCenter, /await loadUserMemberships\(\)/)
  assert.match(changeCenter, /emit\('prefill-consumed'\)/)
})

test('平台控制台把离职意图切换到人员异动中心并回传人员', () => {
  assert.match(consoleView, /@personnel-change="openPersonnelChangeForUser"/)
  assert.match(consoleView, /:prefill-user-id="pendingPersonnelChangeUserId"/)
  assert.match(consoleView, /@prefill-consumed="pendingPersonnelChangeUserId = ''"/)
  assert.match(consoleView, /activeSettingsTab\.value = 'personnel'/)
})
