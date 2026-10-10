#!/bin/sh
set -eu
# Empty means disabled. This listener is never the normal business gateway.
origin="${BI_EMBED_PUBLIC_ORIGIN:-}"
printf '%s\n' "map \$request_uri \$bi_frame_sources { default \"'self'\"; }" > /etc/nginx/conf.d/00-bi-frame-policy.conf
[ -n "$origin" ] || exit 0
case "$origin" in
  https://*) BI_EMBED_SCHEME=https; authority=${origin#https://} ;;
  http://127.*) BI_EMBED_SCHEME=http; authority=${origin#http://} ;;
  http://localhost|http://localhost:*) BI_EMBED_SCHEME=http; authority=${origin#http://} ;;
  *) echo 'BI embed requires HTTPS or loopback HTTP' >&2; exit 1 ;;
esac
case "$authority" in
  ''|*[!a-zA-Z0-9.:-]*|*:*:*) echo 'Invalid BI embed authority' >&2; exit 1 ;;
esac
host=${authority%%:*}
[ -n "$host" ] || exit 1
if [ "$authority" != "$host" ]; then
  port=${authority#*:}
  case "$port" in ''|*[!0-9]*) exit 1 ;; esac
  [ "$port" -ge 1 ] && [ "$port" -le 65535 ] || exit 1
fi
export BI_EMBED_HOST="$host" BI_EMBED_AUTHORITY="$authority" BI_EMBED_SCHEME
printf '%s\n' "map \$request_uri \$bi_frame_sources { default \"'self'\"; ~^/data_analysis(?:/|\$) \"'self' $origin\"; }" > /etc/nginx/conf.d/00-bi-frame-policy.conf
envsubst '${BI_EMBED_HOST} ${BI_EMBED_AUTHORITY} ${BI_EMBED_SCHEME}' \
  < /etc/nginx/gateway-templates/bi-embed.conf.template > /etc/nginx/conf.d/bi-embed.conf
