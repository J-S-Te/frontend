<script setup>
// 统一身份编辑弹窗：用户 / 批量用户 / 登录账号 / 组织 / 岗位 / 任职六类表单。
// 批次 2 第三步自 IamSettingsModule.vue 逐字迁移；表单对象仍由父组件持有（子组件按属性直改字段），
// 焦点陷阱容器经 defineExpose 的 formEl 供父组件 useDialogFocusTrap 使用；
// DOM 由快照测试对提取前 golden 逐字节锁定。
import { ref } from 'vue'
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'


defineProps({
  editor: { type: Object, required: true },
  form: { type: Object, required: true },
  saving: { type: Boolean, default: false },
  referencesLoading: { type: Boolean, default: false },
  referencesError: { type: String, default: '' },
  selectionNotice: { type: String, default: '' },
  users: { type: Array, default: () => [] },
  organizations: { type: Array, default: () => [] },
  parentOptions: { type: Array, default: () => [] },
  membershipOrganizations: { type: Array, default: () => [] },
  membershipPositions: { type: Array, default: () => [] },
})

defineEmits(['close', 'save', 'reload-references'])

// 初始密码可见性是弹窗内的一次性 UI 状态：父组件原先在 openEditor/closeEditorNow 重置，
// 与本组件随 editor 挂载/卸载的生命周期一致，故随子组件持有。
const initialPasswordVisible = ref(false)
const formEl = ref(null)

defineExpose({ formEl })
</script>

