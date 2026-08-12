#!/usr/bin/env bash
set -euo pipefail

# Fixed split-role production operator for one approved catalog-price release.
# Deploy may only audit. Root may only preflight/apply/rollback. The operator
# never builds from, uploads to, or edits the mutable server source tree.

MODE="${1:-audit}"
BUNDLE_DIR="${2:-}"

case "$MODE" in
  audit|root-audit) ;;
  apply|rollback)
    [[ "$BUNDLE_DIR" =~ ^/tmp/rosomaha-main-price-release-10d9dc6-[0-9a-f]{16}$ ]] || {
      echo '{"status":"error","error":"invalid fixed bundle path"}'
      exit 2
    }
    ;;
  *)
    echo '{"status":"error","error":"unsupported fixed operator mode"}'
    exit 2
    ;;
esac

PYTHONDONTWRITEBYTECODE=1 exec python3 - "$MODE" "$BUNDLE_DIR" <<'PY'
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import pwd
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath


MODE = sys.argv[1]
BUNDLE_DIR = Path(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2] else None

SCHEMA = "rosomaha-main-price-release/v3"
HOST = "90.156.168.115"
AUDIT_LOGIN = "deploy"
APPLY_LOGIN = "root"
ROLES = {"audit": AUDIT_LOGIN, "apply": APPLY_LOGIN}
TARGET_COMMIT = "10d9dc666bccbe9fb250ab29a69ae09710537e77"
RELEASE_LABEL = "prices-10d9dc6"
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
RELEASE_SCRIPT_SHA256 = "c25fc273a4cf88a27879207aaebf18be62f4487867a7de7674c611b400919edd"
ROLLBACK_SCRIPT_SHA256 = "aeee52f314036112501a7acc0af5fa09ee7c081327fb867b91c64b983bd41acc"
FIXED_COMMANDS = ("python3", "rsync", "bash", "date", "git", "mkdir", "ln", "readlink", "find", "sort")
ARTICLES_CZ_ALLOWLIST = (
    "avgustovskiy-marshrut-na-rosomahe-chek-list-osmotra-pered-vyezdom.ts",
    "bolotohod-ili-smert-pochemu-aprel-ubivaet-tehniku-silnee-chem-yanvar.ts",
    "chto-esli-vash-bolotohod-zastryal-nochyu-v-glushi-realnaya-istoriya-spaseniya-i-vyvody.ts",
    "dve-nedeli-na-kolesah-dnevnik-motoputeshestviya-po-yuzhnomu-uralu-vesnoy.ts",
    "esli-rosomaha-zaglohla-v-vode-bezopasnyy-poryadok-deystviy-na-marshrute.ts",
    "gryazevoy-turizm-2026-gayd-po-luchshim-marshrutam-tsentralnoy-rossii-i-ne-tolko-dlya-kvadrotsiklov-i-bolotohodov.ts",
    "index.ts",
    "kak-podderzhat-ohlazhdenie-rosomahi-v-letnyuyu-zharu-prakticheskiy-poryadok.ts",
    "marshrut-na-bolotohode-v-zharu-chek-list-spokoynoy-poezdki-na-rosomahe.ts",
    "maslo-filtry-rezina-chto-realno-nuzhno-menyat-kazhduyu-vesnu-a-chto-marketing.ts",
    "posle-silnogo-dozhdya-kogda-menyat-marshrut-na-rosomahe.ts",
    "rosomaha-zastryala-v-bolote-spokoynyy-poryadok-deystviy-bez-lishney-suety.ts",
    "top-5-neochevidnyh-problem-s-kotorymi-stalkivayutsya-vladeltsy-kvadrotsiklov-vesnoy-i-kak-ih-izbezhat.ts",
    "vesenniy-tyuning-7-byudzhetnyh-apgreydov-kotorye-preobrazyat-vash-kvadrotsikl-k-letu.ts",
)
BUNDLE_FILES = (
    "baseline.json",
    "candidate.tar.gz",
    "candidate-manifest.json",
    "operator.sh",
)
MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
MAX_EXPANDED_BYTES = 1024 * 1024 * 1024
MAX_CANDIDATE_FILES = 20_000


class ReleaseError(RuntimeError):
    pass


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def sha256_bytes(raw):
    return hashlib.sha256(raw).hexdigest()


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def resolved(path):
    try:
        return str(path.resolve(strict=True))
    except OSError:
        return None


def within(root, path):
    try:
        return os.path.commonpath((str(root.resolve(strict=True)), str(path.resolve(strict=True)))) == str(root.resolve(strict=True))
    except (OSError, ValueError):
        return False


def safe_directory(path, *, root, optional=False, readable=True, writable=False):
    try:
        details = os.lstat(path)
    except FileNotFoundError:
        return {"path": str(path), "exists": False, "valid": optional}
    except OSError as exc:
        return {"path": str(path), "exists": False, "valid": False, "error": f"{type(exc).__name__}: {exc}"}
    realpath = resolved(path)
    valid = bool(
        stat.S_ISDIR(details.st_mode)
        and not stat.S_ISLNK(details.st_mode)
        and realpath is not None
        and within(root, path)
        and (not readable or os.access(path, os.R_OK | os.X_OK))
        and (not writable or os.access(path, os.W_OK | os.X_OK))
    )
    return {
        "path": str(path), "exists": True, "realpath": realpath,
        "directory": stat.S_ISDIR(details.st_mode), "symlink": stat.S_ISLNK(details.st_mode),
        "uid": details.st_uid, "gid": details.st_gid, "mode": oct(stat.S_IMODE(details.st_mode)),
        "readable": os.access(path, os.R_OK | os.X_OK),
        "writable": os.access(path, os.W_OK | os.X_OK), "valid": valid,
    }


