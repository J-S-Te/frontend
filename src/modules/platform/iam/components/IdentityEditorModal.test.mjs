import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as Vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'

const SRC = new URL('../../../../', import.meta.url).pathname

async function resolveDependency(fromFile, specifier) {
  if (specifier === 'vue') return Vue
  const base = specifier.startsWith('.')
    ? resolve(dirname(fromFile), specifier)
    : join(SRC, specifier.slice(2))
  if (specifier.endsWith('.vue')) return loadSfc(base)
  for (const candidate of [base, `${base}.js`, join(base, 'index.js')]) {
    try {
      return await import(pathToFileURL(candidate).href)
    } catch (error) {
      if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error
    }
  }
  throw new Error(`cannot resolve ${specifier} from ${fromFile}`)
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
    .replace(/^import\s+['"][^'"]+['"]\n?/gm, '')
    .replace('export default', 'return'))(...Object.values(imports))
  component.render = new Function('Vue', compiled.code
    .replace(/import \{([^}]+)\} from "vue"/g, (_, names) => `const { ${names.replace(/ as /g, ': ')} } = Vue`)
    .replace('export function render', 'return function render'))(Vue)
  return component
}

async function renderComponent(component, props) {
  return renderToString(Vue.createSSRApp({ render: () => Vue.h(component, props) }))
}

