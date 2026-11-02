import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const view = await readFile(new URL('./ProjectManagementView.vue', import.meta.url), 'utf8')
const dialog = await readFile(new URL('../components/SupplementClosureDialog.vue', import.meta.url), 'utf8')

test('项目页接入补充协议关账能力与受控入口依赖', () => {
  assert.match(view, /import \{ useSupplementClosure \} from '@\/modules\/project_management\/composables\/useSupplementClosure'/)
  assert.match(view, /import \{ supplementClosureAvailability \} from '@\/modules\/project_management\/supplementClosure\.js'/)
  assert.match(view, /import SupplementClosureDialog from '@\/modules\/project_management\/components\/SupplementClosureDialog\.vue'/)
  assert.match(view, /closeSupplement,\n/)
  assert.match(view, /useSupplementClosure\(\{\n  closeSupplement, listSupplementContracts, formatUserError, showToast, refreshAfterWrite, askConfirm,\n\}\)/)
})

test('入口可见性只由 supplement_status 与拆解管理权限共同决定', () => {
  assert.match(view, /const decompositionSupplementClosure = computed\(\(\) => supplementClosureAvailability\(decompositionProject\.value, permissionSet\.value\)\)/)
  assert.match(view, /const detailSupplementClosure = computed\(\(\) => supplementClosureAvailability\(detailProject\.value, permissionSet\.value\)\)/)
  // 拆解动作条上的入口只对 allowed 的项目出现；无权限不能出现可点击按钮。
  assert.match(view, /activeSection === 'decomposition' && decompositionSupplementClosure\.allowed[^>]*@click="openSupplementClosure\(decompositionProject\)"/)
  // 项目详情是拆解已推进后的可达入口：可见性绑定 visible，缺权限时禁用并说明原因。
  assert.match(view, /<section v-if="detailSupplementClosure\.visible" class="pm-supplement-closure"/)
  assert.match(view, /<button v-if="detailSupplementClosure\.allowed"[^>]*@click="openSupplementClosure\(detailProject\)"/)
  assert.match(view, /<button v-else type="button" class="pm-button" disabled :title="detailSupplementClosure\.reason">补充协议关账<\/button>/)
  assert.match(view, /\{\{ detailSupplementClosure\.reason \}\}/)
  assert.match(view, /关账后以当前拆解范围指纹为基准，不能再通过「确认拆解」清除补充协议标记/)
})

test('关账弹窗接入候选目录、加载/错误/提交状态与关闭事件', () => {
  assert.match(view, /<SupplementClosureDialog\n/)
  for (const binding of [':open="closureOpen"', ':project="closureProject"', ':form="closureForm"', ':contracts="closureContracts"', ':loading="closureLoading"', ':load-error="closureLoadError"', ':saving="closureSaving"', ':error="closureError"']) {
    assert.ok(view.includes(binding), `missing ${binding}`)
  }
  for (const event of ['@close="closeSupplementClosure"', '@submit="submitSupplementClosure"', '@reload="reloadSupplementClosure"']) {
    assert.ok(view.includes(event), `missing ${event}`)
  }
})

test('弹窗本身要求必填原因、展示二次确认说明与错误状态', () => {
  assert.match(dialog, /<select v-model="form\.supplementContractID" required>/)
  assert.match(dialog, /<textarea v-model="form\.reason" rows="3" required maxlength="1000"/)
  assert.match(dialog, /关账后以当前拆解范围指纹为基准/)
  assert.match(dialog, /不能再通过「确认拆解」清除补充协议标记/)
  assert.match(dialog, /v-if="loading" class="pm-span-full pm-supplement-closure-state"/)
  assert.match(dialog, /v-else-if="loadError" class="pm-span-full pm-supplement-closure-state error" role="alert"/)
  assert.match(dialog, /v-if="error" class="pm-span-full pm-supplement-closure-state error" role="alert"/)
  assert.match(dialog, /\{\{ saving \? '关账中…' : '提交关账' \}\}/)
})
