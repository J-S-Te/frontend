<script setup>
// 共享应用外壳：侧栏（品牌 / 分组导航 / 用户区）+ 主区（顶栏 / 页头 / 内容 / 遮罩）。
//
// 设计约束：
// 1. 只复用 console.css 既有类名（.console-page / .console-sidebar / .console-main /
//    .console-topbar / .console-content / .console-page-head / .console-menu-mask …），
//    不新建平行样式系统；样式表仍由各模块自己 import，外壳不引入任何模块的 CSS，
//    因此迁移前后视觉一致，后续模块也自动沿用同一套视觉语言。
// 2. 模块无关：导航项、面包屑、顶栏操作区、页头、内容、弹窗全部由 props / slots 提供，
//    组件内不写死任何模块文案、权限判断或路由名。
// 3. 抽屉状态由 v-model:menu-open 双向绑定，模块保留自己 mobileMenuOpen 的语义与
//    关闭时机；外壳只负责 ≤820px 抽屉的按钮、遮罩与「导航后自动收起」。
// 4. 无障碍契约：当前页导航项带 aria-current="page"，汉堡按钮用 aria-expanded /
//    aria-controls 关联侧栏，抽屉打开时 Escape 可收起并把焦点交还汉堡按钮。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ConsoleIcon from '@/modules/shared/components/ConsoleIcon.vue'
import {
  THEME_MODES,
  THEME_PREFERENCE_CHANGED_EVENT,
  THEME_STORAGE_KEY,
  readThemePreference,
  writeThemePreference,
} from '@/modules/shared/theme/themePreference.js'
import {
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  readSidebarCollapsed,
  writeSidebarCollapsed,
} from '@/modules/shared/utils/shellPreferences.js'

const props = defineProps({
  // 外壳各区块的附加类名：模块用它们挂自己的皮肤（settlement-sidebar / crm-main …）。
  pageClass: { type: String, default: '' },
  sidebarClass: { type: String, default: '' },
  brandClass: { type: String, default: '' },
  navClass: { type: String, default: '' },
  sidebarUserClass: { type: String, default: '' },
  mainClass: { type: String, default: '' },
  topbarClass: { type: String, default: '' },
  contentClass: { type: String, default: '' },
  // 主区 id：跳过导航链接（#main-content）的落点，必须稳定存在。
  mainId: { type: String, default: 'main-content' },
  // 品牌区默认内容；需要更复杂的品牌块时用 #brand 插槽整体替换。
  brandName: { type: String, default: '' },
  brandSubtitle: { type: String, default: '' },
  brandIcon: { type: String, default: 'logo' },
  // 分组导航：navLabel 是 <nav> 的无障碍名称，navGroups 见下方 navGroups 注释。
  navLabel: { type: String, default: '主导航' },
  navGroups: { type: Array, default: () => [] },
  // 导航为空时是否展示提示块；默认在「没有任何可见导航项」时自动展示。
  navEmpty: { type: Boolean, default: false },
  // 面包屑末级（#breadcrumb 插槽缺失时的兜底文案）。
  crumb: { type: String, default: '' },
  // 抽屉状态：v-model:menu-open。
  menuOpen: { type: Boolean, default: false },
  // 侧栏用户区默认内容；需要完全自定义时用 #sidebar-user 插槽替换。
  userName: { type: String, default: '' },
  userRole: { type: String, default: '' },
  avatarText: { type: String, default: '' },
  logoutLabel: { type: String, default: '退出应用系统' },
  logoutDisabled: { type: Boolean, default: false },
  // 是否在顶栏操作区右侧渲染账号头像。
  topbarAvatar: { type: Boolean, default: false },
  // 基类替换：项目/合同/数据看板自有一套 pm-*/contract-*/da-* 壳层样式且不 import console.css，
  // 提供这两个 prop 时用它替换内层写死的 console-sidebar / console-main 基类（缺省行为不变）。
  sidebarBaseClass: { type: String, default: 'console-sidebar' },
  mainBaseClass: { type: String, default: 'console-main' },
})

