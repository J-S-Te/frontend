import { attachStructuredContext } from "@/modules/platform/shared/api/requestContext.js";
import { listQuery } from "./pagination.js";
import { revisionHoldQuery } from "../utils/revisionHold.js";
import { formatSettlementError } from "../utils/errors.js";
import { DOWNLOAD_TIMEOUT_MESSAGE, downloadRequestSignal } from "@/modules/shared/utils/downloadTimeout.js";
import { getCurrentPrincipal } from "@/modules/platform/auth/api/auth";
import {
  normalizeAuthorizationSession,
  principalIdentityID,
  shouldStartSubsystemLogin,
} from "@/modules/shared/authz/sessionCompatibility.js";

const PUBLIC_PATH_PREFIX = (
  import.meta.env?.VITE_SETTLEMENT_PUBLIC_PATH_PREFIX || "/settlement"
).replace(/\/$/, "");
const API_BASE_URL = (
  import.meta.env?.VITE_SETTLEMENT_API_BASE_URL || `${PUBLIC_PATH_PREFIX}/api/v1`
).replace(/\/$/, "");
let session = null;
let sessionPromise = null;
let loginStarted = false;
const retryKeys = new Map();

function isSettlementDevelopmentSession(value) {
  return (
    String(value?.catalog_version || "").trim().toLowerCase() === "development" &&
    String(value?.tenant_id || "").trim().toLowerCase() === "dev"
  );
}

function beginLogin({ force = false } = {}) {
  if (loginStarted) return;
  loginStarted = true;
  clearSettlementSessionCache();
  window.location.replace(`${PUBLIC_PATH_PREFIX}/auth/login${force ? "?prompt=login" : ""}`);
}

function idempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `settlement-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// 用途：验证业务响应的数据外壳与资源类型。
// 参数：body 为响应；path 为资源路径；method 为请求方法。
// 返回值：响应是否符合当前协议。
function validDataEnvelope(body, path, method) {
  // httpapi.write 始终返回 {data: ...}；不能把网关的空对象／裸数组当作成功。
  if (!isRecord(body) || !Object.hasOwn(body, "data")) return false;
  const data = body.data;
  const route = path.split("?")[0];
  if (route === "/auth/me") return isRecord(data) && !!data.tenant_id && !!(data.user_id || data.identity_id) && Array.isArray(data.permissions);
  if (method === "GET" && route === "/dunning/recipients") return Array.isArray(data) || (isRecord(data) && (Array.isArray(data.items) || (data.items === null && data.total === 0)));
  const listRoutes = ["/project-candidates", "/project-assignments", "/contract-references", "/receivable-plans", "/receivables", "/invoice-eligible-receivables", "/receipts", "/receipt-allocations", "/invoice-requests", "/tax-invoices", "/dunning/policies", "/dunning/cases", "/dunning/actions"];
  if (method === "GET" && (listRoutes.includes(route) || /^\/receipts\/[^/]+\/matches$/.test(route))) return Array.isArray(data);
  return isRecord(data) && Object.keys(data).length > 0;
}

// 用途：统一发送结算业务请求并保留会话、CSRF、幂等与未知写入结果语义。
// 参数：path为结算相对路径，options为方法、载荷、幂等及错误处理选项。
// 返回值：经接口契约校验的响应数据；认证、业务或传输错误抛出结构化异常。
export async function request(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const multipart =
    typeof FormData !== "undefined" && options.body instanceof FormData;
  const retryFingerprint = options.idempotent
    ? `${method}:${path}:${options.idempotencyFingerprint || String(options.body || "")}`
    : "";
  const retryKey = retryFingerprint
    ? retryKeys.get(retryFingerprint) || idempotencyKey()
    : "";
  if (retryFingerprint) retryKeys.set(retryFingerprint, retryKey);
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      credentials: "include",
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body
          ? {
              ...(multipart ? {} : { "Content-Type": "application/json" }),
              "X-CSRF-Token": "1",
            }
          : {}),
        ...(retryKey ? { "Idempotency-Key": retryKey } : {}),
        ...(options.headers || {}),
      },
    });
  } catch (cause) {
    const code = cause?.name === "AbortError" || cause?.name === "TimeoutError" ? "REQUEST_TIMEOUT" : "NETWORK_ERROR";
    const error = new Error(method === "GET"
      ? formatSettlementError(cause, { code, status: 0, method, fallback: "无法连接结算服务，请检查网络后重试。" })
      : "连接中断，尚无法确认本次操作是否已生效。请先刷新列表核对结果，勿重复提交。");
    error.status = 0;
    error.code = code;
    attachStructuredContext(
      error,
      {
        subsystem: "settlement",
        feature: "api",
        operation: method,
        path,
        method,
        metadata: { network: true },
      },
      { status: 0, code },
    );
    error.cause = cause;
    throw error;
  }
  const requestID = response.headers.get("x-request-id") || "";
  const traceID = response.headers.get("x-trace-id") || "";
  const contentType = response.headers.get("content-type") || "";
  let body = {};
  let parseCause = null;
  if (/\bapplication\/(?:[\w.-]+\+)?json\b/i.test(contentType)) {
    try { body = await response.json(); } catch (cause) { parseCause = cause; }
  }
  const businessError = isRecord(body) && Object.hasOwn(body, "code") && body.code !== "OK";
  if (!response.ok || businessError) {
    const error = new Error(formatSettlementError(body, { status: response.status, method, fallback: "结算服务暂时无法处理请求。" }));
    error.status = response.status;
    error.code = body?.code;
    error.details = body?.details;
    error.requestID = body?.request_id || requestID;
    error.traceId = body?.trace_id || body?.traceId || traceID;
    if (parseCause) error.cause = parseCause;
    attachStructuredContext(
      error,
      {
        subsystem: "settlement",
        feature: "api",
        operation: method,
        path,
        method,
      },
      { status: response.status, code: error.code, requestId: error.requestID, traceId: error.traceId },
    );
    if (shouldStartSubsystemLogin(error)) beginLogin();
    if (
      retryFingerprint &&
      response.status >= 400 &&
      response.status < 500 &&
      response.status !== 408 &&
      response.status !== 429
    )
      retryKeys.delete(retryFingerprint);
    throw error;
  }
  if (options.responseType === "blob" && /attachment/i.test(response.headers.get("content-disposition") || "") && !/json|html/i.test(contentType)) {
    try {
      const blob = await response.blob();
      if (blob.size) return { blob, disposition: response.headers.get("content-disposition") };
    } catch (cause) {
      // 超时可能发生在下载响应体读取阶段；此时必须给出可重试的超时提示，
      // 不能降级成“数据格式异常”或当作成功。
      if (cause?.name === "AbortError" || cause?.name === "TimeoutError") throw settlementDownloadTimeoutError(cause, path, method);
      parseCause = cause;
    }
  } else if (!parseCause && /\bapplication\/(?:[\w.-]+\+)?json\b/i.test(contentType) && options.responseType !== "blob" && validDataEnvelope(body, path, method)) {
    if (retryFingerprint) retryKeys.delete(retryFingerprint);
    return body.data;
  }
  // 2xx 后的损坏响应不能当成失败后重新执行，尤其是开票、回款等写入。
  const invalid = new Error(method === "GET"
    ? "服务返回的数据格式异常，请刷新页面后重试；仍失败时请联系管理员。"
    : "服务器已接受操作，但返回结果异常。请先刷新列表核对结果，勿重复提交。");
  invalid.status = response.status;
  invalid.code = "INVALID_RESPONSE";
  invalid.requestID = requestID;
  invalid.traceId = traceID;
  if (parseCause) invalid.cause = parseCause;
  attachStructuredContext(invalid, { subsystem: "settlement", feature: "api", operation: method, path, method }, { status: response.status, code: invalid.code, requestId: requestID, traceId: traceID });
  throw invalid;
}

// 用途：下载响应体读取阶段被超时中断时，转换成可重试的可读错误。
// 参数：cause 为中断原因；path 为下载路径；method 为请求方法。
// 返回值：带 REQUEST_TIMEOUT 码与结构化上下文的错误。
function settlementDownloadTimeoutError(cause, path, method) {
  const error = new Error(DOWNLOAD_TIMEOUT_MESSAGE);
  error.status = 0;
  error.code = "REQUEST_TIMEOUT";
  error.cause = cause;
  attachStructuredContext(
    error,
    { subsystem: "settlement", feature: "download", operation: method, path, method, metadata: { timeout: true } },
    { status: 0, code: error.code },
  );
  return error;
}

export function clearSettlementSessionCache() {
  session = null;
  sessionPromise = null;
}
export async function getSettlementSession({ force = false } = {}) {
  if (!force && session) return session;
  if (!force && sessionPromise) return sessionPromise;
  sessionPromise = request("/auth/me")
    .then((value) => {
      session = normalizeAuthorizationSession(value);
      return session;
    })
    .finally(() => {
      sessionPromise = null;
    });
  return sessionPromise;
}
export async function ensureSettlementSession() {
  try {
    // 两侧 `/auth/me` 互不依赖，并行发起可把进入结算系统的导航缩短一个往返；
    // 失败语义不变：平台侧失败仍被吞掉，结算侧失败仍由 shouldStartSubsystemLogin 处理。
    const [settlementSession, platformResult] = await Promise.all([
      getSettlementSession({ force: true }),
      getCurrentPrincipal().then(
        (principal) => ({ ok: true, principal }),
        (error) => ({ ok: false, error }),
      ),
    ]);
    // 本地 DevelopmentAuth 使用固定的 dev-finance 主体，不是基础平台 OIDC
    // 用户。若仍做跨系统主体比较，会永久命中“账号已切换”，形成
    // local-logout -> /auth/login -> /settlement/dashboard 的刷新循环。
    // 生产 OIDC 会话不会携带 development/dev 标记，继续执行严格一致性校验。
    if (isSettlementDevelopmentSession(settlementSession)) {
      return settlementSession;
    }
    try {
      if (platformResult.ok) {
        const platformPrincipal = platformResult.principal;
        const platformIdentityID = principalIdentityID(platformPrincipal);
        const settlementIdentityID = principalIdentityID(settlementSession);
        const platformTenantID = String(platformPrincipal?.tenant_id || platformPrincipal?.tenant?.id || "");
        const tenantChanged = platformTenantID && platformTenantID !== String(settlementSession?.tenant_id || "");
        const userChanged = platformIdentityID && settlementIdentityID && platformIdentityID !== settlementIdentityID;
        if (userChanged || tenantChanged) {
          await clearSettlementLocalSession();
          beginLogin({ force: true });
          return null;
        }
      }
    } catch {
      // 基础平台暂时不可用时，Settlement 自己的有效 OIDC 会话继续生效。
    }
    return settlementSession;
  } catch (error) {
    // 真正未鉴权时必须主动发起 OIDC 跳转，否则路由守卫只看到 null
    // 会静默中止跳转，用户点击卡片后看不到任何反馈。
    if (shouldStartSubsystemLogin(error)) {
      beginLogin();
      return null;
    }
    throw error;
  }
}

async function clearSettlementLocalSession() {
  clearSettlementSessionCache();
  try {
    await fetch(`${PUBLIC_PATH_PREFIX}/auth/local-logout`, {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json", "X-CSRF-Token": "1" },
    });
  } catch {
    // OIDC 回调会覆盖旧 Cookie；清理失败不应形成重定向循环。
  }
}
export const getDashboard = () => request("/dashboard");
export const getInvoicedReceivablesTop10 = () =>
  request("/reports/invoiced-receivables-top10");
export const createInvoicedReceivablesExport = () =>
  request("/reports/invoiced-receivables/export", {
    method: "POST",
    body: JSON.stringify({}),
    idempotent: true,
  });
export const createAgingReceivablesExport = () =>
  request("/reports/aging/export", {
    method: "POST",
    body: JSON.stringify({}),
    idempotent: true,
  });
export const getReportExport = (id) =>
  request(`/reports/exports/${encodeURIComponent(id)}`);
export const downloadReportExport = (id) => downloadFile(`/reports/exports/${encodeURIComponent(id)}/download`, "结算报表.csv");

async function downloadFile(path, fallbackName) {
  // 报表、发票、回单、对账 CSV 等下载统一附加超时 signal；上传不经过此函数。
  const downloadAbort = downloadRequestSignal();
  const { blob, disposition } = await request(path, { responseType: "blob", signal: downloadAbort.signal });
  let fileName = fallbackName;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition || "");
  const plain = /filename="([^\"]+)"|filename=([^;]+)/i.exec(disposition || "");
  try { fileName = encoded ? decodeURIComponent(encoded[1]) : plain ? (plain[1] || plain[2]).trim() : fallbackName; } catch { fileName = fallbackName; }
  fileName = fileName.replace(/[\\/\x00-\x1f\x7f]/g, "_").slice(0, 200) || fallbackName;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  try { document.body.appendChild(anchor); anchor.click(); }
  finally { anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60000); }
}
export const listReceivablePlans = (page) => request(`/receivable-plans${listQuery(page)}`);
export const confirmReceivablePlan = (id, payload) =>
  request(`/receivable-plans/${encodeURIComponent(id)}/confirm`, {
    method: "POST",
    body: JSON.stringify(payload),
    idempotent: true,
  });
export const listReceivables = (page) => request(`/receivables${listQuery(page)}`);
// 用途：读取"合同金额对计划合计"的只读差额视图（SET-04）。
// 参数：contractSnapshotID 为空时读取可见范围内全部差额合同。
// 返回值：{ items: [{ contract_no, contract_amount, plan_total, gap, gap_percent, exceeds_threshold, triggered, contract_event_plan }] }。
export const getPlanCoverage = (contractSnapshotID = "") => {
  const snapshot = String(contractSnapshotID || "").trim();
  return request(`/plan-coverage${snapshot ? `?contract_snapshot_id=${encodeURIComponent(snapshot)}` : ""}`);
};
// 仅返回服务端确认可用于开票的应收，避免前端自行判断合同和余额状态。
export const listInvoiceEligibleReceivables = (page) =>
  request(`/invoice-eligible-receivables${listQuery(page)}`);
export const listReceipts = (page) => request(`/receipts${listQuery(page)}`);
export const listReceiptMatches = (id) =>
  request(`/receipts/${encodeURIComponent(id)}/matches`);
export const createReceipt = (payload) =>
  request("/receipts", {
    method: "POST",
    body: JSON.stringify(payload),
    idempotent: true,
  });
export const createReceiptAllocation = (payload) =>
  request("/receipt-allocations", {
    method: "POST",
    body: JSON.stringify(payload),
    idempotent: true,
  });
export const listReceiptAllocations = (page) => request(`/receipt-allocations${listQuery(page)}`);
export const reverseReceiptAllocation = (id, payload) =>
  request(`/receipt-allocations/${encodeURIComponent(id)}/reverse`, {
    method: "POST",
    body: JSON.stringify(payload),
    idempotent: true,
  });
export const listInvoiceRequests = (page) => request(`/invoice-requests${listQuery(page)}`);
export const listTaxInvoices = (page) => request(`/tax-invoices${listQuery(page)}`);
export const recoverInvoiceFailure = (id, payload) =>
  request(`/invoice-requests/${encodeURIComponent(id)}/recover-failure`, {
    method: "POST", body: JSON.stringify(payload), idempotent: true,
  });
export const getTaxInvoice = (id) =>
  request(`/tax-invoices/${encodeURIComponent(id)}`);
export const uploadTaxInvoiceDocument = (id, file) => {
  const body = new FormData();
  body.append("document_type", "ELECTRONIC_INVOICE");
  body.append("file", file);
  return request(`/tax-invoices/${encodeURIComponent(id)}/documents`, {
    method: "POST",
    body,
    idempotent: true,
    idempotencyFingerprint: `${file.name}:${file.size}:${file.lastModified}`,
  });
};
export const downloadTaxInvoiceDocument = (invoiceID, documentID) => downloadFile(`/tax-invoices/${encodeURIComponent(invoiceID)}/documents/${encodeURIComponent(documentID)}/download`, "电子发票");
export const requestTaxInvoiceRedFlush = (id, payload) =>
  request(`/tax-invoices/${encodeURIComponent(id)}/red-flush`, {
    method: "POST",
    body: JSON.stringify(payload),
    idempotent: true,
  });
export const approveInvoiceRedFlush = (id, version) =>
  request(`/invoice-red-flush-requests/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    body: JSON.stringify({ version }),
    idempotent: true,
  });
