<script setup>
import { computed } from 'vue'
import { authorizationEntryLayer, duplicatedInheritedRoleCodes } from '@/modules/platform/iam/utils/authorizationEntryLayer'

const props = defineProps({
  subjectType: { type: String, default: '' },
  selectedRoleCodes: { type: Array, default: () => [] },
  inheritedRoles: { type: Array, default: () => [] },
  roleName: { type: Function, default: null },
})

const layer = computed(() => authorizationEntryLayer(props.subjectType))
const duplicateCodes = computed(() => duplicatedInheritedRoleCodes(props.selectedRoleCodes, props.inheritedRoles))
const duplicateRoleNames = computed(() => duplicateCodes.value.map((code) => props.roleName?.({ code }) || code))
</script>

<template>
  <aside class="iam-authorization-layer" :class="`is-${subjectType.toLowerCase() || 'default'}`" aria-live="polite">
    <div class="iam-authorization-layer-head">
      <strong>{{ layer.title }}</strong>
      <span>{{ layer.badge }}</span>
    </div>
    <p><b>标准授权：</b>{{ layer.standard }}</p>
    <p class="iam-authorization-layer-risk"><b>使用边界：</b>{{ layer.risk }}</p>
    <p v-if="duplicateRoleNames.length" class="iam-authorization-layer-duplicate" role="alert">
      <b>检测到重复授予：</b>{{ duplicateRoleNames.join('、') }} 已可通过组织或岗位继承获得。保留个人例外角色不会增加权限，但会增加后续排查和回收成本；建议取消重复勾选。
    </p>
    <p class="iam-authorization-layer-readonly">
      子系统角色目录和角色默认权限在此处只读；基础平台只能分配已同步且可分配的应用角色，不能创建或修改子系统角色、权限及其关系。
    </p>
  </aside>
</template>
