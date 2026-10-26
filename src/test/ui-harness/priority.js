import { createApp, h, ref } from 'vue'
import ConfirmDialog from '@/modules/shared/components/ConfirmDialog.vue'
import PromptDialog from '@/modules/shared/components/PromptDialog.vue'
import OperationToast from '@/modules/shared/components/OperationToast.vue'
import OperationResultBanner from '@/modules/shared/components/OperationResultBanner.vue'
import DictionaryView from '@/modules/data_analysis/views/DictionaryView.vue'
import '@/modules/data_analysis/styles/data-analysis.css'
import '@/modules/shared/styles/global-ux.css'
const longText = 'LongIdentifierWithoutBreaks'.repeat(35)
createApp({
  setup() { return { confirm: ref(false), prompt: ref(false), toast: ref(false), dictionary: ref(false), busy: ref(false) } },
  render() {
    return h('main', { style: 'padding:12px;max-width:100%;box-sizing:border-box;' }, [
      h('button', { id:'open-both', onClick:()=>{this.confirm=true;this.prompt=true} }, '打开叠加弹窗'),
      h('button', { id:'open-confirm', onClick:()=>{this.confirm=true} }, '打开确认'),
      h('button', { id:'open-toast', onClick:()=>{this.toast=true} }, '提示'),
      h('button', { id:'toggle-busy', onClick:()=>{this.busy=!this.busy} }, '繁忙状态'),
      h('button', { id:'dictionary', onClick:()=>{this.dictionary=true} }, '指标字典'),
      h('div', { id:'result-fixture', style:'width:100%;max-width:480px;' }, [h(OperationResultBanner, {title:longText,message:longText,reference:longText})]),
      this.confirm ? h(ConfirmDialog,{busy:this.busy,title:longText,description:longText,onCancel:()=>{this.confirm=false},onConfirm:()=>{this.confirm=false}}) : null,
      this.prompt ? h(PromptDialog,{busy:this.busy,title:longText,description:longText,onCancel:()=>{this.prompt=false}}) : null,
      this.toast ? h(OperationToast,{message:longText,tone:'error'}) : null,
      this.dictionary ? h(DictionaryView,{permissions:['dictionary.manage']}) : null,
    ])
  },
}).mount('#app')