export const rejectInvoiceRedFlush = (id, version, reason) =>
  request(`/invoice-red-flush-requests/${encodeURIComponent(id)}/reject`, {
    method: "POST",
    body: JSON.stringify({ version, reason }),
    idempotent: true,
  });
export const createInvoiceRequest = (payload) =>
  request("/invoice-requests", {
    method: "POST",
    body: JSON.stringify(payload),
    idempotent: true,
  });
export const approveInvoiceRequest = (id, version) =>
  request(`/invoice-requests/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    body: JSON.stringify({ version }),
    idempotent: true,
  });
export const rejectInvoiceRequest = (id, version, reason) =>
  request(`/invoice-requests/${encodeURIComponent(id)}/reject`, {
    method: "POST",
    body: JSON.stringify({ version, reason }),
    idempotent: true,
  });
// 用途：作废确定未被税控受理的开票申请并释放未开票的额度预留（SET-06）。
// 参数：id 为开票申请；payload 含当前 version 与 5–1000 字作废原因。
// 返回值：服务端确认的作废结果；调用方不得据本地推断改状态，须以刷新后的列表为准。
export const cancelInvoiceRequest = (id, payload) =>
  request(`/invoice-requests/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    body: JSON.stringify(payload),
    idempotent: true,
  });
export const registerManualInvoice = (id, payload) =>
  request(`/invoice-requests/${encodeURIComponent(id)}/manual-issue`, {
    method: "POST",
    body: JSON.stringify(payload),
    idempotent: true,
  });
