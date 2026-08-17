#!/usr/bin/env bash
set -euo pipefail
umask 077
export PATH="/usr/bin:/bin"

MODE="${1:-audit}"
BASELINE_TOKEN="${2:-}"
AUDIT_EPOCH="${3:-}"

exec /usr/bin/python3 - "$MODE" "$BASELINE_TOKEN" "$AUDIT_EPOCH" <<'PY'
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import pwd
import re
import shutil
import stat
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


MODE = sys.argv[1]
BASELINE_TOKEN = sys.argv[2] if len(sys.argv) > 2 else ""
AUDIT_EPOCH_RAW = sys.argv[3] if len(sys.argv) > 3 else ""

SCHEMA = "rosomaha-staging-dist-sync/v1"
HOST = "90.156.168.115"
AUDIT_LOGIN = "deploy"
APPLY_LOGIN = "root"
ROLES = {"audit": AUDIT_LOGIN, "apply": APPLY_LOGIN, "recover": APPLY_LOGIN}

APP_ROOT = Path("/var/www/rosomaha")
DIST_DIR = APP_ROOT / "dist"
RELEASES_DIR = APP_ROOT / "_releases"
CURRENT_LINK = APP_ROOT / "current"
CANONICAL_ARTICLES = APP_ROOT / "public/api/articles.json"
ARTICLES_CZ_DIR = APP_ROOT / "src/data/articles-cz"
RELEASE_SCRIPT = APP_ROOT / "scripts/server-release.sh"
ROLLBACK_SCRIPT = APP_ROOT / "scripts/server-rollback.sh"
LOCK_PATH = APP_ROOT / ".rosomaha-main-price-release.lock"
PUBLIC_ARTICLES_URL = "https://xn--80aa8ahaki9a.site/api/articles.json"

RELEASE_SCRIPT_SHA256 = "9caad8bde40e0f269ad0887c8b16c97cfc18c0495ad72068f2c812d2859c1fa2"
ROLLBACK_SCRIPT_SHA256 = "8f2390ec2d6b3248b49ef8b690de5413bdcc7930180e584524de72094d676388"

MAX_TREE_FILES = 20_000
MAX_TREE_FILE_BYTES = 1024 * 1024 * 1024
MAX_ARTICLE_BYTES = 25 * 1024 * 1024
MAX_CZ_FILES = 1_000
AUDIT_TTL_SECONDS = 30 * 60
FIXED_TOKEN_PATTERN = re.compile(r"[0-9a-f]{64}")
FIXED_EPOCH_PATTERN = re.compile(r"[0-9]{10}")
SAFE_STATE_GIDS = {0, 33}
LEGACY_SETGID_RECOVERY_EPOCHS = {
    "4ff66bb7a6f5c1c826cf4d5da05337b279fc1e3e7db301528f858f996e24baaf": 1786972429,
    "cea04a069c7ebc859d964378363b0e12fc5fb1cec41d6494eb61c5a6395bf308": 1786972483,
}


class SyncError(RuntimeError):
    pass


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha256_bytes(raw):
    return hashlib.sha256(raw).hexdigest()


def read_regular_exact(path, *, root, max_bytes=None, require_root_owner=False):
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags)
    try:
        before = os.fstat(fd)
        linked = os.lstat(path)
        mode = stat.S_IMODE(before.st_mode)
        if (
            not stat.S_ISREG(before.st_mode) or stat.S_ISLNK(linked.st_mode)
            or before.st_nlink != 1
            or (before.st_dev, before.st_ino) != (linked.st_dev, linked.st_ino)
            or not within(root, path)
            or (require_root_owner and (before.st_uid != 0 or mode & 0o022))
            or (max_bytes is not None and before.st_size > max_bytes)
        ):
            raise SyncError(f"unsafe exact regular file: {path}")
        chunks = []
        total = 0
        while True:
            limit = 1024 * 1024 if max_bytes is None else min(1024 * 1024, max_bytes + 1 - total)
            chunk = os.read(fd, limit)
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if max_bytes is not None and total > max_bytes:
                raise SyncError(f"exact regular file exceeds fixed limit: {path}")
        after = os.fstat(fd)
        if (
            (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
            != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
            or total != before.st_size
        ):
            raise SyncError(f"exact regular file changed during read: {path}")
        raw = b"".join(chunks)
        return raw, before
    finally:
        os.close(fd)


def digest_regular_exact(path, *, root, max_bytes=MAX_TREE_FILE_BYTES):
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags)
    try:
        before = os.fstat(fd)
        linked = os.lstat(path)
        if (
            not stat.S_ISREG(before.st_mode) or stat.S_ISLNK(linked.st_mode)
            or before.st_nlink != 1
            or (before.st_dev, before.st_ino) != (linked.st_dev, linked.st_ino)
            or not within(root, path) or before.st_size > max_bytes
        ):
            raise SyncError(f"unsafe exact digest file: {path}")
        digest = hashlib.sha256()
        total = 0
        while True:
            chunk = os.read(fd, min(1024 * 1024, max_bytes + 1 - total))
            if not chunk:
                break
            digest.update(chunk)
            total += len(chunk)
            if total > max_bytes:
                raise SyncError(f"exact digest file exceeds fixed limit: {path}")
        after = os.fstat(fd)
        if (
            total != before.st_size
            or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
            != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
        ):
            raise SyncError(f"exact digest file changed during read: {path}")
        return before, digest.hexdigest()
    finally:
        os.close(fd)


def resolved(path):
    try:
        return str(path.resolve(strict=True))
    except OSError:
        return None


def within(root, path):
    try:
        root_real = str(root.resolve(strict=True))
        path_real = str(path.resolve(strict=True))
        return os.path.commonpath((root_real, path_real)) == root_real
    except (OSError, ValueError):
        return False


def identity_for_mode(mode):
    uid = os.getuid()
    euid = os.geteuid()
    login = pwd.getpwuid(uid).pw_name
    expected = AUDIT_LOGIN if mode == "audit" else APPLY_LOGIN
    valid = bool(login == expected and euid == uid and ((mode == "audit" and uid != 0) or (mode != "audit" and uid == 0)))
    return {"login": login, "uid": uid, "euid": euid, "expected": expected, "valid": valid}


