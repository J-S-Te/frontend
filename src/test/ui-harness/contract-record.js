import '../../modules/platform/shared/styles/main.css'
import '../../modules/contract_management/styles/contract-management.css'
import { createApp, h, ref } from 'vue'
import ContractRecordManager from '../../modules/contract_management/components/ContractRecordManager.vue'

createApp({
  components: { ContractRecordManager },
  // setup 用途：挂载真实组件的最小交互宿主，不初始化任何业务环境。
  // 参数：无。
  // 返回值：真实组件的渲染函数，状态仅保存在本宿主。
  setup() {
    const mode = ref('active'), manager = ref(null)
    return () => h('main', { style: { maxWidth: '1100px', margin: '40px auto',
      padding: '0 20px', fontFamily: 'system-ui,sans-serif' } }, [
      h('h1', '合同记录最小场景'), h('p', '本页只使用合成测试数据。'),
      h('button', { id: 'open-record', type: 'button',
        onClick: () => manager.value.openRecord('RECORD-TEST') }, '删除合成合同'),
      h(ContractRecordManager, { ref: manager, modelValue: mode.value, showBrowser: true,
        'onUpdate:modelValue': (value) => { mode.value = value } }),
    ])
  },
}).mount('#app')
