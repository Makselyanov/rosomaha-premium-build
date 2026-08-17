#!/usr/bin/env python3
"""Fixed receipt-bound synchronizer for Rosomaha staging ``dist``.

The default operation is a read-only audit.  Apply never builds or releases a
site: it only asks the pinned root operator to replace the mutable staging
``dist`` with an exact copy of the already-active trusted release.  A fresh,
content-bound audit receipt is mandatory.  An ambiguous apply must be handled
with ``--recover``; replaying ``--apply`` is intentionally rejected.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path, PurePosixPath
from typing import Any

import paramiko


PROJECT_ROOT = Path(__file__).resolve().parents[1]
OPERATOR_PATH = PROJECT_ROOT / "scripts/rosomaha-staging-dist-sync-operator.sh"
REPORT_ROOT = PROJECT_ROOT / "marketing-audits/releases"
TEMP_ROOT = PROJECT_ROOT / ".codex_tmp/staging-dist-sync"

SCHEMA = "rosomaha-staging-dist-sync/v1"
HOST = "90.156.168.115"
PORT = 22
AUDIT_LOGIN = "deploy"
APPLY_LOGIN = "root"
ALLOWED_LOGINS = (AUDIT_LOGIN, APPLY_LOGIN)
ROLES = {"audit": AUDIT_LOGIN, "apply": APPLY_LOGIN, "recover": APPLY_LOGIN}
EXPECTED_HOST_KEY_SHA256 = "0bcM0FC+ETPaXuICxp+1dvG5US4DAdSrrLl5H8py3BY"
EXPECTED_PUBLIC_KEY_FINGERPRINT = "SHA256:Bvnk8M0TiB4Ovg17j/WvixBPxsjeWuiN6zcfFWa40Uo"
IDENTITY_FILE = Path.home() / ".ssh/id_ed25519"

APP_ROOT = "/var/www/rosomaha"
CURRENT_LINK = f"{APP_ROOT}/current"
DIST_DIR = f"{APP_ROOT}/dist"
RELEASES_DIR = f"{APP_ROOT}/_releases"
LOCK_PATH = f"{APP_ROOT}/.rosomaha-main-price-release.lock"
CANONICAL_ARTICLES = f"{APP_ROOT}/public/api/articles.json"
ARTICLES_CZ_DIR = f"{APP_ROOT}/src/data/articles-cz"
RELEASE_SCRIPT_SHA256 = "9caad8bde40e0f269ad0887c8b16c97cfc18c0495ad72068f2c812d2859c1fa2"
ROLLBACK_SCRIPT_SHA256 = "8f2390ec2d6b3248b49ef8b690de5413bdcc7930180e584524de72094d676388"
PINNED_OPERATOR_SHA256 = "f19c0fe449e100319c6341506fce4a4a1cd5beb76afe8936d5f2492d3b29f61c"
RECOVERY_OPERATOR_COMPATIBILITY = {
    "81a8a9a2e707846752d878b1d43dea112d77e224612c6401a9cf874469adcf6d": (
        "4ff66bb7a6f5c1c826cf4d5da05337b279fc1e3e7db301528f858f996e24baaf",
        1786972429,
        "3489d74a93f1f5700a4270efea252fcd081d9bfec2c2bd4e16d81ccee83dc881",
    ),
    "54f46def8a7a424994df808b476305cd6bfb8211eb757a166a1b6d58afa6cede": (
        "cea04a069c7ebc859d964378363b0e12fc5fb1cec41d6494eb61c5a6395bf308",
        1786972483,
        "3489d74a93f1f5700a4270efea252fcd081d9bfec2c2bd4e16d81ccee83dc881",
    ),
}

MAX_OPERATOR_BYTES = 256 * 1024
MAX_RECEIPT_BYTES = 32 * 1024 * 1024
AUDIT_TTL = timedelta(minutes=30)
REMOTE_AUDIT_TIMEOUT = 240
REMOTE_APPLY_TIMEOUT = 900
TOKEN_PATTERN = re.compile(r"[0-9a-f]{64}")


class HelperError(RuntimeError):
    pass


class PinnedHostKeyPolicy(paramiko.MissingHostKeyPolicy):
    def missing_host_key(self, client: paramiko.SSHClient, hostname: str, key: paramiko.PKey) -> None:
        observed = base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode("ascii").rstrip("=")
        if hostname != HOST or observed != EXPECTED_HOST_KEY_SHA256:
            raise paramiko.SSHException("pinned SSH host-key mismatch")
        client.get_host_keys().add(hostname, key.get_name(), key)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def ensure_within(root: Path, path: Path, *, require_exists: bool = True) -> Path:
    root_resolved = root.resolve(strict=True)
    path_resolved = path.resolve(strict=require_exists)
    try:
        path_resolved.relative_to(root_resolved)
    except ValueError as exc:
        raise HelperError(f"path escapes fixed root: {path}") from exc
    return path_resolved


def safe_regular_file(path: Path, root: Path, *, max_bytes: int | None = None) -> os.stat_result:
    resolved = ensure_within(root, path)
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(resolved, flags)
    try:
        opened = os.fstat(fd)
        linked = os.lstat(resolved)
        if (
            not stat.S_ISREG(opened.st_mode) or stat.S_ISLNK(linked.st_mode)
            or opened.st_nlink != 1
            or (opened.st_dev, opened.st_ino) != (linked.st_dev, linked.st_ino)
            or (max_bytes is not None and opened.st_size > max_bytes)
        ):
            raise HelperError(f"unsafe fixed regular file: {path}")
        return opened
    finally:
        os.close(fd)


def safe_directory(path: Path, root: Path) -> Path:
    resolved = ensure_within(root, path)
    details = os.lstat(resolved)
    if not stat.S_ISDIR(details.st_mode) or stat.S_ISLNK(details.st_mode):
        raise HelperError(f"unsafe fixed directory: {path}")
    return resolved


def read_exact_regular(path: Path, root: Path, *, max_bytes: int) -> bytes:
    resolved = ensure_within(root, path)
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(resolved, flags)
    try:
        before = os.fstat(fd)
        linked_before = os.lstat(resolved)
        if (
            not stat.S_ISREG(before.st_mode) or stat.S_ISLNK(linked_before.st_mode)
            or before.st_nlink != 1
            or (before.st_dev, before.st_ino) != (linked_before.st_dev, linked_before.st_ino)
            or before.st_size > max_bytes
        ):
            raise HelperError(f"unsafe bounded regular file: {path}")
        with os.fdopen(fd, "rb", closefd=False) as handle:
            data = handle.read(max_bytes + 1)
        total = len(data)
        if total > max_bytes:
            raise HelperError(f"bounded regular file exceeds limit: {path}")
        after = os.fstat(fd)
        linked_after = os.lstat(resolved)
        path_identity_stable = (
            (linked_before.st_dev, linked_before.st_ino, linked_before.st_size, linked_before.st_mtime_ns)
            == (linked_after.st_dev, linked_after.st_ino, linked_after.st_size, linked_after.st_mtime_ns)
        )
        if (
            total != before.st_size
            or (before.st_dev, before.st_ino, before.st_size)
            != (after.st_dev, after.st_ino, after.st_size)
            or not path_identity_stable
        ):
            raise HelperError(f"bounded regular file changed during read: {path}")
        return data
    finally:
        os.close(fd)


def atomic_json_receipt(label: str, payload: dict[str, Any]) -> Path:
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    safe_directory(REPORT_ROOT, PROJECT_ROOT)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = REPORT_ROOT / f"{stamp}-{uuid.uuid4().hex[:8]}-{label}.json"
    temporary = target.with_suffix(".json.tmp")
    raw = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8") + b"\n"
    if len(raw) > MAX_RECEIPT_BYTES:
        raise HelperError("receipt exceeds fixed size limit")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    fd = os.open(temporary, flags, 0o600)
    try:
        offset = 0
        while offset < len(raw):
            written = os.write(fd, raw[offset:])
            if written <= 0:
                raise HelperError("immutable receipt write made no progress")
            offset += written
        os.fsync(fd)
    except Exception:
        try:
            os.close(fd)
        finally:
            temporary.unlink(missing_ok=True)
        raise
    finally:
        try:
            os.close(fd)
        except OSError:
            pass
    if target.exists() or target.is_symlink():
        temporary.unlink()
        raise HelperError("immutable receipt target collision")
    try:
        os.replace(temporary, target)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    return target


WINDOWS_SDDL_TRUSTEES = {"BA": "S-1-5-32-544", "SY": "S-1-5-18"}


def current_windows_sid() -> str:
    completed = subprocess.run(
        ["whoami.exe", "/user", "/fo", "csv", "/nh"],
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        timeout=15, check=False,
    )
    if completed.returncode != 0:
        raise HelperError("cannot prove the current Windows user SID")
    match = re.search(rb"S-1-[0-9]+(?:-[0-9]+)+", completed.stdout)
    if match is None:
        raise HelperError("current Windows user SID is unavailable")
    return match.group(0).decode("ascii")


def validate_saved_windows_acl(saved_acl: str, current_sid: str) -> dict[str, Any]:
    if not re.fullmatch(r"S-1-[0-9]+(?:-[0-9]+)+", current_sid):
        raise HelperError("invalid current Windows user SID")
    descriptor_lines = [line.strip() for line in saved_acl.splitlines() if re.match(r"^D:[A-Z]*(?:\(|$)", line.strip())]
    if len(descriptor_lines) != 1:
        raise HelperError("saved identity ACL has no unique DACL descriptor")
    match = re.fullmatch(r"D:([A-Z]*)(.*)", descriptor_lines[0])
    if match is None:
        raise HelperError("saved identity DACL is malformed")
    dacl_flags, ace_source = match.groups()
    if dacl_flags != "P":
        raise HelperError("pinned identity DACL must be protected from inheritance")
    ace_values = re.findall(r"\(([^()]*)\)", ace_source)
    if not ace_values or "".join(f"({value})" for value in ace_values) != ace_source:
        raise HelperError("saved identity DACL contains malformed ACE data")
    allowed_sids = {current_sid, "S-1-5-18", "S-1-5-32-544"}
    observed: list[str] = []
    for value in ace_values:
        parts = value.split(";")
        if len(parts) != 6:
            raise HelperError("saved identity DACL contains a malformed ACE")
        ace_type, ace_flags, rights, object_guid, inherit_guid, trustee = parts
        if ace_type != "A" or ace_flags or object_guid or inherit_guid or not rights:
            raise HelperError("pinned identity ACL contains inherited, denied, object, or empty access")
        normalized = WINDOWS_SDDL_TRUSTEES.get(trustee, trustee)
        if normalized not in allowed_sids:
            raise HelperError("pinned identity ACL grants an unknown or broad principal")
        observed.append(normalized)
    if len(observed) != len(set(observed)) or current_sid not in observed:
        raise HelperError("pinned identity ACL lacks a unique current-user grant")
    return {"checked": True, "platform": "windows", "dacl_protected": True, "current_user_present": True}


def windows_identity_acl(path: Path) -> dict[str, Any]:
    TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    safe_directory(TEMP_ROOT, PROJECT_ROOT)
    with tempfile.TemporaryDirectory(prefix="identity-acl-", dir=TEMP_ROOT) as raw_directory:
        directory = Path(raw_directory)
        saved_path = directory / "identity.acl"
        completed = subprocess.run(
            ["icacls.exe", str(path), "/save", str(saved_path), "/q"],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=15, check=False,
        )
        if completed.returncode != 0:
            raise HelperError("cannot prove pinned identity ACL")
        safe_regular_file(saved_path, directory, max_bytes=1024 * 1024)
        raw = saved_path.read_bytes()
        try:
            saved_acl = raw.decode("utf-16")
        except UnicodeError as exc:
            raise HelperError("saved identity ACL encoding is invalid") from exc
        return validate_saved_windows_acl(saved_acl, current_windows_sid())


def pinned_identity() -> tuple[paramiko.PKey, dict[str, Any]]:
    expected = Path.home().resolve(strict=True) / ".ssh" / "id_ed25519"
    if IDENTITY_FILE.resolve(strict=True) != expected:
        raise HelperError("pinned identity realpath mismatch")
    details = os.lstat(IDENTITY_FILE)
    if not stat.S_ISREG(details.st_mode) or stat.S_ISLNK(details.st_mode) or details.st_nlink != 1:
        raise HelperError("pinned identity file topology is unsafe")
    parent_details = os.lstat(IDENTITY_FILE.parent)
    if not stat.S_ISDIR(parent_details.st_mode) or stat.S_ISLNK(parent_details.st_mode):
        raise HelperError("pinned identity directory topology is unsafe")
    mode = stat.S_IMODE(details.st_mode)
    if os.name == "nt":
        mode_evidence = windows_identity_acl(IDENTITY_FILE)
    else:
        if mode & 0o077:
            raise HelperError("pinned identity permissions are too broad")
        mode_evidence = {"checked": True, "platform": "posix", "mode": oct(mode)}
    try:
        key = paramiko.Ed25519Key.from_private_key_file(str(IDENTITY_FILE))
    except Exception as exc:
        raise HelperError(f"pinned identity cannot be loaded: {type(exc).__name__}") from exc
    observed = "SHA256:" + base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode("ascii").rstrip("=")
    if observed != EXPECTED_PUBLIC_KEY_FINGERPRINT:
        raise HelperError("pinned SSH public-key fingerprint mismatch")
    return key, {
        "path": str(expected), "regular": True, "symlink": False, "nlink": details.st_nlink,
        "public_key_fingerprint_verified": True, "mode_evidence": mode_evidence,
    }


def connect(expected_login: str) -> tuple[paramiko.SSHClient, dict[str, Any]]:
    if expected_login not in ALLOWED_LOGINS:
        raise HelperError("unsupported pinned SSH role")
    key, evidence = pinned_identity()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(PinnedHostKeyPolicy())
    try:
        client.connect(
            hostname=HOST, port=PORT, username=expected_login, pkey=key,
            look_for_keys=False, allow_agent=False, timeout=20,
            banner_timeout=20, auth_timeout=20,
        )
        transport = client.get_transport()
        if transport is None or not transport.is_active() or transport.get_username() != expected_login:
            raise HelperError("pinned SSH role identity is not active")
        return client, {**evidence, "login": expected_login, "role_verified": True}
    except Exception:
        client.close()
        raise


def operator_bytes() -> bytes:
    safe_regular_file(OPERATOR_PATH, PROJECT_ROOT, max_bytes=MAX_OPERATOR_BYTES)
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(OPERATOR_PATH, flags)
    try:
        before = os.fstat(fd)
        linked = os.lstat(OPERATOR_PATH)
        if (
            not stat.S_ISREG(before.st_mode) or stat.S_ISLNK(linked.st_mode)
            or before.st_nlink != 1
            or (before.st_dev, before.st_ino) != (linked.st_dev, linked.st_ino)
        ):
            raise HelperError("fixed operator inode topology changed")
        raw = b""
        while len(raw) <= MAX_OPERATOR_BYTES:
            chunk = os.read(fd, min(64 * 1024, MAX_OPERATOR_BYTES + 1 - len(raw)))
            if not chunk:
                break
            raw += chunk
        after = os.fstat(fd)
        if (
            len(raw) > MAX_OPERATOR_BYTES or len(raw) != before.st_size
            or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
            != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
        ):
            raise HelperError("fixed operator changed during bounded read")
    finally:
        os.close(fd)
    required = (
        b'SCHEMA = "rosomaha-staging-dist-sync/v1"',
        b'AUDIT_LOGIN = "deploy"', b'APPLY_LOGIN = "root"',
        b'APP_ROOT = Path("/var/www/rosomaha")',
        RELEASE_SCRIPT_SHA256.encode("ascii"), ROLLBACK_SCRIPT_SHA256.encode("ascii"),
    )
    if any(marker not in raw for marker in required):
        raise HelperError("fixed operator marker is missing")
    forbidden = (b"subprocess", b"os.system", b"Popen", b"sudo", b"npm ", b"git ")
    if any(marker in raw for marker in forbidden):
        raise HelperError("fixed operator contains an unauthorized execution path")
    if sha256_bytes(raw) != PINNED_OPERATOR_SHA256:
        raise HelperError("fixed operator exact SHA-256 mismatch")
    return raw


def drain_remote_channel(channel: Any, timeout: int) -> dict[str, Any]:
    stdout = bytearray()
    stderr = bytearray()
    deadline = time.monotonic() + timeout
    while True:
        progress = False
        while channel.recv_ready():
            stdout.extend(channel.recv(65536))
            progress = True
        while channel.recv_stderr_ready():
            stderr.extend(channel.recv_stderr(65536))
            progress = True
        exit_ready = channel.exit_status_ready()
        eof = bool(getattr(channel, "eof_received", False) or getattr(channel, "closed", False))
        if exit_ready and eof and not channel.recv_ready() and not channel.recv_stderr_ready():
            break
        if time.monotonic() >= deadline:
            channel.close()
            raise HelperError("fixed remote operator timed out before full EOF")
        if not progress:
            time.sleep(0.01)
    exit_code = channel.recv_exit_status()
    channel.close()
    return {
        "exit_code": exit_code,
        "stdout": bytes(stdout).decode("utf-8", errors="replace"),
        "stderr": bytes(stderr).decode("utf-8", errors="replace"),
    }


def run_remote(client: paramiko.SSHClient, command: str, stdin_bytes: bytes, timeout: int) -> dict[str, Any]:
    transport = client.get_transport()
    if transport is None or not transport.is_active():
        raise HelperError("SSH transport is unavailable")
    channel = transport.open_session(timeout=20)
    channel.settimeout(timeout)
    channel.exec_command(command)
    channel.sendall(stdin_bytes)
    channel.shutdown_write()
    try:
        return drain_remote_channel(channel, timeout)
    except Exception:
        channel.close()
        raise


def sanitize_error(value: Any, limit: int = 700) -> str:
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", str(value or ""))
    text = re.sub(
        r"(?i)\b(authorization|token|secret|password|passwd|api[_ -]?key|private[_ -]?key)\b"
        r"(\s*[:=]\s*|\s+)(\"[^\"]*\"|'[^']*'|[^\s,;]+)",
        lambda match: f"{match.group(1)}{match.group(2)}[REDACTED]", text,
    )
    return text[-limit:]


def parse_operator_json(result: dict[str, Any]) -> dict[str, Any]:
    lines = [line.strip() for line in result.get("stdout", "").splitlines() if line.strip()]
    payload = None
    if lines:
        try:
            candidate = json.loads(lines[-1])
            if isinstance(candidate, dict):
                payload = candidate
        except json.JSONDecodeError:
            payload = None
    if payload is None:
        raise HelperError("fixed operator returned no JSON receipt")
    if result.get("exit_code") != 0 or payload.get("status") in {"blocked", "error"}:
        raise HelperError(f"fixed operator rejected operation: {sanitize_error(payload.get('error') or payload.get('blockers'))}")
    return payload


def tree_contract(value: dict[str, Any]) -> dict[str, Any]:
    return {key: value.get(key) for key in ("valid", "files", "file_count", "directory_count", "digest")}


def article_contract(value: dict[str, Any]) -> dict[str, Any]:
    return {key: value.get(key) for key in ("sha256", "bytes", "count", "unique_count", "duplicates", "slug_digest", "valid")}


def validate_manifest(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("valid") is not True:
        raise HelperError(f"remote {label} manifest is invalid")
    files = value.get("files")
    if not isinstance(files, list) or not files or len(files) > 20_000:
        raise HelperError(f"remote {label} manifest file list is invalid")
    paths: list[str] = []
    for item in files:
        if not isinstance(item, dict) or set(item) != {"path", "bytes", "sha256"}:
            raise HelperError(f"remote {label} manifest entry shape mismatch")
        path = item.get("path")
        size = item.get("bytes")
        digest = item.get("sha256")
        pure = PurePosixPath(path) if isinstance(path, str) else None
        if (
            pure is None or not path or pure.is_absolute() or pure.as_posix() != path
            or any(part in {"", ".", ".."} for part in pure.parts)
            or isinstance(size, bool) or not isinstance(size, int) or size < 0
            or not isinstance(digest, str) or not TOKEN_PATTERN.fullmatch(digest)
        ):
            raise HelperError(f"remote {label} manifest entry is invalid")
        paths.append(path)
    if paths != sorted(paths) or len(paths) != len(set(paths)):
        raise HelperError(f"remote {label} manifest paths are not sorted unique")
    expected_digest = sha256_bytes(canonical_json(files))
    if (
        value.get("file_count") != len(files)
        or isinstance(value.get("directory_count"), bool)
        or not isinstance(value.get("directory_count"), int)
        or value.get("directory_count") < 0
        or value.get("digest") != expected_digest
    ):
        raise HelperError(f"remote {label} manifest summary mismatch")
    return value


def exact_manifest_diff(current: dict[str, Any], staging: dict[str, Any]) -> dict[str, Any]:
    current_files = {item["path"]: item for item in current["files"]}
    staging_files = {item["path"]: item for item in staging["files"]}
    current_paths = set(current_files)
    staging_paths = set(staging_files)
    missing = sorted(current_paths - staging_paths)
    extra = sorted(staging_paths - current_paths)
    changed = sorted(path for path in current_paths & staging_paths if current_files[path] != staging_files[path])
    return {
        "missing_from_staging": missing, "extra_in_staging": extra, "changed": changed,
        "missing_count": len(missing), "extra_count": len(extra), "changed_count": len(changed),
        "exact": not missing and not extra and not changed,
    }


def remote_state_material(snapshot: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema": SCHEMA, "host": HOST, "roles": ROLES,
        "paths": {
            "app_root": APP_ROOT, "dist": DIST_DIR, "releases": RELEASES_DIR,
            "current": CURRENT_LINK, "canonical_articles": CANONICAL_ARTICLES,
            "articles_cz": ARTICLES_CZ_DIR, "lock": LOCK_PATH,
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


def receipt_bound_token(snapshot: dict[str, Any], audit_epoch: int) -> str:
    return sha256_bytes(canonical_json({"audit_epoch": audit_epoch, "state": remote_state_material(snapshot)}))


def validate_remote_audit(payload: dict[str, Any], *, require_fresh_epoch: bool = True) -> None:
    if (
        payload.get("schema") != SCHEMA or payload.get("host") != HOST
        or payload.get("mode") != "audit" or payload.get("account") != AUDIT_LOGIN
        or payload.get("roles") != ROLES or payload.get("status") not in {"ready", "already_synced"}
    ):
        raise HelperError("remote audit identity/schema/status mismatch")
    if payload.get("blockers") or not payload.get("article_parity"):
        raise HelperError("remote audit has unresolved blockers")
    if not payload.get("topology", {}).get("valid") or not payload.get("current_trust", {}).get("valid"):
        raise HelperError("remote current release trust/topology is not proved")
    current = validate_manifest(payload.get("current_tree"), "current release")
    staging = validate_manifest(payload.get("staging_dist"), "staging dist")
    if payload.get("manifest_diff") != exact_manifest_diff(current, staging):
        raise HelperError("remote exact manifest diff mismatch")
    current_link = payload.get("current_link", {})
    current_release = payload.get("current_release")
    if (
        not current_link.get("valid") or not current_link.get("symlink")
        or current_link.get("path") != CURRENT_LINK
        or current_link.get("link_target") != current_release
        or current_link.get("realpath") != current_release
        or not isinstance(current_release, str)
        or PurePosixPath(current_release).parent.as_posix() != RELEASES_DIR
    ):
        raise HelperError("remote current symlink is not the exact direct release target")
    article_values = [article_contract(payload.get("articles", {}).get(name, {})) for name in ("canonical", "current", "live")]
    if not all(item.get("valid") for item in article_values) or len({canonical_json(item) for item in article_values}) != 1:
        raise HelperError("remote canonical/current/live raw and slug parity mismatch")
    cz = payload.get("articles_cz", {})
    cz_files = cz.get("files")
    if (
        not cz.get("valid") or not isinstance(cz_files, list) or not cz_files
        or cz.get("count") != len(cz_files)
        or cz.get("digest") != sha256_bytes(canonical_json(cz_files))
    ):
        raise HelperError("remote articles-cz exact manifest mismatch")
    lock = payload.get("lock", {})
    if (
        not lock.get("valid") or lock.get("path") != LOCK_PATH
        or lock.get("nlink") != 1 or lock.get("uid") != 0 or lock.get("gid") not in {0, 33}
        or lock.get("mode") != oct(0o600)
        or isinstance(lock.get("dev"), bool) or not isinstance(lock.get("dev"), int)
        or isinstance(lock.get("ino"), bool) or not isinstance(lock.get("ino"), int)
    ):
        raise HelperError("remote existing shared lock topology mismatch")
    audit_epoch = payload.get("audit_epoch")
    if (
        isinstance(audit_epoch, bool) or not isinstance(audit_epoch, int)
        or not re.fullmatch(r"[0-9]{10}", str(audit_epoch))
        or audit_epoch > int(time.time()) + 60
        or (
            require_fresh_epoch
            and int(time.time()) - audit_epoch > int(AUDIT_TTL.total_seconds())
        )
    ):
        raise HelperError("remote receipt-bound audit epoch is invalid")
    if payload.get("baseline_token") != receipt_bound_token(payload, audit_epoch):
        raise HelperError("remote audit baseline token mismatch")
    if payload.get("status") == "ready" and payload.get("manifest_diff", {}).get("exact"):
        raise HelperError("remote audit ready status contradicts exact manifests")
    if payload.get("status") == "already_synced" and not payload.get("manifest_diff", {}).get("exact"):
        raise HelperError("remote audit synced status contradicts manifest diff")
    if payload.get("release_scripts", {}).get("server-release.sh", {}).get("sha256") != RELEASE_SCRIPT_SHA256:
        raise HelperError("remote server-release hash mismatch")
    if payload.get("release_scripts", {}).get("server-rollback.sh", {}).get("sha256") != ROLLBACK_SCRIPT_SHA256:
        raise HelperError("remote server-rollback hash mismatch")


def receipt_material(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if key != "receipt_token"}


def exact_recovery_operator_compatibility(payload: dict[str, Any]) -> bool:
    expected = RECOVERY_OPERATOR_COMPATIBILITY.get(payload.get("receipt_token"))
    observed = (
        payload.get("baseline_token"),
        payload.get("audit_epoch"),
        payload.get("operator_sha256"),
    )
    return expected is not None and observed == expected


def audit() -> tuple[dict[str, Any], Path]:
    frozen_operator = operator_bytes()
    client, identity = connect(AUDIT_LOGIN)
    try:
        result = run_remote(client, "/bin/bash -s -- audit", frozen_operator, REMOTE_AUDIT_TIMEOUT)
        remote = parse_operator_json(result)
    finally:
        client.close()
    validate_remote_audit(remote)
    captured = datetime.fromtimestamp(remote["audit_epoch"], tz=timezone.utc)
    payload = {
        "schema": SCHEMA, "status": remote["status"], "mode": "baseline",
        "captured_at": captured.isoformat(), "expires_at": (captured + AUDIT_TTL).isoformat(),
        "host": HOST, "roles": ROLES, "account": AUDIT_LOGIN,
        "operator_sha256": sha256_bytes(frozen_operator), "audit_identity": identity,
        "baseline_token": remote["baseline_token"], "audit_epoch": remote["audit_epoch"], "server": remote,
    }
    payload["receipt_token"] = sha256_bytes(canonical_json(receipt_material(payload)))
    return payload, atomic_json_receipt("rosomaha-staging-dist-baseline", payload)


def safe_baseline_path(path: Path) -> Path:
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    safe_directory(REPORT_ROOT, PROJECT_ROOT)
    resolved = ensure_within(REPORT_ROOT, path)
    safe_regular_file(resolved, REPORT_ROOT, max_bytes=MAX_RECEIPT_BYTES)
    if not resolved.name.endswith("-rosomaha-staging-dist-baseline.json"):
        raise HelperError("baseline receipt filename is not fixed")
    return resolved


def parse_utc(value: Any, field: str) -> datetime:
    if not isinstance(value, str):
        raise HelperError(f"baseline {field} is missing")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise HelperError(f"baseline {field} is invalid") from exc
    if parsed.tzinfo is None:
        raise HelperError(f"baseline {field} has no timezone")
    return parsed.astimezone(timezone.utc)


def load_baseline(
    path: Path, *, require_fresh: bool, allow_recovery_operator_compatibility: bool = False
) -> tuple[dict[str, Any], Path, bytes]:
    resolved = safe_baseline_path(path)
    last_error: HelperError | None = None
    raw: bytes | None = None
    for attempt in range(3):
        try:
            raw = read_exact_regular(resolved, REPORT_ROOT, max_bytes=MAX_RECEIPT_BYTES)
            break
        except HelperError as exc:
            if "bounded regular file changed during read" not in str(exc) or attempt == 2:
                raise
            last_error = exc
            time.sleep(0.2)
    if raw is None:
        raise last_error or HelperError("baseline receipt could not be read safely")
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise HelperError("baseline receipt is not valid UTF-8 JSON") from exc
    if (
        not isinstance(payload, dict) or payload.get("schema") != SCHEMA
        or payload.get("mode") != "baseline" or payload.get("status") not in {"ready", "already_synced"}
        or payload.get("host") != HOST or payload.get("roles") != ROLES or payload.get("account") != AUDIT_LOGIN
    ):
        raise HelperError("baseline receipt identity/schema/status mismatch")
    if payload.get("receipt_token") != sha256_bytes(canonical_json(receipt_material(payload))):
        raise HelperError("baseline receipt content token mismatch")
    frozen_operator = operator_bytes()
    if (
        payload.get("operator_sha256") != sha256_bytes(frozen_operator)
        and not (
            allow_recovery_operator_compatibility
            and exact_recovery_operator_compatibility(payload)
        )
    ):
        raise HelperError("fixed operator changed after audit")
    server = payload.get("server")
    if not isinstance(server, dict):
        raise HelperError("baseline server payload is missing")
    validate_remote_audit(server, require_fresh_epoch=require_fresh)
    if payload.get("baseline_token") != server.get("baseline_token") or payload.get("status") != server.get("status"):
        raise HelperError("baseline wrapper/server binding mismatch")
    if payload.get("audit_epoch") != server.get("audit_epoch"):
        raise HelperError("baseline wrapper/server audit epoch mismatch")
    captured = parse_utc(payload.get("captured_at"), "captured_at")
    expires = parse_utc(payload.get("expires_at"), "expires_at")
    if expires - captured != AUDIT_TTL:
        raise HelperError("baseline receipt TTL is not fixed")
    now = datetime.now(timezone.utc)
    if captured > now + timedelta(minutes=1):
        raise HelperError("baseline receipt timestamp is in the future")
    if require_fresh and now > expires:
        raise HelperError("baseline receipt expired; run a new read-only audit")
    return payload, resolved, frozen_operator


def invoke_bound_operation(mode: str, baseline_path: Path) -> tuple[dict[str, Any], Path]:
    if mode not in {"apply", "recover"}:
        raise HelperError("unsupported bound operation")
    baseline, _, frozen_operator = load_baseline(
        baseline_path,
        require_fresh=mode == "apply",
        allow_recovery_operator_compatibility=mode == "recover",
    )
    if mode == "apply" and baseline.get("status") != "ready":
        raise HelperError("baseline is already synchronized; apply replay is forbidden")
    token = baseline.get("baseline_token")
    if not isinstance(token, str) or not TOKEN_PATTERN.fullmatch(token):
        raise HelperError("baseline token is invalid")
    audit_epoch = baseline.get("audit_epoch")
    if isinstance(audit_epoch, bool) or not isinstance(audit_epoch, int) or not re.fullmatch(r"[0-9]{10}", str(audit_epoch)):
        raise HelperError("baseline audit epoch is invalid")
    client, identity = connect(APPLY_LOGIN)
    try:
        command = f"/bin/bash -s -- {mode} {token} {audit_epoch}"
        result = run_remote(client, command, frozen_operator, REMOTE_APPLY_TIMEOUT)
        remote = parse_operator_json(result)
    except Exception as exc:
        if mode == "apply":
            raise HelperError(
                "apply outcome is not safely replayable; do not rerun --apply. "
                f"Run --recover with the same receipt. Cause: {type(exc).__name__}: {sanitize_error(exc)}"
            ) from exc
        raise
    finally:
        client.close()
    expected_statuses = {"synced_verified"} if mode == "apply" else {"recovered_verified_success", "recovered_verified_baseline"}
    if (
        remote.get("schema") != SCHEMA or remote.get("mode") != mode
        or remote.get("status") not in expected_statuses or remote.get("baseline_token") != token
        or remote.get("account") != APPLY_LOGIN or remote.get("roles") != ROLES
    ):
        raise HelperError("remote bound-operation receipt mismatch")
    if mode == "apply":
        before = remote.get("before", {})
        after = remote.get("after", {})
        backup = remote.get("backup", {})
        expected_state_root = f"{APP_ROOT}/.staging-dist-sync-state-{token[:16]}"
        if (
            not after.get("exact") or not after.get("article_parity")
            or before.get("staging_digest") == before.get("current_digest")
            or before.get("staging_digest") != baseline.get("server", {}).get("staging_dist", {}).get("digest")
            or before.get("current_digest") != baseline.get("server", {}).get("current_tree", {}).get("digest")
            or before.get("manifest_diff") != baseline.get("server", {}).get("manifest_diff")
            or after.get("staging_digest") != before.get("current_digest")
            or after.get("current_digest") != before.get("current_digest")
            or backup.get("digest") != before.get("staging_digest")
            or backup.get("private_parent") != expected_state_root
            or backup.get("private_parent_mode") != oct(0o700)
            or remote.get("current_release") != baseline.get("server", {}).get("current_release")
            or after.get("articles_cz_digest") != baseline.get("server", {}).get("articles_cz", {}).get("digest")
        ):
            raise HelperError("apply receipt lacks exact manifest/article postread")
        if (
            not remote.get("current_symlink_unchanged")
            or not remote.get("release_tree_unchanged")
            or not remote.get("shared_lock_unchanged")
        ):
            raise HelperError("apply receipt reports protected current state drift")
    else:
        postread = remote.get("postread", {})
        if (
            not postread.get("article_parity")
            or not postread.get("shared_lock_unchanged")
            or postread.get("current_release") != baseline.get("server", {}).get("current_release")
            or postread.get("current_digest") != baseline.get("server", {}).get("current_tree", {}).get("digest")
            or postread.get("articles_cz_digest") != baseline.get("server", {}).get("articles_cz", {}).get("digest")
            or (
                remote.get("status") == "recovered_verified_success"
                and (not postread.get("exact") or postread.get("staging_digest") != postread.get("current_digest"))
            )
            or (
                remote.get("status") == "recovered_verified_baseline"
                and (
                    not postread.get("baseline_restored")
                    or postread.get("staging_digest") != baseline.get("server", {}).get("staging_dist", {}).get("digest")
                )
            )
        ):
            raise HelperError("recovery receipt lacks exact receipt-bound postread")
    payload = {
        "schema": SCHEMA, "status": remote["status"], "mode": mode,
        "completed_at": utc_now(), "host": HOST, "roles": ROLES,
        "baseline_token": token, "baseline_receipt_token": baseline["receipt_token"],
        "operator_sha256": sha256_bytes(frozen_operator),
        "baseline_operator_sha256": baseline["operator_sha256"], "apply_identity": identity,
        "server": remote,
    }
    payload["receipt_token"] = sha256_bytes(canonical_json(receipt_material(payload)))
    label = "rosomaha-staging-dist-apply" if mode == "apply" else "rosomaha-staging-dist-recovery"
    return payload, atomic_json_receipt(label, payload)


def argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Fixed Rosomaha staging-dist synchronizer")
    operation = parser.add_mutually_exclusive_group()
    operation.add_argument("--apply", action="store_true", help="sync only from a fresh fixed audit receipt")
    operation.add_argument("--recover", action="store_true", help="classify/recover one receipt-bound ambiguous apply")
    parser.add_argument("--baseline", type=Path, help="exact audit receipt required for apply/recover")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = argument_parser().parse_args(argv)
    try:
        if args.apply or args.recover:
            if args.baseline is None:
                raise HelperError("--apply/--recover requires --baseline <fixed audit receipt>")
            payload, receipt = invoke_bound_operation("apply" if args.apply else "recover", args.baseline)
            print(json.dumps({"status": payload["status"], "receipt": str(receipt)}, ensure_ascii=False))
            return 0
        if args.baseline is not None:
            raise HelperError("--baseline is accepted only with --apply or --recover")
        payload, receipt = audit()
        print(json.dumps({"status": payload["status"], "receipt": str(receipt)}, ensure_ascii=False))
        return 0
    except Exception as exc:
        error = {
            "schema": SCHEMA, "status": "error", "mode": "apply" if args.apply else ("recover" if args.recover else "audit"),
            "host": HOST, "roles": ROLES, "error_type": type(exc).__name__, "error": sanitize_error(exc),
        }
        try:
            receipt = atomic_json_receipt("rosomaha-staging-dist-error", error)
            receipt_value = str(receipt)
        except Exception:
            receipt_value = "unavailable"
        print(json.dumps({"status": "error", "error": error["error"], "receipt": receipt_value}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