def safe_root_directory(path, *, allow_group_write=False, require_sticky=False):
    try:
        details = os.lstat(path)
        realpath = path.resolve(strict=True)
        mode = stat.S_IMODE(details.st_mode)
        valid = bool(
            stat.S_ISDIR(details.st_mode)
            and not stat.S_ISLNK(details.st_mode)
            and str(realpath) == str(path)
            and details.st_uid == 0
            and not mode & stat.S_IWOTH
            and (allow_group_write or not mode & stat.S_IWGRP)
            and (not require_sticky or bool(details.st_mode & stat.S_ISVTX))
        )
        return {
            "path": str(path), "realpath": str(realpath), "exists": True,
            "directory": stat.S_ISDIR(details.st_mode), "symlink": stat.S_ISLNK(details.st_mode),
            "uid": details.st_uid, "gid": details.st_gid, "mode": oct(mode),
            "dev": details.st_dev, "ino": details.st_ino,
            "sticky": bool(details.st_mode & stat.S_ISVTX), "valid": valid,
        }
    except OSError as exc:
        return {"path": str(path), "exists": False, "valid": False, "error": f"{type(exc).__name__}: {exc}"}


def safe_mutable_root(path):
    try:
        details = os.lstat(path)
        mode = stat.S_IMODE(details.st_mode)
        valid = bool(
            stat.S_ISDIR(details.st_mode)
            and not stat.S_ISLNK(details.st_mode)
            and str(path.resolve(strict=True)) == str(path)
            and within(APP_ROOT, path)
            and details.st_uid == 0
            and not mode & stat.S_IWOTH
        )
        return {
            "path": str(path), "realpath": resolved(path), "exists": True,
            "directory": stat.S_ISDIR(details.st_mode), "symlink": stat.S_ISLNK(details.st_mode),
            "uid": details.st_uid, "gid": details.st_gid, "mode": oct(mode),
            "dev": details.st_dev, "ino": details.st_ino, "valid": valid,
        }
    except OSError as exc:
        return {"path": str(path), "exists": False, "valid": False, "error": f"{type(exc).__name__}: {exc}"}


def release_path(value):
    if not value:
        return False
    try:
        path = Path(value)
        details = os.lstat(path)
        return bool(
            stat.S_ISDIR(details.st_mode) and not stat.S_ISLNK(details.st_mode)
            and path.parent == RELEASES_DIR and within(RELEASES_DIR, path)
        )
    except OSError:
        return False


def trusted_current_link():
    try:
        details = os.lstat(CURRENT_LINK)
        link_target = os.readlink(CURRENT_LINK)
        target = resolved(CURRENT_LINK)
        valid = bool(
            stat.S_ISLNK(details.st_mode) and details.st_uid == 0
            and Path(link_target).is_absolute() and link_target == target
            and CURRENT_LINK.parent.resolve(strict=True) == APP_ROOT.resolve(strict=True)
            and release_path(target)
        )
        return {
            "path": str(CURRENT_LINK), "exists": True, "symlink": stat.S_ISLNK(details.st_mode),
            "uid": details.st_uid, "gid": details.st_gid, "mode": oct(stat.S_IMODE(details.st_mode)),
            "dev": details.st_dev, "ino": details.st_ino,
            "link_target": link_target, "realpath": target, "valid": valid,
        }
    except OSError as exc:
        return {"path": str(CURRENT_LINK), "exists": False, "valid": False, "error": f"{type(exc).__name__}: {exc}"}


def trusted_closed_tree(root):
    root_info = safe_root_directory(root)
    if not root_info.get("valid"):
        return {"root": str(root), "valid": False, "error": "untrusted tree root", "root_info": root_info}
    file_count = 0
    directory_count = 0
    try:
        for current, dir_names, file_names in os.walk(root, followlinks=False):
            dir_names.sort()
            file_names.sort()
            current_path = Path(current)
            for name in dir_names:
                item = current_path / name
                details = os.lstat(item)
                mode = stat.S_IMODE(details.st_mode)
                if (
                    not stat.S_ISDIR(details.st_mode) or stat.S_ISLNK(details.st_mode)
                    or details.st_uid != 0 or mode & 0o022 or not within(root, item)
                ):
                    return {"root": str(root), "valid": False, "error": f"untrusted tree directory: {item}"}
                directory_count += 1
            for name in file_names:
                item = current_path / name
                details = os.lstat(item)
                mode = stat.S_IMODE(details.st_mode)
                if (
                    not stat.S_ISREG(details.st_mode) or stat.S_ISLNK(details.st_mode)
                    or details.st_nlink != 1 or details.st_uid != 0 or mode & 0o022
                    or not within(root, item)
                ):
                    return {"root": str(root), "valid": False, "error": f"untrusted tree file: {item}"}
                file_count += 1
                if file_count > MAX_TREE_FILES:
                    return {"root": str(root), "valid": False, "error": "tree file-count limit exceeded"}
        return {
            "root": str(root), "valid": True, "file_count": file_count,
            "directory_count": directory_count, "root_info": root_info,
        }
    except OSError as exc:
        return {"root": str(root), "valid": False, "error": f"{type(exc).__name__}: {exc}"}


def tree_manifest(root):
    root_info = safe_mutable_root(root)
    if not root_info.get("valid"):
        return {"root": str(root), "valid": False, "error": "unsafe tree root", "root_info": root_info}
    files = []
    directory_count = 0
    try:
        for current, dir_names, file_names in os.walk(root, followlinks=False):
            dir_names.sort()
            file_names.sort()
            current_path = Path(current)
            for name in dir_names:
                item = current_path / name
                details = os.lstat(item)
                if not stat.S_ISDIR(details.st_mode) or stat.S_ISLNK(details.st_mode) or not within(root, item):
                    return {"root": str(root), "valid": False, "error": f"unsafe directory: {item}"}
                directory_count += 1
            for name in file_names:
                item = current_path / name
                details = os.lstat(item)
                if (
                    not stat.S_ISREG(details.st_mode) or stat.S_ISLNK(details.st_mode)
                    or details.st_nlink != 1 or not within(root, item)
                ):
                    return {"root": str(root), "valid": False, "error": f"unsafe file: {item}"}
                exact, digest = digest_regular_exact(item, root=root)
                files.append({"path": item.relative_to(root).as_posix(), "bytes": exact.st_size, "sha256": digest})
                if len(files) > MAX_TREE_FILES:
                    return {"root": str(root), "valid": False, "error": "tree file-count limit exceeded"}
        files.sort(key=lambda item: item["path"])
        return {
            "root": str(root), "valid": True, "files": files, "file_count": len(files),
            "directory_count": directory_count, "digest": sha256_bytes(canonical_json(files)),
            "root_info": root_info,
        }
    except OSError as exc:
        return {"root": str(root), "valid": False, "error": f"{type(exc).__name__}: {exc}"}


