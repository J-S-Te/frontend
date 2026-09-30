#!/usr/bin/env bash
set -Eeuo pipefail

# Run on the deployment host. Platform assets and its Agent must be upgraded
# before a parallel frontend release can refresh the shared release pointer.
frontend_platform_ready() {
  local service container state
  [[ -f "$deploy_dir/docker-compose.yml" && -x "$deploy_dir/bin/deploy-service.sh" &&
     -f "$deploy_dir/bin/provisioner-config-refresh.sh" &&
     ! -e "$deploy_dir/runtime/.control-plane-reload-required" ]] || return 1
  for service in platform-api subsystem-provisioner; do
    container="$(docker ps -q --filter "label=com.docker.compose.project=$compose_project" \
      --filter "label=com.docker.compose.service=$service")" || return 1
    [[ -n "$container" && "$container" != *$'\n'* ]] || return 1
    state="$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container")" || return 1
    [[ "$state" == 'running healthy' ]] || return 1
  done
}

wait_frontend_platform_ready() {
  local timeout="${FRONTEND_PLATFORM_WAIT_SECONDS:-900}" deadline
  [[ "$timeout" =~ ^[0-9]+$ && ${#timeout} -le 4 ]] && ((10#$timeout <= 1800)) || {
    echo 'FRONTEND_PLATFORM_WAIT_SECONDS must be an integer between 0 and 1800' >&2
    return 1
  }
  deadline=$((SECONDS + 10#$timeout))
  until frontend_platform_ready; do
    if ((SECONDS >= deadline)); then
      echo '平台发布前置条件未满足：需要统一编排资产，以及健康的 platform-api 和 subsystem-provisioner。' >&2
      echo '请先完成基础平台发布；若资产要求重载，执行 bin/deploy.sh reload-control-plane 后再发布前端。' >&2
      return 1
    fi
    echo '等待基础平台升级及控制面就绪，暂未切换前端镜像。'
    sleep 5
  done
}

deploy_frontend_remote() {
  [[ $# -eq 2 ]] || { echo 'usage: deploy-frontend-remote.sh <deploy-dir> <image-ref>' >&2; return 2; }
  deploy_dir="$1"
  local image_ref="$2"
  [[ -d "$deploy_dir" && -f "$deploy_dir/.env" ]] || { echo '部署目录或平台配置不存在' >&2; return 1; }
  compose_project="$(awk -F= '$1 == "COMPOSE_PROJECT_NAME" {print substr($0,index($0,"=")+1); exit}' "$deploy_dir/.env")"
  compose_project="${compose_project:-basic-platform-production}"
  [[ "$compose_project" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo 'COMPOSE_PROJECT_NAME 格式错误' >&2; return 1; }
  wait_frontend_platform_ready || return 1
  cd -- "$deploy_dir"
  ./bin/deploy-service.sh frontend "$image_ref"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  deploy_frontend_remote "$@"
fi
