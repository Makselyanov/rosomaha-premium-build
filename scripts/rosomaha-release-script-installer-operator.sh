#!/usr/bin/env bash
# Fixed one-purpose operator for migrating the guarded release/rollback pair.
# It never executes either installed script.  Audit/recovery are read-only;
# apply/rollback mutate only the exact pair, immutable backups and receipts.
set -euo pipefail
umask 077

MODE="${1:-audit}"
BUNDLE="${2:-}"

case "$MODE" in
  audit)
    [[ "$#" -le 1 && -z "$BUNDLE" ]] || { echo '{"status":"error","error":"audit takes no bundle"}'; exit 2; }
    ;;
  root-audit)
    [[ "$#" -eq 1 && -z "$BUNDLE" ]] || { echo '{"status":"error","error":"root-audit takes no bundle"}'; exit 2; }
    ;;
  apply|recover|rollback)
    [[ "$#" -eq 2 && "$BUNDLE" =~ ^/tmp/rosomaha-release-pair-installer-29f90f1-[0-9a-f]{16}$ ]] || {
      echo '{"status":"error","error":"invalid fixed bundle path"}'
      exit 2
    }
    ;;
  *)
    echo '{"status":"error","error":"invalid fixed mode"}'
    exit 2
    ;;
esac

exec /usr/bin/python3 -I -B - "$MODE" "$BUNDLE" <<'PY'
from __future__ import annotations

import errno
import fcntl
import hashlib
import json
import os
import pwd
import re
import stat
import sys
from pathlib import PurePosixPath


SCHEMA = "rosomaha-release-script-pair-installer/v2"
BASELINE_SCHEMA = "rosomaha-release-script-pair-installer-baseline/v3"
BACKUP_MANIFEST_SCHEMA = "rosomaha-release-script-pair-backup/v1"
ROLLBACK_AUTH_SCHEMA = "rosomaha-release-script-pair-rollback-authorization/v1"
TARGET_COMMIT = "29f90f1ea2b5b90156fd677ca624c5bd7b2d1529"
PAIR_SPECS = {
    "release": {
        "name": "server-release.sh",
        "old_sha256": "c25fc273a4cf88a27879207aaebf18be62f4487867a7de7674c611b400919edd",
        "new_sha256": "9caad8bde40e0f269ad0887c8b16c97cfc18c0495ad72068f2c812d2859c1fa2",
    },
    "rollback": {
        "name": "server-rollback.sh",
        "old_sha256": "aeee52f314036112501a7acc0af5fa09ee7c081327fb867b91c64b983bd41acc",
        "new_sha256": "8f2390ec2d6b3248b49ef8b690de5413bdcc7930180e584524de72094d676388",
    },
}
APP_ROOT = PurePosixPath("/var/www/rosomaha")
SCRIPTS_DIR = APP_ROOT / "scripts"
CURRENT_LINK = APP_ROOT / "current"
CANONICAL_ARTICLES = APP_ROOT / "public/api/articles.json"
ARTICLES_CZ_DIR = APP_ROOT / "src/data/articles-cz"
RELEASES_DIR = APP_ROOT / "_releases"
LOCK_PATH = APP_ROOT / ".rosomaha-main-price-release.lock"
LOCK_ALLOWED_GIDS = frozenset((0, 33))
BACKUP_PARENT = PurePosixPath("/var/backups/rosomaha")
BACKUP_DIR_NAME = "release-script-pair-installer-29f90f1"
BACKUP_MANIFEST_NAME = "pair-manifest.json"
MAX_SCRIPT_BYTES = 256 * 1024
MAX_BASELINE_BYTES = 512 * 1024
MAX_RECEIPT_BYTES = 512 * 1024
MAX_HTTP_BYTES = 25 * 1024 * 1024
MAX_CZ_FILES = 500
MAX_PROC_PIDS = 32768
MAX_CMDLINE_BYTES = 64 * 1024
BUNDLE_PATTERN = re.compile(r"/tmp/rosomaha-release-pair-installer-29f90f1-([0-9a-f]{16})")
EXPECTED_BASELINE_KEYS = {
    "schema", "status", "created_at", "target_commit", "targets", "olds",
    "operator_sha256", "remote", "independent_readback", "independent_public",
    "root_preflight", "baseline_token",
}
PAIR_STATES = frozenset(("old/old", "new/new", "mixed", "unknown"))
MIGRATION_COVERAGE = "migration_window_bounded_then_all_compliant_pair_installed"


class InstallError(RuntimeError):
    pass


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha256_bytes(raw):
    return hashlib.sha256(raw).hexdigest()


def reject_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise InstallError("JSON contains duplicate fields")
        result[key] = value
    return result


def safe_error(exc):
    text = " ".join(str(exc).split())[:300]
    text = re.sub(
        r"(?i)(token|secret|password|private[_ -]?key)\s*[:=]\s*\S+",
        r"\1=[REDACTED]",
        text,
    )
    return text or type(exc).__name__


def read_fd_exact(fd, maximum):
    chunks = []
    total = 0
    while True:
        chunk = os.read(fd, min(64 * 1024, maximum + 1 - total))
        if not chunk:
            break
        chunks.append(chunk)
        total += len(chunk)
        if total > maximum:
            raise InstallError("fixed file exceeds size limit")
    return b"".join(chunks)


def same_inode(left, right):
    return (left.st_dev, left.st_ino) == (right.st_dev, right.st_ino)


def topology(info):
    return {
        "uid": info.st_uid,
        "gid": info.st_gid,
        "mode": oct(stat.S_IMODE(info.st_mode)),
        "nlink": info.st_nlink,
        "dev": info.st_dev,
        "ino": info.st_ino,
    }


def require_dir(info, label, *, uid=0, gid=0, exact_mode=None, forbidden_mode=0o022):
    mode = stat.S_IMODE(info.st_mode)
    if (
        not stat.S_ISDIR(info.st_mode)
        or (uid is not None and info.st_uid != uid)
        or (gid is not None and info.st_gid != gid)
    ):
        raise InstallError(f"{label} directory topology is unsafe")
    if exact_mode is not None and mode != exact_mode:
        raise InstallError(f"{label} directory mode is not exact")
    if forbidden_mode and mode & forbidden_mode:
        raise InstallError(f"{label} directory permissions are unsafe")


def require_script(info, label):
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid != 0
        or info.st_gid != 0
        or stat.S_IMODE(info.st_mode) != 0o755
        or info.st_nlink != 1
    ):
        raise InstallError(f"{label} script topology is unsafe")


def open_exact_dir(path, label, *, uid=0, gid=0, exact_mode=None, forbidden_mode=0o022):
    flags = os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(str(path), flags)
    try:
        before = os.fstat(fd)
        linked = os.lstat(str(path))
        require_dir(
            before, label, uid=uid, gid=gid, exact_mode=exact_mode,
            forbidden_mode=forbidden_mode,
        )
        if stat.S_ISLNK(linked.st_mode) or not same_inode(before, linked):
            raise InstallError(f"{label} directory binding is unsafe")
        return fd
    except Exception:
        os.close(fd)
        raise


def validate_install_ancestors():
    policies = (
        (PurePosixPath("/"), "root", 0, 0, None, 0o022),
        (PurePosixPath("/var"), "var", 0, 0, None, 0o022),
        (PurePosixPath("/var/www"), "var-www", 0, 0, None, 0o022),
        (APP_ROOT, "application", 0, 33, 0o3775, 0),
        (SCRIPTS_DIR, "scripts", 0, 0, 0o775, 0),
    )
    evidence = {}
    for path, label, uid, gid, exact_mode, forbidden_mode in policies:
        fd = open_exact_dir(
            path, label, uid=uid, gid=gid, exact_mode=exact_mode,
            forbidden_mode=forbidden_mode,
        )
        try:
            info = os.fstat(fd)
            mode = stat.S_IMODE(info.st_mode)
            if label == "application" and not mode & stat.S_ISVTX:
                raise InstallError("application directory is not sticky")
            if label == "scripts" and mode & stat.S_IWOTH:
                raise InstallError("scripts directory is world writable")
            evidence[label] = {**topology(info), "same_inode": True}
        finally:
            os.close(fd)
    return evidence


