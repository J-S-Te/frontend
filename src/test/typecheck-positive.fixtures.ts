// 正向类型夹具：证明「三支共享组件暴露的类型确实可用」。
//
// 为什么要有这个文件：`npm run typecheck` 只检查组件自己的 `<script lang="ts">`，
// 组件内部写 `props.page` 都能过；但「接入方按签名传参」是另一回事。这份夹具用
// 合法写法把三支组件的对外契约完整走一遍，任何一条签名退化成 `any` 或删掉某个
// 属性/事件，这里就会跟着红。
//
// 类型一律从组件本身推导（`InstanceType<typeof X>['$props']`），不另外复制一份
// 手写接口：复制品会与组件真实声明漂移，推导不会。
import AsyncPanel from '@/modules/shared/components/AsyncPanel.vue'
import ListState from '@/modules/shared/components/ListState.vue'
import PaginationBar from '@/modules/shared/components/PaginationBar.vue'

// 分页条对外契约：属性对象 + 两类翻页事件。
export type PagerProps = InstanceType<typeof PaginationBar>['$props']
export type PagerEmit = InstanceType<typeof PaginationBar>['$emit']

// 三态闸门对外契约：loading / error 取值与 retry 事件。
export type ListStateProps = InstanceType<typeof ListState>['$props']
export type ListStateEmit = InstanceType<typeof ListState>['$emit']

// 异步面板对外契约：加载器签名。
export type AsyncPanelProps = InstanceType<typeof AsyncPanel>['$props']
export type AsyncPanelLoader = AsyncPanelProps['loader']

// ── 分页属性：整条「服务端总数 + 页码窗口 + 页大小候选」的合法组合 ────────────
export const pagerPropsWithTotal: PagerProps = {
  page: 3,
  total: 120,
  count: 20,
  pageSize: 20,
  pageSizeOptions: [20, 50, 100],
  hasMore: true,
  loading: false,
  disabled: false,
  label: '审计事件分页',
  prevText: '上一页',
  nextText: '下一页',
  loadingText: '正在加载…',
}

// 「接口不返回总数」的合法写法：total / count 允许 null，hasMore 由调用方给出。
export const pagerPropsOffsetOnly: PagerProps = {
  page: 1,
  total: null,
  count: 20,
  pageSize: 20,
  pageSizeOptions: null,
  hasMore: false,
  label: '结算明细分页',
}

// ── 翻页事件：页码是数字，页大小也是数字 ────────────────────────────────────
declare const emitPager: PagerEmit
export const pagerChange: void = emitPager('change', 3)
export const pagerChangePageSize: void = emitPager('change-page-size', 50)

// ── 三态闸门的 retry 事件：无载荷 ───────────────────────────────────────────
declare const emitListState: ListStateEmit
export const listRetry: void = emitListState('retry')

// ── 三态闸门：三种状态的合法取值 ────────────────────────────────────────────
export const listLoading: ListStateProps = { loading: true, loadingTitle: '加载中…' }
export const listFailedWithString: ListStateProps = {
  loading: false, error: '加载失败：网关超时', errorTitle: '客户列表加载失败', retry: true, retryText: '重新加载',
}
export const listFailedWithError: ListStateProps = { error: new Error('网络连接已断开') }
export const listEmpty: ListStateProps = { emptyTitle: '暂无数据', emptyDescription: '', emptyIcon: 'info', compact: true }

// ── 异步面板加载器：`() => import('./View.vue')` 与「直接返回组件定义」两种合法形态 ──
export const moduleLoader: AsyncPanelLoader = async () => await import('@/modules/shared/components/EmptyState.vue')
export const componentLoader: AsyncPanelLoader = async () => (await import('@/modules/shared/components/EmptyState.vue')).default
