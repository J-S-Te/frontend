import { attachStructuredContext } from "@/modules/platform/shared/api/requestContext.js";
import { getCurrentPrincipal } from "@/modules/platform/auth/api/auth";
import {
  normalizeAuthorizationSession,
  principalIdentityID,
  shouldStartSubsystemLogin,
} from "@/modules/shared/authz/sessionCompatibility.js";

const PUBLIC_PATH_PREFIX = (
  import.meta.env.VITE_SETTLEMENT_PUBLIC_PATH_PREFIX || "/settlement"
).replace(/\/$/, "");
const API_BASE_URL = (
  import.meta.env.VITE_SETTLEMENT_API_BASE_URL || `${PUBLIC_PATH_PREFIX}/api/v1`
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

async function request(path, options = {}) {
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
    const error = new Error("无法连接结算服务，请稍后重试。");
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
      { status: 0, code: "NETWORK_ERROR" },
    );
    error.cause = cause;
    throw error;
  }
  const body = (response.headers.get("content-type") || "").includes(
    "application/json",
  )
    ? await response.json()
    : {};
  if (!response.ok) {
    const error = new Error(body?.message || "结算服务暂时无法处理请求。");
    error.status = response.status;
    error.code = body?.code;
    error.requestID = body?.request_id || "";
    attachStructuredContext(
      error,
      {
        subsystem: "settlement",
        feature: "api",
        operation: method,
        path,
        method,
      },
      { status: response.status, code: error.code, requestId: error.requestID },
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
  if (retryFingerprint) retryKeys.delete(retryFingerprint);
  return body?.data ?? body;
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
    const settlementSession = await getSettlementSession({ force: true });
    // 本地 DevelopmentAuth 使用固定的 dev-finance 主体，不是基础平台 OIDC
    // 用户。若仍做跨系统主体比较，会永久命中“账号已切换”，形成
    // local-logout -> /auth/login -> /settlement/dashboard 的刷新循环。
    // 生产 OIDC 会话不会携带 development/dev 标记，继续执行严格一致性校验。
    if (isSettlementDevelopmentSession(settlementSession)) {
      return settlementSession;
    }
    try {
      const platformPrincipal = await getCurrentPrincipal();
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
export function downloadReportExport(id) {
  window.location.assign(
    `${API_BASE_URL}/reports/exports/${encodeURIComponent(id)}/download`,
  );
}
export const listReceivablePlans = () => request("/receivable-plans");
export const confirmReceivablePlan = (id, payload) =>
  request(`/receivable-plans/${encodeURIComponent(id)}/confirm`, {
    method: "POST",
    body: JSON.stringify(payload),
    idempotent: true,
  });
export const listReceivables = () => request("/receivables");
// 仅返回服务端确认可用于开票的应收，避免前端自行判断合同和余额状态。
export const listInvoiceEligibleReceivables = () =>
  request("/invoice-eligible-receivables");
export const listReceipts = () => request("/receipts");
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
export const listReceiptAllocations = () => request("/receipt-allocations");
export const reverseReceiptAllocation = (id, payload) =>
  request(`/receipt-allocations/${encodeURIComponent(id)}/reverse`, {
    method: "POST",
    body: JSON.stringify(payload),
    idempotent: true,
  });
export const listInvoiceRequests = () => request("/invoice-requests");
export const listTaxInvoices = () => request("/tax-invoices");
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
export function downloadTaxInvoiceDocument(invoiceID, documentID) {
  window.location.assign(
    `${API_BASE_URL}/tax-invoices/${encodeURIComponent(invoiceID)}/documents/${encodeURIComponent(documentID)}/download`,
  );
}
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
export const registerManualInvoice = (id, payload) =>
  request(`/invoice-requests/${encodeURIComponent(id)}/manual-issue`, {
    method: "POST",
    body: JSON.stringify(payload),
    idempotent: true,
  });
export const listDunningPolicies = () => request("/dunning/policies");
/**
 * listDunningRecipients 查询当前租户内同时具备结算系统权限和催收角色的有效人员。
 *
 * 人员筛选由结算服务端完成，前端只负责展示服务端返回的候选项，避免把无权限
 * 用户或其他租户的人员暴露到催收策略表单中。
 */
export const listDunningRecipients = () => request("/dunning/recipients");
export const createDunningPolicy = (payload) =>
  request("/dunning/policies", {
    method: "POST",
    body: JSON.stringify(payload),
    idempotent: true,
  });
export const listDunningCases = () => request("/dunning/cases");
export const listDunningActions = () => request("/dunning/actions");
