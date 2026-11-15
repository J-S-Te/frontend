<script setup>
import { onMounted, ref } from 'vue'
import { commandStandardPrice, listStandardPrices, saveStandardPrice } from '../api/contract'
const props = defineProps({ permissions: { type: Array, default: () => [] }, actorId: { type: String, default: '' } })
const rows = ref([]), form = ref(null), error = ref(''), busy = ref(false), offset = ref(0), hasMore = ref(false)
// 用途：读取标准价管理分页。
// 参数：pageOffset为当前页起点。
// 返回值：无；状态保存在组件中。
async function load(pageOffset = 0) {
  busy.value = true; error.value = ''
  try { const page = await listStandardPrices({ offset: String(pageOffset), limit: '20' }); rows.value = page.items; offset.value = pageOffset; hasMore.value = page.has_more }
  catch (cause) { error.value = cause.message }
  finally { busy.value = false }
}
// 用途：新建版本草稿或载入已有草稿。
// 参数：row为可选旧价；已发布价只复制业务字段，创建全新身份。
// 返回值：无。
function edit(row = null) {
  form.value = row ? { ...row, ...(row.status === 'DRAFT' ? { expected_version: row.version } : { id: '', expected_version: 0 }) } : { name: '', category_id: '', category_version: 0, service_type: '', organization_id: '', unit: '项', unit_price_minor: 0, currency: 'CNY', tax_basis: 'INCLUSIVE', tax_rate_bps: 600, effective_from: '', effective_to: '', expected_version: 0 }
}
// 用途：提交草稿业务字段，作者、状态及时间由服务器决定。
// 参数：无。
// 返回值：无；保存后刷新分页。
async function save() {
  busy.value = true; error.value = ''
  try { await saveStandardPrice(form.value, form.value.id || ''); form.value = null; await load() }
  catch (cause) { error.value = cause.message }
  finally { busy.value = false }
}
// 用途：执行独立发布或停用，前后端同时执行职责提示。
// 参数：row为目录版本，action为发布或停用。
// 返回值：无；成功刷新当前页。
async function command(row, action) {
  busy.value = true; error.value = ''
  try { await commandStandardPrice(row.id, row.version, action); await load(offset.value) }
  catch (cause) { error.value = cause.message }
  finally { busy.value = false }
}
onMounted(() => load())
</script>
<template>
  <section class="price-panel"><header><h3>版本化标准价格目录</h3><p>管理员维护草稿；销售总监或财务总监独立发布。发布版本不可修改，停用不追溯已冻结合同。</p><button v-if="permissions.includes('contract.pricing.manage')" type="button" :disabled="busy" @click="edit()">新建价格草稿</button></header>
    <p v-if="error" role="alert">{{ error }} <button type="button" @click="load(offset)">重新读取</button></p>
    <form v-if="form" class="price-grid" @submit.prevent="save"><label>名称<input v-model="form.name" required maxlength="200" /></label><label>服务类别身份/名称<input v-model="form.category_id" required maxlength="128" /></label><label>本地类别版本（项目类别填0）<input v-model.number="form.category_version" type="number" min="0" step="1" /></label><label>服务类型<input v-model="form.service_type" required maxlength="100" /></label><label>归属组织ID（全范围可留空）<input v-model="form.organization_id" maxlength="128" /></label><label>计量单位<input v-model="form.unit" required maxlength="40" /></label><label>标准单价（最小币种单位）<input v-model.number="form.unit_price_minor" required type="number" min="1" step="1" /></label><label>币种<input v-model="form.currency" required pattern="[A-Z]{3}" maxlength="3" /></label><label>税基<select v-model="form.tax_basis"><option value="INCLUSIVE">含税</option><option value="EXCLUSIVE">未税</option></select></label><label>税率万分比<input v-model.number="form.tax_rate_bps" type="number" min="0" max="10000" step="1" required /></label><label>生效日<input v-model="form.effective_from" type="date" required /></label><label>截止日<input v-model="form.effective_to" type="date" /></label><div><button :disabled="busy" type="submit">保存草稿</button><button type="button" @click="form = null">取消</button></div></form>
    <div class="price-table"><table><thead><tr><th>标准价版本</th><th>单价/币税</th><th>有效期</th><th>状态/操作</th></tr></thead><tbody><tr v-for="row in rows" :key="row.id"><td>{{ row.name }} · {{ row.service_type }}<small>{{ row.id }} · v{{ row.version }} · {{ row.category_id }}</small></td><td>{{ row.unit_price_minor }} {{ row.currency }}最小单位/{{ row.unit }}<small>{{ row.tax_basis === 'INCLUSIVE' ? '含税' : '未税' }} · {{ row.tax_rate_bps / 100 }}%</small></td><td>{{ row.effective_from }} 至 {{ row.effective_to || '长期' }}</td><td>{{ row.status }}<button v-if="permissions.includes('contract.pricing.manage')" type="button" :disabled="busy" @click="edit(row)">{{ row.status === 'DRAFT' ? '编辑草稿' : '复制为新版本' }}</button><button v-if="row.status === 'DRAFT' && permissions.includes('contract.pricing.publish')" :disabled="busy || [row.created_by, row.updated_by].includes(actorId)" type="button" @click="command(row, 'publish')">独立发布</button><button v-if="row.status === 'PUBLISHED' && permissions.includes('contract.pricing.manage')" :disabled="busy" type="button" @click="command(row, 'disable')">停用</button></td></tr></tbody></table></div>
    <button type="button" :disabled="busy || offset === 0" @click="load(Math.max(0, offset - 20))">上一页</button><button type="button" :disabled="busy || !hasMore" @click="load(offset + 20)">下一页</button>
  </section>
</template>
<style scoped>
.price-panel { padding: 16px; border: 1px solid var(--border-color, #d8dee8); border-radius: 10px; margin-bottom: 16px; }
.price-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; } label { display: grid; gap: 4px; } small { display: block; opacity: .8; } .price-table { overflow-x: auto; } table { width: 100%; border-collapse: collapse; } td, th { text-align: left; padding: 10px; border-bottom: 1px solid var(--border-color, #d8dee8); } button { margin: 4px; }
</style>
