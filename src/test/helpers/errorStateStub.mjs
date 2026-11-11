import * as Vue from 'vue'

// 用途：共享错误态的可断言替身，验证业务组件把失败交给 ErrorState 而不是直出原文。
// 参数：无；每次调用返回独立的 props 观察列表，避免同文件用例互相覆盖。
// 返回值：Stub 组件（保留 title/error/retry 外形与 retry 语义）和挂载时捕获的属性列表。
export function createErrorStateStub() {
  const seen = []
  const Stub = {
    props: {
      error: { default: '' },
      title: { default: '加载失败' },
      retry: { default: true },
      retryText: { default: '重新加载' },
      description: { default: '' },
      compact: { type: Boolean, default: false },
      onRetry: { type: Function, default: null },
    },
    setup(props) {
      seen.push(props)
      return () => Vue.h('div', { class: 'ui-state', role: 'alert' }, [
        Vue.h('b', { class: 'ui-state__title' }, props.title),
        Vue.h('span', { class: 'ui-state__description' }, errorText(props.error) || props.description),
        props.retry === false ? null : Vue.h('button', {
          class: 'ui-state__retry', type: 'button', onClick: () => props.onRetry?.(),
        }, props.retryText),
      ])
    },
  }
  return { Stub, seen }
}

// 用途：从字符串或 Error 对象取出可读原因，模拟 ErrorState 的输入。
// 参数：value 为组件传入的 error 属性。
// 返回值：用于断言的纯文本。
function errorText(value) {
  return typeof value === 'string' ? value : value?.message || ''
}
