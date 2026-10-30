/**
 * prepareImportManifest 校验本地清单与原件一一映射，金额仍由服务器逐项校验。
 * 参数：text为JSON清单，files为所选原件，existingSources为暂存台账，supportedModes为开放模式。
 * 返回值：清单及文件映射；重复、不支持模式或缺文件时抛出中文错误。
 */
export function prepareImportManifest(text, files, existingSources = [], supportedModes = ['NORMAL']) {
  if (new TextEncoder().encode(text).length > 2 * 1024 * 1024) throw new Error('清单不能超过 2MiB。')
  for (const token of text.matchAll(/"(?:\\.|[^"\\])*"|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g)) {
    if (token[1] && (!/^-?(?:0|[1-9]\d*)$/.test(token[1]) || BigInt(token[1]) > BigInt(Number.MAX_SAFE_INTEGER) || BigInt(token[1]) < BigInt(Number.MIN_SAFE_INTEGER))) {
      throw new Error('清单数值须为安全范围内的整数；总额使用分整数，分期金额使用元字符串，不能在页面中静默舍入。')
    }
  }
  const manifest = JSON.parse(text)
  if (manifest.schema_version !== 1 || !manifest.source_system || !Array.isArray(manifest.items)
      || !manifest.items.length || manifest.items.length > 100) throw new Error('清单版本必须为1，每批1—100项。')
  if (manifest.items.some(item => item.mode === 'NORMAL') && manifest.items.some(item => item.mode !== 'NORMAL')) throw new Error('NORMAL与历史合同须分别建立批次。')
  const names = new Map()
  for (const file of files) {
    if (names.has(file.name)) throw new Error(`存在重名原件：${file.name}。请分别整理后导入。`)
    names.set(file.name, file)
  }
  const keys = new Set(), ids = new Set(), used = new Set(), stagedByKey = new Map()
  for (const item of manifest.items) {
    if (!item.item_key || !item.external_record_id || keys.has(item.item_key) || ids.has(item.external_record_id)) throw new Error('清单存在空或重复的单项键、来源业务编号。')
    if (!supportedModes.includes(item.mode)) throw new Error('当前服务端未开放此导入模式，历史模式需具备独立确认及子系统能力。')
    if (item.mode !== 'NORMAL' && (!item.history_evidence || !item.policy_options)) throw new Error('历史导入须显式提供政策及来源证据清单。')
    if (item.mode !== 'NORMAL' && item.policy_options.finance_mode === 'FULL_REPLAY' && !Array.isArray(item.history_evidence.expected_facts)) throw new Error('财务重建必须提供完整 expected_facts 清单（无历史事实时显式 []）。')
    const exact = existingSources.find((source) => source.item_key === item.item_key && source.file_ref === item.source_file_ref && source.state === 'READY')
    const matching = existingSources.filter((source) => source.item_key === item.item_key && source.filename === item.source_file_ref && source.state === 'READY')
    if (!exact && matching.length > 1 && !names.has(item.source_file_ref)) throw new Error(`同名原件存在多个代次：${item.item_key}。请保留当前 file_ref，或重新选择原件。`)
    const staged = exact || matching[0]
    if ((!names.has(item.source_file_ref) && !staged) || used.has(item.source_file_ref)) throw new Error(`原件未匹配或重复使用：${item.source_file_ref || item.item_key}。`)
    if (staged && !names.has(item.source_file_ref)) stagedByKey.set(item.item_key, staged.file_ref)
    keys.add(item.item_key); ids.add(item.external_record_id); used.add(item.source_file_ref)
  }
  if (files.some((file) => !used.has(file.name))) throw new Error('所选原件与清单不是一一对应，请移除多余文件。')
  return { manifest, filesByName: names, stagedByKey }
}

/**
 * formatImportMinor 精确展示页面可安全表示的分单位总额。
 * 参数：value为服务端分整数。
 * 返回值：元字符串；超页面精确范围时提示核对，不展示舍入后的金额。
 */
export function formatImportMinor(value) {
  if (!Number.isSafeInteger(value)) return '超出页面精确展示范围，请核对权威台账'
  const amount = BigInt(value), absolute = amount < 0n ? -amount : amount
  return `${amount < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`
}