def tree_contract(value):
    return {key: value.get(key) for key in ("valid", "files", "file_count", "directory_count", "digest")}


def exact_tree_contract(left, right):
    return canonical_json(tree_contract(left)) == canonical_json(tree_contract(right))


def manifest_diff(current, staging):
    if not current.get("valid") or not staging.get("valid"):
        raise SyncError("cannot diff invalid manifests")
    current_files = {item["path"]: item for item in current["files"]}
    staging_files = {item["path"]: item for item in staging["files"]}
    current_paths = set(current_files)
    staging_paths = set(staging_files)
    missing_from_staging = sorted(current_paths - staging_paths)
    extra_in_staging = sorted(staging_paths - current_paths)
    changed = sorted(
        path for path in current_paths & staging_paths
        if current_files[path] != staging_files[path]
    )
    return {
        "missing_from_staging": missing_from_staging,
        "extra_in_staging": extra_in_staging,
        "changed": changed,
        "missing_count": len(missing_from_staging),
        "extra_count": len(extra_in_staging),
        "changed_count": len(changed),
        "exact": not missing_from_staging and not extra_in_staging and not changed,
    }


def article_info(raw, source):
    result = {"source": source, "sha256": sha256_bytes(raw), "bytes": len(raw), "valid": False}
    try:
        if len(raw) > MAX_ARTICLE_BYTES:
            raise ValueError("article export exceeds fixed size limit")
        payload = json.loads(raw.decode("utf-8-sig"))
        if not isinstance(payload, list):
            raise ValueError("article export is not an array")
        slugs = []
        for index, item in enumerate(payload):
            if not isinstance(item, dict) or not isinstance(item.get("slug"), str) or not item["slug"].strip():
                raise ValueError(f"item {index} has no valid slug")
            slugs.append(item["slug"].strip())
        unique = sorted(set(slugs))
        duplicates = sorted(slug for slug in unique if slugs.count(slug) > 1)
        result.update({
            "count": len(slugs), "unique_count": len(unique), "duplicates": duplicates,
            "slug_digest": sha256_bytes(("\n".join(unique) + "\n").encode("utf-8")),
            "valid": not duplicates,
        })
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
    return result


def article_file(path, source):
    try:
        raw, _ = read_regular_exact(path, root=APP_ROOT, max_bytes=MAX_ARTICLE_BYTES)
        return article_info(raw, source)
    except Exception as exc:
        return {"source": source, "valid": False, "error": f"{type(exc).__name__}: {exc}"}


def live_articles():
    request = urllib.request.Request(
        PUBLIC_ARTICLES_URL,
        headers={"User-Agent": "RosomahaStagingDistSync/1.0", "Accept": "application/json"},
    )
    last_error = None
    for attempt in range(3):
        try:
            opener = urllib.request.build_opener(urllib.request.HTTPHandler())
            with opener.open(request, timeout=25) as response:
                raw = response.read(MAX_ARTICLE_BYTES + 1)
                result = article_info(raw, "live")
                result.update({
                    "http_status": int(response.status), "final_url": response.geturl(),
                    "attempts": attempt + 1,
                })
                if response.status != 200 or response.geturl() != PUBLIC_ARTICLES_URL or len(raw) > MAX_ARTICLE_BYTES:
                    result["valid"] = False
                return result
        except Exception as exc:
            last_error = exc
            if attempt < 2:
                time.sleep((1, 3)[attempt])
    return {"source": "live", "valid": False, "error": f"{type(last_error).__name__}: {last_error}"}


def article_contract(value):
    return {
        key: value.get(key)
        for key in ("sha256", "bytes", "count", "unique_count", "duplicates", "slug_digest", "valid")
    }


def articles_cz_manifest():
    root = safe_mutable_root(ARTICLES_CZ_DIR)
    if not root.get("valid"):
        return {"valid": False, "error": "unsafe articles-cz root"}
    try:
        entries = []
        observed = sorted(ARTICLES_CZ_DIR.iterdir(), key=lambda item: item.name)
        if len(observed) > MAX_CZ_FILES:
            return {"valid": False, "error": "articles-cz file-count limit exceeded"}
        for path in observed:
            details = os.lstat(path)
            if (
                path.suffix != ".ts" or not stat.S_ISREG(details.st_mode)
                or stat.S_ISLNK(details.st_mode) or details.st_nlink != 1
                or not within(ARTICLES_CZ_DIR, path)
            ):
                return {"valid": False, "error": f"unsafe articles-cz entry: {path.name}"}
            exact, digest = digest_regular_exact(path, root=ARTICLES_CZ_DIR, max_bytes=MAX_ARTICLE_BYTES)
            entries.append({"name": path.name, "bytes": exact.st_size, "sha256": digest})
        if not entries:
            return {"valid": False, "error": "articles-cz is empty"}
        return {"valid": True, "count": len(entries), "files": entries, "digest": sha256_bytes(canonical_json(entries))}
    except OSError as exc:
        return {"valid": False, "error": f"{type(exc).__name__}: {exc}"}


def script_integrity(path, expected):
    try:
        raw, details = read_regular_exact(
            path, root=APP_ROOT, max_bytes=256 * 1024, require_root_owner=True,
        )
        observed = sha256_bytes(raw)
        return {
            "path": str(path), "exists": True, "regular": True, "symlink": False,
            "nlink": details.st_nlink, "uid": details.st_uid, "gid": details.st_gid,
            "mode": oct(stat.S_IMODE(details.st_mode)), "bytes": details.st_size,
            "dev": details.st_dev, "ino": details.st_ino, "sha256": observed,
            "expected_sha256": expected, "valid": observed == expected,
        }
    except Exception as exc:
        return {"path": str(path), "exists": False, "sha256": None, "expected_sha256": expected, "valid": False, "error": f"{type(exc).__name__}: {exc}"}


