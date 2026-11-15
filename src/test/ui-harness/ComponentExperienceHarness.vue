<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import FormDialog from '@/modules/shared/components/FormDialog.vue'
import ConfirmDialog from '@/modules/shared/components/ConfirmDialog.vue'
import SegmentedTabs from '@/modules/shared/components/SegmentedTabs.vue'
import ToggleSwitch from '@/modules/shared/components/ToggleSwitch.vue'
import StatusBadge from '@/modules/shared/components/StatusBadge.vue'
import LoadingState from '@/modules/shared/components/LoadingState.vue'
import EmptyState from '@/modules/shared/components/EmptyState.vue'
import OperationToast from '@/modules/shared/components/OperationToast.vue'

// 隔离夹具只使用真实组件和模块样式，全部内容为合成数据，无 API/登录/业务写入。
const modules = [
  ['platform', '平台', 'console-page', 'console-content', 'console-nav-item', 'console-button', 'console-card', 'console-data-table', 'console-detail-modal', 'settings-tab-bar'],
  ['contract', '合同', 'contract-app', 'contract-content', 'contract-nav-item', 'contract-button', 'contract-card', 'contract-data-table', 'contract-detail-modal', 'contract-tabs'],
  ['project', '项目', 'pm-shell', 'pm-page', 'pm-nav-item', 'pm-button', 'pm-panel', 'pm-table', 'pm-dialog', 'pm-sm-tabs'],
  ['crm', '客户商机', 'crm-page', 'crm-content', 'crm-nav-item', 'console-button', 'crm-panel', 'console-data-table', 'crm-customer-dialog', 'crm-tabs'],
  ['portal', '客户门户', 'portal-page', 'portal-content', 'portal-nav-item', 'console-button', 'portal-card', 'console-data-table', 'portal-dialog', 'crm-customer-tabs'],
  ['reimbursement', '报销', 'console-page', 'expense-canvas', 'console-nav-item', 'expense-button', 'expense-panel', 'expense-table-body', 'console-detail-modal', 'expense-tabs'],
  ['settlement', '结算', 'settlement-page', 'settlement-content', 'settlement-nav-item', 'console-button', 'settlement-panel', 'settlement-plan-table', 'console-detail-modal', 'settlement-tabs'],
  ['analysis', '数析', 'da-shell', 'da-page', 'da-nav-item', 'da-button', 'da-panel', 'da-table', 'da-modal', 'da-chart-tabs'],
]
const moduleKey = ref('platform')
const theme = ref('light')
const current = computed(() => modules.find(item => item[0] === moduleKey.value))
const navClass = computed(() => moduleKey.value === 'contract' ? 'contract-nav' : '')
const navItemClass = computed(() => moduleKey.value === 'contract' ? '' : current.value[4])
const actionClass = computed(() => ['crm', 'portal'].includes(moduleKey.value) ? '' : current.value[5])
const legacyOverlayClass = computed(() => moduleKey.value === 'portal' ? 'portal-dialog'
  : moduleKey.value === 'crm' ? 'crm-modal' : '')
const legacyPanelClass = computed(() => ['portal', 'crm'].includes(moduleKey.value) ? '' : current.value[8])
const selected = ref('overview')
const value = ref(false)
const busy = ref(false)
const dialog = ref(false)
const confirm = ref(false)
const legacy = ref(false)
const drawer = ref('')
const toast = ref('')
const results = ref([])
const edited = ref('')
const checks = ref('')
const tabs = [
  { value: 'overview', label: '概览', controls: 'overview-panel' },
  { value: 'disabled', label: '不可用', disabled: true },
  { value: 'records', label: '业务记录', controls: 'records-panel' },
]

watch(theme, mode => { document.documentElement.dataset.theme = mode }, { immediate: true })
watch(moduleKey, () => { results.value = []; legacy.value = false })