def safe_file(path, *, root, readable=True, writable=False):
    try:
        details = os.lstat(path)
    except OSError as exc:
        return {"path": str(path), "exists": False, "valid": False, "error": f"{type(exc).__name__}: {exc}"}
    realpath = resolved(path)
    valid = bool(
        stat.S_ISREG(details.st_mode)
        and not stat.S_ISLNK(details.st_mode)
        and details.st_nlink == 1
        and realpath is not None
        and within(root, path)
        and (not readable or os.access(path, os.R_OK))
        and (not writable or os.access(path, os.W_OK))
    )
    return {
        "path": str(path), "exists": True, "realpath": realpath,
        "regular": stat.S_ISREG(details.st_mode), "symlink": stat.S_ISLNK(details.st_mode),
        "nlink": details.st_nlink, "uid": details.st_uid, "gid": details.st_gid,
        "mode": oct(stat.S_IMODE(details.st_mode)), "sha256": sha256_file(path) if valid else None,
        "readable": os.access(path, os.R_OK), "writable": os.access(path, os.W_OK),
        "executable": os.access(path, os.X_OK), "valid": valid,
    }


def tree_manifest(root):
    root_info = safe_directory(root, root=APP_ROOT)
    if not root_info["valid"]:
        return {"root": str(root), "valid": False, "error": "unsafe tree root"}
    files = []
    directories = 0
    for current, dir_names, file_names in os.walk(root, followlinks=False):
        current_path = Path(current)
        for name in sorted(dir_names):
            item = current_path / name
            details = os.lstat(item)
            if not stat.S_ISDIR(details.st_mode) or stat.S_ISLNK(details.st_mode) or not within(root, item):
                return {"root": str(root), "valid": False, "error": f"unsafe directory: {item}"}
            directories += 1
        for name in sorted(file_names):
            item = current_path / name
            details = os.lstat(item)
            if not stat.S_ISREG(details.st_mode) or stat.S_ISLNK(details.st_mode) or details.st_nlink != 1 or not within(root, item):
                return {"root": str(root), "valid": False, "error": f"unsafe file: {item}"}
            relative = item.relative_to(root).as_posix()
            files.append({"path": relative, "bytes": details.st_size, "sha256": sha256_file(item)})
            if len(files) > MAX_CANDIDATE_FILES:
                return {"root": str(root), "valid": False, "error": "tree file-count limit exceeded"}
    digest = sha256_bytes(canonical_json(files))
    return {"root": str(root), "valid": True, "files": files, "file_count": len(files), "directory_count": directories, "digest": digest}


def article_info(raw, source):
    info = {"source": source, "sha256": sha256_bytes(raw), "bytes": len(raw), "valid": False}
    try:
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
        info.update({
            "count": len(slugs), "unique_count": len(unique), "duplicates": duplicates,
            "slug_digest": sha256_bytes(("\n".join(unique) + "\n").encode("utf-8")),
            "valid": not duplicates,
        })
    except Exception as exc:
        info["error"] = f"{type(exc).__name__}: {exc}"
    return info


def article_file(path, source):
    try:
        file_state = safe_file(path, root=APP_ROOT)
        if not file_state["valid"]:
            raise ReleaseError("unsafe article export path")
        return article_info(path.read_bytes(), source)
    except Exception as exc:
        return {"source": source, "valid": False, "error": f"{type(exc).__name__}: {exc}"}


def articles_cz_manifest():
    directory = safe_directory(ARTICLES_CZ_DIR, root=APP_ROOT)
    if not directory["valid"]:
        return {"valid": False, "error": "unsafe articles-cz directory"}
    try:
        observed = sorted(item.name for item in ARTICLES_CZ_DIR.iterdir())
        if observed != sorted(ARTICLES_CZ_ALLOWLIST):
            return {"valid": False, "error": "articles-cz allowlist mismatch", "observed": observed}
        entries = []
        for name in ARTICLES_CZ_ALLOWLIST:
            path = ARTICLES_CZ_DIR / name
            info = safe_file(path, root=APP_ROOT)
            if not info["valid"]:
                return {"valid": False, "error": f"unsafe articles-cz file: {name}"}
            entries.append({"name": name, "bytes": os.lstat(path).st_size, "sha256": info["sha256"]})
        return {"valid": True, "count": len(entries), "files": entries, "digest": sha256_bytes(canonical_json(entries))}
    except Exception as exc:
        return {"valid": False, "error": f"{type(exc).__name__}: {exc}"}


def live_articles():
    request = urllib.request.Request(PUBLIC_ARTICLES_URL, headers={"User-Agent": "RosomahaFixedPriceRelease/2.0", "Accept": "application/json"})
    last_error = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=25) as response:
                raw = response.read(25 * 1024 * 1024 + 1)
                if len(raw) > 25 * 1024 * 1024:
                    raise ReleaseError("public article export is too large")
                info = article_info(raw, "live")
                info.update({"http_status": int(response.status), "final_url": response.geturl(), "attempts": attempt + 1})
                if response.status != 200 or response.geturl() != PUBLIC_ARTICLES_URL:
                    info["valid"] = False
                return info
        except Exception as exc:
            last_error = exc
            if attempt < 2:
                time.sleep((1, 3)[attempt])
    return {"source": "live", "valid": False, "error": f"{type(last_error).__name__}: {last_error}"}


