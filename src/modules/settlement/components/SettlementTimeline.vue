<script setup>
defineProps({
  events: {
    type: Array,
    required: true,
    validator: (value) =>
      Array.isArray(value) &&
      value.every(
        (item) =>
          item &&
          typeof item.title === "string" &&
          typeof item.description === "string",
      ),
  },
  emptyHint: {
    type: String,
    default: "暂无留痕记录。",
  },
});
</script>

<template>
  <ol v-if="events.length" class="settlement-timeline-list">
    <li
      v-for="(event, index) in events"
      :key="index"
      class="settlement-timeline-event"
      :class="`tone-${event.tone || 'success'}`"
    >
      <span class="settlement-timeline-dot" aria-hidden="true"></span>
      <div class="settlement-timeline-body">
        <div class="settlement-timeline-head">
          <strong>{{ event.title }}</strong>
          <small v-if="event.timestamp">{{ event.timestamp }}</small>
        </div>
        <p>{{ event.description }}</p>
        <p v-if="event.detail" class="settlement-timeline-detail">
          {{ event.detail }}
        </p>
      </div>
    </li>
  </ol>
  <p v-else class="settlement-timeline-empty">{{ emptyHint }}</p>
</template>

<style scoped>
.settlement-timeline-list {
  position: relative;
  margin: 16px 0 0;
  padding: 0 0 0 18px;
  list-style: none;
  border-left: 2px solid var(--line-soft, #edf0f5);
}
.settlement-timeline-event {
  position: relative;
  padding: 0 0 18px 14px;
}
.settlement-timeline-event:last-child {
  padding-bottom: 0;
}
.settlement-timeline-dot {
  position: absolute;
  top: 4px;
  left: -25px;
  width: 12px;
  height: 12px;
  border: 4px solid var(--green, #16a34a);
  border-radius: 50%;
  background: #fff;
  box-sizing: content-box;
}
.tone-warning .settlement-timeline-dot {
  border-color: var(--orange, #d97706);
}
.tone-danger .settlement-timeline-dot {
  border-color: var(--red, #dc2626);
}
.tone-info .settlement-timeline-dot {
  border-color: var(--sky, #0ea5e9);
}
.tone-purple .settlement-timeline-dot {
  border-color: var(--purple, #8b5cf6);
}
.settlement-timeline-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.settlement-timeline-head strong {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text, #0f172a);
}
.settlement-timeline-head small {
  color: var(--muted, #64748b);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.settlement-timeline-body p {
  margin: 4px 0 0;
  color: var(--secondary, #475569);
  font-size: 13px;
  line-height: 1.6;
}
.settlement-timeline-detail {
  margin-top: 6px !important;
  padding: 8px 10px;
  color: var(--muted, #64748b) !important;
  font-size: 12px !important;
  background: var(--bg, #f1f5f9);
  border-radius: 8px;
}
.settlement-timeline-empty {
  padding: 18px 4px;
  color: var(--muted, #64748b);
  font-size: 13px;
  text-align: center;
}
</style>