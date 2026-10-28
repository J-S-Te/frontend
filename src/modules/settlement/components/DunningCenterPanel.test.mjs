import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as Vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'

const SRC = new URL('../../../', import.meta.url).pathname

async function resolveDependency(fromFile, specifier) {
  if (specifier === 'vue') return Vue
  const base = specifier.startsWith('.') ? resolve(dirname(fromFile), specifier) : join(SRC, specifier.slice(2))
  if (specifier.endsWith('.vue')) return loadSfc(base)
  for (const candidate of [base, `${base}.js`, join(base, 'index.js')]) {
    try {
      return await import(pathToFileURL(candidate).href)
    } catch (error) {
      if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error
    }
  }
  throw new Error(`cannot resolve ${specifier}`)
}

async function loadSfc(file) {
  const { descriptor } = parse(readFileSync(file, 'utf8'))
  const script = compileScript(descriptor, { id: file })
  const compiled = compileTemplate({
    source: descriptor.template.content,
    filename: file,
    id: file,
    compilerOptions: { bindingMetadata: script.bindings },
  })
  assert.deepEqual(compiled.errors, [], file)
  const imports = {}
  for (const node of script.scriptSetupAst.filter((item) => item.type === 'ImportDeclaration')) {
    const dependency = await resolveDependency(file, node.source.value)
    for (const spec of node.specifiers) {
      imports[spec.local.name] = spec.type === 'ImportDefaultSpecifier' ? (dependency.default ?? dependency) : dependency[spec.imported.name]
    }
  }
  const component = new Function(...Object.keys(imports), script.content
    .replace(/^import\s[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
    .replace('export default', 'return'))(...Object.values(imports))
  component.render = new Function('Vue', compiled.code
    .replace(/import \{([^}]+)\} from "vue"/g, (_, names) => `const { ${names.replace(/ as /g, ': ')} } = Vue`)
    .replace('export function render', 'return function render'))(Vue)
  return component
}

// golden 为提取前 SettlementView.vue 催收区（账龄与催收）片段的 SSR 渲染结果
// （治理批次 5 结算第三步采集，片段/用例/采集脚本归档于 .ai/qa/closure-20261025/goldens-dunning-center/）；
// 提取后本组件必须逐字节复现同一 DOM。canCompleteDunningAction 为函数 prop，渲染时按 PENDING 判定。
const GOLDENS = {
  "empty": "<section class=\"settlement-dunning\"><div class=\"settlement-section-head\"><div><p> 按账龄区间识别未结清应收；逾期提醒和升级状态以催收案件与动作记录为准。 </p></div><div><button class=\"console-button secondary\">导出账龄表</button><button class=\"console-button secondary\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M12 5V1L7 6l5 5V7c3.3 0 6 2.7 6 6 0 1-.3 2-.8 2.8l1.5 1.5A8 8 0 0 0 12 5Zm-6.7.7A8 8 0 0 0 12 21v-4c-3.3 0-6-2.7-6-6 0-1 .3-2 .8-2.8L5.3 5.7Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>刷新 </button></div></div><p class=\"settlement-detail-notice\"> 页面金额与笔数基于服务端全量催收汇总；导出的账龄表由服务端重新查询当前租户全部未结清应收生成。 </p><!--v-if--><!--v-if--><section class=\"settlement-cards settlement-dunning-cards\"><!--[--><article class=\"tone-blue\"><span>逾期金额</span><b>CNY 12.5万</b><small>服务端全量逾期金额</small></article><article class=\"tone-orange\"><span>逾期笔数</span><b>3 笔</b><small>含 90 天以上逾期</small></article><article class=\"tone-green\"><span>已产生提醒</span><b>7 次</b><small>2 条待跟进</small></article><article class=\"tone-purple\"><span>活跃案件</span><b>2 笔</b><small>1 笔已升级</small></article><!--]--></section><article class=\"settlement-panel settlement-aging-report\"><div class=\"settlement-panel-head\"><div><h2>账龄区间报表</h2><p>当前已加载未结清应收的账龄辅助统计。</p></div><span class=\"settlement-muted\">单位：元</span></div><div class=\"settlement-table-scroll\"><table><thead><tr><th>账龄区间</th><th>金额</th><th>占比</th><th>笔数</th><th>状态</th></tr></thead><tbody><!--[--><!--]--></tbody></table></div></article><article class=\"settlement-panel settlement-aging-report\"><div class=\"settlement-panel-head\"><div><h2>催收案件</h2><p>按应收和策略版本建立；结清自动关闭，再次逾期会重新打开。</p></div></div><div class=\"settlement-table-scroll\"><table><thead><tr><th>案件 ID</th><th>应收单号</th><th>客户</th><th>逾期天数</th><th>未结金额</th><th>升级级别</th><th>状态</th><th>下次跟进</th><th>当前负责人</th></tr></thead><tbody><!--[--><!--]--><tr><td colspan=\"9\" class=\"settlement-table-empty\">暂无催收案件</td></tr></tbody></table></div></article><article class=\"settlement-panel settlement-aging-report\"><div class=\"settlement-panel-head\"><div><h2>催收动作记录</h2><p> 仅展示已生成的真实催收动作；普通提醒留在本系统，高优先级事件由 Outbox 异步投递基础平台。 </p></div></div><div class=\"settlement-table-scroll\"><table><thead><tr><th>记录 ID</th><th>应收单号</th><th>渠道</th><th>创建时间</th><th>接收人</th><th>升级标记</th><th>状态</th><th>完成时间</th><th>操作</th></tr></thead><tbody><!--[--><!--]--><tr><td colspan=\"9\" class=\"settlement-table-empty\"> 暂无已生成的催收动作记录 </td></tr></tbody></table></div></article><details class=\"settlement-panel settlement-policy-settings\"><summary><span>逾期提醒规则</span><small>仅催收专员和管理员可新建或查看策略</small></summary><div class=\"settlement-policy-intro\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M12 22a2.3 2.3 0 0 0 2.2-1.7H9.8A2.3 2.3 0 0 0 12 22Zm7-5-1.8-2.1V10a5.3 5.3 0 0 0-4.2-5.2V4a1 1 0 0 0-2 0v.8A5.3 5.3 0 0 0 6.8 10v4.9L5 17v1h14v-1Zm-11.3-1 .9-1V10a3.4 3.4 0 1 1 6.8 0v5l.9 1H7.7Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg><p> 系统每天检查未结清应收；逾期进入指定范围后，将创建内部跟进提醒并通知指定业务人员，不会向客户直接发送消息。 </p></div><form class=\"settlement-policy-form\"><label class=\"settlement-policy-field settlement-policy-field-wide\"><span>策略名称</span><input placeholder=\"例如：逾期 1–30 天销售跟进\" required maxlength=\"255\" value=\"逾期升级提醒\"><small>方便团队识别这条提醒的适用场景。</small></label><div class=\"settlement-policy-field\"><span>逾期多久开始提醒</span><div class=\"settlement-policy-range\"><input type=\"number\" min=\"1\" required value=\"1\"><b>至</b><input type=\"number\" min=\"1\" required value=\"30\"><em>天</em></div><small>例如 1 至 30 天，表示从逾期第 1 天起提醒。</small></div><label class=\"settlement-policy-field\"><span>提醒哪位业务人员</span><select disabled required><option value>请选择催收业务人员</option><!--[--><!--]--></select><small> 当前没有同时具备本系统权限和催收角色的有效人员，请先在基础平台配置。 </small></label><label class=\"settlement-policy-field\"><span>下次跟进提醒间隔</span><select><option value=\"1\">每天提醒一次</option><option value=\"3\">每 3 天提醒一次</option><option value=\"7\">每周提醒一次</option><option value=\"14\">每两周提醒一次</option></select><small>用于安排后续跟进时间，避免同一笔应收被过度打扰。</small></label><label class=\"settlement-policy-field\"><span>提醒级别</span><select><option value=\"NORMAL\">普通提醒</option><option value=\"HIGH\">重点关注</option><option value=\"CRITICAL\">紧急升级</option></select><small>重点和紧急提醒会自动同步基础平台通知中心。</small></label><label class=\"settlement-policy-field\"><span>提醒范围</span><select><option value=\"LOCAL\">仅在结算系统内提醒</option><option value=\"PLATFORM\">同步到基础平台通知中心</option></select><small>普通跟进建议仅在系统内提醒；重点和紧急提醒仍会同步基础平台。</small></label><div class=\"settlement-policy-submit\"><span>保存后立即启用，并保留操作审计记录。</span><button><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m9.2 16.6-4-4 1.4-1.4 2.6 2.6 8.2-8.2L18.8 7l-9.6 9.6Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>保存并启用规则 </button></div></form></details></section>",
  "populated": "<section class=\"settlement-dunning\"><div class=\"settlement-section-head\"><div><p> 按账龄区间识别未结清应收；逾期提醒和升级状态以催收案件与动作记录为准。 </p></div><div><button class=\"console-button secondary\">下载账龄表</button><button class=\"console-button secondary\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M12 5V1L7 6l5 5V7c3.3 0 6 2.7 6 6 0 1-.3 2-.8 2.8l1.5 1.5A8 8 0 0 0 12 5Zm-6.7.7A8 8 0 0 0 12 21v-4c-3.3 0-6-2.7-6-6 0-1 .3-2 .8-2.8L5.3 5.7Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>刷新 </button></div></div><p class=\"settlement-detail-notice\"> 页面金额与笔数基于服务端全量催收汇总；导出的账龄表由服务端重新查询当前租户全部未结清应收生成。 </p><p class=\"settlement-detail-notice\" role=\"status\"> 有 2 笔逾期应收没有匹配的催收策略，请补充覆盖对应账龄区间的规则。 </p><div class=\"settlement-detail-notice\" role=\"status\"><strong>策略覆盖巡检：</strong><!--[--><span>31–60 天</span><span>、≥91 天</span><!--]--> 未配置启用策略；系统只提示，不自动生成策略。 </div><section class=\"settlement-cards settlement-dunning-cards\"><!--[--><article class=\"tone-blue\"><span>逾期金额</span><b>CNY 12.5万</b><small>服务端全量逾期金额</small></article><article class=\"tone-orange\"><span>逾期笔数</span><b>3 笔</b><small>含 90 天以上逾期</small></article><article class=\"tone-green\"><span>已产生提醒</span><b>7 次</b><small>2 条待跟进</small></article><article class=\"tone-purple\"><span>活跃案件</span><b>2 笔</b><small>1 笔已升级</small></article><!--]--></section><article class=\"settlement-panel settlement-aging-report\"><div class=\"settlement-panel-head\"><div><h2>账龄区间报表</h2><p>当前已加载未结清应收的账龄辅助统计。</p></div><span class=\"settlement-muted\">单位：元</span></div><div class=\"settlement-table-scroll\"><table><thead><tr><th>账龄区间</th><th>金额</th><th>占比</th><th>笔数</th><th>状态</th></tr></thead><tbody><!--[--><tr><td>0–30 天 · CNY</td><td class=\"settlement-money\">¥1,000</td><td>40%</td><td>2</td><td><span class=\"settlement-badge tone-info\">正常</span></td></tr><tr><td>31–60 天 · CNY</td><td class=\"settlement-money\">¥800</td><td>32%</td><td>1</td><td><span class=\"settlement-badge tone-info\">关注</span></td></tr><tr><td>61–90 天 · CNY</td><td class=\"settlement-money\">¥500</td><td>20%</td><td>1</td><td><span class=\"settlement-badge tone-warning\">预警</span></td></tr><tr><td>90 天以上 · CNY</td><td class=\"settlement-money\">¥200</td><td>8%</td><td>1</td><td><span class=\"settlement-badge tone-danger\">逾期</span></td></tr><!--]--></tbody></table></div></article><article class=\"settlement-panel settlement-aging-report\"><div class=\"settlement-panel-head\"><div><h2>催收案件</h2><p>按应收和策略版本建立；结清自动关闭，再次逾期会重新打开。</p></div></div><div class=\"settlement-table-scroll\"><table><thead><tr><th>案件 ID</th><th>应收单号</th><th>客户</th><th>逾期天数</th><th>未结金额</th><th>升级级别</th><th>状态</th><th>下次跟进</th><th>当前负责人</th></tr></thead><tbody><!--[--><tr><td class=\"settlement-contract-cell\">CASE-1</td><td>AR-001</td><td>甲公司</td><td>45 天</td><td class=\"settlement-money\">¥800</td><td>2 级</td><td><span class=\"settlement-badge tone-warning\">跟进中</span></td><td>2026-11-01</td><td>u1</td></tr><tr><td class=\"settlement-contract-cell\">CASE-2</td><td>AR-002</td><td>乙公司</td><td>0 天</td><td class=\"settlement-money\">¥0</td><td>0 级</td><td><span class=\"settlement-badge tone-info\">已关闭</span></td><td>—</td><td>—</td></tr><!--]--><!--v-if--></tbody></table></div></article><article class=\"settlement-panel settlement-aging-report\"><div class=\"settlement-panel-head\"><div><h2>催收动作记录</h2><p> 仅展示已生成的真实催收动作；普通提醒留在本系统，高优先级事件由 Outbox 异步投递基础平台。 </p></div></div><div class=\"settlement-table-scroll\"><table><thead><tr><th>记录 ID</th><th>应收单号</th><th>渠道</th><th>创建时间</th><th>接收人</th><th>升级标记</th><th>状态</th><th>完成时间</th><th>操作</th></tr></thead><tbody><!--[--><tr><td class=\"settlement-contract-cell\">ACT-1</td><td>AR-001</td><td>LOCAL</td><td>2026-10-20 09:00</td><td>u1</td><td><span class=\"settlement-badge tone-warning\">已升级</span></td><td><span class=\"settlement-badge tone-warning\">待跟进</span></td><td>—</td><td><button class=\"console-text-button\">完成跟进</button></td></tr><tr><td class=\"settlement-contract-cell\">ACT-2</td><td>AR-001</td><td>PLATFORM</td><td>2026-10-10 09:00</td><td>u1</td><td><span class=\"settlement-muted\">—</span></td><td><span class=\"settlement-badge tone-info\">已完成</span></td><td>2026-10-12 10:00</td><td><span class=\"settlement-muted\">—</span></td></tr><!--]--><!--v-if--></tbody></table></div></article><details class=\"settlement-panel settlement-policy-settings\"><summary><span>逾期提醒规则</span><small>仅催收专员和管理员可新建或查看策略</small></summary><div class=\"settlement-policy-intro\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M12 22a2.3 2.3 0 0 0 2.2-1.7H9.8A2.3 2.3 0 0 0 12 22Zm7-5-1.8-2.1V10a5.3 5.3 0 0 0-4.2-5.2V4a1 1 0 0 0-2 0v.8A5.3 5.3 0 0 0 6.8 10v4.9L5 17v1h14v-1Zm-11.3-1 .9-1V10a3.4 3.4 0 1 1 6.8 0v5l.9 1H7.7Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg><p> 系统每天检查未结清应收；逾期进入指定范围后，将创建内部跟进提醒并通知指定业务人员，不会向客户直接发送消息。 </p></div><form class=\"settlement-policy-form\"><label class=\"settlement-policy-field settlement-policy-field-wide\"><span>策略名称</span><input placeholder=\"例如：逾期 1–30 天销售跟进\" required maxlength=\"255\" value=\"逾期 31–60 天销售跟进\"><small>方便团队识别这条提醒的适用场景。</small></label><div class=\"settlement-policy-field\"><span>逾期多久开始提醒</span><div class=\"settlement-policy-range\"><input type=\"number\" min=\"1\" required value=\"31\"><b>至</b><input type=\"number\" min=\"1\" required value=\"60\"><em>天</em></div><small>例如 1 至 30 天，表示从逾期第 1 天起提醒。</small></div><label class=\"settlement-policy-field\"><span>提醒哪位业务人员</span><select required><option value>请选择催收业务人员</option><!--[--><option value=\"u1\">张三 <!--[--> · zhangsan<!--]--></option><option value=\"u2\">李四 <!--v-if--></option><!--]--></select><small>仅展示当前租户内拥有结算权限且属于催收角色的有效人员。</small></label><label class=\"settlement-policy-field\"><span>下次跟进提醒间隔</span><select><option value=\"1\">每天提醒一次</option><option value=\"3\">每 3 天提醒一次</option><option value=\"7\">每周提醒一次</option><option value=\"14\">每两周提醒一次</option></select><small>用于安排后续跟进时间，避免同一笔应收被过度打扰。</small></label><label class=\"settlement-policy-field\"><span>提醒级别</span><select><option value=\"NORMAL\">普通提醒</option><option value=\"HIGH\">重点关注</option><option value=\"CRITICAL\">紧急升级</option></select><small>重点和紧急提醒会自动同步基础平台通知中心。</small></label><label class=\"settlement-policy-field\"><span>提醒范围</span><select><option value=\"LOCAL\">仅在结算系统内提醒</option><option value=\"PLATFORM\">同步到基础平台通知中心</option></select><small>普通跟进建议仅在系统内提醒；重点和紧急提醒仍会同步基础平台。</small></label><div class=\"settlement-policy-submit\"><span>保存后立即启用，并保留操作审计记录。</span><button><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m9.2 16.6-4-4 1.4-1.4 2.6 2.6 8.2-8.2L18.8 7l-9.6 9.6Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>保存并启用规则 </button></div></form></details></section>",
  "saving": "<section class=\"settlement-dunning\"><div class=\"settlement-section-head\"><div><p> 按账龄区间识别未结清应收；逾期提醒和升级状态以催收案件与动作记录为准。 </p></div><div><button class=\"console-button secondary\" disabled>生成账龄表中…</button><button class=\"console-button secondary\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M12 5V1L7 6l5 5V7c3.3 0 6 2.7 6 6 0 1-.3 2-.8 2.8l1.5 1.5A8 8 0 0 0 12 5Zm-6.7.7A8 8 0 0 0 12 21v-4c-3.3 0-6-2.7-6-6 0-1 .3-2 .8-2.8L5.3 5.7Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>刷新 </button></div></div><p class=\"settlement-detail-notice\"> 页面金额与笔数基于服务端全量催收汇总；导出的账龄表由服务端重新查询当前租户全部未结清应收生成。 </p><!--v-if--><!--v-if--><section class=\"settlement-cards settlement-dunning-cards\"><!--[--><article class=\"tone-blue\"><span>逾期金额</span><b>CNY 12.5万</b><small>服务端全量逾期金额</small></article><article class=\"tone-orange\"><span>逾期笔数</span><b>3 笔</b><small>含 90 天以上逾期</small></article><article class=\"tone-green\"><span>已产生提醒</span><b>7 次</b><small>2 条待跟进</small></article><article class=\"tone-purple\"><span>活跃案件</span><b>2 笔</b><small>1 笔已升级</small></article><!--]--></section><article class=\"settlement-panel settlement-aging-report\"><div class=\"settlement-panel-head\"><div><h2>账龄区间报表</h2><p>当前已加载未结清应收的账龄辅助统计。</p></div><span class=\"settlement-muted\">单位：元</span></div><div class=\"settlement-table-scroll\"><table><thead><tr><th>账龄区间</th><th>金额</th><th>占比</th><th>笔数</th><th>状态</th></tr></thead><tbody><!--[--><!--]--></tbody></table></div></article><article class=\"settlement-panel settlement-aging-report\"><div class=\"settlement-panel-head\"><div><h2>催收案件</h2><p>按应收和策略版本建立；结清自动关闭，再次逾期会重新打开。</p></div></div><div class=\"settlement-table-scroll\"><table><thead><tr><th>案件 ID</th><th>应收单号</th><th>客户</th><th>逾期天数</th><th>未结金额</th><th>升级级别</th><th>状态</th><th>下次跟进</th><th>当前负责人</th></tr></thead><tbody><!--[--><!--]--><tr><td colspan=\"9\" class=\"settlement-table-empty\">暂无催收案件</td></tr></tbody></table></div></article><article class=\"settlement-panel settlement-aging-report\"><div class=\"settlement-panel-head\"><div><h2>催收动作记录</h2><p> 仅展示已生成的真实催收动作；普通提醒留在本系统，高优先级事件由 Outbox 异步投递基础平台。 </p></div></div><div class=\"settlement-table-scroll\"><table><thead><tr><th>记录 ID</th><th>应收单号</th><th>渠道</th><th>创建时间</th><th>接收人</th><th>升级标记</th><th>状态</th><th>完成时间</th><th>操作</th></tr></thead><tbody><!--[--><tr><td class=\"settlement-contract-cell\">ACT-3</td><td>AR-003</td><td>LOCAL</td><td>2026-10-21 09:00</td><td>u1</td><td><span class=\"settlement-muted\">—</span></td><td><span class=\"settlement-badge tone-warning\">待跟进</span></td><td>—</td><td><button class=\"console-text-button\" disabled>完成跟进</button></td></tr><!--]--><!--v-if--></tbody></table></div></article><details class=\"settlement-panel settlement-policy-settings\"><summary><span>逾期提醒规则</span><small>仅催收专员和管理员可新建或查看策略</small></summary><div class=\"settlement-policy-intro\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M12 22a2.3 2.3 0 0 0 2.2-1.7H9.8A2.3 2.3 0 0 0 12 22Zm7-5-1.8-2.1V10a5.3 5.3 0 0 0-4.2-5.2V4a1 1 0 0 0-2 0v.8A5.3 5.3 0 0 0 6.8 10v4.9L5 17v1h14v-1Zm-11.3-1 .9-1V10a3.4 3.4 0 1 1 6.8 0v5l.9 1H7.7Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg><p> 系统每天检查未结清应收；逾期进入指定范围后，将创建内部跟进提醒并通知指定业务人员，不会向客户直接发送消息。 </p></div><form class=\"settlement-policy-form\"><label class=\"settlement-policy-field settlement-policy-field-wide\"><span>策略名称</span><input placeholder=\"例如：逾期 1–30 天销售跟进\" required maxlength=\"255\" value=\"逾期升级提醒\"><small>方便团队识别这条提醒的适用场景。</small></label><div class=\"settlement-policy-field\"><span>逾期多久开始提醒</span><div class=\"settlement-policy-range\"><input type=\"number\" min=\"1\" required value=\"1\"><b>至</b><input type=\"number\" min=\"1\" required value=\"30\"><em>天</em></div><small>例如 1 至 30 天，表示从逾期第 1 天起提醒。</small></div><label class=\"settlement-policy-field\"><span>提醒哪位业务人员</span><select disabled required><option value>正在读取催收人员…</option><!--[--><!--]--></select><small>仅展示当前租户内拥有结算权限且属于催收角色的有效人员。</small></label><label class=\"settlement-policy-field\"><span>下次跟进提醒间隔</span><select><option value=\"1\">每天提醒一次</option><option value=\"3\">每 3 天提醒一次</option><option value=\"7\">每周提醒一次</option><option value=\"14\">每两周提醒一次</option></select><small>用于安排后续跟进时间，避免同一笔应收被过度打扰。</small></label><label class=\"settlement-policy-field\"><span>提醒级别</span><select><option value=\"NORMAL\">普通提醒</option><option value=\"HIGH\">重点关注</option><option value=\"CRITICAL\">紧急升级</option></select><small>重点和紧急提醒会自动同步基础平台通知中心。</small></label><label class=\"settlement-policy-field\"><span>提醒范围</span><select><option value=\"LOCAL\">仅在结算系统内提醒</option><option value=\"PLATFORM\">同步到基础平台通知中心</option></select><small>普通跟进建议仅在系统内提醒；重点和紧急提醒仍会同步基础平台。</small></label><div class=\"settlement-policy-submit\"><span>保存后立即启用，并保留操作审计记录。</span><button disabled><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m9.2 16.6-4-4 1.4-1.4 2.6 2.6 8.2-8.2L18.8 7l-9.6 9.6Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>保存并启用规则 </button></div></form></details></section>",
  "recipientsError": "<section class=\"settlement-dunning\"><div class=\"settlement-section-head\"><div><p> 按账龄区间识别未结清应收；逾期提醒和升级状态以催收案件与动作记录为准。 </p></div><div><button class=\"console-button secondary\">导出账龄表</button><button class=\"console-button secondary\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M12 5V1L7 6l5 5V7c3.3 0 6 2.7 6 6 0 1-.3 2-.8 2.8l1.5 1.5A8 8 0 0 0 12 5Zm-6.7.7A8 8 0 0 0 12 21v-4c-3.3 0-6-2.7-6-6 0-1 .3-2 .8-2.8L5.3 5.7Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>刷新 </button></div></div><p class=\"settlement-detail-notice\"> 页面金额与笔数基于服务端全量催收汇总；导出的账龄表由服务端重新查询当前租户全部未结清应收生成。 </p><!--v-if--><!--v-if--><section class=\"settlement-cards settlement-dunning-cards\"><!--[--><article class=\"tone-blue\"><span>逾期金额</span><b>CNY 12.5万</b><small>服务端全量逾期金额</small></article><article class=\"tone-orange\"><span>逾期笔数</span><b>3 笔</b><small>含 90 天以上逾期</small></article><article class=\"tone-green\"><span>已产生提醒</span><b>7 次</b><small>2 条待跟进</small></article><article class=\"tone-purple\"><span>活跃案件</span><b>2 笔</b><small>1 笔已升级</small></article><!--]--></section><article class=\"settlement-panel settlement-aging-report\"><div class=\"settlement-panel-head\"><div><h2>账龄区间报表</h2><p>当前已加载未结清应收的账龄辅助统计。</p></div><span class=\"settlement-muted\">单位：元</span></div><div class=\"settlement-table-scroll\"><table><thead><tr><th>账龄区间</th><th>金额</th><th>占比</th><th>笔数</th><th>状态</th></tr></thead><tbody><!--[--><!--]--></tbody></table></div></article><article class=\"settlement-panel settlement-aging-report\"><div class=\"settlement-panel-head\"><div><h2>催收案件</h2><p>按应收和策略版本建立；结清自动关闭，再次逾期会重新打开。</p></div></div><div class=\"settlement-table-scroll\"><table><thead><tr><th>案件 ID</th><th>应收单号</th><th>客户</th><th>逾期天数</th><th>未结金额</th><th>升级级别</th><th>状态</th><th>下次跟进</th><th>当前负责人</th></tr></thead><tbody><!--[--><!--]--><tr><td colspan=\"9\" class=\"settlement-table-empty\">暂无催收案件</td></tr></tbody></table></div></article><article class=\"settlement-panel settlement-aging-report\"><div class=\"settlement-panel-head\"><div><h2>催收动作记录</h2><p> 仅展示已生成的真实催收动作；普通提醒留在本系统，高优先级事件由 Outbox 异步投递基础平台。 </p></div></div><div class=\"settlement-table-scroll\"><table><thead><tr><th>记录 ID</th><th>应收单号</th><th>渠道</th><th>创建时间</th><th>接收人</th><th>升级标记</th><th>状态</th><th>完成时间</th><th>操作</th></tr></thead><tbody><!--[--><!--]--><tr><td colspan=\"9\" class=\"settlement-table-empty\"> 暂无已生成的催收动作记录 </td></tr></tbody></table></div></article><details class=\"settlement-panel settlement-policy-settings\"><summary><span>逾期提醒规则</span><small>仅催收专员和管理员可新建或查看策略</small></summary><div class=\"settlement-policy-intro\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M12 22a2.3 2.3 0 0 0 2.2-1.7H9.8A2.3 2.3 0 0 0 12 22Zm7-5-1.8-2.1V10a5.3 5.3 0 0 0-4.2-5.2V4a1 1 0 0 0-2 0v.8A5.3 5.3 0 0 0 6.8 10v4.9L5 17v1h14v-1Zm-11.3-1 .9-1V10a3.4 3.4 0 1 1 6.8 0v5l.9 1H7.7Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg><p> 系统每天检查未结清应收；逾期进入指定范围后，将创建内部跟进提醒并通知指定业务人员，不会向客户直接发送消息。 </p></div><form class=\"settlement-policy-form\"><label class=\"settlement-policy-field settlement-policy-field-wide\"><span>策略名称</span><input placeholder=\"例如：逾期 1–30 天销售跟进\" required maxlength=\"255\" value=\"逾期升级提醒\"><small>方便团队识别这条提醒的适用场景。</small></label><div class=\"settlement-policy-field\"><span>逾期多久开始提醒</span><div class=\"settlement-policy-range\"><input type=\"number\" min=\"1\" required value=\"1\"><b>至</b><input type=\"number\" min=\"1\" required value=\"30\"><em>天</em></div><small>例如 1 至 30 天，表示从逾期第 1 天起提醒。</small></div><label class=\"settlement-policy-field\"><span>提醒哪位业务人员</span><select disabled required><option value>请选择催收业务人员</option><!--[--><!--]--></select><small class=\"settlement-field-error\">基础平台人员目录暂不可用。 <button type=\"button\" class=\"console-text-button\">重新加载</button></small></label><label class=\"settlement-policy-field\"><span>下次跟进提醒间隔</span><select><option value=\"1\">每天提醒一次</option><option value=\"3\">每 3 天提醒一次</option><option value=\"7\">每周提醒一次</option><option value=\"14\">每两周提醒一次</option></select><small>用于安排后续跟进时间，避免同一笔应收被过度打扰。</small></label><label class=\"settlement-policy-field\"><span>提醒级别</span><select><option value=\"NORMAL\">普通提醒</option><option value=\"HIGH\">重点关注</option><option value=\"CRITICAL\">紧急升级</option></select><small>重点和紧急提醒会自动同步基础平台通知中心。</small></label><label class=\"settlement-policy-field\"><span>提醒范围</span><select><option value=\"LOCAL\">仅在结算系统内提醒</option><option value=\"PLATFORM\">同步到基础平台通知中心</option></select><small>普通跟进建议仅在系统内提醒；重点和紧急提醒仍会同步基础平台。</small></label><div class=\"settlement-policy-submit\"><span>保存后立即启用，并保留操作审计记录。</span><button><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m9.2 16.6-4-4 1.4-1.4 2.6 2.6 8.2-8.2L18.8 7l-9.6 9.6Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>保存并启用规则 </button></div></form></details></section>"
}
const CASES = {
  "empty": {
    "saving": false,
    "exportJob": null,
    "dunningOverview": {},
    "dunningCoverage": {
      "policies": [],
      "gaps": []
    },
    "dunningKpis": [
      {
        "label": "逾期金额",
        "value": "CNY 12.5万",
        "note": "服务端全量逾期金额",
        "tone": "blue"
      },
      {
        "label": "逾期笔数",
        "value": "3 笔",
        "note": "含 90 天以上逾期",
        "tone": "orange"
      },
      {
        "label": "已产生提醒",
        "value": "7 次",
        "note": "2 条待跟进",
        "tone": "green"
      },
      {
        "label": "活跃案件",
        "value": "2 笔",
        "note": "1 笔已升级",
        "tone": "purple"
      }
    ],
    "agingRows": [],
    "dunningCases": [],
    "dunningActions": [],
    "dunningRecipients": [],
    "dunningRecipientsLoading": false,
    "dunningRecipientsError": "",
    "policyForm": {
      "name": "逾期升级提醒",
      "aging_from_days": 1,
      "aging_to_days": 30,
      "action_type": "REMIND",
      "recipient_rule": "USER:",
      "channel": "LOCAL",
      "repeat_interval_days": 7,
      "priority": "NORMAL"
    }
  },
  "populated": {
    "saving": false,
    "exportJob": {
      "id": "E1",
      "status": "READY",
      "report_type": "AGING_RECEIVABLES_CSV"
    },
    "dunningOverview": {
      "uncovered_overdue_count": 2
    },
    "dunningCoverage": {
      "policies": [],
      "gaps": [
        {
          "from_days": 31,
          "to_days": 60,
          "open_ended": false
        },
        {
          "from_days": 91,
          "to_days": 0,
          "open_ended": true
        }
      ]
    },
    "dunningKpis": [
      {
        "label": "逾期金额",
        "value": "CNY 12.5万",
        "note": "服务端全量逾期金额",
        "tone": "blue"
      },
      {
        "label": "逾期笔数",
        "value": "3 笔",
        "note": "含 90 天以上逾期",
        "tone": "orange"
      },
      {
        "label": "已产生提醒",
        "value": "7 次",
        "note": "2 条待跟进",
        "tone": "green"
      },
      {
        "label": "活跃案件",
        "value": "2 笔",
        "note": "1 笔已升级",
        "tone": "purple"
      }
    ],
    "agingRows": [
      {
        "label": "0–30 天 · CNY",
        "amount": "1000",
        "percent": 40,
        "count": 2,
        "bucket": "0-30",
        "currency": "CNY",
        "tone": "green"
      },
      {
        "label": "31–60 天 · CNY",
        "amount": "800",
        "percent": 32,
        "count": 1,
        "bucket": "31-60",
        "currency": "CNY",
        "tone": "blue"
      },
      {
        "label": "61–90 天 · CNY",
        "amount": "500",
        "percent": 20,
        "count": 1,
        "bucket": "61-90",
        "currency": "CNY",
        "tone": "orange"
      },
      {
        "label": "90 天以上 · CNY",
        "amount": "200",
        "percent": 8,
        "count": 1,
        "bucket": "90+",
        "currency": "CNY",
        "tone": "red"
      }
    ],
    "dunningCases": [
      {
        "id": "CASE-1",
        "receivable_no": "AR-001",
        "customer_name": "甲公司",
        "aging_days": 45,
        "open_amount": "800",
        "level": 2,
        "status": "ACTIVE",
        "next_action_at": "2026-11-01",
        "recipient_user_id": "u1"
      },
      {
        "id": "CASE-2",
        "receivable_no": "AR-002",
        "customer_name": "乙公司",
        "aging_days": 0,
        "open_amount": "0",
        "level": 0,
        "status": "CLOSED",
        "next_action_at": "",
        "recipient_user_id": ""
      }
    ],
    "dunningActions": [
      {
        "id": "ACT-1",
        "receivable_no": "AR-001",
        "channel": "LOCAL",
        "created_at": "2026-10-20 09:00",
        "recipient_user_id": "u1",
        "escalation_level": 2,
        "status": "PENDING",
        "completed_at": ""
      },
      {
        "id": "ACT-2",
        "receivable_no": "AR-001",
        "channel": "PLATFORM",
        "created_at": "2026-10-10 09:00",
        "recipient_user_id": "u1",
        "escalation_level": 1,
        "status": "COMPLETED",
        "completed_at": "2026-10-12 10:00"
      }
    ],
    "dunningRecipients": [
      {
        "user_id": "u1",
        "display_name": "张三",
        "username": "zhangsan"
      },
      {
        "id": "u2",
        "display_name": "李四"
      }
    ],
    "dunningRecipientsLoading": false,
    "dunningRecipientsError": "",
    "policyForm": {
      "name": "逾期 31–60 天销售跟进",
      "aging_from_days": 31,
      "aging_to_days": 60,
      "action_type": "REMIND",
      "recipient_rule": "USER:u1",
      "channel": "PLATFORM",
      "repeat_interval_days": 3,
      "priority": "HIGH"
    }
  },
  "saving": {
    "saving": true,
    "exportJob": {
      "id": "E2",
      "status": "PENDING",
      "report_type": "AGING_RECEIVABLES_CSV"
    },
    "dunningOverview": {},
    "dunningCoverage": {
      "policies": [],
      "gaps": []
    },
    "dunningKpis": [
      {
        "label": "逾期金额",
        "value": "CNY 12.5万",
        "note": "服务端全量逾期金额",
        "tone": "blue"
      },
      {
        "label": "逾期笔数",
        "value": "3 笔",
        "note": "含 90 天以上逾期",
        "tone": "orange"
      },
      {
        "label": "已产生提醒",
        "value": "7 次",
        "note": "2 条待跟进",
        "tone": "green"
      },
      {
        "label": "活跃案件",
        "value": "2 笔",
        "note": "1 笔已升级",
        "tone": "purple"
      }
    ],
    "agingRows": [],
    "dunningCases": [],
    "dunningActions": [
      {
        "id": "ACT-3",
        "receivable_no": "AR-003",
        "channel": "LOCAL",
        "created_at": "2026-10-21 09:00",
        "recipient_user_id": "u1",
        "escalation_level": 1,
        "status": "PENDING",
        "completed_at": ""
      }
    ],
    "dunningRecipients": [],
    "dunningRecipientsLoading": true,
    "dunningRecipientsError": "",
    "policyForm": {
      "name": "逾期升级提醒",
      "aging_from_days": 1,
      "aging_to_days": 30,
      "action_type": "REMIND",
      "recipient_rule": "USER:",
      "channel": "LOCAL",
      "repeat_interval_days": 7,
      "priority": "NORMAL"
    }
  },
  "recipientsError": {
    "saving": false,
    "exportJob": null,
    "dunningOverview": {},
    "dunningCoverage": {
      "policies": [],
      "gaps": []
    },
    "dunningKpis": [
      {
        "label": "逾期金额",
        "value": "CNY 12.5万",
        "note": "服务端全量逾期金额",
        "tone": "blue"
      },
      {
        "label": "逾期笔数",
        "value": "3 笔",
        "note": "含 90 天以上逾期",
        "tone": "orange"
      },
      {
        "label": "已产生提醒",
        "value": "7 次",
        "note": "2 条待跟进",
        "tone": "green"
      },
      {
        "label": "活跃案件",
        "value": "2 笔",
        "note": "1 笔已升级",
        "tone": "purple"
      }
    ],
    "agingRows": [],
    "dunningCases": [],
    "dunningActions": [],
    "dunningRecipients": [],
    "dunningRecipientsLoading": false,
    "dunningRecipientsError": "基础平台人员目录暂不可用。",
    "policyForm": {
      "name": "逾期升级提醒",
      "aging_from_days": 1,
      "aging_to_days": 30,
      "action_type": "REMIND",
      "recipient_rule": "USER:",
      "channel": "LOCAL",
      "repeat_interval_days": 7,
      "priority": "NORMAL"
    }
  }
}
const canComplete = (item) => item.status === 'PENDING'

const component = await loadSfc(new URL('./DunningCenterPanel.vue', import.meta.url).pathname)
const render = (name) => renderToString(Vue.createSSRApp({ render: () => Vue.h(component, { can: () => true, ...CASES[name], canCompleteDunningAction: canComplete }) }))

test('催收面板复现提取前 golden：空数据（导出按钮、空表行、默认策略表单）', async () => {
  assert.equal(await render('empty'), GOLDENS.empty)
})

test('催收面板复现提取前 golden：满数据（下载账龄表、覆盖巡检缺口、案件/动作/完成跟进按钮、人员选项与已填表单）', async () => {
  assert.equal(await render('populated'), GOLDENS.populated)
})

test('催收面板复现提取前 golden：保存中（生成账龄表中…、按钮禁用、人员读取中）', async () => {
  assert.equal(await render('saving'), GOLDENS.saving)
})

test('催收面板复现提取前 golden：人员目录加载失败（错误文案 + 重新加载）', async () => {
  assert.equal(await render('recipientsError'), GOLDENS.recipientsError)
})

test('催收面板以事件与父级交互，收件人账号 USER: 前缀联动随表单迁入（SSR 不渲染 select 选中态，故以源码锁定）', () => {
  const source = readFileSync(new URL('./DunningCenterPanel.vue', import.meta.url), 'utf8')
  for (const emit of ["$emit('download-export', exportJob.id)", "$emit('export-aging')", "$emit('complete-action', item)", "$emit('submit-policy')"]) {
    assert.ok(source.includes(emit), emit)
  }
  assert.equal(source.split("$emit('reload')").length - 1, 2, '刷新按钮与"重新加载"各自发出 reload')
  assert.match(source, /get: \(\) => props\.policyForm\.recipient_rule\.replace\(\/\^USER:\/, ''\)/)
  assert.match(source, /props\.policyForm\.recipient_rule = `USER:\$\{String\(value \|\| ''\)\.trim\(\)\}`/)
  assert.match(source, /v-model="policyRecipientAccount"/)
  assert.doesNotMatch(source, /agingBuckets|window\.prompt|active ===/)
})

// 角色补齐改变写动作边界，显式拒绝能力时即使弹层模型已打开也必须隐藏写入口。
test('DunningCenterPanel：权限撤销后关闭写表单及操作入口', async () => {
  const html = await renderToString(Vue.createSSRApp({ render: () => Vue.h(component,
    { ...CASES['populated'], can: () => false, canCompleteDunningAction: () => false }) }))
  assert.doesNotMatch(html, /settlement-policy-form|导出账龄表|下载账龄表/)
})
