import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const viewSource = await readFile(new URL('./views/ContractManagementView.vue', import.meta.url), 'utf8')
const panelSource = await readFile(new URL('./components/ContractNumberRulePanel.vue', import.meta.url), 'utf8')
const apiSource = await readFile(new URL('./api/contract.js', import.meta.url), 'utf8')
const utilSource = await readFile(new URL('./utils/contractNumberRule.js', import.meta.url), 'utf8')
const css = await readFile(new URL('./styles/contract-management.css', import.meta.url), 'utf8')

test('合同编号规则 API 读取与全量保存，并校验响应结构而不是伪造空规则', () => {
  assert.match(apiSource, /export async function getContractNumberRule\(\)/)
  assert.match(apiSource, /export async function updateContractNumberRule\(payload\)/)
  assert.match(apiSource, /request\('\/contract-number-rule', \{ validateData: contractNumberRuleResource \}\)/)
  assert.match(apiSource, /request\('\/contract-number-rule', \{\s*method: 'PUT',\s*body: JSON\.stringify\(payload \|\| \{\}\),\s*validateData: contractNumberRuleResource,?\s*\}\)/)
  // 年份段枚举与位宽必须与后端契约一致，结构不符要抛错而不是返回空对象。
  assert.match(apiSource, /CONTRACT_NUMBER_YEAR_SEGMENT_VALUES = \['NONE', 'YY', 'YYYY'\]/)
  assert.match(apiSource, /Number\.isSafeInteger\(value\.seq_width\) && value\.seq_width >= 1 && value\.seq_width <= 9/)
  assert.match(apiSource, /typeof value\.sample === 'string'/)
  assert.doesNotMatch(apiSource, /data \|\| \{\}/)
})

test('预览算法抽到 utils，可被直接测试且不依赖 Vue', () => {
  assert.match(utilSource, /export function buildContractNumberPreview\(rule, options = \{\}\)/)
  assert.match(utilSource, /export function contractNumberRulePayload\(rule\)/)
  assert.match(utilSource, /export const CONTRACT_NUMBER_RULE_LIMITS = Object\.freeze\(/)
  assert.doesNotMatch(utilSource, /from 'vue'/)
  assert.match(panelSource, /from '\.\.\/utils\/contractNumberRule'/)
  assert.match(panelSource, /buildContractNumberPreview\(form\.value, \{ year: currentYear, sequence: nextSequence\.value \}\)/)
})

test('设置面板具备四个字段、长度上限和 1–9 位流水约束', () => {
  assert.match(panelSource, /v-model="form\.prefix"[^>]*maxlength="32"/)
  assert.match(panelSource, /v-model="form\.year_segment"/)
  assert.match(panelSource, /v-model\.number="form\.seq_width" type="number" min="1" max="9" step="1"/)
  assert.match(panelSource, /v-model="form\.suffix"[^>]*maxlength="32"/)
  assert.match(panelSource, /v-for="option in yearSegmentOptions"/)
  // 面板自身的自由文本输入也必须带显式长度上限，保持与合同表单一致的合规约束。
  const inputs = panelSource.match(/<input\b[^>]*>/g) || []
  assert.ok(inputs.length >= 3)
  for (const tag of inputs) {
    assert.ok(/\bmaxlength="\d+"/.test(tag) || /\btype="number"/.test(tag) || /\breadonly\b/.test(tag), tag)
  }
})

test('设置面板只有具备系统编号规则管理权限的账号可以编辑，其余账号只读', () => {
  assert.match(panelSource, /defineProps\(\{\s*canManage: \{ type: Boolean, default: false \},?\s*\}\)/)
  assert.match(panelSource, /:readonly="!canManage"/)
  assert.match(panelSource, /<select v-model="form\.year_segment" :disabled="!canManage">/)
  assert.match(panelSource, /<template v-if="canManage">[\s\S]*保存编号规则/)
  assert.match(panelSource, /<small v-else>当前账号只能查看编号规则，修改需要系统编号规则管理权限。<\/small>/)
  assert.match(panelSource, /if \(!props\.canManage \|\| saving\.value\) return/)
})

test('设置面板展示实时预览、年度用量与保存结果提示', () => {
  assert.match(panelSource, /<strong>\{\{ preview\.number \}\}<\/strong>/)
  assert.match(panelSource, /预计下一号/)
  assert.match(panelSource, /<strong>\{\{ usageLabel \}\}<\/strong>/)
  assert.match(panelSource, /本年度流水已超过 \{\{ preview\.width \}\} 位/)
  assert.match(panelSource, /编号超过 64 个字符/)
  assert.match(panelSource, /当前生效的下一号/)
  assert.match(panelSource, /emit\('notify', '合同编号规则已保存'\)/)
  // 失败时复用统一的错误格式化，且保留表单内容（catch 分支不回写 form）。
  assert.match(panelSource, /saveError\.value = formatUserError\(error, \{ fallback: '保存合同编号规则失败，请稍后重试。', method: 'PUT' \}\)/)
  const saveBlock = panelSource.match(/async function saveRule\(\)[\s\S]*?\n\}/)?.[0] || ''
  assert.match(saveBlock, /const invalid = contractNumberRuleFormError\(form\.value\)[\s\S]*saveError\.value = invalid/)
  assert.match(saveBlock, /await updateContractNumberRule\(contractNumberRulePayload\(form\.value\)\)/)
  assert.match(saveBlock, /applyRule\(data\)/)
  assert.doesNotMatch(saveBlock.slice(saveBlock.indexOf('catch (error)')), /form\.value =/)
})

