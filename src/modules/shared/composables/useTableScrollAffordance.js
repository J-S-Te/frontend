// 宽表格横向滚动的边缘提示（合同 / 平台控制台 / 结算 / 数据分析 / CRM / 项目管理共用）。
//
// 旧实现把渐隐画在滚动容器自己的 background-image 上，靠 background-attachment:
// local, scroll 判断“有没有溢出”。它有两个结构性缺陷，无法靠调参修好：
//   1. 容器背景永远画在所有子元素之下。表头 th 有各自的不透明底色
//      （customer-opportunity.css / console.css / contract-management.css /
//      settlement.css / data-analysis.css / project-management.css 都设了），
//      于是右缘渐隐在表头那一行被整行盖住，看上去像从表头下方才开始；
//   2. 背景层不知道自己滚到哪里，滚到最右仍然显示“右侧还有列”。
//
// 现在改成“宿主覆盖层 + 滚动状态”：
//   · 覆盖层是滚动容器父元素（宿主）上的 ::before / ::after，position: absolute +
//     z-index 高于表头 sticky 层级，所以一定画在不透明表头之上；
//   · 覆盖层什么时候出现由滚动状态 class 决定（is-table-scroll-left / -right），
//     滚到尽头即隐藏，滚回来再出现；不溢出时两个 class 都不加，视觉完全不变；
//   · 覆盖层位置用容器“内容盒”相对宿主 padding box 的偏移写成 CSS 变量，
//     因为它画在宿主上，必须自己算出和滚动容器对齐的矩形；
//   · 滚动容器自身的 DOM 结构、直接子元素选择器（.table-panel > h2 等）、
//     服务端渲染输出都不改，所以已有 SSR golden 不受影响。
//
// 纯函数 resolveTableScrollState 负责状态判定、resolveTableScrollEdgeInsets 负责
// 覆盖层矩形换算，两者都不依赖 DOM，可以直接单测。
//
// 已知取舍（都是这套“宿主覆盖层”方案的固有边界，不要当成 bug 修）：
//   · 一个宿主只会被一个滚动容器占用（hostOwners）：同一个父元素里并排放两个宽表时，
//     第二个容器不增强、继续用容器自身的降级渐隐（.table-scroll-enhanced 不生效），
//     因为一对 ::before/::after 无法同时对齐两个矩形。要给两个表都加提示，就把它们
//     各自包进一层父元素。
//   · 宿主是 static 定位时会被加 position: relative（.table-scroll-host--static）：
//     这会给宿主里已有的 absolute 后代重新锚定，可能改变它们的位置。这类布局本来
//     就没有稳定的定位基准，但改成 relative 后偏移基准变成宿主 padding box。
//   · <body> / <html> 不做宿主：给 body 加 position: relative 会把整页变成定位容器，
//     影响所有 fixed/sticky 元素，所以这类容器直接跳过（不增强、不加 class，保留
//     容器自身的降级渐隐）。同理，Teleport 到 body 的容器也不会得到覆盖层。
//   · 容器被强制成 8px 常驻经典滚动条时，覆盖层宽度按内容盒（不含滚动条）换算，
//     滚动条与覆盖层之间会留一条 24px 里最右侧约 8px 的窄带没有渐隐；这是为了让
//     渐隐不遮住滚动条本身。macOS 覆盖式滚动条下没有这条窄带。
//   · MutationObserver 只订阅 childList/subtree（不再订阅 characterData）：过滤输入
//     框里每敲一个字都会触发 characterData，而它从不改变表格的宽度与滚动位置，却会
//     让整页重算几何。文本变长把容器撑宽这类真正影响几何的变化，一定伴随节点插入或
//     ResizeObserver 回调，仍然会被重算覆盖。

// 所有需要边缘提示的滚动容器。新增模块在此登记一次即可。
// [data-table-scroll] 是显式 opt-in 标记：不在下面共享类清单里的新表格容器，
// 只要在滚动容器上加这个属性就会被识别，无需再改这里与 global-ux.css 的类清单。
export const TABLE_SCROLL_SCROLLERS = Object.freeze([
  '.contract-table-scroll',
  '.console-table-scroll',
  '.settlement-table-scroll',
  '.da-table-scroll',
  '.pm-table-scroll',
  '.table-panel',
  '.filetask-table-wrap',
  '.iam-mini-table',
  '[data-table-scroll]',
])

