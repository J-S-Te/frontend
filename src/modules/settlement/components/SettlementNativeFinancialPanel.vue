<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { todayBusinessDate } from '../../shared/utils/businessTime.js'
import PaginationBar from '@/modules/shared/components/PaginationBar.vue'
import { createNativeFinancialForm, nativeFinancialPayload, NATIVE_EVIDENCE_TYPES } from '../nativeFinancial.js'

const props = defineProps({
  api: { type: Object, required: true },
  disabled: Boolean,
  initialCapabilities: { type: Object, default: null },
  initialItems: { type: Array, default: () => [] },
})
const emit = defineEmits(['changed'])
const capabilities = ref(props.initialCapabilities)
const items = ref(props.initialItems)
const customers = ref([])
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const customerName = ref('')
const offset = ref(0)
const customerOffset = ref(0)
// 分页条需要 1 基页码；服务端/本地仍是 offset 语义，换算集中在这里。
const CUSTOMER_PAGE_SIZE = 100
const EVIDENCE_PAGE_SIZE = 20
const customerPage = computed(() => Math.floor(customerOffset.value / CUSTOMER_PAGE_SIZE) + 1)
const evidencePage = computed(() => Math.floor(offset.value / EVIDENCE_PAGE_SIZE) + 1)
function changeCustomerPage(target) {
  const delta = Math.max(1, Math.trunc(Number(target) || 1)) - customerPage.value
  return delta === 0 ? undefined : turnPage('customer', delta)
}
function changeEvidencePage(target) {
  const delta = Math.max(1, Math.trunc(Number(target) || 1)) - evidencePage.value
  return delta === 0 ? undefined : turnPage('baseline', delta)
}
const voidReasons = reactive({})
const form = reactive(createNativeFinancialForm(todayBusinessDate()))
const canWrite = computed(() => capabilities.value?.native_financial_enabled === true &&
  capabilities.value?.can_create === true && !props.disabled && !loading.value && !busy.value && !error.value)

// 用途：从服务端读取能力与有界数据，失败时关闭写入口。
// 参数：无。
// 返回值：无；错误可见且支持再次读取。
async function reload() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    capabilities.value = await props.api.capabilities()
    if (capabilities.value?.native_financial_enabled !== true) return
    const [customerPage, baselinePage] = await Promise.all([
      props.api.listCustomers({ limit: 100, offset: customerOffset.value }),
      props.api.listBaselines({ limit: 20, offset: offset.value }),
    ])
    customers.value = customerPage.items || []
    items.value = baselinePage.items || []
  } catch (cause) {
    error.value = cause?.message || '本地财务依据读取失败'
  } finally { loading.value = false }
}

// 用途：通过服务端登记本地客户，随后使用返回的命名空间引用。
// 参数：无。
// 返回值：无；不由浏览器生成客户ID。
async function submitCustomer() {
  if (!canWrite.value || !customerName.value.trim()) return
  busy.value = true
  error.value = ''
  try {
    const value = await props.api.createCustomer({ name: customerName.value.trim() })
    form.customer_key = value.customer_key
    customerName.value = ''
    await reload()
    if (!customers.value.some((item) => item.customer_key === value.customer_key)) customers.value.unshift(value)
    notice.value = '本地客户已登记'
  } catch (cause) { error.value = cause?.message || '本地客户登记失败' }
  finally { busy.value = false }
}

// 用途：提交完整本地依据及分期，成功后刷新现有应收入口。
// 参数：无。
// 返回值：无；网络失败保留表单供核对和同键重试。
async function submitBaseline() {
  if (!canWrite.value) return
  busy.value = true
  error.value = ''
  try {
    const value = await props.api.createBaseline(nativeFinancialPayload(form, todayBusinessDate()))
    Object.assign(form, createNativeFinancialForm(todayBusinessDate()))
    notice.value = '本地财务依据已登记，分期待原计划确认流程确认'
    await reload()
    emit('changed', value)
  } catch (cause) { error.value = cause?.message || '本地依据登记失败' }
  finally { busy.value = false }
}

// 用途：明确请求作废仍未形成正式账务的依据，不改动有账务的财务头。
// 参数：item 为当前版本的真实本地依据。
// 返回值：无；服务端消费门禁错误原样显示。
async function voidBaseline(item) {
  if (!canWrite.value || !voidReasons[item.id]?.trim()) return
  busy.value = true
  error.value = ''
  try {
    await props.api.voidBaseline(item.id, { version: item.version, reason: voidReasons[item.id].trim() })
    delete voidReasons[item.id]
    notice.value = '财务依据已作废，历史记录保留'
    await reload()
    emit('changed', { id: item.id, status: 'VOID' })
  } catch (cause) { error.value = cause?.message || '财务依据作废失败' }
  finally { busy.value = false }
}

// 用途：追加一条明确分期，保持最多100期。
// 参数：无。
// 返回值：无。
function addTerm() {
  if (!canWrite.value || form.payment_terms.length >= 100) return
  const next = Math.max(...form.payment_terms.map((item) => Number(item.installment_no) || 0)) + 1
  form.payment_terms.push({ installment_no: next, due_date: todayBusinessDate(), amount: '' })
}

// 用途：在有界列表间翻页，保留服务端范围裁剪。
// 参数：kind 为customer或baseline，direction为前后页方向。
// 返回值：无。
async function turnPage(kind, direction) {
  if (loading.value || busy.value) return
  const target = kind === 'customer' ? customerOffset : offset
  target.value = Math.max(0, target.value + direction * (kind === 'customer' ? 100 : 20))
  await reload()
}