def validate_backup_ancestors():
    for path, label in (
        (PurePosixPath("/"), "root"),
        (PurePosixPath("/var"), "var"),
        (PurePosixPath("/var/backups"), "var-backups"),
        (BACKUP_PARENT, "backup-parent"),
    ):
        fd = open_exact_dir(path, label, uid=0, gid=0, forbidden_mode=0o022)
        os.close(fd)


def classify_pair(members):
    if set(members) != set(PAIR_SPECS):
        return "unknown"
    if any(not item.get("valid") or item.get("state") not in {"old", "new"} for item in members.values()):
        return "unknown"
    states = tuple(members[key]["state"] for key in ("release", "rollback"))
    if states == ("old", "old"):
        return "old/old"
    if states == ("new", "new"):
        return "new/new"
    return "mixed"


def inspect_member(scripts_fd, key):
    spec = PAIR_SPECS[key]
    fd = None
    try:
        fd = os.open(spec["name"], os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=scripts_fd)
        before = os.fstat(fd)
        linked = os.stat(spec["name"], dir_fd=scripts_fd, follow_symlinks=False)
        require_script(before, spec["name"])
        if stat.S_ISLNK(linked.st_mode) or not same_inode(before, linked):
            raise InstallError(f"{spec['name']} binding is unsafe")
        raw = read_fd_exact(fd, MAX_SCRIPT_BYTES)
        after = os.fstat(fd)
        if (
            not same_inode(before, after)
            or before.st_size != after.st_size
            or before.st_mtime_ns != after.st_mtime_ns
            or len(raw) != before.st_size
        ):
            raise InstallError(f"{spec['name']} changed during readback")
        digest = sha256_bytes(raw)
        state = "old" if digest == spec["old_sha256"] else "new" if digest == spec["new_sha256"] else "unknown"
        return {
            "valid": True, "state": state, "sha256": digest, "size": len(raw),
            **topology(before),
        }
    except Exception as exc:
        return {"valid": False, "state": "unknown", "error": safe_error(exc)}
    finally:
        if fd is not None:
            os.close(fd)


def inspect_pair():
    ancestors = validate_install_ancestors()
    scripts_fd = open_exact_dir(
        SCRIPTS_DIR, "scripts", uid=0, gid=0, exact_mode=0o775, forbidden_mode=0,
    )
    try:
        members = {key: inspect_member(scripts_fd, key) for key in ("release", "rollback")}
    finally:
        os.close(scripts_fd)
    return {
        "valid": all(item.get("valid") for item in members.values()),
        "pair_state": classify_pair(members),
        "members": members,
        "trusted_ancestors": ancestors,
    }


def identity(mode):
    observed = pwd.getpwuid(os.getuid()).pw_name
    expected = "deploy" if mode == "audit" else "root"
    if observed != expected or (mode != "audit" and os.getuid() != 0):
        raise InstallError("fixed account identity mismatch")
    return observed


def article_summary(raw, source, file_topology=None):
    try:
        payload = json.loads(raw.decode("utf-8-sig"), object_pairs_hook=reject_duplicates)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise InstallError(f"article export is invalid: {source}") from exc
    if not isinstance(payload, list):
        raise InstallError(f"article export is not an array: {source}")
    slugs = []
    for item in payload:
        if not isinstance(item, dict) or not isinstance(item.get("slug"), str):
            raise InstallError(f"article export has invalid slug: {source}")
        slug = item["slug"].strip()
        if not slug or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,199}", slug):
            raise InstallError(f"article export has unsafe slug: {source}")
        slugs.append(slug)
    if len(slugs) != len(set(slugs)):
        raise InstallError(f"article export has duplicate slugs: {source}")
    result = {
        "source": source, "raw_sha256": sha256_bytes(raw), "bytes": len(raw),
        "count": len(slugs), "slug_digest": sha256_bytes(canonical_json(sorted(slugs))),
    }
    if file_topology is not None:
        result["topology"] = file_topology
    return result


