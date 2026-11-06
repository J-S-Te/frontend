#!/usr/bin/env node
/**
 * audit-design-tokens.mjs — 设计 token 硬编码计数门禁
 *
 * 扫描 src/ 下 .vue（仅 <style> 块）与 .css，统计三类硬编码：
 *   color    颜色字面量（#hex / rgb()/rgba()/hsl()/hsla() 且不含 var()）
 *   fontSize font-size 的 px/rem/em 字面量（不含 var()）
 *   zIndex   z-index 的数字字面量（不含 var()）
 *
 * 用法：
 *   node scripts/audit-design-tokens.mjs              比对基线，任一类增加 → exit 1
 *   node scripts/audit-design-tokens.mjs --json       机器可读输出（仍按门禁退出码）
 *   node scripts/audit-design-tokens.mjs --update     用当前工作树刷新基线
 *   node scripts/audit-design-tokens.mjs --top 20     按文件 Top N（默认 10）
 *   node scripts/audit-design-tokens.mjs --root <dir> 指定仓库根（默认脚本上一级）
 *
 * 口径见交付说明；自定义属性定义（--x: ...）不计入三类硬编码，只做信息统计。
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = join(SCRIPT_DIR, 'design-token-baseline.json');
const CLASSES = ['color', 'fontSize', 'zIndex'];
const CLASS_LABELS = { color: 'color', fontSize: 'font-size', zIndex: 'z-index' };

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.vite']);

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const opts = { json: false, update: false, top: 10, root: null, help: false, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--update') opts.update = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--quiet') opts.quiet = true;
    else if (arg === '--top') {
      const next = argv[i + 1];
      if (!next || !/^\d+$/.test(next)) fail(2, '--top 需要一个正整数');
      opts.top = Number(next);
      i += 1;
    } else if (arg.startsWith('--top=')) {
      const val = arg.slice('--top='.length);
      if (!/^\d+$/.test(val)) fail(2, '--top 需要一个正整数');
      opts.top = Number(val);
    } else if (arg === '--root') {
      const next = argv[i + 1];
      if (!next) fail(2, '--root 需要一个路径');
      opts.root = resolve(next);
      i += 1;
    } else if (arg.startsWith('--root=')) {
      opts.root = resolve(arg.slice('--root='.length));
    } else {
      fail(2, `未知参数：${arg}（用 --help 查看用法）`);
    }
  }
  return opts;
}

function fail(code, message) {
  process.stderr.write(`audit-design-tokens: ${message}\n`);
  process.exit(code);
}

const USAGE = [
  '用法：node scripts/audit-design-tokens.mjs [--json] [--update] [--top N] [--root DIR]',
  '',
  '  默认        扫描并比对 scripts/design-token-baseline.json，任一类增加 → exit 1',
  '  --json      输出 JSON（含 counts/modules/topFiles/gate），退出码语义不变',
  '  --update    用当前工作树重写基线',
  '  --top N     按文件 Top N，默认 10',
  '  --root DIR  指定仓库根（默认脚本所在目录的上一级）',
  '  --quiet     只输出结论与违规明细',
  '',
  '退出码：0 = 通过或已更新基线；1 = 超过基线；2 = 用法/环境错误',
].join('\n');

// ---------------------------------------------------------------- 文件收集

function walk(dir, out) {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue; // 跳过 .mimosa/.git 等工具目录
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(abs, out);
    } else if (entry.isFile() && /\.(vue|css)$/i.test(entry.name)) {
      out.push(abs);
    }
  }
  return out;
}

function toPosix(p) {
  return p.split('\\').join('/');
}

// ---------------------------------------------------------------- CSS 解析

/** 去掉 /* *\/ 注释，保留字符位置（换行保留，避免错位） */
function stripComments(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) return out;
      out += text.slice(i, end + 2).replace(/[^\n]/g, ' ');
      i = end + 2;
      continue;
    }
    out += text[i];
    i += 1;
  }
  return out;
}

/** 抽出单条声明 { property, value }；无法识别则返回 null */
function parseDeclaration(chunk) {
  const text = chunk.trim();
  if (!text) return null;
  const match = /^([-\w]+)\s*:\s*([\s\S]+)$/.exec(text);
  if (!match) return null; // 选择器/@规则/散落文本
  const value = match[2].replace(/!\s*important\s*$/i, '').trim();
  if (!value) return null;
  return { property: match[1].toLowerCase(), value };
}

