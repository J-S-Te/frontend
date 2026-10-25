<script setup>
// 发起红冲申请弹窗（治理批次 3 结算第三步，模板自 SettlementView.vue 逐字迁移）。
// 表单对象由父组件持有（子组件按属性直改字段）；DOM 由快照测试对提取前 golden 逐字节锁定。
defineProps({
  form: { type: Object, required: true },
  saving: { type: Boolean, default: false },
})

defineEmits(['cancel', 'submit'])
</script>

<template>
                <article
                  class="settlement-panel settlement-operation-card"
                >
                  <div class="settlement-panel-head">
                    <div>
                      <h2>发起红冲申请</h2>
                      <p>申请先由财务复核，通过后才提交税控，最终结果以税控回执为准。</p>
                    </div>
                    <button
                      class="console-text-button"
                      @click="$emit('cancel')"
                    >
                      取消
                    </button>
                  </div>
                  <form
                    class="settlement-operation-form"
                    @submit.prevent="$emit('submit')"
                  >
                    <label
                      ><span>红冲原因类型</span
                      ><select v-model="form.reason_code" required>
                        <option value="INVOICE_ERROR">开票信息错误</option>
                        <option value="CONTRACT_CHANGE">合同变更</option>
                        <option value="RETURN_OR_DISCOUNT">退货或折让</option>
                        <option value="OTHER">其他</option>
                      </select></label
                    >
                    <label class="wide"
                      ><span>具体原因</span
                      ><textarea
                        v-model.trim="form.reason_detail"
                        rows="3"
                        maxlength="500"
                        required
                      ></textarea>
                    </label>
                    <div class="settlement-operation-actions wide">
                      <button
                        type="button"
                        class="console-button secondary"
                        @click="$emit('cancel')"
                      >
                        取消
                      </button>
                      <button class="console-button danger" :disabled="saving">
                        提交红冲申请
                      </button>
                    </div>
                  </form>
                </article>
</template>
