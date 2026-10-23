import { createRequest } from '../../shared/api/request.js'
import { RELATED_DATA, publishRelatedDataChanged } from '../../shared/utils/relatedDataInvalidation.js'

/** 保留服务端错误元数据，供设置页展示安全提示，不暴露原始响应和传输实现。 */
export class ApplicationLoginTargetError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'ApplicationLoginTargetError'
    this.status = options.status || 0
    this.code = options.code || ''
    this.traceId = options.traceId || ''
  }
}

async function readResponse(response) {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return response.json()
  }

  const text = await response.text()
  return text ? { message: text } : {}
}

const request = createRequest({
  ErrorClass: ApplicationLoginTargetError,
  networkMessage: '无法连接统一登录目标服务，请确认后端服务已启动。',
  failureMessage: '统一登录目标请求失败。',
  subsystem: 'platform',
  feature: 'login_targets',
})

function loginTargetCollectionPath(applicationId, environmentId) {
  return `/applications/${encodeURIComponent(applicationId)}/environments/${encodeURIComponent(environmentId)}/login-targets`
}

function loginTargetItemPath(applicationId, environmentId, loginTargetId) {
  return `${loginTargetCollectionPath(applicationId, environmentId)}/${encodeURIComponent(loginTargetId)}`
}

/** 列出精确应用环境内已批准的登录后落地目标，不能跨环境复用。 */
/**
 * 登录目标决定门户跳转白名单；写入确认成功后必须让应用 / 环境相关的选择器重新读取，
 * 否则门户和应用接入页会继续展示写入前的落地地址。
 */
function onWriteSuccess(promise) {
  return promise.then((result) => {
    publishRelatedDataChanged([RELATED_DATA.APPLICATIONS, RELATED_DATA.ENVIRONMENTS])
    return result
  })
}

export function listApplicationLoginTargets({ applicationId, environmentId, page = 1, pageSize = 20, status = '' }) {
  const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
  if (status) query.set('status', status)
  return request(`${loginTargetCollectionPath(applicationId, environmentId)}?${query.toString()}`)
}

/** 登记一个精确白名单业务落地地址；登录跳转只允许命中此类服务端记录。 */
export function createApplicationLoginTarget({ applicationId, environmentId, targetCode, name, targetUri, status }) {
  return onWriteSuccess(request(loginTargetCollectionPath(applicationId, environmentId), {
    method: 'POST',
    body: JSON.stringify({
      target_code: targetCode,
      name,
      target_uri: targetUri,
      status,
    }),
  }))
}

/** 以乐观锁更新目标；稳定的 target_code 不允许修改。 */
export function updateApplicationLoginTarget({ applicationId, environmentId, loginTargetId, name, targetUri, status, version }) {
  return onWriteSuccess(request(loginTargetItemPath(applicationId, environmentId, loginTargetId), {
    method: 'PATCH',
    body: JSON.stringify({
      name,
      target_uri: targetUri,
      status,
      version,
    }),
  }))
}
