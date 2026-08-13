#!/usr/bin/env bash
set -euo pipefail

# Fixed split-role production operator for one approved catalog-price release.
# Deploy may only audit. Root may only preflight/apply/rollback. The operator
# never builds from, uploads to, or edits the mutable server source tree.

MODE="${1:-audit}"
BUNDLE_DIR="${2:-}"

case "$MODE" in
  audit|root-audit) ;;
  apply|rollback|diagnose-recovery|repair-release-root)
    [[ "$BUNDLE_DIR" =~ ^/tmp/rosomaha-main-price-release-64ba304-[0-9a-f]{16}$ ]] || {
      echo '{"status":"error","error":"invalid fixed bundle path"}'
      exit 2
    }
    ;;
  *)
    echo '{"status":"error","error":"unsupported fixed operator mode"}'
    exit 2
    ;;
esac

PYTHONDONTWRITEBYTECODE=1 exec /usr/bin/python3 -I -B - "$MODE" "$BUNDLE_DIR" <<'PY'
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

SCHEMA = "rosomaha-main-price-release/v4"
DELTA_SCHEMA = "rosomaha-main-price-delta/v1"
DELTA_BASE_SOURCE = "current_release"
PROGRESS_SCHEMA = "rosomaha-main-price-apply-progress/v1"
RECOVERY_DIAGNOSTIC_SCHEMA = "rosomaha-main-price-recovery-diagnostic/v1"
ROOT_REPAIR_SCHEMA = "rosomaha-main-price-root-repair/v1"
HOST = "90.156.168.115"
AUDIT_LOGIN = "deploy"
APPLY_LOGIN = "root"
ROLES = {"audit": AUDIT_LOGIN, "apply": APPLY_LOGIN}
TARGET_COMMIT = "64ba304c6c3128493a30e7408273652a326752d3"
RELEASE_LABEL = "prices-64ba304"
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
RELEASE_SCRIPT_SHA256 = "75bb1d3cbda1fa7041860a1fe1dac661b28d87a7170ef57c554b8c247e9ad942"
ROLLBACK_SCRIPT_SHA256 = "aeee52f314036112501a7acc0af5fa09ee7c081327fb867b91c64b983bd41acc"
DIAGNOSTIC_BASELINE_OPERATOR_SHA256 = "57e364d6f9439244f87b4d0b44ccdc092ff508aca20d8e90092a5d1926094e6c"
FIXED_COMMANDS = ("python3", "rsync", "bash", "date", "git", "mkdir", "ln", "readlink", "find", "sort")
ARTICLES_CZ_ALLOWLIST = (
    "avgustovskiy-marshrut-na-rosomahe-chek-list-osmotra-pered-vyezdom.ts",
    "bolotohod-ili-kvadrotsikl-kak-vybrat-rosomahu-pod-svoy-marshrut.ts",
    "bolotohod-ili-smert-pochemu-aprel-ubivaet-tehniku-silnee-chem-yanvar.ts",
    "chto-esli-vash-bolotohod-zastryal-nochyu-v-glushi-realnaya-istoriya-spaseniya-i-vyvody.ts",
    "den-pobedy.ts",
    "dve-nedeli-na-kolesah-dnevnik-motoputeshestviya-po-yuzhnomu-uralu-vesnoy.ts",
    "elektrika-rosomahi-vo-vlazhnosti-5-voprosov-i-bezopasnyy-chek-list.ts",
    "esli-rosomaha-zaglohla-v-vode-bezopasnyy-poryadok-deystviy-na-marshrute.ts",
    "gryazevoy-turizm-2026-gayd-po-luchshim-marshrutam-tsentralnoy-rossii-i-ne-tolko-dlya-kvadrotsiklov-i-bolotohodov.ts",
    "index.ts",
    "interesnoe-2.ts",
    "interesnoe.ts",
    "kak-podderzhat-ohlazhdenie-rosomahi-v-letnyuyu-zharu-prakticheskiy-poryadok.ts",
    "kak-podgotovit-mosty-rosomahi-k-letnemu-bezdorozhyu-profilakticheskiy-osmotr.ts",
    "kak-proyti-glubokuyu-koleyu-na-rosomahe-prakticheskie-sovety-po-preodoleniyu-letnih-prepyatstviy.ts",
    "lebyodka-na-rosomahe-v-letnem-lesu-bezopasnoe-samovytaskivanie.ts",
    "letnyaya-podveska-rosomahi-proverka-nastroyka-i-obsluzhivanie-pered-bezdorozhem.ts",
    "marshrut-na-bolotohode-v-zharu-chek-list-spokoynoy-poezdki-na-rosomahe.ts",
    "maslo-filtry-rezina-chto-realno-nuzhno-menyat-kazhduyu-vesnu-a-chto-marketing.ts",
    "pered-brodom-na-rosomahe-7-proverok-kotorye-nelzya-propuskat.ts",
    "perevozka-gruza-na-rosomahe-ohota-rybalka-i-letniy-marshrut.ts",
    "perevozka-gruzov-letom-kak-podgotovit-rosomahu-k-ekspeditsii-s-maksimalnoy-zagruzkoy.ts",
    "podgotovka-rosomahi-k-vodnomu-marshrutu-bezopasnyy-chek-list.ts",
    "polnyy-chek-list-podgotovki-kvadrotsikla-k-letnemu-sezonu-2026.ts",
    "posle-silnogo-dozhdya-kogda-menyat-marshrut-na-rosomahe.ts",
    "proverka-rosomahi-posle-marshruta-pyat-shagov-k-osennemu-sezonu.ts",
    "rosomaha-zastryala-v-bolote-spokoynyy-poryadok-deystviy-bez-lishney-suety.ts",
    "shiny-dlya-letnego-bezdorozhya-chto-vybrat-dlya-gryazi-peska-i-kamenistyh-marshrutov.ts",
    "shiny-dlya-letney-gryazi-na-rosomahe-vybor-protektora-pod-marshrut.ts",
    "smeshnoe-2.ts",
    "smeshnoe.ts",
    "top-5-neochevidnyh-problem-s-kotorymi-stalkivayutsya-vladeltsy-kvadrotsiklov-vesnoy-i-kak-ih-izbezhat.ts",
    "vesenniy-tyuning-7-byudzhetnyh-apgreydov-kotorye-preobrazyat-vash-kvadrotsikl-k-letu.ts",
)
BUNDLE_FILES = (
    "baseline.json",
    "delta.tar.gz",
    "delta-manifest.json",
    "target-manifest.json",
    "operator.sh",
)
OPTIONAL_BUNDLE_FILES = ("apply-progress.json", "apply-receipt.json")
PROGRESS_PHASES = {
    "bundle_validated", "baseline_refreshed", "candidate_reconstructed",
    "final_preflight_ok", "dist_swapped", "fixed_release_started",
    "fixed_release_finished", "release_verified", "staging_restored",
    "failed_before_switch", "failed_after_switch_rolled_back",
    "failed_after_switch_unproved",
}
PROGRESS_FAILURE_PHASES = {
    "failed_before_switch", "failed_after_switch_rolled_back",
    "failed_after_switch_unproved",
}
MAX_PROGRESS_BYTES = 4 * 1024
MAX_PROGRESS_ELAPSED_SECONDS = 24 * 60 * 60
MAX_DELTA_ARCHIVE_BYTES = 16 * 1024 * 1024
MAX_DELTA_EXPANDED_BYTES = 64 * 1024 * 1024
MAX_DELTA_FILES = 1_000
MAX_TARGET_BYTES = 1024 * 1024 * 1024
MAX_CANDIDATE_FILES = 20_000
MAX_SCRIPT_BYTES = 256 * 1024
FIXED_BIN_PATHS = {
    "bash": "/bin/bash",
    "python3": "/usr/bin/python3",
    "rsync": "/usr/bin/rsync",
    "date": "/usr/bin/date",
    "git": "/usr/bin/git",
    "mkdir": "/usr/bin/mkdir",
    "ln": "/usr/bin/ln",
    "readlink": "/usr/bin/readlink",
    "find": "/usr/bin/find",
    "sort": "/usr/bin/sort",
}
FIXED_PATH = "/usr/bin:/bin"


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


