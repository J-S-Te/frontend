#!/usr/bin/env bash
# 用途：e2e 的本地统一入口。负责 Node 版本校验、测试凭据注入，并在需要视觉断言时
#       自动拉起共享浏览器、注入 CDP 端点、跑完回收。
# 参数：原样转发给 e2e 子命令，例如 run / report / list / mcp。
# 返回值：e2e 的退出码；环境不满足时返回非零并给出修复提示。
# 常用开关：
#   E2E_VISUAL=1        自动启动共享浏览器并注入 E2E_CDP_ENDPOINT（跑视觉断言时必须）
#   E2E_ONLINE=1        启用线上冒烟用例
#   APP_URL=...         覆盖应用地址
#   E2E_SERVER=external 不启动本地 dev server，直打外部地址
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

node_ok="$(node -e 'const v=process.versions.node.split(".").map(Number);
const ok=(v[0]>=25)||(v[0]===24&&v[1]>=8)||(v[0]===22&&(v[1]>22||(v[1]===22&&v[2]>=3)));
process.stdout.write(ok?"1":"0")')"

if [ "$node_ok" != "1" ]; then
  printf 'e2e 需要 Node >= 24.8 或 >= 22.22.3，当前为 %s\n请先执行 nvm use 24\n' "$(node -v)" >&2
  exit 1
fi

# 本地凭据与模型配置放在仓库根目录的 .e2e-secrets（已 gitignore）。
if [ -f .e2e-secrets ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.e2e-secrets
  set +a
fi

# Midscene 的报表/截图默认落在仓库根的 midscene_run/，统一收进 e2e 产物目录。
export MIDSCENE_RUN_DIR="${MIDSCENE_RUN_DIR:-.e2e/midscene}"

BROWSER_PID=""
cleanup() {
  if [ -n "$BROWSER_PID" ]; then
    kill "$BROWSER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# 需要视觉断言时自动拉起共享浏览器；已手动指定端点则沿用。
if [ "${E2E_VISUAL:-0}" = "1" ] && [ -z "${E2E_CDP_ENDPOINT:-}" ]; then
  BROWSER_PORT="${E2E_CDP_PORT:-9222}"
  BROWSER_OUT="$(bash scripts/e2e-browser.sh "$BROWSER_PORT")" || exit 1
  BROWSER_PID="$(printf '%s' "$BROWSER_OUT" | sed -n 's/^PID=//p')"
  export E2E_CDP_ENDPOINT="http://127.0.0.1:$BROWSER_PORT"
  printf '共享浏览器已就绪：%s（PID %s）\n' "$E2E_CDP_ENDPOINT" "$BROWSER_PID"
fi

if [ -x node_modules/.bin/e2e ]; then
  node_modules/.bin/e2e "$@"
else
  npx e2e "$@"
fi
