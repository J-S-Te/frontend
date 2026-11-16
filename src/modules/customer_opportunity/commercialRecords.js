import { computed, reactive, ref, watch, onScopeDispose } from 'vue'
import { todayBusinessDate, formatBusinessDate } from '../shared/utils/businessTime.js'
import { createIdempotencyKey } from './api/client.js'
import { formatCRMError } from './api/errorMessages.js'
import * as recordsAPI from './api/commercialRecords.js'

export const COMMERCIAL_STATUSES = Object.freeze({
  QUOTATION: [
    ['DRAFT', '草稿'], ['SUBMITTED', '已提交'], ['APPROVED', '已认可'],
    ['REJECTED', '未认可'], ['CANCELLED', '已取消'],
  ],
  BID: [
    ['PREPARING', '准备中'], ['SUBMITTED', '已投标'], ['WON', '已中标'],
    ['LOST', '未中标'], ['CANCELLED', '已取消'],
  ],
})

// 用途：校验并规范人工登记字段，金额始终按字符串处理。
// 参数：form 为当前表单，attachments 为可关联的可信附件。
// 返回值：规范载荷；字段非法时抛出可直接提示的错误。
export function commercialRecordPayload(form, attachments) {
  const title = String(form.title || '').trim()
  const documentNo = String(form.document_no || '').trim()
  const notes = String(form.notes || '').trim()
  const amount = String(form.amount ?? '').trim()
  if (!title || [...title].length > 200) throw new Error('资料主题必填，且不能超过200字。')
  if ([...documentNo].length > 64) throw new Error('业务单号不能超过64字。')
  if ([...notes].length > 2000) throw new Error('说明不能超过2000字。')
  if (amount && !/^\d{1,16}(\.\d{1,2})?$/.test(amount)) {
    throw new Error('金额须为非负数字，整数最多16位、小数最多2位；未知可留空。')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.record_date || '')
    || !formatBusinessDate(form.record_date)) throw new Error('请填写有效的业务日期。')
  if (!COMMERCIAL_STATUSES[form.type]?.some(([value]) => value === form.status)) {
    throw new Error('请选择与资料类型匹配的状态。')
  }
  const ids = form.attachment_ids || []
  const allowed = new Set(attachments.map(item => String(item.id)))
  if (ids.length > 20 || new Set(ids).size !== ids.length || ids.some(id => !allowed.has(id))) {
    throw new Error('关联附件须已通过校验且属于当前商机，最多20个；请刷新附件后重新选择。')
  }
  return { type: form.type, title, document_no: documentNo, record_date: form.record_date,
    amount: amount || null, status: form.status, notes, attachment_ids: [...ids],
    ...(form.id ? { version: form.version } : {}) }
}

// 用途：判断写入结果是否尚不能确认，防止把断网或异常响应当成明确失败。
// 参数：error 为现有 CRM 请求异常。
// 返回值：结果未知时为真，需要核对后复用原始命令。
function unknownResult(error) {
  return !error?.status || error.status >= 500 || error.code === 'CRM_RESPONSE_INVALID'
}

// 用途：创建由当前页面会话持有的待确认命令集合，跨详情卸载保留原登记。
// 参数：无。
// 返回值：仅驻留内存的响应式集合，不写浏览器存储。
export function createCommercialRecordCommandStore() {
  return reactive(new Map())
}