def release_path(value):
    if not value:
        return False
    try:
        path = Path(value)
        details = os.lstat(path)
        return bool(stat.S_ISDIR(details.st_mode) and not stat.S_ISLNK(details.st_mode) and within(RELEASES_DIR, path) and path != RELEASES_DIR)
    except OSError:
        return False


def rollback_target(current):
    try:
        candidates = []
        for item in RELEASES_DIR.iterdir():
            details = os.lstat(item)
            if stat.S_ISDIR(details.st_mode) and not stat.S_ISLNK(details.st_mode) and within(RELEASES_DIR, item):
                candidates.append(str(item.resolve(strict=True)))
        return next((item for item in sorted(candidates, reverse=True) if item != current), None)
    except OSError:
        return None


def topology():
    """Actor-neutral read topology used by both audit roles."""
    dirs = {
        "app_root": safe_directory(APP_ROOT, root=APP_ROOT),
        "src": safe_directory(APP_ROOT / "src", root=APP_ROOT),
        "src_data": safe_directory(APP_ROOT / "src/data", root=APP_ROOT),
        "public": safe_directory(APP_ROOT / "public", root=APP_ROOT),
        "public_api": safe_directory(APP_ROOT / "public/api", root=APP_ROOT),
        "articles_cz": safe_directory(ARTICLES_CZ_DIR, root=APP_ROOT),
        "scripts": safe_directory(APP_ROOT / "scripts", root=APP_ROOT),
        "releases": safe_directory(RELEASES_DIR, root=APP_ROOT),
        "dist": safe_directory(DIST_DIR, root=APP_ROOT),
    }
    files = {
        "canonical_articles": safe_file(CANONICAL_ARTICLES, root=APP_ROOT),
        "server_release": safe_file(RELEASE_SCRIPT, root=APP_ROOT),
        "server_rollback": safe_file(ROLLBACK_SCRIPT, root=APP_ROOT),
    }
    try:
        current_lstat = os.lstat(CURRENT_LINK)
        current_target = resolved(CURRENT_LINK)
        current_link = {
            "path": str(CURRENT_LINK), "symlink": stat.S_ISLNK(current_lstat.st_mode),
            "realpath": current_target, "valid": bool(
                stat.S_ISLNK(current_lstat.st_mode) and current_target is not None
                and release_path(current_target) and CURRENT_LINK.parent.resolve(strict=True) == APP_ROOT.resolve(strict=True)
            ),
        }
    except OSError as exc:
        current_link = {"path": str(CURRENT_LINK), "valid": False, "error": f"{type(exc).__name__}: {exc}"}
    try:
        tmp = Path("/tmp")
        details = os.lstat(tmp)
        tmp_info = {
            "path": "/tmp", "realpath": resolved(tmp),
            "directory": stat.S_ISDIR(details.st_mode), "symlink": stat.S_ISLNK(details.st_mode),
            "sticky": bool(details.st_mode & stat.S_ISVTX),
            "readable": os.access(tmp, os.R_OK | os.X_OK),
            "writable": os.access(tmp, os.W_OK | os.X_OK),
        }
        tmp_info["valid"] = bool(
            tmp_info["directory"] and not tmp_info["symlink"]
            and tmp_info["realpath"] == "/tmp" and tmp_info["sticky"]
            and tmp_info["readable"]
        )
    except OSError as exc:
        tmp_info = {"path": "/tmp", "valid": False, "error": f"{type(exc).__name__}: {exc}"}
    valid = all(item["valid"] for item in dirs.values()) and all(item["valid"] for item in files.values()) and current_link["valid"] and tmp_info["valid"]
    return {"directories": dirs, "files": files, "current_link": current_link, "temporary": tmp_info, "valid": valid}


def identity_for_mode(mode):
    uid = os.getuid()
    login = pwd.getpwuid(uid).pw_name
    euid = os.geteuid()
    if mode == "audit":
        valid = login == AUDIT_LOGIN and uid != 0 and euid == uid
        role = "read-only-audit"
    elif mode in {"root-audit", "apply", "rollback"}:
        valid = login == APPLY_LOGIN and uid == 0 and euid == 0
        role = "root-release-preflight" if mode == "root-audit" else "root-release-operator"
    else:
        valid = False
        role = "invalid"
    return {"login": login, "uid": uid, "euid": euid, "role": role, "valid": valid}


def lock_readiness():
    """Inspect lock safety/availability without creating or modifying it."""
    try:
        details = os.lstat(LOCK_PATH)
    except FileNotFoundError:
        parent = safe_directory(APP_ROOT, root=APP_ROOT, writable=True)
        return {
            "path": str(LOCK_PATH), "exists": False, "create_ready": parent.get("valid", False),
            "available": parent.get("valid", False), "valid": parent.get("valid", False),
        }
    except OSError as exc:
        return {"path": str(LOCK_PATH), "exists": False, "valid": False, "error": f"{type(exc).__name__}: {exc}"}
    valid = bool(
        stat.S_ISREG(details.st_mode) and not stat.S_ISLNK(details.st_mode)
        and details.st_nlink == 1 and details.st_uid == 0
        and stat.S_IMODE(details.st_mode) == 0o600 and within(APP_ROOT, LOCK_PATH)
    )
    available = False
    if valid:
        fd = os.open(LOCK_PATH, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        try:
            opened = os.fstat(fd)
            valid = valid and (opened.st_dev, opened.st_ino) == (details.st_dev, details.st_ino)
            if valid:
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    available = True
                except BlockingIOError:
                    available = False
                finally:
                    if available:
                        fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)
    return {
        "path": str(LOCK_PATH), "exists": True, "regular": stat.S_ISREG(details.st_mode),
        "symlink": stat.S_ISLNK(details.st_mode), "nlink": details.st_nlink,
        "uid": details.st_uid, "gid": details.st_gid, "mode": oct(stat.S_IMODE(details.st_mode)),
        "available": available, "valid": bool(valid and available),
    }


