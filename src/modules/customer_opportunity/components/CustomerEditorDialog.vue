<script setup>
// 客户新建/编辑弹窗（前端优化计划 阶段 3-CRM，自 CustomerOpportunityView.vue 逐字迁移）。
//
// 职责边界：
// - 只渲染：表单对象、编辑态、选项与会话都由父层传入；字段编辑按既有 v-model 就地写回
//   父层的同一份对象，弹窗开关、脏检查基线、关闭确认、提交入口都留在父层；
// - 不提交、不读取目录、不调用创建/更新接口：原生 <form> 通过后只上抛 submit，
//   父层 submitCustomer 是唯一提交者（更新原因、查重、幂等重放都在那里）；
// - 联系人增删同样上抛事件，父层保持“至少一行 + 登记联系人顺延”的既有规则。
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'
import OwnerSelector from './OwnerSelector.vue'

defineOptions({ name: 'CustomerEditorDialog' })
const props = defineProps({
  /** 父层持有的客户表单（新建/编辑共用同一份 reactive 对象）。 */
  form: { type: Object, required: true },
  editMode: { type: Boolean, default: false },
  /** 父层提交中：只用于禁用取消/保存，避免提交期间关闭或重复提交。 */
  busy: { type: Boolean, default: false },
  /** 编辑态联系人正在从服务端回填：期间禁止保存与追加行，避免回填覆盖刚输入的行。 */
  contactsLoading: { type: Boolean, default: false },
  /** 联系人回填失败或客户确实没有联系人：由父层给出的可读原因，提交仍由父层阻断。 */
  contactsError: { type: String, default: '' },
  /** 详情弹窗在前时叠放为内层弹窗（层级样式由父层选中状态决定）。 */
  nested: { type: Boolean, default: false },
  session: { type: Object, default: null },
  customerTypeSuggestions: { type: Array, default: () => [] },
  industryOptions: { type: Array, default: () => [] },
  regionSuggestions: { type: Array, default: () => [] },
})
const emit = defineEmits(['submit', 'close', 'add-contact', 'remove-contact'])
</script>

<template>
  <div class="console-modal-backdrop" :class="{ nested }" role="presentation" @click.self="emit('close')">
    <form class="console-detail-modal crm-customer-dialog" role="dialog" aria-modal="true" :aria-label="editMode ? '编辑客户' : '新建客户'" @submit.prevent="emit('submit')">
      <header>
        <div>
          <p class="console-modal-eyebrow">客户档案</p>
          <h2>{{ editMode ? '编辑客户' : '新建客户' }}</h2>
        </div>
        <button class="console-modal-close" type="button" aria-label="关闭" @click="emit('close')"><ConsoleIcon name="close" /></button>
      </header>
      <div class="console-form-grid crm-customer-dialog__body">
        <label class="console-form-item"><span>客户名称 *</span><input v-model="form.name" required autocomplete="off" placeholder="请输入客户名称" maxlength="200"></label>
        <label class="console-form-item"><span>统一社会信用代码</span><input v-model="form.unified_credit_code" :placeholder="editMode ? '留空表示保持原值' : '选填'" autocomplete="off" maxlength="64"></label>
        <label class="console-form-item"><span>客户类型 *</span><select v-model="form.customer_type" required><option value="" disabled>请选择客户类型</option><option v-if="form.customer_type && !customerTypeSuggestions.includes(form.customer_type)" :value="form.customer_type">{{ form.customer_type }}（历史值）</option><option v-for="customerType in customerTypeSuggestions" :key="customerType" :value="customerType">{{ customerType }}</option></select></label>
        <label class="console-form-item"><span>行业 *</span><select v-model="form.industry" required><option value="" disabled>请选择行业</option><option v-if="form.industry && !industryOptions.includes(form.industry)" :value="form.industry">{{ form.industry }}（历史值）</option><option v-for="industry in industryOptions" :key="industry" :value="industry">{{ industry }}</option></select></label>
        <label class="console-form-item"><span>区域 *</span><select v-model="form.region" required><option value="" disabled>请选择区域</option><option v-if="form.region && !regionSuggestions.includes(form.region)" :value="form.region">{{ form.region }}（历史值）</option><option v-for="region in regionSuggestions" :key="region" :value="region">{{ region }}</option></select></label>
        <div v-if="editMode" class="console-form-item full"><OwnerSelector v-model:user-id="form.owner_user_id" v-model:organization-id="form.owner_org_id" :default-user-id="session?.user_id || ''" :default-organization-id="session?.primary_org_id || ''" /></div>
        <p v-if="contactsLoading" class="crm-note" role="status">正在加载客户联系人…</p>
        <p v-else-if="contactsError" class="crm-alert error" role="alert">{{ contactsError }}</p>
        <section v-for="(contact, index) in form.contacts" :key="contact.id || index" class="crm-customer-contacts">
          <div class="crm-customer-contact-heading">
            <h3>联系人 {{ index + 1 }}</h3>
            <button class="console-button danger small" type="button" :disabled="form.contacts.length <= 1" :title="form.contacts.length <= 1 ? '至少保留一个联系人' : '删除此联系人'" @click="emit('remove-contact', index)">删除联系人</button>
          </div>
          <div class="console-form-grid">
            <label class="console-form-item"><span>姓名 *</span><input v-model="contact.name" required autocomplete="off" maxlength="100"></label>
            <label class="console-form-item"><span>电话 *</span><input v-model="contact.phone" :required="!contact.id" :placeholder="contact.id ? '留空表示保持原值' : ''" autocomplete="off" maxlength="32"></label>
            <label class="console-form-item"><span>邮箱</span><input v-model="contact.email" type="email" :placeholder="contact.id ? '留空表示保持原值' : ''" autocomplete="off" maxlength="200"></label>
            <label class="console-form-item crm-check-item"><span>门户登记联系人</span><input v-model="contact.is_registration" type="checkbox"></label>
          </div>
        </section>
        <button class="console-button ghost" type="button" :disabled="contactsLoading" @click="emit('add-contact')">添加联系人</button>
        <label v-if="editMode" class="console-form-item full"><span>更新原因 *</span><textarea v-model="form.reason" required maxlength="500" rows="3" placeholder="说明本次更新客户的原因"></textarea></label>
        <label class="console-form-item full crm-check-item"><span>授权覆盖名称查重</span><input v-model="form.duplicate_override" type="checkbox"></label>
        <label v-if="form.duplicate_override" class="console-form-item full"><span>覆盖原因 *</span><textarea v-model="form.duplicate_override_reason" required maxlength="500" rows="2" placeholder="说明为什么允许与疑似重复客户并存"></textarea></label>
      </div>
      <footer>
        <button class="console-button ghost" type="button" :disabled="busy" @click="emit('close')">取消</button>
        <button class="console-button primary" type="submit" :disabled="busy || contactsLoading">{{ busy ? '保存中…' : '保存客户' }}</button>
      </footer>
    </form>
  </div>
</template>
