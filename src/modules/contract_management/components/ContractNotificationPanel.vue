<script setup>
import PlatformNotificationInbox from '@/modules/shared/components/PlatformNotificationInbox.vue'

defineEmits(['unread-change'])
</script>

<template>
  <div id="contract-notifications" class="contract-notification-panel" aria-label="通知中心">
    <PlatformNotificationInbox app-code="contract_management" :page-size="5"
      @unread-change="$emit('unread-change', $event)" />
  </div>
</template>
