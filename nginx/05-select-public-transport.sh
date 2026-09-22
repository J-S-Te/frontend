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
export NGINX_ENVSUBST_FILTER='^(PUBLIC_PLATFORM_HOST|PUBLIC_SSO_HOST)$'

if [ "$enabled" = "false" ] && [ "$transition_state" != "DISABLING_HTTPS" ]; then
  cp /etc/nginx/gateway-templates/gateway-http.conf.template /etc/nginx/templates/gateway.conf.template
  exit 0
fi

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
openssl x509 -in /run/tls/platform.crt -noout -checkhost "$platform_host" >/dev/null || {
  echo "platform TLS certificate does not cover PUBLIC_PLATFORM_HOST" >&2
  exit 1
}
openssl x509 -in /run/tls/sso.crt -noout -checkhost "$sso_host" >/dev/null || {
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
  cp /etc/nginx/gateway-templates/gateway-draining.conf.template /etc/nginx/templates/gateway.conf.template
else
  cp /etc/nginx/gateway-templates/gateway-https.conf.template /etc/nginx/templates/gateway.conf.template
fi
