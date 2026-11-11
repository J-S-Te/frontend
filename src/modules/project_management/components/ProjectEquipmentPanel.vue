<script setup>
// 设备能力维护面板（阶段 3-项目）：模板与 CSS 类自 ProjectManagementView.vue 逐字迁移，
// 只把状态改由 useProjectEquipment 提供。主页面继续持有导航、会话、核心快照与写后刷新协调；
// 本面板不自行读取目录：目录新鲜度由主页面按需确认后作为 props 传入。
import { capabilityEffectiveStatus, capabilityStatusLabel, equipmentPresenceLabel, formatDateTime, multiSummary, statusTone } from '../projectDisplay'
import CodePills from './CodePills.vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'

const props = defineProps({
  // 设备目录行（useProjectEquipment 的按需读取结果）。
  items: { type: Array, default: () => [] },
  // 目录读取态：loading/error 都不得被渲染成“暂无设备”。
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  // 维护权限与写操作进行中标志由主页面持有，这里只做展示与门控。
  canManage: { type: Boolean, default: false },
  canPlan: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
  // 维护表单（主页面/组合式持有，字段双向绑定）。
  form: { type: Object, required: true },
  codeOptions: { type: Array, default: () => [] },
  selectedCodes: { type: Array, default: () => [] },
  hasActiveCodes: { type: Boolean, default: true },
  openMulti: { type: String, default: '' },
  multiActiveIndex: { type: Number, default: -1 },
})

const emit = defineEmits(['retry', 'edit', 'remove', 'return', 'save', 'open-import', 'toggle-multi', 'toggle-code', 'codes-keydown'])

// 用途：把键盘事件交回主页面统一处理（多选下拉的交互基线只实现一份）。
// 参数：event 为原生键盘事件。
// 返回值：无。
function onCodesKeydown(event) { emit('codes-keydown', event) }
function toggleCode(code) { emit('toggle-code', code) }
function isMultiOpen() { return props.openMulti === 'equipmentCodes' }
</script>