def lock_topology():
    try:
        details = os.lstat(LOCK_PATH)
        valid = bool(
            stat.S_ISREG(details.st_mode) and not stat.S_ISLNK(details.st_mode)
            and details.st_nlink == 1 and details.st_uid == 0 and details.st_gid in {0, 33}
            and stat.S_IMODE(details.st_mode) == 0o600 and within(APP_ROOT, LOCK_PATH)
        )
        return {
            "path": str(LOCK_PATH), "exists": True, "regular": stat.S_ISREG(details.st_mode),
            "symlink": stat.S_ISLNK(details.st_mode), "nlink": details.st_nlink,
            "uid": details.st_uid, "gid": details.st_gid,
            "mode": oct(stat.S_IMODE(details.st_mode)),
            "dev": details.st_dev, "ino": details.st_ino, "valid": valid,
        }
    except OSError as exc:
        return {"path": str(LOCK_PATH), "exists": False, "valid": False, "error": f"{type(exc).__name__}: {exc}"}


def topology_snapshot(current):
    fixed_roots = {
        "filesystem_root": safe_root_directory(Path("/")),
        "var": safe_root_directory(Path("/var")),
        "var_www": safe_root_directory(Path("/var/www")),
        "app_root": safe_root_directory(APP_ROOT, allow_group_write=True, require_sticky=True),
        "releases": safe_root_directory(RELEASES_DIR),
        "dist": safe_mutable_root(DIST_DIR),
    }
    devices = {name: item.get("dev") for name, item in fixed_roots.items() if name in {"app_root", "releases", "dist"}}
    same_filesystem = bool(len(devices) == 3 and len(set(devices.values())) == 1 and None not in devices.values())
    return {
        "roots": fixed_roots,
        "current_link": current,
        "same_filesystem": same_filesystem,
        "devices": devices,
        "valid": bool(all(item.get("valid") for item in fixed_roots.values()) and current.get("valid") and same_filesystem),
    }


def article_parity(articles):
    contracts = [article_contract(articles[name]) for name in ("canonical", "current", "live")]
    return bool(all(item.get("valid") for item in contracts) and len({canonical_json(item) for item in contracts}) == 1)


def state_material(snapshot):
    return {
        "schema": SCHEMA,
        "host": HOST,
        "roles": ROLES,
        "paths": {
            "app_root": str(APP_ROOT), "dist": str(DIST_DIR), "releases": str(RELEASES_DIR),
            "current": str(CURRENT_LINK), "canonical_articles": str(CANONICAL_ARTICLES),
            "articles_cz": str(ARTICLES_CZ_DIR), "lock": str(LOCK_PATH),
        },
        "current_release": snapshot.get("current_release"),
        "current_link": snapshot.get("current_link"),
        "topology": snapshot.get("topology"),
        "current_trust": snapshot.get("current_trust"),
        "current_tree": tree_contract(snapshot.get("current_tree", {})),
        "staging_dist": tree_contract(snapshot.get("staging_dist", {})),
        "articles": {
            name: article_contract(snapshot.get("articles", {}).get(name, {}))
            for name in ("canonical", "current", "live")
        },
        "articles_cz": snapshot.get("articles_cz"),
        "release_scripts": {
            name: {key: item.get(key) for key in ("path", "sha256", "expected_sha256", "valid")}
            for name, item in snapshot.get("release_scripts", {}).items()
        },
        "lock": {
            key: snapshot.get("lock", {}).get(key)
            for key in ("path", "nlink", "uid", "gid", "mode", "dev", "ino", "valid")
        },
    }


def receipt_bound_token(snapshot, audit_epoch):
    return sha256_bytes(canonical_json({"audit_epoch": audit_epoch, "state": state_material(snapshot)}))


def parsed_audit_epoch(*, require_fresh):
    if not FIXED_EPOCH_PATTERN.fullmatch(AUDIT_EPOCH_RAW):
        raise SyncError("invalid receipt-bound audit epoch")
    observed = int(AUDIT_EPOCH_RAW)
    now = int(time.time())
    if observed > now + 60:
        raise SyncError("receipt-bound audit epoch is in the future")
    if require_fresh and now - observed > AUDIT_TTL_SECONDS:
        raise SyncError("receipt-bound audit expired; run a new read-only audit")
    return observed


def capture_snapshot(mode):
    identity = identity_for_mode(mode)
    current_link = trusted_current_link()
    current_release = current_link.get("realpath")
    current_path = Path(current_release) if release_path(current_release) else None
    current_trust = trusted_closed_tree(current_path) if current_path else {"valid": False, "error": "current release unavailable"}
    current_tree = tree_manifest(current_path) if current_path else {"valid": False, "error": "current release unavailable"}
    staging = tree_manifest(DIST_DIR)
    articles = {
        "canonical": article_file(CANONICAL_ARTICLES, "canonical"),
        "current": article_file(current_path / "api/articles.json", "current") if current_path else {"valid": False},
        "live": live_articles(),
    }
    cz = articles_cz_manifest()
    scripts = {
        "server-release.sh": script_integrity(RELEASE_SCRIPT, RELEASE_SCRIPT_SHA256),
        "server-rollback.sh": script_integrity(ROLLBACK_SCRIPT, ROLLBACK_SCRIPT_SHA256),
    }
    topology = topology_snapshot(current_link)
    lock = lock_topology()
    blockers = []
    if not identity.get("valid"):
        blockers.append("exact operator identity is not proved")
    if not topology.get("valid"):
        blockers.append("fixed server topology or same-filesystem contract is unsafe")
    if not current_trust.get("valid"):
        blockers.append("current release is not a closed root-owned trusted tree")
    if not current_tree.get("valid") or not staging.get("valid"):
        blockers.append("current release or staging dist manifest is unsafe")
    if not article_parity(articles):
        blockers.append("canonical/current/live article raw and slug parity is not proved")
    if not cz.get("valid"):
        blockers.append("articles-cz manifest is unsafe")
    if not all(item.get("valid") for item in scripts.values()):
        blockers.append("pinned release/rollback script integrity is not proved")
    if not lock.get("valid"):
        blockers.append("existing shared release lock topology is unsafe")
    diff = manifest_diff(current_tree, staging) if current_tree.get("valid") and staging.get("valid") else {
        "exact": False, "missing_from_staging": [], "extra_in_staging": [], "changed": [],
        "missing_count": 0, "extra_count": 0, "changed_count": 0,
    }
    snapshot = {
        "schema": SCHEMA, "host": HOST, "mode": mode, "account": identity.get("login"),
        "roles": ROLES, "captured_at": utc_now(), "identity": identity,
        "current_release": current_release, "current_link": current_link,
        "topology": topology, "current_trust": current_trust,
        "current_tree": current_tree, "staging_dist": staging, "manifest_diff": diff,
        "articles": articles, "article_parity": article_parity(articles),
        "articles_cz": cz, "release_scripts": scripts, "lock": lock,
        "blockers": blockers,
    }
    audit_epoch = int(time.time()) if mode == "audit" else None
    snapshot["audit_epoch"] = audit_epoch
    snapshot["baseline_token"] = receipt_bound_token(snapshot, audit_epoch) if audit_epoch is not None else None
    snapshot["status"] = "blocked" if blockers else ("already_synced" if diff.get("exact") else "ready")
    return snapshot


