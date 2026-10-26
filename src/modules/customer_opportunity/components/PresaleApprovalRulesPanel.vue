<script setup>
import { formatCRMError } from '../api/errorMessages.js'
import { createRequestScope } from '@/modules/platform/shared/composables/requestScope'
import { computed, onMounted, reactive, ref } from 'vue'
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
// 规则读取请求作用域：重复读取只采纳最后一次；组件卸载后在途响应整体失效，
// 不会回写已销毁组件的状态（R04/R05）。
const rulesScope = createRequestScope()
const editing = ref(null)
const activeRuleId = ref('')
const rulesExpanded = ref(true)
const editorExpanded = ref(true)
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
    const activeRule = rules.value.find((rule) => String(rule.id) === String(activeRuleId.value))
    if (activeRule && !editing.value) edit(activeRule)
    loaded = true
  } catch (loadError) {
    if (reportError && rulesScope.isCurrent(ticket)) error.value = formatCRMError(loadError, { fallback: '规则加载失败' })
  } finally {
    if (rulesScope.isCurrent(ticket)) loading.value = false
  }
  return loaded
}

function edit(rule) {
  Object.assign(form, JSON.parse(JSON.stringify(rule)))
  editing.value = rule.id
  activeRuleId.value = String(rule.id)
  editorExpanded.value = true
}

function selectRule(rule) {
  activeRuleId.value = String(rule.id)
  edit(rule)
}

function toggleRules() {
  rulesExpanded.value = !rulesExpanded.value
}

function toggleEditor() {
  editorExpanded.value = !editorExpanded.value
}

function addNode() {
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
  reset()
  // 任务 B（保存/刷新分离）：规则已保存（HTTP 200）；其后列表重读失败只说明展示未更新，
  // 不得报成“规则保存失败”，也不回退刚保存的结果。
  if (!(await load({ reportError: false }))) {
    error.value = '规则已保存，但最新列表读取失败，请刷新页面核对。'
  }
}