def read_regular_path(
    path, maximum, label, *, expected_uid=0, expected_gid=None,
    expected_mode=None, forbidden_mode=0o022,
):
    fd = os.open(str(path), os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        before = os.fstat(fd)
        linked = os.lstat(str(path))
        mode = stat.S_IMODE(before.st_mode)
        if (
            not stat.S_ISREG(before.st_mode)
            or stat.S_ISLNK(linked.st_mode)
            or not same_inode(before, linked)
            or before.st_nlink != 1
            or (expected_uid is not None and before.st_uid != expected_uid)
            or (expected_gid is not None and before.st_gid != expected_gid)
            or (expected_mode is not None and mode != expected_mode)
            or (forbidden_mode and mode & forbidden_mode)
        ):
            raise InstallError(f"{label} topology is unsafe")
        raw = read_fd_exact(fd, maximum)
        after = os.fstat(fd)
        if (
            not same_inode(before, after)
            or before.st_size != after.st_size
            or before.st_mtime_ns != after.st_mtime_ns
            or len(raw) != before.st_size
        ):
            raise InstallError(f"{label} changed during read")
        return raw, {**topology(before), "same_inode": True}
    finally:
        os.close(fd)


def current_release():
    info = os.lstat(str(CURRENT_LINK))
    if not stat.S_ISLNK(info.st_mode) or info.st_uid != 0:
        raise InstallError("current release link topology is unsafe")
    target = os.readlink(str(CURRENT_LINK))
    if not re.fullmatch(r"/var/www/rosomaha/_releases/[A-Za-z0-9][A-Za-z0-9._-]{0,127}", target):
        raise InstallError("current release target is outside the fixed release root")
    repeated = os.lstat(str(CURRENT_LINK))
    if not same_inode(info, repeated) or os.readlink(str(CURRENT_LINK)) != target:
        raise InstallError("current release link changed during snapshot")
    realpath = os.path.realpath(str(CURRENT_LINK))
    if realpath != target:
        raise InstallError("current release realpath differs from its exact target")
    return {"target": target, "realpath": realpath, **topology(info)}


def read_cz_member(directory_fd, name):
    fd = os.open(name, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=directory_fd)
    try:
        before = os.fstat(fd)
        linked = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        if (
            not stat.S_ISREG(before.st_mode)
            or stat.S_ISLNK(linked.st_mode)
            or not same_inode(before, linked)
            or before.st_uid != 0
            or before.st_gid != 33
            or stat.S_IMODE(before.st_mode) != 0o664
            or before.st_nlink != 1
        ):
            raise InstallError(f"articles-cz file {name} topology is not root:33 0664")
        raw = read_fd_exact(fd, 2 * 1024 * 1024)
        after = os.fstat(fd)
        if (
            not same_inode(before, after)
            or before.st_size != after.st_size
            or before.st_mtime_ns != after.st_mtime_ns
            or len(raw) != before.st_size
        ):
            raise InstallError(f"articles-cz file {name} changed during read")
        return {"name": name, "bytes": len(raw), "sha256": sha256_bytes(raw), "topology": topology(before)}
    finally:
        os.close(fd)


def articles_cz_snapshot():
    directory_fd = open_exact_dir(
        ARTICLES_CZ_DIR, "articles-cz", uid=0, gid=33, exact_mode=0o2775,
        forbidden_mode=0,
    )
    try:
        before = os.fstat(directory_fd)
        names_before = sorted(os.listdir(directory_fd))
        if not 1 <= len(names_before) <= MAX_CZ_FILES:
            raise InstallError("articles-cz file count is outside the fixed bound")
        entries = []
        for name in names_before:
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.ts", name):
                raise InstallError("articles-cz contains a non-allowlisted filename")
            entries.append(read_cz_member(directory_fd, name))
        names_after = sorted(os.listdir(directory_fd))
        after = os.fstat(directory_fd)
        linked = os.lstat(str(ARTICLES_CZ_DIR))
        if names_after != names_before or not same_inode(before, after) or not same_inode(after, linked):
            raise InstallError("articles-cz directory changed during snapshot")
        return {
            "directory": {**topology(before), "same_inode": True},
            "count": len(entries), "files": entries,
            "digest": sha256_bytes(canonical_json(entries)),
        }
    finally:
        os.close(directory_fd)


def release_label_snapshot():
    releases_fd = open_exact_dir(RELEASES_DIR, "releases", uid=0, gid=None, forbidden_mode=0o022)
    try:
        before = os.fstat(releases_fd)
        names = sorted(os.listdir(releases_fd))
        if len(names) > 1000:
            raise InstallError("release label count exceeds the fixed bound")
        labels = []
        for name in names:
            if not re.fullmatch(r"[0-9]{8}-[0-9]{6}-[A-Za-z0-9][A-Za-z0-9._-]{0,63}", name):
                raise InstallError("release root contains a non-allowlisted label")
            info = os.stat(name, dir_fd=releases_fd, follow_symlinks=False)
            if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
                raise InstallError("release label does not name a real directory")
            labels.append(name)
        after = os.fstat(releases_fd)
        if not same_inode(before, after) or names != sorted(os.listdir(releases_fd)):
            raise InstallError("release labels changed during snapshot")
        return {"count": len(labels), "labels": labels, "digest": sha256_bytes(canonical_json(labels))}
    finally:
        os.close(releases_fd)


def seo_snapshot():
    validate_install_ancestors()
    current = current_release()
    current_articles_path = PurePosixPath(current["target"]) / "api/articles.json"
    canonical_raw, canonical_topology = read_regular_path(
        CANONICAL_ARTICLES, MAX_HTTP_BYTES, "canonical articles",
        expected_uid=0, expected_gid=33, expected_mode=0o664, forbidden_mode=0,
    )
    current_raw, current_topology = read_regular_path(
        current_articles_path, MAX_HTTP_BYTES, "current runtime articles",
        expected_uid=0, expected_gid=None, expected_mode=None, forbidden_mode=0o022,
    )
    articles = {
        "canonical": article_summary(canonical_raw, "canonical", canonical_topology),
        "current": article_summary(current_raw, "current", current_topology),
    }
    signatures = {
        (item["raw_sha256"], item["count"], item["slug_digest"])
        for item in articles.values()
    }
    if len(signatures) != 1:
        raise InstallError("canonical/current/live article parity is not exact")
    return {
        "current": current,
        "articles": articles,
        "article_parity": True,
        "articles_cz": articles_cz_snapshot(),
        "release_labels": release_label_snapshot(),
    }


def release_lock_topology_is_safe(before, linked):
    return bool(
        stat.S_ISREG(before.st_mode)
        and not stat.S_ISLNK(linked.st_mode)
        and before.st_uid == 0
        and before.st_gid in LOCK_ALLOWED_GIDS
        and stat.S_IMODE(before.st_mode) == 0o600
        and before.st_nlink == 1
        and same_inode(before, linked)
    )


def open_release_lock():
    validate_install_ancestors()
    app_fd = open_exact_dir(APP_ROOT, "application", uid=0, gid=33, exact_mode=0o3775, forbidden_mode=0)
    lock_fd = None
    try:
        try:
            lock_fd = os.open(
                LOCK_PATH.name,
                os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0),
                dir_fd=app_fd,
            )
        except FileNotFoundError as exc:
            raise InstallError("shared release lock is missing") from exc
        before = os.fstat(lock_fd)
        linked = os.stat(LOCK_PATH.name, dir_fd=app_fd, follow_symlinks=False)
        if not release_lock_topology_is_safe(before, linked):
            raise InstallError("shared release lock topology is unsafe")
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise InstallError("shared release lock is already held") from exc
        repeated = os.stat(LOCK_PATH.name, dir_fd=app_fd, follow_symlinks=False)
        if not same_inode(before, repeated):
            raise InstallError("shared release lock binding changed")
        return app_fd, lock_fd, {
            "path": str(LOCK_PATH), "uid": before.st_uid, "gid": before.st_gid,
            "mode": "0o600", "nlink": before.st_nlink, "exclusive": True,
            "existing": True, "created": False,
            "coverage": MIGRATION_COVERAGE,
            "legacy_direct_invocation_absolute_protection": False,
            "post_install_pair_uses_shared_lock": True,
        }
    except Exception:
        if lock_fd is not None:
            os.close(lock_fd)
        os.close(app_fd)
        raise


def close_release_lock(app_fd, lock_fd):
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_UN)
    finally:
        os.close(lock_fd)
        os.close(app_fd)


def scan_legacy_script_processes():
    proc_fd = open_exact_dir(PurePosixPath("/proc"), "proc", uid=0, gid=0, forbidden_mode=0)
    try:
        proc_info = os.fstat(proc_fd)
        names = sorted((name for name in os.listdir(proc_fd) if name.isdigit()), key=int)
        if len(names) > MAX_PROC_PIDS:
            raise InstallError("bounded /proc scan exceeds PID limit")
        exact_paths = {
            os.fsencode(str(SCRIPTS_DIR / spec["name"])): spec["name"]
            for spec in PAIR_SPECS.values()
        }
        matches = []
        disappeared = 0
        scanned = 0
        for name in names:
            pid_fd = None
            cmd_fd = None
            try:
                pid_fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0), dir_fd=proc_fd)
                cmd_fd = os.open("cmdline", os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=pid_fd)
                before = os.fstat(cmd_fd)
                linked = os.stat("cmdline", dir_fd=pid_fd, follow_symlinks=False)
                if not stat.S_ISREG(before.st_mode) or stat.S_ISLNK(linked.st_mode) or not same_inode(before, linked):
                    raise InstallError("/proc cmdline topology is unsafe")
                raw = read_fd_exact(cmd_fd, MAX_CMDLINE_BYTES)
                after = os.fstat(cmd_fd)
                if not same_inode(before, after):
                    raise InstallError("/proc cmdline changed inode during scan")
                scanned += 1
                argv = tuple(item for item in raw.split(b"\0") if item)
                for exact, script_name in exact_paths.items():
                    if exact in argv:
                        matches.append({"pid": int(name), "script": script_name})
            except OSError as exc:
                if exc.errno in {errno.ENOENT, errno.ESRCH}:
                    disappeared += 1
                    continue
                raise InstallError(f"bounded /proc scan failed for pid {name}: {exc.errno}") from exc
            finally:
                if cmd_fd is not None:
                    os.close(cmd_fd)
                if pid_fd is not None:
                    os.close(pid_fd)
        repeated = os.lstat("/proc")
        if not same_inode(proc_info, repeated):
            raise InstallError("/proc binding changed during bounded scan")
        evidence = {
            "complete_within_bound": True,
            "exact_argv_path_only": True,
            "pid_limit": MAX_PROC_PIDS,
            "pid_entries": len(names),
            "cmdlines_scanned": scanned,
            "disappeared_during_scan": disappeared,
            "matches": matches,
            "absolute_protection_claimed": False,
        }
        if matches:
            raise InstallError("legacy direct release/rollback process is active")
        return evidence
    finally:
        os.close(proc_fd)


def audit(mode):
    account = identity(mode)
    return {
        "schema": SCHEMA, "status": "audited", "mode": mode, "account": account,
        "read_only": True, "target_commit": TARGET_COMMIT,
        "targets": {key: spec["new_sha256"] for key, spec in PAIR_SPECS.items()},
        "olds": {key: spec["old_sha256"] for key, spec in PAIR_SPECS.items()},
        "pair": inspect_pair(), "seo_snapshot": seo_snapshot(),
        "scope": {
            "pair_only": True, "installed_scripts_executed": False,
            "state_evidence_read_only": True,
            "coverage": MIGRATION_COVERAGE,
        },
    }


