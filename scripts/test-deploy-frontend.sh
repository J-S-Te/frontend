#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/deploy-frontend-remote.sh"
fixture="$(mktemp -d)"
trap 'rm -rf -- "$fixture"' EXIT
deploy_dir="$fixture"
compose_project=basic-platform-production
mkdir -p "$fixture/bin" "$fixture/runtime"
: > "$fixture/docker-compose.yml"
: > "$fixture/bin/deploy-service.sh"
chmod +x "$fixture/bin/deploy-service.sh"
: > "$fixture/bin/provisioner-config-refresh.sh"
agent_state='restarting unhealthy'
docker() {
  if [[ "$1" == ps ]]; then printf 'container\n'; return; fi
  [[ "$1" == inspect ]] || return 1
  printf '%s\n' "$agent_state"
}
FRONTEND_PLATFORM_WAIT_SECONDS=0
if wait_frontend_platform_ready 2>/dev/null; then
  echo 'unhealthy platform must block frontend deployment' >&2; exit 1
fi
agent_state='running healthy'
wait_frontend_platform_ready
: > "$fixture/runtime/.control-plane-reload-required"
if wait_frontend_platform_ready 2>/dev/null; then
  echo 'pending paired reload must block frontend deployment' >&2; exit 1
fi
rm "$fixture/runtime/.control-plane-reload-required"
rm "$fixture/docker-compose.yml"
if wait_frontend_platform_ready 2>/dev/null; then
  echo 'legacy assets must block frontend deployment' >&2; exit 1
fi
: > "$fixture/docker-compose.yml"
attempts=0
frontend_platform_ready() { ((attempts += 1)); ((attempts >= 2)); }
sleep() { :; }
FRONTEND_PLATFORM_WAIT_SECONDS=5
wait_frontend_platform_ready >/dev/null
[[ "$attempts" == 2 ]]
printf 'PASS: unhealthy/legacy/pending-reload rejection and readiness recovery\n'
