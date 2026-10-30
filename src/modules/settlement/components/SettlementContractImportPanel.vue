<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { listContractImports, getContractImport, reconcileContractImport, contractImportExport,
  downloadContractImportExport, confirmReceivablePlan, createReceipt, createReceiptAllocation } from '../api/settlement.js'

const props = defineProps({ can: { type: Function, required: true }, initialSnapshotId: { type: String, default: '' } })
const rows = ref([]), page = ref(0), queryID = ref(props.initialSnapshotId), selectedID = ref(''), snapshot = ref(null)
const facts = ref({ items: [], total: 0 }), factPage = ref(0), busy = ref(false), error = ref(''), notice = ref('')
const receipt = ref({ fact: '', amount: '', receipt_date: '', payment_method: 'TRANSFER', bank_transaction_reference: '' })
const allocation = ref({ fact: '', receipt_id: '', installment_no: '', original_receipt_fact_id: '', original_allocation_id: '', amount: '' })
const statement = ref({ expected_open_amount: '', expected_receipt_amount: '', credit_decision: '', reason: '' })
const exportJob = ref(null)
let generation = 0, disposed = false
const expectedReceipts = computed(() => (snapshot.value?.expected_facts || []).filter(item => item.fact_type === 'RECEIPT'))
const expectedAllocations = computed(() => (snapshot.value?.expected_facts || []).filter(item => item.fact_type === 'ALLOCATION'))
const selectedReceiptFact = computed(() => expectedReceipts.value[Number(receipt.value.fact)])
const selectedAllocationFact = computed(() => expectedAllocations.value[Number(allocation.value.fact)])

/**
 * loadList 查询授权暂存台账页，不从普通经营列表推断HOLD数据。
 * 参数：无；使用当前页码。
 * 返回值：Promise<void>；失败保留错误提示。
 */
async function loadList() {
  busy.value = true
  try { const result = await listContractImports(page.value * 50); if (!disposed) rows.value = result.items || [] }
  catch (failure) { if (!disposed) error.value = failure.message }
  finally { if (!disposed) busy.value = false }
}

/**
 * refreshDetail 读取同一快照当前版本和实际恢复凭证映射。
 * 参数：ticket为视图代次，id为读取身份。
 * 返回值：Promise<void>；迟到响应不覆盖新选择。
 */
async function refreshDetail(ticket = generation, id = selectedID.value) {
  const [result, mappings] = await Promise.all([getContractImport(id), getContractImport(id, { facts: true, offset: factPage.value * 50 })])
  if (disposed || ticket !== generation) return
  snapshot.value = result; facts.value = mappings
}

/**
 * openSnapshot 切换暂存快照并清除上一份合同的恢复表单。
 * 参数：id为用户选择的本地快照ID。
 * 返回值：Promise<void>；所有数据仍由服务器复核范围。
 */
async function openSnapshot(id) {
  if (!id || busy.value) return
  const ticket = ++generation
  selectedID.value = id; snapshot.value = null; factPage.value = 0; busy.value = true; error.value = ''; notice.value = ''; exportJob.value = null
  queryID.value = id
  receipt.value = { fact: '', amount: '', receipt_date: '', payment_method: 'TRANSFER', bank_transaction_reference: '' }
  allocation.value = { fact: '', receipt_id: '', installment_no: '', original_receipt_fact_id: '', original_allocation_id: '', amount: '' }
  statement.value = { expected_open_amount: '', expected_receipt_amount: '', credit_decision: '', reason: '' }
  try { await refreshDetail(ticket, id) } catch (failure) { if (ticket === generation) error.value = failure.message }
  finally { if (!disposed && ticket === generation) busy.value = false }
}

/**
 * mutate 恢复实际财务事实，结果未知时先读取台账而非盲目重新提交。
 * 参数：action为固定受控API调用，message为成功提示。
 * 返回值：Promise<void>；保留真实业务ID和服务器错误。
 */
async function mutate(action, message) {
  const ticket = generation, id = selectedID.value
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const result = await action()
    await refreshDetail(ticket, id)
    if (!disposed && ticket === generation) notice.value = `${message}${result?.id ? `，业务ID：${result.id}` : ''}`
  } catch (failure) {
    try { await refreshDetail(ticket, id) } catch { /* 原错误保留，用户仍可重新查询映射。 */ }
    if (!disposed && ticket === generation) error.value = `${failure.message} 请先核对下方实际恢复映射。`
  } finally { if (!disposed && ticket === generation) busy.value = false }
}

