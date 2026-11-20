#!/bin/sh
set -eu

enabled="${PUBLIC_HTTPS_ENABLED:-false}"
transition_state="${PUBLIC_TRANSPORT_STATE:-}"
platform_host="${PUBLIC_PLATFORM_HOST:-localhost}"
sso_host="${PUBLIC_SSO_HOST:-sso.localhost}"

case "$enabled" in
  true|false) ;;
  *) echo "PUBLIC_HTTPS_ENABLED must be true or false" >&2; exit 1 ;;
esac

valid_host() {
  value="$1"
  [ -n "$value" ] || return 1
  case "$value" in
    *://*|*/*|*\?*|*\#*|*[[:space:]]*) return 1 ;;
  esac
}

valid_host "$platform_host" || { echo "PUBLIC_PLATFORM_HOST must be a host without scheme or path" >&2; exit 1; }
valid_host "$sso_host" || { echo "PUBLIC_SSO_HOST must be a host without scheme or path" >&2; exit 1; }

export PUBLIC_PLATFORM_HOST="$platform_host"
export PUBLIC_SSO_HOST="$sso_host"

# 用途：渲染网关模板，同时保留 Nginx 请求变量。
# 参数：template 为内置网关模板的文件名。
# 返回值：写入网关配置成功返回 0，模板读取或渲染失败时返回非零。
render_gateway() {
  envsubst '${PUBLIC_PLATFORM_HOST} ${PUBLIC_SSO_HOST} ${PUBLIC_SSO_HTTP_HOST}
    ${PUBLIC_PLATFORM_HTTPS_AUTHORITY} ${PUBLIC_SSO_HTTPS_AUTHORITY}
    ${PUBLIC_SSO_TLS_LISTEN} ${PUBLIC_SSO_HTTPS_PORT}' \
    < "/etc/nginx/gateway-templates/$1" > /etc/nginx/conf.d/gateway.conf
}

if [ "$enabled" = "false" ] && [ "$transition_state" != "DISABLING_HTTPS" ]; then
  render_gateway gateway-http.conf.template
  exit 0
fi

# 用途：生成包含非默认端口的 HTTPS 主机地址。
# 参数：公开主机和端口，IPv6 主机可带方括号。
# 返回值：标准输出 HTTPS authority，端口无效时返回非零。
https_authority() {
  case "$2" in ''|*[!0-9]*) return 1 ;; esac
  [ "${#2}" -le 5 ] && [ "$2" -ge 1 ] && [ "$2" -le 65535 ] || return 1
  case "$1" in
    \[*\]) printf '%s' "$1" ;;
    *:*) printf '[%s]' "$1" ;;
    *) printf '%s' "$1" ;;
  esac
  if [ "$2" -ne 443 ]; then printf ':%s' "$2"; fi
}

platform_https_port="${PUBLIC_HTTPS_PORT:-443}"
sso_https_port="${PUBLIC_SSO_HTTPS_PORT:-$platform_https_port}"
PUBLIC_PLATFORM_HTTPS_AUTHORITY="$(https_authority "$platform_host" "$platform_https_port")"
PUBLIC_SSO_HTTPS_AUTHORITY="$(https_authority "$sso_host" "$sso_https_port")"
PUBLIC_SSO_HTTP_HOST="$sso_host"
PUBLIC_SSO_TLS_LISTEN=443
if [ "$platform_host" = "$sso_host" ]; then
  [ "$platform_https_port" -ne "$sso_https_port" ] || {
    echo "shared IP requires separate platform and SSO HTTPS ports" >&2; exit 1
  }
  PUBLIC_SSO_TLS_LISTEN=444
  PUBLIC_SSO_HTTP_HOST=sso.invalid
fi
export PUBLIC_PLATFORM_HTTPS_AUTHORITY PUBLIC_SSO_HTTPS_AUTHORITY PUBLIC_SSO_HTTP_HOST PUBLIC_SSO_TLS_LISTEN
export PUBLIC_SSO_HTTPS_PORT="$sso_https_port"

for path in /run/tls/platform.crt /run/tls/platform.key /run/tls/sso.crt /run/tls/sso.key; do
  [ -r "$path" ] && [ -f "$path" ] || { echo "HTTPS certificate material is missing or unreadable" >&2; exit 1; }
done

for path in /run/tls/platform.crt /run/tls/sso.crt; do
  openssl crl2pkcs7 -nocrl -certfile "$path" 2>/dev/null \
    | openssl pkcs7 -print_certs -noout >/dev/null 2>&1 || {
      echo "TLS certificate chain cannot be parsed" >&2
      exit 1
    }
done

openssl x509 -in /run/tls/platform.crt -noout -checkend 0 >/dev/null || {
  echo "platform TLS certificate is expired or not yet valid" >&2
  exit 1
}
openssl x509 -in /run/tls/sso.crt -noout -checkend 0 >/dev/null || {
  echo "SSO TLS certificate is expired or not yet valid" >&2
  exit 1
}
# 用途：启动网关前校验证书与该监听入口公开身份一致。
# 参数：证书链路径和公开主机。
# 返回值：身份和有效期匹配返回 0，否则返回非零。
certificate_covers_host() {
  certificate="$1"
  host="${2#[}"
  host="${host%]}"
  case "$host" in
    *:*) check_flag=-verify_ip ;;
    *[!0-9.]*) check_flag=-verify_hostname ;;
    *) check_flag=-verify_ip ;;
  esac
  openssl verify -partial_chain -trusted "$certificate" "$check_flag" "$host" "$certificate" >/dev/null
}

certificate_covers_host /run/tls/platform.crt "$platform_host" || {
  echo "platform TLS certificate does not cover PUBLIC_PLATFORM_HOST" >&2
  exit 1
}
certificate_covers_host /run/tls/sso.crt "$sso_host" || {
  echo "SSO TLS certificate does not cover PUBLIC_SSO_HOST" >&2
  exit 1
}

certificate_public_key() {
  openssl x509 -in "$1" -pubkey -noout | openssl pkey -pubin -outform DER 2>/dev/null | sha256sum | awk '{print $1}'
}
private_public_key() {
  openssl pkey -in "$1" -pubout -outform DER 2>/dev/null | sha256sum | awk '{print $1}'
}

[ "$(certificate_public_key /run/tls/platform.crt)" = "$(private_public_key /run/tls/platform.key)" ] || {
  echo "platform TLS private key does not match its certificate" >&2
  exit 1
}
[ "$(certificate_public_key /run/tls/sso.crt)" = "$(private_public_key /run/tls/sso.key)" ] || {
  echo "SSO TLS private key does not match its certificate" >&2
  exit 1
}

if [ "$transition_state" = "DISABLING_HTTPS" ]; then
  render_gateway gateway-draining.conf.template
else
  render_gateway gateway-https.conf.template
fi
