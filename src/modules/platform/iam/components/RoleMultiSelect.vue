<script setup>
import { computed } from 'vue'

const props = defineProps({
  roles: { type: Array, default: () => [] },
  modelValue: { type: Array, default: () => [] },
  ready: { type: Boolean, default: false },
  emptyText: { type: String, default: '请先选择应用' },
  // 应用目录声明的最大有效角色数；0 表示不限制。只读展示与超限提示，最终仍由后端拒绝。
  maxEffectiveRoles: { type: Number, default: 0 },
})

const emit = defineEmits(['update:modelValue'])

const limitExceeded = computed(() => props.maxEffectiveRoles > 0 && props.modelValue.length > props.maxEffectiveRoles)

function roleId(role) { return role?.role_id || role?.id || '' }
function roleName(role) { return role?.name || role?.role_name || role?.code || roleId(role) }
function toggle(role, event) {
  const value = roleId(role)
  const next = new Set(Array.isArray(props.modelValue) ? props.modelValue : [])
  if (event.target.checked) next.add(value)
  else next.delete(value)
  emit('update:modelValue', [...next])
}
</script>

<template>
  <div class="iam-template-catalog-field iam-template-multi-role-field">
    <span class="iam-template-multi-role-label">{{ ready ? (maxEffectiveRoles ? `选择角色（已选 ${modelValue.length} / 最多 ${maxEffectiveRoles} 个）` : `选择角色（已选 ${modelValue.length} 个）`) : emptyText }}</span>
    <small v-if="ready && maxEffectiveRoles" class="iam-template-role-limit-hint">该应用限制每个用户最多 {{ maxEffectiveRoles }} 个有效角色（含组织/岗位继承）。</small>
    <small v-if="ready && limitExceeded" class="iam-template-role-limit-warning" role="alert">已选 {{ modelValue.length }} 个角色，超过该应用允许的最大有效角色数（{{ maxEffectiveRoles }} 个）；请取消多余角色。</small>
    <div v-if="ready" class="iam-template-role-checks">
      <label v-for="role in roles" :key="roleId(role)" class="iam-template-role-check">
        <input type="checkbox" :checked="modelValue.includes(roleId(role))" @change="toggle(role, $event)" />
        <span>{{ roleName(role) }}</span>
      </label>
      <small v-if="!roles.length">目录中没有可分配角色</small>
    </div>
    <div v-if="modelValue.length" class="iam-template-selected-roles">
      <span v-for="role in roles.filter((item) => modelValue.includes(roleId(item)))" :key="roleId(role)" class="iam-template-selected-role">{{ roleName(role) }}</span>
    </div>
  </div>
</template>
