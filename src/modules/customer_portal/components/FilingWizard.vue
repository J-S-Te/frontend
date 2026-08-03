<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { completeFilingMaterialUpload, createFiling, createFilingMaterialUpload, getFiling, listFilings, saveFilingMatrix, saveFilingSection, submitFiling, validateFiling } from '../api/portal.js'

const props = defineProps({ permissions: { type: Array, default: () => [] }, capabilities: { type: Object, default: () => ({}) } })
const emit = defineEmits(['error', 'notice'])

const FORM_VERSION = '2025.1'
const steps = Object.freeze([
  ['ORGANIZATION', '单位基本情况'], ['CLASSIFIED_OBJECT', '定级对象情况'], ['CLASSIFICATION', '定级情况'],
  ['NEW_TECHNOLOGY', '新技术应用'], ['MATERIALS', '提交材料'], ['DATA_INVENTORY', '数据摸底'],
  ['CLASSIFICATION_REPORT', '定级报告'],
])
const permissionSet = computed(() => new Set(props.permissions || []))
const canCreate = computed(() => permissionSet.value.has('filing.create'))
const canUpdate = computed(() => permissionSet.value.has('filing.update'))
const canSubmit = computed(() => permissionSet.value.has('filing.submit'))
const materialUploadAvailable = computed(() => props.capabilities?.filing_material_upload?.available === true)
const filingExportAvailable = computed(() => props.capabilities?.filing_export?.available === true)
const policeSubmissionAvailable = computed(() => props.capabilities?.filing_police_submission?.available === true)
const filings = ref([])
const filing = ref(null)
const currentStep = ref(0)
const busy = ref(false)
const validation = ref(null)
const saveState = reactive(Object.fromEntries(steps.map(([code]) => [code, '未暂存'])))
const sectionVersions = reactive(Object.fromEntries(steps.map(([code]) => [code, 0])))
const sectionIssues = reactive(Object.fromEntries(steps.map(([code]) => [code, []])))
const matrixVersions = reactive({ BUSINESS_INFORMATION: 0, SYSTEM_SERVICE: 0 })
const conflict = ref(false)
const materialFiles = reactive({})
const materialBusy = reactive({})
const materialErrors = reactive({})
const materialCreateKeys = reactive({})
const materialFileSignatures = reactive({})
let saveTimer = 0
let saveQueue = Promise.resolve()
let createIdempotencyKey = ''
let submitIdempotencyKey = ''

// 备案草稿由 7 个独立 section 和 2 张矩阵组成。每个子资源维护自己的乐观锁
// 版本；filing.version 则协调跨 section 的整体验证、材料和最终锁定。

const enumOptions = Object.freeze({
  affiliation: [['CENTRAL', '中央'], ['PROVINCE', '省级'], ['CITY', '地市级'], ['COUNTY', '县区级'], ['OTHER', '其他']],
  organizationType: [['PARTY_ORGAN', '党委机关'], ['GOVERNMENT', '政府机关'], ['PUBLIC_INSTITUTION', '事业单位'], ['ENTERPRISE', '企业'], ['OTHER', '其他']],
  objectTypes: [['COMMUNICATION_NETWORK', '通信网络设施'], ['INFORMATION_SYSTEM_CLOUD', '信息系统（云计算）'], ['INFORMATION_SYSTEM_MOBILE', '信息系统（移动互联）'], ['INFORMATION_SYSTEM_IOT', '信息系统（物联网）'], ['INFORMATION_SYSTEM_ICS', '信息系统（工业控制）'], ['INFORMATION_SYSTEM_BIG_DATA', '信息系统（大数据）'], ['DATA_RESOURCE', '数据资源']],
  businessType: [['PRODUCTION', '生产作业'], ['COMMAND', '指挥调度'], ['OFFICE', '内部办公'], ['PUBLIC_SERVICE', '公众服务'], ['OTHER', '其他']],
  serviceScope: [['NATIONAL', '全国'], ['CROSS_PROVINCE', '跨省'], ['PROVINCE', '全省'], ['CROSS_CITY', '跨地市'], ['CITY', '地市内'], ['OTHER', '其他']],
  audience: [['INTERNAL', '单位内部人员'], ['PUBLIC', '社会公众'], ['BOTH', '两者均包括'], ['OTHER', '其他']],
  deployment: [['LAN', '局域网'], ['MAN', '城域网'], ['WAN', '广域网'], ['OTHER', '其他']],
  networkNature: [['PRIVATE', '业务专网'], ['INTERNET', '互联网']],
  cloudResponsibility: [['PROVIDER', '云服务商'], ['CUSTOMER', '云租户']],
  cloudService: [['IAAS', 'IaaS'], ['PAAS', 'PaaS'], ['SAAS', 'SaaS'], ['OTHER', '其他']],
  cloudDeployment: [['PRIVATE', '私有云'], ['PUBLIC', '公有云'], ['HYBRID', '混合云'], ['OTHER', '其他']],
  iot: [['SENSOR', '传感器'], ['GATEWAY', '网关'], ['RFID_TAG', 'RFID 标签'], ['RFID_READER', 'RFID 读写器'], ['INTERNET', '互联网'], ['PRIVATE_NETWORK', '专网'], ['MOBILE_NETWORK', '移动通信网']],
  industrial: [['SCADA', 'SCADA'], ['DCS', 'DCS'], ['PLC', 'PLC'], ['RTU', 'RTU'], ['MTU', 'MTU'], ['SC', 'SC']],
  bigData: [['PLATFORM', '大数据平台'], ['APPLICATION', '大数据应用'], ['RESOURCE', '大数据资源']],
  dataLevel: [['GENERAL', '一般数据'], ['IMPORTANT_OR_ABOVE', '重要及以上数据']],
  personalInfo: [['SENSITIVE', '敏感个人信息'], ['MINOR', '未成年人个人信息'], ['GENERAL', '一般个人信息'], ['NONE', '不涉及个人信息']],
  dataSources: [['COLLECTED', '业务采集'], ['GENERATED', '系统生成'], ['MANUAL', '人工录入'], ['PURCHASED', '外部采购'], ['SHARED', '外部共享']],
  processor: [['PROVIDED', '对外提供'], ['ENTRUSTED', '委托处理'], ['JOINT', '共同处理'], ['NONE', '无交互']],
  storage: [['PRIVATE_CLOUD', '私有云'], ['PUBLIC_CLOUD', '公有云'], ['HYBRID_CLOUD', '混合云'], ['OWN_DATA_CENTER', '自有数据中心'], ['DOMESTIC', '境内'], ['OVERSEAS', '境外']],
  impactObject: [['LEGAL_RIGHTS', '公民、法人和其他组织合法权益'], ['PUBLIC_INTEREST', '社会秩序和公共利益'], ['NATIONAL_SECURITY', '国家安全']],
  damage: [['GENERAL', '一般损害'], ['SERIOUS', '严重损害'], ['EXTREME', '特别严重损害']],
})

