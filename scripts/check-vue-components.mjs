import { readdir, readFile } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse, compileScript, compileTemplate } from 'vue/compiler-sfc'

// 用途：检查单个 SFC 的脚本、模板及声明语法，作为构建之外的独立门禁。
// 参数：source 为组件源码；filename 为错误定位使用的文件路径。
// 返回值：诊断文本列表；这是编译检查，不替代 TypeScript 类型检查。
export function checkVueComponent(source, filename) {
  const { descriptor, errors } = parse(source, { filename })
  const messages = errors.map(error => String(error.message || error))
  if (messages.length) return messages
  try {
    const script = descriptor.scriptSetup || descriptor.script
      ? compileScript(descriptor, { id: 'component-check' }) : null
    if (descriptor.template) {
      const template = compileTemplate({ source: descriptor.template.content, filename,
        id: 'component-check', compilerOptions: { bindingMetadata: script?.bindings || {} } })
      messages.push(...template.errors.map(error => String(error.message || error)))
    }
  } catch (error) { messages.push(error.message) }
  return messages
}

// 用途：发现指定源码目录内的 Vue 组件，排除隐藏目录与生成产物。
// 参数：directory 为扫描根目录。
// 返回值：组件绝对路径列表。
async function componentsIn(directory) {
  const paths = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || ['node_modules', 'dist', 'coverage'].includes(entry.name)) continue
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) paths.push(...await componentsIn(path))
    else if (entry.name.endsWith('.vue')) paths.push(path)
  }
  return paths.sort()
}

// 用途：运行指定范围的组件编译门禁，空扫描和任何诊断均失败关闭。
// 参数：directory 为源码目录；report 为诊断输出函数。
// 返回值：检查数和错误数；文件读取错误直接抛出。
export async function checkVueDirectory(directory, report = console.error) {
  const files = await componentsIn(directory)
  let errors = 0
  for (const filename of files) {
    for (const message of checkVueComponent(await readFile(filename, 'utf8'), filename)) {
      report(`${relative(process.cwd(), filename)}: ${message}`)
      errors += 1
    }
  }
  if (!files.length) { report('未发现 Vue 组件，拒绝空检查通过。'); errors += 1 }
  return { components: files.length, errors }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await checkVueDirectory(resolve(process.argv[2] || 'src/modules'))
  console.log(JSON.stringify(result))
  process.exitCode = result.errors ? 1 : 0
}
