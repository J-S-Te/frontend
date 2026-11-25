#!/usr/bin/env bash
# 用途：以 CDP 调试端口启动一个共享 Chromium，供 e2e 与第二个消费者（Midscene / 脚本）接管同一批页面。
# 参数：$1 为端口，默认 9222。
# 返回值：就绪返回 0 并打印 PID；二进制缺失或端口未就绪返回非零。
set -euo pipefail

PORT="${1:-9222}"

SHELL_BIN="${E2E_CHROME_BIN:-}"
if [ -z "$SHELL_BIN" ]; then
  SHELL_BIN="$(ls -d "$HOME"/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-*/chrome-headless-shell 2>/dev/null | tail -1)"
fi
if [ -z "$SHELL_BIN" ] || [ ! -x "$SHELL_BIN" ]; then
  printf '找不到 Chromium headless shell，请先跑一次 e2e run，或用 E2E_CHROME_BIN 指定路径\n' >&2
  exit 1
fi

PROFILE_DIR="$(mktemp -d)/e2e-shared-profile"
LOG_FILE="/tmp/e2e-shared-browser.log"

TLS_FLAG=""
if [ "${E2E_INSECURE_TLS:-0}" = "1" ]; then
  TLS_FLAG="--ignore-certificate-errors"
fi

"$SHELL_BIN" \
  --headless \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE_DIR" \
  --no-first-run \
  ${TLS_FLAG:+"$TLS_FLAG"} \
  about:blank >"$LOG_FILE" 2>&1 &
PID=$!

for _ in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
    printf 'PID=%s\n' "$PID"
    printf 'E2E_CDP_ENDPOINT=http://127.0.0.1:%s\n' "$PORT"
    exit 0
  fi
  sleep 0.3
done

printf 'Chromium 未在预期时间内就绪，日志见 %s\n' "$LOG_FILE" >&2
exit 1
