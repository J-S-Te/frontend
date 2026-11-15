<script setup>
// 合同草稿表单的字段区（治理批次 3 合同页，自 ContractManagementView.vue 逐字迁移）。
//
// 职责边界：
// - 只渲染字段与目录/展示状态，持有必填（required）等原生校验属性；
// - 不提交、不关闭弹窗、不读写路由：所有编辑动作通过明确事件交回父层，
//   父层是唯一提交者（保存草稿/保存并发起审批都在父层）；
// - 表单对象由父层传入（有类型的完整草稿），字段编辑按既有 v-model 就地写回同一份对象，
//   与拆分前的双向绑定语义一致；父层替换整份表单时通过 replace-form 事件回传。
import ContractPricingFields from './ContractPricingFields.vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import LocalContractSourcePicker from '@/modules/contract_management/components/LocalContractSourcePicker.vue'
import { isContractAmountField, isSystemContractNumberField } from '@/modules/contract_management/utils/systemTemplateFields'

/**
 * @typedef {Object} ContractDraftServiceItem
 * @property {string} [source_id] 既有服务项来源身份（编辑态保留）
 * @property {string} service_type
 * @property {string} name
 * @property {string} site
 * @property {string} batch
 * @property {string} category
 * @property {string} [category_id] 本地类别引用
 * @property {number} [category_version] 本地类别版本
 * @property {string} requirement
 * @property {string} test_mode 'STANDARD' | 'PENETRATION'
 * @property {Array<{ name: string, level: string }>} systems
 */

/**
 * @typedef {Object} ContractDraftPaymentTerm
 * @property {number|string} installment_no
 * @property {string} due_date
 * @property {string} amount
 */

/**
 * 完整草稿表单。除下列字段外，本地目录来源会补充 counterparty_source / local_counterparty_id /
 * counterparty_version / category_source 等可选扩展字段，随整份表单一起提交。
 * @typedef {Object} ContractDraftForm
 * @property {string} opportunity_id
 * @property {string} opportunity_name
 * @property {string} customer_id
 * @property {string} title
 * @property {string} contract_type
 * @property {string} amount
 * @property {string} currency
 * @property {string} customer_name
 * @property {string} customer_address
 * @property {string} customer_contact
 * @property {string} customer_phone
 * @property {string} start_date
 * @property {string} end_date
 * @property {ContractDraftPaymentTerm[]} payment_terms
 * @property {ContractDraftServiceItem[]} service_items
 * @property {string} template_id
 * @property {Record<string, string>} template_values
 * @property {string} [counterparty_source]
 * @property {string} [local_counterparty_id]
 * @property {number} [counterparty_version]
 * @property {string} [category_source]
 */