// golden 为提取前 IamSettingsModule.vue 统一编辑弹窗片段的 SSR 渲染结果（批次 2 第三步采集）。
const GOLDENS = {
  "user": "<div class=\"iam-modal-backdrop\" role=\"presentation\"><section class=\"iam-modal iam-editor-modal\" role=\"dialog\" aria-modal=\"true\" aria-label=\"新增身份授权配置\"><header><div><p>新增</p><h3>新增 User</h3></div><button class=\"console-modal-close\" type=\"button\" aria-label=\"关闭表单\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg></button></header><form class=\"iam-editor-form\"><!--v-if--><!--v-if--><!--[--><p class=\"iam-form-alert\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M11 10h2v7h-2v-7Zm1-7a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 16a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm-1-11V6h2v2h-2Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>员工编号由后端自动生成；本次会同时创建该用户的本地登录账号。</p><label><span>展示姓名 *</span><input required maxlength=\"100\" placeholder=\"例如：张三\" value=\"Zhang San\"></label><label><span>邮箱</span><input type=\"email\" placeholder=\"例如：zhang.san@example.com\" maxlength=\"320\" value=\"zhang.san@example.com\"></label><label><span>手机号</span><input maxlength=\"32\" placeholder=\"例如：13800000000\" value=\"13800000000\"></label><label><span>状态</span><select><option value=\"ACTIVE\">启用</option><option value=\"DISABLED\">停用</option></select></label><label><span>登录账号 *</span><input required minlength=\"3\" maxlength=\"64\" placeholder=\"例如：zhang.san\" value=\"zhang.san\"><small class=\"iam-field-help\">账号必须唯一，以字母或数字开头。</small></label><label><span>初始密码 *</span><div class=\"iam-password-field\"><input type=\"password\" required minlength=\"8\" maxlength=\"128\" autocomplete=\"new-password\" value=\"Fixture-Only-1a!\"><button type=\"button\" aria-label=\"显示密码\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M11 10h2v7h-2v-7Zm1-7a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 16a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm-1-11V6h2v2h-2Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg></button></div></label><label><span>账号有效期 *</span><select><option value=\"TEMPORARY\">临时（默认 1 天）</option><option value=\"PERMANENT\">永久</option></select></label><label><span>有效截止时间 *</span><input required type=\"datetime-local\" value=\"2026-10-26T09:00\"></label><!--]--><p class=\"iam-form-alert\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M11 10h2v7h-2v-7Zm1-7a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 16a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm-1-11V6h2v2h-2Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>提交后由 Go API 写入 MySQL，并生成审计事件。</p><footer><button class=\"console-button ghost\" type=\"button\">取消</button><button class=\"console-button primary\" type=\"submit\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m9.2 16.6-4-4 1.4-1.4 2.6 2.6 8.2-8.2L18.8 7l-9.6 9.6Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>保存</button></footer></form></section></div>",
  "user-password-visible": "<div class=\"iam-modal-backdrop\" role=\"presentation\"><section class=\"iam-modal iam-editor-modal\" role=\"dialog\" aria-modal=\"true\" aria-label=\"新增身份授权配置\"><header><div><p>新增</p><h3>新增 User</h3></div><button class=\"console-modal-close\" type=\"button\" aria-label=\"关闭表单\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg></button></header><form class=\"iam-editor-form\"><!--v-if--><!--v-if--><!--[--><p class=\"iam-form-alert\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M11 10h2v7h-2v-7Zm1-7a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 16a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm-1-11V6h2v2h-2Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>员工编号由后端自动生成；本次会同时创建该用户的本地登录账号。</p><label><span>展示姓名 *</span><input required maxlength=\"100\" placeholder=\"例如：张三\" value=\"Zhang San\"></label><label><span>邮箱</span><input type=\"email\" placeholder=\"例如：zhang.san@example.com\" maxlength=\"320\" value=\"zhang.san@example.com\"></label><label><span>手机号</span><input maxlength=\"32\" placeholder=\"例如：13800000000\" value=\"13800000000\"></label><label><span>状态</span><select><option value=\"ACTIVE\">启用</option><option value=\"DISABLED\">停用</option></select></label><label><span>登录账号 *</span><input required minlength=\"3\" maxlength=\"64\" placeholder=\"例如：zhang.san\" value=\"zhang.san\"><small class=\"iam-field-help\">账号必须唯一，以字母或数字开头。</small></label><label><span>初始密码 *</span><div class=\"iam-password-field\"><input type=\"text\" required minlength=\"8\" maxlength=\"128\" autocomplete=\"new-password\" value=\"Fixture-Only-1a!\"><button type=\"button\" aria-label=\"隐藏密码\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M11 10h2v7h-2v-7Zm1-7a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 16a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm-1-11V6h2v2h-2Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg></button></div></label><label><span>账号有效期 *</span><select><option value=\"TEMPORARY\">临时（默认 1 天）</option><option value=\"PERMANENT\">永久</option></select></label><label><span>有效截止时间 *</span><input required type=\"datetime-local\" value=\"2026-10-26T09:00\"></label><!--]--><p class=\"iam-form-alert\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M11 10h2v7h-2v-7Zm1-7a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 16a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm-1-11V6h2v2h-2Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>提交后由 Go API 写入 MySQL，并生成审计事件。</p><footer><button class=\"console-button ghost\" type=\"button\">取消</button><button class=\"console-button primary\" type=\"submit\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m9.2 16.6-4-4 1.4-1.4 2.6 2.6 8.2-8.2L18.8 7l-9.6 9.6Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>保存</button></footer></form></section></div>",
  "user-batch": "<div class=\"iam-modal-backdrop\" role=\"presentation\"><section class=\"iam-modal iam-editor-modal\" role=\"dialog\" aria-modal=\"true\" aria-label=\"新增身份授权配置\"><header><div><p>新增</p><h3>新增 Batch Users</h3></div><button class=\"console-modal-close\" type=\"button\" aria-label=\"关闭表单\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg></button></header><form class=\"iam-editor-form\"><!--v-if--><!--v-if--><!--[--><p class=\"iam-form-alert\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M11 10h2v7h-2v-7Zm1-7a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 16a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm-1-11V6h2v2h-2Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>每行一位用户，格式为“姓名,邮箱,手机号”；邮箱和手机号可留空，一次最多 100 位。批量创建仅建立用户档案；登录账号请在“登录账号”中按需创建。</p><label class=\"full\"><span>用户数据 *</span><textarea required rows=\"10\" placeholder=\"张三,zhang.san@example.com,13800000000\n李四,,13900000000\n王五\" maxlength=\"20000\">Zhang San,zhang.san@example.com,13800000000\nLi Si,,</textarea></label><label><span>统一状态</span><select><option value=\"ACTIVE\">启用</option><option value=\"DISABLED\">停用</option></select></label><p class=\"iam-field-help full\">员工编号由后端逐条自动生成，每位用户都会自动绑定“普通用户”角色。</p><!--]--><p class=\"iam-form-alert\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M11 10h2v7h-2v-7Zm1-7a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 16a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm-1-11V6h2v2h-2Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>提交后由 Go API 写入 MySQL，并生成审计事件。</p><footer><button class=\"console-button ghost\" type=\"button\">取消</button><button class=\"console-button primary\" type=\"submit\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m9.2 16.6-4-4 1.4-1.4 2.6 2.6 8.2-8.2L18.8 7l-9.6 9.6Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>保存</button></footer></form></section></div>",
  "account": "<div class=\"iam-modal-backdrop\" role=\"presentation\"><section class=\"iam-modal iam-editor-modal\" role=\"dialog\" aria-modal=\"true\" aria-label=\"新增身份授权配置\"><header><div><p>新增</p><h3>新增 Login Account</h3></div><button class=\"console-modal-close\" type=\"button\" aria-label=\"关闭表单\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg></button></header><form class=\"iam-editor-form\"><!--v-if--><!--v-if--><!--[--><div class=\"iam-account-editor-intro full\"><span><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 3v2h14V7H5Zm3 5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm4.2 4.5h5.3v-1.2c0-1.1-1.2-1.8-2.6-1.8s-2.7.7-2.7 1.8v1.2Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg></span><div><strong>创建本地登录账号</strong><p>账号将关联到一位平台用户。初始密码仅用于首次登录，请通过安全渠道交付。</p></div><small>01 / 03</small></div><label class=\"iam-account-field\"><span>账号 *</span><input required minlength=\"3\" maxlength=\"64\" placeholder=\"例如：zhang.san\" value=\"zhang.san\"><small class=\"iam-field-help\">3–64 个字符，以字母或数字开头，仅可使用字母、数字、点、下划线和连字符。</small></label><label class=\"iam-account-field\"><span>关联用户 *</span><select required><option value>请选择用户</option><!--[--><option value=\"user-1\">Zhang San（EMP-0001）</option><!--]--></select><small class=\"iam-field-help\">一个账号只关联一位用户，避免使用名称进行关联。</small></label><label class=\"iam-account-field\"><span>账号类型</span><input value=\"个人账号 / 本地密码\" disabled><small class=\"iam-field-help\">当前新增接口创建个人本地账号，使用账号名和密码登录。</small></label><label class=\"iam-account-field\"><span>初始密码 *</span><div class=\"iam-password-field\"><input id=\"initial-password\" required minlength=\"8\" maxlength=\"128\" type=\"password\" autocomplete=\"new-password\" placeholder=\"请妥善记录，将仅返回一次\" value=\"Fixture-Only-1a!\"><button class=\"iam-password-toggle\" type=\"button\" aria-label=\"显示初始密码\" title=\"显示密码\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12 5c-5 0-9.3 3-11 7 1.7 4 6 7 11 7s9.3-3 11-7c-1.7-4-6-7-11-7Zm0 12c-3.8 0-7.2-2-8.8-5C4.8 9 8.2 7 12 7s7.2 2 8.8 5c-1.6 3-5 5-8.8 5Zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm0 4a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z\"></path></svg></button></div><small class=\"iam-field-help\">8–128 个字符，不含空白，并同时包含大写字母、小写字母、数字和特殊字符。</small></label><div class=\"iam-validity-picker full\"><span>有效时间 *</span><div class=\"iam-validity-options\" role=\"radiogroup\" aria-label=\"账号有效时间\"><button type=\"button\" class=\"active\" role=\"radio\" aria-checked=\"true\"><strong>临时账号</strong><small>默认有效 1 天，可自定义截止时间</small></button><button type=\"button\" class=\"\" role=\"radio\" aria-checked=\"false\"><strong>永久账号</strong><small>长期有效，仍可随时停用</small></button></div></div><label class=\"full iam-account-expiry-field\"><span>有效截止时间 *</span><input type=\"datetime-local\" required value=\"2026-10-26T09:00\"><small class=\"iam-field-help\">到期后，账号将无法继续登录；请选择晚于当前时间的日期和时间。</small></label><!--]--><p class=\"iam-form-alert\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M11 10h2v7h-2v-7Zm1-7a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 16a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm-1-11V6h2v2h-2Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>提交后由 Go API 写入 MySQL，并生成审计事件。</p><footer><button class=\"console-button ghost\" type=\"button\">取消</button><button class=\"console-button primary\" type=\"submit\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m9.2 16.6-4-4 1.4-1.4 2.6 2.6 8.2-8.2L18.8 7l-9.6 9.6Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>保存</button></footer></form></section></div>",
  "organization": "<div class=\"iam-modal-backdrop\" role=\"presentation\"><section class=\"iam-modal iam-editor-modal\" role=\"dialog\" aria-modal=\"true\" aria-label=\"新增身份授权配置\"><header><div><p>编辑</p><h3>编辑 Organization</h3></div><button class=\"console-modal-close\" type=\"button\" aria-label=\"关闭表单\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg></button></header><form class=\"iam-editor-form\"><!--v-if--><!--v-if--><!--[--><label><span>组织名称 *</span><input required maxlength=\"100\" value=\"R&amp;D Center\"></label><label><span>组织编码</span><input value=\"提交后由系统自动生成\" disabled><small class=\"iam-field-help\">编码由后端统一生成，创建后可在组织列表和详情中查看。</small></label><label><span>上级组织（留空为根）</span><select><option value>无（根组织）</option><!--[--><option value=\"org-root-1\">ACME Group · ORG-ROOT</option><!--]--></select><small class=\"iam-field-help\">编辑时不会显示当前组织及其下级，避免形成循环层级。</small></label><label><span>显示顺序</span><input type=\"number\" min=\"0\" step=\"10\" value=\"20\"><small class=\"iam-field-help\">数字越小，在同一上级组织下越靠前；建议使用 10、20、30，便于后续插入。</small></label><!--]--><p class=\"iam-form-alert\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M11 10h2v7h-2v-7Zm1-7a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 16a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm-1-11V6h2v2h-2Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>提交后由 Go API 写入 MySQL，并生成审计事件。</p><footer><button class=\"console-button ghost\" type=\"button\">取消</button><button class=\"console-button primary\" type=\"submit\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m9.2 16.6-4-4 1.4-1.4 2.6 2.6 8.2-8.2L18.8 7l-9.6 9.6Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>保存</button></footer></form></section></div>",
  "position": "<div class=\"iam-modal-backdrop\" role=\"presentation\"><section class=\"iam-modal iam-editor-modal\" role=\"dialog\" aria-modal=\"true\" aria-label=\"新增身份授权配置\"><header><div><p>新增</p><h3>新增 Position</h3></div><button class=\"console-modal-close\" type=\"button\" aria-label=\"关闭表单\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg></button></header><form class=\"iam-editor-form\"><!--v-if--><!--v-if--><!--[--><label><span>所属组织 *</span><select required><option value>请选择组织</option><!--[--><option value=\"org-root-1\">ACME Group · ORG-ROOT</option><option value=\"org-child-1\">R&amp;D Center · ORG-RD</option><option value=\"org-leaf-1\">Frontend Team · ORG-RD-FE</option><!--]--></select></label><label><span>岗位编码</span><input value=\"提交后由系统自动生成\" disabled><small class=\"iam-field-help\">编码由后端统一生成，格式为 POS-&lt;ULID&gt;，创建后可在岗位列表和详情中查看。</small></label><label><span>岗位名称 *</span><input required placeholder=\"例如：研发经理\" maxlength=\"100\" value=\"R&amp;D Manager\"></label><!--]--><p class=\"iam-form-alert\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M11 10h2v7h-2v-7Zm1-7a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 16a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm-1-11V6h2v2h-2Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>提交后由 Go API 写入 MySQL，并生成审计事件。</p><footer><button class=\"console-button ghost\" type=\"button\">取消</button><button class=\"console-button primary\" type=\"submit\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m9.2 16.6-4-4 1.4-1.4 2.6 2.6 8.2-8.2L18.8 7l-9.6 9.6Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>保存</button></footer></form></section></div>",
  "membership": "<div class=\"iam-modal-backdrop\" role=\"presentation\"><section class=\"iam-modal iam-editor-modal\" role=\"dialog\" aria-modal=\"true\" aria-label=\"新增身份授权配置\"><header><div><p>新增</p><h3>新增 Membership</h3></div><button class=\"console-modal-close\" type=\"button\" aria-label=\"关闭表单\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg></button></header><form class=\"iam-editor-form\"><!--v-if--><!--v-if--><!--[--><label><span>用户 *</span><select required><option value>请选择用户</option><!--[--><option value=\"user-1\">Zhang San · EMP-0001</option><!--]--></select></label><label><span>组织 *</span><select required><option value>请选择组织</option><!--[--><option value=\"org-root-1\">ACME Group · 2 个岗位</option><!--]--></select><small class=\"iam-field-help\">系统会默认选择一个已有岗位的组织；切换组织后只能选择该组织下的岗位。</small></label><label><span>岗位 *</span><select required><option value>请选择岗位</option><!--[--><option value=\"position-1\">R&amp;D Manager</option><!--]--></select><!--v-if--></label><label><span>任职类型 *</span><select><option value=\"PRIMARY\">主组织</option><option value=\"SECONDARY\">次组织 / 兼岗</option></select></label><label><span>生效方式 *</span><select><option value=\"LONG_TERM\">长期生效</option><option value=\"SHORT_TERM\">短期生效</option></select><small class=\"iam-field-help\">长期任职不设置日期；短期任职必须填写完整起止日期。</small></label><label><span>生效日期 *</span><input required type=\"date\" value=\"2026-11-01\"></label><label><span>失效日期 *</span><input required type=\"date\" value=\"2027-10-31\"></label><label class=\"full iam-checkbox-field\"><input type=\"checkbox\" checked><span>参与岗位授权继承</span><small class=\"iam-field-help\">这是标准授权开关：开启后，该任职会动态继承岗位授权模板映射的应用角色；关闭不会影响用户详情中单独配置的个人例外。</small></label><p class=\"iam-form-alert\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M11 10h2v7h-2v-7Zm1-7a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 16a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm-1-11V6h2v2h-2Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>人员晋升、降职或调岗时，请保留原任职并新建此任职；有效岗位模板角色会自动重算。离职请在人员详情中停用人员，系统会同时撤销账号、任职和会话。</p><!--]--><p class=\"iam-form-alert\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M11 10h2v7h-2v-7Zm1-7a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 16a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm-1-11V6h2v2h-2Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>提交后由 Go API 写入 MySQL，并生成审计事件。</p><footer><button class=\"console-button ghost\" type=\"button\">取消</button><button class=\"console-button primary\" type=\"submit\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m9.2 16.6-4-4 1.4-1.4 2.6 2.6 8.2-8.2L18.8 7l-9.6 9.6Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>保存</button></footer></form></section></div>",
  "organization-references-degraded": "<div class=\"iam-modal-backdrop\" role=\"presentation\"><section class=\"iam-modal iam-editor-modal\" role=\"dialog\" aria-modal=\"true\" aria-label=\"新增身份授权配置\"><header><div><p>新增</p><h3>新增 Organization</h3></div><button class=\"console-modal-close\" type=\"button\" aria-label=\"关闭表单\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg></button></header><form class=\"iam-editor-form\"><p class=\"iam-form-alert full\" role=\"alert\">reference directory read failed, please retry <button class=\"console-button ghost small\" type=\"button\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M12 5V1L7 6l5 5V7c3.3 0 6 2.7 6 6 0 1-.3 2-.8 2.8l1.5 1.5A8 8 0 0 0 12 5Zm-6.7.7A8 8 0 0 0 12 21v-4c-3.3 0-6-2.7-6-6 0-1 .3-2 .8-2.8L5.3 5.7Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>重试读取</button></p><p class=\"iam-form-alert full\" role=\"alert\">previous organization selection was cleared</p><!--[--><label><span>组织名称 *</span><input required maxlength=\"100\" value></label><label><span>组织编码</span><input value=\"提交后由系统自动生成\" disabled><small class=\"iam-field-help\">编码由后端统一生成，创建后可在组织列表和详情中查看。</small></label><label><span>上级组织（留空为根）</span><select><option value>无（根组织）</option><!--[--><!--]--></select><small class=\"iam-field-help\">编辑时不会显示当前组织及其下级，避免形成循环层级。</small></label><label><span>显示顺序</span><input type=\"number\" min=\"0\" step=\"10\" value=\"0\"><small class=\"iam-field-help\">数字越小，在同一上级组织下越靠前；建议使用 10、20、30，便于后续插入。</small></label><!--]--><p class=\"iam-form-alert\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"M11 10h2v7h-2v-7Zm1-7a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 16a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm-1-11V6h2v2h-2Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>提交后由 Go API 写入 MySQL，并生成审计事件。</p><footer><button class=\"console-button ghost\" type=\"button\">取消</button><button class=\"console-button primary\" type=\"submit\"><svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><!--[--><path d=\"m9.2 16.6-4-4 1.4-1.4 2.6 2.6 8.2-8.2L18.8 7l-9.6 9.6Z\" stroke=\"none\" stroke-width=\"0\"></path><!--]--></svg>保存</button></footer></form></section></div>"
}
const CASES = {
  "user": {
    "editor": {
      "kind": "user",
      "label": "User"
    },
    "form": {
      "display_name": "Zhang San",
      "email": "zhang.san@example.com",
      "mobile": "13800000000",
      "status": "ACTIVE",
      "account_name": "zhang.san",
      "initial_password": "Fixture-Only-1a!",
      "validity_mode": "TEMPORARY",
      "valid_until": "2026-10-26T09:00"
    },
    "saving": false,
    "referencesLoading": false,
    "referencesError": "",
    "selectionNotice": "",
    "users": [],
    "organizations": [
      {
        "org_unit_id": "org-root-1",
        "id": "org-root-1",
        "name": "ACME Group",
        "code": "ORG-ROOT",
        "parent_id": "",
        "sort_order": 10,
        "status": "ACTIVE",
        "version": 1
      },
      {
        "org_unit_id": "org-child-1",
        "id": "org-child-1",
        "name": "R&D Center",
        "code": "ORG-RD",
        "parent_id": "org-root-1",
        "sort_order": 20,
        "status": "ACTIVE",
        "version": 2
      },
      {
        "org_unit_id": "org-leaf-1",
        "id": "org-leaf-1",
        "name": "Frontend Team",
        "code": "ORG-RD-FE",
        "parent_id": "org-child-1",
        "sort_order": 10,
        "status": "DISABLED",
        "version": 1
      }
    ],
    "parentOptions": [],
    "membershipOrganizations": [],
    "membershipPositions": []
  },
  "user-batch": {
    "editor": {
      "kind": "user-batch",
      "label": "Batch Users"
    },
    "form": {
      "rows": "Zhang San,zhang.san@example.com,13800000000\nLi Si,,",
      "status": "ACTIVE"
    },
    "saving": false,
    "referencesLoading": false,
    "referencesError": "",
    "selectionNotice": "",
    "users": [],
    "organizations": [
      {
        "org_unit_id": "org-root-1",
        "id": "org-root-1",
        "name": "ACME Group",
        "code": "ORG-ROOT",
        "parent_id": "",
        "sort_order": 10,
        "status": "ACTIVE",
        "version": 1
      },
      {
        "org_unit_id": "org-child-1",
        "id": "org-child-1",
        "name": "R&D Center",
        "code": "ORG-RD",
        "parent_id": "org-root-1",
        "sort_order": 20,
        "status": "ACTIVE",
        "version": 2
      },
      {
        "org_unit_id": "org-leaf-1",
        "id": "org-leaf-1",
        "name": "Frontend Team",
        "code": "ORG-RD-FE",
        "parent_id": "org-child-1",
        "sort_order": 10,
        "status": "DISABLED",
        "version": 1
      }
    ],
    "parentOptions": [],
    "membershipOrganizations": [],
    "membershipPositions": []
  },
  "account": {
    "editor": {
      "kind": "account",
      "label": "Login Account"
    },
    "form": {
      "account_name": "zhang.san",
      "user_id": "user-1",
      "initial_password": "Fixture-Only-1a!",
      "validity_mode": "TEMPORARY",
      "valid_until": "2026-10-26T09:00"
    },
    "saving": false,
    "referencesLoading": false,
    "referencesError": "",
    "selectionNotice": "",
    "users": [
      {
        "user_id": "user-1",
        "id": "user-1",
        "display_name": "Zhang San",
        "employee_no": "EMP-0001"
      }
    ],
    "organizations": [
      {
        "org_unit_id": "org-root-1",
        "id": "org-root-1",
        "name": "ACME Group",
        "code": "ORG-ROOT",
        "parent_id": "",
        "sort_order": 10,
        "status": "ACTIVE",
        "version": 1
      },
      {
        "org_unit_id": "org-child-1",
        "id": "org-child-1",
        "name": "R&D Center",
        "code": "ORG-RD",
        "parent_id": "org-root-1",
        "sort_order": 20,
        "status": "ACTIVE",
        "version": 2
      },
      {
        "org_unit_id": "org-leaf-1",
        "id": "org-leaf-1",
        "name": "Frontend Team",
        "code": "ORG-RD-FE",
        "parent_id": "org-child-1",
        "sort_order": 10,
        "status": "DISABLED",
        "version": 1
      }
    ],
    "parentOptions": [],
    "membershipOrganizations": [],
    "membershipPositions": []
  },
  "organization": {
    "editor": {
      "kind": "organization",
      "label": "Organization",
      "mode": "edit",
      "orgUnitId": "org-child-1",
      "version": 2
    },
    "form": {
      "name": "R&D Center",
      "parent_id": "org-root-1",
      "sort_order": 20,
      "status": "ACTIVE"
    },
    "saving": false,
    "referencesLoading": false,
    "referencesError": "",
    "selectionNotice": "",
    "users": [],
    "organizations": [
      {
        "org_unit_id": "org-root-1",
        "id": "org-root-1",
        "name": "ACME Group",
        "code": "ORG-ROOT",
        "parent_id": "",
        "sort_order": 10,
        "status": "ACTIVE",
        "version": 1
      },
      {
        "org_unit_id": "org-child-1",
        "id": "org-child-1",
        "name": "R&D Center",
        "code": "ORG-RD",
        "parent_id": "org-root-1",
        "sort_order": 20,
        "status": "ACTIVE",
        "version": 2
      },
      {
        "org_unit_id": "org-leaf-1",
        "id": "org-leaf-1",
        "name": "Frontend Team",
        "code": "ORG-RD-FE",
        "parent_id": "org-child-1",
        "sort_order": 10,
        "status": "DISABLED",
        "version": 1
      }
    ],
    "parentOptions": [
      {
        "org_unit_id": "org-root-1",
        "id": "org-root-1",
        "name": "ACME Group",
        "code": "ORG-ROOT",
        "parent_id": "",
        "sort_order": 10,
        "status": "ACTIVE",
        "version": 1
      }
    ],
    "membershipOrganizations": [],
    "membershipPositions": []
  },
  "position": {
    "editor": {
      "kind": "position",
      "label": "Position"
    },
    "form": {
      "org_unit_id": "org-root-1",
      "name": "R&D Manager"
    },
    "saving": false,
    "referencesLoading": false,
    "referencesError": "",
    "selectionNotice": "",
    "users": [],
    "organizations": [
      {
        "org_unit_id": "org-root-1",
        "id": "org-root-1",
        "name": "ACME Group",
        "code": "ORG-ROOT",
        "parent_id": "",
        "sort_order": 10,
        "status": "ACTIVE",
        "version": 1
      },
      {
        "org_unit_id": "org-child-1",
        "id": "org-child-1",
        "name": "R&D Center",
        "code": "ORG-RD",
        "parent_id": "org-root-1",
        "sort_order": 20,
        "status": "ACTIVE",
        "version": 2
      },
      {
        "org_unit_id": "org-leaf-1",
        "id": "org-leaf-1",
        "name": "Frontend Team",
        "code": "ORG-RD-FE",
        "parent_id": "org-child-1",
        "sort_order": 10,
        "status": "DISABLED",
        "version": 1
      }
    ],
    "parentOptions": [],
    "membershipOrganizations": [],
    "membershipPositions": []
  },
  "membership": {
    "editor": {
      "kind": "membership",
      "label": "Membership"
    },
    "form": {
      "user_id": "user-1",
      "org_unit_id": "org-root-1",
      "position_id": "position-1",
      "membership_type": "SECONDARY",
      "validity_mode": "SHORT_TERM",
      "effective_from": "2026-11-01",
      "effective_to": "2027-10-31",
      "inherit_authorization": true
    },
    "saving": false,
    "referencesLoading": false,
    "referencesError": "",
    "selectionNotice": "",
    "users": [
      {
        "user_id": "user-1",
        "id": "user-1",
        "display_name": "Zhang San",
        "employee_no": "EMP-0001"
      }
    ],
    "organizations": [
      {
        "org_unit_id": "org-root-1",
        "id": "org-root-1",
        "name": "ACME Group",
        "code": "ORG-ROOT",
        "parent_id": "",
        "sort_order": 10,
        "status": "ACTIVE",
        "version": 1
      },
      {
        "org_unit_id": "org-child-1",
        "id": "org-child-1",
        "name": "R&D Center",
        "code": "ORG-RD",
        "parent_id": "org-root-1",
        "sort_order": 20,
        "status": "ACTIVE",
        "version": 2
      },
      {
        "org_unit_id": "org-leaf-1",
        "id": "org-leaf-1",
        "name": "Frontend Team",
        "code": "ORG-RD-FE",
        "parent_id": "org-child-1",
        "sort_order": 10,
        "status": "DISABLED",
        "version": 1
      }
    ],
    "parentOptions": [],
    "membershipOrganizations": [
      {
        "org_unit_id": "org-root-1",
        "id": "org-root-1",
        "name": "ACME Group",
        "position_count": 2
      }
    ],
    "membershipPositions": [
      {
        "position_id": "position-1",
        "id": "position-1",
        "name": "R&D Manager"
      }
    ]
  },
  "organization-references-degraded": {
    "editor": {
      "kind": "organization",
      "label": "Organization"
    },
    "form": {
      "name": "",
      "parent_id": "",
      "sort_order": 0,
      "status": "ACTIVE"
    },
    "saving": false,
    "referencesLoading": false,
    "referencesError": "reference directory read failed, please retry",
    "selectionNotice": "previous organization selection was cleared",
    "users": [],
    "organizations": [
      {
        "org_unit_id": "org-root-1",
        "id": "org-root-1",
        "name": "ACME Group",
        "code": "ORG-ROOT",
        "parent_id": "",
        "sort_order": 10,
        "status": "ACTIVE",
        "version": 1
      },
      {
        "org_unit_id": "org-child-1",
        "id": "org-child-1",
        "name": "R&D Center",
        "code": "ORG-RD",
        "parent_id": "org-root-1",
        "sort_order": 20,
        "status": "ACTIVE",
        "version": 2
      },
      {
        "org_unit_id": "org-leaf-1",
        "id": "org-leaf-1",
        "name": "Frontend Team",
        "code": "ORG-RD-FE",
        "parent_id": "org-child-1",
        "sort_order": 10,
        "status": "DISABLED",
        "version": 1
      }
    ],
    "parentOptions": [],
    "membershipOrganizations": [],
    "membershipPositions": []
  }
}
const USER_CASE = {
  "editor": {
    "kind": "user",
    "label": "User"
  },
  "form": {
    "display_name": "Zhang San",
    "email": "zhang.san@example.com",
    "mobile": "13800000000",
    "status": "ACTIVE",
    "account_name": "zhang.san",
    "initial_password": "Fixture-Only-1a!",
    "validity_mode": "TEMPORARY",
    "valid_until": "2026-10-26T09:00"
  },
  "saving": false,
  "referencesLoading": false,
  "referencesError": "",
  "selectionNotice": "",
  "users": [],
  "organizations": [
    {
      "org_unit_id": "org-root-1",
      "id": "org-root-1",
      "name": "ACME Group",
      "code": "ORG-ROOT",
      "parent_id": "",
      "sort_order": 10,
      "status": "ACTIVE",
      "version": 1
    },
    {
      "org_unit_id": "org-child-1",
      "id": "org-child-1",
      "name": "R&D Center",
      "code": "ORG-RD",
      "parent_id": "org-root-1",
      "sort_order": 20,
      "status": "ACTIVE",
      "version": 2
    },
    {
      "org_unit_id": "org-leaf-1",
      "id": "org-leaf-1",
      "name": "Frontend Team",
      "code": "ORG-RD-FE",
      "parent_id": "org-child-1",
      "sort_order": 10,
      "status": "DISABLED",
      "version": 1
    }
  ],
  "parentOptions": [],
  "membershipOrganizations": [],
  "membershipPositions": []
}

