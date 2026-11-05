<script setup>
import { computed, reactive, ref } from 'vue'
import { createNativeProject } from '../api/projectManagement.js'
import { formatUserError } from '../../shared/utils/userError.js'

const props = defineProps({ categories: { type: Array, default: () => [] }, ownerOrgId: { type: String, default: '' } })
const emit = defineEmits(['close', 'created'])
const busy = ref(false)
const error = ref('')
const confirmed = ref(false)
const operationID = crypto.randomUUID()
const form = reactive({ name: '', customer: '', customer_id: '', owner_org_id: props.ownerOrgId, due: '' })
const items = ref([{ category: '', site: '', batch: '第一批', system: '', system_level: '', requirement: '', test_mode: 'STANDARD' }])
const categories = computed(() => props.categories.filter((item) => item.enabled))

// 用途：追加一项仍须服务端确认的本地委托范围。
// 参数：无。
// 返回值：无；最多保留200项。
function addItem() {
  if (busy.value || items.value.length >= 200) return
  items.value.push({ category: '', site: '', batch: '第一批', system: '', system_level: '', requirement: '', test_mode: 'STANDARD' })
}

// 用途：校验本地委托并以稳定操作编号提交原生建项。
// 参数：无。
// 返回值：异步完成；成功发出created，失败保留草稿供同号重试。
async function submit() {
  if (busy.value) return
  error.value = ''
  const known = new Set(categories.value.map((item) => item.category))
  if (!form.name.trim() || !form.customer.trim() || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(form.customer_id.trim())) {
    error.value = '请填写项目名称、委托单位名称及有效的单位编号。'; return
  }
  if (!confirmed.value || !items.value.length || items.value.some((item) => !known.has(item.category) || !item.site.trim())) {
    error.value = '请选择启用的检测类别、填写实施场所，并确认委托范围。'; return
  }
  busy.value = true
  try {
    const project = await createNativeProject({ ...form, source_kind: 'NATIVE', source_id: operationID,
      service_items: items.value.map((item) => ({ ...item })) })
    emit('created', project)
  } catch (value) {
    error.value = formatUserError(value, { fallback: '原生委托建项失败，请核对后重试。' })
  } finally { busy.value = false }
}
</script>

<template>
  <div class="pm-overlay" @click.self="!busy && emit('close')">
    <section class="pm-dialog pm-dialog-wide" role="dialog" aria-modal="true" aria-label="新建原生委托项目">
      <header><div><h2>新建原生委托项目</h2><small class="pm-dialog-sub">录入本地委托单位与服务范围。创建后须确认拆解，按既有规则核验人员资格及特殊方法。</small></div><button type="button" class="pm-button" :disabled="busy" @click="emit('close')">关闭</button></header>
      <form @submit.prevent="submit">
        <div class="pm-dialog-body">
          <p v-if="error" role="alert" class="pm-native-error">{{ error }}</p>
          <div class="pm-native-fields">
            <label class="pm-field"><span>项目名称</span><input v-model="form.name" maxlength="255" required :disabled="busy"></label>
            <label class="pm-field"><span>委托单位名称</span><input v-model="form.customer" maxlength="255" required :disabled="busy"></label>
            <label class="pm-field"><span>本地委托单位编号</span><input v-model="form.customer_id" maxlength="64" required :disabled="busy" placeholder="例如 UNIT-001"><small>使用稳定的字母或数字编号，同一编号对应同一单位名称。</small></label>
            <label class="pm-field"><span>所属组织编号（按授权范围）</span><input v-model="form.owner_org_id" maxlength="64" :disabled="busy"><small>单一组织授权可留空，由服务端确定。</small></label>
            <label class="pm-field"><span>项目期限</span><input v-model="form.due" type="date" :disabled="busy"></label>
          </div>
          <section v-for="(item, index) in items" :key="index" class="pm-native-item">
            <h3>服务项 {{ index + 1 }}</h3>
            <div class="pm-native-fields">
              <label class="pm-field"><span>检测类别</span><select v-model="item.category" required :disabled="busy"><option value="">请选择启用的检测类别</option><option v-for="category in categories" :key="category.category" :value="category.category">{{ category.category }}</option></select></label>
              <label class="pm-field"><span>实施场所</span><input v-model="item.site" maxlength="255" required :disabled="busy"></label>
              <label class="pm-field"><span>批次</span><input v-model="item.batch" maxlength="64" :disabled="busy"></label>
              <label class="pm-field"><span>系统名称</span><input v-model="item.system" maxlength="128" :disabled="busy"></label>
              <label class="pm-field"><span>系统等级</span><input v-model="item.system_level" maxlength="64" :disabled="busy"></label>
              <label class="pm-field"><span>方法类型</span><select v-model="item.test_mode" :disabled="busy"><option value="STANDARD">标准方法</option><option value="PENETRATION">渗透测试 / 特殊方法</option></select><small>类别规定特殊方法时，以服务端类别规则为准。</small></label>
              <label class="pm-field"><span>技术要求</span><textarea v-model="item.requirement" maxlength="2000" :disabled="busy" /></label>
            </div>
            <button v-if="items.length > 1" type="button" class="pm-button" :disabled="busy" @click="items.splice(index, 1)">移除此项</button>
          </section>
          <button type="button" class="pm-button" :disabled="busy || items.length >= 200" @click="addItem">添加服务项</button>
          <p v-if="!categories.length">暂无启用的检测类别，请先在规则配置中心维护。</p>
          <label class="pm-native-confirm"><input v-model="confirmed" type="checkbox" :disabled="busy">确认按本地委托录入以上服务范围，创建后进入拆解确认。</label>
        </div>
        <footer><button type="button" class="pm-button" :disabled="busy" @click="emit('close')">取消</button><button type="submit" class="pm-button primary" :disabled="busy || !confirmed || !categories.length">{{ busy ? '创建中…' : '创建并进入拆解确认' }}</button></footer>
      </form>
    </section>
  </div>
</template>

<style scoped>
.pm-native-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
.pm-native-item { margin: 18px 0; padding: 16px; border: 1px solid var(--pm-line, #e2e8f0); border-radius: 8px; }
.pm-native-error { padding: 12px; color: #b91c1c; background: #fef2f2; }
.pm-native-confirm { display: flex; align-items: flex-start; gap: 8px; margin-top: 20px; }
.pm-field small { line-height: 1.6; color: var(--pm-muted, #64748b); }

/* 深色主题：错误条写死的浅红底与墨色；浅色声明未改。 */
[data-theme="dark"] .pm-native-error {
  color: var(--danger-text);
  background: var(--danger-soft);
}
</style>
