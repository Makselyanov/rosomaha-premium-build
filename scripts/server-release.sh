#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/var/www/rosomaha}"
RELEASES_DIR="$APP_ROOT/_releases"
CURRENT_LINK="$APP_ROOT/current"
CONTENT_SOURCE="${CONTENT_SOURCE:-$APP_ROOT/public/api/articles.json}"
CONTENT_CANDIDATE="$APP_ROOT/dist/api/articles.json"

usage() {
  cat <<'EOF'
Usage: server-release.sh [release-label]

Creates a guarded release from APP_ROOT/dist and switches APP_ROOT/current.
The optional label must not start with a dash.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if (( $# > 1 )); then
  usage >&2
  exit 2
fi

if [[ "${1:-}" == -* ]]; then
  echo "Release blocked: unknown option: $1" >&2
  usage >&2
  exit 2
fi

# Content Zavod writes its canonical export into the server source tree. A
# manually uploaded SEO build may be based on an older local checkout, so block
# the release if it would silently remove already exported CRM articles.
if [[ -f "$CONTENT_SOURCE" ]]; then
  if [[ ! -f "$CONTENT_CANDIDATE" ]]; then
    echo "Release blocked: candidate articles export is missing: $CONTENT_CANDIDATE" >&2
    exit 1
  fi

  python3 - "$CONTENT_SOURCE" "$CONTENT_CANDIDATE" <<'PY'
import json
import sys
from pathlib import Path

source_path = Path(sys.argv[1])
candidate_path = Path(sys.argv[2])


def load_slugs(path: Path) -> set[str]:
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, list):
        raise ValueError(f"{path} must contain a JSON array")

    slugs: list[str] = []
    for index, item in enumerate(payload):
        if not isinstance(item, dict) or not isinstance(item.get("slug"), str) or not item["slug"].strip():
            raise ValueError(f"{path}: item {index} has no valid slug")
        slugs.append(item["slug"].strip())

    duplicates = sorted({slug for slug in slugs if slugs.count(slug) > 1})
    if duplicates:
        raise ValueError(f"{path}: duplicate slugs: {', '.join(duplicates)}")

    return set(slugs)


try:
    source_slugs = load_slugs(source_path)
    candidate_slugs = load_slugs(candidate_path)
except Exception as exc:
    print(f"Release blocked: invalid article export: {exc}", file=sys.stderr)
    raise SystemExit(1)

missing = sorted(source_slugs - candidate_slugs)
if missing:
    print(
        "Release blocked: candidate would remove Content Zavod articles: "
        + ", ".join(missing),
        file=sys.stderr,
    )
    raise SystemExit(1)

print(
    f"Content guard passed: source={len(source_slugs)}, candidate={len(candidate_slugs)}"
)
PY
fi

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
