import { createApp, h } from 'vue'
import { createRouter, createMemoryHistory, RouterView } from 'vue-router'
import SettlementView from '@/modules/settlement/views/SettlementView.vue'
import '@/modules/shared/styles/global-ux.css'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/settlement/:section?', name: 'settlement', component: SettlementView }],
})
await router.push({ name: 'settlement', params: {
  section: new URLSearchParams(location.search).get('section') || 'dashboard',
} })
await router.isReady()
createApp({ render: () => h(RouterView) }).use(router).mount('#app')
