#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/var/www/rosomaha}"
CRM_ROOT="${CRM_ROOT:-/var/www/crm}"
TENANT_ID="${FINANCE_TENANT_ID:-1}"
SECRET_DIR="${FINANCE_SECRET_DIR:-/etc/rosomaha}"
TOKEN_FILE="${FINANCE_TOKEN_FILE:-$SECRET_DIR/finance-intake.token}"
NGINX_SECRET_FILE="${FINANCE_NGINX_SECRET_FILE:-/etc/nginx/snippets/rosomaha-finance-intake-secret.conf}"
PHP_BIN="${PHP_BIN:-php}"
NGINX_BIN="${NGINX_BIN:-nginx}"
SYSTEMCTL_BIN="${SYSTEMCTL_BIN:-systemctl}"

usage() {
  cat <<'EOF'
Usage: configure-finance-intake-proxy.sh {on|rotate|off|status}

on      Provision or reuse the root-owned token and enable tenant intake.
rotate  Replace the token through a fail-closed OFF/reload/ON sequence.
off     Disable tenant intake without deleting the server-held token.
status  Show redacted CRM state and validate the active Nginx proxy config.

The script must run as root on the Rosomaha/CRM production server. It never
prints the token or its hash.
EOF
}

fail() {
  echo "Finance intake proxy: $1" >&2
  exit 1
}

if (( EUID != 0 )); then
  fail "root privileges are required."
fi

