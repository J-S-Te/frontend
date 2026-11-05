<script setup>
// ConsoleIcon 的权威实现已收敛到 shared/components/ConsoleIcon.vue（C09：业务
// 模块不再依赖 platform 内部实现的第一步）。本文件仅为既有平台侧/业务侧引用
// 保留兼容入口；新代码应直接从 shared 引入。测试基建的 loadSfc 要求每个 SFC
// 都带 template 块，因此这里用透传组件而非纯 re-export。
import ConsoleIcon from '@/modules/shared/components/ConsoleIcon.vue'
</script>

<template>
  <ConsoleIcon v-bind="$attrs" />
</template>