def root_apply_readiness(topo, command_paths, lock_already_held=False):
    writable_directories = {
        name: safe_directory(path, root=APP_ROOT, writable=True)
        for name, path in {
            "app_root": APP_ROOT, "releases": RELEASES_DIR, "dist": DIST_DIR,
        }.items()
    }
    scripts = {
        "server_release": safe_file(RELEASE_SCRIPT, root=APP_ROOT),
        "server_rollback": safe_file(ROLLBACK_SCRIPT, root=APP_ROOT),
    }
    tmp = topo["temporary"]
    if lock_already_held:
        lock = safe_file(LOCK_PATH, root=APP_ROOT)
        lock["valid"] = bool(
            lock.get("valid") and lock.get("uid") == 0 and lock.get("mode") == oct(0o600)
        )
        lock["available"] = lock["valid"]
        lock["held_by_operator"] = True
    else:
        lock = lock_readiness()
    valid = bool(
        all(item.get("valid") for item in writable_directories.values())
        and tmp.get("valid") and tmp.get("writable")
        and all(item.get("valid") and item.get("executable") for item in scripts.values())
        and lock.get("valid") and all(command_paths.values())
    )
    return {
        "valid": valid, "writable_directories": writable_directories,
        "temporary_writable": bool(tmp.get("writable")), "scripts": scripts,
        "lock": lock, "commands_available": all(command_paths.values()),
    }


def audit_state(mode, lock_already_held=False):
    identity = identity_for_mode(mode)
    login = pwd.getpwuid(os.getuid()).pw_name
    current = resolved(CURRENT_LINK)
    rollback = rollback_target(current)
    topo = topology()
    canonical = article_file(CANONICAL_ARTICLES, "canonical")
    active = article_file(Path(current) / "api/articles.json", "current") if current else {"source": "current", "valid": False}
    live = live_articles()
    articles = {"canonical": canonical, "current": active, "live": live}
    cz_manifest = articles_cz_manifest()
    article_parity = bool(all(item.get("valid") for item in articles.values()) and len({item.get("sha256") for item in articles.values()}) == 1 and len({item.get("slug_digest") for item in articles.values()}) == 1)
    release_sha = sha256_file(RELEASE_SCRIPT) if topo["files"]["server_release"]["valid"] else None
    rollback_sha = sha256_file(ROLLBACK_SCRIPT) if topo["files"]["server_rollback"]["valid"] else None
    scripts = {"server-release.sh": release_sha, "server-rollback.sh": rollback_sha}
    staging = tree_manifest(DIST_DIR)
    current_tree = tree_manifest(Path(current)) if current else {"valid": False, "error": "current release missing"}
    command_paths = {name: shutil.which(name) for name in FIXED_COMMANDS}
    try:
        existing_label_releases = sorted(
            str(item.resolve(strict=True)) for item in RELEASES_DIR.iterdir()
            if item.name.endswith(f"-{RELEASE_LABEL}") and release_path(str(item))
        )
    except OSError:
        existing_label_releases = ["unreadable"]
    blockers = []
    if not identity["valid"]:
        blockers.append("exact operator role identity is not proved")
    if not topo["valid"]:
        blockers.append("unsafe server path topology")
    if not release_path(current) or not release_path(rollback):
        blockers.append("current or rollback release is unavailable")
    if not article_parity:
        blockers.append("canonical/current/live article raw parity is not proved")
    if not cz_manifest.get("valid"):
        blockers.append("canonical articles-cz manifest is unsafe")
    if release_sha != RELEASE_SCRIPT_SHA256 or rollback_sha != ROLLBACK_SCRIPT_SHA256:
        blockers.append("release script integrity mismatch")
    if not staging.get("valid"):
        blockers.append("staging dist topology is unsafe")
    if not current_tree.get("valid"):
        blockers.append("current release tree topology is unsafe")
    if existing_label_releases:
        blockers.append("the exact release label already exists; replay is forbidden")
    root_readiness = root_apply_readiness(topo, command_paths, lock_already_held) if mode == "root-audit" else None
    if mode == "root-audit" and not root_readiness.get("valid"):
        blockers.append("root apply readiness is not proved")
    result = {
        "schema": SCHEMA, "mode": mode, "captured_at": utc_now(), "host": HOST,
        "account": login, "identity": identity, "roles": ROLES,
        "app_root": str(APP_ROOT), "current_release": current,
        "rollback_release": rollback, "articles": articles, "articles_cz": cz_manifest, "article_parity": article_parity,
        "release_scripts": scripts, "topology": topo, "staging_dist": staging, "current_tree": current_tree,
        "target_commit": TARGET_COMMIT, "commands": command_paths,
        "root_readiness": root_readiness,
        "existing_label_releases": existing_label_releases,
        "blockers": blockers, "status": "ok" if not blockers else "blocked",
    }
    result["server_baseline_token"] = sha256_bytes(canonical_json(server_baseline_material(result)))
    return result