<template>
  <div class="iam-modal-backdrop" role="presentation" @click.self="$emit('close')">
    <section class="iam-modal iam-editor-modal" role="dialog" aria-modal="true" aria-label="新增身份授权配置">
      <header><div><p>{{ editor.mode === 'edit' ? '编辑' : '新增' }}</p><h3>{{ editor.mode === 'edit' ? '编辑' : '新增' }} {{ editor.label }}</h3></div><button class="console-modal-close" type="button" aria-label="关闭表单" :disabled="saving" @click="$emit('close')"><ConsoleIcon name="close" /></button></header>
      <form ref="formEl" class="iam-editor-form" @submit.prevent="$emit('save')">
        <p v-if="referencesLoading" class="iam-form-alert full" role="status"><ConsoleIcon name="info" />正在读取最新关联目录…读取完成前请勿提交，避免选到已停用的组织或岗位。</p>
        <p v-else-if="referencesError" class="iam-form-alert full" role="alert">
          {{ referencesError }}
          <button class="console-button ghost small" type="button" @click="$emit('reload-references')"><ConsoleIcon name="reset" />重试读取</button>
        </p>
        <p v-if="selectionNotice" class="iam-form-alert full" role="alert">{{ selectionNotice }}</p>
        <template v-if="editor.kind === 'user'">
          <p class="iam-form-alert"><ConsoleIcon name="info" />员工编号由后端自动生成；本次会同时创建该用户的本地登录账号。</p>
          <label><span>展示姓名 *</span><input v-model="form.display_name" required maxlength="100" placeholder="例如：张三" /></label>
          <label><span>邮箱</span><input v-model="form.email" type="email" placeholder="例如：zhang.san@example.com"  maxlength="320"/></label>
          <label><span>手机号</span><input v-model="form.mobile" maxlength="32" placeholder="例如：13800000000" /></label>
          <label><span>状态</span><select v-model="form.status"><option value="ACTIVE">启用</option><option value="DISABLED">停用</option></select></label>
          <label><span>登录账号 *</span><input v-model="form.account_name" required minlength="3" maxlength="64" placeholder="例如：zhang.san" /><small class="iam-field-help">账号必须唯一，以字母或数字开头。</small></label>
          <label><span>初始密码 *</span><div class="iam-password-field"><input v-model="form.initial_password" :type="initialPasswordVisible ? 'text' : 'password'" required minlength="8" maxlength="128" autocomplete="new-password" /><button type="button" :aria-label="initialPasswordVisible ? '隐藏密码' : '显示密码'" @click="initialPasswordVisible = !initialPasswordVisible"><ConsoleIcon :name="initialPasswordVisible ? 'eye-off' : 'eye'" /></button></div></label>
          <label><span>账号有效期 *</span><select v-model="form.validity_mode"><option value="TEMPORARY">临时（默认 1 天）</option><option value="PERMANENT">永久</option></select></label>
          <label v-if="form.validity_mode !== 'PERMANENT'"><span>有效截止时间 *</span><input v-model="form.valid_until" required type="datetime-local" /></label>
        </template>
        <template v-else-if="editor.kind === 'user-batch'">
          <p class="iam-form-alert"><ConsoleIcon name="info" />每行一位用户，格式为“姓名,邮箱,手机号”；邮箱和手机号可留空，一次最多 100 位。批量创建仅建立用户档案；登录账号请在“登录账号”中按需创建。</p>
          <label class="full"><span>用户数据 *</span><textarea v-model="form.rows" required rows="10" placeholder="张三,zhang.san@example.com,13800000000&#10;李四,,13900000000&#10;王五" maxlength="20000"></textarea></label>
          <label><span>统一状态</span><select v-model="form.status"><option value="ACTIVE">启用</option><option value="DISABLED">停用</option></select></label>
          <p class="iam-field-help full">员工编号由后端逐条自动生成，每位用户都会自动绑定“普通用户”角色。</p>
        </template>
        <template v-else-if="editor.kind === 'account'">
          <div class="iam-account-editor-intro full">
            <span><ConsoleIcon name="account" /></span>
            <div><strong>创建本地登录账号</strong><p>账号将关联到一位平台用户。初始密码仅用于首次登录，请通过安全渠道交付。</p></div>
            <small>01 / 03</small>
          </div>
          <label class="iam-account-field"><span>账号 *</span><input v-model="form.account_name" required minlength="3" maxlength="64" placeholder="例如：zhang.san" /><small class="iam-field-help">3–64 个字符，以字母或数字开头，仅可使用字母、数字、点、下划线和连字符。</small></label>
          <label class="iam-account-field"><span>关联用户 *</span>
            <select v-model="form.user_id" required>
              <option value="">请选择用户</option>
              <option v-for="item in users" :key="item.user_id" :value="item.user_id">{{ item.display_name }}（{{ item.employee_no || item.user_id }}）</option>
            </select>
            <small class="iam-field-help">一个账号只关联一位用户，避免使用名称进行关联。</small>
          </label>
          <label class="iam-account-field"><span>账号类型</span><input value="个人账号 / 本地密码" disabled /><small class="iam-field-help">当前新增接口创建个人本地账号，使用账号名和密码登录。</small></label>
          <label class="iam-account-field"><span>初始密码 *</span><div class="iam-password-field"><input id="initial-password" v-model="form.initial_password" required minlength="8" maxlength="128" :type="initialPasswordVisible ? 'text' : 'password'" autocomplete="new-password" placeholder="请妥善记录，将仅返回一次" /><button class="iam-password-toggle" type="button" :aria-label="initialPasswordVisible ? '隐藏初始密码' : '显示初始密码'" :title="initialPasswordVisible ? '隐藏密码' : '显示密码'" @click="initialPasswordVisible = !initialPasswordVisible"><svg v-if="!initialPasswordVisible" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c-5 0-9.3 3-11 7 1.7 4 6 7 11 7s9.3-3 11-7c-1.7-4-6-7-11-7Zm0 12c-3.8 0-7.2-2-8.8-5C4.8 9 8.2 7 12 7s7.2 2 8.8 5c-1.6 3-5 5-8.8 5Zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm0 4a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" /></svg><svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="m3.3 2-1.4 1.4 3 3A12.7 12.7 0 0 0 1 12c1.7 4 6 7 11 7 1.8 0 3.5-.4 5-1l3.6 3.6 1.4-1.4L3.3 2ZM12 17c-3.8 0-7.2-2-8.8-5 .8-1.5 1.9-2.7 3.2-3.5l2.1 2.1A3.5 3.5 0 0 0 13.4 15l2 2c-1 .3-2.2.5-3.4.5V17Zm-1.6-4.5 2.1 2.1a1.6 1.6 0 0 1-2.1-2.1ZM12 7c3.8 0 7.2 2 8.8 5a9.5 9.5 0 0 1-2.1 2.8l1.4 1.4A12 12 0 0 0 23 12c-1.7-4-7-7-11-7-.8 0-1.6.1-2.4.2l1.7 1.7.7.1Zm.9 2.1 3 3a4 4 0 0 0-3-3Z" /></svg></button></div><small class="iam-field-help">8–128 个字符，不含空白，并同时包含大写字母、小写字母、数字和特殊字符。</small></label>
          <div class="iam-validity-picker full"><span>有效时间 *</span><div class="iam-validity-options" role="radiogroup" aria-label="账号有效时间"><button type="button" :class="{ active: form.validity_mode === 'TEMPORARY' }" role="radio" :aria-checked="form.validity_mode === 'TEMPORARY'" @click="form.validity_mode = 'TEMPORARY'"><strong>临时账号</strong><small>默认有效 1 天，可自定义截止时间</small></button><button type="button" :class="{ active: form.validity_mode === 'PERMANENT' }" role="radio" :aria-checked="form.validity_mode === 'PERMANENT'" @click="form.validity_mode = 'PERMANENT'"><strong>永久账号</strong><small>长期有效，仍可随时停用</small></button></div></div>
          <label v-if="form.validity_mode === 'TEMPORARY'" class="full iam-account-expiry-field"><span>有效截止时间 *</span><input v-model="form.valid_until" type="datetime-local" required /><small class="iam-field-help">到期后，账号将无法继续登录；请选择晚于当前时间的日期和时间。</small></label>
        </template>
        <template v-else-if="editor.kind === 'organization'">
          <label><span>组织名称 *</span><input v-model="form.name" required  maxlength="100"/></label>
          <label><span>组织编码</span><input value="提交后由系统自动生成" disabled /><small class="iam-field-help">编码由后端统一生成，创建后可在组织列表和详情中查看。</small></label>
          <label><span>上级组织（留空为根）</span><select v-model="form.parent_id"><option value="">无（根组织）</option><option v-for="item in parentOptions" :key="item.org_unit_id" :value="item.org_unit_id">{{ item.name }} · {{ item.code }}</option></select><small class="iam-field-help">编辑时不会显示当前组织及其下级，避免形成循环层级。</small></label>
          <label><span>显示顺序</span><input v-model.number="form.sort_order" type="number" min="0" step="10" /><small class="iam-field-help">数字越小，在同一上级组织下越靠前；建议使用 10、20、30，便于后续插入。</small></label>
        </template>
        <template v-else-if="editor.kind === 'position'">
          <label><span>所属组织 *</span><select v-model="form.org_unit_id" required><option value="">请选择组织</option><option v-for="item in organizations" :key="item.org_unit_id" :value="item.org_unit_id">{{ item.name }} · {{ item.code }}</option></select></label>
          <label><span>岗位编码</span><input value="提交后由系统自动生成" disabled /><small class="iam-field-help">编码由后端统一生成，格式为 POS-&lt;ULID&gt;，创建后可在岗位列表和详情中查看。</small></label>
          <label><span>岗位名称 *</span><input v-model="form.name" required placeholder="例如：研发经理"  maxlength="100"/></label>
        </template>
        <template v-else-if="editor.kind === 'membership'">
          <label><span>用户 *</span><select v-model="form.user_id" required><option value="">请选择用户</option><option v-for="item in users" :key="item.user_id" :value="item.user_id">{{ item.display_name }} · {{ item.employee_no || item.user_id }}</option></select></label>
          <label><span>组织 *</span><select v-model="form.org_unit_id" required><option value="">请选择组织</option><option v-for="item in membershipOrganizations" :key="item.org_unit_id || item.id" :value="item.org_unit_id || item.id">{{ item.name }} · {{ item.position_count }} 个岗位</option></select><small class="iam-field-help">系统会默认选择一个已有岗位的组织；切换组织后只能选择该组织下的岗位。</small></label>
          <label><span>岗位 *</span><select v-model="form.position_id" :disabled="!form.org_unit_id || !membershipPositions.length" required><option value="">{{ !form.org_unit_id ? '请先选择组织' : (membershipPositions.length ? '请选择岗位' : '当前组织暂无岗位') }}</option><option v-for="item in membershipPositions" :key="item.position_id || item.id" :value="item.position_id || item.id">{{ item.name }}</option></select><small v-if="form.org_unit_id && !membershipPositions.length" class="iam-field-help">当前组织下暂无可用岗位，请先在“岗位”页面为该组织新增岗位。</small></label>
          <label><span>任职类型 *</span><select v-model="form.membership_type"><option value="PRIMARY">主组织</option><option value="SECONDARY">次组织 / 兼岗</option></select></label>
          <label><span>生效方式 *</span><select v-model="form.validity_mode"><option value="LONG_TERM">长期生效</option><option value="SHORT_TERM">短期生效</option></select><small class="iam-field-help">长期任职不设置日期；短期任职必须填写完整起止日期。</small></label>
          <label v-if="form.validity_mode === 'SHORT_TERM'"><span>生效日期 *</span><input v-model="form.effective_from" required type="date" /></label>
          <label v-if="form.validity_mode === 'SHORT_TERM'"><span>失效日期 *</span><input v-model="form.effective_to" required type="date" /></label>
          <label class="full iam-checkbox-field"><input v-model="form.inherit_authorization" type="checkbox" /><span>参与岗位授权继承</span><small class="iam-field-help">这是标准授权开关：开启后，该任职会动态继承岗位授权模板映射的应用角色；关闭不会影响用户详情中单独配置的个人例外。</small></label>
          <p class="iam-form-alert"><ConsoleIcon name="info" />人员晋升、降职或调岗时，请保留原任职并新建此任职；有效岗位模板角色会自动重算。离职请在人员详情中停用人员，系统会同时撤销账号、任职和会话。</p>
        </template>
        <p class="iam-form-alert"><ConsoleIcon name="info" />提交后由 Go API 写入 MySQL，并生成审计事件。</p>
        <footer>
          <button class="console-button ghost" type="button" :disabled="saving" @click="$emit('close')">取消</button>
          <button class="console-button primary" type="submit" :disabled="saving"><ConsoleIcon name="save" />{{ saving ? '保存中…' : '保存' }}</button>
        </footer>
      </form>
    </section>
  </div>
</template>
