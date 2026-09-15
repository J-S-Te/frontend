export const searchableSelectThemeTokens = Object.freeze([
  '--pm-z-dropdown', '--pm-line', '--pm-r-md', '--pm-card', '--pm-shadow-pop',
  '--pm-r-sm', '--pm-sunken', '--pm-faint', '--pm-muted', '--pm-primary', '--pm-ink', '--pm-font',
])

const defaultLayout = Object.freeze({
  gap: 6,
  viewportPadding: 12,
  maximumHeight: 320,
  minimumUsefulHeight: 144,
  minimumWidth: 240,
})

export function readViewport(windowObject) {
  const viewport = windowObject.visualViewport
  return {
    width: viewport?.width || windowObject.innerWidth,
    height: viewport?.height || windowObject.innerHeight,
    left: viewport?.offsetLeft || 0,
    top: viewport?.offsetTop || 0,
  }
}

export function calculateSearchableSelectLayout(triggerRect, viewport, contentHeight, overrides = {}) {
  const config = { ...defaultLayout, ...overrides }
  const viewportRight = viewport.left + viewport.width
  const viewportBottom = viewport.top + viewport.height
  const availableBelow = viewportBottom - triggerRect.bottom - config.gap - config.viewportPadding
  const availableAbove = triggerRect.top - viewport.top - config.gap - config.viewportPadding
  const openAbove = availableBelow < config.minimumUsefulHeight && availableAbove > availableBelow
  const availableHeight = Math.max(96, openAbove ? availableAbove : availableBelow)
  const maxHeight = Math.min(config.maximumHeight, availableHeight)
  const usableWidth = Math.max(0, viewport.width - config.viewportPadding * 2)
  const width = Math.min(Math.max(triggerRect.width, config.minimumWidth), usableWidth)
  const maximumLeft = viewportRight - config.viewportPadding - width
  const left = Math.max(viewport.left + config.viewportPadding, Math.min(triggerRect.left, maximumLeft))
  const desiredHeight = Math.min(contentHeight || maxHeight, maxHeight)
  const proposedTop = openAbove
    ? triggerRect.top - config.gap - desiredHeight
    : triggerRect.bottom + config.gap
  const maximumTop = viewportBottom - config.viewportPadding - desiredHeight
  const top = Math.max(viewport.top + config.viewportPadding, Math.min(proposedTop, maximumTop))

  return { placement: openAbove ? 'top' : 'bottom', top, left, width, maxHeight }
}

export function readSearchableSelectTheme(element, styleReader = getComputedStyle) {
  const source = styleReader(element)
  return {
    tokens: Object.fromEntries(searchableSelectThemeTokens.map((name) => [name, source.getPropertyValue(name)])),
    fontFamily: source.fontFamily,
    fontSize: source.fontSize,
    color: source.color,
  }
}

export function searchableSelectMenuStyle(layout, theme) {
  return {
    ...theme.tokens,
    top: `${layout.top}px`,
    left: `${layout.left}px`,
    width: `${layout.width}px`,
    maxHeight: `${layout.maxHeight}px`,
    fontFamily: theme.fontFamily,
    fontSize: theme.fontSize,
    color: theme.color,
  }
}

export function bindSearchableSelectViewport(windowObject, listener) {
  windowObject.addEventListener('resize', listener)
  windowObject.addEventListener('scroll', listener, true)
  windowObject.visualViewport?.addEventListener('resize', listener)
  windowObject.visualViewport?.addEventListener('scroll', listener)

  return () => {
    windowObject.removeEventListener('resize', listener)
    windowObject.removeEventListener('scroll', listener, true)
    windowObject.visualViewport?.removeEventListener('resize', listener)
    windowObject.visualViewport?.removeEventListener('scroll', listener)
  }
}
