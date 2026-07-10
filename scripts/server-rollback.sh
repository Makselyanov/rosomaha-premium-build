#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/var/www/rosomaha}"
RELEASES_DIR="$APP_ROOT/_releases"
CURRENT_LINK="$APP_ROOT/current"

if [[ ! -d "$RELEASES_DIR" ]]; then
  echo "Releases directory not found: $RELEASES_DIR" >&2
  exit 1
fi

current_target="$(readlink -f "$CURRENT_LINK" || true)"

if [[ $# -gt 0 ]]; then
  target="$RELEASES_DIR/$1"
  if [[ ! -d "$target" ]]; then
    echo "Release not found: $1" >&2
    exit 1
  fi
else
  mapfile -t releases < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d | sort -r)
  target=""

  for release in "${releases[@]}"; do
    if [[ "$release" != "$current_target" ]]; then
      target="$release"
      break
    fi
  done

  if [[ -z "$target" ]]; then
    echo "No previous release found for rollback" >&2
    exit 1
  fi
fi

ln -sfn "$target" "$CURRENT_LINK"

echo "Rolled back to: $target"
echo "Current: $(readlink -f "$CURRENT_LINK")"