// inspect 读取真实计算样式和几何，报告当前最小模块批次的结果。
// 参数：无；检查本页当前模块及浏览器减少动态效果偏好。
// 返回值：无；将逐项断言呈现到页面，失败保留具体名称。
async function inspect() {
  await nextTick()
  const scope = document.querySelector('#module-fixture')
  const style = selector => getComputedStyle(scope.querySelector(selector))
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  const transition = selector => reduced
    ? style(selector).transitionProperty === 'none'
    : style(selector).transitionDuration.split(',')[0] === '0.1s'
  results.value = [
    ['导航过渡', transition('#nav-current')],
    ['独立筛选输入高度', parseFloat(style('#filter').minHeight) === 32],
    ['独立筛选输入圆角', style('#filter').borderRadius === '6px'],
    ['错误输入色调', style('#invalid').borderTopColor === (theme.value === 'dark' ? 'rgb(255, 120, 117)' : 'rgb(207, 19, 34)')],
    ['表单错误输入色调', style('#form-invalid').borderTopColor === style('#invalid').borderTopColor],
    ['禁用输入不可操作', style('#disabled').cursor === 'not-allowed'],
    ['禁用输入底色', style('#disabled').backgroundColor === (theme.value === 'dark' ? 'rgb(38, 38, 38)' : 'rgb(245, 245, 245)')],
    ['表单禁用输入底色', style('#form-disabled').backgroundColor === style('#disabled').backgroundColor],
    ['只读输入底色', style('#readonly').backgroundColor === (theme.value === 'dark' ? 'rgb(26, 26, 26)' : 'rgb(250, 250, 250)')],
    ['按钮过渡', transition('#main-action')],
    ['卡片过渡', transition('#card')],
    ['表格过渡', transition('tbody td')],
    ['页签唯一键盘入口', scope.querySelectorAll('[role="tab"][tabindex="0"]').length === 1],
    ['开关语义', scope.querySelector('[role="switch"]').getAttribute('aria-checked') === String(value.value)],
    ['加载文字保留', scope.textContent.includes('正在读取业务记录')],
    ['页面无横向溢出', document.documentElement.scrollWidth <= innerWidth + 1],
  ]
  checks.value = `${current.value[1]} / ${theme.value} / ${reduced ? '减少动效' : '正常动效'} / ${innerWidth}px`
}

// resetTab 清空当前业务值，用于核验页签缺失时仍可通过键盘进入。
// 参数：无。
// 返回值：无；不自动选择业务页签。
function resetTab() {
  selected.value = 'missing'
}
</script>

<template>
  <header class="fixture-controls">
    <h1>全生命周期组件体验验证</h1>
    <p>真实共享组件与模块 CSS；合成数据；无业务 API。每次只验证一个模块。</p>
    <label>模块<select v-model="moduleKey" aria-label="验证模块">
      <option v-for="item in modules" :key="item[0]" :value="item[0]">{{ item[1] }}</option>
    </select></label>
    <label>主题<select v-model="theme" aria-label="验证主题">
      <option value="light">浅色</option><option value="dark">深色</option>
    </select></label>
    <button type="button" @click="inspect">核验当前模块</button>
    <button type="button" @click="drawer = 'contract'">验证合同导入抽屉</button>
    <button type="button" @click="drawer = 'project'">验证项目详情抽屉</button>
    <p v-if="checks" id="check-context">{{ checks }}</p>
    <output v-if="results.length" id="check-results" :data-pass="results.every(item => item[1])">
      <span v-for="[name, pass] in results" :key="name">{{ pass ? '通过' : '失败' }}：{{ name }}</span>
    </output>
  </header>
  <div id="module-fixture" :class="[current[2], 'fixture-page']">
    <main :class="[current[3], 'fixture-content']">
      <nav class="fixture-nav" :class="navClass" aria-label="导航示例"><section>
        <button id="nav-current" type="button" :class="[navItemClass, 'active']" aria-current="page">业务台账</button>
        <button type="button" :class="navItemClass">统计分析</button>
      </section></nav>
      <section id="card" :class="[current[6], 'fixture-card']">
        <h2>{{ current[1] }} · 业务台账</h2>
        <p>导航、控制、展示、反馈使用同一规范，保留原模块布局与交互。</p>
        <SegmentedTabs v-model="selected" :items="tabs" aria-label="业务内容页签" />
        <p :id="selected === 'records' ? 'records-panel' : 'overview-panel'">当前内容：{{ selected }}</p>
        <div class="fixture-fields">
          <label>独立筛选<input id="filter" placeholder="搜索名称或编号" /></label>
          <label>校验错误<input id="invalid" value="待修正" aria-invalid="true" /></label>
          <label>只读信息<input id="readonly" value="已确认的业务编号" readonly /></label>
          <label>无操作权限<input id="disabled" value="当前不可编辑" disabled /></label>
          <label>选择类型<select><option>服务项目</option><option>内部项目</option></select></label>
          <label>附件<input type="file" /></label>
          <label><input type="checkbox" /> 合成选择项</label>
          <label><input type="radio" name="sample" checked /> 当前范围</label>
        </div>
        <form class="fixture-fields" @submit.prevent>
          <label>表单错误<input id="form-invalid" aria-invalid="true" value="待修正" /></label>
          <label>表单禁用<input id="form-disabled" disabled value="不可修改" /></label>
        </form>
        <ToggleSwitch v-model="value" label="显示扩展字段" :busy="busy" />
        <label><input v-model="busy" type="checkbox" /> 开关忙状态</label>
        <div class="fixture-actions">
          <button id="main-action" type="button" :class="[actionClass, 'primary']" @click="dialog = true">打开表单</button>
          <button type="button" :class="current[5]" @click="legacy = true">打开模块弹层</button>
          <button type="button" :class="current[5]" @click="toast = '操作反馈示例，不代表业务操作完成'">展示消息</button>
          <button type="button" :class="current[5]" @click="resetTab">清空页签值</button>
          <button type="button" :class="current[5]" disabled>无权限操作</button>
        </div>
        <div class="fixture-table-scroll" :class="moduleKey === 'reimbursement' ? 'expense-table' : ''">
          <div :class="moduleKey === 'reimbursement' ? 'expense-table-body' : ''">
          <table :class="moduleKey === 'reimbursement' ? '' : current[7]">
          <thead><tr><th>业务编号</th><th>业务名称</th><th>状态</th></tr></thead>
          <tbody><tr><td>DEMO-001</td><td>合成业务记录</td><td><StatusBadge status="APPROVED" label="已确认" dot /></td></tr></tbody>
          </table></div></div>
        <LoadingState title="正在读取业务记录" compact />
        <EmptyState title="当前筛选无结果" description="调整条件后重新查询" compact />
      </section>
    </main>
  </div>
  <FormDialog :open="dialog" title="编辑业务信息" description="合成夹具，不提交任何业务数据。" @close="dialog = false">
    <label>业务名称<input v-model="edited" aria-label="业务名称" /></label>
    <template #footer>
      <button type="button" class="console-button" @click="dialog = false">取消编辑</button>
      <button type="button" class="console-button primary" @click="confirm = true">核对信息</button>
    </template>
  </FormDialog>
  <ConfirmDialog :open="confirm" title="核对信息" description="仅验证叠层焦点与动效。"
    confirm-text="完成核对" @confirm="confirm = false" @cancel="confirm = false" />
  <div v-if="legacy" class="fixture-overlay" :class="legacyOverlayClass">
    <article :class="[legacyPanelClass, 'fixture-legacy']" role="dialog" aria-modal="true" aria-label="模块弹层示例">
      <h2>{{ current[1] }}弹层进入</h2><p>保留模块定位，使用统一进入动效。</p>
      <button type="button" :class="current[5]" @click="legacy = false">关闭模块弹层</button>
    </article>
  </div>
  <OperationToast :message="toast" />
  <div v-if="drawer === 'contract'" class="contract-import-drawer-mask">
    <aside class="contract-detail-modal contract-import-drawer" role="dialog" aria-label="合同导入抽屉示例">
      <h2>合同导入抽屉</h2><button type="button" @click="drawer = ''">关闭抽屉</button>
    </aside>
  </div>
  <Transition name="pm-drawer">
    <div v-if="drawer === 'project'" class="pm-overlay">
      <aside class="pm-drawer" role="dialog" aria-label="项目详情抽屉示例">
        <h2>项目详情抽屉</h2><button type="button" @click="drawer = ''">关闭抽屉</button>
      </aside>
    </div>
  </Transition>