def root_audit_scope():
    return {
        "pair_only": True,
        "installed_scripts_executed": False,
        "state_evidence_read_only": True,
        "lock_file_created": False,
        "backup_written": False,
        "staged_files_written": False,
        "script_modes_changed": False,
        "pair_replaced": False,
        "receipt_written": False,
        "coverage": MIGRATION_COVERAGE,
    }


def root_audit():
    account = identity("root-audit")
    app_fd = lock_fd = None
    try:
        app_fd, lock_fd, lock_evidence = open_release_lock()
        pair = inspect_pair()
        snapshot = seo_snapshot()
        process_scan = scan_legacy_script_processes()
        return {
            "schema": SCHEMA,
            "status": "root-audited",
            "mode": "root-audit",
            "account": account,
            "read_only": True,
            "target_commit": TARGET_COMMIT,
            "targets": {key: spec["new_sha256"] for key, spec in PAIR_SPECS.items()},
            "olds": {key: spec["old_sha256"] for key, spec in PAIR_SPECS.items()},
            "pair": pair,
            "seo_snapshot": snapshot,
            "process_scan": process_scan,
            "shared_release_lock": lock_evidence,
            "scope": root_audit_scope(),
        }
    finally:
        if app_fd is not None and lock_fd is not None:
            close_release_lock(app_fd, lock_fd)


def validate_root_process_scan(item):
    if (
        not isinstance(item, dict)
        or set(item) != {
            "complete_within_bound", "exact_argv_path_only", "pid_limit", "pid_entries",
            "cmdlines_scanned", "disappeared_during_scan", "matches",
            "absolute_protection_claimed",
        }
        or item.get("complete_within_bound") is not True
        or item.get("exact_argv_path_only") is not True
        or item.get("pid_limit") != MAX_PROC_PIDS
        or not isinstance(item.get("pid_entries"), int)
        or not 0 <= item["pid_entries"] <= MAX_PROC_PIDS
        or not isinstance(item.get("cmdlines_scanned"), int)
        or not isinstance(item.get("disappeared_during_scan"), int)
        or item["cmdlines_scanned"] < 0
        or item["disappeared_during_scan"] < 0
        or item["cmdlines_scanned"] + item["disappeared_during_scan"] != item["pid_entries"]
        or item.get("matches") != []
        or item.get("absolute_protection_claimed") is not False
    ):
        raise InstallError("root preflight process scan is not exact and clear")


def validate_root_lock_evidence(item):
    if (
        not isinstance(item, dict)
        or set(item) != {
            "path", "uid", "gid", "mode", "nlink", "exclusive", "existing", "created",
            "coverage", "legacy_direct_invocation_absolute_protection",
            "post_install_pair_uses_shared_lock",
        }
        or item.get("path") != str(LOCK_PATH)
        or item.get("uid") != 0
        or item.get("gid") not in LOCK_ALLOWED_GIDS
        or item.get("mode") != "0o600"
        or item.get("nlink") != 1
        or item.get("exclusive") is not True
        or item.get("existing") is not True
        or item.get("created") is not False
        or item.get("coverage") != MIGRATION_COVERAGE
        or item.get("legacy_direct_invocation_absolute_protection") is not False
        or item.get("post_install_pair_uses_shared_lock") is not True
    ):
        raise InstallError("root preflight shared-lock evidence is not exact")


def validate_root_pair_baseline(pair):
    if (
        not isinstance(pair, dict)
        or set(pair) != {"valid", "pair_state", "members", "trusted_ancestors"}
        or pair.get("valid") is not True
        or pair.get("pair_state") != "old/old"
        or not isinstance(pair.get("members"), dict)
        or set(pair["members"]) != set(PAIR_SPECS)
        or not isinstance(pair.get("trusted_ancestors"), dict)
        or set(pair["trusted_ancestors"]) != {"root", "var", "var-www", "application", "scripts"}
    ):
        raise InstallError("root preflight does not prove the exact old/old pair")
    for key, spec in PAIR_SPECS.items():
        item = pair["members"][key]
        if (
            not isinstance(item, dict)
            or set(item) != {"valid", "state", "sha256", "size", "uid", "gid", "mode", "nlink", "dev", "ino"}
            or item.get("valid") is not True
            or item.get("state") != "old"
            or item.get("sha256") != spec["old_sha256"]
            or not isinstance(item.get("size"), int)
            or not 0 < item["size"] <= MAX_SCRIPT_BYTES
            or item.get("uid") != 0
            or item.get("gid") != 0
            or item.get("mode") != "0o755"
            or item.get("nlink") != 1
            or not isinstance(item.get("dev"), int)
            or not isinstance(item.get("ino"), int)
        ):
            raise InstallError("root preflight old-pair member evidence is not exact")


def validate_root_preflight(root, remote, readback):
    expected = {
        "schema", "status", "mode", "account", "read_only", "target_commit",
        "targets", "olds", "pair", "seo_snapshot", "process_scan",
        "shared_release_lock", "scope",
    }
    if (
        not isinstance(root, dict)
        or set(root) != expected
        or root.get("schema") != SCHEMA
        or root.get("status") != "root-audited"
        or root.get("mode") != "root-audit"
        or root.get("account") != "root"
        or root.get("read_only") is not True
        or root.get("target_commit") != TARGET_COMMIT
        or root.get("targets") != {key: spec["new_sha256"] for key, spec in PAIR_SPECS.items()}
        or root.get("olds") != {key: spec["old_sha256"] for key, spec in PAIR_SPECS.items()}
        or root.get("scope") != root_audit_scope()
    ):
        raise InstallError("root preflight contract is not exact")
    validate_root_pair_baseline(root["pair"])
    validate_root_process_scan(root["process_scan"])
    validate_root_lock_evidence(root["shared_release_lock"])
    if (
        not isinstance(remote, dict)
        or remote.get("schema") != SCHEMA
        or remote.get("status") != "audited"
        or remote.get("mode") != "audit"
        or remote.get("account") != "deploy"
        or remote.get("read_only") is not True
        or remote.get("pair", {}).get("pair_state") != "old/old"
        or root["pair"] != remote.get("pair")
        or root.get("seo_snapshot") != remote.get("seo_snapshot")
        or not isinstance(readback, dict)
        or readback.get("pair_state") != "old/old"
        or not isinstance(readback.get("members"), dict)
        or set(readback["members"]) != set(PAIR_SPECS)
    ):
        raise InstallError("root/deploy baseline evidence disagrees")
    for key in PAIR_SPECS:
        root_member = root["pair"]["members"][key]
        sftp_member = readback["members"][key]
        if (
            not isinstance(sftp_member, dict)
            or sftp_member.get("topology_valid") is not True
            or any(root_member[field] != sftp_member.get(field) for field in ("state", "sha256", "size", "uid", "gid", "mode"))
            or (
                sftp_member.get("nlink_proved") is True
                and root_member["nlink"] != sftp_member.get("nlink")
            )
        ):
            raise InstallError("root/deploy/SFTP pair members disagree")


def open_bundle(bundle):
    match = BUNDLE_PATTERN.fullmatch(bundle)
    if match is None:
        raise InstallError("bundle path is outside the fixed scope")
    return open_exact_dir(PurePosixPath(bundle), "bundle", exact_mode=0o700), match.group(1)