function field(key, label, type = 'text', options = null, extra = {}) { return { key, label, type, options, ...extra } }
const fields = Object.freeze({
  ORGANIZATION: [
    field('social_credit_code', '统一社会信用代码', 'text', null, { required: true, maxlength: 18 }), field('province', '省（自治区、直辖市）', 'text', null, { required: true }), field('city', '地（区、市、州、盟）', 'text', null, { required: true }), field('district', '县（区、市、旗）', 'text', null, { required: true }), field('address', '详细地址', 'text', null, { required: true }), field('postal_code', '邮政编码', 'text', null, { maxlength: 6 }), field('administrative_division_code', '行政区划代码', 'text', null, { maxlength: 6 }),
    field('organization_leader_name', '单位负责人姓名', 'text', null, { required: true }), field('organization_leader_title', '单位负责人职务/职称'), field('organization_leader_phone', '单位负责人电话'), field('organization_leader_email', '单位负责人邮箱', 'email'),
    field('security_department', '网络安全责任部门', 'text', null, { required: true }), field('security_contact_name', '网络安全联系人', 'text', null, { required: true }), field('security_contact_phone', '网络安全联系人电话'), field('security_contact_email', '网络安全联系人邮箱', 'email'),
    field('data_security_department', '数据安全管理部门'), field('data_security_contact_name', '数据安全联系人'), field('affiliation', '隶属关系', 'select', enumOptions.affiliation, { required: true }), field('organization_type', '单位类型', 'select', enumOptions.organizationType, { required: true }), field('industry_code', '行业类别代码', 'text', null, { required: true }),
    field('level2_object_count', '第二级定级对象数', 'number', null, { required: true, min: 0 }), field('level3_object_count', '第三级定级对象数', 'number', null, { required: true, min: 0 }), field('level4_object_count', '第四级定级对象数', 'number', null, { required: true, min: 0 }), field('level5_object_count', '第五级定级对象数', 'number', null, { required: true, min: 0 }),
  ],
  CLASSIFIED_OBJECT: [
    field('system_name', '定级对象（系统名称）', 'text', null, { required: true }), field('object_number', '定级对象编号'), field('object_types', '定级对象类型', 'checks', enumOptions.objectTypes, { required: true }), field('business_type', '业务类型', 'select', enumOptions.businessType, { required: true }), field('business_description', '业务描述', 'textarea', null, { required: true }), field('service_scope', '服务范围', 'select', enumOptions.serviceScope, { required: true }), field('service_audience', '服务对象', 'select', enumOptions.audience, { required: true }), field('deployment_scope', '部署范围', 'select', enumOptions.deployment, { required: true }), field('network_nature', '网络性质', 'select', enumOptions.networkNature, { required: true }), field('source_ip_range', '源站 IP 地址范围'), field('domain_name', '域名'), field('protocols_and_ports', '主要协议/端口'), field('interconnection', '网络互联情况', 'textarea'), field('launched_on', '投入运行日期', 'date', null, { required: true }), field('is_subsystem', '是否是分系统', 'boolean', null, { required: true }), field('parent_system_name', '上级系统名称', 'text', null, { show: data => data.is_subsystem }), field('parent_organization_name', '上级系统所属单位', 'text', null, { show: data => data.is_subsystem }),
  ],
  CLASSIFICATION: [
    field('business_information_level', '业务信息安全保护等级', 'level', null, { required: true }), field('system_service_level', '系统服务安全保护等级', 'level', null, { required: true }), field('final_level', '定级对象安全保护等级', 'level', null, { required: true }), field('classified_on', '定级时间', 'date', null, { required: true }), field('classification_report_available', '已有定级报告声明', 'boolean', null, { required: true }), field('expert_reviewed', '已通过专家评审', 'boolean', null, { required: true }), field('has_industry_authority', '有上级行业主管部门', 'boolean', null, { required: true }), field('industry_authority_name', '上级行业主管部门名称', 'text', null, { show: data => data.has_industry_authority }), field('industry_authority_reviewed', '已通过上级行业主管部门审核', 'boolean', null, { required: true }), field('form_filler_name', '填表人姓名', 'text', null, { required: true }), field('form_filled_on', '填表日期', 'date', null, { required: true }),
  ],
  NEW_TECHNOLOGY: [
    field('cloud_used', '使用云计算技术', 'boolean', null, { required: true }), field('cloud_responsibility', '云计算角色', 'select', enumOptions.cloudResponsibility, { show: data => data.cloud_used }), field('cloud_service_model', '云服务模式', 'select', enumOptions.cloudService, { show: data => data.cloud_used }), field('cloud_deployment_model', '云部署模式', 'select', enumOptions.cloudDeployment, { show: data => data.cloud_used }), field('cloud_platform_name', '云平台名称', 'text', null, { show: data => data.cloud_used }), field('cloud_platform_level', '云平台安全保护等级', 'level', null, { show: data => data.cloud_used }), field('cloud_filing_number', '云平台备案编号', 'text', null, { show: data => data.cloud_used }),
    field('mobile_used', '使用移动互联技术', 'boolean', null, { required: true }), field('mobile_application_names', '移动应用名称', 'textarea', null, { show: data => data.mobile_used }), field('iot_used', '使用物联网技术', 'boolean', null, { required: true }), field('iot_components', '物联网组成', 'checks', enumOptions.iot, { show: data => data.iot_used }), field('industrial_control_used', '使用工业控制技术', 'boolean', null, { required: true }), field('industrial_control_components', '工业控制组成', 'checks', enumOptions.industrial, { show: data => data.industrial_control_used }), field('big_data_used', '使用大数据技术', 'boolean', null, { required: true }), field('big_data_components', '大数据组成', 'checks', enumOptions.bigData, { show: data => data.big_data_used }), field('big_data_cross_border', '大数据涉及跨境', 'boolean', null, { show: data => data.big_data_used }), field('big_data_application_count', '大数据应用数量', 'number', null, { min: 0, show: data => data.big_data_used }), field('big_data_platform_name', '大数据平台名称', 'text', null, { show: data => data.big_data_used }),
  ],
  MATERIALS: [
    field('topology_available', '网络拓扑图', 'material', null, { fileKey: 'topology_file_name' }), field('security_governance_available', '网络安全管理制度', 'material', null, { fileKey: 'security_governance_file_name' }), field('security_design_available', '网络安全建设方案', 'material', null, { fileKey: 'security_design_file_name' }), field('security_products_available', '网络安全产品清单', 'material', null, { fileKey: 'security_products_file_name' }), field('security_services_available', '网络安全服务清单', 'material', null, { fileKey: 'security_services_file_name' }), field('authority_guidance_available', '上级主管部门指导意见', 'material', null, { fileKey: 'authority_guidance_file_name' }),
  ],
  DATA_INVENTORY: [
    field('data_name', '数据名称', 'text', null, { required: true }), field('proposed_data_level', '拟定数据级别', 'select', enumOptions.dataLevel, { required: true }), field('data_category', '数据类别', 'text', null, { required: true }), field('responsible_department', '责任部门', 'text', null, { required: true }), field('responsible_person', '责任人', 'text', null, { required: true }), field('personal_information_types', '个人信息类型', 'checks', enumOptions.personalInfo, { required: true }), field('total_volume', '数据总量'), field('monthly_growth', '月增长量'), field('data_sources', '数据来源', 'checks', enumOptions.dataSources, { required: true }), field('inter_organization_flow', '组织间流转情况', 'textarea'), field('processor_interaction', '处理者交互方式', 'select', enumOptions.processor, { required: true }), field('storage_locations', '存储位置', 'checks', enumOptions.storage, { required: true }),
  ],
  CLASSIFICATION_REPORT: [
    field('responsible_entity_description', '定级责任主体说明', 'textarea', null, { required: true }), field('object_composition_description', '定级对象构成说明', 'textarea', null, { required: true }), field('business_description', '承载业务说明', 'textarea', null, { required: true }), field('subsystems_summary', '子系统概要', 'textarea'), field('data_description', '数据情况说明', 'textarea', null, { required: true }), field('security_responsibility_description', '安全责任说明', 'textarea', null, { required: true }), field('business_information_description', '业务信息受损影响说明', 'textarea', null, { required: true }), field('business_impact_object', '业务信息受损侵害客体', 'select', enumOptions.impactObject, { required: true }), field('business_damage_degree', '业务信息受损程度', 'select', enumOptions.damage, { required: true }), field('business_information_level', '业务信息安全等级', 'level', null, { required: true }), field('system_service_description', '系统服务受损影响说明', 'textarea', null, { required: true }), field('service_impact_object', '系统服务受损侵害客体', 'select', enumOptions.impactObject, { required: true }), field('service_damage_degree', '系统服务受损程度', 'select', enumOptions.damage, { required: true }), field('system_service_level', '系统服务安全等级', 'level', null, { required: true }), field('final_level', '最终安全保护等级', 'level', null, { required: true }),
  ],
})