def read_verified_script(path, expected_sha):
    """Read one exact inode safely; callers never execute the mutable path."""
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags)
    try:
        before = os.fstat(fd)
        linked = os.lstat(path)
        if (
            not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
            or stat.S_ISLNK(linked.st_mode)
            or (before.st_dev, before.st_ino) != (linked.st_dev, linked.st_ino)
        ):
            raise ReleaseError(f"unsafe release script inode: {path}")
        chunks = []
        total = 0
        while True:
            chunk = os.read(fd, min(64 * 1024, MAX_SCRIPT_BYTES + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > MAX_SCRIPT_BYTES:
                raise ReleaseError(f"release script exceeds fixed size limit: {path}")
        after = os.fstat(fd)
        if (
            (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
            != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
        ):
            raise ReleaseError(f"release script changed during verified read: {path}")
        raw = b"".join(chunks)
        if len(raw) != before.st_size or sha256_bytes(raw) != expected_sha:
            raise ReleaseError(f"release script integrity mismatch: {path}")
        return raw
    finally:
        os.close(fd)


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


def python_runtime_supported(version_info=None):
    observed = sys.version_info if version_info is None else version_info
    return tuple(observed[:2]) >= (3, 9)


def safe_system_binary(path):
    requested = Path(path)
    try:
        link_details = os.lstat(requested)
        realpath = requested.resolve(strict=True)
        details = os.lstat(realpath)
        if requested == Path("/bin/bash"):
            intended_realpath = str(realpath) in {"/bin/bash", "/usr/bin/bash"}
        elif requested == Path("/usr/bin/python3"):
            intended_realpath = re.fullmatch(r"/usr/bin/python3(?:\.[0-9]+)?", str(realpath)) is not None
        else:
            intended_realpath = str(realpath) == str(requested)
        valid = bool(
            stat.S_ISREG(details.st_mode) and not stat.S_ISLNK(details.st_mode)
            and details.st_nlink == 1 and details.st_uid == 0
            and not (stat.S_IMODE(details.st_mode) & 0o022)
            and (not stat.S_ISLNK(link_details.st_mode) or link_details.st_uid == 0)
            and intended_realpath
            and os.access(requested, os.R_OK | os.X_OK)
        )
        lexical = Path(requested.anchor)
        for part in requested.parts[1:-1]:
            lexical = lexical / part
            lexical_details = os.lstat(lexical)
            if stat.S_ISLNK(lexical_details.st_mode):
                valid = valid and lexical_details.st_uid == 0
            else:
                valid = valid and bool(
                    stat.S_ISDIR(lexical_details.st_mode)
                    and lexical_details.st_uid == 0
                    and not (stat.S_IMODE(lexical_details.st_mode) & 0o022)
                )
        ancestor = realpath.parent
        while valid:
            ancestor_details = os.lstat(ancestor)
            if (
                not stat.S_ISDIR(ancestor_details.st_mode) or stat.S_ISLNK(ancestor_details.st_mode)
                or ancestor_details.st_uid != 0 or stat.S_IMODE(ancestor_details.st_mode) & 0o022
            ):
                valid = False
                break
            if ancestor == ancestor.parent:
                break
            ancestor = ancestor.parent
        return {
            "path": str(requested), "realpath": str(realpath), "exists": True,
            "regular": stat.S_ISREG(details.st_mode), "symlink": stat.S_ISLNK(link_details.st_mode),
            "nlink": details.st_nlink, "uid": details.st_uid, "gid": details.st_gid,
            "mode": oct(stat.S_IMODE(details.st_mode)), "valid": valid,
        }
    except OSError as exc:
        return {"path": str(requested), "exists": False, "valid": False, "error": f"{type(exc).__name__}: {exc}"}


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


def trusted_directory_permissions(uid, mode, *, allow_group_write, require_sticky):
    permissions = stat.S_IMODE(mode)
    if uid != 0 or permissions & stat.S_IWOTH:
        return False
    if permissions & stat.S_IWGRP and not allow_group_write:
        return False
    if require_sticky and not mode & stat.S_ISVTX:
        return False
    return True


def trusted_current_link_attributes(uid, mode):
    return uid == 0 and stat.S_ISLNK(mode)


def trusted_tree_entry_permissions(uid, mode, *, is_file, nlink=1):
    if uid != 0 or stat.S_IMODE(mode) & 0o022 or stat.S_ISLNK(mode):
        return False
    if is_file:
        return stat.S_ISREG(mode) and nlink == 1
    return stat.S_ISDIR(mode)


def trusted_root_directory(path, *, allow_group_write=False, require_sticky=False):
    try:
        details = os.lstat(path)
        realpath = path.resolve(strict=True)
        valid = bool(
            stat.S_ISDIR(details.st_mode) and not stat.S_ISLNK(details.st_mode)
            and str(realpath) == str(path)
            and trusted_directory_permissions(
                details.st_uid, details.st_mode,
                allow_group_write=allow_group_write, require_sticky=require_sticky,
            )
        )
        return {
            "path": str(path), "exists": True, "realpath": str(realpath),
            "directory": stat.S_ISDIR(details.st_mode), "symlink": stat.S_ISLNK(details.st_mode),
            "uid": details.st_uid, "gid": details.st_gid,
            "mode": oct(stat.S_IMODE(details.st_mode)), "sticky": bool(details.st_mode & stat.S_ISVTX),
            "group_writable": bool(details.st_mode & stat.S_IWGRP),
            "world_writable": bool(details.st_mode & stat.S_IWOTH), "valid": valid,
        }
    except OSError as exc:
        return {"path": str(path), "exists": False, "valid": False, "error": f"{type(exc).__name__}: {exc}"}


def trusted_current_link():
    try:
        details = os.lstat(CURRENT_LINK)
        target = resolved(CURRENT_LINK)
        valid = bool(
            trusted_current_link_attributes(details.st_uid, details.st_mode)
            and CURRENT_LINK.parent.resolve(strict=True) == APP_ROOT.resolve(strict=True)
            and target is not None and release_path(target)
        )
        return {
            "path": str(CURRENT_LINK), "exists": True, "symlink": stat.S_ISLNK(details.st_mode),
            "uid": details.st_uid, "gid": details.st_gid, "realpath": target, "valid": valid,
        }
    except OSError as exc:
        return {"path": str(CURRENT_LINK), "exists": False, "valid": False, "error": f"{type(exc).__name__}: {exc}"}


def trusted_closed_tree(root, *, require_root_mode=None):
    root_info = trusted_root_directory(root)
    if require_root_mode is not None:
        root_info["valid"] = bool(root_info.get("valid") and root_info.get("mode") == oct(require_root_mode))
    if not root_info.get("valid"):
        return {"root": str(root), "valid": False, "error": "untrusted tree root", "root_info": root_info}
    file_count = 0
    directory_count = 0
    for current, dir_names, file_names in os.walk(root, followlinks=False):
        dir_names.sort()
        file_names.sort()
        current_path = Path(current)
        for name in dir_names:
            item = current_path / name
            details = os.lstat(item)
            if (
                not trusted_tree_entry_permissions(details.st_uid, details.st_mode, is_file=False)
                or not within(root, item)
            ):
                return {"root": str(root), "valid": False, "error": f"untrusted tree directory: {item}"}
            directory_count += 1
        for name in file_names:
            item = current_path / name
            details = os.lstat(item)
            if (
                not trusted_tree_entry_permissions(
                    details.st_uid, details.st_mode, is_file=True, nlink=details.st_nlink,
                ) or not within(root, item)
            ):
                return {"root": str(root), "valid": False, "error": f"untrusted tree file: {item}"}
            file_count += 1
            if file_count > MAX_CANDIDATE_FILES:
                return {"root": str(root), "valid": False, "error": "trusted tree file-count limit exceeded"}
    return {
        "root": str(root), "valid": True, "root_info": root_info,
        "file_count": file_count, "directory_count": directory_count,
    }


def tree_manifest(root):
    root_info = safe_directory(root, root=APP_ROOT)
    if not root_info["valid"]:
        return {"root": str(root), "valid": False, "error": "unsafe tree root"}
    files = []
    directories = 0
    for current, dir_names, file_names in os.walk(root, followlinks=False):
        dir_names.sort()
        file_names.sort()
        current_path = Path(current)
        for name in dir_names:
            item = current_path / name
            details = os.lstat(item)
            if not stat.S_ISDIR(details.st_mode) or stat.S_ISLNK(details.st_mode) or not within(root, item):
                return {"root": str(root), "valid": False, "error": f"unsafe directory: {item}"}
            directories += 1
        for name in file_names:
            item = current_path / name
            details = os.lstat(item)
            if not stat.S_ISREG(details.st_mode) or stat.S_ISLNK(details.st_mode) or details.st_nlink != 1 or not within(root, item):
                return {"root": str(root), "valid": False, "error": f"unsafe file: {item}"}
            relative = item.relative_to(root).as_posix()
            files.append({"path": relative, "bytes": details.st_size, "sha256": sha256_file(item)})
            if len(files) > MAX_CANDIDATE_FILES:
                return {"root": str(root), "valid": False, "error": "tree file-count limit exceeded"}
    files.sort(key=lambda item: item["path"])
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


def exact_label_releases():
    try:
        return sorted(
            str(item.resolve(strict=True)) for item in RELEASES_DIR.iterdir()
            if item.name.endswith(f"-{RELEASE_LABEL}") and release_path(str(item))
        )
    except OSError:
        return ["unreadable"]


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
    elif mode in {"root-audit", "apply", "rollback", "diagnose-recovery", "repair-release-root"}:
        valid = login == APPLY_LOGIN and uid == 0 and euid == 0
        role = "root-release-preflight" if mode == "root-audit" else (
            "root-release-diagnostic" if mode == "diagnose-recovery" else (
                "root-release-repair" if mode == "repair-release-root" else "root-release-operator"
            )
        )
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


def root_mutation_topology(current, rollback, *, require_closed_dist=False):
    parents = {
        "root": trusted_root_directory(Path("/")),
        "var": trusted_root_directory(Path("/var")),
        "var_www": trusted_root_directory(Path("/var/www")),
        "app_root": trusted_root_directory(APP_ROOT, allow_group_write=True, require_sticky=True),
        "releases": trusted_root_directory(RELEASES_DIR),
        # Mutable staging may be group-writable before the atomic swap, but its
        # root ownership and sticky parent prevent a non-root rename race.
        "staging_dist": trusted_root_directory(DIST_DIR, allow_group_write=not require_closed_dist),
    }
    current_link = trusted_current_link()
    trees = {
        "current": trusted_closed_tree(Path(current)) if current else {"valid": False, "error": "current missing"},
        "rollback": trusted_closed_tree(Path(rollback)) if rollback else {"valid": False, "error": "rollback missing"},
    }
    valid = bool(
        all(item.get("valid") for item in parents.values())
        and current_link.get("valid") and all(item.get("valid") for item in trees.values())
    )
    return {"valid": valid, "parents": parents, "current_link": current_link, "trees": trees}


def tree_contract(value):
    return {
        key: value.get(key)
        for key in ("valid", "files", "file_count", "directory_count", "digest")
    }


def exact_tree_contract(left, right):
    return canonical_json(tree_contract(left)) == canonical_json(tree_contract(right))


def delta_base_source_readiness(current, current_tree, staging, mutation):
    blockers = []
    release_valid = bool(current and release_path(current))
    current_valid = bool(current_tree.get("valid"))
    staging_valid = bool(staging.get("valid"))
    manifests_equal = bool(current_valid and staging_valid and exact_tree_contract(current_tree, staging))
    source_trusted = bool(mutation.get("trees", {}).get("current", {}).get("valid"))
    if not release_valid:
        blockers.append("current_release_unavailable")
    if not current_valid:
        blockers.append("current_tree_invalid")
    if not staging_valid:
        blockers.append("staging_tree_invalid")
    if current_valid and staging_valid and not manifests_equal:
        blockers.append("current_staging_mismatch")
    if not source_trusted:
        blockers.append("current_release_not_closed")
    return {
        "source": DELTA_BASE_SOURCE,
        "release": current if release_valid else None,
        "current_tree_valid": current_valid, "staging_tree_valid": staging_valid,
        "current_staging_exact": manifests_equal,
        "trusted_closed_tree": source_trusted,
        "blockers": blockers[:10], "blockers_truncated": len(blockers) > 10,
        "valid": not blockers,
    }


def root_apply_readiness(
    topo, command_paths, current, current_tree, staging, lock_already_held=False,
):
    rollback = rollback_target(current)
    mutation = root_mutation_topology(current, rollback)
    writable_directories = {
        name: safe_directory(path, root=APP_ROOT, writable=True)
        for name, path in {
            "app_root": APP_ROOT, "releases": RELEASES_DIR, "dist": DIST_DIR,
        }.items()
    }
    scripts = {}
    for name, path, expected_sha in (
        ("server_release", RELEASE_SCRIPT, RELEASE_SCRIPT_SHA256),
        ("server_rollback", ROLLBACK_SCRIPT, ROLLBACK_SCRIPT_SHA256),
    ):
        info = safe_file(path, root=APP_ROOT)
        try:
            raw = read_verified_script(path, expected_sha)
            info["verified_bytes"] = len(raw)
            info["verified_sha256"] = sha256_bytes(raw)
        except Exception as exc:
            info["verified_sha256"] = None
            info["verification_error"] = f"{type(exc).__name__}: {exc}"
        scripts[name] = info
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
    delta_base = delta_base_source_readiness(current, current_tree, staging, mutation)
    blockers = []
    if not delta_base.get("valid"):
        blockers.append("delta base source contract is not proved")
    valid = bool(
        all(item.get("valid") for item in writable_directories.values())
        and tmp.get("valid") and tmp.get("writable")
        and all(item.get("valid") and item.get("verified_sha256") for item in scripts.values())
        and lock.get("valid") and all(item.get("valid") for item in command_paths.values())
        and python_runtime_supported()
        and mutation.get("valid")
        and delta_base.get("valid")
    )
    return {
        "valid": valid, "writable_directories": writable_directories,
        "temporary_writable": bool(tmp.get("writable")), "scripts": scripts,
        "lock": lock, "commands_available": all(item.get("valid") for item in command_paths.values()),
        "python_version": list(sys.version_info[:3]),
        "python_version_supported": python_runtime_supported(),
        "mutation_topology": mutation,
        "delta_base": delta_base, "blockers": blockers,
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
    command_paths = {name: safe_system_binary(FIXED_BIN_PATHS[name]) for name in FIXED_COMMANDS}
    existing_label_releases = exact_label_releases()
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
    if (
        staging.get("valid") and current_tree.get("valid")
        and not exact_tree_contract(current_tree, staging)
    ):
        blockers.append("current release and staging dist manifests differ")
    if existing_label_releases:
        blockers.append("the exact release label already exists; replay is forbidden")
    root_readiness = root_apply_readiness(
        topo, command_paths, current, current_tree, staging, lock_already_held,
    ) if mode == "root-audit" else None
    if mode == "root-audit" and not root_readiness.get("valid"):
        blockers.append("root apply readiness is not proved")
    result = {
        "schema": SCHEMA, "mode": mode, "captured_at": utc_now(), "host": HOST,
        "account": login, "identity": identity, "roles": ROLES,
        "app_root": str(APP_ROOT), "current_release": current,
        "rollback_release": rollback, "articles": articles, "articles_cz": cz_manifest, "article_parity": article_parity,
        "release_scripts": scripts, "topology": topo, "staging_dist": staging, "current_tree": current_tree,
        "target_commit": TARGET_COMMIT, "delta_base_source": DELTA_BASE_SOURCE,
        "commands": command_paths,
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
        "target_commit": value["target_commit"], "delta_base_source": value["delta_base_source"],
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


def valid_relative_path(value):
    if not isinstance(value, str) or not value or len(value.encode("utf-8")) > 4096 or "\\" in value or "\x00" in value:
        return False
    pure = PurePosixPath(value)
    return bool(
        not pure.is_absolute() and pure.as_posix() == value
        and all(part not in {"", ".", ".."} for part in pure.parts)
    )


def validate_target_manifest(value):
    expected_keys = {"valid", "files", "file_count", "directory_count", "digest"}
    if not isinstance(value, dict) or set(value) != expected_keys or value.get("valid") is not True:
        raise ReleaseError("target manifest shape mismatch")
    files = value.get("files")
    if not isinstance(files, list) or not files or len(files) > MAX_CANDIDATE_FILES:
        raise ReleaseError("target manifest file list is invalid")
    paths = []
    for item in files:
        if not isinstance(item, dict) or set(item) != {"path", "bytes", "sha256"}:
            raise ReleaseError("target manifest entry shape mismatch")
        path = item.get("path")
        size = item.get("bytes")
        digest = item.get("sha256")
        if (
            not valid_relative_path(path) or isinstance(size, bool) or not isinstance(size, int) or size < 0
            or not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest)
        ):
            raise ReleaseError("target manifest entry is invalid")
        paths.append(path)
    if paths != sorted(paths) or len(paths) != len(set(paths)):
        raise ReleaseError("target manifest paths are not exact sorted unique paths")
    path_set = set(paths)
    for path in paths:
        if any(parent.as_posix() in path_set for parent in PurePosixPath(path).parents if parent.as_posix() != "."):
            raise ReleaseError("target manifest has a file/directory path conflict")
    if (
        value.get("file_count") != len(files)
        or isinstance(value.get("directory_count"), bool)
        or not isinstance(value.get("directory_count"), int)
        or value["directory_count"] < 0
        or sum(item["bytes"] for item in files) > MAX_TARGET_BYTES
        or value.get("digest") != sha256_bytes(canonical_json(files))
    ):
        raise ReleaseError("target manifest digest/count mismatch")
    return value


def manifest_summary(value):
    return {
        "digest": value["digest"], "file_count": value["file_count"],
        "directory_count": value["directory_count"],
        "files_digest": sha256_bytes(canonical_json(value["files"])),
    }


def observed_manifest_summary(value):
    return manifest_summary(tree_contract(value))


def expected_delta(base, target):
    base_files = {item["path"]: item for item in base["files"]}
    target_files = {item["path"]: item for item in target["files"]}
    changed = []
    for path, item in sorted(target_files.items()):
        previous = base_files.get(path)
        if previous != item:
            changed.append({**item, "kind": "added" if previous is None else "modified"})
    return changed, sorted(set(base_files) - set(target_files))


def validate_delta_manifest(delta, baseline, target, archive):
    if not isinstance(delta, dict) or set(delta) != {
        "schema", "base", "target", "changed", "deleted", "added_count",
        "modified_count", "changed_count", "deleted_count", "expanded_bytes", "archive",
    } or delta.get("schema") != DELTA_SCHEMA:
        raise ReleaseError("delta manifest shape/schema mismatch")
    base = baseline.get("current_tree")
    if not isinstance(base, dict) or not isinstance(base.get("files"), list):
        raise ReleaseError("baseline does not contain the full current release manifest")
    validate_target_manifest({key: base.get(key) for key in ("valid", "files", "file_count", "directory_count", "digest")})
    target_raw = (Path(archive).parent / "target-manifest.json").read_bytes()
    expected_base = {
        "source": DELTA_BASE_SOURCE, "release": baseline.get("current_release"),
        **manifest_summary(base),
    }
    expected_target = {**manifest_summary(target), "manifest_sha256": sha256_bytes(target_raw)}
    if delta.get("base") != expected_base or delta.get("target") != expected_target:
        raise ReleaseError("delta base/target binding mismatch")
    changed, deleted = expected_delta(base, target)
    if delta.get("changed") != changed or delta.get("deleted") != deleted:
        raise ReleaseError("delta change/delete set mismatch")
    expanded = sum(item["bytes"] for item in changed)
    if (
        len(changed) > MAX_DELTA_FILES or expanded > MAX_DELTA_EXPANDED_BYTES
        or delta.get("added_count") != sum(item["kind"] == "added" for item in changed)
        or delta.get("modified_count") != sum(item["kind"] == "modified" for item in changed)
        or delta.get("changed_count") != len(changed)
        or delta.get("deleted_count") != len(deleted)
        or delta.get("expanded_bytes") != expanded
    ):
        raise ReleaseError("delta count/expanded-size mismatch")
    archive_info = delta.get("archive")
    if archive_info != {
        "name": "delta.tar.gz", "sha256": sha256_file(archive), "bytes": archive.stat().st_size,
    }:
        raise ReleaseError("delta archive binding mismatch")
    return changed, deleted


def sanitize_progress_summary(value, limit=500):
    text = str(value or "")
    text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", text)
    text = re.sub(
        r"-----BEGIN [^-]*(?:PRIVATE|OPENSSH) KEY-----.*?-----END [^-]*(?:PRIVATE|OPENSSH) KEY-----",
        "[REDACTED-PRIVATE-KEY]", text, flags=re.IGNORECASE | re.DOTALL,
    )
    text = re.sub(
        r"(?i)\b(authorization|token|secret|password|passwd|api[_ -]?key|private[_ -]?key)\b"
        r"(\s*[:=]\s*|\s+)(\"[^\"]*\"|'[^']*'|[^\s,;]+)",
        lambda match: f"{match.group(1)}{match.group(2)}[REDACTED]", text,
    )
    text = re.sub(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{8,}", "Bearer [REDACTED]", text)
    text = re.sub(
        r"(?i)([?&](?:access_token|token|secret|password|api[_-]?key)=)[^&\s]+",
        r"\1[REDACTED]", text,
    )
    text = re.sub(r"(?<![A-Za-z0-9])[A-Za-z0-9_~+/=-]{48,}(?![A-Za-z0-9])", "[REDACTED-OPAQUE]", text)
    text = " ".join("".join(character if ord(character) >= 32 else " " for character in text).split())
    return text[-limit:] or "unspecified error"


def valid_progress_timestamp(value):
    if not isinstance(value, str) or len(value) > 40:
        return False
    try:
        parsed = datetime.fromisoformat(value)
        return parsed.tzinfo is not None
    except ValueError:
        return False


def validate_progress_payload(payload, baseline_token):
    base_keys = {
        "schema", "phase", "started_at", "updated_at", "elapsed_seconds",
        "baseline_token", "release_switched",
    }
    failure_keys = base_keys | {"error_type", "error_summary"}
    if not isinstance(payload, dict) or set(payload) not in (base_keys, failure_keys):
        raise ReleaseError("apply progress fields are unsafe")
    phase = payload.get("phase")
    if payload.get("schema") != PROGRESS_SCHEMA or phase not in PROGRESS_PHASES:
        raise ReleaseError("apply progress schema/phase mismatch")
    if payload.get("baseline_token") != baseline_token or not re.fullmatch(r"[0-9a-f]{64}", baseline_token):
        raise ReleaseError("apply progress baseline token mismatch")
    if not isinstance(payload.get("release_switched"), bool):
        raise ReleaseError("apply progress release flag is invalid")
    elapsed = payload.get("elapsed_seconds")
    if isinstance(elapsed, bool) or not isinstance(elapsed, int) or not 0 <= elapsed <= MAX_PROGRESS_ELAPSED_SECONDS:
        raise ReleaseError("apply progress elapsed value is invalid")
    if not valid_progress_timestamp(payload.get("started_at")) or not valid_progress_timestamp(payload.get("updated_at")):
        raise ReleaseError("apply progress timestamp is invalid")
    started = datetime.fromisoformat(payload["started_at"])
    updated = datetime.fromisoformat(payload["updated_at"])
    if updated < started:
        raise ReleaseError("apply progress timestamps are reversed")
    if phase in PROGRESS_FAILURE_PHASES:
        error_type = payload.get("error_type")
        error_summary = payload.get("error_summary")
        if (
            set(payload) != failure_keys
            or not isinstance(error_type, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.]{0,99}", error_type)
            or not isinstance(error_summary, str) or not 1 <= len(error_summary) <= 500
            or error_summary != sanitize_progress_summary(error_summary)
        ):
            raise ReleaseError("apply progress error evidence is unsafe")
    elif set(payload) != base_keys:
        raise ReleaseError("non-failure apply progress contains error fields")
    switched_phases = {
        "release_verified", "staging_restored",
        "failed_after_switch_rolled_back", "failed_after_switch_unproved",
    }
    if phase != "fixed_release_finished" and payload["release_switched"] != (phase in switched_phases):
        raise ReleaseError("apply progress phase/release flag mismatch")
    return payload


def parse_progress_raw(raw, baseline_token):
    if not isinstance(raw, bytes) or not 0 < len(raw) <= MAX_PROGRESS_BYTES:
        raise ReleaseError("apply progress size is invalid")

    def reject_duplicates(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ReleaseError("apply progress contains duplicate fields")
            result[key] = value
        return result

    try:
        payload = json.loads(raw.decode("utf-8"), object_pairs_hook=reject_duplicates)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ReleaseError("apply progress is invalid JSON") from exc
    validate_progress_payload(payload, baseline_token)
    if raw != canonical_json(payload) + b"\n":
        raise ReleaseError("apply progress is not canonical JSON")
    return payload


def validate_bundle(bundle):
    match = re.fullmatch(r"/tmp/rosomaha-main-price-release-64ba304-([0-9a-f]{16})", str(bundle))
    if not match:
        raise ReleaseError("invalid bundle path")
    details = os.lstat(bundle)
    if not stat.S_ISDIR(details.st_mode) or stat.S_ISLNK(details.st_mode) or str(bundle.resolve(strict=True)) != str(bundle) or details.st_uid != os.getuid() or stat.S_IMODE(details.st_mode) != 0o700:
        raise ReleaseError("unsafe bundle directory")
    observed_names = sorted(item.name for item in bundle.iterdir())
    required_names = set(BUNDLE_FILES)
    if not required_names.issubset(observed_names) or not set(observed_names).issubset(required_names | set(OPTIONAL_BUNDLE_FILES)):
        raise ReleaseError("bundle file set mismatch")
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
        or baseline.get("delta_base_source") != DELTA_BASE_SOURCE
    ):
        raise ReleaseError("bundle baseline identity mismatch")
    if baseline.get("baseline_token", "")[:16] != match.group(1):
        raise ReleaseError("bundle path/token mismatch")
    if not re.fullmatch(r"[0-9a-f]{64}", baseline.get("baseline_token", "")) or baseline["baseline_token"] != full_baseline_token(baseline):
        raise ReleaseError("full bundle baseline token mismatch")
    for optional_name in OPTIONAL_BUNDLE_FILES:
        optional_path = bundle / optional_name
        if not (optional_path.exists() or optional_path.is_symlink()):
            continue
        optional_info = os.lstat(optional_path)
        maximum = MAX_PROGRESS_BYTES if optional_name == "apply-progress.json" else 1024 * 1024
        if (
            not stat.S_ISREG(optional_info.st_mode) or stat.S_ISLNK(optional_info.st_mode)
            or optional_info.st_nlink != 1 or optional_info.st_uid != 0
            or stat.S_IMODE(optional_info.st_mode) != 0o600
            or optional_info.st_size <= 0 or optional_info.st_size > maximum
            or optional_path.resolve(strict=True).parent != bundle
        ):
            raise ReleaseError(f"unsafe optional bundle topology: {optional_name}")
        if optional_name == "apply-progress.json":
            parse_progress_raw(optional_path.read_bytes(), baseline["baseline_token"])
    if sha256_file(bundle / "operator.sh") != baseline.get("operator_sha256"):
        raise ReleaseError("bundle operator mismatch")
    candidate = baseline.get("candidate", {})
    archive = bundle / "delta.tar.gz"
    if (
        archive.stat().st_size > MAX_DELTA_ARCHIVE_BYTES
        or archive.stat().st_size != candidate.get("archive_bytes")
        or sha256_file(archive) != candidate.get("archive_sha256")
    ):
        raise ReleaseError("candidate delta archive mismatch")
    delta_raw = (bundle / "delta-manifest.json").read_bytes()
    target_raw = (bundle / "target-manifest.json").read_bytes()
    if sha256_bytes(delta_raw) != candidate.get("delta_manifest_sha256"):
        raise ReleaseError("candidate delta manifest mismatch")
    if sha256_bytes(target_raw) != candidate.get("target_manifest_sha256"):
        raise ReleaseError("candidate target manifest mismatch")
    target = validate_target_manifest(json.loads(target_raw.decode("utf-8")))
    delta = json.loads(delta_raw.decode("utf-8"))
    validate_delta_manifest(delta, baseline, target, archive)
    current_tree = validate_target_manifest(tree_contract(baseline.get("current_tree", {})))
    staging_tree = validate_target_manifest(tree_contract(baseline.get("staging_dist", {})))
    if not exact_tree_contract(current_tree, staging_tree):
        raise ReleaseError("baseline current release and staging dist differ")
    if (
        target.get("digest") != candidate.get("tree_digest")
        or target.get("file_count") != candidate.get("file_count")
        or target.get("directory_count") != candidate.get("directory_count")
        or target != candidate.get("target_manifest")
        or current_tree.get("digest") != candidate.get("base_tree_digest")
        or candidate.get("base_source") != DELTA_BASE_SOURCE
        or candidate.get("base_release") != baseline.get("current_release")
        or candidate.get("delta") != {
            "added_count": delta["added_count"], "modified_count": delta["modified_count"],
            "changed_count": delta["changed_count"], "deleted_count": delta["deleted_count"],
            "expanded_bytes": delta["expanded_bytes"],
        }
    ):
        raise ReleaseError("candidate delta baseline summary mismatch")
    return baseline


def verify_fresh_baseline(baseline):
    if baseline.get("server_baseline_token") != sha256_bytes(canonical_json(server_baseline_material(baseline))):
        raise ReleaseError("stored server baseline token is invalid")
    fresh = audit_state("root-audit", lock_already_held=True)
    if fresh["status"] != "ok":
        raise ReleaseError("fresh server audit is blocked")
    if fresh["server_baseline_token"] != baseline["server_baseline_token"]:
        raise ReleaseError("server baseline changed")
    if (
        fresh.get("delta_base_source") != DELTA_BASE_SOURCE
        or baseline.get("delta_base_source") != DELTA_BASE_SOURCE
        or not exact_tree_contract(fresh["current_tree"], fresh["staging_dist"])
        or not exact_tree_contract(fresh["current_tree"], baseline["current_tree"])
        or not exact_tree_contract(fresh["staging_dist"], baseline["staging_dist"])
    ):
        raise ReleaseError("fresh current release delta base parity is not proved")
    return fresh


def verify_exact_baseline_state(baseline, *, require_staging):
    topo = topology()
    if not topo["valid"]:
        raise ReleaseError("server topology is unsafe after recovery")
    if resolved(CURRENT_LINK) != baseline["current_release"] or not release_path(baseline["current_release"]):
        raise ReleaseError("exact baseline release was not restored")
    baseline_tree = tree_manifest(Path(baseline["current_release"]))
    if not exact_tree_contract(baseline_tree, baseline.get("current_tree", {})):
        raise ReleaseError("baseline release tree changed")
    expected_sha = baseline["articles"]["canonical"]["sha256"]
    articles = (
        article_file(CANONICAL_ARTICLES, "canonical"),
        article_file(Path(baseline["current_release"]) / "api/articles.json", "current"),
        live_articles(),
    )
    if any(not item.get("valid") or item.get("sha256") != expected_sha for item in articles):
        raise ReleaseError("baseline article raw parity is not restored")
    read_verified_script(RELEASE_SCRIPT, RELEASE_SCRIPT_SHA256)
    read_verified_script(ROLLBACK_SCRIPT, ROLLBACK_SCRIPT_SHA256)
    cz_manifest = articles_cz_manifest()
    if not cz_manifest.get("valid") or cz_manifest.get("digest") != baseline.get("articles_cz", {}).get("digest") or cz_manifest.get("files") != baseline.get("articles_cz", {}).get("files"):
        raise ReleaseError("canonical articles-cz baseline is not restored")
    staging_tree = tree_manifest(DIST_DIR)
    if require_staging and not exact_tree_contract(staging_tree, baseline["staging_dist"]):
        raise ReleaseError("baseline staging dist is not restored")
    if require_staging and not exact_tree_contract(baseline_tree, staging_tree):
        raise ReleaseError("restored current release and staging dist differ")
    return {
        "topology": topo, "baseline_tree": baseline_tree,
        "staging_tree": staging_tree, "articles": list(articles), "articles_cz": cz_manifest,
    }


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


def normalize_fresh_private_directory(path):
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags)
    try:
        opened = os.fstat(fd)
        linked = os.lstat(path)
        opened_mode = stat.S_IMODE(opened.st_mode)
        linked_mode = stat.S_IMODE(linked.st_mode)
        if (
            not stat.S_ISDIR(opened.st_mode) or not stat.S_ISDIR(linked.st_mode)
            or stat.S_ISLNK(linked.st_mode)
            or opened.st_uid != 0 or linked.st_uid != 0
            or (opened.st_dev, opened.st_ino) != (linked.st_dev, linked.st_ino)
            or opened_mode != linked_mode or opened_mode not in {0o700, 0o2700}
        ):
            raise ReleaseError(f"fresh private directory topology is unsafe: {path}")
        if opened_mode == 0o2700:
            os.fchmod(fd, 0o700)
        verified = os.fstat(fd)
        relinked = os.lstat(path)
        if (
            not stat.S_ISDIR(verified.st_mode) or not stat.S_ISDIR(relinked.st_mode)
            or stat.S_ISLNK(relinked.st_mode)
            or verified.st_uid != 0 or relinked.st_uid != 0
            or (verified.st_dev, verified.st_ino) != (opened.st_dev, opened.st_ino)
            or (relinked.st_dev, relinked.st_ino) != (opened.st_dev, opened.st_ino)
            or stat.S_IMODE(verified.st_mode) != 0o700
            or stat.S_IMODE(relinked.st_mode) != 0o700
        ):
            raise ReleaseError(f"fresh private directory normalization failed: {path}")
    finally:
        os.close(fd)


def repair_pinned_release_root_mode(path, exact_current):
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags)
    try:
        opened = os.fstat(fd)
        linked = os.lstat(path)
        if (
            not stat.S_ISDIR(opened.st_mode) or not stat.S_ISDIR(linked.st_mode)
            or stat.S_ISLNK(linked.st_mode) or opened.st_uid != 0 or linked.st_uid != 0
            or (opened.st_dev, opened.st_ino) != (linked.st_dev, linked.st_ino)
            or stat.S_IMODE(opened.st_mode) != 0o700 or stat.S_IMODE(linked.st_mode) != 0o700
            or resolved(CURRENT_LINK) != exact_current
        ):
            raise ReleaseError("root repair pinned precondition changed")
        os.fchmod(fd, 0o755)
        os.fsync(fd)
        verified = os.fstat(fd)
        relinked = os.lstat(path)
        if (
            not stat.S_ISDIR(verified.st_mode) or not stat.S_ISDIR(relinked.st_mode)
            or stat.S_ISLNK(relinked.st_mode) or verified.st_uid != 0 or relinked.st_uid != 0
            or (verified.st_dev, verified.st_ino) != (opened.st_dev, opened.st_ino)
            or (relinked.st_dev, relinked.st_ino) != (opened.st_dev, opened.st_ino)
            or stat.S_IMODE(verified.st_mode) != 0o755 or stat.S_IMODE(relinked.st_mode) != 0o755
            or resolved(CURRENT_LINK) != exact_current
        ):
            raise ReleaseError("root repair exact 0755 postcondition failed")
        return {
            "previous_mode": "0o700", "new_mode": "0o755", "same_inode": True,
            "uid": verified.st_uid, "gid": verified.st_gid,
            "dev": verified.st_dev, "ino": verified.st_ino,
        }
    finally:
        os.close(fd)


def write_apply_progress(
    bundle, baseline_token, phase, started_at, started_monotonic,
    *, release_switched, error=None,
):
    if phase not in PROGRESS_PHASES or not isinstance(release_switched, bool):
        raise ReleaseError("refusing invalid apply progress phase")
    payload = {
        "schema": PROGRESS_SCHEMA, "phase": phase,
        "started_at": started_at, "updated_at": utc_now(),
        "elapsed_seconds": min(
            int(max(0.0, time.monotonic() - started_monotonic)),
            MAX_PROGRESS_ELAPSED_SECONDS,
        ),
        "baseline_token": baseline_token, "release_switched": release_switched,
    }
    if phase in PROGRESS_FAILURE_PHASES:
        if error is None:
            raise ReleaseError("failure progress requires safe error evidence")
        payload.update({
            "error_type": type(error).__name__[:100],
            "error_summary": sanitize_progress_summary(error),
        })
    elif error is not None:
        raise ReleaseError("non-failure progress cannot include error evidence")
    validate_progress_payload(payload, baseline_token)
    raw = canonical_json(payload) + b"\n"
    if len(raw) > MAX_PROGRESS_BYTES:
        raise ReleaseError("apply progress exceeds fixed size limit")
    final = bundle / "apply-progress.json"
    temporary = bundle / "apply-progress.json.part"
    if temporary.exists() or temporary.is_symlink():
        raise ReleaseError("apply progress temporary path already exists")
    if final.exists() or final.is_symlink():
        existing = os.lstat(final)
        if (
            not stat.S_ISREG(existing.st_mode) or stat.S_ISLNK(existing.st_mode)
            or existing.st_nlink != 1 or existing.st_uid != 0
            or stat.S_IMODE(existing.st_mode) != 0o600
            or final.resolve(strict=True).parent != bundle
        ):
            raise ReleaseError("existing apply progress topology is unsafe")
    write_new_regular(temporary, raw, 0o600)
    temporary_info = os.lstat(temporary)
    if stat.S_IMODE(temporary_info.st_mode) != 0o600 or temporary_info.st_uid != 0:
        raise ReleaseError("apply progress temporary file mode/owner mismatch")
    os.replace(temporary, final)
    fsync_directory(bundle)
    final_info = os.lstat(final)
    if (
        not stat.S_ISREG(final_info.st_mode) or stat.S_ISLNK(final_info.st_mode)
        or final_info.st_nlink != 1 or final_info.st_uid != 0
        or stat.S_IMODE(final_info.st_mode) != 0o600
        or final_info.st_size != len(raw)
        or sha256_file(final) != sha256_bytes(raw)
    ):
        raise ReleaseError("atomic apply progress verification failed")
    return payload


def fsync_directory(path):
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags)
    try:
        details = os.fstat(fd)
        if not stat.S_ISDIR(details.st_mode) or details.st_uid != 0:
            raise ReleaseError(f"unsafe directory fsync target: {path}")
        os.fsync(fd)
    finally:
        os.close(fd)


def materialize_trusted_scripts(bundle, token, purpose):
    if purpose not in {"apply", "rollback"} or not re.fullmatch(r"[0-9a-f]{16}", token):
        raise ReleaseError("invalid trusted-script purpose/token")
    root = bundle / f"trusted-scripts-{purpose}"
    if root.exists() or root.is_symlink():
        raise ReleaseError("trusted script directory already exists")
    old_umask = os.umask(0)
    try:
        os.mkdir(root, 0o700)
    finally:
        os.umask(old_umask)
    normalize_fresh_private_directory(root)
    details = os.lstat(root)
    if (
        not stat.S_ISDIR(details.st_mode) or stat.S_ISLNK(details.st_mode)
        or details.st_uid != 0 or stat.S_IMODE(details.st_mode) != 0o700
        or root.resolve(strict=True).parent != bundle
    ):
        raise ReleaseError("trusted script directory topology is unsafe")
    scripts = {}
    try:
        for name, source, expected_sha in (
            ("server-release.sh", RELEASE_SCRIPT, RELEASE_SCRIPT_SHA256),
            ("server-rollback.sh", ROLLBACK_SCRIPT, ROLLBACK_SCRIPT_SHA256),
        ):
            raw = read_verified_script(source, expected_sha)
            target = root / name
            write_new_regular(target, raw, 0o700)
            observed = os.lstat(target)
            if (
                stat.S_IMODE(observed.st_mode) != 0o700 or observed.st_uid != 0
                or sha256_file(target) != expected_sha
            ):
                raise ReleaseError(f"trusted script copy mismatch: {name}")
            scripts[name] = target
        fsync_directory(root)
        fsync_directory(bundle)
        return root, scripts
    except Exception:
        shutil.rmtree(root, ignore_errors=True)
        raise


def copy_regular_verified(source, target, expected):
    source_flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    source_fd = os.open(source, source_flags)
    target_fd = -1
    try:
        before = os.fstat(source_fd)
        linked = os.lstat(source)
        if (
            not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or stat.S_ISLNK(linked.st_mode)
            or (before.st_dev, before.st_ino) != (linked.st_dev, linked.st_ino)
            or before.st_size != expected["bytes"]
        ):
            raise ReleaseError(f"unsafe delta base file: {source}")
        mode = stat.S_IMODE(before.st_mode)
        if mode & 0o022:
            raise ReleaseError(f"writable delta base file: {source}")
        target_flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        old_umask = os.umask(0)
        try:
            target_fd = os.open(target, target_flags, mode)
        finally:
            os.umask(old_umask)
        digest = hashlib.sha256()
        copied = 0
        while True:
            chunk = os.read(source_fd, 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            copied += len(chunk)
            view = memoryview(chunk)
            while view:
                written = os.write(target_fd, view)
                if written <= 0:
                    raise ReleaseError(f"short delta base write: {target}")
                view = view[written:]
        os.fsync(target_fd)
        after = os.fstat(source_fd)
        if (
            (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
            != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
            or copied != expected["bytes"] or digest.hexdigest() != expected["sha256"]
        ):
            raise ReleaseError(f"delta base file changed during copy: {source}")
    finally:
        if target_fd >= 0:
            os.close(target_fd)
        os.close(source_fd)
    copied_info = os.lstat(target)
    if (
        not stat.S_ISREG(copied_info.st_mode) or stat.S_ISLNK(copied_info.st_mode)
        or copied_info.st_nlink != 1 or copied_info.st_uid != 0
        or copied_info.st_size != expected["bytes"] or sha256_file(target) != expected["sha256"]
    ):
        raise ReleaseError(f"copied delta base file mismatch: {target}")


def delta_base_source_state(baseline):
    source = Path(baseline["current_release"])
    if baseline.get("delta_base_source") != DELTA_BASE_SOURCE:
        raise ReleaseError("delta base source marker mismatch")
    if resolved(CURRENT_LINK) != str(source) or not release_path(str(source)):
        raise ReleaseError("current link differs from the pinned delta base release")
    trust = trusted_closed_tree(source)
    if not trust.get("valid"):
        raise ReleaseError("current release delta base is not a closed root-owned tree")
    current_manifest = tree_manifest(source)
    staging_manifest = tree_manifest(DIST_DIR)
    if not exact_tree_contract(current_manifest, baseline["current_tree"]):
        raise ReleaseError("current release delta base differs from baseline")
    if not exact_tree_contract(staging_manifest, baseline["staging_dist"]):
        raise ReleaseError("staging dist differs from baseline before delta reconstruction")
    if not exact_tree_contract(current_manifest, staging_manifest):
        raise ReleaseError("current release and staging dist differ before delta reconstruction")
    return source, current_manifest, staging_manifest


def copy_delta_base(candidate, baseline):
    source_root, before, staging_before = delta_base_source_state(baseline)
    expected = baseline["current_tree"]
    expected_files = {item["path"]: item for item in expected["files"]}
    old_umask = os.umask(0)
    try:
        os.mkdir(candidate, 0o700)
    finally:
        os.umask(old_umask)
    normalize_fresh_private_directory(candidate)
    for current, dir_names, file_names in os.walk(source_root, followlinks=False):
        dir_names.sort()
        file_names.sort()
        current_path = Path(current)
        relative_current = current_path.relative_to(source_root)
        target_current = candidate / relative_current
        for name in dir_names:
            source_dir = current_path / name
            source_info = os.lstat(source_dir)
            if (
                not stat.S_ISDIR(source_info.st_mode) or stat.S_ISLNK(source_info.st_mode)
                or source_info.st_uid != 0 or stat.S_IMODE(source_info.st_mode) & 0o022
                or not within(source_root, source_dir)
            ):
                raise ReleaseError(f"unsafe delta base directory: {source_dir}")
            target_dir = target_current / name
            old_umask = os.umask(0)
            try:
                os.mkdir(target_dir, stat.S_IMODE(source_info.st_mode))
            finally:
                os.umask(old_umask)
        for name in file_names:
            source = current_path / name
            relative = source.relative_to(source_root).as_posix()
            item = expected_files.get(relative)
            if item is None:
                raise ReleaseError(f"unexpected delta base file: {relative}")
            copy_regular_verified(source, target_current / name, item)
    copied = tree_manifest(candidate)
    if not exact_tree_contract(copied, expected):
        raise ReleaseError("root-private delta base copy mismatch")
    source_after, after, staging_after = delta_base_source_state(baseline)
    if source_after != source_root:
        raise ReleaseError("delta base release path changed during copy")
    return {
        "source": source_root, "before": before, "after": after,
        "staging_before": staging_before, "staging_after": staging_after,
    }


def remove_empty_candidate_directories(candidate):
    for current, _dir_names, _file_names in os.walk(candidate, topdown=False, followlinks=False):
        path = Path(current)
        if path == candidate:
            continue
        details = os.lstat(path)
        if not stat.S_ISDIR(details.st_mode) or stat.S_ISLNK(details.st_mode) or not within(candidate, path):
            raise ReleaseError(f"unsafe candidate directory during prune: {path}")
        if not any(path.iterdir()):
            os.rmdir(path)


def validated_delta_archive_members(archive, expected_changed):
    members = archive.getmembers()
    if len(members) > MAX_DELTA_FILES:
        raise ReleaseError("delta archive member-count limit exceeded")
    regular = []
    for member in members:
        pure = PurePosixPath(member.name)
        if pure.is_absolute() or ".." in pure.parts or not pure.parts or pure.parts[0] != "delta":
            raise ReleaseError(f"unsafe delta archive path: {member.name}")
        relative = PurePosixPath(*pure.parts[1:]).as_posix()
        if (
            not member.isfile() or member.issym() or member.islnk()
            or not valid_relative_path(relative) or relative not in expected_changed
        ):
            raise ReleaseError(f"unsafe delta archive member: {member.name}")
        if member.size != expected_changed[relative]["bytes"]:
            raise ReleaseError(f"delta archive member declared size mismatch: {relative}")
        regular.append((member, relative))
    paths = [relative for _, relative in regular]
    if len(paths) != len(set(paths)) or set(paths) != set(expected_changed):
        raise ReleaseError("delta archive/manifest path set mismatch")
    return regular


def reconstruct_candidate(bundle, baseline):
    token = baseline["baseline_token"][:16]
    candidate = APP_ROOT / f".price-candidate-{token}"
    if candidate.exists() or candidate.is_symlink():
        raise ReleaseError("candidate reconstruction path already exists")
    target = validate_target_manifest(json.loads((bundle / "target-manifest.json").read_text(encoding="utf-8")))
    delta = json.loads((bundle / "delta-manifest.json").read_text(encoding="utf-8"))
    changed, deleted = validate_delta_manifest(delta, baseline, target, bundle / "delta.tar.gz")
    expected_changed = {item["path"]: item for item in changed}
    try:
        base_copy = copy_delta_base(candidate, baseline)
        for relative in deleted:
            target_path = candidate / Path(relative)
            info = safe_file(target_path, root=candidate)
            if not info.get("valid") or info.get("uid") != 0:
                raise ReleaseError(f"unsafe candidate deletion path: {relative}")
            os.unlink(target_path)
        with tarfile.open(bundle / "delta.tar.gz", "r:gz") as archive:
            regular = validated_delta_archive_members(archive, expected_changed)
            for member, relative in regular:
                output = candidate / Path(relative)
                ensure_candidate_parent(candidate, output.parent)
                item = expected_changed[relative]
                existing = safe_file(output, root=candidate) if output.exists() or output.is_symlink() else None
                if item["kind"] == "modified":
                    if not existing or not existing.get("valid") or existing.get("uid") != 0:
                        raise ReleaseError(f"delta modified path is unavailable: {relative}")
                    os.unlink(output)
                elif existing is not None:
                    raise ReleaseError(f"delta added path already exists: {relative}")
                source = archive.extractfile(member)
                if source is None:
                    raise ReleaseError(f"delta archive member unreadable: {relative}")
                raw = source.read(item["bytes"] + 1)
                if len(raw) != item["bytes"] or sha256_bytes(raw) != item["sha256"]:
                    raise ReleaseError(f"delta archive member hash mismatch: {relative}")
                write_new_regular(output, raw, 0o644)
        remove_empty_candidate_directories(candidate)
        actual = tree_manifest(candidate)
        target_exact = canonical_json(tree_contract(actual)) == canonical_json(target)
        if not target_exact:
            raise ReleaseError("reconstructed candidate full target manifest mismatch")
        source, base_after, staging_after = delta_base_source_state(baseline)
        base_expected = tree_contract(baseline["current_tree"])
        staging_expected = tree_contract(baseline["staging_dist"])
        base_exact = exact_tree_contract(base_after, base_expected)
        staging_exact = exact_tree_contract(staging_after, staging_expected)
        if not base_exact:
            raise ReleaseError("original delta base changed during reconstruction")
        if not staging_exact:
            raise ReleaseError("staging dist changed during reconstruction")
        articles = article_file(candidate / "api/articles.json", "candidate")
        canonical = baseline["articles"]["canonical"]
        article_exact = bool(
            articles["valid"] and articles["sha256"] == canonical["sha256"]
            and articles["slug_digest"] == canonical["slug_digest"]
        )
        if not article_exact:
            raise ReleaseError("candidate article export differs from canonical export")
        evidence = {
            "base": {
                "source": DELTA_BASE_SOURCE, "release": str(source),
                "expected": manifest_summary(base_expected),
                "observed_before": observed_manifest_summary(base_copy["before"]),
                "observed_after": observed_manifest_summary(base_after),
                "exact_match": base_exact,
            },
            "staging": {
                "expected": manifest_summary(staging_expected),
                "observed_before": observed_manifest_summary(base_copy["staging_before"]),
                "observed_after": observed_manifest_summary(staging_after),
                "exact_match": staging_exact,
            },
            "target": {
                "expected": manifest_summary(target),
                "observed": observed_manifest_summary(actual),
                "exact_match": target_exact,
            },
            "delta": {
                "added": sum(item["kind"] == "added" for item in changed),
                "modified": sum(item["kind"] == "modified" for item in changed),
                "changed": len(changed), "deleted": len(deleted),
            },
            "article_parity": {
                "expected_sha256": canonical["sha256"],
                "observed_sha256": articles["sha256"],
                "expected_slug_digest": canonical["slug_digest"],
                "observed_slug_digest": articles["slug_digest"],
                "exact_match": article_exact,
            },
            "exact_match": base_exact and staging_exact and target_exact and article_exact,
        }
        return candidate, evidence
    except Exception:
        shutil.rmtree(candidate, ignore_errors=True)
        raise


def run_fixed(script_path, argument, timeout):
    if not re.fullmatch(r"trusted-scripts-(apply|rollback)", script_path.parent.name) or script_path.name not in {"server-release.sh", "server-rollback.sh"}:
        raise ReleaseError("refusing non-private fixed script execution")
    expected_sha = RELEASE_SCRIPT_SHA256 if script_path.name == "server-release.sh" else ROLLBACK_SCRIPT_SHA256
    details = os.lstat(script_path)
    if (
        not stat.S_ISREG(details.st_mode) or stat.S_ISLNK(details.st_mode)
        or details.st_nlink != 1 or details.st_uid != 0
        or stat.S_IMODE(details.st_mode) != 0o700
        or sha256_file(script_path) != expected_sha
    ):
        raise ReleaseError("trusted script changed before fixed execution")
    parent = os.lstat(script_path.parent)
    if (
        not stat.S_ISDIR(parent.st_mode) or stat.S_ISLNK(parent.st_mode)
        or parent.st_uid != 0 or stat.S_IMODE(parent.st_mode) != 0o700
    ):
        raise ReleaseError("trusted script directory changed before execution")
    command = [FIXED_BIN_PATHS["bash"], str(script_path), argument]
    env = {
        "APP_ROOT": str(APP_ROOT), "PATH": FIXED_PATH,
        "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8",
    }
    previous_umask = os.umask(0o022)
    try:
        completed = subprocess.run(
            command, cwd=script_path.parent, stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            encoding="utf-8", errors="replace", timeout=timeout, check=False, env=env,
        )
    finally:
        os.umask(previous_umask)
    receipt = {
        "script": script_path.name, "script_sha256": expected_sha,
        "argument": argument, "exit_code": completed.returncode,
        "stdout_tail": completed.stdout[-4000:], "stderr_tail": completed.stderr[-4000:],
    }
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
    progress_started_monotonic = time.monotonic()
    progress_started_at = utc_now()
    baseline = validate_bundle(bundle)
    write_apply_progress(
        bundle, baseline["baseline_token"], "bundle_validated",
        progress_started_at, progress_started_monotonic, release_switched=False,
    )
    with open_lock(create=True) as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        baseline = validate_bundle(bundle)
        try:
            fresh = verify_fresh_baseline(baseline)
            write_apply_progress(
                bundle, baseline["baseline_token"], "baseline_refreshed",
                progress_started_at, progress_started_monotonic, release_switched=False,
            )
            candidate, delta_reconstruction = reconstruct_candidate(bundle, baseline)
            write_apply_progress(
                bundle, baseline["baseline_token"], "candidate_reconstructed",
                progress_started_at, progress_started_monotonic, release_switched=False,
            )
        except Exception as exc:
            write_apply_progress(
                bundle, baseline["baseline_token"], "failed_before_switch",
                progress_started_at, progress_started_monotonic,
                release_switched=False, error=exc,
            )
            raise
        token = baseline["baseline_token"][:16]
        trusted_root = None
        trusted_scripts = None
        staging_backup = APP_ROOT / f".price-staging-backup-{token}"
        candidate_used = APP_ROOT / f".price-candidate-used-{token}"
        if staging_backup.exists() or staging_backup.is_symlink() or candidate_used.exists() or candidate_used.is_symlink():
            shutil.rmtree(candidate, ignore_errors=True)
            path_error = ReleaseError("staging backup path already exists")
            write_apply_progress(
                bundle, baseline["baseline_token"], "failed_before_switch",
                progress_started_at, progress_started_monotonic,
                release_switched=False, error=path_error,
            )
            raise path_error
        candidate_at_dist = False
        release_switched = False
        new_release = None
        apply_receipt = None
        failure = None
        automatic_rollback = None
        try:
            candidate_trust = trusted_closed_tree(candidate, require_root_mode=0o700)
            if not candidate_trust.get("valid"):
                raise ReleaseError("extracted candidate is not a closed root-owned tree")
            trusted_root, trusted_scripts = materialize_trusted_scripts(bundle, token, "apply")
            # Candidate extraction can take time. Re-prove the complete shared
            # baseline immediately before the first staging mutation.
            final_fresh = verify_fresh_baseline(baseline)
            if not topology()["valid"]:
                raise ReleaseError("server topology changed under the release lock")
            if not exact_tree_contract(tree_manifest(DIST_DIR), final_fresh["staging_dist"]):
                raise ReleaseError("staging dist changed under lock")
            if exact_label_releases() != []:
                raise ReleaseError("exact release target label appeared before apply")
            write_apply_progress(
                bundle, baseline["baseline_token"], "final_preflight_ok",
                progress_started_at, progress_started_monotonic, release_switched=False,
            )
            os.replace(DIST_DIR, staging_backup)
            os.replace(candidate, DIST_DIR)
            candidate_at_dist = True
            moved_trust = trusted_closed_tree(DIST_DIR, require_root_mode=0o700)
            moved_manifest = tree_manifest(DIST_DIR)
            if (
                not moved_trust.get("valid")
                or not moved_manifest.get("valid")
                or canonical_json(tree_contract(moved_manifest))
                != canonical_json(validate_target_manifest(json.loads((bundle / "target-manifest.json").read_text(encoding="utf-8"))))
            ):
                raise ReleaseError("candidate staging tree changed during atomic swap")
            mutation_before_run = root_mutation_topology(
                baseline["current_release"], baseline["rollback_release"], require_closed_dist=True,
            )
            if not mutation_before_run.get("valid") or exact_label_releases() != []:
                raise ReleaseError("root mutation topology changed before fixed release")
            write_apply_progress(
                bundle, baseline["baseline_token"], "dist_swapped",
                progress_started_at, progress_started_monotonic, release_switched=False,
            )
            write_apply_progress(
                bundle, baseline["baseline_token"], "fixed_release_started",
                progress_started_at, progress_started_monotonic, release_switched=False,
            )
            release_receipt = run_fixed(trusted_scripts["server-release.sh"], RELEASE_LABEL, 180)
            new_release = resolved(CURRENT_LINK)
            release_switched = new_release != baseline["current_release"]
            write_apply_progress(
                bundle, baseline["baseline_token"], "fixed_release_finished",
                progress_started_at, progress_started_monotonic,
                release_switched=release_switched,
            )
            if not release_switched or not release_path(new_release) or not re.fullmatch(r"[0-9]{8}-[0-9]{6}-prices-64ba304", Path(new_release).name):
                raise ReleaseError("guarded release did not switch to the expected labelled release")
            if exact_label_releases() != [new_release]:
                raise ReleaseError("exact release target was not uniquely created")
            release_trust = trusted_closed_tree(Path(new_release))
            mutation_after_run = root_mutation_topology(
                new_release, baseline["current_release"], require_closed_dist=True,
            )
            if not release_trust.get("valid") or not mutation_after_run.get("valid"):
                raise ReleaseError("released root mutation topology is unsafe")
            released_manifest = tree_manifest(Path(new_release))
            if (
                not released_manifest["valid"]
                or canonical_json(tree_contract(released_manifest))
                != canonical_json(validate_target_manifest(json.loads((bundle / "target-manifest.json").read_text(encoding="utf-8"))))
            ):
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
            if (
                sha256_file(trusted_scripts["server-release.sh"]) != RELEASE_SCRIPT_SHA256
                or sha256_file(trusted_scripts["server-rollback.sh"]) != ROLLBACK_SCRIPT_SHA256
            ):
                raise ReleaseError("trusted script copies changed during release")
            read_verified_script(RELEASE_SCRIPT, RELEASE_SCRIPT_SHA256)
            read_verified_script(ROLLBACK_SCRIPT, ROLLBACK_SCRIPT_SHA256)
            write_apply_progress(
                bundle, baseline["baseline_token"], "release_verified",
                progress_started_at, progress_started_monotonic, release_switched=True,
            )
            apply_receipt = {
                "schema": SCHEMA, "status": "released", "mode": "apply", "completed_at": utc_now(),
                "account": APPLY_LOGIN, "role": "root-release-operator", "roles": ROLES,
                "target_commit": TARGET_COMMIT, "baseline_token": baseline["baseline_token"],
                "previous_release": baseline["current_release"], "new_release": new_release,
                "candidate_tree_digest": baseline["candidate"]["tree_digest"], "release": release_receipt,
                "delta_reconstruction": delta_reconstruction,
            }
            receipt_path = bundle / "apply-receipt.json"
            write_new_regular(
                receipt_path,
                (json.dumps(apply_receipt, ensure_ascii=False, sort_keys=True) + "\n").encode("utf-8"),
                0o600,
            )
        except Exception as exc:
            failure = exc
            observed_current = resolved(CURRENT_LINK)
            release_switched = observed_current != baseline["current_release"]
            if release_switched:
                new_release = observed_current
            if release_switched:
                try:
                    automatic_rollback = run_fixed(
                        trusted_scripts["server-rollback.sh"],
                        Path(baseline["current_release"]).name,
                        180,
                    )
                    verify_exact_baseline_state(baseline, require_staging=False)
                    rollback_topology = root_mutation_topology(
                        baseline["current_release"], new_release, require_closed_dist=True,
                    )
                    if not rollback_topology.get("valid") or exact_label_releases() != [new_release]:
                        raise ReleaseError("automatic rollback root topology is unsafe")
                except Exception as rollback_exc:
                    failure = ReleaseError(f"apply failed and automatic rollback was not proved: {type(rollback_exc).__name__}: {rollback_exc}")
                    write_apply_progress(
                        bundle, baseline["baseline_token"], "failed_after_switch_unproved",
                        progress_started_at, progress_started_monotonic,
                        release_switched=True, error=failure,
                    )
                else:
                    write_apply_progress(
                        bundle, baseline["baseline_token"], "failed_after_switch_rolled_back",
                        progress_started_at, progress_started_monotonic,
                        release_switched=True, error=failure,
                    )
            else:
                write_apply_progress(
                    bundle, baseline["baseline_token"], "failed_before_switch",
                    progress_started_at, progress_started_monotonic,
                    release_switched=False, error=failure,
                )
        finally:
            restore_staging(candidate_at_dist, staging_backup, candidate_used)
            if candidate.exists():
                shutil.rmtree(candidate)
            if trusted_root is not None and trusted_root.exists():
                shutil.rmtree(trusted_root)
        if failure is not None:
            try:
                verify_exact_baseline_state(baseline, require_staging=True)
                labels_after_failure = exact_label_releases()
                if not release_switched and labels_after_failure != []:
                    raise ReleaseError("failed release left a residual exact-label target")
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
        if not exact_tree_contract(tree_manifest(DIST_DIR), baseline["staging_dist"]):
            raise ReleaseError("staging dist was not restored after successful release")
        write_apply_progress(
            bundle, baseline["baseline_token"], "staging_restored",
            progress_started_at, progress_started_monotonic, release_switched=True,
        )
        return apply_receipt


def diagnostic_stat(value):
    return {
        "directory": stat.S_ISDIR(value.st_mode), "symlink": stat.S_ISLNK(value.st_mode),
        "uid": value.st_uid, "gid": value.st_gid, "mode": oct(stat.S_IMODE(value.st_mode)),
        "dev": value.st_dev, "ino": value.st_ino,
    }


def diagnostic_release_root(path):
    result = {"valid": False, "lstat": None, "fstat": None, "same_inode": False}
    fd = None
    try:
        linked = os.lstat(path)
        result["lstat"] = diagnostic_stat(linked)
        flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(path, flags)
        opened = os.fstat(fd)
        result["fstat"] = diagnostic_stat(opened)
        result["same_inode"] = (linked.st_dev, linked.st_ino) == (opened.st_dev, opened.st_ino)
        result["valid"] = bool(
            result["same_inode"] and stat.S_ISDIR(linked.st_mode) and stat.S_ISDIR(opened.st_mode)
            and not stat.S_ISLNK(linked.st_mode)
        )
    except Exception as exc:
        result["error_type"] = type(exc).__name__[:100]
    finally:
        if fd is not None:
            os.close(fd)
    return result


def diagnostic_trust(value):
    error = value.get("error")
    if error == "untrusted tree root":
        error_code = "untrusted_tree_root"
    elif isinstance(error, str) and error.startswith("untrusted tree directory:"):
        error_code = "untrusted_tree_directory"
    elif isinstance(error, str) and error.startswith("untrusted tree file:"):
        error_code = "untrusted_tree_file"
    elif error == "trusted tree file-count limit exceeded":
        error_code = "file_count_limit"
    else:
        error_code = None if value.get("valid") else "unknown_tree_error"
    root = value.get("root_info") if isinstance(value.get("root_info"), dict) else {}
    return {
        "valid": value.get("valid") is True, "error": error_code,
        "file_count": value.get("file_count") if isinstance(value.get("file_count"), int) else None,
        "directory_count": value.get("directory_count") if isinstance(value.get("directory_count"), int) else None,
        "root": {
            key: root.get(key) for key in (
                "directory", "symlink", "uid", "gid", "mode",
                "group_writable", "world_writable", "valid",
            )
        },
    }


def diagnostic_tree(value, expected):
    error = value.get("error")
    if error == "unsafe tree root":
        error_code = "unsafe_tree_root"
    elif isinstance(error, str) and error.startswith("unsafe directory:"):
        error_code = "unsafe_tree_directory"
    elif isinstance(error, str) and error.startswith("unsafe file:"):
        error_code = "unsafe_tree_file"
    elif error == "tree file-count limit exceeded":
        error_code = "file_count_limit"
    else:
        error_code = None if value.get("valid") else "unknown_tree_error"
    valid = value.get("valid") is True
    return {
        "valid": valid, "error": error_code,
        "digest": value.get("digest") if valid else None,
        "file_count": value.get("file_count") if valid else None,
        "directory_count": value.get("directory_count") if valid else None,
        "exact_expected": bool(valid and exact_tree_contract(value, expected)),
    }


def diagnostic_article(value):
    return {
        "valid": value.get("valid") is True,
        "sha256": value.get("sha256") if re.fullmatch(r"[0-9a-f]{64}", str(value.get("sha256") or "")) else None,
        "bytes": value.get("bytes") if isinstance(value.get("bytes"), int) else None,
        "count": value.get("count") if isinstance(value.get("count"), int) else None,
        "unique_count": value.get("unique_count") if isinstance(value.get("unique_count"), int) else None,
        "slug_digest": value.get("slug_digest") if re.fullmatch(r"[0-9a-f]{64}", str(value.get("slug_digest") or "")) else None,
        "http_status": value.get("http_status") if isinstance(value.get("http_status"), int) else None,
        "exact_public_url": value.get("final_url") == PUBLIC_ARTICLES_URL if "final_url" in value else None,
    }


def diagnostic_current(exact_new, baseline_release):
    try:
        linked = os.lstat(CURRENT_LINK)
        observed = resolved(CURRENT_LINK)
        link = {
            "valid": trusted_current_link_attributes(linked.st_uid, linked.st_mode),
            "symlink": stat.S_ISLNK(linked.st_mode), "uid": linked.st_uid, "gid": linked.st_gid,
            "dev": linked.st_dev, "ino": linked.st_ino,
        }
    except Exception as exc:
        observed = None
        link = {"valid": False, "symlink": False, "uid": None, "gid": None, "dev": None, "ino": None, "error_type": type(exc).__name__[:100]}
    if observed == exact_new:
        state = "receipt_release"
    elif observed == baseline_release:
        state = "baseline_release"
    elif observed is None:
        state = "missing"
    else:
        state = "unexpected_release"
    return {
        "state": state, "matches_receipt": observed == exact_new,
        "matches_baseline": observed == baseline_release, "link": link,
    }


def diagnostic_tree_pair(before, after, expected):
    return {
        "before": diagnostic_tree(before, expected),
        "after": diagnostic_tree(after, expected),
        "stable": bool(
            before.get("valid") and after.get("valid")
            and exact_tree_contract(before, after)
        ),
    }


def diagnostic_article_pair(before, after):
    before_summary = diagnostic_article(before)
    after_summary = diagnostic_article(after)
    return {
        "before": before_summary, "after": after_summary,
        "stable": bool(before_summary["valid"] and after_summary["valid"] and before_summary == after_summary),
    }


def diagnostic_cz_pair(before, after, baseline):
    def summary(value):
        digest = value.get("digest")
        return {
            "valid": value.get("valid") is True,
            "count": value.get("count") if isinstance(value.get("count"), int) else None,
            "digest": digest if re.fullmatch(r"[0-9a-f]{64}", str(digest or "")) else None,
        }
    before_summary = summary(before)
    after_summary = summary(after)
    stable = bool(
        before.get("valid") and after.get("valid")
        and before.get("digest") == after.get("digest")
        and before.get("files") == after.get("files")
    )
    return {
        "before": before_summary, "after": after_summary, "stable": stable,
        "matches_baseline": bool(
            stable and after.get("digest") == baseline.get("digest")
            and after.get("files") == baseline.get("files")
        ),
    }


def diagnostic_labels(value, exact_new):
    safe = [
        item for item in value
        if isinstance(item, str) and re.fullmatch(r"/var/www/rosomaha/_releases/[0-9]{8}-[0-9]{6}-prices-64ba304", item)
    ]
    valid = len(safe) == len(value) and len(value) <= 4
    return {
        "valid": valid, "count": len(value), "releases": safe if valid else [],
        "truncated": len(value) > 4, "exact_receipt_set": valid and safe == [exact_new],
    }


def read_diagnostic_apply_receipt(bundle, baseline):
    path = bundle / "apply-receipt.json"
    info = safe_file(path, root=bundle)
    if not info.get("valid") or info.get("uid") != 0 or stat.S_IMODE(os.lstat(path).st_mode) != 0o600:
        raise ReleaseError("safe apply receipt is unavailable for diagnosis")

    def reject_duplicates(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ReleaseError("apply receipt contains duplicate fields")
            result[key] = value
        return result

    receipt = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicates)
    expected_keys = {
        "schema", "status", "mode", "completed_at", "account", "role", "roles",
        "target_commit", "baseline_token", "previous_release", "new_release",
        "candidate_tree_digest", "release", "delta_reconstruction",
    }
    exact_new = receipt.get("new_release")
    if (
        not isinstance(receipt, dict) or set(receipt) != expected_keys
        or receipt.get("schema") != SCHEMA or receipt.get("status") != "released" or receipt.get("mode") != "apply"
        or receipt.get("account") != APPLY_LOGIN or receipt.get("role") != "root-release-operator" or receipt.get("roles") != ROLES
        or receipt.get("target_commit") != TARGET_COMMIT or receipt.get("baseline_token") != baseline.get("baseline_token")
        or receipt.get("previous_release") != baseline.get("current_release")
        or not isinstance(exact_new, str)
        or not re.fullmatch(r"/var/www/rosomaha/_releases/[0-9]{8}-[0-9]{6}-prices-64ba304", exact_new)
        or receipt.get("candidate_tree_digest") != baseline.get("candidate", {}).get("tree_digest")
    ):
        raise ReleaseError("apply receipt identity mismatch for diagnosis")
    release = receipt.get("release")
    if (
        not isinstance(release, dict) or release.get("script") != "server-release.sh"
        or release.get("script_sha256") != RELEASE_SCRIPT_SHA256
        or release.get("argument") != RELEASE_LABEL or release.get("exit_code") != 0
    ):
        raise ReleaseError("apply receipt fixed release evidence mismatch for diagnosis")
    evidence = receipt.get("delta_reconstruction")
    base_expected = manifest_summary(baseline["current_tree"])
    staging_expected = manifest_summary(baseline["staging_dist"])
    target_expected = manifest_summary(baseline["candidate"]["target_manifest"])
    counts = baseline["candidate"]["delta"]
    if (
        not isinstance(evidence, dict) or evidence.get("exact_match") is not True
        or evidence.get("base") != {
            "source": DELTA_BASE_SOURCE, "release": baseline["current_release"],
            "expected": base_expected, "observed_before": base_expected,
            "observed_after": base_expected, "exact_match": True,
        }
        or evidence.get("staging") != {
            "expected": staging_expected, "observed_before": staging_expected,
            "observed_after": staging_expected, "exact_match": True,
        }
        or evidence.get("target") != {
            "expected": target_expected, "observed": target_expected, "exact_match": True,
        }
        or evidence.get("delta") != {
            "added": counts["added_count"], "modified": counts["modified_count"],
            "changed": counts["changed_count"], "deleted": counts["deleted_count"],
        }
    ):
        raise ReleaseError("apply receipt reconstruction evidence mismatch for diagnosis")
    return receipt


def diagnose_recovery(bundle):
    if not identity_for_mode("diagnose-recovery")["valid"]:
        raise ReleaseError("recovery diagnosis requires exact root identity")
    with open_lock(create=False) as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        baseline = validate_bundle(bundle)
        if baseline.get("operator_sha256") != DIAGNOSTIC_BASELINE_OPERATOR_SHA256:
            raise ReleaseError("diagnostic baseline operator pin mismatch")
        receipt = read_diagnostic_apply_receipt(bundle, baseline)
        exact_new = receipt["new_release"]
        release_root = Path(exact_new)

        current_before = diagnostic_current(exact_new, baseline["current_release"])
        root_before = diagnostic_release_root(release_root)
        trust_before = diagnostic_trust(trusted_closed_tree(release_root))
        release_tree_before = tree_manifest(release_root)
        staging_tree_before = tree_manifest(DIST_DIR)
        canonical_before = article_file(CANONICAL_ARTICLES, "canonical-before")
        current_articles_before = article_file(release_root / "api/articles.json", "receipt-release-before")
        cz_before = articles_cz_manifest()
        labels_before_raw = exact_label_releases()

        live = live_articles()

        labels_after_raw = exact_label_releases()
        cz_after = articles_cz_manifest()
        current_articles_after = article_file(release_root / "api/articles.json", "receipt-release-after")
        canonical_after = article_file(CANONICAL_ARTICLES, "canonical-after")
        staging_tree_after = tree_manifest(DIST_DIR)
        release_tree_after = tree_manifest(release_root)
        trust_after = diagnostic_trust(trusted_closed_tree(release_root))
        root_after = diagnostic_release_root(release_root)
        current_after = diagnostic_current(exact_new, baseline["current_release"])

    current_stable = current_before == current_after
    release_root_stable = bool(root_before.get("valid") and root_after.get("valid") and root_before == root_after)
    trusted_tree_stable = trust_before == trust_after
    current_tree = diagnostic_tree_pair(
        release_tree_before, release_tree_after, baseline["candidate"]["target_manifest"],
    )
    staging_tree = diagnostic_tree_pair(staging_tree_before, staging_tree_after, baseline["staging_dist"])
    canonical = diagnostic_article_pair(canonical_before, canonical_after)
    current_articles = diagnostic_article_pair(current_articles_before, current_articles_after)
    live_summary = diagnostic_article(live)
    articles = {"canonical": canonical, "current": current_articles, "live": live_summary}
    hashes = {
        "canonical": canonical["after"].get("sha256"),
        "current": current_articles["after"].get("sha256"),
        "live": live_summary.get("sha256"),
    }
    baseline_sha = baseline["articles"]["canonical"]["sha256"]
    cz = diagnostic_cz_pair(cz_before, cz_after, baseline["articles_cz"])
    labels_before = diagnostic_labels(labels_before_raw, exact_new)
    labels_after = diagnostic_labels(labels_after_raw, exact_new)
    labels = {
        "before": labels_before, "after": labels_after,
        "stable": labels_before_raw == labels_after_raw and labels_before.get("valid") and labels_after.get("valid"),
    }
    snapshot_consistent = bool(
        current_stable and current_before["matches_receipt"] and current_after["matches_receipt"]
        and current_before["link"]["valid"] and current_after["link"]["valid"]
        and release_root_stable and trusted_tree_stable
        and current_tree["stable"] and staging_tree["stable"]
        and canonical["stable"] and current_articles["stable"]
        and cz["stable"] and labels["stable"]
    )
    return {
        "schema": RECOVERY_DIAGNOSTIC_SCHEMA, "status": "diagnosed", "mode": "diagnose-recovery",
        "account": APPLY_LOGIN, "role": "root-release-diagnostic", "roles": ROLES,
        "target_commit": TARGET_COMMIT, "baseline_token": baseline["baseline_token"],
        "read_only": True, "receipt_valid": True,
        "lock": {"existing": True, "exclusive": True, "created": False},
        "snapshot_consistent": snapshot_consistent,
        "current": {
            "before": current_before, "after": current_after, "stable": current_stable,
        },
        "release_root": {"before": root_before, "after": root_after, "stable": release_root_stable},
        "trusted_tree": {"before": trust_before, "after": trust_after, "stable": trusted_tree_stable},
        "current_tree": current_tree,
        "staging_tree": staging_tree,
        "articles": articles,
        "article_comparison": {
            "baseline_sha256": baseline_sha,
            "canonical_matches_baseline": hashes["canonical"] == baseline_sha,
            "current_matches_baseline": hashes["current"] == baseline_sha,
            "live_matches_baseline": hashes["live"] == baseline_sha,
            "canonical_matches_current": hashes["canonical"] is not None and hashes["canonical"] == hashes["current"],
            "canonical_matches_live": hashes["canonical"] is not None and hashes["canonical"] == hashes["live"],
            "current_matches_live": hashes["current"] is not None and hashes["current"] == hashes["live"],
        },
        "articles_cz": cz,
        "labels": labels,
    }


def repair_release_root(bundle):
    if not identity_for_mode("repair-release-root")["valid"]:
        raise ReleaseError("release root repair requires exact root identity")
    with open_lock(create=False) as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        baseline = validate_bundle(bundle)
        if baseline.get("operator_sha256") != DIAGNOSTIC_BASELINE_OPERATOR_SHA256:
            raise ReleaseError("root repair baseline operator pin mismatch")
        receipt = read_diagnostic_apply_receipt(bundle, baseline)
        exact_new = receipt["new_release"]
        release_root = Path(exact_new)
        expected_sha = baseline["articles"]["canonical"]["sha256"]

        if resolved(CURRENT_LINK) != exact_new or exact_label_releases() != [exact_new]:
            raise ReleaseError("root repair current release binding mismatch")
        root_before = diagnostic_release_root(release_root)
        if (
            not root_before.get("valid") or not root_before.get("same_inode")
            or root_before.get("lstat") != root_before.get("fstat")
            or root_before.get("lstat", {}).get("uid") != 0
            or root_before.get("lstat", {}).get("mode") != "0o700"
        ):
            raise ReleaseError("root repair requires exact root-owned 0700 release root")
        trust_before = trusted_closed_tree(release_root)
        release_tree_before = tree_manifest(release_root)
        staging_before = tree_manifest(DIST_DIR)
        canonical_before = article_file(CANONICAL_ARTICLES, "canonical-before-root-repair")
        current_articles_before = article_file(
            release_root / "api/articles.json", "receipt-release-before-root-repair",
        )
        cz_before = articles_cz_manifest()
        if not trust_before.get("valid"):
            raise ReleaseError("root repair release tree is not trusted")
        if not exact_tree_contract(release_tree_before, baseline["candidate"]["target_manifest"]):
            raise ReleaseError("root repair release tree differs from the applied candidate")
        if not exact_tree_contract(staging_before, baseline["staging_dist"]):
            raise ReleaseError("root repair staging tree differs from baseline")
        if any(
            not item.get("valid") or item.get("sha256") != expected_sha
            for item in (canonical_before, current_articles_before)
        ):
            raise ReleaseError("root repair article baseline is not exact")
        if (
            not cz_before.get("valid")
            or cz_before.get("digest") != baseline.get("articles_cz", {}).get("digest")
            or cz_before.get("files") != baseline.get("articles_cz", {}).get("files")
        ):
            raise ReleaseError("root repair articles-cz baseline is not exact")
        read_verified_script(RELEASE_SCRIPT, RELEASE_SCRIPT_SHA256)
        read_verified_script(ROLLBACK_SCRIPT, ROLLBACK_SCRIPT_SHA256)

        mode_repair = repair_pinned_release_root_mode(release_root, exact_new)

        if resolved(CURRENT_LINK) != exact_new or exact_label_releases() != [exact_new]:
            raise ReleaseError("root repair current release changed after chmod")
        root_after = diagnostic_release_root(release_root)
        trust_after = trusted_closed_tree(release_root)
        release_tree_after = tree_manifest(release_root)
        staging_after = tree_manifest(DIST_DIR)
        canonical_after = article_file(CANONICAL_ARTICLES, "canonical-after-root-repair")
        current_articles_after = article_file(
            release_root / "api/articles.json", "receipt-release-after-root-repair",
        )
        cz_after = articles_cz_manifest()
        if (
            not root_after.get("valid") or root_after.get("lstat") != root_after.get("fstat")
            or root_after.get("lstat", {}).get("mode") != "0o755"
            or not trust_after.get("valid")
            or not exact_tree_contract(release_tree_after, baseline["candidate"]["target_manifest"])
            or not exact_tree_contract(staging_after, baseline["staging_dist"])
            or not exact_tree_contract(release_tree_before, release_tree_after)
            or not exact_tree_contract(staging_before, staging_after)
        ):
            raise ReleaseError("root repair tree postcondition failed")
        if any(
            not item.get("valid") or item.get("sha256") != expected_sha
            for item in (canonical_after, current_articles_after)
        ):
            raise ReleaseError("root repair article postcondition failed")
        if (
            canonical_before.get("sha256") != canonical_after.get("sha256")
            or current_articles_before.get("sha256") != current_articles_after.get("sha256")
            or not cz_after.get("valid") or cz_before.get("digest") != cz_after.get("digest")
            or cz_before.get("files") != cz_after.get("files")
        ):
            raise ReleaseError("root repair content changed during chmod")
        read_verified_script(RELEASE_SCRIPT, RELEASE_SCRIPT_SHA256)
        read_verified_script(ROLLBACK_SCRIPT, ROLLBACK_SCRIPT_SHA256)
        live = live_articles()
        if (
            not live.get("valid") or live.get("http_status") != 200
            or live.get("final_url") != PUBLIC_ARTICLES_URL or live.get("sha256") != expected_sha
        ):
            raise ReleaseError("root repair public article verification failed")
        return {
            "schema": ROOT_REPAIR_SCHEMA, "status": "release_root_repaired",
            "mode": "repair-release-root", "account": APPLY_LOGIN,
            "role": "root-release-repair", "roles": ROLES,
            "target_commit": TARGET_COMMIT, "baseline_token": baseline["baseline_token"],
            "scope": "exact-current-release-root-mode-only",
            "previous_mode": mode_repair["previous_mode"], "new_mode": mode_repair["new_mode"],
            "same_inode": mode_repair["same_inode"],
            "current_matches_receipt": True, "label_set_exact": True,
            "current_tree_exact": True, "staging_tree_exact": True,
            "content_unchanged": True,
            "articles": {
                "canonical_sha256": canonical_after["sha256"],
                "current_sha256": current_articles_after["sha256"],
                "live_sha256": live["sha256"],
                "count": live["count"], "slug_digest": live["slug_digest"],
                "http_status": live["http_status"], "exact_public_url": True,
            },
        }


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
        read_verified_script(RELEASE_SCRIPT, RELEASE_SCRIPT_SHA256)
        read_verified_script(ROLLBACK_SCRIPT, ROLLBACK_SCRIPT_SHA256)
        before_cz = articles_cz_manifest()
        if not before_cz.get("valid") or before_cz.get("digest") != baseline.get("articles_cz", {}).get("digest") or before_cz.get("files") != baseline.get("articles_cz", {}).get("files"):
            raise ReleaseError("canonical articles-cz baseline changed before rollback")
        baseline_tree = tree_manifest(Path(baseline["current_release"]))
        if not baseline_tree.get("valid") or not exact_tree_contract(baseline_tree, baseline.get("current_tree", {})):
            raise ReleaseError("exact baseline release tree changed before rollback")
        if not exact_tree_contract(tree_manifest(DIST_DIR), baseline["staging_dist"]):
            raise ReleaseError("restored staging dist changed before rollback")
        mutation_before_rollback = root_mutation_topology(exact_new, baseline["current_release"])
        if not mutation_before_rollback.get("valid") or exact_label_releases() != [exact_new]:
            raise ReleaseError("root mutation topology changed before rollback")
        trusted_root, trusted_scripts = materialize_trusted_scripts(
            bundle, baseline["baseline_token"][:16], "rollback",
        )
        try:
            rollback_receipt = run_fixed(
                trusted_scripts["server-rollback.sh"], Path(baseline["current_release"]).name, 180,
            )
            verification = verify_exact_baseline_state(baseline, require_staging=True)
            mutation_after_rollback = root_mutation_topology(baseline["current_release"], exact_new)
            if not mutation_after_rollback.get("valid") or exact_label_releases() != [exact_new]:
                raise ReleaseError("root mutation topology is unsafe after rollback")
            return {
                "schema": SCHEMA, "status": "rolled_back", "mode": "rollback", "completed_at": utc_now(),
                "account": APPLY_LOGIN, "role": "root-release-operator", "roles": ROLES,
                "target_commit": TARGET_COMMIT, "baseline_token": baseline["baseline_token"],
                "rolled_back_from": exact_new, "current_release": resolved(CURRENT_LINK), "rollback": rollback_receipt,
                "verification": verification,
            }
        finally:
            if trusted_root.exists():
                shutil.rmtree(trusted_root)


def main():
    try:
        if MODE in {"audit", "root-audit"}:
            result = audit_state(MODE)
        elif MODE == "apply" and BUNDLE_DIR is not None:
            result = apply_release(BUNDLE_DIR)
        elif MODE == "rollback" and BUNDLE_DIR is not None:
            result = rollback_release(BUNDLE_DIR)
        elif MODE == "diagnose-recovery" and BUNDLE_DIR is not None:
            result = diagnose_recovery(BUNDLE_DIR)
        elif MODE == "repair-release-root" and BUNDLE_DIR is not None:
            result = repair_release_root(BUNDLE_DIR)
        else:
            raise ReleaseError("invalid fixed mode")
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 0 if result.get("status") in {"ok", "released", "rolled_back", "diagnosed", "release_root_repaired"} else 3
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
