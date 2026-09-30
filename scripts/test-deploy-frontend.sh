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
printf '#!/usr/bin/env bash\n[[ "${FIXTURE_NETWORK_READY:-true}" == true ]]\n' > "$fixture/bin/check-frontend-network.sh"
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
FIXTURE_NETWORK_READY=false
export FIXTURE_NETWORK_READY
if wait_frontend_platform_ready 2>/dev/null; then
  echo 'stale API proxy trust or invalid frontend network must block deployment' >&2; exit 1
fi
FIXTURE_NETWORK_READY=true
mv "$fixture/bin/check-frontend-network.sh" "$fixture/bin/check-frontend-network.sh.saved"
if wait_frontend_platform_ready 2>/dev/null; then
  echo 'missing network compatibility asset must block deployment' >&2; exit 1
fi
mv "$fixture/bin/check-frontend-network.sh.saved" "$fixture/bin/check-frontend-network.sh"
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
# Exercise the real SSH execution mode: bash -s has no BASH_SOURCE[0].
mkdir -p "$fixture/tools"
printf 'COMPOSE_PROJECT_NAME=basic-platform-production\n' > "$fixture/.env"
printf '#!/usr/bin/env bash\nif [[ "$1" == ps ]]; then echo container; else echo "running healthy"; fi\n' > "$fixture/tools/docker"
printf '#!/usr/bin/env bash\n[[ "$1" == frontend && "$2" == fixture-image ]]\necho stdin-deploy-passed\n' > "$fixture/bin/deploy-service.sh"
chmod +x "$fixture/tools/docker" "$fixture/bin/deploy-service.sh"
result="$(PATH="$fixture/tools:$PATH" FRONTEND_PLATFORM_WAIT_SECONDS=0 bash -s -- "$fixture" fixture-image < "$(dirname -- "${BASH_SOURCE[0]}")/deploy-frontend-remote.sh")"
[[ "$result" == stdin-deploy-passed ]]
printf 'PASS: unhealthy/legacy/pending-reload rejection and readiness recovery\n'
printf 'PASS: real bash -s stdin deployment entrypoint\n'
printf 'PASS: network compatibility and effective API proxy trust gate\n'