export const listDunningPolicies = (page) => request(`/dunning/policies${listQuery(page)}`);
/**
 * listDunningRecipients 查询当前租户内同时具备结算系统权限和催收角色的有效人员。
 *
 * 人员筛选由结算服务端完成，前端只负责展示服务端返回的候选项，避免把无权限
 * 用户或其他租户的人员暴露到催收策略表单中。
 */
export const listDunningRecipients = async () => {
  const page = await request("/dunning/recipients");
  // 人员接口返回分页对象，选择器消费人员数组；兼容旧版数组响应。
  return Array.isArray(page) ? page : page.items || [];
};
export const createDunningPolicy = (payload) =>
  request("/dunning/policies", {
    method: "POST",
    body: JSON.stringify(payload),
    idempotent: true,
  });
export const getDunningOverview = () => request("/dunning/overview");
export const getAgingSummary = () => request("/reports/aging");
export const getDunningCoverage = () => request("/dunning/coverage");
export const listDunningCases = (page) => request(`/dunning/cases${listQuery(page)}`);
export const listDunningActions = (page) => request(`/dunning/actions${listQuery(page)}`);
export const completeDunningAction = (id, payload) =>
  request(`/dunning/actions/${encodeURIComponent(id)}/complete`, {
    method: "POST",
    body: JSON.stringify(payload),
    idempotent: true,
  });

