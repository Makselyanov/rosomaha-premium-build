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
The optional label must use 1-64 ASCII letters, digits, dots, underscores, or dashes,
and must start with a letter or digit.
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

if [[ ! "$LABEL" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]]; then
  echo "Release blocked: invalid release label: $LABEL" >&2
  exit 2
fi

RELEASE_NAME="${STAMP}-${LABEL}"
TARGET="$RELEASES_DIR/$RELEASE_NAME"

# The release mutation is one root-private operator. It validates and pins the
# application, releases, and staging directories before the first write, makes
# the target through the pinned releases-directory descriptor, and gives rsync
# only /proc/self/fd paths for the pinned source and target. A rename or symlink
# swap therefore cannot redirect the copy to a different tree. The current
# symlink is switched through the pinned application-directory descriptor only
# after the exact target inode has been normalized and revalidated.
/usr/bin/python3 - \
  "$APP_ROOT" "$RELEASES_DIR" "$CURRENT_LINK" "$RELEASE_NAME" "$APP_ROOT/dist" <<'PY'
import os
import re
import stat
import subprocess
import sys
from pathlib import Path


def same_inode(left: os.stat_result, right: os.stat_result) -> bool:
    return left.st_dev == right.st_dev and left.st_ino == right.st_ino


def require_safe_root_directory(info: os.stat_result, label: str) -> None:
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0:
        raise RuntimeError(f"{label} is not a root-owned directory")
    if stat.S_IMODE(info.st_mode) & 0o022:
        raise RuntimeError(f"{label} is group/world writable")


