<script setup>
import { formatCRMError } from '../api/errorMessages.js'
import { createRequestScope } from '@/modules/platform/shared/composables/requestScope'
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import ConfirmDialog from '@/modules/shared/components/ConfirmDialog.vue'
import { useConfirmDialog } from '@/modules/shared/composables/useConfirmDialog.js'
import {
  createPresaleApprovalRule,
  deletePresaleApprovalRule,
  listPresaleApprovalRules,
  updatePresaleApprovalRule,
} from '../api/presale.js'

const props = defineProps({ isAdmin: { type: Boolean, default: false } })
const rules = ref([])
const loading = ref(false)
const saving = ref(false)
const deletingRuleId = ref('')
const error = ref('')
const { dialog: confirmDialog, askConfirm, accept: acceptConfirm, cancel: cancelConfirm } = useConfirmDialog()
// 规则读取请求作用域：重复读取只采纳最后一次；组件卸载后在途响应整体失效，
// 不会回写已销毁组件的状态（R04/R05）。
const rulesScope = createRequestScope()
const editing = ref(null)
const activeRuleId = ref('')
const rulesExpanded = ref(true)
const editorExpanded = ref(true)
// 编辑区默认收起：只有「编辑」「新增规则」（以及点规则行）才展开，默认不占列表旁边的位置。
const editorOpen = ref(false)
const editorCardRef = ref(null)
const editorTitleRef = ref(null)
const form = reactive({
  id: '',
  name: '',
  priority: 0,
  enabled: true,
  expression: {
    logical: 'and',
    conditions: [{ field: 'urgency', operator: 'eq', value: 'NORMAL' }],
  },
  nodes: [],
})
const nodeTypes = [
  { value: 'APPROVAL', label: '审批' },
  { value: 'DEPARTMENT_ASSIGNMENT', label: '选择部门' },
  { value: 'TEAM_LEAD_ASSIGNMENT', label: '选择团队负责人' },
  { value: 'EXECUTOR_ASSIGNMENT', label: '选择执行人' },
  { value: 'PERSON_ASSIGNMENT', label: '选择人员（历史一级）' },
]
const roles = [
  { value: 'sales_director', label: '销售总监' },
  { value: 'technical_director', label: '技术总监' },
  { value: 'team_lead', label: '团队负责人' },
]
const canEdit = computed(() => props.isAdmin)
// 编辑卡是否渲染：无权限时不渲染，默认也收起，只有用户主动编辑/新增才出现。
const editorVisible = computed(() => canEdit.value && editorOpen.value)

function reset() {
  Object.assign(form, {
    id: '',
    name: '',
    priority: 0,
    enabled: true,
    expression: {
      logical: 'and',
      conditions: [{ field: 'urgency', operator: 'eq', value: 'NORMAL' }],
    },
    nodes: [
      { id: 'sales-director', name: '销售总监审批', type: 'APPROVAL', role_code: 'sales_director' },
      { id: 'technical-director', name: '技术总监审批', type: 'APPROVAL', role_code: 'technical_director' },
      { id: 'department', name: '选择执行部门', type: 'DEPARTMENT_ASSIGNMENT', role_code: 'technical_director' },
      // 技术总监可以同时承担部门和团队负责人两个动作；执行人由被指派的负责人选择。
      { id: 'team-lead', name: '选择团队负责人', type: 'TEAM_LEAD_ASSIGNMENT', role_code: 'technical_director' },
      { id: 'executor', name: '选择执行人', type: 'EXECUTOR_ASSIGNMENT', role_code: 'team_lead' },
    ],
  })
  editing.value = null
  activeRuleId.value = ''
}