def read_named(fd, name, maximum, *, mode=0o600):
    item_fd = os.open(name, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=fd)
    try:
        before = os.fstat(item_fd)
        linked = os.stat(name, dir_fd=fd, follow_symlinks=False)
        if (
            not stat.S_ISREG(before.st_mode)
            or stat.S_ISLNK(linked.st_mode)
            or before.st_uid != 0
            or before.st_gid != 0
            or stat.S_IMODE(before.st_mode) != mode
            or before.st_nlink != 1
            or not same_inode(before, linked)
        ):
            raise InstallError(f"fixed file topology is unsafe: {name}")
        raw = read_fd_exact(item_fd, maximum)
        after = os.fstat(item_fd)
        if (
            not same_inode(before, after)
            or before.st_size != after.st_size
            or before.st_mtime_ns != after.st_mtime_ns
            or len(raw) != before.st_size
        ):
            raise InstallError(f"fixed file changed during read: {name}")
        return raw
    finally:
        os.close(item_fd)


def load_baseline(bundle_fd, token_prefix):
    raw = read_named(bundle_fd, "baseline.json", MAX_BASELINE_BYTES)
    try:
        baseline = json.loads(raw.decode("utf-8"), object_pairs_hook=reject_duplicates)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise InstallError("baseline is invalid JSON") from exc
    if not isinstance(baseline, dict) or set(baseline) != EXPECTED_BASELINE_KEYS:
        raise InstallError("baseline fields are not exact")
    token = baseline.get("baseline_token")
    unsigned = dict(baseline)
    unsigned.pop("baseline_token", None)
    expected_targets = {key: spec["new_sha256"] for key, spec in PAIR_SPECS.items()}
    expected_olds = {key: spec["old_sha256"] for key, spec in PAIR_SPECS.items()}
    remote = baseline.get("remote")
    readback = baseline.get("independent_readback")
    root_preflight = baseline.get("root_preflight")
    if (
        raw != canonical_json(baseline) + b"\n"
        or not isinstance(token, str)
        or sha256_bytes(canonical_json(unsigned)) != token
        or token[:16] != token_prefix
        or baseline.get("schema") != BASELINE_SCHEMA
        or baseline.get("status") != "audited"
        or baseline.get("target_commit") != TARGET_COMMIT
        or baseline.get("targets") != expected_targets
        or baseline.get("olds") != expected_olds
        or not re.fullmatch(r"[0-9a-f]{64}", str(baseline.get("operator_sha256", "")))
        or not isinstance(remote, dict)
        or remote.get("schema") != SCHEMA
        or remote.get("account") != "deploy"
        or remote.get("pair", {}).get("pair_state") != "old/old"
        or not isinstance(remote.get("seo_snapshot"), dict)
        or not isinstance(readback, dict)
        or readback.get("pair_state") != "old/old"
        or not isinstance(root_preflight, dict)
        or not isinstance(baseline.get("independent_public"), dict)
    ):
        raise InstallError("baseline does not prove the exact old/old pair")
    validate_root_preflight(root_preflight, remote, readback)
    bundled_operator = read_named(bundle_fd, "operator.sh", MAX_SCRIPT_BYTES)
    if sha256_bytes(bundled_operator) != baseline["operator_sha256"]:
        raise InstallError("bundled operator differs from the audited fixed operator")
    return baseline


def create_exclusive(fd, name, raw, final_mode):
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    item_fd = os.open(name, flags, 0o600, dir_fd=fd)
    try:
        view = memoryview(raw)
        while view:
            count = os.write(item_fd, view)
            if count <= 0:
                raise InstallError("exclusive file write did not progress")
            view = view[count:]
        os.fchmod(item_fd, final_mode)
        os.fsync(item_fd)
        info = os.fstat(item_fd)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != 0
            or info.st_gid != 0
            or stat.S_IMODE(info.st_mode) != final_mode
            or info.st_nlink != 1
            or info.st_size != len(raw)
        ):
            raise InstallError("exclusive file postcondition failed")
    finally:
        os.close(item_fd)


def write_bundle_receipt(bundle_fd, name, payload):
    raw = canonical_json(payload) + b"\n"
    if len(raw) > MAX_RECEIPT_BYTES:
        raise InstallError("receipt exceeds size limit")
    create_exclusive(bundle_fd, name, raw, 0o600)
    os.fsync(bundle_fd)


def backup_name(key):
    spec = PAIR_SPECS[key]
    return f"{spec['name']}.{spec['old_sha256']}.bak"


def backup_manifest():
    return {
        "schema": BACKUP_MANIFEST_SCHEMA,
        "target_commit": TARGET_COMMIT,
        "scripts": {
            key: {"name": spec["name"], "sha256": spec["old_sha256"]}
            for key, spec in PAIR_SPECS.items()
        },
    }


def open_backup_parent():
    validate_backup_ancestors()
    return open_exact_dir(BACKUP_PARENT, "backup parent", uid=0, gid=0, forbidden_mode=0o022)


def create_backup_pair(old_raw):
    parent_fd = open_backup_parent()
    backup_fd = None
    try:
        os.mkdir(BACKUP_DIR_NAME, mode=0o700, dir_fd=parent_fd)
        os.fsync(parent_fd)
        backup_fd = os.open(
            BACKUP_DIR_NAME,
            os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0),
            dir_fd=parent_fd,
        )
        info = os.fstat(backup_fd)
        linked = os.stat(BACKUP_DIR_NAME, dir_fd=parent_fd, follow_symlinks=False)
        require_dir(info, "backup", uid=0, gid=0, exact_mode=0o700, forbidden_mode=0)
        if stat.S_ISLNK(linked.st_mode) or not same_inode(info, linked):
            raise InstallError("backup directory binding is unsafe")
        for key in ("rollback", "release"):
            if sha256_bytes(old_raw[key]) != PAIR_SPECS[key]["old_sha256"]:
                raise InstallError("old pair bytes do not match pinned backup hashes")
            create_exclusive(backup_fd, backup_name(key), old_raw[key], 0o400)
        create_exclusive(backup_fd, BACKUP_MANIFEST_NAME, canonical_json(backup_manifest()) + b"\n", 0o400)
        os.fsync(backup_fd)
    except FileExistsError as exc:
        raise InstallError("immutable pair backup already exists; apply retry is forbidden") from exc
    finally:
        if backup_fd is not None:
            os.close(backup_fd)
        os.close(parent_fd)
    result, raw = inspect_backup_pair()
    if result.get("status") != "complete":
        raise InstallError("immutable backup pair could not be proved complete")
    return result, raw


def inspect_backup_pair():
    parent_fd = open_backup_parent()
    backup_fd = None
    try:
        try:
            backup_fd = os.open(
                BACKUP_DIR_NAME,
                os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0),
                dir_fd=parent_fd,
            )
        except FileNotFoundError:
            return {"status": "absent", "complete": False, "present": []}, {}
        info = os.fstat(backup_fd)
        linked = os.stat(BACKUP_DIR_NAME, dir_fd=parent_fd, follow_symlinks=False)
        require_dir(info, "backup", uid=0, gid=0, exact_mode=0o700, forbidden_mode=0)
        if stat.S_ISLNK(linked.st_mode) or not same_inode(info, linked):
            raise InstallError("backup directory binding is unsafe")
        expected_names = {BACKUP_MANIFEST_NAME, *(backup_name(key) for key in PAIR_SPECS)}
        names = set(os.listdir(backup_fd))
        if not names.issubset(expected_names):
            raise InstallError("backup directory contains an unknown entry")
        if names != expected_names:
            return {"status": "partial", "complete": False, "present": sorted(names)}, {}
        raw = {key: read_named(backup_fd, backup_name(key), MAX_SCRIPT_BYTES, mode=0o400) for key in PAIR_SPECS}
        manifest_raw = read_named(backup_fd, BACKUP_MANIFEST_NAME, MAX_RECEIPT_BYTES, mode=0o400)
        try:
            manifest = json.loads(manifest_raw.decode("utf-8"), object_pairs_hook=reject_duplicates)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise InstallError("backup pair manifest is invalid") from exc
        if manifest_raw != canonical_json(manifest) + b"\n" or manifest != backup_manifest():
            raise InstallError("backup pair manifest is not exact")
        hashes = {key: sha256_bytes(value) for key, value in raw.items()}
        if any(hashes[key] != PAIR_SPECS[key]["old_sha256"] for key in PAIR_SPECS):
            raise InstallError("backup pair digest mismatch")
        return {
            "status": "complete", "complete": True, "present": sorted(names),
            "hashes": hashes, "manifest_sha256": sha256_bytes(manifest_raw),
        }, raw
    finally:
        if backup_fd is not None:
            os.close(backup_fd)
        os.close(parent_fd)


