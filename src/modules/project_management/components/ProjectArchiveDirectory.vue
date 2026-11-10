<script setup>
import { computed, ref, watch } from 'vue'
import { frontendModules } from '../../registry/compiledModules.js'
import { formatBusinessDateTime } from '../../shared/utils/businessTime.js'
import { projectArchiveEntries, loadReimbursementArchiveIndex } from '../projectArchiveDirectory.js'

const props=defineProps({project:{type:Object,required:true},items:{type:Array,default:()=>[]},
  events:{type:Array,default:()=>[]},session:{type:Object,default:null}})
const emit=defineEmits(['view-service','view-events'])
const entries=computed(()=>projectArchiveEntries(props.project,props.items,props.events))
const page=ref(1),kind=ref(''),busy=ref(false),error=ref(''),expenses=ref(null)
const modules=new Set(frontendModules.map(module=>module.code))
const filtered=computed(()=>entries.value.filter(row=>!kind.value || row.kind===kind.value))
const visible=computed(()=>filtered.value.slice((page.value-1)*20,page.value*20))
const kinds={CONTRACT:'合同引用',TASK:'任务与原始记录',REPORT:'报告版本',EVENT:'审核、回执与异常记录'}
const prefix=(import.meta.env.VITE_REIMBURSEMENT_PUBLIC_PATH_PREFIX || '/reimbursement').replace(/\/$/,'')
let sequence=0

// 用途：只在用户请求时读取报销自己的目录，项目权限不能充当报销授权。
// 参数：无。
// 返回值：无；会话不一致、撤权或依赖失败显示独立错误。
async function loadExpenses() {
  if(!modules.has('reimbursement') || busy.value)return
  const ticket=++sequence;busy.value=true;error.value='';expenses.value=null
  try {
    const value=await loadReimbursementArchiveIndex(fetch,prefix,props.session,props.project.id)
    if(ticket===sequence)expenses.value=value
  }catch(cause){if(ticket===sequence)error.value=cause.message}
  finally{if(ticket===sequence)busy.value=false}
}
watch(()=>[props.project.id,props.session?.tenant_id,props.session?.identity_id,props.session?.subject_id],()=>{
  ++sequence;expenses.value=null;error.value='';busy.value=false;page.value=1
})
watch(kind,()=>{page.value=1})
</script>
<template>
  <section class="pm-panel" aria-label="项目统一档案目录">
    <h2>项目统一档案目录</h2>
    <p>按项目集中编目。合同、任务原始记录、报告和报销原件由来源系统保存；打开或下载时由该系统重新鉴权。
      目录引用及报告阶段不代表已生成统一封存文件包。</p>
    <label>资料类别<select v-model="kind"><option value="">全部</option>
      <option v-for="(label,key) in kinds" :key="key" :value="key">{{ label }}</option></select></label>
    <div class="pm-table-scroll"><table class="pm-table"><thead><tr>
      <th>来源类别</th><th>对象</th><th>版本 / 状态</th><th>查看来源</th>
    </tr></thead><tbody>
      <tr v-for="row in visible" :key="`${row.kind}/${row.id}`"><td>{{ kinds[row.kind] }}</td>
        <td>{{ row.label }}</td><td>{{ row.version ? `v${row.version} · ` : '' }}{{ row.status }}</td>
        <td><RouterLink v-if="row.target && modules.has('contract_management')" :to="row.target">进入合同台账</RouterLink>
          <span v-else-if="row.target">本发行未包含合同模块</span>
          <button v-else-if="row.service" class="pm-button" @click="emit('view-service',row.service)">查看项目服务项</button>
          <button v-else class="pm-button" @click="emit('view-events')">查看项目交付记录</button></td>
      </tr><tr v-if="!filtered.length"><td colspan="4">当前项目尚无此类可见目录条目。</td></tr>
    </tbody></table></div>
    <footer class="pm-table-footer"><button class="pm-button" :disabled="page<=1" @click="page--">上一页</button>
      <span>第 {{ page }} 页 · {{ filtered.length }} 项来源引用</span>
      <button class="pm-button" :disabled="page*20>=filtered.length" @click="page++">下一页</button></footer>
    <h3>报销封存档案</h3>
    <template v-if="modules.has('reimbursement')">
      <button class="pm-button" :disabled="busy" @click="loadExpenses">{{ busy ? '正在核对报销会话…' : '读取当前权限内的报销目录' }}</button>
      <RouterLink :to="{name:'reimbursement',params:{section:'archives'},query:{project_id:project.id}}">打开报销归档中心</RouterLink>
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-if="expenses && !expenses.items.length">报销当前权限范围内没有该项目的已封存档案。</p>
      <p v-for="row in expenses?.items || []" :key="row.project_id">报销已封存 {{ row.claim_count }} 张单据
        · 最近归档 {{ formatBusinessDateTime(row.last_archived_at) }}。
        <RouterLink :to="{name:'reimbursement',params:{section:'archives'},query:{project_id:row.project_id}}">查看只读档案、完整性与借阅</RouterLink></p>
    </template>
    <p v-else>本发行未包含报销模块。</p>
  </section>
</template>
