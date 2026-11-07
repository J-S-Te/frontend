// 原生日期类输入框「点框内任意位置就打开选择器」（全站唯一入口，main.js 注册一次）。
//
// 背景：`input[type=date]` / `datetime-local` / `time` / `month` / `week` 默认只在点右
// 侧那个小图标时才弹选择器，点输入区（年月日段、空白、冒号两侧）只移动光标。售前申请
// 的「预计开始 / 预计结束」这类必填时间字段，用户十个里有八个先点输入区再找图标。
//
// 做法：document 上挂一个 click 委托（捕获阶段），命中原生日期控件就调
// `input.showPicker()`；不在每个页面、每个输入框上逐个绑定。
//
// 为什么是 click 而不是 pointerdown / mousedown：
//   · showPicker() 受「用户手势」约束，click 是手势窗口内最稳的时机；
//   · mousedown 阶段调用会和浏览器自己的「按下即定位光标 / 图标默认动作」抢时序，
//     容易出现开一半又收起的闪烁。click 之后浏览器默认行为该做什么还做什么。
//
// 边界（都是刻意保持的）：
//   · 只处理原生控件：靠 type 判定，自定义日期组件（div + 自己的面板）根本不会命中；
//     组件若已自带 picker，可在输入框或任意祖先上加 `data-native-picker="off"` 退出。
//   · disabled / readonly 直接跳过：只读控件弹选择器改不了值，只会让人以为能编辑。
//   · 绝不 preventDefault / stopPropagation：键盘分段编辑、焦点、label 转发、
//     v-model 的 input/change 事件、表单校验与提交全都不经过这里。
//   · showPicker 不存在（老浏览器）或调用抛错（该类型没有 picker、控件不可见、
//     浏览器认为没有用户手势）时退到 focus()，等同改造前的原生行为，且吞掉异常——
//     不能让一次点击进全局错误兜底弹提示。
//   · 一次 click 只调一次 showPicker；重复安装会命中 WeakSet 守卫，不会叠监听。
//
// 已知取舍：Chrome 里点右侧日历图标本来就由浏览器默认动作弹选择器，我们额外调用的
// showPicker() 在「选择器已打开」时是空操作（Chromium 对该状态直接返回），所以不会
// 出现图标点一下开了又关。这条依赖浏览器实现；若将来某内核改成 toggle 语义，可以给
// 对应输入框加 data-native-picker="off" 恢复浏览器原生行为。

// 需要「点哪儿都开」的原生输入类型。新增类型只改这一处。
export const NATIVE_DATE_INPUT_TYPES = Object.freeze(['date', 'datetime-local', 'month', 'time', 'week'])

// 退出标记：命中该选择器（含祖先）的原生日期控件交回组件自己处理。
export const NATIVE_PICKER_OPT_OUT_SELECTOR = '[data-native-picker="off"]'

// 已经装过的 document。弱引用，随页面销毁自动回收；Warm/HMR 重装 main.js 时不会再叠一层。
const installedDocuments = new WeakSet()

// normalizeType 把 type 归一成小写字符串。
// 参数：value 为 input.type 属性值或 type 特性值。
// 返回值：小写类型名；缺失返回空串。
function normalizeType(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

// isPickerOptedOut 判断控件是否有意交回浏览器/组件自己处理。
// 参数：element 为候选元素。
// 返回值：命中 data-native-picker="off"（自身或祖先）时为 true。
export function isPickerOptedOut(element) {
  if (!element) return false
  if (typeof element.getAttribute === 'function') {
    if (normalizeType(element.getAttribute('data-native-picker')) === 'off') return true
  }
  if (typeof element.closest === 'function') {
    try {
      return Boolean(element.closest(NATIVE_PICKER_OPT_OUT_SELECTOR))
    } catch {
      return false
    }
  }
  return false
}

// isNativeDateInput 判断元素是不是原生日期类输入框。
// 参数：element 为任意节点。
// 返回值：是则 true。
export function isNativeDateInput(element) {
  if (!element || typeof element !== 'object') return false
  if (String(element.tagName ?? '').toUpperCase() !== 'INPUT') return false
  // 优先看归一后的 type 属性：浏览器会把不认识的类型退化成 text。
  if (NATIVE_DATE_INPUT_TYPES.includes(normalizeType(element.type))) return true
  // 再退回 type 特性：浏览器不支持该类型时 input.type 会变成 text，但特性仍是原值；
  // 这种环境下 showPicker 不存在或抛错，openNativePicker 会安全退到 focus()。
  if (typeof element.getAttribute === 'function') {
    return NATIVE_DATE_INPUT_TYPES.includes(normalizeType(element.getAttribute('type')))
  }
  return false
}

// resolveNativeDateInput 从一次点击里找出应当处理的日期输入框。
// 参数：event 为 click 事件。
// 返回值：命中的原生日期输入框；不命中返回 null。
export function resolveNativeDateInput(event) {
  if (!event) return null
  const path = typeof event.composedPath === 'function' ? event.composedPath() : null
  const nodes = Array.isArray(path) && path.length ? path : [event.target]
  for (const node of nodes) {
    if (!isNativeDateInput(node)) continue
    if (isPickerOptedOut(node)) return null
    return node
  }
  return null
}

// openNativePicker 打开原生选择器，失败时退回聚焦。
// 参数：input 为候选输入框。
// 返回值：'skipped'（不该处理）/ 'picker'（已调用 showPicker）/ 'focus'（已退回聚焦）。
export function openNativePicker(input) {
  if (!input) return 'skipped'
  // disabled / readonly 只跳过按钮态的点击，不改任何属性。
  if (input.disabled === true || input.readOnly === true) return 'skipped'
  if (typeof input.showPicker === 'function') {
    try {
      input.showPicker()
      return 'picker'
    } catch {
      // 无用户手势、控件未渲染、该类型没有 picker 都会走到这里，继续下面的聚焦回退。
    }
  }
  try {
    input.focus?.()
  } catch {
    // 聚焦失败也不能打断点击后续的默认行为与表单提交。
  }
  return 'focus'
}

// installNativeDatePickerOnClick 安装全局委托。
// 参数：options.document 为 document 替身（测试用），默认取全局 document。
// 返回值：dispose 函数，用于摘掉监听（重复调用安全）。
export function installNativeDatePickerOnClick(options = {}) {
  const doc = options.document ?? globalThis.document
  if (!doc || typeof doc.addEventListener !== 'function') return () => {}
  if (installedDocuments.has(doc)) return () => {}

  // onClick 只在命中原生日期控件时动手，其余点击一律放行。
  // 参数：event 为浏览器 click 事件。
  // 返回值：无。
  function onClick(event) {
    // 只认主键点击：中键/右键走 auxclick/contextmenu，不在这里抢。
    if (typeof event?.button === 'number' && event.button !== 0) return
    const input = resolveNativeDateInput(event)
    if (!input) return
    openNativePicker(input)
  }

  // 捕获阶段挂在 document 上：弹层/卡片里 stopPropagation 的点击也能收到，且不改变
  // 任何组件的默认行为（handler 内既不 preventDefault 也不 stopPropagation）。
  doc.addEventListener('click', onClick, true)
  installedDocuments.add(doc)

  let disposed = false
  return function dispose() {
    if (disposed) return
    disposed = true
    doc.removeEventListener?.('click', onClick, true)
    installedDocuments.delete(doc)
  }
}
