import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { escapeCsvCell } from '../platform/iam/utils/csvExport.js'

// F-03 回归：三处客户端 CSV 导出（合同台账、项目列表、检测类别域）必须复用平台的
// escapeCsvCell，而不是各自只做引号转义——自由文本以 = + - @ / TAB / CR 开头时，
// 导出文件在 Excel / LibreOffice 打开会被当作公式执行。

const contractView = await readFile(new URL('../contract_management/views/ContractManagementView.vue', import.meta.url), 'utf8')
const projectView = await readFile(new URL('../project_management/views/ProjectManagementView.vue', import.meta.url), 'utf8')
const projectDisplay = await readFile(new URL('../project_management/projectDisplay.js', import.meta.url), 'utf8')

/** 取出行号无关的函数体，用于断言具体导出入口的实现。 */
function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `缺少函数 ${name}`)
  const next = source.indexOf('\nfunction ', start + 1)
  const nextAsync = source.indexOf('\nasync function ', start + 1)
  const candidates = [next, nextAsync].filter((index) => index > start)
  const end = candidates.length ? Math.min(...candidates) : source.length
  return source.slice(start, end)
}

test('合同台账导出复用 escapeCsvCell 并保留中文表头/BOM/文件名/换行 [F-03 回归]', () => {
  assert.match(contractView, /import \{ escapeCsvCell \} from '@\/modules\/platform\/iam\/utils\/csvExport\.js'/)
  const body = functionBody(contractView, 'exportContracts')
  assert.match(body, /\.map\(\(row\) => row\.map\(escapeCsvCell\)\.join\(','\)\)/)
  assert.match(body, /'合同编号', '合同名称', '合同类型', '服务类型', '金额', '负责人姓名', '状态'/)
  assert.match(body, /\\ufeff\$\{csv\}/)
  assert.match(body, /anchor\.download = '合同台账\.csv'/)
  assert.match(body, /\.join\('\\n'\)/)
  assert.doesNotMatch(body, /replaceAll\('"', '""'\)/, '不得再各自实现只转义引号的单元格处理')
})

test('项目列表与检测类别域导出复用带公式防护的 csvCell [F-03 回归]', () => {
  assert.match(projectDisplay, /import \{ escapeCsvCell \} from '\.\.\/platform\/iam\/utils\/csvExport\.js'/)
  assert.match(projectDisplay, /export function csvCell\(value\) \{\s*return escapeCsvCell\(value\)/)
  assert.doesNotMatch(projectDisplay, /function csvCell\(value\) \{\s*const text = String\(value \?\? ''\)/)

  const projects = functionBody(projectView, 'exportProjects')
  assert.match(projects, /\.map\(\(row\) => row\.map\(csvCell\)\.join\(','\)\)/)
  assert.match(projects, /link\.download = '项目列表\.csv'/)
  assert.match(projects, /\\ufeff\$\{csv\}/)
  assert.doesNotMatch(projects, /replaceAll\('"', '""'\)/, '不得再各自实现只转义引号的单元格处理')

  const categories = functionBody(projectView, 'downloadDetectionCategories')
  assert.match(categories, /\.map\(csvCell\)\.join\(','\)/)
  assert.doesNotMatch(categories, /replaceAll\('"', '""'\)/, '不得再各自实现只转义引号的单元格处理')
})

test('统一转义函数对危险前缀与普通中文/数字的边界 [F-03 回归]', () => {
  for (const payload of ['=HYPERLINK("https://evil.example")', '+cmd', '-1+1', '@SUM(A1)', '\t=1+2', '\r=1+2']) {
    const cell = escapeCsvCell(payload)
    assert.ok(cell.startsWith("'") || cell.startsWith('"\''), `危险前缀必须被中和: ${payload} -> ${cell}`)
  }
  for (const safe of ['张三', '合同', '42', '-100', '3.14', '0']) {
    assert.equal(escapeCsvCell(safe), safe, `普通中文/数字必须保持原样: ${safe}`)
  }
})