def safe_backup_snapshot():
    try:
        evidence, _raw = inspect_backup_pair()
        return evidence
    except Exception as exc:
        return {"status": "unknown", "complete": False, "error": safe_error(exc)}


def read_installed_raw_pair(required_state):
    pair = inspect_pair()
    if pair.get("pair_state") != required_state or not pair.get("valid"):
        raise InstallError(f"installed pair is not exact {required_state}")
    scripts_fd = open_exact_dir(SCRIPTS_DIR, "scripts", uid=0, gid=0, exact_mode=0o775, forbidden_mode=0)
    raw = {}
    try:
        for key, spec in PAIR_SPECS.items():
            raw[key] = read_named(scripts_fd, spec["name"], MAX_SCRIPT_BYTES, mode=0o755)
    finally:
        os.close(scripts_fd)
    return pair, raw


def temp_name(key, prefix, direction):
    return f".{PAIR_SPECS[key]['name']}.pair-{prefix}.{direction}.tmp"


def stage_pair(raw_pair, prefix, direction, expected_hash_field):
    scripts_fd = open_exact_dir(SCRIPTS_DIR, "scripts", uid=0, gid=0, exact_mode=0o775, forbidden_mode=0)
    staged = {}
    try:
        try:
            for key in ("rollback", "release"):
                expected = PAIR_SPECS[key][expected_hash_field]
                if sha256_bytes(raw_pair[key]) != expected:
                    raise InstallError("staged pair digest does not match pin")
                name = temp_name(key, prefix, direction)
                # Record the exclusive name before creation so a partial write
                # is never silently omitted from fail-closed cleanup evidence.
                staged[key] = {"name": name, "sha256": expected}
                create_exclusive(scripts_fd, name, raw_pair[key], 0o755)
            os.fsync(scripts_fd)
            return staged
        except Exception as exc:
            cleanup_errors = []
            for item in staged.values():
                try:
                    verify_named_raw(scripts_fd, item["name"], item["sha256"])
                    os.unlink(item["name"], dir_fd=scripts_fd)
                except Exception as cleanup_error:
                    cleanup_errors.append(safe_error(cleanup_error))
            os.fsync(scripts_fd)
            if cleanup_errors:
                raise InstallError(
                    "pair staging failed and exact temporary cleanup is unproved: "
                    + "; ".join(cleanup_errors)
                ) from exc
            raise
    finally:
        os.close(scripts_fd)


def verify_named_raw(scripts_fd, name, expected_sha):
    raw = read_named(scripts_fd, name, MAX_SCRIPT_BYTES, mode=0o755)
    if sha256_bytes(raw) != expected_sha:
        raise InstallError(f"staged file digest mismatch: {name}")
    return raw


def cleanup_staged(staged):
    if not staged:
        return "none"
    scripts_fd = open_exact_dir(SCRIPTS_DIR, "scripts", uid=0, gid=0, exact_mode=0o775, forbidden_mode=0)
    try:
        for item in staged.values():
            try:
                verify_named_raw(scripts_fd, item["name"], item["sha256"])
                os.unlink(item["name"], dir_fd=scripts_fd)
            except FileNotFoundError:
                pass
        os.fsync(scripts_fd)
        return "verified_cleanup_complete"
    finally:
        os.close(scripts_fd)


def replace_staged_member(scripts_fd, key, staged, expected_current_sha, desired_sha):
    spec = PAIR_SPECS[key]
    current = read_named(scripts_fd, spec["name"], MAX_SCRIPT_BYTES, mode=0o755)
    if sha256_bytes(current) != expected_current_sha:
        raise InstallError(f"{spec['name']} changed before atomic replace")
    verify_named_raw(scripts_fd, staged[key]["name"], desired_sha)
    os.replace(
        staged[key]["name"], spec["name"],
        src_dir_fd=scripts_fd, dst_dir_fd=scripts_fd,
    )
    os.fsync(scripts_fd)
    installed = read_named(scripts_fd, spec["name"], MAX_SCRIPT_BYTES, mode=0o755)
    if sha256_bytes(installed) != desired_sha:
        raise InstallError(f"{spec['name']} atomic replacement postcondition failed")


def read_open_fd(fd, maximum):
    os.lseek(fd, 0, os.SEEK_SET)
    return read_fd_exact(fd, maximum)


def freeze_executables(expected_states):
    if (
        not isinstance(expected_states, dict)
        or set(expected_states) != set(PAIR_SPECS)
        or any(state not in {"old", "new"} for state in expected_states.values())
    ):
        raise InstallError("executable freeze requires exact known pair states")
    scripts_fd = open_exact_dir(
        SCRIPTS_DIR, "scripts", uid=0, gid=0, exact_mode=0o775, forbidden_mode=0,
    )
    members = {}
    disabled = []
    try:
        # Pin both exact old inodes before changing either mode.  This is only a
        # bounded migration-window guard: root can still invoke `bash <path>`.
        for key in ("rollback", "release"):
            spec = PAIR_SPECS[key]
            fd = os.open(
                spec["name"], os.O_RDWR | getattr(os, "O_NOFOLLOW", 0),
                dir_fd=scripts_fd,
            )
            members[key] = {"fd": fd}
            before = os.fstat(fd)
            linked = os.stat(spec["name"], dir_fd=scripts_fd, follow_symlinks=False)
            require_script(before, spec["name"])
            raw = read_open_fd(fd, MAX_SCRIPT_BYTES)
            expected_sha = spec[f"{expected_states[key]}_sha256"]
            if (
                stat.S_ISLNK(linked.st_mode)
                or not same_inode(before, linked)
                or len(raw) != before.st_size
                or sha256_bytes(raw) != expected_sha
            ):
                raise InstallError("authorized pair changed before executable freeze")
            members[key].update({"pinned": before, "sha256": expected_sha, "state": expected_states[key]})

        for key in ("rollback", "release"):
            fd = members[key]["fd"]
            os.fchmod(fd, 0o600)
            os.fsync(fd)
            disabled.append(key)
        os.fsync(scripts_fd)

        for key in ("rollback", "release"):
            spec = PAIR_SPECS[key]
            fd = members[key]["fd"]
            pinned = members[key]["pinned"]
            frozen = os.fstat(fd)
            linked = os.stat(spec["name"], dir_fd=scripts_fd, follow_symlinks=False)
            raw = read_open_fd(fd, MAX_SCRIPT_BYTES)
            if (
                not stat.S_ISREG(frozen.st_mode)
                or frozen.st_uid != 0
                or frozen.st_gid != 0
                or stat.S_IMODE(frozen.st_mode) != 0o600
                or frozen.st_nlink != 1
                or not same_inode(frozen, pinned)
                or not same_inode(frozen, linked)
                or sha256_bytes(raw) != members[key]["sha256"]
            ):
                raise InstallError("authorized pair executable freeze postcondition failed")
        return {
            "scripts_fd": scripts_fd,
            "members": members,
            "disabled": tuple(disabled),
            "replaced": set(),
            "closed": False,
        }
    except Exception:
        for key in reversed(disabled):
            try:
                os.fchmod(members[key]["fd"], 0o755)
                os.fsync(members[key]["fd"])
            except OSError:
                pass
        try:
            os.fsync(scripts_fd)
        except OSError:
            pass
        for member in members.values():
            os.close(member["fd"])
        os.close(scripts_fd)
        raise


