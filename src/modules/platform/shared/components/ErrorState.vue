<script setup>
// ErrorState 的权威实现已收敛到 shared/components/ErrorState.vue（C09）。
// 本文件仅为既有引用保留兼容入口；新代码应直接从 shared 引入。
// 测试基建的 loadSfc 要求每个 SFC 都带 template 块，因此用透传组件而非纯 re-export；
// retry 等事件经 $attrs 透传，不在此显式转发以免双重触发。
import ErrorState from '@/modules/shared/components/ErrorState.vue'
</script>

<template>
  <ErrorState v-bind="$attrs" />
</template>