if (( $# != 1 )); then
  usage >&2
  exit 2
fi

ACTION="$1"
if [[ "$ACTION" != "on" && "$ACTION" != "rotate" && "$ACTION" != "off" && "$ACTION" != "status" ]]; then
  usage >&2
  exit 2
fi

if [[ ! "$TENANT_ID" =~ ^[1-9][0-9]*$ ]]; then
  fail "FINANCE_TENANT_ID must be a positive integer."
fi

[[ -f "$CRM_ROOT/artisan" ]] || fail "CRM artisan was not found at $CRM_ROOT/artisan."
[[ -f "$APP_ROOT/nginx/rosomaha.site.conf" ]] || fail "canonical Rosomaha Nginx config is missing."

for command_name in "$PHP_BIN" "$NGINX_BIN" "$SYSTEMCTL_BIN" openssl sha256sum install mktemp awk; do
  command -v "$command_name" >/dev/null 2>&1 || fail "required command is unavailable: $command_name"
done

run_finance_command() {
  (
    cd "$CRM_ROOT"
    "$PHP_BIN" artisan finance:public-intake "$@" --tenant="$TENANT_ID"
  )
}

validate_active_proxy() {
  if ! "$NGINX_BIN" -T 2>&1 | awk '
    index($0, "location = /api/finance/public-intake {") { location_ok = 1 }
    index($0, "proxy_pass https://rosomaha.centrlp.ru/api/finance/public-intake;") { upstream_ok = 1 }
    index($0, "proxy_set_header Origin https://xn--80aa8ahaki9a.site;") { origin_ok = 1 }
    index($0, "proxy_set_header X-Rosomaha-Site-Token ") { token_ok = 1 }
    END { exit !(location_ok && upstream_ok && origin_ok && token_ok) }
  '; then
    fail "the active Nginx config is missing the pinned finance proxy or its root-owned token."
  fi
}

if [[ "$ACTION" == "off" ]]; then
  run_finance_command off
  exit 0
fi

install -d -m 700 -o root -g root -- "$SECRET_DIR"
NGINX_SECRET_DIR="$(dirname "$NGINX_SECRET_FILE")"
if [[ ! -d "$NGINX_SECRET_DIR" ]]; then
  install -d -m 700 -o root -g root -- "$NGINX_SECRET_DIR"
fi
umask 077

if [[ "$ACTION" == "status" ]]; then
  "$NGINX_BIN" -t >/dev/null 2>&1 || fail "Nginx configuration test failed."
  validate_active_proxy
  run_finance_command status
  if [[ -f "$TOKEN_FILE" ]]; then
    echo "Server token file: configured"
  else
    echo "Server token file: missing"
  fi
  exit 0
fi

token=""
if [[ "$ACTION" == "on" && -f "$TOKEN_FILE" ]]; then
  token="$(<"$TOKEN_FILE")"
else
  token="$(openssl rand -hex 32)"
fi

[[ "$token" =~ ^[a-f0-9]{64}$ ]] || fail "the server token is invalid."
token_hash="$(printf '%s' "$token" | sha256sum | awk '{print $1}')"
[[ "$token_hash" =~ ^[a-f0-9]{64}$ ]] || fail "the server token hash could not be calculated."

token_candidate="$(mktemp "$SECRET_DIR/.finance-intake-token.XXXXXX")"
secret_candidate="$(mktemp "$NGINX_SECRET_DIR/.rosomaha-finance-secret.XXXXXX")"
token_backup="$(mktemp "$SECRET_DIR/.finance-intake-token-backup.XXXXXX")"
secret_backup="$(mktemp "$NGINX_SECRET_DIR/.rosomaha-finance-secret-backup.XXXXXX")"
token_had_previous=0
secret_had_previous=0
rollback_needed=0

if [[ -f "$TOKEN_FILE" ]]; then
  install -m 600 -o root -g root -- "$TOKEN_FILE" "$token_backup"
  token_had_previous=1
fi
if [[ -f "$NGINX_SECRET_FILE" ]]; then
  install -m 600 -o root -g root -- "$NGINX_SECRET_FILE" "$secret_backup"
  secret_had_previous=1
fi

cleanup() {
  status=$?
  trap - EXIT
  set +e

  if (( status != 0 && rollback_needed == 1 )); then
    # Keep the CRM closed while restoring the last known disk/runtime pair.
    run_finance_command off >/dev/null 2>&1

    if (( token_had_previous == 1 )); then
      install -m 600 -o root -g root -- "$token_backup" "$TOKEN_FILE"
    else
      rm -f -- "$TOKEN_FILE"
    fi
    if (( secret_had_previous == 1 )); then
      install -m 600 -o root -g root -- "$secret_backup" "$NGINX_SECRET_FILE"
    else
      rm -f -- "$NGINX_SECRET_FILE"
    fi

    if "$NGINX_BIN" -t >/dev/null 2>&1; then
      "$SYSTEMCTL_BIN" reload nginx >/dev/null 2>&1
    else
      # On a first install the canonical site config may already require the
      # new include. Retain the validated candidate pair, but leave CRM OFF.
      install -m 600 -o root -g root -- "$token_candidate" "$TOKEN_FILE"
      install -m 600 -o root -g root -- "$secret_candidate" "$NGINX_SECRET_FILE"
      if "$NGINX_BIN" -t >/dev/null 2>&1; then
        "$SYSTEMCTL_BIN" reload nginx >/dev/null 2>&1
      fi
    fi
  fi

  rm -f -- "$token_candidate" "$secret_candidate" "$token_backup" "$secret_backup"
  unset token token_hash
  exit "$status"
}
trap cleanup EXIT

printf '%s\n' "$token" >"$token_candidate"
printf 'proxy_set_header X-Rosomaha-Site-Token "%s";\n' "$token" >"$secret_candidate"
chmod 600 "$token_candidate" "$secret_candidate"
chown root:root "$token_candidate" "$secret_candidate"

install -m 600 -o root -g root -- "$token_candidate" "$TOKEN_FILE"
install -m 600 -o root -g root -- "$secret_candidate" "$NGINX_SECRET_FILE"
rollback_needed=1
unset token

if ! "$NGINX_BIN" -t >/dev/null 2>&1; then
  fail "Nginx configuration test failed; the prior proxy files will be restored and tenant intake left OFF."
fi

validate_active_proxy

# Rotation is deliberately fail-closed: the CRM rejects submissions while the
# proxy begins using the new token. The unavailable interval is one reload.
run_finance_command off >/dev/null
if ! "$SYSTEMCTL_BIN" reload nginx; then
  fail "Nginx reload failed; the prior proxy files will be restored and tenant intake left OFF."
fi

run_finance_command on --token-sha256="$token_hash"
rollback_needed=0
echo "Nginx finance proxy: active"
