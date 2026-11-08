<script setup lang="ts">
// 类型门禁（阶段 1）：本文件是首批纳入 `npm run typecheck` 的共享组件之一。
// 异步面板的对外契约只有一条——加载器签名；它是「模块加载失败」与「业务空数据」
// 不混淆的前提，所以在这里显式声明，而不是留给调用方随手传 Function。
import type { Component, PropType, ShallowRef } from 'vue'
import { defineAsyncComponent, defineComponent, h, ref, shallowRef, watch } from 'vue'
import LoadingState from './LoadingState.vue'
import ErrorState from './ErrorState.vue'

// 加载结果：直接给组件定义，或给带 default 的模块命名空间（`() => import('./View.vue')`）。
type AsyncPanelModule = Component | { default: Component }

// 异步加载器签名：无入参，返回 Promise；失败必须 reject（由边界转成可重试的错误面板）。
type AsyncPanelLoader = () => Promise<AsyncPanelModule>

defineOptions({ inheritAttrs: false })
const props = defineProps({
  loader: { type: Function as PropType<AsyncPanelLoader>, required: true },
})
// 当前异步组件：初始为 null（未加载），retry() 后替换为新实例以强制重新请求。
const panel: ShallowRef<Component | null> = shallowRef(null)
const attempt = ref(0)
const failure = defineComponent({
  inheritAttrs: false,
  setup: () => () => h(ErrorState, {
    title: '面板加载失败', description: '页面资源暂不可用，请重试加载。',
    retryText: '重试加载', onRetry: retry,
  }),
})

// 用途：建立可显式重试的异步组件边界，加载失败不伪装为业务空数据。
// 参数：无；使用所属子系统传入的模块加载函数。
// 返回值：无；业务属性和事件由模板原样传递，未挂载时不执行面板业务读取。
function retry(): void {
  attempt.value += 1
  panel.value = defineAsyncComponent({
    loader: props.loader, loadingComponent: LoadingState, errorComponent: failure,
    delay: 100, timeout: 30000, suspensible: false,
    // 由错误面板承载受控提示，避免原始模块路径进入页面或全局业务错误提示。
    onError: (_error, _retry, fail) => fail(),
  })
}
watch(() => props.loader, retry, { immediate: true })
</script>

<template>
  <component :is="panel" :key="attempt" v-bind="$attrs" />
</template>