/**
 * restoreReceipt 按已批准来源清单记录历史到账，不使用当前日期补造事实。
 * 参数：无；取当前授权快照、明确事实键和人工核实的银行凭证。
 * 返回值：Promise<void>。
 */
async function restoreReceipt() {
  const fact = selectedReceiptFact.value
  if (!fact || receipt.value.fact === '') { error.value = '请选择已批准清单中的到账事实。'; return }
  return mutate(() => createReceipt({ import_fact: { ...fact, contract_snapshot_id: selectedID.value },
    customer_id: snapshot.value.customer_id, customer_name: snapshot.value.customer_name,
    amount: receipt.value.amount, currency: snapshot.value.currency, receipt_date: receipt.value.receipt_date,
    payment_method: receipt.value.payment_method, bank_transaction_reference: receipt.value.bank_transaction_reference }), '历史到账已记录')
}

/**
 * restoreAllocation 核销已映射的历史到账与原分期关系。
 * 参数：无；所有原关系须由财务凭证核实。
 * 返回值：Promise<void>；缺关系不猜测匹配。
 */
async function restoreAllocation() {
  const fact = selectedAllocationFact.value
  const plan = snapshot.value.plans.find(item => item.installment_no === Number(allocation.value.installment_no))
  if (!fact || allocation.value.fact === '' || !plan?.receivable_id) { error.value = '请选择已批准核销事实及已确认原分期。'; return }
  return mutate(() => createReceiptAllocation({ import_fact: { ...fact, contract_snapshot_id: selectedID.value,
    original_receipt_fact_id: allocation.value.original_receipt_fact_id,
    original_installment_no: Number(allocation.value.installment_no), original_allocation_id: allocation.value.original_allocation_id },
    receipt_id: allocation.value.receipt_id, receivable_id: plan.receivable_id, amount: allocation.value.amount,
    match_mode: 'MANUAL', match_confidence: 0 }), '历史核销关系已记录')
}

/**
 * reconcile 生成本地版本化对账凭证，信用决定由当前财务用户明确批准。
 * 参数：无；预期金额取人工核实值，票据首版仅支持零票额。
 * 返回值：Promise<void>；此操作不直接解除HOLD。
 */
async function reconcile() {
  if (!statement.value.credit_decision || !statement.value.reason.trim()) { error.value = '请选择信用处理方式并填写核对批准理由。'; return }
  return mutate(() => reconcileContractImport(selectedID.value, { ...statement.value, currency: snapshot.value.currency, expected_invoiced_amount: '0.00' }), '本地核对凭证已生成，仍需合同侧独立放行')
}

/**
 * exportStatement 生成持久全量对账文件并检查真实完成状态。
 * 参数：无；仅下载当前授权快照的服务器导出结果。
 * 返回值：Promise<void>；失败不会下载空文件。
 */
async function exportStatement() {
  busy.value = true; error.value = ''
  try {
    const job = await contractImportExport(selectedID.value, exportJob.value?.id || '')
    if (disposed) return
    exportJob.value = job
    if (job.status === 'SUCCEEDED') await downloadContractImportExport(selectedID.value, job.id)
    else error.value = job.status === 'FAILED' ? `导出失败：${job.error_code || '请重试生成并核对状态'}` : '导出尚未完成，请查询任务后再下载。'
  } catch (failure) { if (!disposed) error.value = failure.message }
  finally { if (!disposed) busy.value = false }
}

/**
 * changeFactsPage 查询实际映射下一页并保留读取错误。
 * 参数：delta为上一页或下一页的方向。
 * 返回值：Promise<void>；失败不改业务事实。
 */
async function changeFactsPage(delta) {
  busy.value = true; error.value = ''; const previous = factPage.value
  factPage.value = Math.max(0, previous + delta)
  try { await refreshDetail() } catch (failure) { factPage.value = previous; error.value = failure.message }
  finally { if (!disposed) busy.value = false }
}

onMounted(async () => { await loadList(); if (props.initialSnapshotId) await openSnapshot(props.initialSnapshotId) })
onBeforeUnmount(() => { disposed = true; generation++ })
</script>

