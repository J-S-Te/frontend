/**
 * 判断异步响应是否仍属于当前详情请求。
 * 组件只在版本、主体类型和主体 ID 全部一致时才允许回写状态。
 */
export function isCurrentAuthorizationRequest(request, current) {
  return Number(request?.version) === Number(current?.version)
    && String(request?.subjectType || '') === String(current?.subjectType || '')
    && String(request?.subjectId || '') === String(current?.subjectId || '')
    && String(request?.applicationCode || '') === String(current?.applicationCode || '')
}
