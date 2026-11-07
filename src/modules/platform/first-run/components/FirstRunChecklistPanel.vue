<script setup>
// 上手清单面板：只展示真实完成状态，不提供代替用户操作的按钮。
// 唯一可点击的动作是“重新检测”（只读 GET /api/v1/users?page=1&page_size=1）。
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { acquireBodyScrollLock, releaseBodyScrollLock } from '@/modules/shared/utils/bodyScrollLock'
import { firstRun } from '../composables/useFirstRun.js'
import { FIRST_RUN_CHECKLIST_Z_INDEX } from '../utils/firstRunState.js'
import '../styles/first-run.css'

const panelRef = ref(null)
const closeButtonRef = ref(null)
let previousFocus = null
let active = false

const items = firstRun.checklistItems
const summary = firstRun.checklistSummary

const probeText = computed(() => {
  switch (firstRun.state.probeStatus) {
    case 'checking':
      return '正在检测账号数量…'
    case 'complete':
      return '检测到租户内已有业务账号（系统自动检测）。'
    case 'incomplete':
      return '尚未检测到业务账号，创建后可重新检测。'
    case 'error':
      return firstRun.state.probeMessage || '暂时无法检测业务账号，请稍后重试。'
    default:
      return '打开本清单时会只读检测租户内的业务账号（系统自动检测）。'
  }
})

function close() {
  firstRun.closeChecklist()
}

function retryProbe() {
  void firstRun.probeFirstAccount()
}

function focusable() {
  if (!panelRef.value) return []
  return [...panelRef.value.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.offsetParent !== null)
}

function onKeydown(event) {
  if (!firstRun.state.checklistOpen) return
  if (document.body.dataset.confirmDialogOpen === 'true') return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
    return
  }
  if (event.key !== 'Tab') return
  const candidates = focusable()
  if (!candidates.length) {
    event.preventDefault()
    panelRef.value?.focus()
    return
  }
  const first = candidates[0]
  const last = candidates.at(-1)
  if (event.shiftKey && (document.activeElement === first || !panelRef.value?.contains(document.activeElement))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (document.activeElement === last || !panelRef.value?.contains(document.activeElement))) {
    event.preventDefault()
    first.focus()
  }
}

async function activate() {
  if (active) return
  await nextTick()
  if (active || !firstRun.state.checklistOpen) return
  active = true
  previousFocus = document.activeElement
  acquireBodyScrollLock()
  document.addEventListener('keydown', onKeydown, true)
  closeButtonRef.value?.focus()
}

function deactivate() {
  if (!active) return
  active = false
  document.removeEventListener('keydown', onKeydown, true)
  releaseBodyScrollLock()
  const target = previousFocus
  previousFocus = null
  if (target?.isConnected && typeof target.focus === 'function') target.focus()
}

watch(() => firstRun.state.checklistOpen, (open) => {
  if (open) void activate()
  else deactivate()
}, { immediate: true })

onBeforeUnmount(deactivate)
</script>

<template>
  <Teleport to="body">
    <Transition name="first-run-fade">
      <div
        v-if="firstRun.state.checklistOpen"
        class="first-run-checklist"
        :style="{ zIndex: FIRST_RUN_CHECKLIST_Z_INDEX }"
        data-first-run-layer="checklist"
      >
        <div class="first-run-checklist__mask" @click="close"></div>
        <section
          ref="panelRef"
          class="first-run-checklist__panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="first-run-checklist-title"
          tabindex="-1"
          @click.stop
        >
          <header class="first-run-checklist__head">
            <div>
              <p class="first-run-checklist__eyebrow">FIRST RUN</p>
              <h2 id="first-run-checklist-title" class="first-run-checklist__title">上手清单</h2>
              <p class="first-run-checklist__summary">已完成 {{ summary.done }} / {{ summary.total }} 项</p>
            </div>
            <button
              ref="closeButtonRef"
              type="button"
              class="first-run-checklist__close"
              aria-label="关闭上手清单"
              @click="close"
            >×</button>
          </header>

          <div class="first-run-checklist__progress" aria-hidden="true">
            <span
              v-for="(item, index) in items"
              :key="item.key"
              class="first-run-checklist__progress-segment"
              :class="{ 'is-done': item.done }"
              :data-index="index"
            ></span>
          </div>

          <ol class="first-run-checklist__list">
            <li
              v-for="(item, index) in items"
              :key="item.key"
              class="first-run-checklist__item"
              :class="{ 'is-done': item.done }"
            >
              <span class="first-run-checklist__marker" aria-hidden="true">{{ item.done ? '✓' : index + 1 }}</span>
              <div class="first-run-checklist__body">
                <p class="first-run-checklist__item-title">
                  <span>{{ item.title }}</span>
                  <span class="first-run-checklist__state" :class="item.done ? 'is-done' : 'is-pending'">{{ item.done ? '已完成' : '待完成' }}</span>
                </p>
                <p class="first-run-checklist__hint">{{ item.hint }}</p>
                <p
                  v-if="item.key === 'firstAccount'"
                  class="first-run-checklist__probe"
                  :class="`is-${firstRun.state.probeStatus}`"
                  role="status"
                  aria-live="polite"
                >
                  <span>{{ probeText }}</span>
                  <!-- 文案说“可重新检测”，按钮必须同时覆盖失败与“尚未检测到”两种状态。 -->
                  <button
                    v-if="firstRun.state.probeStatus === 'error' || firstRun.state.probeStatus === 'incomplete'"
                    type="button"
                    class="first-run-checklist__retry"
                    :disabled="firstRun.state.probeStatus === 'checking'"
                    @click="retryProbe"
                  >重新检测</button>
                </p>
              </div>
            </li>
          </ol>

          <p class="first-run-checklist__note">清单只记录你在门户里的真实操作，不会代替你打开页面或提交数据。</p>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