async function remove(rule) {
  if (!canEdit.value || !window.confirm(`确认删除规则“${rule.name}”？`)) return
  // 任务 D：删除进行中禁止重复提交（确认弹窗之外的第二道防线）。
  if (deletingRuleId.value) return
  let removed = false
  deletingRuleId.value = String(rule.id)
  try {
    await deletePresaleApprovalRule(rule.id, rule.version)
    removed = true
  } catch (removeError) {
    error.value = formatCRMError(removeError, { fallback: '规则删除失败' })
  } finally {
    deletingRuleId.value = ''
  }
  if (!removed) return
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
  <section class="crm-panel crm-approval-rules-panel">
    <div class="crm-panel-heading crm-approval-rules-heading">
      <div>
        <h2>售前审批规则</h2>
        <p class="crm-note">规则按优先级匹配；已提交申请使用规则快照。</p>
      </div>
      <div class="crm-approval-heading-actions">
        <span class="crm-approval-count-badge">{{ rules.length }} 条规则</span>
        <button v-if="canEdit" class="console-button primary small" type="button" @click="reset">
          新增规则
        </button>
      </div>
    </div>

    <p v-if="error" class="crm-alert error" role="alert">{{ error }}</p>
    <p v-if="loading" class="crm-note">加载中…</p>

    <div v-if="!loading && !rules.length" class="crm-approval-rules-empty">
      <strong>暂无审批规则</strong>
      <span>创建规则后，新的售前申请将按优先级自动匹配审批流程。</span>
    </div>

    <div class="crm-approval-rules-section-heading">
      <div>
        <strong>规则列表</strong>
        <span>按优先级从高到低匹配</span>
      </div>
      <button class="console-button ghost small crm-approval-collapse-button" type="button" :aria-expanded="rulesExpanded" @click="toggleRules">
        <span class="crm-approval-chevron" :class="{ 'is-open': rulesExpanded }" aria-hidden="true">⌄</span>{{ rulesExpanded ? '收起列表' : '展开列表' }}
      </button>
    </div>
    <div v-show="rulesExpanded" class="crm-approval-rules-list">
      <div
        v-for="rule in rules"
        :key="rule.id"
        :class="['crm-approval-rule-row', { 'is-active': String(rule.id) === String(activeRuleId) }]"
        role="button"
        tabindex="0"
        @click="selectRule(rule)"
        @keydown.enter.prevent="selectRule(rule)"
      >
        <div class="crm-approval-rule-main">
          <div class="crm-approval-rule-title">
            <span class="crm-approval-rule-dot" :class="{ 'is-enabled': rule.enabled }" aria-hidden="true"></span>
            <strong>{{ rule.name }}</strong>
            <span :class="['crm-approval-status', rule.enabled ? 'is-enabled' : 'is-disabled']">
              {{ rule.enabled ? '已启用' : '已停用' }}
            </span>
          </div>
        <span class="crm-approval-rule-meta">优先级 {{ rule.priority }} · {{ rule.nodes?.length || 0 }} 个节点</span>
        </div>
        <div v-if="canEdit" class="crm-actions">
          <button class="console-button ghost small" type="button" @click.stop="edit(rule)">编辑</button>
          <button class="console-button danger small" type="button" @click.stop="remove(rule)">删除</button>
        </div>
      </div>
    </div>

    <form v-if="canEdit" class="crm-approval-rule-editor" @submit.prevent="save">
      <button class="crm-approval-editor-heading" type="button" :aria-expanded="editorExpanded" @click="toggleEditor">
        <span class="crm-approval-editor-heading-copy">
          <strong>{{ editing ? '编辑审批规则' : '新建审批规则' }}</strong>
          <span>定义规则名称、优先级和审批/指派节点</span>
        </span>
        <span class="crm-approval-editor-heading-actions">
          <span class="crm-approval-editor-badge">{{ form.enabled ? '启用中' : '已停用' }}</span>
          <span class="crm-approval-chevron" :class="{ 'is-open': editorExpanded }" aria-hidden="true">⌄</span>
        </span>
      </button>
      <div v-show="editorExpanded" class="crm-approval-editor-body">
        <div class="crm-approval-rule-fields">
          <label>
            <span>规则名称</span>
            <input v-model.trim="form.name" required maxlength="128" />
          </label>
          <label>
            <span>优先级</span>
            <input v-model.number="form.priority" type="number" />
          </label>
          <label class="checkbox">
            <input v-model="form.enabled" type="checkbox" />
            <span>启用此规则</span>
          </label>
        </div>
        <div class="crm-approval-node-toolbar">
          <div class="crm-approval-node-heading"><strong>流程节点</strong><span>按列表顺序执行，共 {{ form.nodes.length }} 个节点</span></div>
          <button class="console-button ghost small" type="button" @click="addNode">添加节点</button>
        </div>
        <div class="crm-approval-node-list">
          <div v-for="(node, index) in form.nodes" :key="node.id" class="crm-approval-node">
            <span class="crm-approval-node-index">{{ index + 1 }}</span>
            <input v-model.trim="node.name" required placeholder="节点名称" :aria-label="`第 ${index + 1} 个节点名称`"  maxlength="128"/>
            <select v-model="node.type" :aria-label="`第 ${index + 1} 个节点类型`">
              <option v-for="item in nodeTypes" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
            <select v-model="node.role_code" :aria-label="`第 ${index + 1} 个节点角色`">
              <option v-for="item in roles" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
            <button class="console-button danger small" type="button" :disabled="form.nodes.length <= 1" :aria-label="`删除第 ${index + 1} 个节点`" @click="form.nodes.splice(index, 1)">删除</button>
          </div>
        </div>
        <div class="crm-approval-form-footer">
          <span class="crm-note">保存后将用于新提交的售前申请。</span>
          <button class="console-button primary" type="submit" :disabled="saving">
            {{ saving ? '保存中…' : (editing ? '保存修改' : '创建规则') }}
          </button>
        </div>
      </div>
    </form>
  </section>
</template>
