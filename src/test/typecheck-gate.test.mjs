import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

// 类型门禁的「接线锁」：保证 `npm run typecheck` 这条门禁本身不会悄悄退化成空跑。
//
// 为什么需要它：`vue-tsc --noEmit` 在「一个文件都没扫到」和「代码真的干净」时退出码
// 都是 0。只跑 typecheck 无法区分这两种情况，于是这里把门禁的**覆盖范围**和
// **严格档位**都钉住：
//   · 三支共享组件必须还在 include 白名单里（覆盖范围只扩大不缩小）；
//   · strict / allowJs / checkJs / @ 别名 必须保持阶段 1 的口径；
//   · 组件里不得出现 @ts-ignore / @ts-nocheck / any 之类的退让写法；
//   · 负向夹具必须留在正向门禁之外（并带上三条契约的错误样例）。
// 这里只做静态接线断言，真正的类型检查由 `npm run typecheck` 负责。
const root = new URL('../../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const pkg = JSON.parse(read('package.json'))
// tsconfig 允许注释（JSONC）：去掉整行注释后再解析。
const readJsonc = (path) => JSON.parse(read(path).replace(/^\s*\/\/.*$/gm, ''))

const COMPONENTS = [
  'src/modules/shared/components/AsyncPanel.vue',
  'src/modules/shared/components/PaginationBar.vue',
  'src/modules/shared/components/ListState.vue',
]
const tsconfig = readJsonc('tsconfig.typecheck.json')
const negativeTsconfig = readJsonc('tsconfig.typecheck-negative.json')

test('typecheck 脚本使用 vue-tsc 且锁定独立 tsconfig；check:vue 保持全量 SFC 扫描', () => {
  assert.equal(pkg.scripts.typecheck, 'vue-tsc --noEmit -p tsconfig.typecheck.json')
  assert.equal(pkg.scripts['typecheck:negative'], 'node scripts/typecheck-negative.mjs')
  // check:vue 是编译门禁（全量 SFC），typecheck 是类型门禁（白名单），两者都不许被替换掉。
  assert.equal(pkg.scripts['check:vue'], 'node scripts/check-vue-components.mjs')
  assert.ok(existsSync(new URL('scripts/check-vue-components.mjs', root)))
  assert.ok(existsSync(new URL('scripts/typecheck-negative.mjs', root)))
})

test('类型依赖锁定精确版本，不随 ^ / ~ 漂移', () => {
  for (const [name, version] of [['typescript', '5.9.3'], ['vue-tsc', '3.3.14']]) {
    assert.equal(pkg.devDependencies[name], version, `${name} 必须锁定精确版本`)
  }
  // 阶段 1 不升级 Vue、不换构建体系：Vue 依赖仍是既有范围写法。
  assert.match(pkg.dependencies.vue, /^\^3\./, 'Vue 版本策略不得在类型门禁里被改动')
})

test('tsconfig.typecheck.json 保持阶段 1 的严格档位与 @ 别名', () => {
  assert.equal(tsconfig.compilerOptions.strict, true, 'strict 必须开启')
  assert.equal(tsconfig.compilerOptions.noImplicitOverride, true)
  assert.equal(tsconfig.compilerOptions.noImplicitReturns, true)
  assert.equal(tsconfig.compilerOptions.noFallthroughCasesInSwitch, true)
  assert.equal(tsconfig.compilerOptions.verbatimModuleSyntax, true)
  assert.deepEqual(tsconfig.compilerOptions.paths['@/*'], ['./src/*'], '@ 别名必须与 vite.config.js 一致')
  // allowJs 打开（组件引用的 JS 依赖要参与推断），但不全仓开启 JS 错误检查。
  assert.equal(tsconfig.compilerOptions.allowJs, true)
  assert.equal(tsconfig.compilerOptions.checkJs, false, '阶段 1 不对全仓 JS 报错')
  assert.equal(tsconfig.compilerOptions.noEmit, true)
})

test('覆盖范围：三支共享组件与正向夹具都在 typecheck 白名单里，负向夹具在门外', () => {
  for (const component of COMPONENTS) {
    assert.ok(tsconfig.include.includes(component), `${component} 不得被移出类型门禁（覆盖范围只扩大不缩小）`)
    assert.ok(existsSync(new URL(component, root)), `${component} 必须存在`)
  }
  assert.ok(tsconfig.include.includes('src/test/typecheck-positive.fixtures.ts'))
  // 负向夹具故意带类型错误，只能由 negative 配置检查。
  assert.ok(tsconfig.exclude.includes('src/test/typecheck-negative.fixtures.ts'))
  assert.ok(!tsconfig.include.some((entry) => /negative/.test(entry)), '负向夹具不得进入正向门禁')
})

test('三支组件以 TypeScript 声明契约：属性类型 / 事件参数 / 状态 / 加载器签名', () => {
  const sources = Object.fromEntries(COMPONENTS.map((path) => [path, read(path)]))
  for (const [path, source] of Object.entries(sources)) {
    assert.match(source, /^<script setup lang="ts">/m, `${path} 的 <script> 必须是 TypeScript`)
    assert.match(source, /defineProps\(/, `${path} 必须显式声明属性类型`)
  }

  // 分页条：属性用 PropType 收窄，事件载荷是数字。
  const pager = sources['src/modules/shared/components/PaginationBar.vue']
  assert.match(pager, /total: \{ type: Number as PropType<number \| null>, default: null \}/)
  assert.match(pager, /count: \{ type: Number as PropType<number \| null>, default: null \}/)
  assert.match(pager, /pageSizeOptions: \{ type: Array as PropType<number\[\] \| null>, default: null \}/)
  assert.match(pager, /hasMore: \{ type: Boolean as PropType<boolean \| null>, default: null \}/)
  assert.match(pager, /defineEmits<\{[\s\S]*?change: \[page: number\][\s\S]*?'change-page-size': \[size: number\][\s\S]*?\}>\(\)/)
  assert.match(pager, /function goTo\(target: PageTarget\): void/, '翻页出口必须声明入参类型')
  assert.match(pager, /function changePageSize\(event: Event\): void/, '页大小事件必须声明为 Event')

  // 三态闸门：loading 布尔、error 收敛到 string | Error、retry 事件无载荷。
  const listState = sources['src/modules/shared/components/ListState.vue']
  assert.match(listState, /loading: \{ type: Boolean, default: false \}/)
  assert.match(listState, /PropType<string \| Error>/, 'error 必须是 string | Error，不接受 any')
  assert.match(listState, /defineEmits<\{ retry: \[\] \}>\(\)/)
  assert.match(listState, /const hasError = \(\): boolean =>/)

  // 异步面板：加载器签名是显式类型别名，不是裸 Function。
  const asyncPanel = sources['src/modules/shared/components/AsyncPanel.vue']
  assert.match(asyncPanel, /type AsyncPanelLoader = \(\) => Promise<AsyncPanelModule>/)
  assert.match(asyncPanel, /loader: \{ type: Function as PropType<AsyncPanelLoader>, required: true \}/)
  assert.match(asyncPanel, /const panel: ShallowRef<Component \| null> = shallowRef\(null\)/)
})

test('组件里不得用 @ts-ignore / @ts-nocheck / any 之类写法凑绿', () => {
  for (const path of COMPONENTS) {
    const source = read(path)
    for (const banned of [/@ts-ignore/, /@ts-nocheck/, /@ts-expect-error/, /:\s*any\b/, /\bas any\b/, /<any>/, /defineProps<any>/, /defineEmits<any>/]) {
      assert.doesNotMatch(source, banned, `${path} 不得出现 ${banned}`)
    }
  }
})

test('负向夹具覆盖三类契约错误，并由独立配置检查', () => {
  const fixture = read('src/test/typecheck-negative.fixtures.ts')
  const markers = [...fixture.matchAll(/\[NEG-(\d)\]/g)].map((match) => match[0])
  assert.deepEqual(markers, ['[NEG-1]', '[NEG-2]', '[NEG-3]'], '三类错误各一条：分页属性 / 事件参数 / 加载器返回值')
  // 每条标记的下一行必须是对应的错误用法（scripts/typecheck-negative.mjs 按此定位行号）。
  assert.match(fixture, /\[NEG-1\][^\n]*\nexport const wrongPageType: PagerProps = \{ page: '第二页' \}/)
  assert.match(fixture, /\[NEG-2\][^\n]*\nexport const wrongChangePayload: void = emitPager\('change', '第二页'\)/)
  assert.match(fixture, /\[NEG-3\][^\n]*\nexport const wrongLoaderReturn: AsyncPanelLoader = async \(\) => 'not-a-component'/)

  assert.equal(negativeTsconfig.extends, './tsconfig.typecheck.json', '负向配置必须复用正向配置的严格档位')
  assert.deepEqual(negativeTsconfig.include, ['src/test/typecheck-negative.fixtures.ts'])
})

test('类型夹具不进生产构建：只存在于 src/test 且不被任何入口引用', () => {
  // 夹具目录不在 vite.config.js 的 rollup input 里，也不被业务模块 import。
  const vite = read('vite.config.js')
  assert.doesNotMatch(vite, /typecheck-(positive|negative)\.fixtures/, '构建入口不得引用类型夹具')
  for (const path of COMPONENTS) {
    assert.doesNotMatch(read(path), /typecheck-(positive|negative)\.fixtures/, `${path} 不得引用测试夹具`)
  }
})
