import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { formatMinor } from '../api/client.js'
import { parseIssueLabel } from '../statusLabels.js'

// 用途：编译真实候选卡片，供组件及页面测试复用真实模板和业务格式化。
// 参数：无。
// 返回值：可挂载或服务端渲染的 Vue 组件，不替换卡片实现。
export function loadInvoiceCandidateCards() {
  const { descriptor } = parse(readFileSync(
    new URL('./InvoiceCandidateCards.vue', import.meta.url), 'utf8',
  ))
  const compiled = compileScript(descriptor, { id: 'invoice-candidate-cards', inlineTemplate: true })
  const bindings = { formatMinor, parseIssueLabel }
  const body = compiled.content.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,
    (_, names, source) => {
      for (const entry of names.split(',')) {
        const [key, alias = key] = entry.trim().split(/\s+as\s+/)
        bindings[alias] = source === 'vue' ? Vue[key] : bindings[key]
      }
      return ''
    },
  )
  return new Function(...Object.keys(bindings), body.replace('export default', 'return'))(
    ...Object.values(bindings),
  )
}
