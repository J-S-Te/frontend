<script setup>
import ConsoleIcon from '@/modules/platform/shared/components/ConsoleIcon.vue'

// 「我的待办」区面板（治理批次 5 结算·第三步，模板自 SettlementView.vue 逐字提取；提取前片段 SSR golden 归档于
// .ai/qa/closure-20261025/goldens-settlement-panels/SettlementTasksPanel/）。分组任务由父级 taskGroups 计算属性注入；
// 点击任务项以 navigate(section) 回传，刷新以 reload 回传。
defineProps({
  taskGroups: { type: Array, required: true },
})
defineEmits(['navigate','reload'])
</script>

<template>
  <section class="settlement-tasks">
    <div class="settlement-section-head">
      <div>
        <p>
          按真实业务状态聚合的待办任务；点击「去处理」可直接跳到相关页面。
        </p>
      </div>
      <div>
        <button class="console-button secondary" @click="$emit('reload')">
          <ConsoleIcon name="reset" />刷新
        </button>
      </div>
    </div>
    <article
        v-for="group in taskGroups"
        :key="group.key"
        class="settlement-panel settlement-task-group"
      >
        <div class="settlement-panel-head">
          <div>
            <h2>{{ group.label }}</h2>
            <p>{{ group.description }}</p>
          </div>
          <span class="settlement-task-count">{{ group.items.length }} 项</span>
        </div>
        <div v-if="group.items.length" class="settlement-task-list">
          <button
            v-for="item in group.items.slice(0, 8)"
            :key="item.key"
            type="button"
            class="settlement-task-item"
            @click="$emit('navigate', group.section)"
          >
            <span class="settlement-task-id">{{ item.label }}</span>
            <span class="settlement-task-meta">{{ item.meta }}</span>
          </button>
          <p v-if="group.items.length > 8" class="settlement-task-more">
            还有 {{ group.items.length - 8 }} 项未展示，进入「{{ group.action }}」查看全部。
          </p>
        </div>
        <div v-else class="settlement-empty compact">
          当前没有待办，{{ group.doneHint }}
        </div>
      </article>
  </section>
</template>
