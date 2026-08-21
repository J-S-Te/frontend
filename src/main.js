import { createApp } from 'vue'
import App from '@/modules/platform/app/App.vue'
import router from '@/router'
import '@/modules/platform/shared/styles/main.css'
import '@/modules/platform/shared/styles/state.css'

createApp(App).use(router).mount('#app')