def stable_topology_material(topo):
    directory_keys = ("path", "exists", "realpath", "directory", "symlink", "uid", "gid", "mode", "valid")
    file_keys = ("path", "exists", "realpath", "regular", "symlink", "nlink", "uid", "gid", "mode", "sha256", "valid")
    link_keys = ("path", "realpath", "symlink", "valid")
    temporary_keys = ("path", "realpath", "directory", "symlink", "sticky", "valid")
    return {
        "directories": {
            name: {key: item.get(key) for key in directory_keys}
            for name, item in topo["directories"].items()
        },
        "files": {
            name: {key: item.get(key) for key in file_keys}
            for name, item in topo["files"].items()
        },
        "current_link": {key: topo["current_link"].get(key) for key in link_keys},
        "temporary": {key: topo["temporary"].get(key) for key in temporary_keys},
        "valid": topo.get("valid"),
    }


def server_baseline_material(value):
    article_keys = ("sha256", "bytes", "count", "unique_count", "duplicates", "slug_digest", "valid")
    articles = {
        name: {key: value["articles"][name].get(key) for key in article_keys}
        for name in ("canonical", "current", "live")
    }
    tree_keys = ("valid", "file_count", "directory_count", "digest")
    return {
        "schema": value["schema"], "host": value["host"], "roles": value["roles"],
        "app_root": value["app_root"], "current_release": value["current_release"],
        "rollback_release": value["rollback_release"], "articles": articles,
        "release_scripts": value["release_scripts"],
        "topology": stable_topology_material(value["topology"]),
        "articles_cz": value["articles_cz"],
        "staging_dist": {key: value["staging_dist"].get(key) for key in tree_keys},
        "current_tree": {key: value["current_tree"].get(key) for key in tree_keys},
        "target_commit": value["target_commit"],
        "existing_label_releases": value["existing_label_releases"],
    }


def full_baseline_token(value):
    return sha256_bytes(canonical_json({key: item for key, item in value.items() if key != "baseline_token"}))


