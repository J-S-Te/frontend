<script setup>
// 商机新建/编辑弹窗（前端优化计划 阶段 3-CRM，自 CustomerOpportunityView.vue 逐字迁移）。
//
// 职责边界：
// - 只渲染：表单对象、编辑态、客户下拉与类型/来源目录状态都由父层传入；字段编辑按既有
//   v-model 就地写回父层的同一份对象，弹窗开关、脏检查基线、关闭确认、提交入口都留在父层；
// - 不提交、不调用创建/更新接口：原生 <form> 通过后只上抛 submit，父层 submitOpportunity
//   是唯一提交者（更新原因、类型/来源校验、幂等重放都在那里）；
// - 目录查询与勾选切换同样上抛事件，父层/组合式函数持有加载序号与失败重试状态。
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'

defineOptions({ name: 'OpportunityEditorDialog' })
const props = defineProps({
  /** 父层持有的商机表单（新建/编辑共用同一份 reactive 对象）。 */
  form: { type: Object, required: true },
  editMode: { type: Boolean, default: false },
  /** 父层提交中：只用于禁用取消/提交，避免提交期间关闭或重复提交。 */
  busy: { type: Boolean, default: false },
  /** 详情弹窗在前时叠放为内层弹窗（层级样式由父层选中状态决定）。 */
  nested: { type: Boolean, default: false },
  customerKeyword: { type: String, default: '' },
  customerOptions: { type: Array, default: () => [] },
  customerOptionsLoading: { type: Boolean, default: false },
  customerOptionsError: { type: String, default: '' },
  customerOptionsTotal: { type: Number, default: 0 },
  catalogLoading: { type: Boolean, default: false },
  catalogError: { type: String, default: '' },
  typeOptions: { type: Array, default: () => [] },
  sourceOptions: { type: Array, default: () => [] },
  typeSelections: { type: Array, default: () => [] },
  sourceSelections: { type: Array, default: () => [] },
  /** 负责人展示名由父层按基础平台目录解析（子组件不读目录）。 */
  ownerLabel: { type: String, default: '' },
})
const emit = defineEmits([
  'submit', 'close', 'update:customer-keyword', 'search-customer', 'toggle-type', 'toggle-source',
])
</script>