defineOptions({ name: 'ContractDraftFields' })
defineProps({
  /** 父层持有的完整草稿表单；字段编辑就地写回这一份对象。 */
  newContract: { type: /** @type {() => ContractDraftForm} */ (Object), required: true },
  /** 'template' | 'external' */
  contractCreationMode: { type: String, default: 'template' },
  editingContract: { type: Object, default: null },
  contractTemplates: { type: Array, default: () => [] },
  selectedContractTemplate: { type: Object, default: null },
  editableContractTemplateFields: { type: Array, default: () => [] },
  availableContractTypeOptions: { type: Array, default: () => [] },
  serviceTypeOptions: { type: Array, default: () => [] },
  systemLevelOptions: { type: Array, default: () => [] },
  currentUserLabel: { type: String, default: '' },
  externalContractFile: { type: Object, default: null },
  externalContractFileError: { type: String, default: '' },
  externalContractFileInputKey: { type: Number, default: 0 },
  contractSourceCapabilities: { type: Object, default: () => ({}) },
  contractFormSourceCapabilities: { type: Object, default: () => ({}) },
  localContractCounterparty: { type: Boolean, default: false },
  localContractCategories: { type: Boolean, default: false },
  canAddServiceItem: { type: Boolean, default: false },
  /** 纯谓词：服务项还能否追加系统信息，由父层组合式函数提供同一份实现。 */
  canAddSystemRow: { type: /** @type {() => (serviceItem: ContractDraftServiceItem) => boolean} */ (Function), required: true },
  detectionCategoryOptions: { type: Array, default: () => [] },
  detectionCategoryLoading: { type: Boolean, default: false },
  detectionCategoryError: { type: String, default: '' },
  opportunityOptions: { type: Array, default: () => [] },
  opportunityLoading: { type: Boolean, default: false },
  paymentPlanError: { type: String, default: '' },
  isAdmin: { type: Boolean, default: false },
  templatePreviewing: { type: Boolean, default: false },
  templatePreviewError: { type: String, default: '' },
  isExternalContractMode: { type: Boolean, default: false },
  /** 父层保存中：只用于禁用本地来源选择，避免编辑在途请求。 */
  busy: { type: Boolean, default: false },
})
// 事件只表达“用户想做一次编辑动作”，由父层决定如何执行；本组件不提交、不写路由、不关弹窗。
defineEmits([
  /** @param {'template' | 'external'} mode */
  'select-mode',
  'template-change',
  /** @param {Event} event 原始 change 事件，父层据此读取文件并可在校验失败时清空 input */
  'select-file',
  /** @param {ContractDraftForm} form 本地目录选择后重建的整份表单 */
  'replace-form',
  'open-customer-picker',
  'clear-customer',
  'focus-opportunity',
  /** @param {Event} event */
  'opportunity-change',
  'clear-opportunity',
  'add-service-item',
  /** @param {number} index */
  'remove-service-item',
  /** @param {ContractDraftServiceItem} serviceItem */
  'add-system-row',
  /** @param {ContractDraftServiceItem} serviceItem @param {number} index */
  'remove-system-row',
  'add-payment-term',
  /** @param {number} index */
  'remove-payment-term',
  'preview-template',
  'reload-detection-categories',
])
</script>