// 用途：读取角色补齐流程的业务资源，复用现有鉴权与错误协议。
// 参数：path 为结算 API 内的资源路径。
// 返回值：服务端业务结果；网络或授权失败时抛出错误。
export function getRoleResource(path) {
  return request(path);
}
// 用途：提交设置、协作、计划、加签及会计流程，保留请求幂等语义。
// 参数：path 为资源路径；payload 为业务字段；method 为写入方法。
// 返回值：服务端业务结果；失败时抛出带追踪信息的错误。
export function saveRoleResource(path, payload, method = 'POST') {
  return request(path, { method, body: JSON.stringify(payload), idempotent: true });
}
// 用途：下载已授权的回单影像。
// 参数：receiptID 为回款编号；documentID 为服务端返回的文件编号。
// 返回值：下载完成的 Promise；授权或文件失败时拒绝。
export function downloadReceiptDocument(receiptID, documentID) {
  return downloadFile(`/receipts/${encodeURIComponent(receiptID)}/documents/${encodeURIComponent(documentID)}/download`, '回单影像');
}

// 用途：读取受导入权限保护的暂存快照列表。
// 参数：offset为50条一页的偏移，不携带租户或范围覆盖参数。
// 返回值：服务器权威暂存列表。
export function listContractImports(offset = 0) {
  return request(`/settlement/contract-imports?limit=50&offset=${Math.max(0, Number(offset) || 0)}`);
}

