// 用途：复用既有结算transport创建本地财务API，保留认证、CSRF与网络重试键。
// 参数：request 为主API导出的现有请求函数。
// 返回值：有界查询及显式幂等写入方法；错误原样交给调用者。
export function createNativeFinancialAPI(request) {
  if (typeof request !== 'function') throw new TypeError('缺少结算请求函数')
  // 用途：将真实写命令交给已有幂等transport。
  // 参数：path 为财务资源路径，input 为服务端白名单请求。
  // 返回值：真实响应或请求错误。
  const write = (path, input) => request(path, {
    method: 'POST', body: JSON.stringify(input), idempotent: true,
  })
  // 用途：编码有界分页参数。
  // 参数：limit/offset 为列表页坐标。
  // 返回值：查询字符串，服务端继续校验界限。
  const page = ({ limit = 50, offset = 0 } = {}) =>
    `?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`
  return {
    // 用途：读取服务端本地能力与创建门禁。
    // 参数：无。
    // 返回值：真实能力响应或错误。
    capabilities: () => request('/financial-baselines/capabilities'),
    // 用途：读取本租户本地客户页。
    // 参数：query 为有界分页坐标。
    // 返回值：客户页或错误。
    listCustomers: (query) => request(`/financial-customers${page(query)}`),
    // 用途：登记由服务端生成身份的本地客户。
    // 参数：input 为客户名称。
    // 返回值：真实客户记录或错误。
    createCustomer: (input) => write('/financial-customers', input),
    // 用途：读取本租户本地依据历史页。
    // 参数：query 为有界分页坐标。
    // 返回值：依据页或错误。
    listBaselines: (query) => request(`/financial-baselines${page(query)}`),
    // 用途：读取一份真实本地依据。
    // 参数：id 为内部依据ID。
    // 返回值：依据详情或错误。
    getBaseline: (id) => request(`/financial-baselines/${encodeURIComponent(id)}`),
    // 用途：登记本地依据和待确认分期。
    // 参数：input 为完整本地依据请求。
    // 返回值：真实创建结果或错误。
    createBaseline: (input) => write('/financial-baselines', input),
    // 用途：请求保守作废未消费依据。
    // 参数：id 为内部依据ID，input 为预期版本和原因。
    // 返回值：真实作废结果或错误。
    voidBaseline: (id, input) => write(`/financial-baselines/${encodeURIComponent(id)}/void`, input),
  }
}
