import { createApp } from 'vue'
import App from '@/modules/platform/app/App.vue'
import router from '@/router'
import { installGlobalErrorHandlers } from '@/modules/shared/errors/globalErrorHandlers'
import { installNativeDatePickerOnClick } from '@/modules/shared/composables/useNativeDatePickerAutoOpen'
import '@/modules/platform/shared/styles/main.css'
import '@/modules/platform/shared/styles/state.css'
import '@/modules/shared/styles/global-ux.css'
import '@/modules/shared/styles/ui-refresh.css'

const app = createApp(App)
// 顺序有讲究：先装 router（router.onError 才能挂上），再装全局兜底，最后 mount。
// 反过来的话，首屏渲染期炸掉的错误没人接，用户只会看到白屏。
app.use(router)
installGlobalErrorHandlers(app, router)
// 原生日期类输入框（date / datetime-local / time / month / week）点框内任意位置即开
// 选择器：一次 document 级 click 委托，六个子系统与门户共用，不逐个改页面。
// 内部自带 disabled/readonly 跳过与 showPicker 失败回退，不阻断键盘、焦点与表单提交。
// 必须挂在 mount 之前，首屏渲染出来的输入框就已经生效。
installNativeDatePickerOnClick()
app.mount('#app')