def open_shared_lock():
    flags = os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(LOCK_PATH, flags)
    try:
        opened = os.fstat(fd)
        linked = os.lstat(LOCK_PATH)
        if (
            not stat.S_ISREG(opened.st_mode) or stat.S_ISLNK(linked.st_mode)
            or opened.st_nlink != 1 or opened.st_uid != 0 or opened.st_gid not in {0, 33}
            or stat.S_IMODE(opened.st_mode) != 0o600
            or (opened.st_dev, opened.st_ino) != (linked.st_dev, linked.st_ino)
            or not within(APP_ROOT, LOCK_PATH)
        ):
            raise SyncError("unsafe shared release lock")
        handle = os.fdopen(fd, "r+")
        fd = None
        return handle
    finally:
        if fd is not None:
            os.close(fd)


def token_paths(token):
    if not FIXED_TOKEN_PATTERN.fullmatch(token):
        raise SyncError("invalid baseline token")
    short = token[:16]
    state = APP_ROOT / f".staging-dist-sync-state-{short}"
    return {
        "state": state,
        "candidate": state / "candidate",
        "backup": state / "backup",
    }


def path_absent(path):
    return not path.exists() and not path.is_symlink()


def validate_state_root(paths, *, allow_absent):
    state = paths["state"]
    if path_absent(state):
        if allow_absent:
            return {"exists": False, "valid": True, "entries": []}
        raise SyncError("receipt-bound private state root is missing")
    details = os.lstat(state)
    observed = sorted(item.name for item in state.iterdir()) if stat.S_ISDIR(details.st_mode) else []
    valid = bool(
        stat.S_ISDIR(details.st_mode) and not stat.S_ISLNK(details.st_mode)
        and details.st_uid == 0 and details.st_gid in SAFE_STATE_GIDS
        and stat.S_IMODE(details.st_mode) == 0o700
        and state.parent == APP_ROOT and str(state.resolve(strict=True)) == str(state)
        and within(APP_ROOT, state)
        and set(observed).issubset({"candidate", "backup"})
    )
    if not valid:
        raise SyncError("receipt-bound private state root is unsafe or contains unknown entries")
    return {"exists": True, "valid": True, "entries": observed}


def cleanup_exact_created_empty_state(state, created):
    if created is None:
        return False
    try:
        current = os.lstat(state)
        valid = bool(
            stat.S_ISDIR(current.st_mode) and not stat.S_ISLNK(current.st_mode)
            and current.st_uid == 0 and current.st_gid in SAFE_STATE_GIDS
            and (current.st_dev, current.st_ino) == (created.st_dev, created.st_ino)
            and state.parent == APP_ROOT and str(state.resolve(strict=True)) == str(state)
            and within(APP_ROOT, state) and not any(state.iterdir())
        )
        if not valid:
            return False
        os.rmdir(state)
        return path_absent(state)
    except OSError:
        return False


def create_state_root(paths):
    state = paths["state"]
    if not path_absent(state):
        raise SyncError("receipt-bound private state root already exists")
    created = None
    try:
        app_details = os.lstat(APP_ROOT)
        if (
            not stat.S_ISDIR(app_details.st_mode) or stat.S_ISLNK(app_details.st_mode)
            or app_details.st_uid != 0 or app_details.st_gid not in SAFE_STATE_GIDS
            or str(APP_ROOT.resolve(strict=True)) != str(APP_ROOT)
        ):
            raise SyncError("application root cannot provide a safe private-state gid")
        os.mkdir(state, 0o700)
        created = os.lstat(state)
        if (
            not stat.S_ISDIR(created.st_mode) or stat.S_ISLNK(created.st_mode)
            or created.st_uid != 0 or created.st_gid not in SAFE_STATE_GIDS
            or state.parent != APP_ROOT or str(state.resolve(strict=True)) != str(state)
            or not within(APP_ROOT, state) or any(state.iterdir())
        ):
            raise SyncError("new private state root inode/path is unsafe")
        os.chown(state, 0, app_details.st_gid, follow_symlinks=False)
        os.chmod(state, 0o700, follow_symlinks=False)
        normalized = os.lstat(state)
        if (
            not stat.S_ISDIR(normalized.st_mode) or stat.S_ISLNK(normalized.st_mode)
            or (normalized.st_dev, normalized.st_ino) != (created.st_dev, created.st_ino)
            or normalized.st_uid != 0 or normalized.st_gid != app_details.st_gid
            or stat.S_IMODE(normalized.st_mode) != 0o700
            or str(state.resolve(strict=True)) != str(state) or any(state.iterdir())
        ):
            raise SyncError("new private state root normalization is not exact")
        return validate_state_root(paths, allow_absent=False)
    except Exception:
        cleanup_exact_created_empty_state(state, created)
        raise