// reportError=false 供保存/删除成功后的重读使用：读取失败只返回 false，由调用方
// 给出“已保存，最新列表读取失败”的准确提示，不误报为保存/删除失败。
async function load({ reportError = true } = {}) {
  const ticket = rulesScope.begin('PRESALE_APPROVAL_RULES')
  loading.value = true
  error.value = ''
  let loaded = false
  try {
    const result = await listPresaleApprovalRules()
    if (!rulesScope.isCurrent(ticket)) return false
    rules.value = result?.data || result || []
    if (!activeRuleId.value && rules.value.length) activeRuleId.value = String(rules.value[0].id)
    if (activeRuleId.value && !rules.value.some((rule) => String(rule.id) === String(activeRuleId.value))) activeRuleId.value = rules.value[0] ? String(rules.value[0].id) : ''
    // 列表重读后不再顺手打开编辑器：编辑器只在用户主动编辑/新增时展开。
    // 已展开时只做一件事——正在编辑的规则被他人删掉了就回退到仍有权限查看的规则，
    // 没有可回退的规则则保留新建态，可见性仍由用户上次的操作决定。
    const editingID = String(editing.value || '')
    const editingStillExists = editingID && rules.value.some((rule) => String(rule.id) === editingID)
    if (editorOpen.value && editingID && !editingStillExists) {
      const nextRule = rules.value.find((rule) => String(rule.id) === String(activeRuleId.value)) || rules.value[0]
      if (nextRule) applyRule(nextRule)
      else reset()
    }
    loaded = true
  } catch (loadError) {
    if (reportError && rulesScope.isCurrent(ticket)) error.value = formatCRMError(loadError, { fallback: '规则加载失败' })
  } finally {
    if (rulesScope.isCurrent(ticket)) loading.value = false
  }
  return loaded
}

// 只把某条规则的权威值回填到表单，不改编辑区的展开状态（列表重读、保存前回填共用）。
function applyRule(rule) {
  Object.assign(form, JSON.parse(JSON.stringify(rule)))
  editing.value = rule.id
  activeRuleId.value = String(rule.id)
  error.value = ''
}

// 编辑区收放：openEditor 只负责展开卡片，滚动与焦点交给 revealEditor。
function openEditor() {
  editorOpen.value = true
  editorExpanded.value = true
}

function closeEditor() {
  editorOpen.value = false
}

