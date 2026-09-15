<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { filterSearchableOptions } from './searchableSelect'
import {
  bindSearchableSelectViewport,
  calculateSearchableSelectLayout,
  readSearchableSelectTheme,
  readViewport,
  searchableSelectMenuStyle,
} from './searchableSelectPositioning'

const props = defineProps({
  modelValue: { type: [String, Number, Boolean, Array], default: '' },
  options: { type: Array, default: () => [] },
  multiple: { type: Boolean, default: false },
  valueKey: { type: String, default: 'value' },
  labelKey: { type: String, default: 'label' },
  descriptionKey: { type: String, default: 'description' },
  placeholder: { type: String, default: '请选择' },
  searchPlaceholder: { type: String, default: '输入关键字搜索' },
  emptyText: { type: String, default: '没有匹配的选项' },
  disabled: { type: Boolean, default: false },
  required: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '下拉选择' },
})
const emit = defineEmits(['update:modelValue', 'change'])

const root = ref(null)
const trigger = ref(null)
const menu = ref(null)
const searchInput = ref(null)
const open = ref(false)
const keyword = ref('')
const activeIndex = ref(-1)
const placement = ref('bottom')
const menuPositioned = ref(false)
const menuStyle = ref({})
let unbindViewport = () => {}

const optionValue = (option) => option?.[props.valueKey]
const optionLabel = (option) => String(option?.[props.labelKey] ?? optionValue(option) ?? '')
const selectedValues = computed(() => props.multiple
  ? (Array.isArray(props.modelValue) ? props.modelValue : [])
  : [props.modelValue])
const selectedOptions = computed(() => selectedValues.value
  .map((value) => props.options.find((option) => optionValue(option) === value))
  .filter(Boolean))
const triggerLabel = computed(() => {
  if (!selectedOptions.value.length) return props.placeholder
  const labels = selectedOptions.value.map(optionLabel)
  if (!props.multiple || labels.length <= 2) return labels.join('、')
  return `${labels.slice(0, 2).join('、')} 等 ${labels.length} 项`
})
const filteredOptions = computed(() => filterSearchableOptions(props.options, keyword.value))

function optionKey(option) {
  return String(optionValue(option))
}
function optionDescription(option) {
  return option?.[props.descriptionKey] || ''
}
function isSelected(option) {
  return selectedValues.value.includes(optionValue(option))
}
function optionClasses(option, index) {
  return { active: activeIndex.value === index, selected: isSelected(option), disabled: option?.disabled }
}
function activateOption(index) {
  activeIndex.value = index
}
function updateMenuPosition() {
  if (!open.value || !trigger.value || !menu.value) return
  const layout = calculateSearchableSelectLayout(
    trigger.value.getBoundingClientRect(),
    readViewport(window),
    menu.value.scrollHeight,
  )
  placement.value = layout.placement
  menuStyle.value = searchableSelectMenuStyle(layout, readSearchableSelectTheme(root.value))
  menuPositioned.value = true
}
function show() {
  if (props.disabled) return
  menuPositioned.value = false
  open.value = true
  activeIndex.value = filteredOptions.value.length ? 0 : -1
  nextTick(() => {
    updateMenuPosition()
    searchInput.value?.focus({ preventScroll: true })
  })
}
function hide() {
  open.value = false
  menuPositioned.value = false
  keyword.value = ''
  activeIndex.value = -1
}
function toggle() {
  if (open.value) hide()
  else show()
}
function choose(option) {
  if (option?.disabled) return
  const value = optionValue(option)
  if (props.multiple) {
    const next = new Set(selectedValues.value)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    const result = [...next]
    emit('update:modelValue', result)
    emit('change', result)
    return
  }
  emit('update:modelValue', value)
  emit('change', value)
  hide()
}
function remove(value) {
  if (props.disabled || !props.multiple) return
  const result = selectedValues.value.filter((item) => item !== value)
  emit('update:modelValue', result)
  emit('change', result)
}
function onKeydown(event) {
  if (event.key === 'Escape') {
    hide()
    return
  }
  if (!open.value && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
    event.preventDefault()
    show()
    return
  }
  if (!open.value || !filteredOptions.value.length) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const delta = event.key === 'ArrowDown' ? 1 : -1
    activeIndex.value = (activeIndex.value + delta + filteredOptions.value.length) % filteredOptions.value.length
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const option = filteredOptions.value[activeIndex.value]
    if (option) choose(option)
  }
}
function onOutsidePointerDown(event) {
  if (!root.value?.contains(event.target) && !menu.value?.contains(event.target)) hide()
}
function onViewportChange() {
  if (open.value) updateMenuPosition()
}