def normalize_legacy_recovery_state_root(paths):
    state = paths["state"]
    if path_absent(state):
        return {"exists": False, "valid": True, "entries": [], "normalized_legacy": False}
    details = os.lstat(state)
    observed = sorted(item.name for item in state.iterdir()) if stat.S_ISDIR(details.st_mode) else []
    base_valid = bool(
        stat.S_ISDIR(details.st_mode) and not stat.S_ISLNK(details.st_mode)
        and details.st_uid == 0 and details.st_gid in SAFE_STATE_GIDS
        and state.parent == APP_ROOT and str(state.resolve(strict=True)) == str(state)
        and within(APP_ROOT, state) and set(observed).issubset({"candidate", "backup"})
    )
    if not base_valid:
        raise SyncError("legacy receipt-bound state root is unsafe")
    mode = stat.S_IMODE(details.st_mode)
    if mode == 0o700:
        result = validate_state_root(paths, allow_absent=False)
        result["normalized_legacy"] = False
        return result
    if mode != 0o2700:
        raise SyncError("legacy receipt-bound state root has an unsupported mode")
    os.chmod(state, 0o700, follow_symlinks=False)
    normalized = os.lstat(state)
    if (
        not stat.S_ISDIR(normalized.st_mode) or stat.S_ISLNK(normalized.st_mode)
        or (normalized.st_dev, normalized.st_ino) != (details.st_dev, details.st_ino)
        or normalized.st_uid != 0 or normalized.st_gid != details.st_gid
        or stat.S_IMODE(normalized.st_mode) != 0o700
        or str(state.resolve(strict=True)) != str(state)
        or sorted(item.name for item in state.iterdir()) != observed
    ):
        raise SyncError("legacy receipt-bound state root normalization is not exact")
    result = validate_state_root(paths, allow_absent=False)
    result["normalized_legacy"] = True
    return result


def exact_legacy_recovery_state_required(token, audit_epoch):
    expected_epoch = LEGACY_SETGID_RECOVERY_EPOCHS.get(token)
    if expected_epoch is None:
        return False
    if audit_epoch != expected_epoch:
        raise SyncError("legacy receipt-bound state root epoch mismatch")
    return True


def require_exact_baseline(snapshot, token, audit_epoch, *, require_mismatch):
    if receipt_bound_token(snapshot, audit_epoch) != token:
        raise SyncError("server state drifted from the receipt-bound baseline")
    if snapshot.get("status") == "blocked":
        raise SyncError("receipt-bound baseline is now blocked")
    if require_mismatch and snapshot.get("manifest_diff", {}).get("exact"):
        raise SyncError("staging dist is already synchronized; apply replay is forbidden")


def copy_current_to_candidate(current, candidate, expected_manifest):
    if not path_absent(candidate):
        raise SyncError("receipt-bound candidate path already exists")
    previous_umask = os.umask(0o077)
    try:
        shutil.copytree(current, candidate, symlinks=True, copy_function=shutil.copy2)
    finally:
        os.umask(previous_umask)
    trust = trusted_closed_tree(candidate)
    manifest = tree_manifest(candidate)
    if not trust.get("valid") or not exact_tree_contract(manifest, expected_manifest):
        raise SyncError("private candidate is not an exact trusted copy of current release")
    return manifest


def restore_root_metadata(path, root_info):
    expected_uid = root_info.get("uid")
    expected_gid = root_info.get("gid")
    expected_mode = root_info.get("mode")
    if expected_uid != 0 or not isinstance(expected_gid, int) or not isinstance(expected_mode, str):
        raise SyncError("baseline staging root metadata is invalid")
    os.chown(path, expected_uid, expected_gid, follow_symlinks=False)
    os.chmod(path, int(expected_mode, 8), follow_symlinks=False)


def cleanup_exact_candidate(candidate, expected_manifest):
    if path_absent(candidate):
        return
    manifest = tree_manifest(candidate)
    if not exact_tree_contract(manifest, expected_manifest):
        raise SyncError("refusing to remove an unproved candidate path")
    shutil.rmtree(candidate)


def rollback_to_baseline(paths, baseline, candidate_manifest):
    candidate = paths["candidate"]
    backup = paths["backup"]
    baseline_dist = baseline["staging_dist"]
    current_manifest = baseline["current_tree"]
    dist_exists = not path_absent(DIST_DIR)
    backup_exists = not path_absent(backup)
    if backup_exists:
        backup_manifest = tree_manifest(backup)
        if not exact_tree_contract(backup_manifest, baseline_dist):
            raise SyncError("backup drift prevents automatic rollback")
        if dist_exists:
            dist_manifest = tree_manifest(DIST_DIR)
            if not exact_tree_contract(dist_manifest, current_manifest):
                raise SyncError("unexpected dist state prevents automatic rollback")
            if not path_absent(candidate):
                raise SyncError("candidate path collision prevents automatic rollback")
            os.replace(DIST_DIR, candidate)
        restore_root_metadata(backup, baseline_dist["root_info"])
        os.replace(backup, DIST_DIR)
    if not path_absent(candidate):
        cleanup_exact_candidate(candidate, candidate_manifest or current_manifest)
    restored = tree_manifest(DIST_DIR)
    if not exact_tree_contract(restored, baseline_dist):
        raise SyncError("automatic rollback did not restore the exact baseline dist")
    validate_state_root(paths, allow_absent=True)
    if not path_absent(paths["state"]):
        if any(paths["state"].iterdir()):
            raise SyncError("private state root is not empty after rollback")
        os.rmdir(paths["state"])


def invariant_after(snapshot, baseline, *, expect_dist_current):
    if snapshot.get("status") == "blocked":
        raise SyncError("postread invariant is blocked")
    if snapshot.get("current_release") != baseline.get("current_release"):
        raise SyncError("current symlink changed during staging sync")
    if snapshot.get("current_link") != baseline.get("current_link"):
        raise SyncError("current symlink inode or attributes changed during staging sync")
    if not exact_tree_contract(snapshot.get("current_tree", {}), baseline.get("current_tree", {})):
        raise SyncError("current release tree changed during staging sync")
    if expect_dist_current and not exact_tree_contract(snapshot.get("staging_dist", {}), baseline.get("current_tree", {})):
        raise SyncError("postread staging dist is not exact current release")
    if snapshot.get("articles_cz") != baseline.get("articles_cz"):
        raise SyncError("articles-cz changed during staging sync")
    if {
        name: article_contract(snapshot.get("articles", {}).get(name, {}))
        for name in ("canonical", "current", "live")
    } != {
        name: article_contract(baseline.get("articles", {}).get(name, {}))
        for name in ("canonical", "current", "live")
    }:
        raise SyncError("canonical/current/live article parity changed during staging sync")
    if snapshot.get("release_scripts") != baseline.get("release_scripts"):
        raise SyncError("pinned release scripts changed during staging sync")
    if snapshot.get("lock") != baseline.get("lock"):
        raise SyncError("shared release lock inode or attributes changed during staging sync")