// navGroups 结构：
// [{ key?, label?, collapsible?, items: [{ key, label, icon, title?, note?, noteClass?, active?, visible?, itemClass? }] }]
// - label 为空表示该组不渲染分组标题（用于「返回门户」这类置顶单项）。
// - visible: false 的项不渲染（替代模块里的 v-if="hasPermission(...)"）。
// - note 渲染成 .console-nav-note 小标签，itemClass 用于 --portal 等单项修饰类；
//   noteClass 可替换 note 的类名（例如 CRM 的 .crm-nav-badge），缺省仍是 .console-nav-note。
// - collapsible: true 且有 label 时，分组标题渲染成可折叠按钮（aria-expanded 开合），
//   默认关闭 → 既有模块的分组标题仍是 <p class="console-nav-label">，导航项顺序不变。
// - key 是折叠状态的稳定标识，缺省回退到 label。
const emit = defineEmits(['update:menuOpen', 'navigate', 'logout'])

const normalizedGroups = computed(() => (Array.isArray(props.navGroups) ? props.navGroups : [])
  .map((group) => ({
    label: String(group?.label || ''),
    // 折叠只对「有标题的分组」生效；没有标题就没有可点击的分组标题。
    collapsible: group?.collapsible === true && String(group?.label || '').trim() !== '',
    key: String(group?.key || group?.label || ''),
    items: (Array.isArray(group?.items) ? group.items : [])
      .filter((item) => item && item.visible !== false && String(item.label || '').trim()),
  }))
  .filter((group) => group.items.length > 0))

const hasNavItems = computed(() => normalizedGroups.value.length > 0)
const showNavEmpty = computed(() => props.navEmpty || !hasNavItems.value)

// 与各模块既有的头像口径一致：有外部传入就直用，否则按 ASCII / 中文分别取 2 位或 1 位。
const avatarInitials = computed(() => {
  if (props.avatarText) return props.avatarText
  const name = String(props.userName || '').trim()
  if (!name) return '用'
  if (/^[\x00-\x7F]+$/.test(name)) return name.slice(0, 2).toUpperCase()
  return Array.from(name).slice(0, 1).join('') || '用'
})

// setMenuOpen 统一收敛抽屉状态修改，避免模块与外壳各改一份。
// 参数：next 为目标状态。返回值：无。
function setMenuOpen(next) {
  if (props.menuOpen === next) return
  emit('update:menuOpen', next)
}

// 侧栏的稳定 id：汉堡按钮用 aria-controls 指向它，建立「按钮控制抽屉」的可访问关系。
const SIDEBAR_ID = 'app-shell-sidebar'

// 桌面侧栏折叠（P1-12）：状态持久化在 localStorage，避免刷新后跳回展开；
// 是否作用到布局由 CSS 的 min-width:821px 媒体查询决定，窄屏仍走抽屉。
const sidebarCollapsed = ref(readSidebarCollapsed())

// 主题模式（P1-10）：浅色 / 深色 / 跟随系统。写入与门户开关同一个
// localStorage 键并广播同一事件，<html data-theme> 由文档级同步统一投射。
const themeMode = ref(readThemePreference())
const themeOptions = THEME_MODES.map((value) => ({
  value,
  label: value === 'light' ? '浅色' : value === 'dark' ? '深色' : '跟随系统',
}))

// syncShellPreferences 从存储重读两项偏好；跨标签页 storage 事件与门户切换都复用它。
// 参数：无。返回值：无。
function syncShellPreferences() {
  sidebarCollapsed.value = readSidebarCollapsed()
  themeMode.value = readThemePreference()
}

// toggleSidebarCollapsed 切换折叠并立即持久化；持久化失败只影响下次刷新，不影响本次布局。
// 参数：无。返回值：无。
function toggleSidebarCollapsed() {
  sidebarCollapsed.value = !sidebarCollapsed.value
  writeSidebarCollapsed(sidebarCollapsed.value)
}

// selectTheme 持久化主题偏好并广播变更事件，文档级同步据此更新 data-theme。
// 参数：mode 为 'light' | 'dark' | 'system'。返回值：无。
function selectTheme(mode) {
  if (!THEME_MODES.includes(mode)) return
  themeMode.value = mode
  writeThemePreference(mode)
}