function initialData() {
  return {
    ORGANIZATION: { level2_object_count: 0, level3_object_count: 0, level4_object_count: 0, level5_object_count: 0 },
    CLASSIFIED_OBJECT: { object_types: [], is_subsystem: false },
    CLASSIFICATION: { classification_report_available: false, expert_reviewed: false, has_industry_authority: false, industry_authority_reviewed: false },
    NEW_TECHNOLOGY: { cloud_used: false, mobile_used: false, iot_used: false, iot_components: [], industrial_control_used: false, industrial_control_components: [], big_data_used: false, big_data_components: [] },
    MATERIALS: { topology_available: false, security_governance_available: false, security_design_available: false, security_products_available: false, security_services_available: false, authority_guidance_available: false },
    DATA_INVENTORY: { personal_information_types: [], data_sources: [], storage_locations: [] },
    CLASSIFICATION_REPORT: {},
  }
}
const sectionData = reactive(initialData())
const matrices = reactive({ BUSINESS_INFORMATION: { row_code: '', column_code: '', selected: false }, SYSTEM_SERVICE: { row_code: '', column_code: '', selected: false } })
const currentCode = computed(() => steps[currentStep.value][0])
const currentFields = computed(() => fields[currentCode.value])
const readonly = computed(() => !canUpdate.value || filing.value?.status !== 'DRAFT' || conflict.value)
const visibleFields = computed(() => currentFields.value.filter(item => !item.show || item.show(sectionData[currentCode.value])))
const matrixRows = enumOptions.impactObject
const matrixColumns = [['GENERAL_DAMAGE', '一般损害'], ['SERIOUS_DAMAGE', '严重损害'], ['EXTREME_DAMAGE', '特别严重损害']]
const materialCodeByField = Object.freeze({ topology_available: 'NETWORK_TOPOLOGY', security_governance_available: 'SECURITY_GOVERNANCE', security_design_available: 'SECURITY_DESIGN', security_products_available: 'SECURITY_PRODUCTS', security_services_available: 'SECURITY_SERVICES', authority_guidance_available: 'AUTHORITY_GUIDANCE', classification_report_available: 'CLASSIFICATION_REPORT' })
const materialByCode = computed(() => Object.fromEntries((filing.value?.materials || []).map(item => [item.code, item])))