watch(filteredOptions, (items) => {
  activeIndex.value = items.length ? Math.min(Math.max(activeIndex.value, 0), items.length - 1) : -1
  if (open.value) nextTick(updateMenuPosition)
})
watch(() => props.disabled, (disabled) => { if (disabled) hide() })
onMounted(() => {
  document.addEventListener('pointerdown', onOutsidePointerDown, true)
  unbindViewport = bindSearchableSelectViewport(window, onViewportChange)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onOutsidePointerDown, true)
  unbindViewport()
})
</script>

<template>
  <div ref="root" class="pm-search-select" :class="{ open, disabled, multiple }" @keydown="onKeydown">
    <button
      ref="trigger"
      type="button"
      class="pm-search-select-trigger"
      :class="{ placeholder: !selectedOptions.length }"
      :disabled="disabled"
      role="combobox"
      aria-haspopup="listbox"
      :aria-label="ariaLabel"
      :aria-expanded="open"
      :aria-required="required"
      @click.stop="toggle"
    >
      <span>{{ triggerLabel }}</span><i aria-hidden="true"></i>
    </button>
    <Teleport to="body">
      <div
        v-if="open"
        ref="menu"
        class="pm-search-select-menu"
        :class="`placement-${placement}`"
        :style="menuStyle"
        :data-positioned="menuPositioned"
        @click.stop
        @keydown="onKeydown"
      >
        <label class="pm-search-select-search">
          <span class="pm-search-select-search-icon" aria-hidden="true"></span>
          <input ref="searchInput" v-model="keyword" type="search" :placeholder="searchPlaceholder" :aria-label="searchPlaceholder" />
        </label>
        <div class="pm-search-select-options" role="listbox" :aria-label="ariaLabel" :aria-multiselectable="multiple">
          <button
            v-for="(option, index) in filteredOptions"
            :key="optionKey(option)"
            type="button"
            class="pm-search-select-option"
            :class="optionClasses(option, index)"
            role="option"
            :aria-selected="isSelected(option)"
            :disabled="option.disabled"
            @mouseenter="activateOption(index)"
            @click="choose(option)"
          >
            <span class="pm-search-select-check" aria-hidden="true">{{ isSelected(option) ? '✓' : '' }}</span>
            <span><b>{{ optionLabel(option) }}</b><small v-if="optionDescription(option)">{{ optionDescription(option) }}</small></span>
          </button>
          <p v-if="!filteredOptions.length" class="pm-search-select-empty">{{ emptyText }}</p>
        </div>
      </div>
    </Teleport>
    <div v-if="multiple && selectedOptions.length" class="pm-search-select-chips">
      <span v-for="option in selectedOptions" :key="optionKey(option)">
        {{ optionLabel(option) }}
        <button type="button" :aria-label="`移除 ${optionLabel(option)}`" :disabled="disabled" @click.stop="remove(optionValue(option))">×</button>
      </span>
    </div>
  </div>
</template>

