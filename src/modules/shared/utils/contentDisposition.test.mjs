import assert from 'node:assert/strict'
import test from 'node:test'

import { parseContentDispositionFilename, safeDownloadFilename } from './contentDisposition.js'

test('解析 ASCII filename 参数并去除引号', () => {
  assert.equal(
    parseContentDispositionFilename('attachment; filename="capabilities-20261015.csv"'),
    'capabilities-20261015.csv',
  )
  assert.equal(
    parseContentDispositionFilename('attachment; filename=plain.csv'),
    'plain.csv',
  )
})

test('解析 RFC 5987 UTF-8 filename* 中文名称', () => {
  assert.equal(
    parseContentDispositionFilename("attachment; filename*=UTF-8''%E8%83%BD%E5%8A%9B%E5%AF%BC%E5%87%BA.csv"),
    '能力导出.csv',
  )
  assert.equal(
    parseContentDispositionFilename("attachment; filename*=utf-8'zh-CN'%E9%AA%8C%E6%94%B6%E6%8A%A5%E5%91%8A.pdf"),
    '验收报告.pdf',
  )
})

test('filename 与 filename* 同时存在时始终优先 filename*，与出现顺序无关', () => {
  assert.equal(
    parseContentDispositionFilename("attachment; filename=\"plain.csv\"; filename*=UTF-8''%E4%B8%AD%E6%96%87.csv"),
    '中文.csv',
  )
  assert.equal(
    parseContentDispositionFilename("attachment; filename*=UTF-8''%E4%B8%AD%E6%96%87.csv; filename=\"plain.csv\""),
    '中文.csv',
  )
})

test('filename* 非法或不受支持的编码回退 filename，再回退 fallback', () => {
  assert.equal(
    parseContentDispositionFilename("attachment; filename*=UTF-8''%E4%B8%AD%ZZ; filename=\"fallback.csv\""),
    'fallback.csv',
  )
  assert.equal(
    parseContentDispositionFilename("attachment; filename*=iso-8859-1''caf%E9.pdf; filename=\"fallback.pdf\""),
    'fallback.pdf',
  )
  assert.equal(
    parseContentDispositionFilename("attachment; filename*=UTF-8''%E4%B8%AD%ZZ", 'fallback.csv'),
    'fallback.csv',
  )
})

test('清理路径分隔符、控制字符、零宽与双向控制符', () => {
  const parsed = parseContentDispositionFilename('attachment; filename="../../etc/\u0007passwd\u202E.csv"')
  assert.equal(parsed, '....etcpasswd.csv')
  assert.doesNotMatch(parsed, /[\\/\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e]/)
  assert.equal(parseContentDispositionFilename('attachment; filename="报告\u200b\u202e.pdf"'), '报告.pdf')
})

test('quoted-string 中的分号与转义引号按原义保留', () => {
  assert.equal(parseContentDispositionFilename('attachment; filename="a;b.csv"'), 'a;b.csv')
  assert.equal(parseContentDispositionFilename('attachment; filename="a\\"b.csv"'), 'a"b.csv')
})

test('空响应头或空文件名回退调用方提供的名称', () => {
  assert.equal(parseContentDispositionFilename('', 'customer-import-errors.csv'), 'customer-import-errors.csv')
  assert.equal(parseContentDispositionFilename(null, 'report.pdf'), 'report.pdf')
  assert.equal(parseContentDispositionFilename('attachment; filename=""', 'fallback.csv'), 'fallback.csv')
  assert.equal(parseContentDispositionFilename('attachment', ''), '')
})

test('文件名超过长度上限时按字符截断', () => {
  const parsed = parseContentDispositionFilename(`attachment; filename="${'a'.repeat(300)}.csv"`)
  assert.equal(Array.from(parsed).length, 180)
  assert.match(parsed, /^a{180}$/)
})

test('safeDownloadFilename 校验扩展名白名单并保留长文件名扩展名', () => {
  assert.equal(
    safeDownloadFilename("attachment; filename*=UTF-8''%E8%83%BD%E5%8A%9B.csv", 'fallback.csv', { extensions: ['.csv'] }),
    '能力.csv',
  )
  assert.equal(
    safeDownloadFilename('attachment; filename="report.pdf"', 'capabilities.csv', { extensions: ['.csv'] }),
    'capabilities.csv',
  )
  assert.equal(
    safeDownloadFilename('attachment; filename="report.pdf"', 'report.pdf', { extensions: ['pdf'] }),
    'report.pdf',
  )
  assert.equal(safeDownloadFilename('', 'report.pdf', { extensions: ['.pdf'] }), 'report.pdf')
  assert.equal(
    safeDownloadFilename(`attachment; filename="${'a'.repeat(40)}.csv"`, 'fallback.csv', { extensions: ['.csv'], maxLength: 20 }),
    `${'a'.repeat(16)}.csv`,
  )
  assert.equal(
    safeDownloadFilename('attachment; filename=".hidden.csv"', 'fallback.csv', { extensions: ['.csv'] }),
    'fallback.csv',
  )
})
