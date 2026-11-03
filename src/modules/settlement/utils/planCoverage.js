// SET-04 计划覆盖（合同金额对计划合计）的展示与提示。
// 服务端 GET /api/v1/plan-coverage 给出 gap / gap_percent / exceeds_threshold / triggered；
// 超阈值的改动只能由具备 settlement.finance.override 的财务负责人处置，页面只提示、绝不自动重试写入。

// 触发原因代码与文案：服务端 COVERAGE_GAP / SINGLE_INSTALLMENT_DROP 可同时命中。
export const PLAN_COVERAGE_TRIGGER_LABELS = Object.freeze({
  COVERAGE_GAP: "合计差额超阈值",
  SINGLE_INSTALLMENT_DROP: "单期降幅超阈值",
});

// 用途：把服务端触发原因代码翻译为中文；未知代码保留原文，不静默丢弃。
// 参数：triggered 为服务端返回的代码数组。
// 返回值：去空后的中文标签数组；无触发时为空数组。
export const planCoverageTriggerLabels = (triggered) =>
  (Array.isArray(triggered) ? triggered : [])
    .map((code) => {
      const raw = String(code ?? "").trim();
      if (!raw) return "";
      return PLAN_COVERAGE_TRIGGER_LABELS[raw] || `未识别触发原因（${raw}）`;
    })
    .filter(Boolean);

// 用途：给出差额合同的阈值判定标签与色调。
// 参数：item 为服务端差额视图。
// 返回值：超阈值时为失败语义并要求财务 override，否则为阈值内。
export const planCoverageStateMeta = (item) =>
  item?.exceeds_threshold
    ? { label: "超阈值 · 需财务 override", tone: "danger" }
    : { label: "阈值内", tone: "success" };

// 用途：说明差额方向（服务端约定：正数＝计划少计应收，负数＝计划超计）。
// 参数：gap 为差额字符串。
// 返回值：中文语义标签。
export const planCoverageGapLabel = (gap) =>
  Number.parseFloat(gap) < 0 ? "计划超计" : "计划少计";

// 超阈值处置说明：有 override 权限与无 override 权限必须给出不同且可执行的提示。
const OVERRIDE_HINT =
  "差额超过阈值不会自动重试保存：由具备结算财务 override 权限（settlement.finance.override）的财务负责人复核后，用该账号重新提交计划改动。";
const NO_OVERRIDE_HINT =
  "当前账号没有结算财务 override 权限（settlement.finance.override），超阈值的计划改动会被服务端拒绝（409）。请联系财务负责人处理，页面不会自动重试。";

// 用途：按当前账号能力返回超阈值处置说明。
// 参数：canOverride 表示当前会话是否具备结算财务 override 权限。
// 返回值：中文提示文案。
export const planCoverageHint = (canOverride) => (canOverride ? OVERRIDE_HINT : NO_OVERRIDE_HINT);
