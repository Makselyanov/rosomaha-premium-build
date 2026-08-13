#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: server-rollback.sh [release-name]

Atomically switches /var/www/rosomaha/current to one existing guarded release.
The optional release name must have the exact server-release timestamp/label form.
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
  echo "Rollback blocked: unknown option: $1" >&2
  usage >&2
  exit 2
fi

if [[ -n "${1:-}" && ! "${1:-}" =~ ^[0-9]{8}-[0-9]{6}-[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]]; then
  echo "Rollback blocked: invalid release name: $1" >&2
  exit 2
fi

# This is the same exact production mutex and inherited-open-file-description
# contract as server-release.sh. Keep the two blocks coherent: direct release
# and direct rollback must serialize with the fixed main-price operator.
RELEASE_LOCK_PATH="/var/www/rosomaha/.rosomaha-main-price-release.lock"
RELEASE_LOCK_MARKER="rosomaha-release-lock-inherited/v1"

if [[ -n "${ROSOMAHA_RELEASE_LOCK_FD+x}" || -n "${ROSOMAHA_RELEASE_LOCK_INHERITED+x}" ]]; then
  if [[ "${ROSOMAHA_RELEASE_LOCK_INHERITED-}" != "$RELEASE_LOCK_MARKER" || ! "${ROSOMAHA_RELEASE_LOCK_FD-}" =~ ^([3-9]|[1-9][0-9]+)$ ]]; then
    echo "Rollback blocked: invalid inherited release-lock contract" >&2
    exit 1
  fi

  /usr/bin/python3 - "$RELEASE_LOCK_PATH" "$ROSOMAHA_RELEASE_LOCK_FD" <<'PY'
import errno
import fcntl
import os
import stat
import sys
from pathlib import Path


LOCK_PATH = Path("/var/www/rosomaha/.rosomaha-main-price-release.lock")
ALLOWED_GIDS = {0, 33}


def same_inode(left, right):
    return (left.st_dev, left.st_ino) == (right.st_dev, right.st_ino)


def require_safe_lock(fd, path):
    if path != LOCK_PATH:
        raise RuntimeError("release lock path is not the fixed production path")
    opened = os.fstat(fd)
    linked = os.lstat(path)
    for info in (opened, linked):
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_nlink != 1
            or info.st_uid != 0
            or info.st_gid not in ALLOWED_GIDS
            or stat.S_IMODE(info.st_mode) != 0o600
        ):
            raise RuntimeError("release lock metadata is unsafe")
    if not same_inode(opened, linked):
        raise RuntimeError("release lock descriptor is not bound to the fixed path")
    return opened


def flock_would_block(exc):
    return isinstance(exc, OSError) and exc.errno in {errno.EACCES, errno.EAGAIN}


def require_inherited_exclusive_lock(fd, path):
    require_safe_lock(fd, path)
    probe = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        probe_info = require_safe_lock(probe, path)
        if not same_inode(probe_info, os.fstat(fd)):
            raise RuntimeError("release lock probe reached a different inode")
        try:
            fcntl.flock(probe, fcntl.LOCK_SH | fcntl.LOCK_NB)
        except OSError as exc:
            if not flock_would_block(exc):
                raise
        else:
            raise RuntimeError("inherited release lock was not already exclusive")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            if flock_would_block(exc):
                raise RuntimeError(
                    "inherited descriptor does not own the exclusive release lock"
                ) from exc
            raise
        require_safe_lock(fd, path)
        try:
            fcntl.flock(probe, fcntl.LOCK_SH | fcntl.LOCK_NB)
        except OSError as exc:
            if not flock_would_block(exc):
                raise
        else:
            raise RuntimeError("inherited release lock lost exclusivity")
    finally:
        os.close(probe)


try:
    lock_path = Path(sys.argv[1])
    fd_text = sys.argv[2]
    if not fd_text.isascii() or not fd_text.isdecimal() or str(int(fd_text)) != fd_text:
        raise RuntimeError("inherited release-lock fd is invalid")
    lock_fd = int(fd_text)
    if lock_fd < 3 or lock_fd > 1_000_000:
        raise RuntimeError("inherited release-lock fd is out of range")
    require_inherited_exclusive_lock(lock_fd, lock_path)
except Exception as exc:
    print(f"Rollback blocked: unsafe inherited release lock: {exc}", file=sys.stderr)
    raise SystemExit(1)
PY
else
  /usr/bin/python3 - "$0" "$@" <<'PY'