// onShellStorage 只响应本外壳关心的两个键，其它模块的 storage 事件不触发重读。
// 参数：event 为 storage 事件。返回值：无。
function onShellStorage(event) {
  if (!event || event.key === null || event.key === SIDEBAR_COLLAPSED_STORAGE_KEY || event.key === THEME_STORAGE_KEY) {
    syncShellPreferences()
  }
}

// onThemePreferenceChanged 同步同标签页内的门户主题切换（storage 事件不会跨同页触发）。
// 参数：无。返回值：无。
function onThemePreferenceChanged() {
  themeMode.value = readThemePreference()
}
// 汉堡按钮引用：Escape 收起抽屉后把焦点交还给它，键盘用户不会掉进已隐藏的侧栏。
const menuButton = ref(null)

// closeMenuOnEscape 处理文档级 Escape：只在抽屉打开时收起，抽屉没开就不拦截，
// 这样模块自己的弹窗 / 下拉仍然拿到同一个按键。
// 参数：event 为 keydown 事件。返回值：无。
function closeMenuOnEscape(event) {
  if (event.key !== 'Escape' && event.key !== 'Esc') return
  if (!props.menuOpen) return
  setMenuOpen(false)
  menuButton.value?.focus?.()
}

// 抽屉遮罩/侧栏内的焦点不会冒泡到外壳根节点，所以 Escape 必须挂在 document 上；
// 组件卸载时移除，避免模块切走后仍持有监听。
onMounted(() => {
  // 非浏览器环境（node --test 的渲染用例）没有 document，直接跳过。
  if (typeof document === 'undefined') return
  document.addEventListener('keydown', closeMenuOnEscape)
  syncShellPreferences()
  window.addEventListener('storage', onShellStorage)
  window.addEventListener(THEME_PREFERENCE_CHANGED_EVENT, onThemePreferenceChanged)
})
onBeforeUnmount(() => {
  if (typeof document === 'undefined') return
  document.removeEventListener('keydown', closeMenuOnEscape)
  window.removeEventListener('storage', onShellStorage)
  window.removeEventListener(THEME_PREFERENCE_CHANGED_EVENT, onThemePreferenceChanged)
})

// 折叠分组状态：默认全部展开；键取 group.key（缺省回退分组标题）。
const collapsedGroups = ref(new Set())

// isGroupCollapsed 判断分组是否折叠。
// 参数：key 为分组标识。返回值：布尔值；非折叠分组恒为 false。
function isGroupCollapsed(key) {
  return collapsedGroups.value.has(key)
}