// 用途：管理人工资料读取、录入、更正与作废，隔离不同商机的异步结果。
// 参数：props 为父商机及能力，emit 为父事件，api 为HTTP边界。
// 返回值：供面板使用的响应式状态和操作方法。
export function useCommercialRecords(props, emit, api = recordsAPI) {
  const rows = ref([]), total = ref(0), page = ref(1), loading = ref(false)
  const readError = ref(''), formError = ref(''), notice = ref('')
  const form = ref(null), voidTarget = ref(null), voidReason = ref(''), submitting = ref(false)
  const uncertain = ref(false), verified = ref(false)
  const pending = reactive(props.commandStore || createCommercialRecordCommandStore())
  let epoch = 0, readSequence = 0, disposed = false
  const commandKey = computed(() => JSON.stringify([
    String(props.commandScope || ''), String(props.opportunityId || ''),
  ]))
  const canRead = computed(() => props.permissions.includes('opportunity.read'))
  const canReadAttachments = computed(() => canRead.value
    && props.permissions.includes('opportunity.attachment.read'))
  const canWrite = computed(() => canRead.value && props.permissions.includes('opportunity.update')
    && props.opportunityStatus !== 'VOID')
  const availableAttachments = computed(() => {
    if (!canReadAttachments.value) return []
    const candidates = [...(form.value?.attachments || []), ...props.attachments]
    return [...new Map(candidates.filter(item => item.scan_status === 'CLEAN'
      && (!item.opportunity_id || String(item.opportunity_id) === String(props.opportunityId)))
      .map(item => [String(item.id), item])).values()]
  })
  const statuses = computed(() => COMMERCIAL_STATUSES[form.value?.type] || [])

  // 用途：在展示边界按当前文件权限裁剪资料，防止旧回执恢复已撤权的文件信息。
  // 参数：record 为服务端资料或确认回执。
  // 返回值：当前允许展示的资料副本。
  function visibleRecord(record) {
    return { ...record, attachments: canReadAttachments.value ? [...(record.attachments || [])] : [] }
  }

  // 用途：从内存命令恢复表单，隐藏当前无权读取的文件字段。
  // 参数：command 为当前身份、租户和商机绑定的原始命令。
  // 返回值：可展示的表单副本，不修改重放载荷。
  function commandForm(command) {
    return { ...command.form,
      attachments: canReadAttachments.value ? [...(command.form.attachments || [])] : [],
      attachment_ids: canReadAttachments.value ? [...command.payload.attachment_ids] : [],
    }
  }

  // 用途：由仍挂载的当前详情接收待确认命令的状态，隔离旧实例回调。
  // 参数：command 为原命令，key 为身份及商机坐标。
  // 返回值：确认后的刷新Promise；其他上下文不产生界面副作用。
  async function syncCommand(command, key) {
    if (disposed || !canRead.value || commandKey.value !== key || pending.get(key) !== command) return
    submitting.value = command.busy
    if (command.state === 'CONFIRMED' && !command.busy) {
      pending.delete(key)
      await confirmed(command.record, '资料已保存（人工登记）。')
      return
    }
    form.value = commandForm(command)
    uncertain.value = command.state !== 'REJECTED'
    verified.value = false
    if (command.state === 'REJECTED' && !command.busy) {
      pending.delete(key)
      formError.value = command.error
    } else if (command.state === 'UNKNOWN') {
      formError.value = command.error
        ? `原登记结果仍待核对：${command.error} 请核对最新列表后重试原登记，请勿重复新建。`
        : '本次登记结果未知。请先核对最新列表，再使用原登记重试；请勿重复新建。'
    }
  }

  // 用途：加载指定分页，并丢弃旧商机或旧查询的返回。
  // 参数：targetPage 为目标页码，默认保持当前页。
  // 返回值：当前商机读取成功为真，失败或过期为假。
  async function load(targetPage = page.value) {
    const generation = epoch, sequence = ++readSequence, id = String(props.opportunityId || '')
    if (!id || !canRead.value) return false
    loading.value = true; readError.value = ''
    try {
      const result = await api.listCommercialRecords(id, { page: targetPage, page_size: 20 })
      if (generation !== epoch || sequence !== readSequence) return false
      rows.value = (result.items || []).map(visibleRecord)
      total.value = result.total || 0; page.value = targetPage
      return true
    } catch (error) {
      if (generation === epoch && sequence === readSequence) {
        readError.value = formatCRMError(error, { fallback: '资料列表读取失败，请重新读取。' })
      }
      return false
    } finally {
      if (generation === epoch && sequence === readSequence) loading.value = false
    }
  }

  // 用途：打开指定类型的空白人工登记表。
  // 参数：type 为报价或投标类型。
  // 返回值：无，结果未知时保留原命令。
  function openCreate(type) {
    if (!canWrite.value || submitting.value || uncertain.value || !COMMERCIAL_STATUSES[type]) return
    form.value = { type, title: '', document_no: '', record_date: todayBusinessDate(),
      amount: '', status: COMMERCIAL_STATUSES[type][0][0], notes: '', attachment_ids: [] }
    voidTarget.value = null; formError.value = ''; notice.value = ''
  }

  // 用途：打开有效资料的版本化更正表。
  // 参数：record 为当前列表中的有效资料。
  // 返回值：无；不可写或已作废时不打开。
  function openEdit(record) {
    if (!canWrite.value || record.is_void || submitting.value || uncertain.value) return
    const visible = visibleRecord(record)
    form.value = { ...visible, amount: visible.amount ?? '',
      attachment_ids: visible.attachments.map(item => String(item.id)) }
    voidTarget.value = null; formError.value = ''; notice.value = ''
  }

  // 用途：关闭已知结果的表单，避免丢失未知创建的幂等命令。
  // 参数：无。
  // 返回值：无。
  function closeForm() {
    if (submitting.value || uncertain.value) return
    form.value = null; voidTarget.value = null; formError.value = ''
  }

  // 用途：从当前候选或已授权的历史关联中选择可信文件。
  // 参数：id 为附件标识，selected 为是否勾选。
  // 返回值：无；空主题可用首个文件名补全。
  function selectAttachment(id, selected) {
    if (!form.value || submitting.value || uncertain.value) return
    const item = availableAttachments.value.find(value => String(value.id) === id)
    if (!item) return
    const ids = form.value.attachment_ids.filter(value => value !== id)
    if (selected) ids.push(id)
    form.value.attachment_ids = ids
    if (selected && !form.value.title.trim()) form.value.title = item.file_name
  }

  // 用途：核对未知创建的最新列表后，允许用户明确重放原命令。
  // 参数：无。
  // 返回值：无；读取失败时保持禁止重试。
  async function verifyUnknown() {
    if (!uncertain.value || submitting.value) return
    const generation = epoch
    const result = await load(1)
    if (generation === epoch) verified.value = result
  }

  // 用途：将已确认写入结果保留在当前列表，再单独刷新服务端分页。
  // 参数：record 为确认的资料，message 为成功提示。
  // 返回值：列表刷新Promise，失败不会撤销保存成功提示。
  async function confirmed(record, message) {
    rows.value = [visibleRecord(record), ...rows.value.filter(item => item.id !== record.id)]
    notice.value = message; form.value = null; voidTarget.value = null
    uncertain.value = false; verified.value = false; formError.value = ''
    emit('refresh-attachments')
    await load(1)
  }

  // 用途：保存登记或更正，创建未知时保留原载荷和幂等键。
  // 参数：无，读取当前表单与商机能力。
  // 返回值：保存处理Promise；错误保留为面板可见状态。
  async function save() {
    if (!form.value || !canWrite.value || submitting.value) return
    if (uncertain.value && !verified.value) return
    const id = String(props.opportunityId), generation = epoch, key = commandKey.value
    const recordID = form.value.id
    let command = !recordID ? pending.get(key) : null
    const replaying = Boolean(command)
    let payload
    // 结果未知时重放冻结载荷，候选列表变化不能阻止服务端核对原命令。
    if (!command) {
      try { payload = commercialRecordPayload(form.value, availableAttachments.value) }
      catch (error) { formError.value = error.message; return }
    }
    if (!recordID && !command) {
      pending.set(key, { payload, key: createIdempotencyKey(), state: 'SENDING', busy: false,
        form: { ...form.value, attachment_ids: [...payload.attachment_ids],
          attachments: availableAttachments.value.filter(item => payload.attachment_ids.includes(String(item.id))) },
      })
      command = pending.get(key)
    }
    if (command?.busy) return
    submitting.value = true; formError.value = ''
    if (command) { command.busy = true; command.state = 'SENDING' }
    try {
      const record = recordID
        ? await api.updateCommercialRecord(id, recordID, payload)
        : await api.createCommercialRecord(id, command.payload, command.key)
      if (!record?.id || !record.version) {
        throw Object.assign(new Error('未收到有效保存确认，请先核对资料列表。'),
          { code: 'CRM_RESPONSE_INVALID' })
      }
      if (command) { command.record = record; command.state = 'CONFIRMED' }
      else if (generation === epoch) await confirmed(record, '资料已保存（人工登记）。')
    } catch (error) {
      const message = formatCRMError(error, { fallback: '资料保存失败，请核对字段和最新版本。' })
      if (command) {
        // 重放被当前权限或状态拒绝，不能证明首次创建未落库，继续保留原键。
        command.state = replaying || unknownResult(error) ? 'UNKNOWN' : 'REJECTED'
        command.error = message
      } else if (generation === epoch) formError.value = message
    } finally {
      if (command) { command.busy = false; await syncCommand(command, key) }
      else if (generation === epoch) submitting.value = false
    }
  }

  // 用途：打开错误录入的作废确认，不混淆离线业务取消状态。
  // 参数：record 为尚未作废的资料。
  // 返回值：无。
  function openVoid(record) {
    if (!canWrite.value || record.is_void || submitting.value || uncertain.value) return
    voidTarget.value = record; voidReason.value = ''; form.value = null; formError.value = ''
  }

  // 用途：按读取版本与原因作废当前资料。
  // 参数：无，读取作废对象与说明。
  // 返回值：处理Promise；冲突或失败保留错误提示。
  async function confirmVoid() {
    if (!voidTarget.value || !canWrite.value || submitting.value) return
    const reason = voidReason.value.trim()
    if (!reason || [...reason].length > 500) {
      formError.value = '作废说明必填，且不能超过500字。'; return
    }
    const generation = epoch, id = String(props.opportunityId), record = voidTarget.value
    submitting.value = true; formError.value = ''
    try {
      const result = await api.voidCommercialRecord(id, record.id, { version: record.version, reason })
      if (!result?.id || !result.version || !result.is_void) {
        throw new Error('未收到有效作废确认，请先重新读取列表核对。')
      }
      if (generation === epoch) await confirmed(result, '资料已作废，历史登记仍保留。')
    } catch (error) {
      if (generation === epoch) formError.value = formatCRMError(error,
        { fallback: '作废未确认，请先重新读取列表核对，避免重复操作。' })
    } finally { if (generation === epoch) submitting.value = false }
  }

  watch(() => [commandKey.value, canRead.value], () => {
    epoch++; readSequence++; rows.value = []; total.value = 0; page.value = 1
    loading.value = false; readError.value = ''; formError.value = ''; notice.value = ''
    voidTarget.value = null; verified.value = false
    form.value = null; uncertain.value = false; submitting.value = false
    const command = pending.get(commandKey.value)
    if (command) void syncCommand(command, commandKey.value)
    if (command?.state !== 'CONFIRMED') void load(1)
  }, { immediate: true, flush: 'sync' })
  watch(() => {
    const command = pending.get(commandKey.value)
    return command ? [command.state, command.busy] : null
  }, () => {
    const command = pending.get(commandKey.value)
    if (command) void syncCommand(command, commandKey.value)
  })
  watch(canReadAttachments, () => {
    readSequence++
    rows.value = rows.value.map(record => ({ ...record, attachments: [] }))
    const command = pending.get(commandKey.value)
    if (command) void syncCommand(command, commandKey.value)
    else if (form.value) {
      form.value = null
      notice.value = '附件读取权限已变化，请重新打开资料后继续操作。'
    }
    void load()
  }, { flush: 'sync' })
  onScopeDispose(() => { disposed = true; epoch++; readSequence++ })
  return { rows, total, page, loading, readError, formError, notice, form, voidTarget,
    voidReason, submitting, uncertain, verified, canRead, canReadAttachments, canWrite, availableAttachments,
    statuses, load, openCreate, openEdit, closeForm, selectAttachment, verifyUnknown,
    save, openVoid, confirmVoid }
}