function newKey() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}` }
function materialStatusText(value) { return ({ PENDING_UPLOAD: '等待上传', FINALIZING: '正在核验对象', SCANNING: '安全扫描中', CLEAN: '扫描通过', REJECTED: '检测到风险，已拒绝', SCAN_FAILED: '扫描失败，禁止提交' })[value] || '未上传' }
function selectMaterialFile(fieldKey, event) {
  const file = event.target.files?.[0] || null
  const signature = file ? `${file.name}\u0000${file.type}\u0000${file.size}\u0000${file.lastModified}` : ''
  if (materialFileSignatures[fieldKey] !== signature) materialCreateKeys[fieldKey] = ''
  materialFileSignatures[fieldKey] = signature
  materialFiles[fieldKey] = file
  materialErrors[fieldKey] = ''
}
async function fileSHA256(file) { const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer()); return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('') }
async function uploadMaterial(item) {
  const file = materialFiles[item.key]
  const code = materialCodeByField[item.key]
  if (!materialUploadAvailable.value || !filing.value || readonly.value || !file || !code || materialBusy[item.key]) return
  materialBusy[item.key] = true; materialErrors[item.key] = ''
  try {
    // Keep the create key while the selected file is unchanged. If the browser
    // loses the create response, retrying recovers the same server-side grant
    // 同一文件的完成响应若丢失，继续使用服务端已有材料版本，不创建冲突的第二版。
    materialCreateKeys[item.key] ||= newKey()
    const grant = await createFilingMaterialUpload(filing.value.id, { material_code: code, file_name: file.name, mime_type: file.type, size_bytes: file.size, sha256: await fileSHA256(file) }, materialCreateKeys[item.key])
    const target = new URL(grant.upload_url)
    if (target.protocol !== 'https:' || target.username || target.password || target.hash) throw new Error('对象存储上传地址不安全。')
    const uploaded = await fetch(target, { method: 'PUT', body: file, credentials: 'omit', redirect: 'error', headers: { 'Content-Type': file.type } })
    if (!uploaded.ok) throw new Error('对象存储上传失败。')
    await completeFilingMaterialUpload(filing.value.id, grant.material.id, grant.material.version)
    materialFiles[item.key] = null
    materialFileSignatures[item.key] = ''
    materialCreateKeys[item.key] = ''
    await reloadCurrent()
    emit('notice', `${item.label}已上传并进入安全扫描，扫描通过前不能提交备案。`)
  } catch (error) {
    materialErrors[item.key] = error?.code === 'PORTAL_FILING_MATERIAL_DEPENDENCY_UNAVAILABLE' ? '正式对象存储或病毒扫描尚未配置，上传已安全关闭。' : (error?.message || '材料上传失败。')
  } finally { materialBusy[item.key] = false }
}
function labelForStep(code) { return steps.find(item => item[0] === code)?.[1] || code }
function issueLabel(issue) {
  const parts = String(issue.path || '').split('.')
  const code = parts[1]
  const key = parts[2]
  const item = fields[code]?.find(value => value.key === key || value.fileKey === key)
  return `${labelForStep(code)}${item ? ` / ${item.label}` : ''}：${issue.message || issue.code}`
}
function statusText(value) { return ({ DRAFT: '草稿', WAITING_CONTRACT: '已锁定，等待公安提交契约', SUBMITTING: '正在向公安提交', SUBMISSION_FAILED: '公安提交失败，待人工处理', SUBMITTED: '公安回执已确认', ARCHIVED: '已归档' })[value] || value }
function resetDraft() {
  Object.assign(sectionData, initialData())
  for (const [code] of steps) { sectionVersions[code] = 0; sectionIssues[code] = []; saveState[code] = '未暂存' }
  Object.assign(matrices.BUSINESS_INFORMATION, { row_code: '', column_code: '', selected: false })
  Object.assign(matrices.SYSTEM_SERVICE, { row_code: '', column_code: '', selected: false })
  matrixVersions.BUSINESS_INFORMATION = 0; matrixVersions.SYSTEM_SERVICE = 0
  validation.value = null; conflict.value = false; submitIdempotencyKey = ''
}
function applyDetail(value) {
  resetDraft(); filing.value = value
  for (const item of value.sections || []) {
    if (sectionData[item.code]) Object.assign(sectionData[item.code], item.data || {})
    sectionVersions[item.code] = item.version || 0
    sectionIssues[item.code] = item.validation_issues || []
    saveState[item.code] = `${item.validation_status === 'VALID' ? '服务端已保存' : '服务端已保存（待完善）'} · v${item.version}`
  }
  for (const item of value.matrices || []) {
    if (matrices[item.code]) Object.assign(matrices[item.code], item)
    matrixVersions[item.code] = item.version || 0
  }
  currentStep.value = Math.max(0, Math.min(6, Number(value.current_step || 1) - 1))
}
async function loadList() {
  busy.value = true
  try { const value = await listFilings({ page: 1, page_size: 50 }); filings.value = value.items || [] }
  catch (error) { emit('error', error) }
  finally { busy.value = false }
}
async function openFiling(id) {
  busy.value = true
  try { applyDetail(await getFiling(id)) }
  catch (error) { emit('error', error) }
  finally { busy.value = false }
}
async function startFiling() {
  if (!canCreate.value) return
  // 创建响应未知时保留同一键；只有服务端明确返回草稿才释放，防止重复建档。
  busy.value = true; createIdempotencyKey ||= newKey()
  try { applyDetail(await createFiling({ project_id: '' }, createIdempotencyKey)); createIdempotencyKey = ''; emit('notice', '备案草稿已创建。') }
  catch (error) { emit('error', error) }
  finally { busy.value = false }
}
function handleConflict(error) {
  if (error?.status !== 409) return false
  // 任一子资源发生乐观锁冲突后停止整个编辑会话的自动暂存。继续保存可能拿旧
  // 快照覆盖其他页面的新内容，必须重新读取全部 section 和矩阵版本后再编辑。
  conflict.value = true; clearTimeout(saveTimer)
  emit('error', new Error('检测到其他页面已修改该备案。自动暂存已停止，请重新加载后再编辑；系统未覆盖服务端内容。'))
  return true
}
async function reloadCurrent() { if (filing.value) await openFiling(filing.value.id) }
async function persistSection(code, snapshot, idempotencyKey) {
  // 自动暂存必须串行提交快照。并发 PUT 即使内容来自先后输入，也会携带相同旧版本，
  // 后一个请求只能得到冲突；串行队列让每次保存使用上次返回的新版本。
  if (!filing.value || readonly.value) return
  saveState[code] = '正在保存…'
  try {
    const saved = await saveFilingSection(filing.value.id, code, { expected_version: sectionVersions[code], data: snapshot }, idempotencyKey)
    sectionVersions[code] = saved.version
    sectionIssues[code] = saved.validation_issues || []
    saveState[code] = `${saved.validation_status === 'VALID' ? '服务端已保存' : '服务端已保存（待完善）'} · v${saved.version}`
    // SaveSection 成功时后端在同一事务中把 filing head 版本加一。
    // 不立即 GET 整体详情，避免后续刷新短暂失败把已提交成功的保存误报为失败。
    filing.value.version += 1
  } catch (error) {
    saveState[code] = error?.status === 409 ? '版本冲突，已停止暂存' : '保存失败'
    if (!handleConflict(error)) emit('error', error)
    throw error
  }
}
function scheduleSave() {
  if (!filing.value || readonly.value) return
  const code = currentCode.value
  saveState[code] = '等待自动暂存…'; clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    const snapshot = structuredClone(sectionData[code])
    const idempotencyKey = newKey()
    // 前一次失败不能永久阻断队列；冲突状态会在 persistSection 内停止后续暂存。
    saveQueue = saveQueue.catch(() => {}).then(() => persistSection(code, snapshot, idempotencyKey))
  }, 900)
}
async function saveNow() {
  if (!filing.value || readonly.value) return
  clearTimeout(saveTimer)
  const code = currentCode.value
  const snapshot = structuredClone(sectionData[code])
  saveQueue = saveQueue.catch(() => {}).then(() => persistSection(code, snapshot, newKey()))
  await saveQueue.catch(() => {})
}
async function chooseMatrix(code, rowCode, columnCode) {
  if (readonly.value) return
  const current = matrices[code]
  const selected = !(current.selected && current.row_code === rowCode && current.column_code === columnCode)
  try {
    const result = await saveFilingMatrix(filing.value.id, code, { expected_filing_version: filing.value.version, expected_matrix_version: matrixVersions[code], row_code: selected ? rowCode : '', column_code: selected ? columnCode : '', selected }, newKey())
    Object.assign(current, result); matrixVersions[code] = result.version
    filing.value.version += 1
  } catch (error) { if (!handleConflict(error)) emit('error', error) }
}
async function runValidation() {
  await saveNow()
  if (conflict.value) return
  try { validation.value = await validateFiling(filing.value.id); if (validation.value.valid) emit('notice', '服务端全量校验已通过。') }
  catch (error) { emit('error', error) }
}
async function confirmSubmit() {
  if (!canSubmit.value || readonly.value) return
  await saveNow(); if (conflict.value) return
  try {
    validation.value = await validateFiling(filing.value.id)
    if (!validation.value.valid) return
    if (!window.confirm('确认提交并在 Portal 内部锁定？提交后客户不能继续修改；这不代表已经向公安机关提交。')) return
    // 校验通过到锁定完成之间若响应丢失，必须复用同一提交键，避免生成两个备案快照。
    submitIdempotencyKey ||= newKey()
    filing.value = await submitFiling(filing.value.id, { expected_version: filing.value.version }, submitIdempotencyKey)
    submitIdempotencyKey = ''; emit('notice', '备案快照已锁定，正在等待正式公安提交契约；当前不代表已向公安提交。')
  } catch (error) {
    if (error?.details && Array.isArray(error.details)) validation.value = { valid: false, issues: error.details }
    if (!handleConflict(error)) emit('error', error)
  }
}

onMounted(loadList)
</script>

<template>
  <section class="filing-workspace" aria-labelledby="filing-title">
    <div class="portal-title"><h1 id="filing-title">等保备案信息</h1><p>固定表单版本 {{ FORM_VERSION }}；当前实现为服务端约束的 2025 字段子集，不声称覆盖尚未确认的官方完整模板。</p></div>
    <div v-if="!filing" class="portal-card filing-list">
      <div class="filing-toolbar"><h2>我的备案</h2><button v-if="canCreate" type="button" :disabled="busy" @click="startFiling">新建备案</button></div>
      <button v-for="item in filings" :key="item.id" type="button" class="filing-list-row" @click="openFiling(item.id)"><span><strong>{{ item.filing_no }}</strong><small>版本 {{ item.form_version }} · 更新于 {{ new Date(item.updated_at).toLocaleString('zh-CN') }}</small></span><em>{{ statusText(item.status) }}</em></button>
      <p v-if="!busy && !filings.length">暂无备案记录。</p>
    </div>
    <template v-else>
      <div class="filing-toolbar portal-card"><div><button type="button" class="link-button" @click="filing = null; loadList()">← 返回列表</button><h2>{{ filing.filing_no }}</h2><small>表单 {{ filing.form_version }} · {{ statusText(filing.status) }} · 完成度 {{ filing.completion_pct }}% · 备案版本 v{{ filing.version }}</small></div><div><button type="button" :disabled="currentCode !== 'MATERIALS' || readonly || !materialUploadAvailable" @click="currentStep = 4">上传材料</button><button type="button" :disabled="!filingExportAvailable" :title="filingExportAvailable ? '生成备案 PDF' : '当前运行环境尚未启用备案 PDF 导出'">生成 PDF{{ filingExportAvailable ? '' : '（未接通）' }}</button></div></div>
      <p v-if="filing.status === 'WAITING_CONTRACT'" class="portal-warning">备案快照已在 Portal 内部锁定，尚未向公安机关提交；正式提交契约未配置时会保持此状态。</p>
      <p v-else-if="filing.status === 'SUBMITTING'" class="portal-info">正在通过正式公安 Provider 提交；重复投递使用同一业务事件号，页面不能修改快照。</p>
      <p v-else-if="filing.status === 'SUBMISSION_FAILED'" class="portal-error">公安提交重试已耗尽，备案仍未确认提交，请联系管理员核对失败原因并恢复处理。</p>
      <p v-else-if="filing.status === 'SUBMITTED'" class="portal-success">公安 Provider 已返回并验证回执，本记录已确认提交且保持只读；外部客户界面不提供管理员解锁操作。</p>
      <p v-if="conflict" class="portal-error" role="alert">存在版本冲突，自动暂存已停止。<button type="button" @click="reloadCurrent">重新加载服务端版本</button></p>
      <nav class="filing-steps" aria-label="备案填写步骤"><button v-for="([code, label], index) in steps" :key="code" type="button" :class="{ active: currentStep === index }" @click="currentStep = index"><span>{{ index + 1 }}</span>{{ label }}<small>{{ saveState[code] }}</small></button></nav>
      <section class="portal-card filing-step-panel">
        <header><div><h2>步骤 {{ currentStep + 1 }}：{{ steps[currentStep][1] }}</h2><small>section_code={{ currentCode }} · schema_version={{ FORM_VERSION }} · section version={{ sectionVersions[currentCode] }}</small></div><strong :class="saveState[currentCode].includes('失败') || saveState[currentCode].includes('冲突') ? 'save-bad' : 'save-good'">{{ saveState[currentCode] }}</strong></header>
        <p v-if="currentCode === 'MATERIALS' && !materialUploadAvailable" class="portal-warning">正式对象存储或病毒扫描尚未配置，材料上传已安全关闭；材料声明仍可暂存。</p><p v-else-if="currentCode === 'MATERIALS'" class="portal-info">材料先保存声明，再通过受控对象存储上传并完成病毒扫描；只有服务端返回 CLEAN 的不可变对象版本才允许锁定备案。</p>
        <div class="filing-fields" :aria-disabled="readonly">
          <template v-for="item in visibleFields" :key="item.key">
            <fieldset v-if="item.type === 'boolean'" class="filing-field"><legend>{{ item.label }}<span v-if="item.required"> *</span></legend><label><input v-model="sectionData[currentCode][item.key]" type="radio" :name="`${currentCode}-${item.key}`" :value="true" :disabled="readonly" @change="scheduleSave">是</label><label><input v-model="sectionData[currentCode][item.key]" type="radio" :name="`${currentCode}-${item.key}`" :value="false" :disabled="readonly" @change="scheduleSave">否</label></fieldset>
            <fieldset v-else-if="item.type === 'checks'" class="filing-field filing-wide"><legend>{{ item.label }}<span v-if="item.required"> *</span></legend><label v-for="option in item.options" :key="option[0]"><input v-model="sectionData[currentCode][item.key]" type="checkbox" :value="option[0]" :disabled="readonly" @change="scheduleSave">{{ option[1] }}</label></fieldset>
            <fieldset v-else-if="item.type === 'material'" class="filing-field filing-wide material-declaration"><legend>{{ item.label }} *</legend><label><input v-model="sectionData[currentCode][item.key]" type="radio" :name="`${currentCode}-${item.key}`" :value="true" :disabled="readonly" @change="scheduleSave">已有材料声明</label><label><input v-model="sectionData[currentCode][item.key]" type="radio" :name="`${currentCode}-${item.key}`" :value="false" :disabled="readonly" @change="scheduleSave">暂无材料</label><label v-if="sectionData[currentCode][item.key]">文件名元数据<input v-model.trim="sectionData[currentCode][item.fileKey]" maxlength="255" :disabled="readonly" placeholder="填写后选择同一文件上传" @input="scheduleSave"></label><template v-if="sectionData[currentCode][item.key]"><label>安全材料文件（PDF/PNG/JPG，最大 20 MiB）<input type="file" accept="application/pdf,image/png,image/jpeg" :disabled="readonly || materialBusy[item.key] || !materialUploadAvailable" @change="selectMaterialFile(item.key, $event)"></label><button type="button" :disabled="readonly || !materialFiles[item.key] || materialBusy[item.key] || !materialUploadAvailable" @click="uploadMaterial(item)">{{ materialBusy[item.key] ? '上传处理中…' : '上传并进入扫描' }}</button></template><em>上传状态：{{ materialStatusText(materialByCode[materialCodeByField[item.key]]?.scan_status) }}</em><small v-if="materialByCode[materialCodeByField[item.key]]">{{ materialByCode[materialCodeByField[item.key]].file_name }} · v{{ materialByCode[materialCodeByField[item.key]].version }}</small><p v-if="materialErrors[item.key]" class="portal-error" role="alert">{{ materialErrors[item.key] }}</p></fieldset>
            <label v-else class="filing-field" :class="{ 'filing-wide': item.type === 'textarea' }">{{ item.label }}<span v-if="item.required"> *</span>
              <select v-if="item.type === 'select'" v-model="sectionData[currentCode][item.key]" :required="item.required" :disabled="readonly" @change="scheduleSave"><option value="">请选择</option><option v-for="option in item.options" :key="option[0]" :value="option[0]">{{ option[1] }}</option></select>
              <select v-else-if="item.type === 'level'" v-model.number="sectionData[currentCode][item.key]" :required="item.required" :disabled="readonly" @change="scheduleSave"><option value="">请选择</option><option v-for="level in 5" :key="level" :value="level">第 {{ level }} 级</option></select>
              <textarea v-else-if="item.type === 'textarea'" v-model.trim="sectionData[currentCode][item.key]" :required="item.required" :disabled="readonly" maxlength="5000" @input="scheduleSave"></textarea>
              <input v-else-if="item.type === 'number'" v-model.number="sectionData[currentCode][item.key]" type="number" :required="item.required" :disabled="readonly" :min="item.min" @input="scheduleSave">
              <input v-else v-model.trim="sectionData[currentCode][item.key]" :type="item.type" :required="item.required" :disabled="readonly" :maxlength="item.maxlength" @input="scheduleSave">
            </label>
          </template>
        </div>
        <section v-if="sectionIssues[currentCode].length" class="section-issues" aria-live="polite"><h3>本节服务端校验提示</h3><ul><li v-for="issue in sectionIssues[currentCode]" :key="`${issue.path}-${issue.code}`">{{ issue.message }}（{{ issue.path }}）</li></ul></section>
        <section v-if="currentCode === 'CLASSIFICATION_REPORT'" class="filing-matrices">
          <h3>等级矩阵</h3><p>每张矩阵只能选择一个单元格；再次选择当前项可以撤销。原生单选控件支持 Tab、方向键和空格键。</p>
          <fieldset v-for="(title, matrixCode) in { BUSINESS_INFORMATION: '业务信息安全矩阵', SYSTEM_SERVICE: '系统服务安全矩阵' }" :key="matrixCode" :disabled="readonly"><legend>{{ title }} · matrix version={{ matrixVersions[matrixCode] }}</legend><table><thead><tr><th scope="col">受侵害客体</th><th v-for="column in matrixColumns" :key="column[0]" scope="col">{{ column[1] }}</th></tr></thead><tbody><tr v-for="row in matrixRows" :key="row[0]"><th scope="row">{{ row[1] }}</th><td v-for="column in matrixColumns" :key="column[0]"><label><input type="radio" :name="`matrix-${matrixCode}`" :checked="matrices[matrixCode].selected && matrices[matrixCode].row_code === row[0] && matrices[matrixCode].column_code === column[0]" :disabled="readonly" @change="chooseMatrix(matrixCode, row[0], column[0])"><span>{{ matrices[matrixCode].selected && matrices[matrixCode].row_code === row[0] && matrices[matrixCode].column_code === column[0] ? '已选择' : `${row[1]} / ${column[1]}` }}</span></label></td></tr></tbody></table><button v-if="matrices[matrixCode].selected" type="button" :disabled="readonly" @click="chooseMatrix(matrixCode, matrices[matrixCode].row_code, matrices[matrixCode].column_code)">撤销当前选择</button></fieldset>
        </section>
        <footer><button type="button" :disabled="currentStep === 0" @click="currentStep--">上一步</button><button type="button" :disabled="readonly" @click="saveNow">立即暂存</button><button v-if="currentStep < 6" type="button" @click="currentStep++">下一步</button><template v-else><button type="button" @click="runValidation">全量校验</button><button v-if="canSubmit" type="button" :disabled="readonly" @click="confirmSubmit">确认提交并锁定</button></template></footer><p v-if="currentStep === 6 && !policeSubmissionAvailable" class="portal-warning">本操作只锁定 Portal 内部备案快照；正式公安提交契约尚未启用，不会显示为已向公安提交。</p>
      </section>
      <section v-if="validation" class="portal-card filing-validation" aria-live="polite"><h2>服务端全量校验</h2><p v-if="validation.valid" class="portal-success">全部 7 个 section 与 2 张矩阵已通过校验。</p><template v-else><p class="portal-error">共有 {{ validation.issues?.length || 0 }} 项需要处理：</p><ol><li v-for="issue in validation.issues || []" :key="`${issue.path}-${issue.code}`">{{ issueLabel(issue) }}</li></ol></template></section>
    </template>
  </section>
</template>