// toggleGroup 切换分组折叠状态；替换 Set 以触发响应式更新。
// 参数：key 为分组标识。返回值：无。
function toggleGroup(key) {
  const next = new Set(collapsedGroups.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsedGroups.value = next
}

// selectNav 处理导航点击：先收起抽屉，再把导航键抛给模块处理路由。
// 参数：item 为被点击的导航项。返回值：无。
function selectNav(item) {
  setMenuOpen(false)
  emit('navigate', item.key, item)
}
</script>

<template>
  <div class="console-page" :class="[pageClass, sidebarCollapsed ? 'is-sidebar-collapsed' : '']">
    <aside :id="SIDEBAR_ID" :class="[sidebarBaseClass, sidebarClass, { open: menuOpen }]">
      <div class="console-brand" :class="brandClass">
        <slot name="brand">
          <span class="console-brand-mark"><ConsoleIcon :name="brandIcon" /></span>
          <span class="console-brand-copy">
            <strong>{{ brandName }}</strong>
            <small v-if="brandSubtitle">{{ brandSubtitle }}</small>
          </span>
        </slot>
        <button class="console-close-menu" type="button" aria-label="关闭导航菜单" @click="setMenuOpen(false)"><ConsoleIcon name="close" /></button>
      </div>

      <nav class="console-nav" :class="navClass" :aria-label="navLabel">
        <slot name="nav">
          <template v-for="(group, index) in normalizedGroups" :key="group.label || `group-${index}`">
            <button
              v-if="group.collapsible"
              class="console-nav-label console-nav-label--toggle"
              type="button"
              :aria-expanded="isGroupCollapsed(group.key) ? 'false' : 'true'"
              @click="toggleGroup(group.key)"
            ><span>{{ group.label }}</span></button>
            <p v-else-if="group.label" class="console-nav-label">{{ group.label }}</p>
            <template v-if="!group.collapsible || !isGroupCollapsed(group.key)">
              <button
                v-for="item in group.items"
                :key="item.key"
                class="console-nav-item"
                :class="[item.itemClass, { active: Boolean(item.active) }]"
                type="button"
                :title="item.title || undefined"
                :aria-current="item.active ? 'page' : undefined"
                @click="selectNav(item)"
              >
                <ConsoleIcon v-if="item.icon" :name="item.icon" />
                <span>{{ item.label }}</span>
                <span v-if="item.note" :class="item.noteClass || 'console-nav-note'">{{ item.note }}</span>
              </button>
            </template>
          </template>
        </slot>
        <slot name="nav-extra" />
        <p v-if="showNavEmpty" class="console-nav-empty"><slot name="nav-empty">当前账号没有可访问的菜单模块。</slot></p>
      </nav>

      <div v-if="$slots['sidebar-note']" class="console-sidebar-note"><slot name="sidebar-note" /></div>

      <div v-if="userName || $slots['sidebar-user']" class="console-sidebar-user" :class="sidebarUserClass">
        <slot name="sidebar-user">
          <span class="console-avatar" aria-hidden="true">{{ avatarInitials }}</span>
          <span class="console-user-copy">
            <strong :title="userName">{{ userName }}</strong>
            <small :title="userRole">{{ userRole }}</small>
          </span>
          <button class="console-logout" type="button" :disabled="logoutDisabled" :aria-label="logoutLabel" @click="emit('logout')"><ConsoleIcon name="logout" /></button>
        </slot>
      </div>
    </aside>

    <main :id="mainId" :class="[mainBaseClass, mainClass]" tabindex="-1">
      <slot name="main-prefix" />
      <header class="console-topbar" :class="topbarClass">
        <button ref="menuButton" class="console-menu-button" type="button" aria-label="打开导航菜单" :aria-expanded="menuOpen ? 'true' : 'false'" :aria-controls="SIDEBAR_ID" @click="setMenuOpen(true)"><ConsoleIcon name="menu" /></button>
        <!-- 桌面侧栏折叠：窄屏由 CSS 隐藏，改用汉堡/遮罩抽屉。 -->
        <button class="console-sidebar-toggle" type="button" :aria-label="sidebarCollapsed ? '展开侧栏' : '收起侧栏'" :aria-expanded="sidebarCollapsed ? 'false' : 'true'" :aria-controls="SIDEBAR_ID" @click="toggleSidebarCollapsed"><ConsoleIcon name="chevron" /></button>
        <div class="console-crumb">
          <slot name="breadcrumb">
            <span v-if="brandName">{{ brandName }}</span>
            <ConsoleIcon v-if="crumb" name="chevron" />
            <strong v-if="crumb">{{ crumb }}</strong>
          </slot>
        </div>
        <slot name="topbar-center" />
        <div class="console-topbar-actions">
          <!-- 主题切换：浅色 / 深色 / 跟随系统；与门户开关共用同一存储键与变更事件。 -->
          <div class="console-theme-toggle" role="group" aria-label="界面主题">
            <button v-for="option in themeOptions" :key="option.value" type="button" class="console-theme-option" :class="{ active: themeMode === option.value }" :aria-pressed="themeMode === option.value ? 'true' : 'false'" @click="selectTheme(option.value)">{{ option.label }}</button>
          </div>
          <slot name="topbar-actions" />
          <span v-if="topbarAvatar" class="console-topbar-avatar">{{ avatarInitials }}</span>
        </div>
      </header>

      <section class="console-content" :class="contentClass">
        <slot name="page-head" />
        <slot />
      </section>
    </main>

    <slot name="overlay" />
    <button v-if="menuOpen" class="console-menu-mask" type="button" aria-label="关闭导航遮罩" @click="setMenuOpen(false)"></button>
  </div>
</template>