onMounted(reload)
</script>

<template>
  <section class="native-financial" aria-label="本地财务依据">
    <header><h3>本地财务依据</h3><button type="button" :disabled="loading || busy" @click="reload">刷新 / 重试</button></header>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="!capabilities">正在读取本地财务能力。</p>
    <p v-else-if="!capabilities.native_financial_enabled">本地财务依据能力未启用。</p>
    <template v-else>
      <p>登记客户采购或确认依据后，沿用计划确认、回款、核销及开票审批流程。</p>
      <p v-if="!capabilities.can_create">当前授权可读取依据，登记和作废需要已有财务经理或管理员的完整范围权限。</p>
      <form v-if="capabilities.can_create" @submit.prevent="submitCustomer">
        <fieldset :disabled="!canWrite"><legend>登记本地客户</legend>
          <label>客户名称<input v-model="customerName" required maxlength="255"></label>
          <button type="submit">登记客户</button>
        </fieldset>
      </form>
      <form v-if="capabilities.can_create" @submit.prevent="submitBaseline">
        <fieldset :disabled="!canWrite"><legend>登记财务依据</legend>
          <label>本地客户<select v-model="form.customer_key" required><option value="">请选择</option>
            <option v-for="customer in customers" :key="customer.id" :value="customer.customer_key">{{ customer.name }}</option>
          </select></label>
          <PaginationBar
            label="本地客户分页"
            prev-text="上一页客户"
            next-text="下一页客户"
            :page="customerPage"
            :count="customers.length"
            :page-size="CUSTOMER_PAGE_SIZE"
            :has-more="customers.length >= CUSTOMER_PAGE_SIZE"
            :loading="loading"
            :disabled="busy"
            @change="changeCustomerPage"
          />
          <label>本地单据编号（留空自动生成）<input v-model="form.document_no" maxlength="128"></label>
          <label>依据总额<input v-model="form.amount" required inputmode="decimal" maxlength="19"></label>
          <label>币种<input v-model="form.currency" required maxlength="3"></label>
          <label>生效日期<input v-model="form.effective_date" type="date" :max="todayBusinessDate()" required></label>
          <label>依据类型<select v-model="form.evidence_type" required><option v-for="type in NATIVE_EVIDENCE_TYPES"
            :key="type.value" :value="type.value">{{ type.label }}</option></select></label>
          <label>依据编号或引用<input v-model="form.evidence_reference" required maxlength="200"></label>
          <label>依据说明<textarea v-model="form.evidence_note" required maxlength="1000"></textarea></label>
          <label>登记原因<textarea v-model="form.reason" required maxlength="500"></textarea></label>
          <fieldset><legend>分期计划</legend>
            <div v-for="(term, index) in form.payment_terms" :key="index" class="native-term">
              <label>期号<input v-model="term.installment_no" type="number" min="1" required></label>
              <label>到期日<input v-model="term.due_date" type="date" required></label>
              <label>金额<input v-model="term.amount" required inputmode="decimal" maxlength="19"></label>
              <button type="button" :disabled="form.payment_terms.length <= 1" @click="form.payment_terms.splice(index, 1)">移除</button>
            </div>
            <button type="button" :disabled="form.payment_terms.length >= 100" @click="addTerm">增加分期</button>
          </fieldset>
          <button type="submit">登记依据与待确认计划</button>
        </fieldset>
      </form>
      <h4>已登记依据</h4>
      <p v-if="items.length === 0 && !loading">暂无本地财务依据。</p>
      <article v-for="item in items" :key="item.id">
        <h4>{{ item.local_document_no }} · 本地财务依据</h4>
        <p>{{ item.customer_name }} · {{ item.amount }} {{ item.currency }} · {{ item.status === 'VOID' ? '已作废' : '有效' }}</p>
        <p>依据引用：{{ item.evidence_reference }}</p><p class="native-note">{{ item.evidence_note }}</p>
        <form v-if="capabilities.can_create && item.status === 'EFFECTIVE'" @submit.prevent="voidBaseline(item)">
          <fieldset :disabled="!canWrite"><legend>未消费依据作废</legend>
            <p>仅未确认计划且没有正式应收、开票或催收记录时可作废；已有账务请使用原调整、冲销或红票流程。</p>
            <label>作废原因<input v-model="voidReasons[item.id]" required maxlength="500"></label>
            <button type="submit">作废此依据</button>
          </fieldset>
        </form>
      </article>
      <PaginationBar
        label="本地财务依据分页"
        prev-text="上一页依据"
        next-text="下一页依据"
        :page="evidencePage"
        :count="items.length"
        :page-size="EVIDENCE_PAGE_SIZE"
        :has-more="items.length >= EVIDENCE_PAGE_SIZE"
        :loading="loading"
        :disabled="busy"
        @change="changeEvidencePage"
      />
    </template>
  </section>
</template>

<style scoped>
.native-financial { display: grid; gap: 1rem; min-width: 0; }
.native-financial header, .native-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem; }
.native-financial header { justify-content: space-between; }
.native-financial fieldset { display: grid; gap: .75rem; border: 1px solid var(--border-color, #d7dce5); border-radius: .5rem; min-width: 0; }
.native-financial label { display: grid; gap: .35rem; min-width: 0; }
.native-financial input, .native-financial select, .native-financial textarea { max-width: 100%; min-width: 0; }
.native-term { display: grid; grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr)); align-items: end; gap: .5rem; }
.native-financial article { border-top: 1px solid var(--border-color, #d7dce5); padding-top: 1rem; overflow-wrap: anywhere; }
.native-note { white-space: pre-wrap; }
</style>