const component = await loadSfc(new URL('./IdentityEditorModal.vue', import.meta.url).pathname)

test('编辑弹窗复现提取前 golden：user', async () => {
  const html = await renderComponent(component, CASES["user"])
  assert.equal(html, GOLDENS["user"])
})

test('编辑弹窗复现提取前 golden：user-batch', async () => {
  const html = await renderComponent(component, CASES["user-batch"])
  assert.equal(html, GOLDENS["user-batch"])
})

test('编辑弹窗复现提取前 golden：account', async () => {
  const html = await renderComponent(component, CASES["account"])
  assert.equal(html, GOLDENS["account"])
})

test('编辑弹窗复现提取前 golden：organization', async () => {
  const html = await renderComponent(component, CASES["organization"])
  assert.equal(html, GOLDENS["organization"])
})

test('编辑弹窗复现提取前 golden：position', async () => {
  const html = await renderComponent(component, CASES["position"])
  assert.equal(html, GOLDENS["position"])
})

test('编辑弹窗复现提取前 golden：membership', async () => {
  const html = await renderComponent(component, CASES["membership"])
  assert.equal(html, GOLDENS["membership"])
})

test('编辑弹窗复现提取前 golden：organization-references-degraded', async () => {
  const html = await renderComponent(component, CASES["organization-references-degraded"])
  assert.equal(html, GOLDENS["organization-references-degraded"])
})

test('编辑弹窗复现提取前 golden：初始密码可见态', async () => {
  const state = component.setup(USER_CASE, { expose: () => {}, emit: () => {}, slots: {}, attrs: {} })
  assert.equal(typeof state.initialPasswordVisible.value, 'boolean')
  state.initialPasswordVisible.value = true
  const variant = { ...component, setup: () => state }
  const html = await renderToString(Vue.createSSRApp({ render: () => Vue.h(variant, USER_CASE) }))
  assert.equal(html, GOLDENS['user-password-visible'])
})

test('编辑弹窗对外发出 close/save/reload-references 并暴露 formEl', async () => {
  const exposed = {}
  component.setup(CASES.organization, {
    expose: (keys) => Object.assign(exposed, keys),
    emit: () => {},
    slots: {},
    attrs: {},
  })
  assert.ok('formEl' in exposed, 'formEl must be exposed for useDialogFocusTrap')
  const modalSource = readFileSync(new URL('./IdentityEditorModal.vue', import.meta.url), 'utf8')
  for (const name of ['close', 'save', 'reload-references']) {
    assert.ok(modalSource.includes("emit('" + name), name)
  }
})
