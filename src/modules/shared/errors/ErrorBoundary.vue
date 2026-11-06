<script setup>
// 全局错误边界：包住 <RouterView>，页面组件在渲染 / 挂载 / 更新时抛错都落到这里。
//
// 为什么需要它：Vue 在渲染期抛错会卸载整棵子树，用户拿到的是"白屏 + 控制台堆栈"。
// 边界把"页面炸了"变成一张能读的卡片，并给出明确出口（重试 / 返回上一页 / 到上限后刷新）。
//
// 两个约定，改动前先看：
//   1. onErrorCaptured 返回 false：错误在这里处理完就不再冒到 app.config.errorHandler，
//      否则同一个错误会既显示降级页、又弹一条全局提示（用户看到双重提示）。
//   2. 重试有上限：子组件如果确定性地崩，无限重试只会把浏览器拖进死循环。到上限后
//      重试按钮禁用，改建议刷新或返回上一页。
//
// 降级界面复用共享 ErrorState（统一三态样式），颜色/字号全部走 main.css 的 token，
// 因此浅色与深色主题同时成立，也不新增硬编码（design-token 门禁会检查这一点）。
import { computed, onErrorCaptured, ref, shallowRef } from 'vue'
import ErrorState from '@/modules/shared/components/ErrorState.vue'
import { userFacingErrorSummary } from './errorMessages.js'

const props = defineProps({
  // 最多允许重试几次；到上限后重试按钮禁用，避免确定性崩溃无限循环。
  retryLimit: { type: Number, default: 3 },
})

const emit = defineEmits(['error'])

const failure = shallowRef(null)
const attempts = ref(0)

onErrorCaptured((error, instance, info) => {
  failure.value = error
  // 原始错误只交给上层做日志/上报，界面只显示清洗后的文案。
  emit('error', { error, info })
  return false
})

const exhausted = computed(() => attempts.value >= Math.max(1, props.retryLimit))
const summary = computed(() => userFacingErrorSummary(failure.value))

// 重试 = 清掉失败态，让插槽里的页面组件重新挂载一次（不刷新整个页面）。
function retry() {
  if (exhausted.value) return
  attempts.value += 1
  failure.value = null
}

// 返回上一页：没有历史记录时回首页，避免"点了没反应"。
function goBack() {
  if (typeof window === 'undefined') return
  if (window.history && window.history.length > 1) window.history.back()
  else window.location.assign('/')
}

function reload() {
  if (typeof window !== 'undefined' && window.location) window.location.reload()
}
</script>

<template>
  <template v-if="!failure">
    <slot />
  </template>
  <div v-else class="shared-error-boundary">
    <!-- 降级界面替代整个 <RouterView>，必须自带 main 地标，否则 skip-link 失去落点。 -->
    <main id="main-content" class="shared-error-boundary__panel" tabindex="-1">
      <ErrorState title="页面出现异常" :error="summary" :retry="false">
        <p class="shared-error-boundary__hint">
          {{ exhausted ? '多次重试仍未恢复，请刷新页面或返回上一页。' : '本次操作没有完成，页面其它部分仍可继续使用。' }}
        </p>
        <div class="shared-error-boundary__actions">
          <button type="button" class="ui-state__retry" :disabled="exhausted" @click="retry">重试</button>
          <button type="button" class="ui-state__retry shared-error-boundary__back" @click="goBack">返回上一页</button>
          <button v-if="exhausted" type="button" class="ui-state__retry" @click="reload">刷新页面</button>
        </div>
      </ErrorState>
    </main>
  </div>
</template>

<style scoped>
/* 整页替换时铺满视口并让卡片居中；配色全部来自 main.css 的 token。 */
.shared-error-boundary { display: grid; place-items: center; box-sizing: border-box; min-height: 100vh; padding: var(--space-6); background: var(--surface-content); color: var(--text); }
.shared-error-boundary__panel { width: min(560px, 100%); border: 1px solid var(--border); border-top: 3px solid var(--danger); border-radius: var(--radius-panel); background: var(--surface-card); box-shadow: var(--shadow-raised); }
.shared-error-boundary__hint { margin: 0; color: var(--text-muted); font-size: var(--fs-sm); line-height: 1.6; text-align: center; }
.shared-error-boundary__actions { display: flex; flex-wrap: wrap; gap: var(--space-2); justify-content: center; }
/* 次要动作靠虚线描边区分，不引入新的颜色。 */
.shared-error-boundary__back { border-style: dashed; }
/* 统一三态的图标默认是中性的 info 色；这里是崩溃页，换成错误色表达严重程度。 */
.shared-error-boundary__panel :deep(.ui-state__icon) { color: var(--danger); }
</style>