<template>
  <div class="console-modal-backdrop" :class="{ nested }" role="presentation" @click.self="emit('close')">
    <form class="console-detail-modal crm-opportunity-dialog" role="dialog" aria-modal="true" :aria-label="editMode ? '编辑商机' : '新建商机'" @submit.prevent="emit('submit')">
      <header>
        <div><p class="console-modal-eyebrow">商机档案</p><h2>{{ editMode ? '编辑商机' : '新建商机' }}</h2></div>
        <button class="console-modal-close" type="button" aria-label="关闭商机表单" @click="emit('close')"><ConsoleIcon name="close" /></button>
      </header>
      <div class="console-form-grid crm-opportunity-dialog__body">
        <label class="console-form-item"><span>商机名称 *</span><input v-model="form.name" required autocomplete="off" placeholder="请输入商机名称" maxlength="200"></label>
        <label v-if="editMode" class="console-form-item"><span>关联客户</span><input :value="form.customer_id" readonly disabled></label>
        <div v-else class="console-form-item full crm-opportunity-customer-picker">
          <span>关联客户 *</span>
          <div class="crm-opportunity-customer-search"><input :value="customerKeyword" type="search" autocomplete="off" placeholder="按客户号或名称查询" @input="emit('update:customer-keyword', $event.target.value)" @keyup.enter.prevent="emit('search-customer')" maxlength="100"><button class="console-button ghost" type="button" :disabled="customerOptionsLoading" @click="emit('search-customer')">{{ customerOptionsLoading ? '查询中…' : '查询客户' }}</button></div>
          <select v-model="form.customer_id" required :disabled="customerOptionsLoading || !customerOptions.length"><option value="" disabled>{{ customerOptionsLoading ? '正在加载客户…' : '请选择客户' }}</option><option v-for="customer in customerOptions" :key="customer.id" :value="String(customer.id)">{{ customer.name }}（{{ customer.customer_no }}）· {{ customer.industry }} / {{ customer.region }}</option></select>
          <small v-if="customerOptionsError" class="crm-alert error" role="alert">{{ customerOptionsError }}</small><small v-else-if="!customerOptionsLoading && !customerOptions.length" class="crm-note">暂无符合条件的有效客户，请先在客户管理中创建客户。</small><small v-else-if="customerOptionsTotal > customerOptions.length" class="crm-note">当前显示前 {{ customerOptions.length }} 条，请输入关键词缩小范围。</small>
        </div>
        <fieldset class="console-form-item crm-opportunity-multi-field"><legend>商机类型 *（可多选）</legend><p v-if="catalogLoading" class="crm-note">正在加载商机类型…</p><p v-else-if="catalogError" class="crm-alert error" role="alert">{{ catalogError }}</p><div v-else class="crm-opportunity-check-list" aria-label="商机类型"><label v-for="item in typeOptions" :key="item.id" class="crm-opportunity-check-item"><input type="checkbox" :value="Number(item.id)" :checked="typeSelections.includes(Number(item.id))" :disabled="!item.enabled && !typeSelections.includes(Number(item.id))" @change="emit('toggle-type', Number(item.id), $event.target.checked)"><span>{{ item.name }}<small v-if="!item.enabled">（已停用）</small></span></label></div><small class="crm-note">已选择 {{ typeSelections.length }} 项，停用项仅可在历史商机中保留。</small></fieldset>
        <fieldset class="console-form-item crm-opportunity-multi-field"><legend>来源 *（可多选）</legend><p v-if="catalogLoading" class="crm-note">正在加载商机来源…</p><p v-else-if="catalogError" class="crm-alert error" role="alert">{{ catalogError }}</p><div v-else class="crm-opportunity-check-list" aria-label="来源"><label v-for="item in sourceOptions" :key="item.id" class="crm-opportunity-check-item"><input type="checkbox" :value="Number(item.id)" :checked="sourceSelections.includes(Number(item.id))" :disabled="!item.enabled && !sourceSelections.includes(Number(item.id))" @change="emit('toggle-source', Number(item.id), $event.target.checked)"><span>{{ item.name }}<small v-if="!item.enabled">（已停用）</small></span></label></div><small class="crm-note">已选择 {{ sourceSelections.length }} 项，停用项仅可在历史商机中保留。</small></fieldset>
        <label class="console-form-item"><span>预计金额 *</span><input v-model="form.expected_amount" required inputmode="decimal" autocomplete="off" placeholder="请输入预计金额" maxlength="18"></label>
        <label class="console-form-item"><span>预计签单日期 *</span><input v-model="form.expected_sign_date" type="date" required></label>
        <label class="console-form-item full"><span>需求摘要 *</span><textarea v-model="form.requirement_summary" required rows="3" placeholder="请概述客户需求和项目范围" maxlength="10000"></textarea></label>
        <label class="console-form-item"><span>系统数量</span><input v-model.number="form.system_count" type="number" min="0" placeholder="0"></label>
        <label class="console-form-item full"><span>客户痛点</span><textarea v-model="form.pain_points" rows="3" placeholder="选填" maxlength="10000"></textarea></label>
        <label class="console-form-item full"><span>竞争信息</span><textarea v-model="form.competitor_info" rows="3" placeholder="选填" maxlength="10000"></textarea></label>
        <fieldset v-if="editMode" class="crm-owner-selector crm-opportunity-owner" disabled><legend>负责人</legend><div class="console-form-grid"><label class="console-form-item"><span>负责人用户</span><input :value="ownerLabel" readonly></label><label class="console-form-item"><span>负责人组织</span><input value="由基础平台组织目录确定" readonly></label></div><p class="crm-note">商机主档编辑不变更负责人，请使用详情中的“变更负责人”。</p></fieldset>
        <label v-if="editMode" class="console-form-item full"><span>更新原因 *</span><textarea v-model="form.reason" required maxlength="500" rows="3" placeholder="请说明本次更新原因"></textarea></label>
      </div>
      <footer><button class="console-button ghost" type="button" :disabled="busy" @click="emit('close')">取消</button><button class="console-button primary" type="submit" :disabled="busy || catalogLoading || !!catalogError">{{ busy ? '提交中…' : editMode ? '保存商机' : '创建商机' }}</button></footer>
    </form>
  </div>
</template>
