import { createApp, h, ref } from 'vue'
import PromptDialog from '@/modules/shared/components/PromptDialog.vue'
import { usePromptDialog } from '@/modules/shared/composables/usePromptDialog.js'

createApp({
  // setup 装配隔离夹具，用真实弹窗验证输入结果与取消。
  // 参数：无。
  // 返回值：渲染函数；不访问业务接口。
  setup() {
    const { dialog, askPrompt, accept, cancel } = usePromptDialog()
    const result = ref('尚未提交')
    const busy = ref(false)
    // open 打开合成登记表单并记录弹窗的真实返回值。
    // 参数：无。
    // 返回值：无业务副作用的 Promise。
    async function open() {
      const values = await askPrompt({
        title: '登记发票', confirmText: '登记发票', cancelText: '取消登记',
        fields: [
          { name: 'invoice_no', label: '发票号码', required: true, minlength: 4 },
          { name: 'issue_date', label: '开票日期', type: 'date', required: true },
          { name: 'reason', label: '备注', type: 'textarea', maxlength: 20 },
        ],
      })
      result.value = values === null ? '已取消，未登记' : JSON.stringify(values)
    }
    // openReason 验证单输入契约及忙碌状态的取消保护。
    // 参数：无。
    // 返回值：无业务副作用的 Promise。
    async function openReason() {
      const reason = await askPrompt({
        title: '撤回申请', confirmText: '撤回申请', label: '撤回原因', minlength: 1,
      })
      result.value = reason === null ? '已取消，未撤回' : `撤回原因：${reason}`
    }
    return () => h('main', [
      h('button', { onClick: open }, '打开登记表单'),
      h('button', { onClick: openReason }, '打开撤回原因'),
      h('button', { id: 'toggle-busy', onClick: () => { busy.value = !busy.value } }, '切换忙碌状态'),
      h('output', { id: 'result' }, result.value),
      dialog.value ? h(PromptDialog, { ...dialog.value, busy: busy.value, onConfirm: accept, onCancel: cancel }) : null,
    ])
  },
}).mount('#app')