test('设置面板接入合同模板区域，进入该区域才按需加载', () => {
  assert.match(viewSource, /import ContractNumberRulePanel from '@\/modules\/contract_management\/components\/ContractNumberRulePanel\.vue'/)
  const templatesSection = viewSource.match(/<template v-else-if="activeSection === 'templates'">[\s\S]*?<\/template>/)?.[0] || ''
  assert.match(templatesSection, /<ContractNumberRulePanel v-if="isAdmin \|\| can\('contract\.read'\)" :can-manage="can\('contract\.number_rule\.manage'\)" @notify="showToast" \/>/)
  assert.match(templatesSection, /系统合同编号规则/)
  // 组件用 v-if 挂载而非首屏常驻，读取发生在进入模板区域之后。
  assert.match(panelSource, /onMounted\(loadRule\)/)
  assert.doesNotMatch(viewSource, /getContractNumberRule\(\)/)
})

test('编号规则面板的可编辑性绑定专用高权权限码，不再由合同 admin 角色决定', () => {
  // 规则是全系统单行配置（无 tenant_id）：合同 admin 只是租户级角色，
  // 用 isAdmin 决定可编辑等于让任一租户的合同管理员改全系统前缀。
  assert.match(viewSource, /:can-manage="can\('contract\.number_rule\.manage'\)"/)
  assert.doesNotMatch(viewSource, /:can-manage="isAdmin"/)
  // 只读可见性不变：普通用户仍按 contract.read 看到当前生效规则。
  assert.match(viewSource, /v-if="isAdmin \|\| can\('contract\.read'\)"/)
  // 后端同源权限码，前端文案与清单保持同一口径。
  assert.match(panelSource, /修改需要系统编号规则管理权限/)
  assert.doesNotMatch(panelSource, /修改需要模板管理权限/)
})