<template>
  <section v-if="canManage" class="pm-panel"><header class="pm-section-toolbar"><div class="pm-panel-actions"><button class="pm-button" :disabled="saving" @click="$emit('open-import')">导入设备能力 CSV</button></div><span>下载中文模板，先检测、再选择有效行导入；设备编号可留空自动生成</span></header></section>
  <section class="pm-panel pm-equipment-layout">
    <form v-if="canManage" class="pm-form pm-equipment-form" @submit.prevent="$emit('save')">
      <label><span>设备编号 <em>*</em></span><input v-model.trim="form.resourceID" required placeholder="例如 EQ-001"  maxlength="64"/></label>
      <label><span>设备名称 <em>*</em></span><input v-model.trim="form.resourceName" required placeholder="请输入设备名称"  maxlength="128"/></label>
      <div class="pm-field pm-span-full">
        <span>能力编码 <em>*</em></span>
        <div class="pm-multi-dropdown" :class="{ open: isMultiOpen() }">
          <button type="button" class="pm-multi-trigger" :class="{ placeholder: !selectedCodes.length }" aria-haspopup="listbox" :aria-expanded="isMultiOpen()" @click.stop="$emit('toggle-multi')" @keydown="onCodesKeydown"><span>{{ multiSummary(selectedCodes, codeOptions, '请选择设备能力编码', 'code') }}</span><i class="pm-multi-caret"></i></button>
          <div v-if="isMultiOpen()" class="pm-multi-menu" role="listbox" aria-label="选择设备能力编码" aria-multiselectable="true">
            <label v-for="option in codeOptions" :key="option.code" class="pm-multi-option" :class="{ 'is-active': codeOptions[multiActiveIndex]?.code === option.code }" role="option" :aria-selected="selectedCodes.includes(option.code)"><input type="checkbox" :checked="selectedCodes.includes(option.code)" @change="toggleCode(option.code)" /><span>{{ option.name }}<small v-if="option.unavailable" class="pm-form-hint">{{ option.unavailableReason }}，仅保留历史引用</small></span></label>
            <p v-if="!codeOptions.length" class="pm-empty-mini">暂无可选编码，请先到系统配置维护设备能力编码</p>
          </div>
        </div>
        <div v-if="selectedCodes.length" class="pm-multi-chips"><span v-for="option in codeOptions.filter((item) => selectedCodes.includes(item.code))" :key="option.code" class="pm-chip">{{ option.code }}{{ option.unavailable ? `（${option.unavailableReason}）` : '' }}<button type="button" class="pm-chip-x" :aria-label="`移除 ${option.code}`" @click.stop="toggleCode(option.code)">✕</button></span></div>
        <p v-if="!hasActiveCodes" class="pm-form-hint">请先到「系统配置 → 资质 / 能力编码」新增并启用设备能力编码。</p>
      </div>
      <label><span>检定开始</span><input v-model="form.validFrom" type="date" /></label>
      <label><span>检定到期</span><input v-model="form.validUntil" type="date" /></label>
      <label><span>状态</span><select v-model="form.status"><option value="ACTIVE">启用</option><option value="DISABLED">停用</option></select></label>
      <label><span>使用范围</span><select v-model="form.usageScope"><option value="ANY">可借出</option><option value="COMPANY_ONLY">仅在公司使用（不可借出）</option></select></label>
      <button class="pm-button primary" :disabled="saving">{{ saving ? '保存中…' : '保存设备' }}</button>
    </form>
    <p v-else class="pm-form-hint">当前角色只能查看设备台账；维护设备需要「设备维护」权限。</p>
  </section>
  <section class="pm-table-panel"><div class="pm-table-scroll"><table class="pm-table"><thead><tr><th scope="col">设备编号</th><th scope="col">设备名称</th><th scope="col">能力</th><th scope="col">检定有效期</th><th scope="col">状态</th><th scope="col">在位 / 使用范围</th><th scope="col">操作</th></tr></thead><tbody><tr v-for="item in items" :key="item.resource_id"><td class="mono">{{ item.resource_id }}</td><td><b>{{ item.resource_name }}</b></td><td><CodePills :codes="item.codes || []" /></td><td>{{ item.valid_until ? formatDateTime(item.valid_until) : '未设置' }}</td><td><span class="pm-badge" :class="statusTone(capabilityEffectiveStatus(item))">{{ capabilityStatusLabel(item) }}</span><small v-if="item.status_reason" class="pm-cell-sub">{{ item.status_reason }}</small></td><td><span class="pm-badge" :class="item.presence === 'OUT_OF_COMPANY' ? 'amber' : 'normal'">{{ equipmentPresenceLabel(item) }}</span><small v-if="item.borrowed_by" class="pm-cell-sub">{{ item.borrowed_by }} · {{ item.borrowed_window }}</small><small v-if="item.usage_scope === 'COMPANY_ONLY'" class="pm-form-hint">仅在公司使用 · 不可借出</small></td><td><button v-if="canManage" class="pm-link" :disabled="saving" @click="$emit('edit', item)">编辑 / 更新</button><button v-if="canManage" class="pm-link danger" :disabled="saving" @click="$emit('remove', item)">删除</button><button v-if="item.presence === 'OUT_OF_COMPANY' && (canManage || canPlan)" class="pm-link danger" :disabled="saving" @click="$emit('return', item)">归还</button></td></tr></tbody></table></div><p v-if="loading" class="pm-form-hint" role="status">正在读取设备目录…</p><p v-else-if="error" class="pm-form-hint" role="alert">{{ error }}<button type="button" class="pm-link" @click="$emit('retry')">重试读取目录</button></p><div v-else-if="!items.length" class="pm-empty"><ConsoleIcon name="info" /><b>暂无设备</b><span>使用上方表单新增设备。</span></div></section>
</template>
