<script setup>
// 错误状态：图标 + 错误信息 + 内置「重试」按钮。
//
// 用法：
//   1) 默认场景：传 error 即可，error.message 作为标题。
//        <ErrorState :error="error" @retry="load" />
//   2) 自定义分类标题：传非默认 title，error.message 会落到副标题。
//        <ErrorState title="会话读取失败" :error="loadError" @retry="loadMe" />
//   3) 纯静态标题 + 自定义副标题：不传 error。
//        <ErrorState title="看板加载失败" description="嵌入桥返回 502" @retry="reload" />
import ConsoleIcon from './ConsoleIcon.vue'

const props = defineProps({
  // error 既可以是字符串，也可以是 Error 对象，会自动取 message。
  error: { type: [String, Object, Error], default: '' },
  title: { type: String, default: '加载失败' },
  // 默认显示重试按钮；调用方需要时可以传 false 隐藏。
  retry: { type: Boolean, default: true },
  retryText: { type: String, default: '重新加载' },
  description: { type: String, default: '' },
  compact: { type: Boolean, default: false },
})

const emit = defineEmits(['retry'])

const message = (() => {
  if (!props.error) return ''
  if (typeof props.error === 'string') return props.error
  if (props.error instanceof Error) return props.error.message || ''
  if (typeof props.error === 'object' && 'message' in props.error) return String(props.error.message || '')
  return ''
})()

// 仅当调用方未显式传 title（仍是默认「加载失败」）时，才把 error.message 顶到标题位置。
// 显式传 title 意味着调用方要展示自己的分类标题，error.message 退到副标题。
const useErrorAsTitle = props.title === '加载失败' && Boolean(message)
const titleText = useErrorAsTitle ? message : props.title
const descriptionText = useErrorAsTitle ? '' : (message || props.description)

function onRetry() {
  emit('retry')
}
</script>

<template>
  <div class="ui-state" :class="{ 'ui-state--compact': compact }" role="alert">
    <ConsoleIcon name="info" class="ui-state__icon" />
    <b class="ui-state__title">{{ titleText }}</b>
    <span v-if="descriptionText" class="ui-state__description">{{ descriptionText }}</span>
    <slot>
      <button v-if="retry" type="button" class="ui-state__retry" @click="onRetry">{{ retryText }}</button>
    </slot>
  </div>
</template>
