import { createApp } from 'vue'
import App from '@/modules/platform/app/App.vue'
import router from '@/router'
import { installGlobalErrorHandlers } from '@/modules/shared/errors/globalErrorHandlers'
import '@/modules/platform/shared/styles/main.css'
import '@/modules/platform/shared/styles/state.css'
import '@/modules/shared/styles/global-ux.css'

const app = createApp(App)
// 顺序有讲究：先装 router（router.onError 才能挂上），再装全局兜底，最后 mount。
// 反过来的话，首屏渲染期炸掉的错误没人接，用户只会看到白屏。
app.use(router)
installGlobalErrorHandlers(app, router)
app.mount('#app')
