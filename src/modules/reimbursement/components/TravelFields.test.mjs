import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import * as cities from '../cities.js'

// 用途：把真实差旅行程字段组件编译为可SSR断言的Vue组件。
// 参数：inline 表示是否编译模板，name 为真实组件文件名。
// 返回值：保留真实字段标签、禁用状态与受控事件的组件对象。
function component(inline = true, name = './TravelFields.vue') {
  const { descriptor } = parse(readFileSync(new URL(name, import.meta.url), 'utf8'))
  const compiled = compileScript(descriptor, { id: `travel-fields-test-${inline}`, inlineTemplate: inline })
  const values = { ...cities }
  const body = compiled.content.replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g, (_, names, source) => {
    for (const item of names.split(',')) {
      const [key, alias = key] = item.trim().split(/\s+as\s+/)
      values[alias] = source === 'vue' ? Vue[key] : values[key]
    }
    return ''
  }).replace(/^import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_, key, path) => {
    values[key] = component(true, path)
    return ''
  })
  return new Function(...Object.keys(values), body.replace('export default', 'return'))(...Object.values(values))
}

test('票面模式显示票面类别与票面日期，本人模式显示出发返回日，禁用与属性值真实转义', async () => {
  const invoice = await renderToString(Vue.createSSRApp(component(), { invoice: true, disabled: true,
    value: { kind: 'HOTEL', origin_city_code: '"><script>', destination_city_code: '310000',
      start_date: '2026-11-01', end_date: '2026-11-02' } }))
  assert.match(invoice, /票面行程事实（人工对照原件）/)
  assert.match(invoice, /<fieldset disabled/)
  assert.match(invoice, /票面类别/)
  assert.match(invoice, /机票/)
  assert.match(invoice, /火车票/)
  assert.match(invoice, /酒店/)
  assert.match(invoice, /票面开始日/)
  assert.match(invoice, /票面结束日（酒店为离店日）/)
  assert.match(invoice, /value="2026-11-01"/)
  assert.match(invoice, /&quot;&gt;&lt;script&gt;/)
  assert.doesNotMatch(invoice, /"><script>/)
  assert.doesNotMatch(invoice, /出发日|返回日/)

  const personal = await renderToString(Vue.createSSRApp(component(), { invoice: false,
    value: { departure_date: '2026-11-03', return_date: '2026-11-05' } }))
  assert.match(personal, /本人差旅行程填报/)
  assert.match(personal, /出发日/)
  assert.match(personal, /返回日/)
  assert.match(personal, /value="2026-11-03"/)
  assert.doesNotMatch(personal, /票面类别|票面开始日/)
})

test('受控更新只覆盖当前字段并保留其余行程字段，不修改原对象', async () => {
  const emitted = []
  const view = component(false)
  const value = { kind: 'RAIL', origin_city_code: '110000', destination_city_code: '310000' }
  const bindings = view.setup({ value, invoice: true, disabled: false },
    { emit: (event, payload) => emitted.push([event, payload]), expose: () => {} })
  bindings.change('destination_city_code', '440300')
  assert.equal(emitted.length, 1)
  assert.equal(emitted[0][0], 'update:value')
  assert.deepEqual(emitted[0][1], { kind: 'RAIL', origin_city_code: '110000', destination_city_code: '440300' })
  assert.deepEqual(value, { kind: 'RAIL', origin_city_code: '110000', destination_city_code: '310000' })
})