def apply_sync(token, audit_epoch):
    if not identity_for_mode("apply").get("valid"):
        raise SyncError("apply requires exact root identity")
    paths = token_paths(token)
    if not path_absent(paths["state"]):
        raise SyncError("receipt-bound state path already exists; use recover, never retry apply")
    with open_shared_lock() as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        baseline = capture_snapshot("apply")
        require_exact_baseline(baseline, token, audit_epoch, require_mismatch=True)
        current = Path(baseline["current_release"])
        candidate_manifest = None
        try:
            create_state_root(paths)
            candidate_manifest = copy_current_to_candidate(current, paths["candidate"], baseline["current_tree"])
            final_preflight = capture_snapshot("apply")
            require_exact_baseline(final_preflight, token, audit_epoch, require_mismatch=True)
            if not path_absent(paths["backup"]):
                raise SyncError("backup path appeared before atomic swap")
            app_dev = os.lstat(APP_ROOT).st_dev
            if any(os.lstat(path).st_dev != app_dev for path in (DIST_DIR, current, paths["candidate"])):
                raise SyncError("atomic replacement paths are not on one filesystem")
            old_root_info = baseline["staging_dist"]["root_info"]
            new_root_info = baseline["current_tree"]["root_info"]
            os.replace(DIST_DIR, paths["backup"])
            backup_manifest = tree_manifest(paths["backup"])
            if not exact_tree_contract(backup_manifest, baseline["staging_dist"]):
                raise SyncError("private backup is not the exact former staging dist")
            os.chown(paths["candidate"], new_root_info["uid"], new_root_info["gid"], follow_symlinks=False)
            os.chmod(paths["candidate"], int(new_root_info["mode"], 8), follow_symlinks=False)
            os.replace(paths["candidate"], DIST_DIR)
            post = capture_snapshot("apply")
            invariant_after(post, baseline, expect_dist_current=True)
            retained_backup = tree_manifest(paths["backup"])
            if not exact_tree_contract(retained_backup, baseline["staging_dist"]):
                raise SyncError("retained private backup drifted after swap")
            backup_info = safe_mutable_root(paths["backup"])
            state_info = validate_state_root(paths, allow_absent=False)
            if backup_info.get("uid") != 0 or state_info.get("entries") != ["backup"]:
                raise SyncError("retained backup is not exact private root-owned state")
            return {
                "schema": SCHEMA, "status": "synced_verified", "mode": "apply",
                "completed_at": utc_now(), "account": APPLY_LOGIN, "roles": ROLES,
                "baseline_token": token, "current_release": baseline["current_release"],
                "before": {
                    "staging_digest": baseline["staging_dist"]["digest"],
                    "current_digest": baseline["current_tree"]["digest"],
                    "manifest_diff": baseline["manifest_diff"],
                },
                "after": {
                    "staging_digest": post["staging_dist"]["digest"],
                    "current_digest": post["current_tree"]["digest"],
                    "exact": exact_tree_contract(post["staging_dist"], post["current_tree"]),
                    "article_parity": post["article_parity"], "articles_cz_digest": post["articles_cz"]["digest"],
                },
                "backup": {
                    "path": str(paths["backup"]), "private_parent": str(paths["state"]),
                    "private_parent_mode": oct(0o700),
                    "digest": retained_backup["digest"], "original_root": old_root_info,
                },
                "current_symlink_unchanged": post["current_link"] == baseline["current_link"],
                "release_tree_unchanged": exact_tree_contract(post["current_tree"], baseline["current_tree"]),
                "shared_lock_unchanged": post["lock"] == baseline["lock"],
            }
        except Exception as exc:
            rollback_error = None
            try:
                rollback_to_baseline(paths, baseline, candidate_manifest or baseline["current_tree"])
                restored = capture_snapshot("apply")
                invariant_after(restored, baseline, expect_dist_current=False)
                if not exact_tree_contract(restored["staging_dist"], baseline["staging_dist"]):
                    raise SyncError("rollback verification differs from baseline")
            except Exception as rollback_exc:
                rollback_error = rollback_exc
            if rollback_error is not None:
                raise SyncError(
                    "apply failed and rollback is unproved; use receipt-bound recover: "
                    f"{type(rollback_error).__name__}: {rollback_error}"
                ) from exc
            raise SyncError(f"apply failed after exact automatic rollback: {type(exc).__name__}: {exc}") from exc


def recovery_classification(baseline, dist_manifest, backup_manifest, candidate_manifest):
    old = baseline.get("staging_dist", {})
    current = baseline.get("current_tree", {})
    dist_old = bool(dist_manifest and exact_tree_contract(dist_manifest, old))
    dist_current = bool(dist_manifest and exact_tree_contract(dist_manifest, current))
    backup_old = bool(backup_manifest and exact_tree_contract(backup_manifest, old))
    candidate_current = bool(candidate_manifest and exact_tree_contract(candidate_manifest, current))
    if dist_current and backup_old and candidate_manifest is None:
        return "synced_with_backup"
    if dist_old and backup_manifest is None and candidate_manifest is None:
        return "baseline_restored"
    if dist_old and backup_manifest is None and candidate_current:
        return "baseline_with_candidate"
    if dist_manifest is None and backup_old and (candidate_manifest is None or candidate_current):
        return "dist_missing_recoverable"
    return "unknown"


def optional_manifest(path):
    if path_absent(path):
        return None
    return tree_manifest(path)


def reconstructed_baseline_material(observed, candidate_old):
    material = state_material(observed)
    material["staging_dist"] = tree_contract(candidate_old)
    baseline_topology = json.loads(json.dumps(material["topology"]))
    old_root = dict(candidate_old.get("root_info", {}))
    old_root["path"] = str(DIST_DIR)
    old_root["realpath"] = str(DIST_DIR)
    baseline_topology["roots"]["dist"] = old_root
    baseline_topology["devices"]["dist"] = old_root.get("dev")
    baseline_topology["same_filesystem"] = bool(
        len(baseline_topology["devices"]) == 3
        and len(set(baseline_topology["devices"].values())) == 1
        and None not in baseline_topology["devices"].values()
    )
    baseline_topology["valid"] = bool(
        all(item.get("valid") for item in baseline_topology["roots"].values())
        and baseline_topology.get("current_link", {}).get("valid")
        and baseline_topology["same_filesystem"]
    )
    material["topology"] = baseline_topology
    return material


