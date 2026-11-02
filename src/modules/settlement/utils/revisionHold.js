// 合同财务修订工单（结算侧）的展示与校验纯函数。
// 契约来源：Settlement/internal/service/contract_revision.go
//   - ContractRevisionHold      → 列表项字段（hold_reason / diff / status / created_at …）；
//   - contractRevisionDetail    → diff 复合字段（from_version、old/new_contract_amount、
//                                 old/new_term_total、new_terms、diffs[]）；
//   - contractRevisionDiff      → diffs[] 单项（installment_no、kind、old/new_due_date、
//                                 old/new_amount、implemented_facts、references）。
// 本模块只做展示与本地校验，不推断服务端状态，也不改写任何业务事实。
import { formatBusinessDateTime } from "../../shared/utils/businessTime.js";
import { amountOf } from "./settlementDisplay.js";
import { formatSettlementError } from "./errors.js";

// 工单状态取值与服务端 settlement_contract_revision_hold.status 一致。
export const REVISION_HOLD_STATUS_PENDING = "PENDING_REVIEW";
export const REVISION_HOLD_STATUS_RESOLVED = "RESOLVED";
export const REVISION_HOLD_STATUSES = [REVISION_HOLD_STATUS_PENDING, REVISION_HOLD_STATUS_RESOLVED];

// 关单说明长度：服务端按 5 至 500 字校验，前端按字符数（码点）同口径拦截。
export const REVISION_HOLD_REASON_MIN = 5;
export const REVISION_HOLD_REASON_MAX = 500;
// 合同筛选上限与服务端 textTooLong(contract_ref, 128) 对齐。
export const REVISION_HOLD_CONTRACT_REF_MAX = 128;
// 分页上限与服务端 GET /contract-revision-holds 的 page() 校验对齐：limit 1..100、offset 0..100000。
export const REVISION_HOLD_PAGE_SIZE = 50;
export const REVISION_HOLD_MAX_LIMIT = 100;
export const REVISION_HOLD_MAX_OFFSET = 100000;

/** 按字符（码点）计数，避免按 UTF-16 长度把中文与增补平面字符算错。 */
export function revisionHoldLength(value) {
  return [...String(value ?? "")].length;
}

/**
 * 用途：拼接修订工单列表的查询串，并在发请求前拦住越界分页与非法状态。
 * 参数：status 为空表示不限状态；contractRef 同时匹配源合同 ID 与合同编号。
 * 返回值：以 ? 开头的查询串；参数非法时抛出可直接展示的中文错误。
 */
export function revisionHoldQuery({ status = "", contractRef = "", limit = REVISION_HOLD_PAGE_SIZE, offset = 0 } = {}) {
  const normalizedStatus = String(status ?? "").trim();
  const normalizedRef = String(contractRef ?? "").trim();
  if (normalizedStatus && !REVISION_HOLD_STATUSES.includes(normalizedStatus)) {
    throw new Error("工单状态筛选无效，请重新选择。");
  }
  if (revisionHoldLength(normalizedRef) > REVISION_HOLD_CONTRACT_REF_MAX) {
    throw new Error(`合同编号或合同 ID 最多 ${REVISION_HOLD_CONTRACT_REF_MAX} 字，请缩短后再查询。`);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > REVISION_HOLD_MAX_LIMIT) {
    throw new Error(`每页条数必须是 1 到 ${REVISION_HOLD_MAX_LIMIT} 之间的整数。`);
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > REVISION_HOLD_MAX_OFFSET) {
    throw new Error(`分页偏移必须是 0 到 ${REVISION_HOLD_MAX_OFFSET} 之间的整数。`);
  }
  const parts = [];
  if (normalizedStatus) parts.push(`status=${encodeURIComponent(normalizedStatus)}`);
  if (normalizedRef) parts.push(`contract_ref=${encodeURIComponent(normalizedRef)}`);
  parts.push(`limit=${limit}`, `offset=${offset}`);
  return `?${parts.join("&")}`;
}

export function revisionHoldStatusMeta(status) {
  const raw = String(status ?? "").trim();
  if (raw === REVISION_HOLD_STATUS_PENDING) return { label: "待复核", tone: "warning" };
  if (raw === REVISION_HOLD_STATUS_RESOLVED) return { label: "已关单", tone: "success" };
  if (!raw) return { label: "状态未知", tone: "danger" };
  return { label: `${raw} · 未识别状态`, tone: "danger" };
}

