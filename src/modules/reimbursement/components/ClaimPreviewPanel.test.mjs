import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse,compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { formatMinor } from '../api/client.js'
import { createErrorStateStub } from '../../../test/helpers/errorStateStub.mjs'

// 用途：编译实际预览模板以验证服务端路线字段的用户提示。
// 参数：extras 为共享错误态替身等外部依赖。
// 返回值：真实Vue组件；不替换条件判断或金额显示。
function previewComponent(extras = {}) {
  const {descriptor}=parse(readFileSync(new URL('./ClaimPreviewPanel.vue',import.meta.url),'utf8'))
  const compiled=compileScript(descriptor,{id:'preview-panel-test',inlineTemplate:true})
  const values={formatMinor,ErrorState:createErrorStateStub().Stub,...extras}
  const body=compiled.content.replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,(_,names,source)=>{
    if(source==='vue')for(const item of names.split(',')) {
      const [key,alias=key]=item.trim().split(/\s+as\s+/);values[alias]=Vue[key]
    }
    return ''
  }).replace(/^import\s+(\w+)\s+from\s+['"][^'"]+['"];?[ \t]*$/gm,(_,name)=>{values[name]=extras[name]??values[name];return ''})
  return new Function(...Object.keys(values),body.replace('export default','return'))(...Object.values(values))
}

test('额外节点提示读取实际triggered字段，与服务端路线一致',async()=>{
  for(const triggered of [true,false]) {
    const html=await renderToString(Vue.createSSRApp(previewComponent(),{value:{preview_only:true,
      expected_version:4,items:[{id:'i',requested_minor:'101',standard_limit_minor:'100',over_standard:true}],
      approval_nodes:triggered?[{node:1,node_label:'技术总监',mode:'ALL',assignee_subject_ids:['director']}]:[],
      route_decision:{triggered}}}))
    assert.match(html,triggered?/额外节点：按当前规则需要/:/额外节点：按当前规则不需要/)
    assert.match(html,/1\.01 元/)
    if(triggered)assert.match(html,/技术总监/)
  }
})

test('预览失败交给共享错误态，不直出原始错误文本',async()=>{
  const html=await renderToString(Vue.createSSRApp(previewComponent(),{error:'预览服务暂不可用'}))
  assert.match(html,/class="ui-state" role="alert"/)
  assert.match(html,/标准与审批预览未完成/)
  assert.match(html,/预览服务暂不可用/)
  assert.doesNotMatch(html,/<p role="alert">/)
})