/**
 * 轻量 CSS 扫描器：按 { } ; 切分，忽略字符串内部的标点，
 * 丢弃 { 之前的 prelude（选择器 / @media 条件），只保留声明。
 */
function collectDeclarations(css) {
  const declarations = [];
  let buf = '';
  let i = 0;
  const push = (chunk) => {
    const decl = parseDeclaration(chunk);
    if (decl) declarations.push(decl);
  };

  while (i < css.length) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < css.length) {
        if (css[j] === '\\') {
          j += 2;
          continue;
        }
        if (css[j] === ch) break;
        j += 1;
      }
      buf += css.slice(i, Math.min(j + 1, css.length));
      i = j + 1;
      continue;
    }
    if (ch === '{') {
      buf = ''; // prelude 丢弃
      i += 1;
      continue;
    }
    if (ch === '}') {
      push(buf);
      buf = '';
      i += 1;
      continue;
    }
    if (ch === ';') {
      push(buf);
      buf = '';
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  push(buf);
  return declarations;
}

const HEX_COLOR = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-f])/gi;
const FUNC_COLOR = /\b(rgba?|hsla?)\(([^)]*)\)/gi;
const FONT_SIZE_LITERAL = /(?:^|[\s,(])(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em)\b/i;
const Z_INDEX_NUMBER = /^-?\d+$/;

/** 颜色统计前剔除 url(...) 与字符串，避免 data-URI / content 误报 */
function scrubForColor(value) {
  return value
    .replace(/url\((?:[^()]|\([^()]*\))*\)/gi, ' ')
    .replace(/"(?:[^"\\]|\\.)*"/g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, ' ');
}