import errno
import fcntl
import os
import stat
import subprocess
import sys
from pathlib import Path


LOCK_PATH = Path("/var/www/rosomaha/.rosomaha-main-price-release.lock")
LOCK_MARKER = "rosomaha-release-lock-inherited/v1"
ALLOWED_GIDS = {0, 33}


def same_inode(left, right):
    return (left.st_dev, left.st_ino) == (right.st_dev, right.st_ino)


def require_safe_lock(fd):
    opened = os.fstat(fd)
    linked = os.lstat(LOCK_PATH)
    for info in (opened, linked):
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_nlink != 1
            or info.st_uid != 0
            or info.st_gid not in ALLOWED_GIDS
            or stat.S_IMODE(info.st_mode) != 0o600
        ):
            raise RuntimeError("release lock metadata is unsafe")
    if not same_inode(opened, linked):
        raise RuntimeError("release lock descriptor is not bound to the fixed path")


def open_direct_lock():
    if os.getuid() != 0 or os.geteuid() != 0:
        raise RuntimeError("direct rollback locking requires exact root identity")
    flags = os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(LOCK_PATH, flags)
    except FileNotFoundError:
        try:
            fd = os.open(LOCK_PATH, flags | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            fd = os.open(LOCK_PATH, flags)
    try:
        require_safe_lock(fd)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            if exc.errno in {errno.EACCES, errno.EAGAIN}:
                raise RuntimeError("another release or rollback already holds the lock") from exc
            raise
        require_safe_lock(fd)
        probe = os.open(LOCK_PATH, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        try:
            require_safe_lock(probe)
            try:
                fcntl.flock(probe, fcntl.LOCK_SH | fcntl.LOCK_NB)
            except OSError as exc:
                if exc.errno not in {errno.EACCES, errno.EAGAIN}:
                    raise
            else:
                raise RuntimeError("direct rollback lock is not exclusive")
        finally:
            os.close(probe)
        return fd
    except Exception:
        os.close(fd)
        raise


lock_fd = None
try:
    lock_fd = open_direct_lock()
    env = {
        "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "ROSOMAHA_RELEASE_LOCK_FD": str(lock_fd),
        "ROSOMAHA_RELEASE_LOCK_INHERITED": LOCK_MARKER,
    }
    completed = subprocess.run(
        ["/usr/bin/bash", sys.argv[1], *sys.argv[2:]],
        stdin=subprocess.DEVNULL,
        close_fds=True,
        pass_fds=(lock_fd,),
        env=env,
        check=False,
    )
    raise SystemExit(completed.returncode)
except Exception as exc:
    print(f"Rollback blocked: could not acquire release lock: {exc}", file=sys.stderr)
    raise SystemExit(1)
finally:
    if lock_fd is not None:
        os.close(lock_fd)
PY
  exit $?
fi

/usr/bin/python3 - "${1:-}" <<'PY'
import os
import re
import stat
import sys
from pathlib import Path


APP_ROOT = Path("/var/www/rosomaha")
ROOT_DIR = Path("/")
VAR_DIR = Path("/var")
WWW_DIR = Path("/var/www")
RELEASES_DIR = APP_ROOT / "_releases"
CURRENT_LINK = APP_ROOT / "current"
RELEASE_NAME_PATTERN = re.compile(
    r"[0-9]{8}-[0-9]{6}-[A-Za-z0-9][A-Za-z0-9._-]{0,63}"
)
ALLOWED_GIDS = {0, 33}


def same_inode(left, right):
    return (left.st_dev, left.st_ino) == (right.st_dev, right.st_ino)


def require_safe_application_root(info):
    if (
        not stat.S_ISDIR(info.st_mode)
        or info.st_uid != 0
        or info.st_gid not in ALLOWED_GIDS
    ):
        raise RuntimeError("application root is not a root-owned directory")
    mode = stat.S_IMODE(info.st_mode)
    if mode & stat.S_IWOTH:
        raise RuntimeError("application root is world writable")
    if mode & stat.S_IWGRP and not mode & stat.S_ISVTX:
        raise RuntimeError("application root is group writable without sticky bit")


def require_safe_root_directory(info, label):
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0:
        raise RuntimeError(f"{label} is not a root-owned directory")
    if info.st_gid not in ALLOWED_GIDS:
        raise RuntimeError(f"{label} has an unexpected group")
    if stat.S_IMODE(info.st_mode) & 0o022:
        raise RuntimeError(f"{label} is group/world writable")


def require_safe_release_name(name):
    if not RELEASE_NAME_PATTERN.fullmatch(name):
        raise RuntimeError("release name is invalid")
    return name


def release_target(name):
    require_safe_release_name(name)
    return RELEASES_DIR / name


def current_release_name(text):
    for name in (item for item in [Path(text).name] if item):
        expected = release_target(name)
        if text == str(expected):
            return name
    raise RuntimeError("current link does not name an exact guarded release")


class RollbackStateError(RuntimeError):
    def __init__(self, state, target, temporary_cleanup_status, cause):
        self.state = state
        self.target = target
        self.temporary_cleanup_status = temporary_cleanup_status
        self.cause = cause
        common = (
            f"rollback_state={state}; target={target}; "
            f"temporary_link_cleanup={temporary_cleanup_status}; "
            f"cause_type={type(cause).__name__}; cause={cause}"
        )
        if state == "switched_to_rollback_target":
            message = (
                f"{common}; current_may_already_be_rollback_target=true; "
                "recovery_required=true; "
                "required_action=verify_current_and_live_site_before_any_retry"
            )
        else:
            message = (
                f"{common}; current_not_switched=true; automatic_retry=forbidden; "
                "required_action=inspect_current_and_temporary_link_before_retry"
            )
        super().__init__(message)


def guarded_rollback(
    app_root,
    releases_dir,
    current_link,
    requested_name=None,
):
    if app_root != APP_ROOT or releases_dir != RELEASES_DIR or current_link != CURRENT_LINK:
        raise RuntimeError("rollback paths must be the fixed production paths")
    if requested_name is not None:
        require_safe_release_name(requested_name)

    directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    root_fd = os.open(str(ROOT_DIR), directory_flags)
    var_fd = None
    www_fd = None
    app_fd = None
    releases_fd = None
    current_release_fd = None
    target_fd = None
    current_replaced = False
    temporary_cleanup_status = "not_created"
    target = None
    try:
        root_info = os.fstat(root_fd)
        require_safe_root_directory(root_info, "filesystem root")
        if not same_inode(root_info, os.lstat(ROOT_DIR)):
            raise RuntimeError("filesystem root path changed during pinning")

        var_fd = os.open("var", directory_flags, dir_fd=root_fd)
        var_info = os.fstat(var_fd)
        require_safe_root_directory(var_info, "var directory")
        if (
            not same_inode(
                var_info,
                os.stat("var", dir_fd=root_fd, follow_symlinks=False),
            )
            or not same_inode(var_info, os.lstat(VAR_DIR))
        ):
            raise RuntimeError("var directory path changed during pinning")

        www_fd = os.open("www", directory_flags, dir_fd=var_fd)
        www_info = os.fstat(www_fd)
        require_safe_root_directory(www_info, "www directory")
        if (
            not same_inode(
                www_info,
                os.stat("www", dir_fd=var_fd, follow_symlinks=False),
            )
            or not same_inode(www_info, os.lstat(WWW_DIR))
        ):
            raise RuntimeError("www directory path changed during pinning")

        app_fd = os.open("rosomaha", directory_flags, dir_fd=www_fd)
        app_info = os.fstat(app_fd)
        require_safe_application_root(app_info)
        if (
            not same_inode(
                app_info,
                os.stat("rosomaha", dir_fd=www_fd, follow_symlinks=False),
            )
            or not same_inode(app_info, os.lstat(APP_ROOT))
        ):
            raise RuntimeError("application root path changed during pinning")

        releases_fd = os.open("_releases", directory_flags, dir_fd=app_fd)
        releases_info = os.fstat(releases_fd)
        require_safe_root_directory(releases_info, "releases directory")
        if (
            not same_inode(
                releases_info,
                os.stat("_releases", dir_fd=app_fd, follow_symlinks=False),
            )
            or not same_inode(releases_info, os.lstat(RELEASES_DIR))
        ):
            raise RuntimeError("releases directory path changed during pinning")

        current_info = os.stat("current", dir_fd=app_fd, follow_symlinks=False)
        if (
            not stat.S_ISLNK(current_info.st_mode)
            or current_info.st_uid != 0
            or current_info.st_gid not in ALLOWED_GIDS
        ):
            raise RuntimeError("current entry is not a trusted root symlink")
        current_text = os.readlink("current", dir_fd=app_fd)
        current_name = current_release_name(current_text)

        current_release_fd = os.open(current_name, directory_flags, dir_fd=releases_fd)
        current_release_info = os.fstat(current_release_fd)
        require_safe_root_directory(current_release_info, "current release")
        if not same_inode(
            current_release_info,
            os.stat(current_name, dir_fd=releases_fd, follow_symlinks=False),
        ):
            raise RuntimeError("current release path changed during pinning")

        observed_names = os.listdir(releases_fd)
        guarded_names = []
        for name in observed_names:
            if not RELEASE_NAME_PATTERN.fullmatch(name):
                continue
            info = os.stat(name, dir_fd=releases_fd, follow_symlinks=False)
            require_safe_root_directory(info, f"release {name}")
            guarded_names.append(name)

        if requested_name is None:
            candidates = sorted(
                (name for name in guarded_names if name != current_name), reverse=True,
            )
            if not candidates:
                raise RuntimeError("no previous guarded release found for rollback")
            target_name = candidates[0]
        else:
            target_name = requested_name
            if target_name == current_name:
                raise RuntimeError("rollback target is already current")
            if target_name not in guarded_names:
                raise RuntimeError("requested guarded release is unavailable")

        target = release_target(target_name)
        target_fd = os.open(target_name, directory_flags, dir_fd=releases_fd)
        target_info = os.fstat(target_fd)
        require_safe_root_directory(target_info, "rollback target")
        if not same_inode(
            target_info,
            os.stat(target_name, dir_fd=releases_fd, follow_symlinks=False),
        ):
            raise RuntimeError("rollback target path changed during pinning")

        def revalidate_before_mutation():
            current_root = os.fstat(root_fd)
            current_var = os.fstat(var_fd)
            current_www = os.fstat(www_fd)
            current_app = os.fstat(app_fd)
            current_releases = os.fstat(releases_fd)
            current_source = os.fstat(current_release_fd)
            current_target = os.fstat(target_fd)
            require_safe_root_directory(current_root, "filesystem root")
            require_safe_root_directory(current_var, "var directory")
            require_safe_root_directory(current_www, "www directory")
            require_safe_application_root(current_app)
            require_safe_root_directory(current_releases, "releases directory")
            require_safe_root_directory(current_source, "current release")
            require_safe_root_directory(current_target, "rollback target")
            if not same_inode(current_root, root_info) or not same_inode(
                current_root, os.lstat(ROOT_DIR),
            ):
                raise RuntimeError("filesystem root binding changed")
            if (
                not same_inode(current_var, var_info)
                or not same_inode(
                    current_var,
                    os.stat("var", dir_fd=root_fd, follow_symlinks=False),
                )
                or not same_inode(current_var, os.lstat(VAR_DIR))
            ):
                raise RuntimeError("var directory binding changed")
            if (
                not same_inode(current_www, www_info)
                or not same_inode(
                    current_www,
                    os.stat("www", dir_fd=var_fd, follow_symlinks=False),
                )
                or not same_inode(current_www, os.lstat(WWW_DIR))
            ):
                raise RuntimeError("www directory binding changed")
            if not same_inode(current_app, app_info) or not same_inode(
                current_app, os.lstat(APP_ROOT),
            ):
                raise RuntimeError("application root binding changed")
            if not same_inode(
                current_app,
                os.stat("rosomaha", dir_fd=www_fd, follow_symlinks=False),
            ):
                raise RuntimeError("application root parent binding changed")
            if (
                not same_inode(current_releases, releases_info)
                or not same_inode(
                    current_releases,
                    os.stat("_releases", dir_fd=app_fd, follow_symlinks=False),
                )
                or not same_inode(current_releases, os.lstat(RELEASES_DIR))
            ):
                raise RuntimeError("releases directory binding changed")
            if not same_inode(
                current_source,
                os.stat(current_name, dir_fd=releases_fd, follow_symlinks=False),
            ):
                raise RuntimeError("current release binding changed")
            if not same_inode(
                current_target,
                os.stat(target_name, dir_fd=releases_fd, follow_symlinks=False),
            ):
                raise RuntimeError("rollback target binding changed")
            linked_current = os.stat("current", dir_fd=app_fd, follow_symlinks=False)
            if (
                not same_inode(linked_current, current_info)
                or not stat.S_ISLNK(linked_current.st_mode)
                or linked_current.st_uid != 0
                or linked_current.st_gid not in ALLOWED_GIDS
                or os.readlink("current", dir_fd=app_fd) != current_text
            ):
                raise RuntimeError("current link binding changed")

        temporary_link = f".{target_name}.rollback.current.tmp"
        try:
            os.stat(temporary_link, dir_fd=app_fd, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise RuntimeError("temporary rollback-link entry already exists")

        temporary_created = False
        temporary_info = None
        try:
            revalidate_before_mutation()
            os.symlink(str(target), temporary_link, dir_fd=app_fd)
            temporary_created = True
            temporary_cleanup_status = "pending"
            temporary_info = os.stat(
                temporary_link, dir_fd=app_fd, follow_symlinks=False,
            )
            if (
                not stat.S_ISLNK(temporary_info.st_mode)
                or temporary_info.st_uid != 0
                or temporary_info.st_gid not in ALLOWED_GIDS
                or os.readlink(temporary_link, dir_fd=app_fd) != str(target)
            ):
                raise RuntimeError("temporary rollback link is unsafe")

            revalidate_before_mutation()
            os.replace(
                temporary_link,
                "current",
                src_dir_fd=app_fd,
                dst_dir_fd=app_fd,
            )
            current_replaced = True
            temporary_created = False
            temporary_cleanup_status = "consumed_by_switch"
            os.fsync(app_fd)

            switched = os.stat("current", dir_fd=app_fd, follow_symlinks=False)
            if (
                not stat.S_ISLNK(switched.st_mode)
                or switched.st_uid != 0
                or switched.st_gid not in ALLOWED_GIDS
                or os.readlink("current", dir_fd=app_fd) != str(target)
                or not same_inode(app_info, os.lstat(APP_ROOT))
                or not same_inode(releases_info, os.lstat(RELEASES_DIR))
                or not same_inode(
                    target_info,
                    os.stat(target_name, dir_fd=releases_fd, follow_symlinks=False),
                )
            ):
                raise RuntimeError("rollback current-link switch could not be verified")
        finally:
            if temporary_created:
                try:
                    cleanup_info = os.stat(
                        temporary_link, dir_fd=app_fd, follow_symlinks=False,
                    )
                except FileNotFoundError:
                    temporary_cleanup_status = "already_absent"
                except OSError:
                    temporary_cleanup_status = "preserved_cleanup_check_failed"
                else:
                    cleanup_safe = (
                        temporary_info is not None
                        and stat.S_ISLNK(cleanup_info.st_mode)
                        and cleanup_info.st_uid == 0
                        and cleanup_info.st_gid in ALLOWED_GIDS
                        and same_inode(cleanup_info, temporary_info)
                    )
                    if cleanup_safe:
                        try:
                            cleanup_safe = (
                                os.readlink(temporary_link, dir_fd=app_fd)
                                == str(target)
                            )
                        except OSError:
                            cleanup_safe = False
                            temporary_cleanup_status = (
                                "preserved_cleanup_check_failed"
                            )
                    if cleanup_safe:
                        try:
                            os.unlink(temporary_link, dir_fd=app_fd)
                        except OSError:
                            temporary_cleanup_status = "preserved_cleanup_failed"
                        else:
                            temporary_cleanup_status = "removed"
                    elif temporary_cleanup_status == "pending":
                        temporary_cleanup_status = "preserved_unverified"
    except Exception as exc:
        if target is not None:
            state = (
                "switched_to_rollback_target" if current_replaced else "not_switched"
            )
            raise RollbackStateError(
                state,
                target,
                temporary_cleanup_status,
                exc,
            ) from exc
        raise
    finally:
        if target_fd is not None:
            os.close(target_fd)
        if current_release_fd is not None:
            os.close(current_release_fd)
        if releases_fd is not None:
            os.close(releases_fd)
        if app_fd is not None:
            os.close(app_fd)
        if www_fd is not None:
            os.close(www_fd)
        if var_fd is not None:
            os.close(var_fd)
        os.close(root_fd)

    return target


def rollback_cli(argv):
    try:
        requested = argv[1] or None
        rolled_back_target = guarded_rollback(
            APP_ROOT,
            RELEASES_DIR,
            CURRENT_LINK,
            requested,
        )
    except Exception as exc:
        print(f"Rollback failed: {exc}", file=sys.stderr)
        return 1
    print(f"Rolled back to: {rolled_back_target}")
    print(f"Current: {rolled_back_target}")
    return 0


raise SystemExit(rollback_cli(sys.argv))
PY
