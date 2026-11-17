// 全局模态守护：任一弹窗出现时锁定页面滚动、把背景移出可交互/可聚焦范围，
// 并把焦点收进弹窗；关闭后按原样恢复背景与焦点。
//
// 背景：六个子系统和门户里存在大量手写的 modal。命名、层级、遮罩各不相同，
// 一部分没有 role="dialog" / aria-modal；逐个组件改造既容易漏（新增弹窗又会复发），
// 也会和各自皮肤的 DOM 结构耦合。因此沿用原生日期选择器的做法：一次 document 级安装，
// 由它统一兜底。已具备完整焦点管理的共享弹窗（FormDialog / ConfirmDialog / PromptDialog）
// 在根节点标记 data-ui-dialog-managed，由守护让位，避免两套 Tab 陷阱互相抢焦点。

import { acquireBodyScrollLock, releaseBodyScrollLock } from './bodyScrollLock.js'

const ARIA_MODAL = '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]'
const MANAGED_LAYER = '[data-ui-dialog-managed="true"]'
const LAYER_HINT = /(modal|dialog|overlay|backdrop|scrim|mask|drawer|sheet)/i
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

// isVisible 判断元素是否真正参与渲染（v-if/v-show 关闭时都会被排除）。
// 参数：element 为待判断元素，win 为窗口对象。
// 返回值：可见为 true。
function isVisible(element, win) {
  if (!element || !element.isConnected) return false
  const style = win.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

// coversViewport 判断浮层是否铺满视口（遮罩层的基本特征）。
// 参数：element 为浮层，win 为窗口对象。
// 返回值：宽高均达到视口 90% 以上为 true。
function coversViewport(element, win) {
  const rect = element.getBoundingClientRect()
  return rect.width >= win.innerWidth * 0.9 && rect.height >= win.innerHeight * 0.9
}

// layerZIndex 读取计算后的层叠高度，用于选出最上层弹窗。
// 参数：element 为浮层，win 为窗口对象。
// 返回值：数值，无法解析时为 0。
function layerZIndex(element, win) {
  const zIndex = Number.parseInt(win.getComputedStyle(element).zIndex, 10)
  return Number.isFinite(zIndex) ? zIndex : 0
}

// collectModalLayers 收集当前打开的模态层。
// 识别两条路径：① 标准的 role="dialog"/"alertdialog" + aria-modal="true"；
// ② 兜底识别“铺满视口的 fixed 浮层”，用于没有补齐 ARIA 的历史弹窗。
// 参数：doc 为文档，win 为窗口。
// 返回值：按层叠顺序升序排列的数组，元素形如 { root, panel }。
export function collectModalLayers(doc, win) {
  const entries = new Map()
  for (const element of doc.querySelectorAll(ARIA_MODAL)) {
    if (element.closest(MANAGED_LAYER)) continue
    if (!isVisible(element, win)) continue
    entries.set(element, element)
  }
  const hinted = doc.querySelectorAll('[class*="modal"],[class*="dialog"],[class*="overlay"],[class*="backdrop"],[class*="mask"],[class*="scrim"],[class*="drawer"],[class*="sheet"]')
  for (const element of hinted) {
    if (entries.has(element) || element.closest(MANAGED_LAYER)) continue
    if (typeof element.className !== 'string' || !LAYER_HINT.test(element.className)) continue
    // 导航/下拉用的点击遮罩（*-menu-mask 或空 <button>）不是模态，不能锁页面。
    if (element.tagName === 'BUTTON' || /(^|[\s-])menu-mask/.test(element.className)) continue
    if (!element.children.length) continue
    if (win.getComputedStyle(element).position !== 'fixed') continue
    if (!isVisible(element, win)) continue
    // 祖先带 transform/filter 时 fixed 会被收敛到祖先盒，尺寸不足视口；
    // 类名已经明确写出“modal/dialog + mask/backdrop”的浮层按模态处理。
    const explicitModal = /(modal|dialog)[\w-]*(mask|backdrop|scrim)|(mask|backdrop|scrim)[\w-]*(modal|dialog)/i.test(element.className)
    if (!coversViewport(element, win) && !explicitModal) continue
    entries.set(element, element.querySelector(ARIA_MODAL))
  }
  const roots = [...entries.keys()]
  return roots
    // 遮罩与其内部面板会同时命中两条规则；只保留最外层，面板作为焦点容器。
    .filter(root => !roots.some(other => other !== root && other.contains(root)))
    .map(root => ({ root, panel: entries.get(root) || root.querySelector(ARIA_MODAL) || root }))
    .map(layer => ({ ...layer, z: layerZIndex(layer.root, win) }))
    .sort((left, right) => left.z - right.z)
}

// focusableIn 列出弹窗内当前可聚焦的控件。
// 参数：root 为弹窗容器，win 为窗口对象。
// 返回值：可见且未禁用元素的数组。
function focusableIn(root, win) {
  return [...root.querySelectorAll(FOCUSABLE)].filter(element => isVisible(element, win))
}

// focusInto 把焦点交给弹窗：优先首个输入控件，其次首个可聚焦元素，最后容器自身。
// 参数：panel 为焦点容器，win 为窗口对象。
// 返回值：临时补过 tabindex 的元素（调用方负责移除），未补时为 null。
function focusInto(panel, win) {
  if (!panel) return null
  const controls = focusableIn(panel, win)
  const firstInput = controls.find(element => ['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName))
  const target = firstInput || controls[0]
  if (target) {
    target.focus({ preventScroll: true })
    return null
  }
  if (!panel.hasAttribute('tabindex')) {
    panel.setAttribute('tabindex', '-1')
    panel.focus({ preventScroll: true })
    return panel
  }
  panel.focus?.({ preventScroll: true })
  return null
}

// applyBackgroundInert 把弹窗同级的兄弟节点移出交互与可访问树（保留弹窗自身的祖先链）。
// 参数：root 为模态层根节点，doc 为文档。
// 返回值：恢复用的快照数组。
function applyBackgroundInert(root, doc) {
  const touched = []
  let node = root
  while (node && node !== doc.body && node.parentElement) {
    for (const sibling of node.parentElement.children) {
      if (sibling === node || sibling.nodeType !== 1) continue
      if (['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE'].includes(sibling.tagName)) continue
      // 业务自己已经设为 inert 的节点不接管，避免恢复时误删别人的状态。
      if (sibling.hasAttribute('inert') || sibling.getAttribute('aria-hidden') === 'true') continue
      touched.push({ element: sibling, ariaHidden: sibling.getAttribute('aria-hidden') })
      sibling.setAttribute('inert', '')
      sibling.setAttribute('aria-hidden', 'true')
    }
    node = node.parentElement
  }
  return touched
}

// restoreBackground 还原 applyBackgroundInert 的改动。
// 参数：touched 为快照数组。
// 返回值：无。
function restoreBackground(touched) {
  for (const { element, ariaHidden } of touched) {
    element.removeAttribute('inert')
    if (ariaHidden == null) element.removeAttribute('aria-hidden')
    else element.setAttribute('aria-hidden', ariaHidden)
  }
}

// installModalGuard 安装全局弹窗守护。
// 参数：options.doc / options.win 便于测试注入；默认取当前窗口。
// 返回值：卸载函数；重复安装返回同一实例的卸载函数。
export function installModalGuard(options = {}) {
  const doc = options.doc || (typeof document === 'undefined' ? null : document)
  const win = options.win || (typeof window === 'undefined' ? null : window)
  if (!doc || !win || !doc.body) return () => {}

  let layer = null
  let savedFocus = null
  let inertSnapshot = []
  let temporaryTabIndex = null
  let locked = false
  let suspended = false
  let installed = true

  // onKeydown 在弹窗内循环 Tab，避免焦点跑回背景页面。
  // 参数：event 为键盘事件。
  // 返回值：无。
  function onKeydown(event) {
    if (event.key !== 'Tab' || !layer || suspended) return
    const panel = layer.panel
    const items = focusableIn(panel, win)
    if (!items.length) {
      event.preventDefault()
      panel.focus?.({ preventScroll: true })
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const current = doc.activeElement
    if (!panel.contains(current)) {
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus({ preventScroll: true })
      return
    }
    if (event.shiftKey && current === first) {
      event.preventDefault()
      last.focus({ preventScroll: true })
    } else if (!event.shiftKey && current === last) {
      event.preventDefault()
      first.focus({ preventScroll: true })
    }
  }

  // engage 承担一次弹窗的全部副作用；重复调用只更新当前层。
  // 参数：next 为 { root, panel }。
  // 返回值：无。
  function engage(next) {
    if (suspended) return
    if (!locked) {
      savedFocus = doc.activeElement
      acquireBodyScrollLock()
      locked = true
      doc.addEventListener('keydown', onKeydown, true)
      if (!doc.body.dataset.modalGuardOpen) doc.body.dataset.modalGuardOpen = '1'
    }
    if (layer?.root !== next.root) {
      restoreBackground(inertSnapshot)
      inertSnapshot = applyBackgroundInert(next.root, doc)
      temporaryTabIndex?.removeAttribute('tabindex')
      temporaryTabIndex = null
    }
    layer = next
    if (!next.panel.contains(doc.activeElement)) {
      temporaryTabIndex?.removeAttribute('tabindex')
      temporaryTabIndex = focusInto(next.panel, win)
    }
  }

  // disengage 撤销 engage 的全部副作用。
  // 参数：options.restoreFocus 控制是否把焦点还给打开前的元素。
  // 返回值：无。
  function disengage({ restoreFocus = true } = {}) {
    if (!locked && !layer) return
    restoreBackground(inertSnapshot)
    inertSnapshot = []
    temporaryTabIndex?.removeAttribute('tabindex')
    temporaryTabIndex = null
    doc.removeEventListener('keydown', onKeydown, true)
    if (locked) releaseBodyScrollLock()
    locked = false
    delete doc.body.dataset.modalGuardOpen
    const previous = savedFocus
    savedFocus = null
    layer = null
    suspended = false
    if (restoreFocus && previous?.isConnected && typeof previous.focus === 'function') previous.focus({ preventScroll: true })
  }

  // sync 读取当前 DOM 并让守护状态与之一致。
  // 参数：无。
  // 返回值：无。
  function sync() {
    if (!installed) return
    const managed = [...doc.querySelectorAll(MANAGED_LAYER)].some(element => isVisible(element, win))
    const layers = collectModalLayers(doc, win)
    if (!layers.length) {
      disengage()
      return
    }
    // 共享弹窗自带滚动锁与焦点陷阱；它在上层时整体让位，关闭后由下一轮 sync 重新接管。
    if (managed) {
      if (locked || layer) disengage({ restoreFocus: false })
      suspended = true
      return
    }
    suspended = false
    engage(layers[layers.length - 1])
  }

  // 观察器回调本身就是微任务级的批量通知；直接 sync 可以在同一帧内完成加锁，
  // 不会出现“弹窗已可见、背景还能滚一帧”的窗口期。
  const observer = new win.MutationObserver(() => {
    if (installed) sync()
  })
  observer.observe(doc.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden', 'style', 'aria-modal', 'role'],
  })
  sync()

  return function dispose() {
    if (!installed) return
    installed = false
    observer.disconnect()
    disengage({ restoreFocus: false })
  }
}