def freeze_old_executables():
    return freeze_executables({"release": "old", "rollback": "old"})


def verify_frozen_member(frozen_pair, key):
    scripts_fd = frozen_pair["scripts_fd"]
    member = frozen_pair["members"][key]
    spec = PAIR_SPECS[key]
    current = os.fstat(member["fd"])
    linked = os.stat(spec["name"], dir_fd=scripts_fd, follow_symlinks=False)
    raw = read_open_fd(member["fd"], MAX_SCRIPT_BYTES)
    if (
        not stat.S_ISREG(current.st_mode)
        or current.st_uid != 0
        or current.st_gid != 0
        or stat.S_IMODE(current.st_mode) != 0o600
        or current.st_nlink != 1
        or not same_inode(current, member["pinned"])
        or not same_inode(current, linked)
        or sha256_bytes(raw) != member["sha256"]
    ):
        raise InstallError(f"frozen old member changed before replace: {spec['name']}")


def install_new_pair(frozen_pair, staged):
    scripts_fd = frozen_pair["scripts_fd"]
    for key in ("rollback", "release"):
        verify_frozen_member(frozen_pair, key)
        desired_sha = PAIR_SPECS[key]["new_sha256"]
        verify_named_raw(scripts_fd, staged[key]["name"], desired_sha)
        os.replace(
            staged[key]["name"], PAIR_SPECS[key]["name"],
            src_dir_fd=scripts_fd, dst_dir_fd=scripts_fd,
        )
        os.fsync(scripts_fd)
        frozen_pair["replaced"].add(key)
        installed = read_named(
            scripts_fd, PAIR_SPECS[key]["name"], MAX_SCRIPT_BYTES, mode=0o755,
        )
        if sha256_bytes(installed) != desired_sha:
            raise InstallError(f"{PAIR_SPECS[key]['name']} replacement postcondition failed")


def close_frozen_pair(frozen_pair):
    if frozen_pair is None or frozen_pair.get("closed"):
        return {
            "executables_disabled_before_final_scan": False,
            "unreplaced_old_modes_restored": False,
        }
    scripts_fd = frozen_pair["scripts_fd"]
    restored = []
    errors = []
    try:
        for key in ("release", "rollback"):
            if key in frozen_pair["replaced"]:
                continue
            member = frozen_pair["members"][key]
            spec = PAIR_SPECS[key]
            try:
                current = os.fstat(member["fd"])
                linked = os.stat(spec["name"], dir_fd=scripts_fd, follow_symlinks=False)
                raw = read_open_fd(member["fd"], MAX_SCRIPT_BYTES)
                if (
                    not same_inode(current, member["pinned"])
                    or not same_inode(current, linked)
                    or stat.S_IMODE(current.st_mode) != 0o600
                    or sha256_bytes(raw) != member["sha256"]
                ):
                    raise InstallError(f"cannot safely restore frozen mode for {spec['name']}")
                os.fchmod(member["fd"], 0o755)
                os.fsync(member["fd"])
                post = os.fstat(member["fd"])
                if stat.S_IMODE(post.st_mode) != 0o755 or not same_inode(post, linked):
                    raise InstallError(f"old mode restore failed for {spec['name']}")
                restored.append(key)
            except Exception as exc:
                errors.append(safe_error(exc))
        os.fsync(scripts_fd)
    finally:
        for member in frozen_pair["members"].values():
            os.close(member["fd"])
        os.close(scripts_fd)
        frozen_pair["closed"] = True
    if errors:
        raise InstallError("frozen pair cleanup failed: " + "; ".join(errors))
    return {
        "executables_disabled_before_final_scan": len(frozen_pair["disabled"]) == 2,
        "unreplaced_old_modes_restored": set(restored) == set(PAIR_SPECS) - frozen_pair["replaced"],
        "replaced_members": sorted(frozen_pair["replaced"]),
        "residual_root_bypass_possible": True,
        "absolute_protection_claimed": False,
    }


def restore_old_pair(frozen_pair, staged, current_pair):
    scripts_fd = frozen_pair["scripts_fd"]
    # Restore release first.  Both mixed orientations converge to old/old.
    for key in ("release", "rollback"):
        current_state = current_pair["members"][key]["state"]
        verify_frozen_member(frozen_pair, key)
        if current_state == "new":
            desired_sha = PAIR_SPECS[key]["old_sha256"]
            verify_named_raw(scripts_fd, staged[key]["name"], desired_sha)
            os.replace(
                staged[key]["name"], PAIR_SPECS[key]["name"],
                src_dir_fd=scripts_fd, dst_dir_fd=scripts_fd,
            )
            os.fsync(scripts_fd)
            frozen_pair["replaced"].add(key)
            installed = read_named(
                scripts_fd, PAIR_SPECS[key]["name"], MAX_SCRIPT_BYTES, mode=0o755,
            )
            if sha256_bytes(installed) != desired_sha:
                raise InstallError(f"{PAIR_SPECS[key]['name']} rollback postcondition failed")
        elif current_state == "old":
            verify_named_raw(scripts_fd, staged[key]["name"], PAIR_SPECS[key]["old_sha256"])
            os.unlink(staged[key]["name"], dir_fd=scripts_fd)
            os.fsync(scripts_fd)
        else:
            raise InstallError("rollback cannot restore an unknown pair member")


def read_target_pair(bundle_fd):
    raw = {}
    for key, spec in PAIR_SPECS.items():
        raw[key] = read_named(bundle_fd, spec["name"], MAX_SCRIPT_BYTES)
        if sha256_bytes(raw[key]) != spec["new_sha256"]:
            raise InstallError("bundle target pair is not the pinned Git pair")
    return raw


def apply(bundle):
    identity("apply")
    bundle_fd, prefix = open_bundle(bundle)
    staged = {}
    app_fd = lock_fd = None
    frozen_pair = None
    try:
        baseline = load_baseline(bundle_fd, prefix)
        targets = read_target_pair(bundle_fd)
        write_bundle_receipt(bundle_fd, "apply-attempt.json", {
            "schema": SCHEMA, "mode": "apply", "baseline_token": baseline["baseline_token"],
            "target_commit": TARGET_COMMIT, "apply_retry_allowed": False,
        })
        app_fd, lock_fd, lock_evidence = open_release_lock()
        before = seo_snapshot()
        if before != baseline["remote"]["seo_snapshot"]:
            raise InstallError("SEO baseline changed before pair installation")
        pair_before, old_raw = read_installed_raw_pair("old/old")
        if pair_before != baseline["root_preflight"]["pair"]:
            raise InstallError("installed old pair differs from the root-audited baseline")
        backup, _backup_raw = create_backup_pair(old_raw)
        scan_before_stage = scan_legacy_script_processes()
        staged = stage_pair(targets, prefix, "new", "new_sha256")
        if inspect_pair().get("pair_state") != "old/old" or seo_snapshot() != before:
            raise InstallError("pair or SEO state changed during staging")
        frozen_pair = freeze_old_executables()
        scan_before_replace = scan_legacy_script_processes()
        install_new_pair(frozen_pair, staged)
        migration_freeze = close_frozen_pair(frozen_pair)
        frozen_pair = None
        pair_after = inspect_pair()
        if pair_after.get("pair_state") != "new/new" or not pair_after.get("valid"):
            raise InstallError("pair installation did not reach exact new/new")
        after = seo_snapshot()
        if after != before:
            raise InstallError("SEO state changed during pair installation")
        cleanup_status = cleanup_staged(staged)
        staged = {}
        receipt = {
            "schema": SCHEMA, "status": "installed", "mode": "apply", "account": "root",
            "baseline_token": baseline["baseline_token"], "target_commit": TARGET_COMMIT,
            "pair_before": pair_before, "pair_after": pair_after, "backup": backup,
            "process_scans": [scan_before_stage, scan_before_replace],
            "migration_freeze": migration_freeze,
            "shared_release_lock": lock_evidence,
            "before": before, "after": after, "state_unchanged": before == after,
            "staging_cleanup": cleanup_status,
            "scope": {
                "pair_only": True, "installed_scripts_executed": False,
                "current_unchanged_proved": before["current"] == after["current"],
                "content_unchanged_proved": before == after,
                "coverage": MIGRATION_COVERAGE,
            },
        }
        write_bundle_receipt(bundle_fd, "operation-receipt.json", receipt)
        return receipt
    finally:
        try:
            if frozen_pair is not None:
                close_frozen_pair(frozen_pair)
        finally:
            try:
                if staged:
                    cleanup_staged(staged)
            finally:
                if app_fd is not None and lock_fd is not None:
                    close_release_lock(app_fd, lock_fd)
                os.close(bundle_fd)