export const TABLE_SCROLL_SELECTOR = TABLE_SCROLL_SCROLLERS.join(', ')

// class 名：is-table-scroll-* 同时写在滚动容器和宿主上，便于 CSS 与测试断言。
export const TABLE_SCROLL_CLASS = Object.freeze({
  host: 'table-scroll-host',
  staticHost: 'table-scroll-host--static',
  enhanced: 'table-scroll-enhanced',
  canLeft: 'is-table-scroll-left',
  canRight: 'is-table-scroll-right',
})

// 覆盖层矩形变量名，由 installTableScrollAffordance 写到宿主元素的 inline style 上。
export const TABLE_SCROLL_EDGE_VARS = Object.freeze({
  top: '--table-scroll-edge-top',
  right: '--table-scroll-edge-right',
  left: '--table-scroll-edge-left',
  height: '--table-scroll-edge-height',
})

// 亚像素取整误差容忍值：scrollWidth/clientWidth 可能差 0.5px，不能算作可滚动。
export const TABLE_SCROLL_EPSILON = 1

// 判断滚动容器当前还能往哪边滚。
// 参数：metrics 为 { scrollLeft, scrollWidth, clientWidth }（DOM 读数或测试数据）。
// 返回值：{ maxScrollLeft, overflowing, canScrollLeft, canScrollRight }；
//        没有溢出时两个方向都是 false，因此“不能滚动就不显示提示”仍然成立。
export function resolveTableScrollState(metrics = {}, epsilon = TABLE_SCROLL_EPSILON) {
  const scrollLeft = Number(metrics.scrollLeft) || 0
  const scrollWidth = Math.max(0, Number(metrics.scrollWidth) || 0)
  const clientWidth = Math.max(0, Number(metrics.clientWidth) || 0)
  const maxScrollLeft = Math.max(0, scrollWidth - clientWidth)
  const safeEpsilon = Number.isFinite(epsilon) ? Math.max(0, epsilon) : TABLE_SCROLL_EPSILON
  const overflowing = maxScrollLeft > safeEpsilon
  return {
    maxScrollLeft,
    overflowing,
    canScrollLeft: overflowing && scrollLeft > safeEpsilon,
    canScrollRight: overflowing && scrollLeft < maxScrollLeft - safeEpsilon,
  }
}

// 把滚动状态映射成要加的 class 列表（纯函数，方便无 DOM 断言）。
// 参数：state 为 resolveTableScrollState 的返回值。
// 返回值：需要启用的 class 数组；空数组表示不显示任何覆盖层。
export function tableScrollStateClasses(state = {}) {
  const classes = []
  if (state.canScrollLeft) classes.push(TABLE_SCROLL_CLASS.canLeft)
  if (state.canScrollRight) classes.push(TABLE_SCROLL_CLASS.canRight)
  return classes
}

// 换算覆盖层相对宿主 padding box 的矩形。
// 参数：scrollerRect/hostRect 为 getBoundingClientRect()，其余为对应 client* 与滚动偏移。
// 返回值：{ top, left, right, height }，单位 px，已按 0.01px 取整；
//         left/right 用内容盒（不含滚动条与边框），覆盖层不会盖住滚动条。
export function resolveTableScrollEdgeInsets(measure = {}) {
  const scrollerRect = measure.scrollerRect || {}
  const hostRect = measure.hostRect || {}
  const hostClientLeft = Number(measure.hostClientLeft) || 0
  const hostClientTop = Number(measure.hostClientTop) || 0
  const hostScrollLeft = Number(measure.hostScrollLeft) || 0
  const hostScrollTop = Number(measure.hostScrollTop) || 0
  const hostClientWidth = Number(measure.hostClientWidth) || 0
  const scrollerClientLeft = Number(measure.scrollerClientLeft) || 0
  const scrollerClientTop = Number(measure.scrollerClientTop) || 0
  const scrollerClientWidth = Number(measure.scrollerClientWidth) || 0
  const scrollerClientHeight = Number(measure.scrollerClientHeight) || 0
  const round = value => Math.round(value * 100) / 100
  const left = round((Number(scrollerRect.left) || 0) - (Number(hostRect.left) || 0)
    - hostClientLeft + hostScrollLeft + scrollerClientLeft)
  const top = round((Number(scrollerRect.top) || 0) - (Number(hostRect.top) || 0)
    - hostClientTop + hostScrollTop + scrollerClientTop)
  return {
    top,
    left,
    right: round(hostClientWidth - (left + scrollerClientWidth)),
    height: round(scrollerClientHeight),
  }
}