def recover_sync(token, audit_epoch):
    if not identity_for_mode("recover").get("valid"):
        raise SyncError("recover requires exact root identity")
    paths = token_paths(token)
    legacy_state_required = exact_legacy_recovery_state_required(token, audit_epoch)
    with open_shared_lock() as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        state_root = normalize_legacy_recovery_state_root(paths)
        if legacy_state_required and not state_root["exists"]:
            raise SyncError("exact legacy receipt-bound state root is absent")
        # The current release, canonical articles, live articles, articles-cz,
        # scripts and symlink must still equal the receipt-bound material.  Dist
        # and the deterministic recovery paths are classified separately.
        observed = capture_snapshot("recover")
        # Recovery receives only the token, so rebuild the baseline material by
        # substituting each known dist candidate and accept only an exact token.
        dist_manifest = optional_manifest(DIST_DIR)
        backup_manifest = optional_manifest(paths["backup"])
        candidate_manifest = optional_manifest(paths["candidate"])
        possible_baseline = None
        for candidate_old in (dist_manifest, backup_manifest):
            if candidate_old is None:
                continue
            material = reconstructed_baseline_material(observed, candidate_old)
            if sha256_bytes(canonical_json({"audit_epoch": audit_epoch, "state": material})) == token:
                possible_baseline = dict(observed)
                possible_baseline["staging_dist"] = candidate_old
                possible_baseline["baseline_token"] = token
                possible_baseline["manifest_diff"] = manifest_diff(observed["current_tree"], candidate_old)
                break
        if possible_baseline is None:
            raise SyncError("unknown drift: no observed dist/backup matches the receipt-bound baseline")
        baseline = possible_baseline
        state = recovery_classification(baseline, dist_manifest, backup_manifest, candidate_manifest)
        if state == "unknown":
            raise SyncError("unknown receipt-bound recovery state; no mutation performed")
        if state == "synced_with_backup":
            invariant_after(observed, baseline, expect_dist_current=True)
            return {
                "schema": SCHEMA, "status": "recovered_verified_success", "mode": "recover",
                "completed_at": utc_now(), "account": APPLY_LOGIN, "roles": ROLES,
                "baseline_token": token, "classification": state,
                "backup": str(paths["backup"]),
                "mutation_performed": state_root["normalized_legacy"],
                "legacy_state_root_normalized": state_root["normalized_legacy"],
                "postread": {
                    "current_release": observed["current_release"],
                    "current_digest": observed["current_tree"]["digest"],
                    "staging_digest": observed["staging_dist"]["digest"],
                    "exact": exact_tree_contract(observed["current_tree"], observed["staging_dist"]),
                    "article_parity": observed["article_parity"],
                    "articles_cz_digest": observed["articles_cz"]["digest"],
                    "shared_lock_unchanged": observed["lock"] == baseline["lock"],
                },
            }
        if state == "baseline_with_candidate":
            cleanup_exact_candidate(paths["candidate"], baseline["current_tree"])
        elif state == "dist_missing_recoverable":
            if backup_manifest is None:
                raise SyncError("recoverable classification lost its exact backup")
            restore_root_metadata(paths["backup"], baseline["staging_dist"]["root_info"])
            os.replace(paths["backup"], DIST_DIR)
            if candidate_manifest is not None:
                cleanup_exact_candidate(paths["candidate"], baseline["current_tree"])
        validate_state_root(paths, allow_absent=True)
        if not path_absent(paths["state"]):
            if any(paths["state"].iterdir()):
                raise SyncError("private state root contains unexpected recovery residue")
            os.rmdir(paths["state"])
        post = capture_snapshot("recover")
        invariant_after(post, baseline, expect_dist_current=False)
        if not exact_tree_contract(post["staging_dist"], baseline["staging_dist"]):
            raise SyncError("recovery did not restore the exact receipt baseline")
        return {
            "schema": SCHEMA, "status": "recovered_verified_baseline", "mode": "recover",
            "completed_at": utc_now(), "account": APPLY_LOGIN, "roles": ROLES,
            "baseline_token": token, "classification": state,
            "mutation_performed": state != "baseline_restored" or state_root["exists"],
            "legacy_state_root_normalized": state_root["normalized_legacy"],
            "postread": {
                "current_release": post["current_release"],
                "current_digest": post["current_tree"]["digest"],
                "staging_digest": post["staging_dist"]["digest"],
                "baseline_restored": exact_tree_contract(post["staging_dist"], baseline["staging_dist"]),
                "article_parity": post["article_parity"],
                "articles_cz_digest": post["articles_cz"]["digest"],
                "shared_lock_unchanged": post["lock"] == baseline["lock"],
            },
        }


def emit(payload, exit_code=0):
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True))
    raise SystemExit(exit_code)


def main():
    try:
        if MODE == "audit":
            if BASELINE_TOKEN or AUDIT_EPOCH_RAW:
                raise SyncError("audit does not accept receipt-bound arguments")
            payload = capture_snapshot("audit")
            emit(payload, 0 if payload["status"] in {"ready", "already_synced"} else 2)
        if MODE == "apply":
            emit(apply_sync(BASELINE_TOKEN, parsed_audit_epoch(require_fresh=True)))
        if MODE == "recover":
            emit(recover_sync(BASELINE_TOKEN, parsed_audit_epoch(require_fresh=False)))
        raise SyncError("unsupported fixed mode")
    except BlockingIOError:
        emit({
            "schema": SCHEMA, "status": "blocked", "mode": MODE,
            "error": "shared release lock is busy", "baseline_token": BASELINE_TOKEN or None,
        }, 2)
    except Exception as exc:
        emit({
            "schema": SCHEMA, "status": "error", "mode": MODE,
            "error_type": type(exc).__name__, "error": str(exc),
            "baseline_token": BASELINE_TOKEN or None,
        }, 1)


if __name__ == "__main__":
    main()
PY
