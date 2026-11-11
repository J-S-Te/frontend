import { h } from 'vue'

// 用途：为组件单测提供共享分页条的轻量替身，验证接入方真的把页码与总数接到分页条。
// 参数：无。
// 返回值：带 page/total/pageSize/loading/label 属性与 change 事件的 Vue 组件定义。
export const PaginationBarStub = {
  props: {
    page: { type: Number, default: 1 },
    total: { type: Number, default: 0 },
    pageSize: { type: Number, default: 20 },
    loading: { type: Boolean, default: false },
    label: { type: String, default: '' },
  },
  emits: ['change', 'change-page-size'],
  // 用途：按共享分页条的可视规则渲染占位文本，空列表且首屏时不渲染。
  // 参数：无。
  // 返回值：渲染函数，输出带 data-pager 标记的 nav 或 null。
  render() {
    if (!(this.total > 0 || this.page > 1)) return null
    return h('nav', { 'data-pager': this.label, 'data-page': String(this.page) },
      `第 ${this.page} 页，共 ${this.total} 条`)
  },
}
