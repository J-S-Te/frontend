<script setup>
import { computed } from 'vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import { contractOptionLabel } from '../projectDisplay'

const props = defineProps({
  open: { type: Boolean, default: false },
  project: { type: Object, default: null },
  form: { type: Object, required: true },
  contracts: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  loadError: { type: String, default: '' },
  saving: { type: Boolean, default: false },
  error: { type: String, default: '' },
})
const emit = defineEmits(['close', 'submit', 'reload'])

const reasonLength = computed(() => String(props.form?.reason || '').length)
const formReady = computed(() => !props.loadError && props.contracts.length > 0)
const submitBlocked = computed(() => props.saving || props.loading || !formReady.value)
const submitHint = computed(() => props.loading ? '正在读取补充协议目录' : (!formReady.value ? '没有可提交的补充协议目录' : ''))
</script>

<template>
  <div v-if="open" class="pm-overlay" @click.self="!saving && emit('close')">
    <form class="pm-dialog pm-dialog-wide pm-supplement-closure-dialog" role="dialog" aria-modal="true" aria-labelledby="pm-supplement-closure-title" @submit.prevent="emit('submit')">
      <header>
        <div>
          <span>补充协议</span>
          <h2 id="pm-supplement-closure-title">补充协议关账</h2>
          <small class="pm-dialog-sub">关账是补充协议分支的受控出口：绑定已审批补充协议与原因后，项目退出补充协议处理中。</small>
        </div>
        <button type="button" class="pm-icon-button" aria-label="关闭" :disabled="saving" @click="emit('close')"><ConsoleIcon name="close" /></button>
      </header>
      <div class="pm-form">
        <dl class="pm-span-full pm-supplement-closure-context">
          <div><dt>目标项目</dt><dd>{{ project ? `${project.id} · ${project.name || project.customer || '未命名项目'}` : '未选择' }}</dd></div>
          <div><dt>原合同</dt><dd>{{ project?.contract || '—' }}</dd></div>
          <div><dt>当前状态</dt><dd>{{ project?.status || '补充协议处理中' }}</dd></div>
        </dl>
        <div v-if="loading" class="pm-span-full pm-supplement-closure-state">正在读取当前客户已审批的补充协议…</div>
        <div v-else-if="loadError" class="pm-span-full pm-supplement-closure-state error" role="alert">
          {{ loadError }}
          <button type="button" class="pm-link" @click="emit('reload')">重新加载</button>
        </div>
        <template v-else>
          <label class="pm-span-full">
            <span>已审批补充协议 <em>*</em></span>
            <select v-model="form.supplementContractID" required>
              <option value="">请选择已审批补充协议</option>
              <option v-for="contract in contracts" :key="contract.id" :value="contract.id">{{ contractOptionLabel(contract) }}</option>
            </select>
            <small>只列当前客户已审批、且不同于原合同的补充协议；服务端会再次校验归属、审批状态与项目状态。</small>
          </label>
          <label class="pm-span-full">
            <span>关账原因 <em>*</em></span>
            <textarea v-model="form.reason" rows="3" required maxlength="1000" placeholder="例如 补充协议范围已全部回写，拆解已推进到实施阶段，不再重建清单"></textarea>
            <small>{{ reasonLength }}/1000 · 原因会写入交付事件，供审计追溯。</small>
          </label>
          <aside class="pm-span-full pm-supplement-closure-notice">
            <b>关账后以当前拆解范围指纹为基准</b>
            <p>之后不能再通过「确认拆解」清除补充协议标记，也不会回退已推进的服务项；范围若再变化，需要重新走「拆解调整」。</p>
          </aside>
          <p v-if="error" class="pm-span-full pm-supplement-closure-state error" role="alert">{{ error }}</p>
        </template>
      </div>
      <footer>
        <span v-if="submitHint" class="pm-dialog-footnote">{{ submitHint }}</span>
        <button type="button" class="pm-button" :disabled="saving" @click="emit('close')">取消</button>
        <button class="pm-button primary" :disabled="submitBlocked">{{ saving ? '关账中…' : '提交关账' }}</button>
      </footer>
    </form>
  </div>
</template>
