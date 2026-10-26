// Shared confirm/prompt overlays must agree on both visual order and keyboard
// ownership. Removing a lower overlay must not reactivate the page behind it.
const layers = []

export function registerDialogLayer(element) {
  if (!element || layers.includes(element)) return
  layers.push(element)
  const previous = layers.at(-2)
  element.style.zIndex = String(previous ? Number(previous.style.zIndex) + 1 : 10000)
  if (typeof document !== 'undefined') document.body.dataset.confirmDialogOpen = 'true'
}

export function isTopDialogLayer(element) {
  return Boolean(element && layers.at(-1) === element)
}

export function removeDialogLayer(element) {
  const index = layers.indexOf(element)
  if (index < 0) return false
  const wasTop = index === layers.length - 1
  layers.splice(index, 1)
  if (!layers.length && typeof document !== 'undefined') delete document.body.dataset.confirmDialogOpen
  return wasTop
}

export function focusTopDialogLayer() {
  const layer = layers.at(-1)
  if (!layer) return false
  const dialog = layer.querySelector('[role="alertdialog"], [role="dialog"]')
  const candidates = dialog?.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])') || []
  const target = [...candidates].find(element => element.offsetParent !== null) || dialog
  target?.focus?.()
  return true
}