// 工单原因：只解释服务端已定义的两类原因，未知值保留原文供排查，不猜测处理结论。
export function revisionHoldReasonMeta(reason) {
  const raw = String(reason ?? "").trim();
  if (raw === "PLAN_DIFF_IMPLEMENTED_FACTS") {
    return {
      label: "条款差异待人工处理",
      note: "含已回款、核销、开票或预占事实的分期不会被自动改写，计划仍保留原金额与到期日。",
    };
  }
  if (raw === "TERM_TOTAL_MISMATCH") {
    return {
      label: "条款合计与合同金额不一致",
      note: "本次修订未落地：没有写新的合同快照，也没有改动收款计划。",
    };
  }
  if (!raw) return { label: "工单原因缺失", note: "服务端未返回工单原因，请按合同版本与差异明细核对。" };
  return { label: `未识别原因 · ${raw}`, note: "该原因不在当前页面识别的范围内，请按差异明细核对后再处理。" };
}

// 差异类型：仅描述事实（金额变化 / 到期日变化 / 删除），不表达处理结论。
export function revisionDiffKindLabel(kind) {
  const raw = String(kind ?? "").trim();
  const known = {
    AMOUNT_CHANGED: "金额变化",
    DUE_DATE_CHANGED: "到期日变化",
    AMOUNT_AND_DUE_DATE_CHANGED: "金额与到期日都变化",
    REMOVED: "新条款已删除该期",
  }[raw];
  if (known) return known;
  return raw ? `${raw} · 未识别差异` : "差异类型未知";
}

// 金额只按数字展示：工单接口未返回币种，页面不臆造币种符号。
export function revisionHoldAmount(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const amount = amountOf(text);
  if (!Number.isFinite(amount)) return "";
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

const IMPLEMENTED_FACT_LABELS = [
  ["received_allocated", "已回款核销"],
  ["write_off", "已核销"],
  ["invoiced", "已开票"],
  ["reserved", "已预占"],
];

// 已实现/已预占财务事实：只列出非零项，避免把 0.00 当成发生了事实。
export function revisionImplementedFacts(facts) {
  if (!facts || typeof facts !== "object") return [];
  return IMPLEMENTED_FACT_LABELS.flatMap(([key, label]) => {
    const amount = revisionHoldAmount(facts[key]);
    if (!amount || amountOf(facts[key]) === 0) return [];
    return [{ key, label, amount }];
  });
}

function normalizeRawDiff(input) {
  if (!input) return null;
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return typeof input === "object" && !Array.isArray(input) ? input : null;
}

/**
 * 用途：把服务端算好的 diff 转成可读的结构化摘要，供页面逐期核对。
 * 参数：input 为工单的 diff 字段（对象或 JSON 字符串）。
 * 返回值：结构化摘要；缺失或格式异常时 hasDiff 为 false，页面按"无差异明细"降级。
 */
export function summarizeRevisionHoldDiff(input) {
  const diff = normalizeRawDiff(input);
  if (!diff) {
    return {
      hasDiff: false,
      fromVersion: "",
      toVersion: "",
      oldContractAmount: "",
      newContractAmount: "",
      contractAmountChanged: false,
      oldTermTotal: "",
      newTermTotal: "",
      termTotalChanged: false,
      newTermsCount: 0,
      rows: [],
      hasRows: false,
      hasFacts: false,
    };
  }
  const rows = (Array.isArray(diff.diffs) ? diff.diffs : [])
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const kind = String(item.kind ?? "").trim();
      const facts = revisionImplementedFacts(item.implemented_facts);
      return {
        installmentNo: Number(item.installment_no) || 0,
        kind,
        kindLabel: revisionDiffKindLabel(kind),
        removed: kind === "REMOVED",
        oldDueDate: String(item.old_due_date ?? "").trim(),
        newDueDate: String(item.new_due_date ?? "").trim(),
        oldAmount: revisionHoldAmount(item.old_amount),
        newAmount: revisionHoldAmount(item.new_amount),
        facts,
        references: Number(item.references) || 0,
      };
    });
  const oldContractAmount = revisionHoldAmount(diff.old_contract_amount);
  const newContractAmount = revisionHoldAmount(diff.new_contract_amount);
  const oldTermTotal = revisionHoldAmount(diff.old_term_total);
  const newTermTotal = revisionHoldAmount(diff.new_term_total);
  return {
    hasDiff: true,
    fromVersion: Number.isInteger(Number(diff.from_version)) && Number(diff.from_version) > 0 ? Number(diff.from_version) : "",
    toVersion: Number.isInteger(Number(diff.to_version)) && Number(diff.to_version) > 0 ? Number(diff.to_version) : "",
    oldContractAmount,
    newContractAmount,
    contractAmountChanged: Boolean(oldContractAmount) && oldContractAmount !== newContractAmount,
    oldTermTotal,
    newTermTotal,
    termTotalChanged: Boolean(newTermTotal) && newTermTotal !== oldTermTotal,
    newTermsCount: Array.isArray(diff.new_terms) ? diff.new_terms.length : 0,
    rows,
    hasRows: rows.length > 0,
    hasFacts: rows.some((row) => row.facts.length > 0),
  };
}