def guarded_release(
    app_root: Path,
    releases_dir: Path,
    current_link: Path,
    release_name: str,
    source_dir: Path,
    run_rsync=subprocess.run,
) -> Path:
    normalized_app_root = Path(os.path.normpath(str(app_root)))
    if not app_root.is_absolute() or app_root != normalized_app_root:
        raise RuntimeError("application root must be an absolute normalized path")
    if releases_dir != app_root / "_releases":
        raise RuntimeError("releases directory is outside the fixed application root")
    if current_link != app_root / "current":
        raise RuntimeError("current link is outside the fixed application root")
    if source_dir != app_root / "dist":
        raise RuntimeError("release source is outside the fixed application root")
    if not re.fullmatch(
        r"[0-9]{8}-[0-9]{6}-[A-Za-z0-9][A-Za-z0-9._-]{0,63}",
        release_name,
    ):
        raise RuntimeError("release name is invalid")

    target = releases_dir / release_name
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    app_fd = os.open(str(app_root), flags)
    releases_fd = None
    source_fd = None
    target_fd = None
    try:
        app_info = os.fstat(app_fd)
        require_safe_root_directory(app_info, "application root")
        if not same_inode(app_info, os.lstat(app_root)):
            raise RuntimeError("application root path changed during pinning")

        releases_fd = os.open("_releases", flags, dir_fd=app_fd)
        releases_info = os.fstat(releases_fd)
        require_safe_root_directory(releases_info, "releases directory")
        if (
            not same_inode(
                releases_info,
                os.stat("_releases", dir_fd=app_fd, follow_symlinks=False),
            )
            or not same_inode(releases_info, os.lstat(releases_dir))
        ):
            raise RuntimeError("releases directory path changed during pinning")

        source_fd = os.open("dist", flags, dir_fd=app_fd)
        source_info = os.fstat(source_fd)
        require_safe_root_directory(source_info, "release source")
        if (
            not same_inode(
                source_info,
                os.stat("dist", dir_fd=app_fd, follow_symlinks=False),
            )
            or not same_inode(source_info, os.lstat(source_dir))
        ):
            raise RuntimeError("release source path changed during pinning")

        def revalidate_before_mutation() -> None:
            current_app = os.fstat(app_fd)
            current_releases = os.fstat(releases_fd)
            current_source = os.fstat(source_fd)
            require_safe_root_directory(current_app, "application root")
            require_safe_root_directory(current_releases, "releases directory")
            require_safe_root_directory(current_source, "release source")
            if not same_inode(current_app, app_info) or not same_inode(
                current_app, os.lstat(app_root),
            ):
                raise RuntimeError("application root binding changed")
            if (
                not same_inode(current_releases, releases_info)
                or not same_inode(
                    current_releases,
                    os.stat("_releases", dir_fd=app_fd, follow_symlinks=False),
                )
                or not same_inode(current_releases, os.lstat(releases_dir))
            ):
                raise RuntimeError("releases directory binding changed")
            if (
                not same_inode(current_source, source_info)
                or not same_inode(
                    current_source,
                    os.stat("dist", dir_fd=app_fd, follow_symlinks=False),
                )
                or not same_inode(current_source, os.lstat(source_dir))
            ):
                raise RuntimeError("release source binding changed")

        # This is deliberately the first filesystem mutation in the operator.
        revalidate_before_mutation()
        os.mkdir(release_name, mode=0o700, dir_fd=releases_fd)
        target_fd = os.open(release_name, flags, dir_fd=releases_fd)
        try:
            created = os.fstat(target_fd)
            linked_created = os.stat(
                release_name, dir_fd=releases_fd, follow_symlinks=False,
            )
            if (
                not stat.S_ISDIR(created.st_mode)
                or created.st_uid != 0
                or stat.S_IMODE(created.st_mode) not in {0o700, 0o2700}
                or not same_inode(created, linked_created)
            ):
                raise RuntimeError("new release root topology or mode is unsafe")

            revalidate_before_mutation()
            if not same_inode(
                created,
                os.stat(release_name, dir_fd=releases_fd, follow_symlinks=False),
            ):
                raise RuntimeError("release root binding changed before copy")

            source_proc = f"/proc/self/fd/{source_fd}"
            target_proc = f"/proc/self/fd/{target_fd}"
            if not same_inode(source_info, os.stat(source_proc)):
                raise RuntimeError("pinned release source is not available through procfs")
            if not same_inode(created, os.stat(target_proc)):
                raise RuntimeError("pinned release target is not available through procfs")

            run_rsync(
                [
                    "/usr/bin/rsync",
                    "-a",
                    "--delete",
                    "--",
                    f"{source_proc}/",
                    f"{target_proc}/",
                ],
                check=True,
                close_fds=True,
                pass_fds=(source_fd, target_fd),
            )

            # rsync -a preserves the source directory mode. The build staging
            # directory can be private (0700), but nginx must traverse the
            # exact public release root. Normalize only that pinned root.
            copied = os.fstat(target_fd)
            linked_copied = os.stat(
                release_name, dir_fd=releases_fd, follow_symlinks=False,
            )
            allowed_private_or_public_modes = {0o700, 0o755, 0o2700, 0o2755}
            if (
                not same_inode(created, copied)
                or not same_inode(copied, linked_copied)
                or copied.st_uid != 0
                or not stat.S_ISDIR(copied.st_mode)
                or stat.S_IMODE(copied.st_mode) not in allowed_private_or_public_modes
            ):
                raise RuntimeError("release root changed during pinned copy")

            os.fchmod(target_fd, 0o755)
            os.fsync(target_fd)

            after = os.fstat(target_fd)
            linked_after = os.stat(
                release_name, dir_fd=releases_fd, follow_symlinks=False,
            )
            if (
                not same_inode(created, after)
                or not same_inode(after, linked_after)
                or after.st_uid != 0
                or not stat.S_ISDIR(after.st_mode)
                or stat.S_IMODE(after.st_mode) != 0o755
            ):
                raise RuntimeError("release root changed during mode normalization")

            revalidate_before_mutation()
            os.fsync(releases_fd)

            try:
                existing_current = os.stat(
                    "current", dir_fd=app_fd, follow_symlinks=False,
                )
            except FileNotFoundError:
                existing_current = None
            if existing_current is not None and (
                not stat.S_ISLNK(existing_current.st_mode)
                or existing_current.st_uid != 0
            ):
                raise RuntimeError("current entry is not a root-owned symlink")

            temporary_link = f".{release_name}.current.tmp"
            try:
                os.stat(temporary_link, dir_fd=app_fd, follow_symlinks=False)
            except FileNotFoundError:
                pass
            else:
                raise RuntimeError("temporary current-link entry already exists")

            temporary_created = False
            try:
                os.symlink(str(target), temporary_link, dir_fd=app_fd)
                temporary_created = True
                temporary_info = os.stat(
                    temporary_link, dir_fd=app_fd, follow_symlinks=False,
                )
                if (
                    not stat.S_ISLNK(temporary_info.st_mode)
                    or temporary_info.st_uid != 0
                    or os.readlink(temporary_link, dir_fd=app_fd) != str(target)
                ):
                    raise RuntimeError("temporary current link is unsafe")

                revalidate_before_mutation()
                if not same_inode(
                    after,
                    os.stat(release_name, dir_fd=releases_fd, follow_symlinks=False),
                ):
                    raise RuntimeError("release root binding changed before switch")

                os.replace(
                    temporary_link,
                    "current",
                    src_dir_fd=app_fd,
                    dst_dir_fd=app_fd,
                )
                temporary_created = False
                os.fsync(app_fd)
                switched = os.stat("current", dir_fd=app_fd, follow_symlinks=False)
                if (
                    not stat.S_ISLNK(switched.st_mode)
                    or switched.st_uid != 0
                    or os.readlink("current", dir_fd=app_fd) != str(target)
                    or not same_inode(app_info, os.lstat(app_root))
                    or not same_inode(releases_info, os.lstat(releases_dir))
                ):
                    raise RuntimeError("current link switch could not be verified")
            finally:
                if temporary_created:
                    try:
                        os.unlink(temporary_link, dir_fd=app_fd)
                    except FileNotFoundError:
                        pass
        finally:
            os.close(target_fd)
    finally:
        if source_fd is not None:
            os.close(source_fd)
        if releases_fd is not None:
            os.close(releases_fd)
        os.close(app_fd)

    return target


released_target = guarded_release(
    Path(sys.argv[1]),
    Path(sys.argv[2]),
    Path(sys.argv[3]),
    sys.argv[4],
    Path(sys.argv[5]),
)
print(f"Released: {released_target}")
print(f"Current: {released_target}")
PY