<template>
  <section class="settlement-panel import-finance-panel" aria-label="历史合同财务恢复">
    <h2>历史合同财务恢复与对账</h2>
    <p>暂存数据保持 HOLD，不进入日常催收或信用推送。必须按批准的原事实逐笔恢复；本地对账完成后，再由合同导入负责人申请独立放行。</p>
    <p class="settlement-muted">首版支持到账与核销。包含历史发票、退款、冲销或红票的清单会被阻断；不能删除该事实来绕过。</p>
    <label>查询暂存快照ID <input v-model.trim="queryID" maxlength="32" :disabled="busy" /></label>
    <button type="button" :disabled="busy || !queryID" @click="openSnapshot(queryID)">查询／刷新当前快照</button>
    <button type="button" :disabled="busy" @click="loadList">刷新暂存列表</button>
    <div class="import-record-list"><button v-for="item in rows" :key="item.contract_snapshot_id" type="button" :disabled="busy" @click="openSnapshot(item.contract_snapshot_id)">{{ item.source_contract_no || item.contract_snapshot_id }} · {{ item.state }} · {{ item.migration_state }}</button></div>
    <button type="button" :disabled="busy || page === 0" @click="page--; loadList()">上一页</button>
    <button type="button" :disabled="busy || rows.length < 50" @click="page++; loadList()">下一页</button>
    <p v-if="busy" role="status">正在读取或保存，请保留页面核对结果…</p>
    <p v-if="error" role="alert" class="settlement-error">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <template v-if="snapshot">
      <h3>{{ snapshot.source_contract_no }} · {{ snapshot.customer_name }}</h3>
      <p>客户ID {{ snapshot.customer_id }}；原合同额 {{ snapshot.currency }} {{ snapshot.contract_amount }}；本地版本 {{ snapshot.snapshot_version }}；财务状态 {{ snapshot.migration_state }}／{{ snapshot.state }}</p>
      <p>当前责任：{{ snapshot.owner_user_id || '尚未投影' }}（版本 {{ snapshot.owner_version }}，{{ snapshot.owner_matches ? '活动责任已匹配' : '尚未满足放行责任要求' }}）</p>
      <div class="import-scroll"><table><thead><tr><th>原期号／到期日</th><th>计划额／未收</th><th>确认</th></tr></thead><tbody>
        <tr v-for="plan in snapshot.plans" :key="plan.id"><td>{{ plan.installment_no }}／{{ plan.due_date }}</td><td>{{ plan.planned_amount }}／{{ plan.open_amount }}</td><td>{{ plan.confirmation_status }} <button v-if="plan.confirmation_status !== 'CONFIRMED' && can('settlement.receivable.confirm') && snapshot.migration_state === 'HOLD'" type="button" :disabled="busy" @click="mutate(() => confirmReceivablePlan(plan.id, { version: plan.version }), '原分期已确认')">确认原分期</button></td></tr>
      </tbody></table></div>
      <template v-if="snapshot.migration_state === 'HOLD'">
        <form v-if="can('settlement.receipt.record')" @submit.prevent="restoreReceipt">
          <h3>记录原到账</h3>
          <label>批准来源事实 <select v-model="receipt.fact" required :disabled="busy"><option value="">请选择</option><option v-for="(fact,index) in expectedReceipts" :key="fact.source_system + fact.external_fact_id" :value="String(index)">{{ fact.source_system }}／{{ fact.external_fact_id }}</option></select></label>
          <label>原到账金额 <input v-model.trim="receipt.amount" required maxlength="21" inputmode="decimal" :disabled="busy" /></label>
          <label>原到账日期 <input v-model="receipt.receipt_date" required type="date" :disabled="busy" /></label>
          <label>付款方式 <select v-model="receipt.payment_method" :disabled="busy"><option value="TRANSFER">转账</option><option value="BANK_ACCEPTANCE">银行承兑</option><option value="CHEQUE">支票</option><option value="CASH">现金</option></select></label>
          <label>原银行流水／凭证号 <input v-model.trim="receipt.bank_transaction_reference" required maxlength="128" :disabled="busy" /></label>
          <button type="submit" :disabled="busy">记录并核对原事实映射</button>
        </form>
        <form v-if="can('settlement.allocation.confirm')" @submit.prevent="restoreAllocation">
          <h3>恢复原核销关系</h3>
          <label>批准来源事实 <select v-model="allocation.fact" required :disabled="busy"><option value="">请选择</option><option v-for="(fact,index) in expectedAllocations" :key="fact.source_system + fact.external_fact_id" :value="String(index)">{{ fact.source_system }}／{{ fact.external_fact_id }}</option></select></label>
          <label>原分期号 <select v-model="allocation.installment_no" required :disabled="busy"><option value="">请选择</option><option v-for="plan in snapshot.plans.filter(item => item.receivable_id)" :key="plan.id" :value="plan.installment_no">第 {{ plan.installment_no }} 期</option></select></label>
          <label>本地到账ID（从下方映射核对）<input v-model.trim="allocation.receipt_id" required maxlength="32" :disabled="busy" /></label>
          <label>原到账事实编号 <input v-model.trim="allocation.original_receipt_fact_id" required maxlength="128" :disabled="busy" /></label>
          <label>原核销关系编号 <input v-model.trim="allocation.original_allocation_id" required maxlength="128" :disabled="busy" /></label>
          <label>原核销金额 <input v-model.trim="allocation.amount" required maxlength="21" inputmode="decimal" :disabled="busy" /></label>
          <button type="submit" :disabled="busy">记录原核销关系</button>
        </form>
        <form v-if="can('settlement.import.release')" @submit.prevent="reconcile">
          <h3>财务本地对账与信用决定</h3>
          <label>核实的期初未收 <input v-model.trim="statement.expected_open_amount" required maxlength="21" inputmode="decimal" :disabled="busy" /></label>
          <label>核实的原到账合计 <input v-model.trim="statement.expected_receipt_amount" required maxlength="21" inputmode="decimal" :disabled="busy" /></label>
          <p>首版不重建历史发票，预期已开票额为 0.00；存在历史票据时应停止本项并保留阻塞。</p>
          <label>信用处理 <select v-model="statement.credit_decision" required :disabled="busy"><option value="">请财务明确决定</option><option value="SUPPRESSED">不回灌信用并留存批准理由</option><option value="PUBLISH">放行后按既有路径发布信用事件</option></select></label>
          <label>核对及批准理由 <textarea v-model.trim="statement.reason" required maxlength="500" :disabled="busy" /></label>
          <button type="submit" :disabled="busy">生成版本化本地对账凭证</button>
        </form>
      </template>
      <p v-if="snapshot.reconciliation_id">对账凭证 {{ snapshot.reconciliation_id }}。凭证不等于财务已放行；任何事实变化会要求重新核对。</p>
      <h3>实际恢复映射（{{ facts.total }} 条）</h3>
      <div class="import-scroll"><table><thead><tr><th>来源系统／类型／原事实ID</th><th>本地业务ID</th></tr></thead><tbody><tr v-for="fact in facts.items" :key="fact.source_system + fact.fact_type + fact.external_fact_id"><td>{{ fact.source_system }}／{{ fact.fact_type }}／{{ fact.external_fact_id }}</td><td>{{ fact.target_business_id }}</td></tr></tbody></table></div>
      <button type="button" :disabled="busy || factPage === 0" @click="changeFactsPage(-1)">映射上一页</button>
      <button type="button" :disabled="busy || (factPage + 1) * 50 >= facts.total" @click="changeFactsPage(1)">映射下一页</button>
      <button type="button" :disabled="busy" @click="exportStatement">{{ exportJob ? '查询并下载完整对账CSV' : '生成完整对账CSV' }}</button>
      <button v-if="exportJob?.status === 'FAILED'" type="button" :disabled="busy" @click="exportJob = null; exportStatement()">重新生成对账导出</button>
      <p v-if="exportJob">导出 {{ exportJob.id }}：{{ exportJob.status }}，{{ exportJob.row_count }} 条；到账合计 {{ exportJob.receipt_total }}，核销合计 {{ exportJob.allocation_total }}。</p>
    </template>
  </section>
</template>

<style scoped>
.import-finance-panel { overflow-wrap: anywhere; }
.import-finance-panel label { display: inline-flex; flex-direction: column; gap: 6px; margin: 8px; max-width: calc(100% - 16px); }
.import-finance-panel input,.import-finance-panel select,.import-finance-panel textarea { padding: 8px; max-width: 100%; }
.import-finance-panel form { border-block-start: 1px solid #d8e0ec; padding-block: 12px; margin-block: 12px; }
.import-finance-panel button { padding: 8px; margin: 4px; }
.import-record-list { display: flex; flex-wrap: wrap; margin-block: 12px; }
.import-scroll { overflow-x: auto; }
.import-finance-panel td,.import-finance-panel th { padding: 8px; text-align: left; }
</style>