// 关单时间：统一按北京口径展示，不直接显示服务端 UTC 串。
export function revisionHoldCreatedAt(value) {
  return formatBusinessDateTime(value, { seconds: true });
}

/**
 * 用途：本地校验关单说明，避免把必然被 400 拒绝的内容提交到服务端。
 * 参数：value 为用户输入。
 * 返回值：{ ok, reason, message }；ok 为真时 reason 为去除首尾空白后的值。
 */
export function validateRevisionHoldReason(value) {
  const reason = String(value ?? "").trim();
  const length = revisionHoldLength(reason);
  if (length === 0) return { ok: false, reason, message: "请填写关单说明，写明已完成的调整或红冲处理。" };
  if (length < REVISION_HOLD_REASON_MIN) {
    return { ok: false, reason, message: `关单说明至少 ${REVISION_HOLD_REASON_MIN} 字，请写明已完成的调整或红冲处理。` };
  }
  if (length > REVISION_HOLD_REASON_MAX) {
    return { ok: false, reason, message: `关单说明不能超过 ${REVISION_HOLD_REASON_MAX} 字，请精简后再提交。` };
  }
  return { ok: true, reason, message: "" };
}

// 服务端只认专用权限：GET 只要求 settlement.revision.read，POST 只要求 settlement.revision.resolve。
const FORBIDDEN_LIST =
  "当前账号没有修订工单读取权限（settlement.revision.read）。请联系结算财务负责人开通后重试。";
const FORBIDDEN_RESOLVE =
  "当前账号没有修订工单关单权限（settlement.revision.resolve）。只能查看差异，请由有权限的财务人员关单。";

/**
 * 用途：把关单/列表错误翻译成可执行的业务提示，区分许可只读期、越权、单据消失与冲突。
 * 参数：input 为 api 层抛出的错误；action 为 list 或 resolve。
 * 返回值：可直接展示的中文文案；未识别的情况回落到结算统一错误口径。
 */
export function formatRevisionHoldError(input, { action = "list" } = {}) {
  const status = Number(input?.status || 0);
  const code = String(input?.code || "");
  const resolving = action === "resolve";
  if (code === "COMMERCIAL_LICENSE_DENIED") {
    return "商业许可当前为只读期，不可操作：历史差异仍可查看，但不能关单。续期后再处理。";
  }
  if (status === 403 || code === "SETTLEMENT_FORBIDDEN") {
    return resolving ? FORBIDDEN_RESOLVE : FORBIDDEN_LIST;
  }
  if (status === 404 || code === "SETTLEMENT_NOT_FOUND") {
    return "该修订工单不存在，或不在当前账号可查看的合同范围内；请刷新列表后重新选择。";
  }
  if (status === 409 || code === "SETTLEMENT_CONFLICT") {
    return "该修订工单已被处理，或本次关单说明与已有记录不一致；请刷新列表核对后再操作，页面不会自动重试。";
  }
  if (status === 400 || code === "SETTLEMENT_INVALID_REQUEST") {
    return resolving
      ? `关单说明未通过校验，应为 ${REVISION_HOLD_REASON_MIN} 至 ${REVISION_HOLD_REASON_MAX} 字；请修改后重新提交。`
      : "筛选条件不符合要求，请检查工单状态、合同编号和分页后重试。";
  }
  return formatSettlementError(input, {
    status,
    method: resolving ? "POST" : "GET",
    fallback: resolving ? "关单未完成，请稍后重试。" : "修订工单暂时无法读取，请稍后重试。",
  });
}

/**
 * 用途：判断关单按钮是否可用，并给出禁用原因。
 * 参数：can 为结算页面统一的能力判断函数。
 * 返回值：空串表示可关单；否则为禁用原因文案。
 */
export function revisionHoldResolveBlockedReason(can) {
  if (typeof can !== "function") return "无法确认当前账号的关单权限，暂不能关单。";
  if (!can("settlement.revision.resolve")) {
    return "当前账号没有修订工单关单权限（settlement.revision.resolve），只能查看差异；请联系结算财务负责人关单。";
  }
  return "";
}
