import { formatUserError, safeUserMessage } from '../../shared/utils/userError.js'

// 这些键属于 CRM 公开的业务错误契约，不是原始异常文本。
const messages = Object.freeze({
  CRM_CUSTOMER_DUPLICATE_CREDIT_CODE: '该统一社会信用代码已存在，请先搜索已有客户，避免重复建档。',
  CRM_CUSTOMER_DUPLICATE_NAME: '发现同名客户，请先核对已有客户；确需重复建档时请联系有权限的人员处理。',
  CRM_CUSTOMER_INVALID_REGISTRATION_CONTACT: '请设置且仅设置一位登记联系人后再保存。',
  CRM_CUSTOMER_MASTER_DATA_INVALID: '客户基础资料不完整或选项已失效，请检查客户名称、客户类型、行业和区域后重新提交。',
  CRM_CUSTOMER_CHANGE_REASON_REQUIRED: '请填写本次变更原因后再提交。',
  CRM_CUSTOMER_STAKEHOLDERS_INVALID: '关键干系人信息不符合要求，请检查姓名、联系方式及必填项后再保存。',
  CRM_CUSTOMER_SYSTEMS_INVALID: '客户信息系统资料不符合要求，请检查系统名称和保护等级后再保存。',
  CRM_CUSTOMER_INACTIVE: '该客户已作废，不能编辑；请先核对并恢复客户后再操作。',
  CRM_CUSTOMER_NOT_VOID: '该客户当前不是已作废状态，无需恢复；请刷新客户详情。',
  CRM_CUSTOMER_VOID_BLOCKED: '客户仍有关联中的商机、售前申请或门户邀请，暂不能作废。',
  CRM_CUSTOMER_MERGE_SAME_CUSTOMER: '来源客户和目标客户不能相同，请重新选择。',
  CRM_CUSTOMER_MERGE_REQUIRES_ACTIVE: '只能合并有效客户，请先核对来源和目标客户状态。',
  CRM_CUSTOMER_MERGE_BLOCKED: '客户存在无法安全迁移的关联业务，本次未合并；请联系管理员核对依赖。',
  CRM_CUSTOMER_IMPORT_FILE_INVALID: 'Excel 内容或格式不符合导入要求，请使用下载的 .xlsx 模板填写后重新上传。',
  CRM_CUSTOMER_IMPORT_FILE_REJECTED: '导入文件未通过安全检查，请检查文件内容并重新生成后上传。',
  CRM_CUSTOMER_IMPORT_JOB_EXPIRED: '导入预检已过期，请重新上传并预检后再确认导入。',
  CRM_CUSTOMER_IMPORT_JOB_CONFLICT: '导入任务状态已变化，请重新读取预检结果后再操作。',
  CRM_CUSTOMER_CREATE_REPLAY_INVALID: '本次创建记录已变化，请先在客户列表核对创建结果，不要重复新建。',
  CRM_OPPORTUNITY_CONTRACT_REQUIRED: '进入签约阶段前，请先选择并核验属于当前客户的有效合同。',
  CRM_OPPORTUNITY_LOST_REASON_REQUIRED: '请先选择标准失败原因，再将商机转为失败。',
  CRM_OPPORTUNITY_INVALID_STAGE: '所选商机阶段不符合要求，请刷新阶段选项后重新选择。',
  CRM_OPPORTUNITY_CUSTOMER_FORBIDDEN: '所选客户已失效或不在当前账号的数据范围内，请重新选择可访问的客户。',
  CRM_OPPORTUNITY_INACTIVE: '商机已作废，不能执行此操作；请先核对并恢复。',
  CRM_OPPORTUNITY_NOT_VOID: '商机当前不是已作废状态，无需恢复；请刷新详情。',
  CRM_OPPORTUNITY_VOID_BLOCKED: '商机仍有关联中的业务，暂不能作废；请先处理关联事项。',
  CRM_OPPORTUNITY_OWNER_REQUIRED: '请从人员目录选择商机负责人后再保存。',
  CRM_OPPORTUNITY_MEMBER_INVALID: '所选团队人员已停用或不再具有本应用授权，请重新从基础平台人员目录选择。',
  CRM_OPPORTUNITY_INVALID_MEMBER_ROLE: '所选团队角色不受支持，请刷新角色选项后重新选择。',
  CRM_OPPORTUNITY_DUPLICATE_MEMBER: '团队中重复选择了同一人员，请去重后再保存。',
  CRM_OPPORTUNITY_TEAM_TOO_LARGE: '团队最多支持 50 名成员，请减少人员后再保存。',
  CRM_OPPORTUNITY_ATTACHMENT_INVALID: '附件信息不符合要求，请检查文件格式、大小和名称后重新选择文件。',
  CRM_OPPORTUNITY_ATTACHMENT_NOT_READY: '附件尚未完成安全校验或状态已变化，请刷新附件列表后再操作。',
  CRM_OPPORTUNITY_ATTACHMENT_REJECTED: '附件未通过安全检查，不能使用；请检查文件后重新上传。',
  CRM_OPPORTUNITY_CONTRACT_TRANSFER_NOT_READY: '商机须已签约且合同核验通过后才能转交，请先完成合同关联和核验。',
  CRM_OPPORTUNITY_CATALOG_INVALID: '商机类型或来源已失效，请重新选择后提交。',
  CRM_OPPORTUNITY_CATALOG_DUPLICATE: '同名配置已存在，请核对后使用已有配置或修改名称。',
  CRM_PRESALE_OPPORTUNITY_NOT_ELIGIBLE: '只有有效且仍在推进中的商机可以发起售前支持，请重新选择商机。',
  CRM_PRESALE_INVALID_TRANSITION: '售前申请状态已变化，当前不能执行此操作；请刷新详情核对可用操作。',
  CRM_PRESALE_INVALID_INPUT: '售前申请信息不符合要求，请检查关联商机、申请内容、人员及日期后重新提交。',
  CRM_PRESALE_REPORT_INVALID_FILTER: '报表筛选条件不符合要求，请检查起止时间、统计维度及人员、组织或商机选项。',
  CRM_PRESALE_INVALID_FILTER: '筛选条件不符合要求，请检查日期、状态及人员选项后重新查询。',
  CRM_OWNER_DIRECTORY_UNAVAILABLE: '基础平台人员目录暂不可用，请稍后重新读取目录；如已提交变更，请先核对结果，避免重复提交。',
  CRM_CREDIT_RULE_INVALID: '信用规则参数不符合要求，请检查宽限天数、连续次数和等级调整步长后再保存。',
  CRM_CREDIT_RULE_VERSION_CONFLICT: '信用规则已被其他操作修改，请刷新配置、核对最新参数后再保存。',
  CRM_CREDIT_APPLICATION_INVALID: '信用调整申请不符合要求，请选择目标等级并填写调整原因。',
  CRM_CREDIT_APPLICATION_SAME_LEVEL: '目标信用等级与当前等级相同，无需提交调整申请。',
  CRM_CREDIT_APPLICATION_PENDING_EXISTS: '该客户已有待审批的信用调整申请，请先查看并处理现有申请。',
  CRM_CREDIT_REJECTION_OPINION_REQUIRED: '请填写驳回意见后再提交。',
  CRM_CREDIT_APPLICATION_NOT_PENDING: '申请已不在待审批状态，请刷新待办列表核对处理结果。',
  CRM_CREDIT_APPLICATION_INVALIDATED: '客户已失效，不能继续处理该信用申请；请核对客户状态。',
  CRM_CREDIT_OWNER_DIRECTORY_UNAVAILABLE: '暂时无法确认信用审批接收人员，请联系管理员检查人员授权；请先核对提交结果，避免重复申请。',
  INTEGRATION_CONTRACT_NOT_CONFIGURED: '合同核验服务尚未配置，当前不能完成此操作，请联系管理员。',
})

export function formatCRMError(input, options = {}) {
  const code = options.code ?? input?.code
  const rawMessage = options.message ?? (typeof input === 'string' ? input : input?.message)
  const safe = safeUserMessage(rawMessage)
  const generic = /^(?:请求参数不合法|请求内容不合法|参数错误|参数无效|请求失败|操作失败|保存失败|提交失败|校验失败|服务暂时不可用|依赖服务暂时不可用)[。！!\s]*$/
  // 保留参数绑定诊断信息，供共享的字段与契约分类器使用。
  const contractDiagnostic = typeof rawMessage === 'string' && /unknown field|cannot unmarshal|unexpected end of json|invalid character|Field validation for/i.test(rawMessage)
  const message = !contractDiagnostic && !(safe && !generic.test(safe)) ? messages[code] : undefined
  return formatUserError(input, { ...options, ...(message ? { message } : {}) })
}