// 只在真正能横向滚动时才画覆盖层：overflow-x 为 visible（例如审计表在小屏切成卡片）
// 的容器即使内容更宽也不该出现“右侧还有列”。
// 参数：el 为滚动容器，win 为对应窗口。
// 返回值：布尔值。
function isHorizontallyScrollable(el, win) {
  try {
    const overflowX = win.getComputedStyle(el)?.overflowX
    return overflowX === 'auto' || overflowX === 'scroll'
  } catch {
    return false
  }
}

// installTableScrollAffordance 安装全局边缘提示：扫描现有滚动容器、监听新增节点、
// 滚动与尺寸变化，按需增删状态 class 和覆盖层矩形变量。
// 参数：options.window / options.document 便于测试注入；options.scheduleDelay 为
//       结构变化后的合并等待（毫秒，默认 120）。
// 返回值：清理函数；调用后移除全部监听、class 与 CSS 变量。
export function installTableScrollAffordance(options = {}) {
  const {
    window: win = globalThis.window,
    document: doc = globalThis.document,
    scheduleDelay = 120,
  } = options
  if (!win || !doc || typeof doc.querySelectorAll !== 'function') return () => {}

  const scrollers = new Map() // 滚动容器 -> entry
  const hostOwners = new Map() // 宿主 -> 滚动容器（一个宿主只承载一组覆盖层）
  const observed = new Map() // 被 ResizeObserver 观察的元素 -> entry
  const resizeObserver = typeof win.ResizeObserver === 'function'
    ? new win.ResizeObserver(records => {
      for (const record of records) {
        if (observed.has(record.target)) {
          scheduleScan({ geometry: true })
          return
        }
      }
    })
    : null

  let scanTimer = 0
  let scheduled = false
  let needGeometry = false

  // toggleClass 只在状态变化时写 DOM，避免滚动时反复触发样式重算。
  // 参数：el 为元素，name 为 class，on 为是否启用。
  // 返回值：无。
  function toggleClass(el, name, on) {
    if (!el) return
    if (on) {
      if (!el.classList.contains(name)) el.classList.add(name)
    } else if (el.classList.contains(name)) {
      el.classList.remove(name)
    }
  }

  // clearEdgeGeometry 清掉宿主上的覆盖层矩形变量。
  // 参数：host 为宿主元素。
  // 返回值：无。
  function clearEdgeGeometry(host) {
    if (!host?.style) return
    for (const name of Object.values(TABLE_SCROLL_EDGE_VARS)) host.style.removeProperty(name)
  }

  // applyEdgeGeometry 把滚动容器内容盒换算成宿主上的覆盖层矩形。
  // 参数：entry 为滚动容器记录。
  // 返回值：无；容器不可见（display:none）时跳过，等 ResizeObserver 再算。
  function applyEdgeGeometry(entry) {
    const { scroller, host } = entry
    if (!host?.isConnected || !scroller.isConnected) return
    const scrollerRect = scroller.getBoundingClientRect()
    const hostRect = host.getBoundingClientRect()
    if (!scrollerRect.width && !scrollerRect.height) return
    if (!hostRect.width && !hostRect.height) return
    const insets = resolveTableScrollEdgeInsets({
      scrollerRect,
      hostRect,
      hostClientLeft: host.clientLeft,
      hostClientTop: host.clientTop,
      hostScrollLeft: host.scrollLeft,
      hostScrollTop: host.scrollTop,
      hostClientWidth: host.clientWidth,
      scrollerClientLeft: scroller.clientLeft,
      scrollerClientTop: scroller.clientTop,
      scrollerClientWidth: scroller.clientWidth,
      scrollerClientHeight: scroller.clientHeight,
    })
    host.style.setProperty(TABLE_SCROLL_EDGE_VARS.top, `${insets.top}px`)
    host.style.setProperty(TABLE_SCROLL_EDGE_VARS.left, `${insets.left}px`)
    host.style.setProperty(TABLE_SCROLL_EDGE_VARS.right, `${insets.right}px`)
    host.style.setProperty(TABLE_SCROLL_EDGE_VARS.height, `${insets.height}px`)
  }

  // syncState 读取滚动位置并更新容器/宿主的两个状态 class。
  // 参数：entry 为滚动容器记录；layout 为是否同时刷新覆盖层矩形与滚动能力判定。
  // 返回值：本轮状态（便于测试与调试）。
  function syncState(entry, { layout = false } = {}) {
    const { scroller, host } = entry
    if (!scroller.isConnected) return null
    let state = resolveTableScrollState({
      scrollLeft: scroller.scrollLeft,
      scrollWidth: scroller.scrollWidth,
      clientWidth: scroller.clientWidth,
    })
    if (layout && !isHorizontallyScrollable(scroller, win)) {
      state = { maxScrollLeft: 0, overflowing: false, canScrollLeft: false, canScrollRight: false }
    }
    toggleClass(scroller, TABLE_SCROLL_CLASS.canLeft, state.canScrollLeft)
    toggleClass(scroller, TABLE_SCROLL_CLASS.canRight, state.canScrollRight)
    if (host && hostOwners.get(host) === scroller) {
      toggleClass(host, TABLE_SCROLL_CLASS.canLeft, state.canScrollLeft)
      toggleClass(host, TABLE_SCROLL_CLASS.canRight, state.canScrollRight)
    }
    if (layout) applyEdgeGeometry(entry)
    return state
  }

  // enhance 给一个滚动容器接上宿主覆盖层与观察器。
  // 参数：scroller 为滚动容器元素。
  // 返回值：新建的记录；宿主不可用（不存在 / 是 body / html）或已被其它滚动容器占用
  //         时返回 null——不抢同一个 ::after，也不给文档根加 position: relative。
  function enhance(scroller) {
    if (scrollers.has(scroller)) return scrollers.get(scroller)
    const host = scroller.parentElement
    if (!host) return null
    // <body> / <html> 不做宿主：position: relative 会落到整页上，改变 fixed/sticky
    // 与所有 absolute 后代的定位基准。跳过时容器保留自身的降级渐隐。
    if (host === doc.body || host === doc.documentElement) return null
    if (hostOwners.has(host)) return null
    let entry = {
      scroller,
      host,
    }
    scroller.classList.add(TABLE_SCROLL_CLASS.enhanced)
    host.classList.add(TABLE_SCROLL_CLASS.host)
    try {
      if (win.getComputedStyle(host)?.position === 'static') host.classList.add(TABLE_SCROLL_CLASS.staticHost)
    } catch {
      host.classList.add(TABLE_SCROLL_CLASS.staticHost)
    }
    hostOwners.set(host, scroller)
    scrollers.set(scroller, entry)
    observed.set(scroller, entry)
    observed.set(host, entry)
    try {
      resizeObserver?.observe(scroller)
      resizeObserver?.observe(host)
    } catch {
      // 观察失败时仍然保留滚动与结构变化监听。
    }
    // 首帧先同步状态与矩形，避免等到下一次结构变化才出现覆盖层。
    syncState(entry, { layout: true })
    return entry
  }

  // release 撤销单个滚动容器的增强，恢复成安装前的 DOM。
  // 参数：entry 为滚动容器记录。
  // 返回值：无。
  function release(entry) {
    const { scroller, host } = entry
    scrollers.delete(scroller)
    for (const element of [scroller, host]) {
      if (!element) continue
      observed.delete(element)
      try {
        resizeObserver?.unobserve(element)
      } catch {
        // 元素已脱离文档时 unobserve 可能抛错，忽略即可。
      }
    }
    scroller.classList.remove(TABLE_SCROLL_CLASS.enhanced,
      TABLE_SCROLL_CLASS.canLeft, TABLE_SCROLL_CLASS.canRight)
    if (host) {
      if (hostOwners.get(host) === scroller) hostOwners.delete(host)
      host.classList.remove(TABLE_SCROLL_CLASS.host, TABLE_SCROLL_CLASS.staticHost,
        TABLE_SCROLL_CLASS.canLeft, TABLE_SCROLL_CLASS.canRight)
      clearEdgeGeometry(host)
    }
  }

  // prune 清理已经从文档里移除的滚动容器（v-if 切换、路由切换、弹窗关闭）。
  // 参数：无。
  // 返回值：无。
  function prune() {
    for (const [scroller, entry] of [...scrollers]) {
      if (!scroller.isConnected) release(entry)
    }
  }

  // scan 把当前文档里的滚动容器全部接上增强，并刷新已接上的容器。
  // 参数：geometry 为是否需要重算覆盖层矩形（结构变化时为 true）。
  // 返回值：无。
  function scan(geometry) {
    prune()
    let candidates = []
    try {
      candidates = [...doc.querySelectorAll(TABLE_SCROLL_SELECTOR)]
    } catch {
      candidates = []
    }
    for (const scroller of candidates) {
      if (!scrollers.has(scroller)) enhance(scroller)
      else if (geometry) syncState(scrollers.get(scroller), { layout: true })
      else syncState(scrollers.get(scroller))
    }
  }

  // runScheduledScan 执行合并后的扫描。
  // 参数：无。
  // 返回值：无。
  function runScheduledScan() {
    scheduled = false
    const geometry = needGeometry
    needGeometry = false
    scan(geometry)
  }

  // scheduleScan 合并同一轮的多条通知，避免每个节点变化都整页重算。
  // 参数：geometry 为是否需要重算覆盖层矩形。
  // 返回值：无。
  function scheduleScan({ geometry = false } = {}) {
    if (geometry) needGeometry = true
    if (scheduled) return
    scheduled = true
    if (typeof win.setTimeout === 'function') {
      scanTimer = win.setTimeout(runScheduledScan, scheduleDelay)
    } else {
      runScheduledScan()
    }
  }

  // onScroll 只处理已接上的滚动容器；页面滚动不需要重算（覆盖层是宿主内绝对定位）。
  // 参数：event 为捕获到的滚动事件。
  // 返回值：无。
  function onScroll(event) {
    const target = event?.target
    const entry = target && scrollers.get(target)
    if (entry) syncState(entry)
  }

  // onResize 在视口变化后重算矩形与滚动能力。
  // 参数：无。
  // 返回值：无。
  function onResize() {
    scheduleScan({ geometry: true })
  }

  let mutationObserver = null
  if (typeof win.MutationObserver === 'function' && doc.documentElement) {
    mutationObserver = new win.MutationObserver(() => scheduleScan({ geometry: true }))
    // 只订阅 childList/subtree：characterData 会在过滤输入框每敲一个字时触发，
    // 让整页重算几何；文本变化本身不改变表格宽度与滚动位置（见文件头取舍说明）。
    mutationObserver.observe(doc.documentElement, { childList: true, subtree: true })
  }
  doc.addEventListener('scroll', onScroll, { capture: true, passive: true })
  win.addEventListener('resize', onResize)
  scan(true)

  return () => {
    if (scanTimer) {
      win.clearTimeout?.(scanTimer)
      scanTimer = 0
    }
    scheduled = false
    needGeometry = false
    doc.removeEventListener('scroll', onScroll, { capture: true })
    win.removeEventListener('resize', onResize)
    mutationObserver?.disconnect()
    mutationObserver = null
    try {
      resizeObserver?.disconnect()
    } catch {
      // ignore
    }
    for (const entry of [...scrollers.values()]) release(entry)
  }
}
