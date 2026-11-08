import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build, transform } from 'esbuild'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer } from 'vue'

const require = createRequire(import.meta.url)
let fixtureSequence = 0

// 用途：挂载实际 SFC 的 setup，使用真实 Vue 生命周期，仅替换外部模块边界。
// 参数：filename 为组件路径；dependencies 为模块替身映射；props 为实际组件入参。
// 返回值：原始响应式状态及卸载方法；不包含浏览器 DOM 验证。
export async function mountSFC(filename, dependencies = {}, props = {}) {
  const key = `__sfcFixture${++fixtureSequence}`
  globalThis[key] = dependencies
  try {
    const result = await build({ entryPoints: [filename], bundle: true, write: false,
      platform: 'node', format: 'cjs', external: ['vue'], logLevel: 'silent',
      alias: { '@': resolve(dirname(new URL(import.meta.url).pathname), '../../') },
      plugins: [{ name: 'actual-sfc-setup',
        // 用途：编译实际 setup，并仅在明确指定的接口边界替换依赖。
        // 参数：builder 为当前 esbuild 插件注册接口。
        // 返回值：无。
        setup(builder) {
        builder.onLoad({ filter: /\.(js|mjs)$/ }, ({ path }) => {
          const dependency = dependencies[path]
          if (!dependency) return
          return { contents: Object.keys(dependency).map(name =>
            `export const ${name}=globalThis[${JSON.stringify(key)}][${JSON.stringify(path)}][${JSON.stringify(name)}]`
          ).join('\n'), loader: 'js' }
        })
        builder.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
          const { descriptor } = parse(readFileSync(path, 'utf8'), { filename: path })
          // 组件可写成 `<script setup lang="ts">`：compileScript 只展开宏、不擦除类型标注，
          // 因此先用 esbuild 把编译产物降级成 JS，再交给 js loader 打包。
          const { code } = await transform(compileScript(descriptor, { id: key }).content, { loader: 'ts' })
          return { contents: code, loader: 'js', resolveDir: dirname(path) }
        })
      } }],
    })
    const module = { exports: {} }
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports)
    const component = module.exports.default
    let state
    const originalSetup = component.setup
    component.setup = (props, context) => {
      state = originalSetup(props, context)
      return () => null
    }
    const renderer = createRenderer({
      createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null,
      nextSibling: () => null, createElement: () => ({}), createText: () => ({}),
      setText() {}, setElementText() {}, patchProp() {},
    })
    const app = renderer.createApp(component, props)
    app.mount({})
    return { state, unmount: () => app.unmount() }
  } finally {
    delete globalThis[key]
  }
}