function countColors(rawValue) {
  const value = scrubForColor(rawValue);
  let count = 0;
  const hex = value.match(HEX_COLOR);
  if (hex) count += hex.length;
  FUNC_COLOR.lastIndex = 0;
  let match;
  while ((match = FUNC_COLOR.exec(value)) !== null) {
    if (/var\(/i.test(match[2])) continue; // rgb(var(--x)) 视为已 token 化
    count += 1;
  }
  return count;
}

function analyzeDeclarations(declarations) {
  const counts = { color: 0, fontSize: 0, zIndex: 0 };
  const infos = { tokenDefinitions: 0, tokenDefinitionsWithLiteral: 0 };
  for (const { property, value } of declarations) {
    if (property.startsWith('--')) {
      // 自定义属性定义：token 的合法落点，不计入硬编码
      infos.tokenDefinitions += 1;
      if (countColors(value) > 0 || FONT_SIZE_LITERAL.test(value) || Z_INDEX_NUMBER.test(value.trim())) {
        infos.tokenDefinitionsWithLiteral += 1;
      }
      continue;
    }
    counts.color += countColors(value);
    if (property === 'font-size' && !/var\(/i.test(value) && FONT_SIZE_LITERAL.test(value)) {
      counts.fontSize += 1;
    }
    if (property === 'z-index' && Z_INDEX_NUMBER.test(value.trim())) {
      counts.zIndex += 1;
    }
  }
  return { counts, infos };
}

function analyzeSource(filePath, text) {
  const isVue = /\.vue$/i.test(filePath);
  const blocks = [];
  if (isVue) {
    const styleTag = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
    let match;
    while ((match = styleTag.exec(text)) !== null) blocks.push(match[1]);
  } else {
    blocks.push(text);
  }
  const counts = { color: 0, fontSize: 0, zIndex: 0 };
  const infos = { tokenDefinitions: 0, tokenDefinitionsWithLiteral: 0 };
  for (const block of blocks) {
    const result = analyzeDeclarations(collectDeclarations(stripComments(block)));
    for (const key of CLASSES) counts[key] += result.counts[key];
    infos.tokenDefinitions += result.infos.tokenDefinitions;
    infos.tokenDefinitionsWithLiteral += result.infos.tokenDefinitionsWithLiteral;
  }
  return { counts, infos, styleBlocks: blocks.length };
}

// ---------------------------------------------------------------- 汇总

function moduleOf(relPath) {
  const match = /^src\/modules\/([^/]+)\//.exec(relPath);
  return match ? match[1] : '(src-root)';
}

function audit(rootDir) {
  const srcDir = join(rootDir, 'src');
  if (!existsSync(srcDir)) fail(2, `找不到源码目录：${srcDir}`);
  const files = walk(srcDir, []).map(toPosix);
  if (files.length === 0) fail(2, `在 ${toPosix(srcDir)} 下没有找到 .vue/.css 文件`);

  const perFile = {};
  const infos = { tokenDefinitions: 0, tokenDefinitionsWithLiteral: 0, styleBlocks: 0, vueFiles: 0, cssFiles: 0 };
  for (const abs of files) {
    const rel = toPosix(abs.slice(toPosix(rootDir).length + 1));
    const text = readFileSync(abs, 'utf8');
    const result = analyzeSource(abs, text);
    const total = CLASSES.reduce((sum, key) => sum + result.counts[key], 0);
    if (total > 0) perFile[rel] = result.counts;
    infos.tokenDefinitions += result.infos.tokenDefinitions;
    infos.tokenDefinitionsWithLiteral += result.infos.tokenDefinitionsWithLiteral;
    infos.styleBlocks += result.styleBlocks;
    if (/\.vue$/i.test(abs)) infos.vueFiles += 1;
    else infos.cssFiles += 1;
  }

  const totals = { color: 0, fontSize: 0, zIndex: 0 };
  const modules = new Map();
  for (const [rel, counts] of Object.entries(perFile)) {
    const mod = moduleOf(rel);
    if (!modules.has(mod)) modules.set(mod, { module: mod, files: 0, color: 0, fontSize: 0, zIndex: 0, total: 0 });
    const row = modules.get(mod);
    row.files += 1;
    for (const key of CLASSES) {
      totals[key] += counts[key];
      row[key] += counts[key];
      row.total += counts[key];
    }
  }

  const topFiles = Object.entries(perFile)
    .map(([file, counts]) => ({ file, ...counts, total: CLASSES.reduce((s, k) => s + counts[k], 0) }))
    .sort((a, b) => b.total - a.total || a.file.localeCompare(b.file));

  return {
    totals,
    total: CLASSES.reduce((sum, key) => sum + totals[key], 0),
    perFile,
    infos,
    filesScanned: files.length,
    modules: [...modules.values()].sort((a, b) => b.total - a.total || a.module.localeCompare(b.module)),
    topFiles,
  };
}

// ---------------------------------------------------------------- 基线

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) return null;
  try {
    const parsed = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    if (!parsed || parsed.version !== 1 || typeof parsed.files !== 'object') {
      fail(2, `基线格式不识别：${toPosix(BASELINE_PATH)}`);
    }
    return parsed;
  } catch (err) {
    fail(2, `基线无法解析：${err.message}`);
  }
}