</template>

<style scoped>
.fixture-controls { padding: 20px; color: var(--ui-text); background: var(--ui-card); }
.fixture-controls h1 { margin: 0; font-size: var(--fs-title); }
.fixture-controls > label { display: inline-flex; align-items: center; gap: 8px; margin: 8px; }
.fixture-controls select, .fixture-controls button { min-height: 32px; }
#check-results { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 12px; }
#check-results[data-pass="true"] { color: var(--success-text); }
#check-results[data-pass="false"] { color: var(--danger-text); }
.fixture-page { display: block; min-height: 0; }
.fixture-content { width: auto; min-width: 0; margin: 0; padding: 20px; }
.fixture-nav { --fixture-nav-bg: #001529; display: flex; padding: 4px; background: var(--fixture-nav-bg); border-radius: 8px; }
.fixture-nav button { width: auto; }
.fixture-card { margin-top: 16px; padding: 20px; }
.fixture-card h2 { margin: 0 0 8px; font-size: var(--fs-title-sm); }
.fixture-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); gap: 12px; margin: 16px 0; }
.fixture-fields label { display: flex; min-width: 0; flex-direction: column; gap: 6px; }
.fixture-fields input[type="file"] { width: 100%; }
.fixture-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }
.fixture-table-scroll { max-width: 100%; overflow: auto; }
.fixture-table-scroll table { width: 100%; }
.fixture-overlay { --fixture-overlay-layer: 9500; position: fixed; z-index: var(--fixture-overlay-layer); inset: 0; display: grid; place-items: center; padding: 16px; background: var(--overlay-scrim); }
.fixture-legacy { position: relative; inset: auto; width: min(600px, 100%); max-width: 100%; margin: 0; padding: 24px; box-sizing: border-box; }
@media (max-width: 560px) { .fixture-content, .fixture-card { padding: 12px; } }
</style>