<style scoped>
.pm-search-select { position: relative; min-width: 0; width: 100%; }
.pm-search-select-trigger { width: 100%; min-height: var(--pm-h-control); display: flex; align-items: center; justify-content: space-between; gap: 12px; overflow: hidden; padding: 0 13px; border: 1px solid var(--pm-line); border-radius: var(--pm-r-sm); background: var(--pm-card); color: var(--pm-ink); text-align: left; cursor: pointer; font: inherit; }
.pm-search-select-trigger > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pm-search-select-trigger:focus-visible, .pm-search-select.open .pm-search-select-trigger { border-color: var(--pm-primary, #1f5eff); box-shadow: 0 0 0 3px color-mix(in srgb, var(--pm-primary, #1f5eff) 16%, transparent); outline: none; }
.pm-search-select-trigger.placeholder { color: var(--pm-muted, #64748b); }
.pm-search-select-trigger i { width: 8px; height: 8px; border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: rotate(45deg) translateY(-2px); transition: transform .16s ease; }
.pm-search-select.open .pm-search-select-trigger i { transform: rotate(225deg) translate(-2px, -2px); }
.pm-search-select.disabled { opacity: .62; }
.pm-search-select-menu { position: fixed; z-index: var(--pm-z-dropdown); display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 7px; overflow: hidden; padding: 8px; border: 1px solid var(--pm-line); border-radius: var(--pm-r-md); background: var(--pm-card); box-shadow: var(--pm-shadow-pop); transform-origin: top center; }
.pm-search-select-menu[data-positioned="false"] { visibility: hidden; }
.pm-search-select-menu.placement-top { transform-origin: bottom center; }
.pm-search-select-search { width: 100%; min-width: 0; min-height: 38px; display: grid; grid-template-columns: 16px minmax(0, 1fr); align-items: center; gap: 8px; padding: 0 10px; border: 1px solid var(--pm-line); border-radius: var(--pm-r-sm); background: var(--pm-sunken); }
.pm-search-select-search-icon { position: relative; display: block; width: 14px; height: 14px; min-width: 14px; max-width: 14px; min-height: 14px; max-height: 14px; border: 2px solid currentColor; border-radius: 50%; color: var(--pm-faint); }
.pm-search-select-search-icon::after { position: absolute; right: -5px; bottom: -3px; width: 6px; height: 2px; border-radius: 2px; background: currentColor; content: ''; transform: rotate(45deg); transform-origin: left center; }
.pm-search-select-search input { width: 100%; min-width: 0; height: 36px; min-height: 0; padding: 0; border: 0; outline: 0; background: transparent; color: inherit; font: inherit; }
.pm-search-select-options { min-height: 0; max-height: 240px; overflow: auto; overscroll-behavior: contain; }
.pm-search-select-option { width: 100%; display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 8px; align-items: center; padding: 9px 10px; border: 0; border-radius: var(--pm-r-sm); background: transparent; color: inherit; text-align: left; cursor: pointer; }
.pm-search-select-option:hover, .pm-search-select-option.active { background: color-mix(in srgb, var(--pm-primary, #1f5eff) 9%, transparent); }
.pm-search-select-option.selected { color: var(--pm-primary, #1f5eff); }
.pm-search-select-option.disabled { cursor: not-allowed; opacity: .5; }
.pm-search-select-option > span:last-child { min-width: 0; }
.pm-search-select-option b, .pm-search-select-option small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pm-search-select-option small { margin-top: 2px; color: var(--pm-muted, #64748b); font-size: 12px; }
.pm-search-select-check { width: 18px; height: 18px; display: grid; place-items: center; border: 1px solid var(--pm-line); border-radius: 50%; font-size: 12px; }
.multiple .pm-search-select-check { border-radius: 4px; }
.pm-search-select-option.selected .pm-search-select-check { border-color: var(--pm-primary, #1f5eff); background: var(--pm-primary, #1f5eff); color: #fff; }
.pm-search-select-empty { margin: 0; padding: 16px 10px; color: var(--pm-muted, #64748b); text-align: center; }
.pm-search-select-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 7px; }
.pm-search-select-chips > span { display: inline-flex; align-items: center; gap: 5px; padding: 4px 8px; border-radius: 999px; background: color-mix(in srgb, var(--pm-primary, #1f5eff) 10%, transparent); color: var(--pm-primary, #1f5eff); font-size: 12px; }
.pm-search-select-chips button { padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; font-size: 16px; line-height: 1; }
</style>