// 用途：读取本地暂存状态和逐笔恢复映射。
// 参数：id为当前快照；offset为事实分页偏移，facts表示读取事实页。
// 返回值：真实状态或映射页，不将PREPARED当作放行。
export function getContractImport(id, { facts = false, offset = 0 } = {}) {
  return request(`/settlement/contract-imports/${encodeURIComponent(id)}${facts ? `/facts?limit=50&offset=${Math.max(0, Number(offset) || 0)}` : ''}`);
}

// 用途：生成财务本地核对凭证并记录当前用户批准的信用决定。
// 参数：id为暂存快照，payload含预期余额/到账/票额、币种、信用选择及理由。
// 返回值：版本化本地核对凭证；不直接解除HOLD。
export function reconcileContractImport(id, payload) {
  return request(`/settlement/contract-imports/${encodeURIComponent(id)}/reconcile`, { method: 'POST', body: JSON.stringify(payload), idempotent: true });
}

// 用途：生成或查询完整暂存对账导出。
// 参数：id为暂存快照，exportID为空时新建，否则读取持久任务。
// 返回值：SUCCEEDED/FAILED/PENDING及真实条数金额。
export function contractImportExport(id, exportID = '') {
  const prefix = `/settlement/contract-imports/${encodeURIComponent(id)}/exports`;
  return exportID ? request(`${prefix}/${encodeURIComponent(exportID)}`) : request(prefix, { method: 'POST', body: JSON.stringify({}), idempotent: true });
}

// 用途：下载已完成的完整暂存对账CSV。
// 参数：id为暂存快照，exportID为服务器返回的成功导出身份。
// 返回值：下载操作Promise；错误不生成空文件。
export function downloadContractImportExport(id, exportID) {
  return downloadFile(`/settlement/contract-imports/${encodeURIComponent(id)}/exports/${encodeURIComponent(exportID)}/download`, '历史合同财务对账.csv');
}

// 用途：读取合同财务修订工单分页，差异只展示服务端算好的 diff。
// 参数：status 为空不限状态；contractRef 同时匹配源合同ID与合同编号；
//       limit 1..100、offset 0..100000 由 revisionHoldQuery 前置校验。
// 返回值：{items,limit,offset} 服务端工单页；越权、只读许可期或参数越界时抛出已归一化的错误。
export function listContractRevisionHolds({ status = 'PENDING_REVIEW', contractRef = '', limit = 50, offset = 0 } = {}) {
  return request(`/contract-revision-holds${revisionHoldQuery({ status, contractRef, limit, offset })}`);
}

// 用途：财务完成调整或红冲后人工关闭修订工单。
// 参数：id为工单标识；reason为5–500字关单说明，同原因重放由服务端按幂等成功处理。
// 返回值：{id,status,resolution_reason} 服务端确认结果；调用方以刷新后的列表为准。
export function resolveContractRevisionHold(id, reason) {
  const holdID = String(id ?? '').trim();
  if (!holdID) throw new Error('修订工单标识缺失，请刷新列表后重新选择。');
  return request(`/contract-revision-holds/${encodeURIComponent(holdID)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ reason: String(reason ?? '').trim() }),
    idempotent: true,
  });
}

// 用途：经服务端逐次组织ACL及原文件摘要校验后下载真实财务证据。
// 参数：id为结算本地证据引用，不能传任意File Gateway文件标识。
// 返回值：受控附件下载完成或真实错误。
export const downloadRecognitionEvidence = (id) => downloadFile(`/recognitions/evidence/${encodeURIComponent(id)}/download`, '财务确认证据');