test('模板编号格式改为只读展示，并说明实际编号由系统级规则生成', () => {
  assert.match(viewSource, /<span>合同编号格式（只读）<\/span><input :value="templateEditForm\.number_format" readonly maxlength="160" \/>/)
  assert.doesNotMatch(viewSource, /v-model="templateEditForm\.number_format"/)
  assert.match(viewSource, /实际合同编号由系统级编号规则生成；此格式只保留用于展示历史\/旧规则，修改后不会影响新合同编号。/)
  // 只读不改存储：保存模板时仍完整回传既有格式，避免清空历史配置。
  assert.match(viewSource, /number_format: templateEditForm\.value\.number_format\.trim\(\)/)
  assert.match(viewSource, /历史编号格式：\{\{ item\.number_format \|\| 'HT-\{YYYYMMDD\}-\{ID8\}' \}\}（不参与新编号）/)
  // 「审批通过后自动生成编号」的既有承诺不能被新面板冲淡。
  assert.match(viewSource, /合同编号将在审批通过后自动生成/)
})

test('前后缀字符集提示与本地拦截：非法字符不发请求，也不叠加后端 422 提示', () => {
  // 提示文案来自 utils 常量，面板与单测共用同一份，避免两处口径漂移。
  assert.match(panelSource, /CONTRACT_NUMBER_AFFIX_HINT,/)
  assert.match(panelSource, /const affixHint = CONTRACT_NUMBER_AFFIX_HINT/)
  assert.match(panelSource, /最多 32 个字符；\{\{ affixHint \}\}。/)
  assert.match(utilSource, /export const CONTRACT_NUMBER_AFFIX_HINT = '只能包含字母、数字和 - _ \. \/'/)
  assert.match(utilSource, /export function contractNumberRuleAffixErrors\(rule\)/)
  assert.match(panelSource, /const affixErrors = computed\(\(\) => contractNumberRuleAffixErrors\(form\.value\)\)/)
  // 字段高亮沿用面板既有样式语言，并在尝试保存后才出现。
  for (const field of ['prefix', 'suffix']) {
    assert.match(panelSource, new RegExp(`:class="\\{ 'is-invalid': affixInvalidFields\\.includes\\('${field}'\\) \\}"`))
    assert.match(panelSource, new RegExp(`:aria-invalid="affixInvalidFields\\.includes\\('${field}'\\)"`))
  }
  assert.match(css, /\.contract-number-rule-form input\.is-invalid \{ border-color: #fecaca; background: #fef2f2; \}/)
  // 本地校验必须在调用保存接口之前返回，这样被本地拦下时不会同时显示后端通用错误。
  const saveBlock = panelSource.match(/async function saveRule\(\)[\s\S]*?\n\}/)?.[0] || ''
  assert.match(saveBlock, /submitAttempted\.value = true[\s\S]*const invalid = contractNumberRuleFormError\(form\.value\)[\s\S]*saveError\.value = invalid\s*\n\s*return\s*\n\s*\}[\s\S]*await updateContractNumberRule/)
  assert.match(panelSource, /submitAttempted\.value = false/)
})

test('规则未初始化或流水耗尽时面板显示后端给出的原因，而不是静默省略', () => {
  // 后端在规则未初始化、流水耗尽、规则非法时不返回 sample，只返回 sample_unavailable_reason；
  // 面板必须把这个原因渲染出来，否则管理员看不到「下一号为什么没有」。
  assert.match(panelSource, /const sampleUnavailableReason = computed\(\(\) => \{/)
  assert.match(panelSource, /sample_unavailable_reason/)
  assert.match(panelSource, /<span v-else-if="sampleUnavailableReason">\{\{ sampleUnavailableReason \}\}<\/span>/)
})

test('编号规则面板沿用合同管理既有样式语言，没有引入新的设计体系', () => {
  assert.match(css, /\.contract-number-rule-body \{ display: grid;/)
  assert.match(css, /\.contract-number-rule-preview > strong \{[^}]*font-family: ui-monospace/)
  assert.match(css, /\.contract-number-rule-warning \{[^}]*#fffbeb/)
  assert.match(css, /@media \(max-width: 980px\) \{ \.contract-number-rule-body \{ grid-template-columns: 1fr; \} \}/)
  assert.doesNotMatch(panelSource, /<style/)
})
