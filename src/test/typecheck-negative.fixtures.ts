// 负向类型夹具：门禁「真的会红」的证据。
//
// 这个文件**故意**写入三类错误用法，由 `tsconfig.typecheck-negative.json` +
// `npm run typecheck:negative` 单独检查（正向门禁 `tsconfig.typecheck.json` 显式
// exclude 本文件）。三类错误分别对应阶段 1 必须立住的三条契约：
//   1) 分页属性类型：page 是数字，不是「第二页」这种文案；
//   2) 事件参数类型：change 只接受数字页码；
//   3) 异步加载器返回值：必须是组件 / 组件模块，不能是任意值。
//
// 断言方式（scripts/typecheck-negative.mjs）：逐行匹配下方 [NEG-n] 标记，
// 要求每个标记所在行都出现在 vue-tsc 的诊断里，且诊断条数恰好等于 3。
// 如果哪天有人把三支组件的类型放宽成 `any`，这三行就不再报错 → 负向门禁失败。
import AsyncPanel from '@/modules/shared/components/AsyncPanel.vue'
import PaginationBar from '@/modules/shared/components/PaginationBar.vue'

type PagerProps = InstanceType<typeof PaginationBar>['$props']
type PagerEmit = InstanceType<typeof PaginationBar>['$emit']
type AsyncPanelLoader = InstanceType<typeof AsyncPanel>['$props']['loader']

// [NEG-1] 分页属性类型：page 只能是 number
export const wrongPageType: PagerProps = { page: '第二页' }

declare const emitPager: PagerEmit
// [NEG-2] 事件参数类型：change 的载荷只能是 number
export const wrongChangePayload: void = emitPager('change', '第二页')

// [NEG-3] 异步加载器返回值：必须 resolve 成组件或组件模块
export const wrongLoaderReturn: AsyncPanelLoader = async () => 'not-a-component'
