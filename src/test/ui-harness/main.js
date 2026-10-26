import { createApp, h, ref } from 'vue'
import ConfirmDialog from '@/modules/shared/components/ConfirmDialog.vue'
import PromptDialog from '@/modules/shared/components/PromptDialog.vue'

createApp({
  setup() {
    const confirm = ref(false)
    const prompt = ref(false)
    const result = ref('')
    return { confirm, prompt, result }
  },
  render() {
    return h('main', { style: 'font-family: sans-serif; padding: 24px;' }, [
      h('h1', 'UX dialogs harness'),
      h('button', { id: 'open-confirm', onClick: () => { this.confirm = true } }, '打开确认'),
      h('button', { id: 'open-prompt', onClick: () => { this.prompt = true } }, '打开原因输入'),
      h('p', { id: 'result' }, this.result),
      this.confirm ? h(ConfirmDialog, {
        title: '删除合同模板？',
        description: '确定删除模板吗？已生成的合同不受影响。',
        confirmText: '删除模板', cancelText: '取消', danger: true,
        onConfirm: () => { this.result = 'confirmed'; this.confirm = false },
        onCancel: () => { this.confirm = false },
      }) : null,
      this.prompt ? h(PromptDialog, {
        title: '复核税控失败结果', description: '请填写复核原因。', label: '复核原因', minlength: 5, maxlength: 1000,
        onConfirm: (value) => { this.result = `reason:${value}`; this.prompt = false },
        onCancel: () => { this.prompt = false },
      }) : null,
    ])
  },
}).mount('#app')