function gitInfo(rootDir) {
  try {
    const run = (args) => execFileSync('git', args, { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return { branch: run(['rev-parse', '--abbrev-ref', 'HEAD']), commit: run(['rev-parse', '--short', 'HEAD']) };
  } catch {
    return { branch: null, commit: null };
  }
}

function buildBaseline(result, rootDir) {
  const files = {};
  for (const rel of Object.keys(result.perFile).sort()) {
    const counts = result.perFile[rel];
    files[rel] = { color: counts.color, fontSize: counts.fontSize, zIndex: counts.zIndex };
  }
  const git = gitInfo(rootDir);
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    generatedFrom: { branch: git.branch, commit: git.commit },
    source: 'src',
    scope: 'src/**/*.vue (仅 <style> 块) + src/**/*.css；不含 dist/build/node_modules/点目录',
    rule: '每个已登记文件的计数不得增加；三类总量不得增加（新文件计入总量）。--update 显式刷新。',
    classes: CLASSES,
    notes: [
      '只登记含硬编码的文件；0 计数的文件不入表，其新增由总量门禁兜住。',
      '自定义属性定义（--x: ...）不计入三类；它是 token 的合法落点。',
      '颜色口径：#hex 与不带 var() 的 rgb()/rgba()/hsl()/hsla() 均计数（含 #fff/#000）；transparent/currentColor/inherit 等关键字与具名色（white/black）不在本切片范围。',
    ],
    filesScanned: result.filesScanned,
    totals: { ...result.totals },
    files,
  };
}

function compare(baseline, result) {
  const violations = [];
  const newFiles = [];
  const removedFiles = [];

  if (!baseline) {
    return { pass: true, violations, newFiles, removedFiles, totals: null, missingBaseline: true };
  }

  for (const key of CLASSES) {
    const current = result.totals[key];
    const base = Number(baseline.totals?.[key] ?? 0);
    if (current > base) {
      violations.push({ class: key, kind: 'total', current, baseline: base, delta: current - base });
    }
  }

  for (const [file, counts] of Object.entries(result.perFile)) {
    const baseCounts = baseline.files?.[file];
    if (!baseCounts) {
      newFiles.push(file);
      continue;
    }
    for (const key of CLASSES) {
      const current = counts[key];
      const base = Number(baseCounts[key] ?? 0);
      if (current > base) {
        violations.push({ class: key, kind: 'file', file, current, baseline: base, delta: current - base });
      }
    }
  }

  for (const file of Object.keys(baseline.files ?? {})) {
    if (!result.perFile[file]) removedFiles.push(file);
  }

  return {
    pass: violations.length === 0,
    violations,
    newFiles: newFiles.sort(),
    removedFiles: removedFiles.sort(),
    totals: baseline.totals ?? null,
    missingBaseline: false,
  };
}

// ---------------------------------------------------------------- 输出

function pad(text, width) {
  const str = String(text);
  return str.length >= width ? str : ' '.repeat(width - str.length) + str;
}

function padRight(text, width) {
  const str = String(text);
  return str.length >= width ? str : str + ' '.repeat(width - str.length);
}

function formatNumber(value) {
  return Number(value).toLocaleString('en-US');
}

function printHuman(model) {
  const { result, baseline, comparison, opts } = model;
  const lines = [];

  if (!opts.quiet) {
    lines.push('设计 token 硬编码审计');
    lines.push(`  根目录  ${result.root}`);
    lines.push(`  扫描    ${result.filesScanned} 个文件（.vue ${result.infos.vueFiles} / .css ${result.infos.cssFiles}），<style> 块 ${result.infos.styleBlocks} 个`);
    lines.push(`  自定义属性定义 ${formatNumber(result.infos.tokenDefinitions)} 条（其中 ${formatNumber(result.infos.tokenDefinitionsWithLiteral)} 条含字面量），不计入门禁`);
    lines.push('');
  }

  lines.push('类别        当前      基线      差值');
  for (const key of CLASSES) {
    const current = result.totals[key];
    const base = baseline ? Number(baseline.totals?.[key] ?? 0) : null;
    const delta = base === null ? null : current - base;
    lines.push(`${padRight(CLASS_LABELS[key], 10)} ${pad(formatNumber(current), 8)}  ${pad(base === null ? '-' : formatNumber(base), 8)}  ${pad(delta === null ? '-' : `${delta > 0 ? '+' : ''}${formatNumber(delta)}`, 8)}`.trimEnd());
  }
  lines.push(`${padRight('合计', 10)} ${pad(formatNumber(result.total), 8)}  ${pad(baseline ? formatNumber(CLASSES.reduce((s, k) => s + Number(baseline.totals?.[k] ?? 0), 0)) : '-', 8)}`);
  lines.push('');

  if (!opts.quiet) {
    lines.push(`按模块汇总（仅统计有硬编码的文件，共 ${result.modules.length} 个模块）`);
    for (const row of result.modules) {
      lines.push(
        `  ${padRight(row.module, 22)} 文件 ${pad(row.files, 4)}  color ${pad(formatNumber(row.color), 6)}  font-size ${pad(formatNumber(row.fontSize), 6)}  z-index ${pad(formatNumber(row.zIndex), 5)}  合计 ${formatNumber(row.total)}`,
      );
    }
    lines.push('');
    lines.push(`硬编码最多的文件 Top ${Math.min(opts.top, result.topFiles.length)}`);
    result.topFiles.slice(0, opts.top).forEach((row, index) => {
      lines.push(
        `  ${pad(index + 1, 2)}. ${padRight(row.file, 62)}  color ${pad(formatNumber(row.color), 5)}  font-size ${pad(formatNumber(row.fontSize), 5)}  z-index ${pad(formatNumber(row.zIndex), 4)}  合计 ${formatNumber(row.total)}`,
      );
    });
    if (result.topFiles.length > opts.top) lines.push(`  … 其余 ${result.topFiles.length - opts.top} 个文件省略（--top N 调整）`);
    lines.push('');
  }

  if (comparison.missingBaseline) {
    lines.push('门禁：SKIP（基线不存在，用 --update 生成）');
  } else if (comparison.pass) {
    lines.push(`门禁：PASS（三类均未超过基线；新文件 ${comparison.newFiles.length} 个，已删除基线文件 ${comparison.removedFiles.length} 个）`);
  } else {
    lines.push('门禁：FAIL');
    for (const item of comparison.violations) {
      const signed = `+${formatNumber(item.delta)}`;
      if (item.kind === 'total') {
        lines.push(`  [${CLASS_LABELS[item.class]}] 总量 ${formatNumber(item.current)} > 基线 ${formatNumber(item.baseline)}（${signed}）`);
      } else {
        lines.push(`  [${CLASS_LABELS[item.class]}] ${item.file}：${formatNumber(item.baseline)} -> ${formatNumber(item.current)}（${signed}）`);
      }
    }
    if (comparison.newFiles.length) {
      lines.push(`  新增文件（计入总量）：${comparison.newFiles.join(', ')}`);
    }
    lines.push('  处理方式：改用 --fs-*/语义色/--space-*/--radius-*/--shadow-* 等 token；确属新基线则显式 --update 并走评审。');
  }
  if (comparison.removedFiles.length && !opts.quiet) {
    lines.push(`  已不在工作树的基线文件：${comparison.removedFiles.join(', ')}`);
  }

  process.stdout.write(`${lines.join('\n')}\n`);
}

function buildJson(model) {
  const { result, baseline, comparison, opts } = model;
  return {
    mode: opts.update ? 'update' : 'check',
    generatedAt: new Date().toISOString(),
    root: result.root,
    filesScanned: result.filesScanned,
    infos: result.infos,
    counts: { ...result.totals, total: result.total },
    modules: result.modules,
    topFiles: result.topFiles.slice(0, opts.top),
    baseline: {
      path: toPosix(BASELINE_PATH),
      present: Boolean(baseline),
      generatedAt: baseline?.generatedAt ?? null,
      totals: baseline?.totals ?? null,
      files: baseline ? Object.keys(baseline.files ?? {}).length : 0,
    },
    gate: {
      pass: comparison.pass,
      missingBaseline: comparison.missingBaseline,
      violations: comparison.violations,
      newFiles: comparison.newFiles,
      removedFiles: comparison.removedFiles,
    },
    files: result.perFile,
  };
}

// ---------------------------------------------------------------- 主流程

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const rootDir = opts.root ?? resolve(SCRIPT_DIR, '..');
  const result = audit(rootDir);
  result.root = toPosix(rootDir);

  const previous = readBaseline();

  if (opts.update) {
    const baseline = buildBaseline(result, rootDir);
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
    const comparison = compare(previous, result);
    const model = { result, baseline, comparison, opts };
    if (opts.json) process.stdout.write(`${JSON.stringify(buildJson(model), null, 2)}\n`);
    else {
      process.stdout.write(`已写入基线 ${toPosix(BASELINE_PATH)}\n`);
      if (previous) {
        const before = CLASSES.reduce((s, k) => s + Number(previous.totals?.[k] ?? 0), 0);
        process.stdout.write(`  基线合计 ${formatNumber(before)} -> ${formatNumber(result.total)}\n`);
      } else {
        process.stdout.write(`  基线合计 ${formatNumber(result.total)}\n`);
      }
      for (const key of CLASSES) process.stdout.write(`  ${CLASS_LABELS[key]}: ${formatNumber(result.totals[key])}\n`);
    }
    return;
  }

  const comparison = compare(previous, result);
  const model = { result, baseline: previous, comparison, opts };
  if (opts.json) process.stdout.write(`${JSON.stringify(buildJson(model), null, 2)}\n`);
  else printHuman(model);
  if (!comparison.pass) process.exitCode = 1;
}

main();