def open_lock(*, create):
    flags = os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(LOCK_PATH, flags)
    except FileNotFoundError:
        if not create:
            raise ReleaseError("release lock is missing")
        fd = os.open(LOCK_PATH, flags | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        opened = os.fstat(fd)
        linked = os.lstat(LOCK_PATH)
        if (
            not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1 or opened.st_uid != os.getuid()
            or stat.S_IMODE(opened.st_mode) != 0o600 or stat.S_ISLNK(linked.st_mode)
            or (opened.st_dev, opened.st_ino) != (linked.st_dev, linked.st_ino)
            or not within(APP_ROOT, LOCK_PATH)
        ):
            raise ReleaseError("unsafe release lock")
        return os.fdopen(fd, "r+")
    except Exception:
        os.close(fd)
        raise


def validate_bundle(bundle):
    match = re.fullmatch(r"/tmp/rosomaha-main-price-release-10d9dc6-([0-9a-f]{16})", str(bundle))
    if not match:
        raise ReleaseError("invalid bundle path")
    details = os.lstat(bundle)
    if not stat.S_ISDIR(details.st_mode) or stat.S_ISLNK(details.st_mode) or str(bundle.resolve(strict=True)) != str(bundle) or details.st_uid != os.getuid() or stat.S_IMODE(details.st_mode) != 0o700:
        raise ReleaseError("unsafe bundle directory")
    for name in BUNDLE_FILES:
        path = bundle / name
        item = os.lstat(path)
        if (
            not stat.S_ISREG(item.st_mode) or stat.S_ISLNK(item.st_mode)
            or item.st_nlink != 1 or item.st_uid != 0
            or stat.S_IMODE(item.st_mode) & 0o022
            or path.resolve(strict=True).parent != bundle
        ):
            raise ReleaseError(f"unsafe bundle file: {name}")
    baseline = json.loads((bundle / "baseline.json").read_text(encoding="utf-8"))
    if (
        baseline.get("schema") != SCHEMA or baseline.get("host") != HOST
        or baseline.get("account") != AUDIT_LOGIN or baseline.get("roles") != ROLES
        or baseline.get("target_commit") != TARGET_COMMIT
    ):
        raise ReleaseError("bundle baseline identity mismatch")
    if baseline.get("baseline_token", "")[:16] != match.group(1):
        raise ReleaseError("bundle path/token mismatch")
    if not re.fullmatch(r"[0-9a-f]{64}", baseline.get("baseline_token", "")) or baseline["baseline_token"] != full_baseline_token(baseline):
        raise ReleaseError("full bundle baseline token mismatch")
    if sha256_file(bundle / "operator.sh") != baseline.get("operator_sha256"):
        raise ReleaseError("bundle operator mismatch")
    archive = bundle / "candidate.tar.gz"
    if archive.stat().st_size > MAX_ARCHIVE_BYTES or sha256_file(archive) != baseline.get("candidate", {}).get("archive_sha256"):
        raise ReleaseError("candidate archive mismatch")
    manifest_raw = (bundle / "candidate-manifest.json").read_bytes()
    if sha256_bytes(manifest_raw) != baseline.get("candidate", {}).get("manifest_sha256"):
        raise ReleaseError("candidate manifest mismatch")
    manifest = json.loads(manifest_raw.decode("utf-8"))
    if manifest.get("digest") != baseline.get("candidate", {}).get("tree_digest"):
        raise ReleaseError("candidate tree digest mismatch")
    return baseline


def verify_fresh_baseline(baseline):
    if baseline.get("server_baseline_token") != sha256_bytes(canonical_json(server_baseline_material(baseline))):
        raise ReleaseError("stored server baseline token is invalid")
    fresh = audit_state("root-audit", lock_already_held=True)
    if fresh["status"] != "ok":
        raise ReleaseError("fresh server audit is blocked")
    if fresh["server_baseline_token"] != baseline["server_baseline_token"]:
        raise ReleaseError("server baseline changed")
    return fresh


def verify_exact_baseline_state(baseline, *, require_staging):
    topo = topology()
    if not topo["valid"]:
        raise ReleaseError("server topology is unsafe after recovery")
    if resolved(CURRENT_LINK) != baseline["current_release"] or not release_path(baseline["current_release"]):
        raise ReleaseError("exact baseline release was not restored")
    baseline_tree = tree_manifest(Path(baseline["current_release"]))
    if baseline_tree.get("digest") != baseline.get("current_tree", {}).get("digest"):
        raise ReleaseError("baseline release tree changed")
    expected_sha = baseline["articles"]["canonical"]["sha256"]
    articles = (
        article_file(CANONICAL_ARTICLES, "canonical"),
        article_file(Path(baseline["current_release"]) / "api/articles.json", "current"),
        live_articles(),
    )
    if any(not item.get("valid") or item.get("sha256") != expected_sha for item in articles):
        raise ReleaseError("baseline article raw parity is not restored")
    if sha256_file(RELEASE_SCRIPT) != RELEASE_SCRIPT_SHA256 or sha256_file(ROLLBACK_SCRIPT) != ROLLBACK_SCRIPT_SHA256:
        raise ReleaseError("release script integrity is not restored")
    cz_manifest = articles_cz_manifest()
    if not cz_manifest.get("valid") or cz_manifest.get("digest") != baseline.get("articles_cz", {}).get("digest") or cz_manifest.get("files") != baseline.get("articles_cz", {}).get("files"):
        raise ReleaseError("canonical articles-cz baseline is not restored")
    if require_staging and tree_manifest(DIST_DIR).get("digest") != baseline["staging_dist"].get("digest"):
        raise ReleaseError("baseline staging dist is not restored")
    return {"topology": topo, "baseline_tree": baseline_tree, "articles": list(articles), "articles_cz": cz_manifest}


def ensure_candidate_parent(candidate, parent):
    relative = parent.relative_to(candidate)
    current = candidate
    for part in relative.parts:
        current = current / part
        old_umask = os.umask(0)
        try:
            try:
                os.mkdir(current, 0o755)
            except FileExistsError:
                pass
        finally:
            os.umask(old_umask)
        info = safe_directory(current, root=candidate)
        if not info.get("valid"):
            raise ReleaseError(f"unsafe candidate directory: {current}")


def write_new_regular(path, raw, mode):
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    old_umask = os.umask(0)
    try:
        fd = os.open(path, flags, mode)
    finally:
        os.umask(old_umask)
    try:
        with os.fdopen(fd, "wb") as handle:
            fd = -1
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        opened = os.lstat(path)
        if (
            not stat.S_ISREG(opened.st_mode) or stat.S_ISLNK(opened.st_mode)
            or opened.st_nlink != 1 or opened.st_uid != 0
            or stat.S_IMODE(opened.st_mode) & 0o022
        ):
            raise ReleaseError(f"new file topology is unsafe: {path}")
    finally:
        if fd >= 0:
            os.close(fd)


def extract_candidate(bundle, baseline):
    token = baseline["baseline_token"][:16]
    candidate = APP_ROOT / f".price-candidate-{token}"
    if candidate.exists() or candidate.is_symlink():
        raise ReleaseError("candidate extraction path already exists")
    manifest = json.loads((bundle / "candidate-manifest.json").read_text(encoding="utf-8"))
    expected = {item["path"]: item for item in manifest.get("files", [])}
    if not expected or len(expected) > MAX_CANDIDATE_FILES or len(expected) != len(manifest.get("files", [])):
        raise ReleaseError("invalid candidate manifest")
    if any(not isinstance(item.get("bytes"), int) or item["bytes"] < 0 for item in expected.values()) or sum(item["bytes"] for item in expected.values()) > MAX_EXPANDED_BYTES:
        raise ReleaseError("candidate expanded-size limit exceeded")
    old_umask = os.umask(0)
    try:
        candidate.mkdir(mode=0o700)
    finally:
        os.umask(old_umask)
    try:
        with tarfile.open(bundle / "candidate.tar.gz", "r:gz") as archive:
            members = archive.getmembers()
            regular = []
            for member in members:
                pure = PurePosixPath(member.name)
                if pure.is_absolute() or ".." in pure.parts or not pure.parts or pure.parts[0] != "dist":
                    raise ReleaseError(f"unsafe archive path: {member.name}")
                relative = PurePosixPath(*pure.parts[1:]).as_posix()
                if member.isdir():
                    continue
                if not member.isfile() or member.issym() or member.islnk() or not relative or relative not in expected:
                    raise ReleaseError(f"unsafe archive member: {member.name}")
                if member.size != expected[relative]["bytes"]:
                    raise ReleaseError(f"archive member declared size mismatch: {relative}")
                regular.append((member, relative))
            if {relative for _, relative in regular} != set(expected):
                raise ReleaseError("archive/manifest path set mismatch")
            for member, relative in regular:
                target = candidate / Path(relative)
                ensure_candidate_parent(candidate, target.parent)
                source = archive.extractfile(member)
                if source is None:
                    raise ReleaseError(f"archive member unreadable: {relative}")
                raw = source.read()
                item = expected[relative]
                if len(raw) != item["bytes"] or sha256_bytes(raw) != item["sha256"]:
                    raise ReleaseError(f"archive member hash mismatch: {relative}")
                write_new_regular(target, raw, 0o644)
        actual = tree_manifest(candidate)
        if not actual["valid"] or actual["digest"] != manifest["digest"]:
            raise ReleaseError("extracted candidate tree mismatch")
        articles = article_file(candidate / "api/articles.json", "candidate")
        canonical = baseline["articles"]["canonical"]
        if not articles["valid"] or articles["sha256"] != canonical["sha256"] or articles["slug_digest"] != canonical["slug_digest"]:
            raise ReleaseError("candidate article export differs from canonical export")
        return candidate
    except Exception:
        shutil.rmtree(candidate, ignore_errors=True)
        raise


def run_fixed(command, timeout):
    completed = subprocess.run(command, cwd=APP_ROOT, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace", timeout=timeout, check=False, env={**os.environ, "APP_ROOT": str(APP_ROOT)})
    receipt = {"command": command, "exit_code": completed.returncode, "stdout_tail": completed.stdout[-4000:], "stderr_tail": completed.stderr[-4000:]}
    if completed.returncode != 0:
        raise ReleaseError(json.dumps(receipt, ensure_ascii=False))
    return receipt


def restore_staging(candidate_at_dist, staging_backup, candidate_used):
    if candidate_at_dist:
        if not DIST_DIR.exists() or DIST_DIR.is_symlink():
            raise ReleaseError("candidate staging dist disappeared")
        os.replace(DIST_DIR, candidate_used)
    if staging_backup.exists():
        if DIST_DIR.exists() or DIST_DIR.is_symlink():
            raise ReleaseError("cannot restore staging dist over unexpected path")
        os.replace(staging_backup, DIST_DIR)
    if candidate_used.exists():
        shutil.rmtree(candidate_used)


def apply_release(bundle):
    if not identity_for_mode("apply")["valid"]:
        raise ReleaseError("apply requires exact root identity")
    validate_bundle(bundle)
    with open_lock(create=True) as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        baseline = validate_bundle(bundle)
        fresh = verify_fresh_baseline(baseline)
        candidate = extract_candidate(bundle, baseline)
        token = baseline["baseline_token"][:16]
        staging_backup = APP_ROOT / f".price-staging-backup-{token}"
        candidate_used = APP_ROOT / f".price-candidate-used-{token}"
        if staging_backup.exists() or staging_backup.is_symlink() or candidate_used.exists() or candidate_used.is_symlink():
            shutil.rmtree(candidate, ignore_errors=True)
            raise ReleaseError("staging backup path already exists")
        candidate_at_dist = False
        release_switched = False
        new_release = None
        apply_receipt = None
        failure = None
        automatic_rollback = None
        try:
            # Candidate extraction can take time. Re-prove the complete shared
            # baseline immediately before the first staging mutation.
            final_fresh = verify_fresh_baseline(baseline)
            if not topology()["valid"]:
                raise ReleaseError("server topology changed under the release lock")
            if tree_manifest(DIST_DIR).get("digest") != final_fresh["staging_dist"].get("digest"):
                raise ReleaseError("staging dist changed under lock")
            os.replace(DIST_DIR, staging_backup)
            os.replace(candidate, DIST_DIR)
            candidate_at_dist = True
            release_receipt = run_fixed([str(RELEASE_SCRIPT), RELEASE_LABEL], 180)
            new_release = resolved(CURRENT_LINK)
            release_switched = new_release != baseline["current_release"]
            if not release_switched or not release_path(new_release) or not re.fullmatch(r"[0-9]{8}-[0-9]{6}-prices-10d9dc6", Path(new_release).name):
                raise ReleaseError("guarded release did not switch to the expected labelled release")
            released_manifest = tree_manifest(Path(new_release))
            if not released_manifest["valid"] or released_manifest["digest"] != baseline["candidate"]["tree_digest"]:
                raise ReleaseError("released tree differs from candidate")
            current_articles = article_file(Path(new_release) / "api/articles.json", "released")
            if current_articles.get("sha256") != baseline["articles"]["canonical"].get("sha256"):
                raise ReleaseError("released article export differs from canonical")
            canonical_after = article_file(CANONICAL_ARTICLES, "canonical-after-release")
            if canonical_after.get("sha256") != baseline["articles"]["canonical"].get("sha256"):
                raise ReleaseError("canonical article export changed during release")
            cz_after = articles_cz_manifest()
            if (
                not cz_after.get("valid")
                or cz_after.get("digest") != baseline.get("articles_cz", {}).get("digest")
                or cz_after.get("files") != baseline.get("articles_cz", {}).get("files")
            ):
                raise ReleaseError("canonical articles-cz changed during release")
            apply_receipt = {
                "schema": SCHEMA, "status": "released", "mode": "apply", "completed_at": utc_now(),
                "account": APPLY_LOGIN, "role": "root-release-operator", "roles": ROLES,
                "target_commit": TARGET_COMMIT, "baseline_token": baseline["baseline_token"],
                "previous_release": baseline["current_release"], "new_release": new_release,
                "candidate_tree_digest": baseline["candidate"]["tree_digest"], "release": release_receipt,
            }
            receipt_path = bundle / "apply-receipt.json"
            write_new_regular(
                receipt_path,
                (json.dumps(apply_receipt, ensure_ascii=False, sort_keys=True) + "\n").encode("utf-8"),
                0o600,
            )
        except Exception as exc:
            failure = exc
            if release_switched:
                try:
                    automatic_rollback = run_fixed([str(ROLLBACK_SCRIPT), Path(baseline["current_release"]).name], 180)
                    verify_exact_baseline_state(baseline, require_staging=False)
                except Exception as rollback_exc:
                    failure = ReleaseError(f"apply failed and automatic rollback was not proved: {type(rollback_exc).__name__}: {rollback_exc}")
        finally:
            restore_staging(candidate_at_dist, staging_backup, candidate_used)
            if candidate.exists():
                shutil.rmtree(candidate)
        if failure is not None:
            try:
                verify_exact_baseline_state(baseline, require_staging=True)
            except Exception as recovery_exc:
                raise ReleaseError(
                    f"release failure left an unproved recovery state: {type(recovery_exc).__name__}: {recovery_exc}"
                ) from failure
            raise ReleaseError(
                f"release failed after verified automatic recovery ({'rollback executed' if automatic_rollback else 'no switch'}): "
                f"{type(failure).__name__}: {failure}"
            ) from failure
        if apply_receipt is None:
            raise ReleaseError("apply completed without a receipt")
        if tree_manifest(DIST_DIR).get("digest") != baseline["staging_dist"].get("digest"):
            raise ReleaseError("staging dist was not restored after successful release")
        return apply_receipt


def rollback_release(bundle):
    if not identity_for_mode("rollback")["valid"]:
        raise ReleaseError("rollback requires exact root identity")
    with open_lock(create=False) as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        baseline = validate_bundle(bundle)
        topo = topology()
        if not topo["valid"]:
            raise ReleaseError("server topology is unsafe before rollback")
        receipt_path = bundle / "apply-receipt.json"
        info = safe_file(receipt_path, root=bundle)
        if not info["valid"] or info["uid"] != 0 or stat.S_IMODE(os.lstat(receipt_path).st_mode) & 0o022:
            raise ReleaseError("safe apply receipt is unavailable")
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        if (
            receipt.get("schema") != SCHEMA
            or receipt.get("baseline_token") != baseline.get("baseline_token")
            or receipt.get("target_commit") != TARGET_COMMIT
            or receipt.get("account") != APPLY_LOGIN
            or receipt.get("role") != "root-release-operator"
            or receipt.get("roles") != ROLES
        ):
            raise ReleaseError("apply receipt identity mismatch")
        exact_new = receipt.get("new_release")
        if resolved(CURRENT_LINK) != exact_new or not release_path(exact_new):
            raise ReleaseError("current release is not the exact release from the apply receipt")
        current_manifest = tree_manifest(Path(exact_new))
        if current_manifest.get("digest") != baseline.get("candidate", {}).get("tree_digest"):
            raise ReleaseError("current release differs from the applied candidate")
        canonical = article_file(CANONICAL_ARTICLES, "canonical")
        current_articles = article_file(Path(exact_new) / "api/articles.json", "current")
        live = live_articles()
        expected_article_sha = baseline["articles"]["canonical"]["sha256"]
        if any(item.get("sha256") != expected_article_sha for item in (canonical, current_articles, live)):
            raise ReleaseError("full canonical article baseline changed before rollback")
        if sha256_file(RELEASE_SCRIPT) != RELEASE_SCRIPT_SHA256 or sha256_file(ROLLBACK_SCRIPT) != ROLLBACK_SCRIPT_SHA256:
            raise ReleaseError("release script integrity changed before rollback")
        before_cz = articles_cz_manifest()
        if not before_cz.get("valid") or before_cz.get("digest") != baseline.get("articles_cz", {}).get("digest") or before_cz.get("files") != baseline.get("articles_cz", {}).get("files"):
            raise ReleaseError("canonical articles-cz baseline changed before rollback")
        baseline_tree = tree_manifest(Path(baseline["current_release"]))
        if not baseline_tree.get("valid") or baseline_tree.get("digest") != baseline.get("current_tree", {}).get("digest"):
            raise ReleaseError("exact baseline release tree changed before rollback")
        if tree_manifest(DIST_DIR).get("digest") != baseline["staging_dist"].get("digest"):
            raise ReleaseError("restored staging dist changed before rollback")
        rollback_receipt = run_fixed([str(ROLLBACK_SCRIPT), Path(baseline["current_release"]).name], 180)
        verification = verify_exact_baseline_state(baseline, require_staging=True)
        return {
            "schema": SCHEMA, "status": "rolled_back", "mode": "rollback", "completed_at": utc_now(),
            "account": APPLY_LOGIN, "role": "root-release-operator", "roles": ROLES,
            "target_commit": TARGET_COMMIT, "baseline_token": baseline["baseline_token"],
            "rolled_back_from": exact_new, "current_release": resolved(CURRENT_LINK), "rollback": rollback_receipt,
            "verification": verification,
        }


def main():
    try:
        if MODE in {"audit", "root-audit"}:
            result = audit_state(MODE)
        elif MODE == "apply" and BUNDLE_DIR is not None:
            result = apply_release(BUNDLE_DIR)
        elif MODE == "rollback" and BUNDLE_DIR is not None:
            result = rollback_release(BUNDLE_DIR)
        else:
            raise ReleaseError("invalid fixed mode")
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 0 if result.get("status") in {"ok", "released", "rolled_back"} else 3
    except Exception as exc:
        print(json.dumps({
            "schema": SCHEMA, "status": "error", "mode": MODE,
            "account": pwd.getpwuid(os.getuid()).pw_name, "roles": ROLES,
            "error": f"{type(exc).__name__}: {exc}",
            "current_release": resolved(CURRENT_LINK),
        }, ensure_ascii=False, sort_keys=True))
        return 1


raise SystemExit(main())
PY