// 展开后把焦点交给标题（读屏能读出「编辑审批规则」），并把卡片滚进面板可见范围。
function revealEditor() {
  nextTick(() => {
    const title = editorTitleRef.value
    if (title && typeof title.focus === 'function') title.focus({ preventScroll: true })
    const card = editorCardRef.value
    if (card && typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
}

function edit(rule) {
  applyRule(rule)
  openEditor()
  revealEditor()
}

function selectRule(rule) {
  edit(rule)
}

// 选中态只跟着真正打开的编辑区走：编辑卡收起时不该有一行看起来“正在编辑”。
function isActiveRule(rule) {
  return editorVisible.value && String(rule.id) === String(activeRuleId.value)
}

function startCreate() {
  if (saving.value) return
  reset()
  error.value = ''
  openEditor()
  revealEditor()
}

// 放弃当前草稿：编辑已有规则时按列表里的权威值回填，新建态则回到首条规则；
// 两种情况都收起编辑区回到列表，不把半成品留在旁边。
function cancelEdit() {
  if (saving.value) return
  error.value = ''
  closeEditor()
  const target = rules.value.find((rule) => String(rule.id) === String(editing.value))
    || rules.value.find((rule) => String(rule.id) === String(activeRuleId.value))
  if (target) applyRule(target)
  else reset()
}

function toggleRules() {
  rulesExpanded.value = !rulesExpanded.value
}

function toggleEditor() {
  editorExpanded.value = !editorExpanded.value
}

function addNode() {
  if (saving.value || form.nodes.length >= 10) return
  form.nodes.push({ id: `node-${Date.now()}`, name: '新节点', type: 'APPROVAL', role_code: 'team_lead' })
}

// 与服务端 ApprovalRule 校验保持一致，提前给出可执行的提示，
// 避免落到 CRM_PRESALE_INVALID_INPUT 的通用文案上。
function validateRule() {
  if (!form.name.trim()) return '请填写规则名称。'
  if (!form.nodes.length) return '至少需要一个审批节点。'
  if (form.nodes.length > 10) return '审批节点最多 10 个。'
  const first = form.nodes[0]
  if (first.type !== 'APPROVAL') return '首审节点必须是「审批」类型。'
  if (!first.role_code) return '首审节点必须选择审批角色。'
  const seenIDs = new Set()
  const assignmentTypes = new Set()
  const roleActions = new Map()
  const assignmentNodeTypes = new Set(['DEPARTMENT_ASSIGNMENT', 'TEAM_LEAD_ASSIGNMENT', 'EXECUTOR_ASSIGNMENT', 'PERSON_ASSIGNMENT'])
  for (const node of form.nodes) {
    if (!node.id || !String(node.name || '').trim()) return '每个节点都需要编号和名称。'
    if (seenIDs.has(node.id)) return '节点编号重复，请删除或重命名重复节点。'
    seenIDs.add(node.id)
    if (assignmentNodeTypes.has(node.type)) {
      if (!node.role_code) return '节点「' + node.name + '」必须选择执行角色。'
      if (assignmentTypes.has(node.type)) return '同一种执行动作只能配置一次；技术总监可以同时承担选择部门和选择团队负责人。'
      assignmentTypes.add(node.type)
      if (!roleActions.has(node.role_code)) roleActions.set(node.role_code, new Set())
      roleActions.get(node.role_code).add(node.type)
    }
  }
  if (assignmentTypes.has('PERSON_ASSIGNMENT') && (assignmentTypes.has('TEAM_LEAD_ASSIGNMENT') || assignmentTypes.has('EXECUTOR_ASSIGNMENT'))) {
    return '历史一级「选择人员」不能与两级执行指派节点混用。'
  }
  if (assignmentTypes.has('TEAM_LEAD_ASSIGNMENT') !== assignmentTypes.has('EXECUTOR_ASSIGNMENT') ||
      (assignmentTypes.has('TEAM_LEAD_ASSIGNMENT') && !assignmentTypes.has('DEPARTMENT_ASSIGNMENT'))) {
    return '两级执行指派必须同时配置「选择部门」「选择团队负责人」「选择执行人」。'
  }
  if (assignmentTypes.has('TEAM_LEAD_ASSIGNMENT')) {
    const combined = Array.from(roleActions.values()).some((actions) => actions.has('DEPARTMENT_ASSIGNMENT') && actions.has('TEAM_LEAD_ASSIGNMENT'))
    if (!combined) return '「选择部门」和「选择团队负责人」必须由同一角色承担。'
  }
  return ''
}

async function save() {
  if (!canEdit.value || saving.value) return
  const problem = validateRule()
  if (problem) {
    // 校验失败：编辑区必须保持展开，用户才看得到这条提示。
    editorOpen.value = true
    editorExpanded.value = true
    error.value = problem
    return
  }
  saving.value = true
  error.value = ''
  let saved = false
  try {
    const payload = JSON.parse(JSON.stringify(form))
    delete payload.id
    if (editing.value) {
      await updatePresaleApprovalRule(editing.value, {
        ...payload,
        id: editing.value,
        version: form.version,
      })
    } else {
      await createPresaleApprovalRule(payload)
    }
    saved = true
  } catch (saveError) {
    // 保存失败：保留草稿与当前编辑状态，走既有错误区域，不自动重发。
    error.value = formatCRMError(saveError, {
      fallback: '规则保存失败',
      ...(String(saveError?.code || '') === 'CRM_PRESALE_INVALID_INPUT'
        ? { message: '审批规则不符合要求：请检查规则名称、节点数量（1-10）、首审节点是否为「审批」并选择角色，以及两级节点的动作类型、角色组合是否完整。' }
        : {}),
    })
  } finally {
    saving.value = false
  }
  if (!saved) return
  // 保存成功：先收起编辑区回到列表，再重读权威数据（重读失败也不会把编辑器拉起来）。
  closeEditor()
  reset()
  // 任务 B（保存/刷新分离）：规则已保存（HTTP 200）；其后列表重读失败只说明展示未更新，
  // 不得报成“规则保存失败”，也不回退刚保存的结果。
  if (!(await load({ reportError: false }))) {
    error.value = '规则已保存，但最新列表读取失败，请刷新页面核对。'
  }
}

// 用途：确认删除指定售前规则，确认后复核权限、忙锁与规则版本。
// 参数：rule 为用户选择删除的售前审批规则。
// 返回值：无；取消或状态变化不删除，失败保留错误提示。
async function remove(rule) {
  if (!canEdit.value || deletingRuleId.value || saving.value) return
  const id = rule.id
  const version = rule.version
  const confirmed = await askConfirm({
    title: '删除售前审批规则', description: `确认删除规则“${rule.name}”？已提交申请继续使用规则快照，新申请将不再匹配该规则。`,
    confirmText: '删除审批规则', cancelText: '保留规则', danger: true,
  })
  if (!confirmed || !canEdit.value || deletingRuleId.value || saving.value) return
  const current = rules.value.find((item) => String(item.id) === String(id))
  if (!current || current.version !== version || rule.id !== id) return
  let removed = false
  deletingRuleId.value = String(id)
  try {
    await deletePresaleApprovalRule(id, version)
    removed = true
  } catch (removeError) {
    error.value = formatCRMError(removeError, { fallback: '规则删除失败' })
  } finally {
    deletingRuleId.value = ''
  }
  if (!removed) return
  // 删掉的正是当前编辑的规则：收起编辑区回到列表，不做“偷偷跳到下一条”的隐式编辑。
  if (String(id) === String(editing.value)) {
    closeEditor()
    reset()
  }
  // 任务 B：规则已删除（HTTP 200）；其后列表重读失败只说明展示未更新，不误报为删除失败。
  if (!(await load({ reportError: false }))) {
    error.value = '规则已删除，但最新列表读取失败，请刷新页面核对。'
  }
}

onMounted(() => {
  load()
  reset()
})
</script>

<template>
  <section class="crm-panel crm-approval-rules-panel" aria-labelledby="crm-presale-approval-rules-title">
    <div class="crm-panel-heading crm-approval-rules-heading">
      <div>
        <h2 id="crm-presale-approval-rules-title">售前审批规则</h2>
        <p class="crm-note">规则按优先级从高到低匹配；已提交申请使用提交时的规则快照。</p>
      </div>
      <div class="crm-approval-heading-actions">
        <span class="crm-approval-count-badge">{{ rules.length }} 条规则</span>
        <button v-if="canEdit" class="console-button primary" type="button" :disabled="loading || saving" @click="startCreate">
          <span aria-hidden="true">＋</span>新增规则
        </button>
      </div>
    </div>

    <p v-if="error" class="crm-alert error crm-approval-rules-alert" role="alert">{{ error }}</p>

    <div class="crm-approval-rules-layout" :class="{ 'is-single': !editorVisible }">
      <section class="crm-approval-rules-list-card" aria-labelledby="crm-presale-approval-rules-list-title">
        <header class="crm-approval-card-heading">
          <div>
            <h3 id="crm-presale-approval-rules-list-title">规则列表</h3>
            <span>点击规则行即可编辑</span>
          </div>
          <button class="console-button ghost small crm-approval-collapse-button" type="button" :aria-expanded="rulesExpanded" @click="toggleRules">
            <span class="crm-approval-chevron" :class="{ 'is-open': rulesExpanded }" aria-hidden="true">⌄</span>{{ rulesExpanded ? '收起列表' : '展开列表' }}
          </button>
        </header>

        <div v-show="rulesExpanded" class="crm-approval-rules-body">
          <div v-if="loading" class="crm-approval-rules-loading" role="status">
            <span class="crm-approval-spinner" aria-hidden="true"></span>
            <span>正在读取审批规则…</span>
          </div>
          <div v-else-if="!rules.length" class="crm-approval-rules-empty">
            <strong>暂无审批规则</strong>
            <span>创建规则后，新的售前申请会按优先级自动匹配审批流程。</span>
            <button v-if="canEdit" class="console-button primary small" type="button" @click="startCreate">新建规则</button>
          </div>
          <div v-else class="crm-approval-rules-list" role="list">
            <div v-for="rule in rules" :key="rule.id" class="crm-approval-rule-row" :class="{ 'is-active': isActiveRule(rule) }" role="listitem">
              <button class="crm-approval-rule-select" type="button" :aria-pressed="isActiveRule(rule)" @click="selectRule(rule)">
                <span class="crm-approval-rule-dot" :class="{ 'is-enabled': rule.enabled }" aria-hidden="true"></span>
                <span class="crm-approval-rule-main">
                  <span class="crm-approval-rule-title">
                    <strong :title="rule.name">{{ rule.name }}</strong>
                    <span :class="['crm-approval-status', rule.enabled ? 'is-enabled' : 'is-disabled']">{{ rule.enabled ? '已启用' : '已停用' }}</span>
                  </span>
                  <span class="crm-approval-rule-meta">
                    <span class="crm-approval-priority">优先级 {{ rule.priority }}</span>
                    <span>{{ rule.nodes?.length || 0 }} 个节点</span>
                  </span>
                </span>
              </button>
              <div v-if="canEdit" class="crm-approval-rule-actions">
                <button class="console-button ghost small" type="button" :disabled="saving || Boolean(deletingRuleId)" @click.stop="edit(rule)">编辑</button>
                <button class="console-button ghost small crm-approval-delete" type="button" :disabled="saving || deletingRuleId === String(rule.id)" @click.stop="remove(rule)">
                  {{ deletingRuleId === String(rule.id) ? '删除中…' : '删除' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <form v-if="editorVisible" ref="editorCardRef" class="crm-approval-rule-editor" @submit.prevent="save" aria-labelledby="crm-presale-approval-editor-title">
        <header class="crm-approval-editor-heading">
          <div class="crm-approval-editor-heading-copy">
            <span class="crm-approval-editor-eyebrow">审批流程配置</span>
            <strong id="crm-presale-approval-editor-title" ref="editorTitleRef" tabindex="-1">{{ editing ? '编辑审批规则' : '新建审批规则' }}</strong>
            <span>{{ editing ? `正在编辑「${form.name || '未命名规则'}」，保存后仅影响新提交的申请。` : '填写名称与优先级，再按执行顺序配置审批节点。' }}</span>
          </div>
          <div class="crm-approval-editor-heading-actions">
            <span :class="['crm-approval-status', form.enabled ? 'is-enabled' : 'is-disabled']">{{ form.enabled ? '启用中' : '已停用' }}</span>
            <button class="console-button ghost small crm-approval-collapse-button" type="button" :aria-expanded="editorExpanded" @click="toggleEditor">
              <span class="crm-approval-chevron" :class="{ 'is-open': editorExpanded }" aria-hidden="true">⌄</span>{{ editorExpanded ? '收起编辑' : '展开编辑' }}
            </button>
          </div>
        </header>

        <div v-show="editorExpanded" class="crm-approval-editor-body">
          <div class="crm-approval-rule-fields">
            <label class="crm-approval-field">
              <span>规则名称 <em>必填</em></span>
              <input v-model.trim="form.name" required maxlength="128" placeholder="例如：标准售前审批" />
            </label>
            <label class="crm-approval-field">
              <span>优先级</span>
              <input v-model.number="form.priority" type="number" step="1" />
              <small>数值越大越先匹配</small>
            </label>
            <label class="crm-approval-switch">
              <input v-model="form.enabled" type="checkbox" role="switch" :aria-checked="form.enabled" />
              <span class="crm-approval-switch-track" aria-hidden="true"></span>
              <span class="crm-approval-switch-copy"><strong>启用此规则</strong><small>停用后新申请不再匹配。</small></span>
            </label>
          </div>

          <div class="crm-approval-nodes">
            <div class="crm-approval-node-toolbar">
              <div class="crm-approval-node-heading">
                <strong>流程节点</strong>
                <span>按顺序执行，共 {{ form.nodes.length }} 个（最多 10 个）</span>
              </div>
              <button class="console-button secondary small" type="button" :disabled="saving || form.nodes.length >= 10" @click="addNode">添加节点</button>
            </div>
            <div class="crm-approval-node-table">
              <div class="crm-approval-node-head" aria-hidden="true">
                <span>序号</span><span>节点名称</span><span>节点类型</span><span>角色</span><span>操作</span>
              </div>
              <div class="crm-approval-node-list">
                <div v-for="(node, index) in form.nodes" :key="node.id" class="crm-approval-node">
                  <span class="crm-approval-node-index" aria-hidden="true">{{ index + 1 }}</span>
                  <input v-model.trim="node.name" class="crm-approval-node-name" required placeholder="节点名称" :aria-label="`第 ${index + 1} 个节点名称`" maxlength="128" />
                  <select v-model="node.type" class="crm-approval-node-type" :aria-label="`第 ${index + 1} 个节点类型`">
                    <option v-for="item in nodeTypes" :key="item.value" :value="item.value">{{ item.label }}</option>
                  </select>
                  <select v-model="node.role_code" class="crm-approval-node-role" :aria-label="`第 ${index + 1} 个节点角色`">
                    <option v-for="item in roles" :key="item.value" :value="item.value">{{ item.label }}</option>
                  </select>
                  <button class="console-button ghost small crm-approval-node-remove" type="button" :disabled="form.nodes.length <= 1 || saving" :aria-label="`删除第 ${index + 1} 个节点`" @click="form.nodes.splice(index, 1)">删除</button>
                </div>
              </div>
            </div>
          </div>

          <div class="crm-approval-form-footer">
            <span class="crm-note">保存后仅影响新提交的售前申请；已提交申请继续使用规则快照。</span>
            <div class="crm-approval-form-actions">
              <button class="console-button secondary" type="button" :disabled="saving" @click="cancelEdit">{{ editing ? '放弃修改' : '重置' }}</button>
              <button class="console-button primary" type="submit" :disabled="saving || loading">{{ saving ? '保存中…' : (editing ? '保存审批规则' : '创建审批规则') }}</button>
            </div>
          </div>
        </div>
      </form>
    </div>
  </section>
  <ConfirmDialog :open="Boolean(confirmDialog)" v-bind="confirmDialog || {}" @confirm="acceptConfirm" @cancel="cancelConfirm" />
</template>