def recover(bundle):
    identity("recover")
    bundle_fd, prefix = open_bundle(bundle)
    app_fd = lock_fd = None
    try:
        baseline = load_baseline(bundle_fd, prefix)
        try:
            read_named(bundle_fd, "apply-attempt.json", MAX_RECEIPT_BYTES)
            attempted = True
        except FileNotFoundError:
            attempted = False
        app_fd, lock_fd, lock_evidence = open_release_lock()
        process_scan = scan_legacy_script_processes()
        pair = inspect_pair()
        snapshot = seo_snapshot()
        backup = safe_backup_snapshot()
        state = pair.get("pair_state", "unknown")
        if state in {"new/new", "mixed"} and backup.get("complete") is not True:
            state = "unknown"
        return {
            "schema": SCHEMA, "status": "recovered", "mode": "recover", "account": "root",
            "read_only": True, "baseline_token": baseline["baseline_token"],
            "attempted": attempted, "classification": state, "pair": pair,
            "backup": backup, "seo_snapshot": snapshot, "process_scan": process_scan,
            "shared_release_lock": lock_evidence,
            "apply_retry_allowed": False, "automatic_rollback_allowed": False,
        }
    finally:
        if app_fd is not None and lock_fd is not None:
            close_release_lock(app_fd, lock_fd)
        os.close(bundle_fd)


def load_rollback_authorization(bundle_fd, baseline):
    raw = read_named(bundle_fd, "rollback-authorization.json", MAX_RECEIPT_BYTES)
    try:
        auth = json.loads(raw.decode("utf-8"), object_pairs_hook=reject_duplicates)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise InstallError("rollback authorization is invalid JSON") from exc
    expected = {
        "schema", "target_commit", "baseline_token", "authorized_pair_state",
        "authorized_member_states", "source_receipt_sha256",
    }
    if (
        not isinstance(auth, dict)
        or set(auth) != expected
        or raw != canonical_json(auth) + b"\n"
        or auth.get("schema") != ROLLBACK_AUTH_SCHEMA
        or auth.get("target_commit") != TARGET_COMMIT
        or auth.get("baseline_token") != baseline["baseline_token"]
        or auth.get("authorized_pair_state") not in {"new/new", "mixed"}
        or set(auth.get("authorized_member_states", {})) != set(PAIR_SPECS)
        or any(state not in {"old", "new"} for state in auth["authorized_member_states"].values())
        or not re.fullmatch(r"[0-9a-f]{64}", str(auth.get("source_receipt_sha256", "")))
    ):
        raise InstallError("rollback authorization is not exact")
    if classify_pair({
        key: {"valid": True, "state": state}
        for key, state in auth["authorized_member_states"].items()
    }) != auth["authorized_pair_state"]:
        raise InstallError("rollback authorization pair state is inconsistent")
    return auth


def rollback(bundle):
    identity("rollback")
    bundle_fd, prefix = open_bundle(bundle)
    staged = {}
    app_fd = lock_fd = None
    frozen_pair = None
    try:
        baseline = load_baseline(bundle_fd, prefix)
        authorization = load_rollback_authorization(bundle_fd, baseline)
        write_bundle_receipt(bundle_fd, "rollback-attempt.json", {
            "schema": SCHEMA, "mode": "rollback", "baseline_token": baseline["baseline_token"],
            "authorized_pair_state": authorization["authorized_pair_state"],
            "rollback_retry_allowed": False,
        })
        app_fd, lock_fd, lock_evidence = open_release_lock()
        before = seo_snapshot()
        if before != baseline["remote"]["seo_snapshot"]:
            raise InstallError("SEO baseline drifted; refusing pair rollback")
        pair_before = inspect_pair()
        if (
            pair_before.get("pair_state") != authorization["authorized_pair_state"]
            or {
                key: pair_before.get("members", {}).get(key, {}).get("state")
                for key in PAIR_SPECS
            } != authorization["authorized_member_states"]
        ):
            raise InstallError("installed pair differs from rollback authorization")
        backup, old_raw = inspect_backup_pair()
        if backup.get("complete") is not True:
            raise InstallError("complete immutable pair backup is required for rollback")
        scan_before_stage = scan_legacy_script_processes()
        staged = stage_pair(old_raw, prefix, "old", "old_sha256")
        current_recheck = inspect_pair()
        if current_recheck != pair_before or seo_snapshot() != before:
            raise InstallError("pair or SEO state changed during rollback staging")
        frozen_pair = freeze_executables(authorization["authorized_member_states"])
        scan_before_replace = scan_legacy_script_processes()
        restore_old_pair(frozen_pair, staged, pair_before)
        migration_freeze = close_frozen_pair(frozen_pair)
        frozen_pair = None
        pair_after = inspect_pair()
        if pair_after.get("pair_state") != "old/old" or not pair_after.get("valid"):
            raise InstallError("pair rollback did not reach exact old/old")
        after = seo_snapshot()
        if after != before:
            raise InstallError("SEO state changed during pair rollback")
        cleanup_status = cleanup_staged(staged)
        staged = {}
        result = {
            "schema": SCHEMA, "status": "rolled_back", "mode": "rollback", "account": "root",
            "baseline_token": baseline["baseline_token"], "target_commit": TARGET_COMMIT,
            "authorization": authorization, "pair_before": pair_before, "pair_after": pair_after,
            "backup": backup, "process_scans": [scan_before_stage, scan_before_replace],
            "migration_freeze": migration_freeze,
            "shared_release_lock": lock_evidence,
            "before": before, "after": after, "state_unchanged": before == after,
            "staging_cleanup": cleanup_status, "installed_scripts_executed": False,
            "current_unchanged_proved": before["current"] == after["current"],
            "content_unchanged_proved": before == after,
        }
        write_bundle_receipt(bundle_fd, "rollback-receipt.json", result)
        return result
    finally:
        try:
            if frozen_pair is not None:
                close_frozen_pair(frozen_pair)
        finally:
            try:
                if staged:
                    cleanup_staged(staged)
            finally:
                if app_fd is not None and lock_fd is not None:
                    close_release_lock(app_fd, lock_fd)
                os.close(bundle_fd)


def main():
    mode = sys.argv[1]
    bundle = sys.argv[2]
    try:
        if mode == "audit":
            result = audit(mode)
        elif mode == "root-audit":
            result = root_audit()
        elif mode == "apply":
            result = apply(bundle)
        elif mode == "recover":
            result = recover(bundle)
        elif mode == "rollback":
            result = rollback(bundle)
        else:
            raise InstallError("invalid fixed mode")
        print(canonical_json(result).decode("utf-8"))
        return 0
    except Exception as exc:
        payload = {
            "schema": SCHEMA, "status": "error", "mode": mode,
            "error_type": type(exc).__name__, "error": safe_error(exc),
            "apply_retried": False,
        }
        try:
            payload["observed_pair"] = inspect_pair()
        except Exception:
            payload["observed_pair"] = {"valid": False, "pair_state": "unknown"}
        print(canonical_json(payload).decode("utf-8"))
        return 1


raise SystemExit(main())
PY