<template>
  <div class="contract-form-grid">
    <slot name="status" />
    <div v-if="!editingContract" class="contract-form-wide contract-creation-mode" role="radiogroup" aria-label="合同创建方式"><button type="button" :class="{ active: contractCreationMode === 'template' }" role="radio" :aria-checked="contractCreationMode === 'template'" @click="$emit('select-mode', 'template')"><strong>使用合同模板</strong><span>选择标准模板并填写模板字段</span></button><button type="button" :class="{ active: contractCreationMode === 'external' }" role="radio" :aria-checked="contractCreationMode === 'external'" @click="$emit('select-mode', 'external')"><strong>上传外部合同</strong><span>上传未签署 DOCX，并补全结构化字段</span></button></div>
    <label v-if="contractCreationMode === 'template'" class="contract-form-wide contract-template-first"><span>第一步：选择合同模板</span><select v-model="newContract.template_id" :disabled="Boolean(editingContract)" required @change="$emit('template-change')"><option value="" disabled>请选择用于新建合同的模板</option><option v-for="item in contractTemplates" :key="item.id" :value="item.id">{{ item.name }}（{{ item.fields?.length || 0 }} 个字段）</option></select><small>模板将生成合同正文，合同编号在审批通过后自动生成。</small></label>
    <label v-else-if="!editingContract" class="contract-form-wide contract-external-file"><span>第一步：上传外部合同原件</span><input :key="externalContractFileInputKey" required type="file" :accept="contractSourceCapabilities.pdf_enabled ? '.docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document' : '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document'" @change="$emit('select-file', $event)" /><small v-if="externalContractFile">已选择：{{ externalContractFile.name }}（{{ (externalContractFile.size / 1024 / 1024).toFixed(2) }}MB）</small><small v-else>{{ contractSourceCapabilities.pdf_enabled ? '支持 DOCX（≤10MB）或 PDF（≤20MB）；PDF原件不改写，字段需另行填写。' : '支持 DOCX（≤10MB）；当前服务端未开放PDF源文件上传。' }}</small><small v-if="externalContractFileError" class="contract-field-error" role="alert">{{ externalContractFileError }}</small></label>
    <template v-if="selectedContractTemplate || isExternalContractMode">
      <ContractPricingFields :form="newContract" :disabled="busy" />
      <LocalContractSourcePicker class="contract-form-wide" :model-value="newContract" :capabilities="contractFormSourceCapabilities" :disabled="busy" @update:model-value="$emit('replace-form', $event)" />
      <label v-if="!localContractCounterparty && (isExternalContractMode || newContract.payment_terms.length || newContract.customer_id)" :class="{ 'is-required': isExternalContractMode || newContract.payment_terms.length > 0 }"><span>CRM 客户</span><div class="contract-opportunity-control"><button class="contract-opportunity-select" type="button" @click="$emit('open-customer-picker')">{{ newContract.customer_name || '点击选择权限范围内的客户' }}</button><button v-if="newContract.customer_id" class="contract-opportunity-clear" type="button" aria-label="清除 CRM 客户" @click="$emit('clear-customer')">×</button></div><small>外部合同及付款计划须关联 CRM 客户，不能只输入客户名称</small></label>
      <label v-if="!localContractCounterparty"><span>关联商机（选填）</span><div class="contract-opportunity-control"><select v-model="newContract.opportunity_id" :disabled="isExternalContractMode && !newContract.customer_id" @focus="$emit('focus-opportunity')" @change="$emit('opportunity-change', $event)"><option value="">{{ opportunityLoading ? '正在读取商机…' : (opportunityOptions.length ? '不关联商机' : (isExternalContractMode && !newContract.customer_id ? '请先选择 CRM 客户' : '暂无可关联商机')) }}</option><option v-for="item in opportunityOptions" :key="item.id || item.opportunity_id" :value="String(item.id || item.opportunity_id || '')">{{ item.name || item.title || item.opportunity_name || '未命名商机' }}（{{ item.opportunity_no || item.code || '—' }}）</option></select><button v-if="newContract.opportunity_id" class="contract-opportunity-clear" type="button" aria-label="清除关联商机" @click="$emit('clear-opportunity')">×</button></div><small>合同编号将在审批通过后自动生成</small></label>
      <label><span>合同名称</span><input v-model="newContract.title" required maxlength="255" autocomplete="off" placeholder="请输入合同名称" /></label>
      <label><span>合同负责人</span><input :value="editingContract ? editingContract.owner_display_name : currentUserLabel" readonly aria-readonly="true" /><small>{{ editingContract ? '保留原合同创建人，不随编辑人变更' : '已根据当前登录用户自动填入' }}</small></label>
      <label><span>合同类型</span><select v-model="newContract.contract_type" required><option value="" disabled>请选择合同类型</option><option v-for="item in availableContractTypeOptions" :key="item" :value="item">{{ item }}</option></select></label>
      <div class="contract-form-wide contract-service-items"><div class="contract-section-title"><div><h3>服务项</h3><p>外部合同的场所、批次和检测类别必须完整，合同生效后将用于项目拆解；最多 20 个服务项。</p></div><button class="contract-text-button" type="button" :disabled="!canAddServiceItem" @click="$emit('add-service-item')">＋ 增加服务项</button></div><p v-if="isExternalContractMode && detectionCategoryLoading" class="contract-service-directory-state">正在读取项目管理检测类别…</p><p v-else-if="isExternalContractMode && detectionCategoryError" class="contract-field-error" role="alert">{{ detectionCategoryError }} <button type="button" @click="$emit('reload-detection-categories')">重新加载</button></p><article v-for="(serviceItem, serviceIndex) in newContract.service_items" :key="serviceIndex" class="contract-service-item"><header><strong>服务项 {{ serviceIndex + 1 }}</strong><button type="button" :aria-label="`删除服务项 ${serviceIndex + 1}`" @click="$emit('remove-service-item', serviceIndex)">×</button></header><label><span>服务类型</span><select v-model="serviceItem.service_type" required><option value="" disabled>请选择服务类型</option><option v-for="item in serviceTypeOptions" :key="item" :value="item">{{ item }}</option></select></label><label><span>服务名称</span><input v-model="serviceItem.name" maxlength="255" placeholder="默认使用服务类型" /></label><label><span>实施场所</span><input v-model="serviceItem.site" :required="isExternalContractMode" maxlength="255" placeholder="例如：上海总部" /></label><label><span>实施批次</span><input v-model="serviceItem.batch" :required="isExternalContractMode" maxlength="120" placeholder="默认：第一批次" /></label><label><span>检测类别</span><select v-if="isExternalContractMode && !localContractCategories" v-model="serviceItem.category" required :disabled="detectionCategoryLoading || !detectionCategoryOptions.length"><option value="" disabled>{{ detectionCategoryLoading ? '正在加载检测类别' : (detectionCategoryError ? '目录加载失败，请点击上方重新加载' : '请选择检测类别') }}</option><option v-for="item in detectionCategoryOptions" :key="item.category" :value="item.category">{{ item.category }}</option></select><input v-else v-model="serviceItem.category" :readonly="localContractCategories" maxlength="120" :placeholder="localContractCategories ? '请在本地目录中选择类别' : '默认使用服务类型'" /></label><label><span>检测方式</span><select v-model="serviceItem.test_mode" required><option value="STANDARD">常规检测</option><option value="PENETRATION">渗透测试</option></select></label><label><span>体系 / 能力要求</span><input v-model="serviceItem.requirement" maxlength="1000" placeholder="例如：等保三级" /></label><section class="contract-system-information"><div class="contract-section-title"><div><h3>系统信息（选填）</h3><p>每个系统将形成可独立实施的服务来源，最多 15 个。</p></div><button class="contract-text-button" type="button" :disabled="!canAddSystemRow(serviceItem)" @click="$emit('add-system-row', serviceItem)">＋ 增加系统信息</button></div><p v-if="!serviceItem.systems.length" class="contract-service-empty">尚未增加系统信息</p><div v-for="(system, systemIndex) in serviceItem.systems" :key="systemIndex" class="contract-system-row"><label><span>系统名称</span><input v-model="system.name" required maxlength="255" placeholder="请输入系统名称" /></label><label><span>系统等级</span><select v-model="system.level" required><option value="">请选择系统等级</option><option v-for="level in systemLevelOptions" :key="level" :value="level">{{ level }}</option></select></label><button type="button" aria-label="删除系统信息" @click="$emit('remove-system-row', serviceItem, systemIndex)">×</button></div></section></article></div>
      <label><span>合同金额</span><input v-model="newContract.amount" :readonly="Boolean(editingContract && isExternalContractMode)" required type="number" :min="isExternalContractMode ? 0.01 : 0" max="90071992547409.91" step="0.01" placeholder="0.00" /><small v-if="editingContract && isExternalContractMode">原件保持不变，金额不能单独修改</small></label>
      <label><span>币种</span><input v-model="newContract.currency" :readonly="Boolean(editingContract && isExternalContractMode)" required maxlength="3" pattern="[A-Za-z]{3}" autocomplete="off" /></label>
      <section class="contract-form-wide contract-payment-plan">
        <div class="contract-section-title"><div><h3>付款计划</h3><p>分期使用合同币种，合计须等于合同金额；审批开始后冻结。旧合同未维护的分期不会自动补造。</p></div><button class="contract-text-button" type="button" :disabled="newContract.payment_terms.length >= 100" @click="$emit('add-payment-term')">＋ 增加分期</button></div>
        <p v-if="!newContract.payment_terms.length">尚未维护付款计划。保存后可在草稿中补齐；没有分期的合同不会生成结算应收计划。</p>
        <div v-for="(term, index) in newContract.payment_terms" :key="index" class="contract-payment-term-row">
          <label><span>分期号</span><input v-model.number="term.installment_no" required type="number" min="1" max="100" step="1" /></label>
          <label><span>到期日</span><input v-model="term.due_date" required type="date" min="1000-01-01" max="9999-12-31" /></label>
          <label><span>金额（{{ newContract.currency }}）</span><input v-model="term.amount" required type="text" inputmode="decimal" maxlength="20" pattern="[0-9]{1,15}([.][0-9]{1,2})?" placeholder="0.00" /></label>
          <button class="contract-text-button" type="button" :aria-label="`删除第${term.installment_no}期`" @click="$emit('remove-payment-term', index)">删除</button>
        </div>
        <p v-if="paymentPlanError" class="contract-field-error" role="alert">{{ paymentPlanError }}</p>
      </section>
      <label><span>开始日期（选填）</span><input v-model="newContract.start_date" type="date" min="0001-01-01" max="9999-12-31" /></label>
      <label><span>结束日期（选填）</span><input v-model="newContract.end_date" type="date" :min="newContract.start_date || '0001-01-01'" max="9999-12-31" /></label>
      <label><span>客户名称</span><input v-model="newContract.customer_name" required maxlength="255" :readonly="isExternalContractMode || localContractCounterparty" :aria-readonly="isExternalContractMode || localContractCounterparty ? 'true' : undefined" :placeholder="localContractCounterparty ? '请从本地交易对方目录选择' : isExternalContractMode ? '请从 CRM 客户目录选择' : '请输入客户名称'" /></label>
      <label><span>客户地址</span><input v-model="newContract.customer_address" maxlength="500" placeholder="请输入客户地址" /></label>
      <label><span>客户联系人</span><input v-model="newContract.customer_contact" maxlength="128" placeholder="请输入客户联系人" /></label>
      <label><span>客户联系电话</span><input v-model="newContract.customer_phone" type="tel" inputmode="tel" maxlength="64" placeholder="请输入客户联系电话" /></label>
    </template>
  </div>
  <div v-if="selectedContractTemplate" class="contract-generated-form">
    <div class="contract-section-title"><div><h3>填写模板字段</h3><p>{{ selectedContractTemplate.original_filename }} · 姓名、账号、邮箱等当前用户已有信息会自动填入空白字段</p></div><button class="contract-button secondary small" type="button" :disabled="templatePreviewing" @click="$emit('preview-template')">{{ templatePreviewing ? '正在生成预览…' : '预览合同' }}</button></div>
    <p v-if="selectedContractTemplate.fields?.some(isSystemContractNumberField)" class="contract-info-banner">正文合同编号由系统在审批通过后自动生成，不允许手工填写。</p>
    <div class="contract-template-field-grid"><label v-for="field in editableContractTemplateFields" :key="field.name" :title="field.locked && !isAdmin ? '此项已由管理员预设' : undefined"><span>{{ field.label }}</span><input v-model="newContract.template_values[field.name]" required maxlength="2000" autocomplete="off" :readonly="isContractAmountField(field) || (field.locked && !isAdmin)" :class="{ 'is-admin-configured': field.locked && !isAdmin }" :title="field.locked && !isAdmin ? '此项已由管理员预设' : undefined" :placeholder="field.default ? `默认：${field.default}` : `请输入${field.label}`" /><small v-if="isContractAmountField(field)">自动使用上方合同金额；金额大写由服务端生成。</small><small v-else-if="field.locked && !isAdmin">此项已由管理员预设</small></label></div>
    <p v-if="templatePreviewError" class="contract-template-preview-error" role="alert">{{ templatePreviewError }}</p>
  </div>
  <p v-else-if="contractCreationMode === 'template'" class="contract-info-banner"><ConsoleIcon name="info" />请先选择合同模板，再填写合同、服务项和系统信息。</p>
</template>
