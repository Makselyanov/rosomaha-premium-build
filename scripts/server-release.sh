#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/var/www/rosomaha}"
RELEASES_DIR="$APP_ROOT/_releases"
CURRENT_LINK="$APP_ROOT/current"

STAMP="$(date +%Y%m%d-%H%M%S)"
SHA="$(git -C "$APP_ROOT" rev-parse --short HEAD 2>/dev/null || echo manual)"
LABEL="${1:-$SHA}"
RELEASE_NAME="${STAMP}-${LABEL}"
TARGET="$RELEASES_DIR/$RELEASE_NAME"

mkdir -p "$TARGET"
rsync -a --delete "$APP_ROOT/dist/" "$TARGET/"
ln -sfn "$TARGET" "$CURRENT_LINK"

echo "Released: $TARGET"
echo "Current: $(readlink -f "$CURRENT_LINK")"
