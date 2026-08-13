#!/usr/bin/env python3
"""Audit and migrate the exact Rosomaha release/rollback script pair.

Default mode gathers deploy/SFTP/public evidence followed by a fresh root-only
read-only preflight.  Mutation requires one pinned Git commit, an immutable
old/old baseline and the fixed root operator.
Neither the client nor the remote operator executes either installed script.
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
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

import paramiko


PROJECT_ROOT = Path(__file__).resolve().parents[1]
OPERATOR_PATH = PROJECT_ROOT / "scripts/rosomaha-release-script-installer-operator.sh"
REPORT_ROOT = PROJECT_ROOT / "marketing-audits/release-script-installer"

SCHEMA = "rosomaha-release-script-pair-installer/v2"
BASELINE_SCHEMA = "rosomaha-release-script-pair-installer-baseline/v3"
ROLLBACK_AUTH_SCHEMA = "rosomaha-release-script-pair-rollback-authorization/v1"
TARGET_COMMIT = "29f90f1ea2b5b90156fd677ca624c5bd7b2d1529"
PAIR_SPECS = {
    "release": {
        "path": "scripts/server-release.sh",
        "name": "server-release.sh",
        "remote": "/var/www/rosomaha/scripts/server-release.sh",
        "mode": "100755",
        "old_sha256": "c25fc273a4cf88a27879207aaebf18be62f4487867a7de7674c611b400919edd",
        "new_sha256": "9caad8bde40e0f269ad0887c8b16c97cfc18c0495ad72068f2c812d2859c1fa2",
    },
    "rollback": {
        "path": "scripts/server-rollback.sh",
        "name": "server-rollback.sh",
        "remote": "/var/www/rosomaha/scripts/server-rollback.sh",
        "mode": "100755",
        "old_sha256": "aeee52f314036112501a7acc0af5fa09ee7c081327fb867b91c64b983bd41acc",
        "new_sha256": "8f2390ec2d6b3248b49ef8b690de5413bdcc7930180e584524de72094d676388",
    },
}
OPERATOR_SHA256 = "9b3ba9b530b411c785d445c57955efcc58c0f74d8d70fcf0ba1ad84fc226ffb7"
MIGRATION_COVERAGE = "migration_window_bounded_then_all_compliant_pair_installed"
TOPOLOGY_FIELDS = frozenset({
    "uid", "gid", "mode", "nlink", "dev", "ino", "same_inode",
})
TOPOLOGY_CONTEXTS = frozenset({
    "canonical-article", "runtime-article", "articles-cz-directory",
    "articles-cz-file",
})
ROOT_AUDIT_SCOPE = {
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

HOST = "90.156.168.115"
PORT = 22
AUDIT_LOGIN = "deploy"
APPLY_LOGIN = "root"
EXPECTED_HOST_KEY_SHA256 = "0bcM0FC+ETPaXuICxp+1dvG5US4DAdSrrLl5H8py3BY"
EXPECTED_PUBLIC_KEY_FINGERPRINT = "SHA256:Bvnk8M0TiB4Ovg17j/WvixBPxsjeWuiN6zcfFWa40Uo"
IDENTITY_FILE = Path.home() / ".ssh/id_ed25519"
BASE_URL = "https://xn--80aa8ahaki9a.site"
PUBLIC_ARTICLES_URL = f"{BASE_URL}/api/articles.json"
KEY_PUBLIC_PATHS = ("/", "/catalog", "/articles", "/robots.txt", "/sitemap.xml")
MAX_SCRIPT_BYTES = 256 * 1024
MAX_OPERATOR_BYTES = 512 * 1024
MAX_REMOTE_OUTPUT = 512 * 1024
MAX_RECEIPT_BYTES = 1024 * 1024
MAX_HTTP_BYTES = 25 * 1024 * 1024
MAX_PAGE_BYTES = 2 * 1024 * 1024
REMOTE_BUNDLE_RE = re.compile(r"/tmp/rosomaha-release-pair-installer-29f90f1-[0-9a-f]{16}")
REMOTE_BUNDLE_FILES = {
    "baseline.json", "operator.sh", "server-release.sh", "server-rollback.sh",
    "apply-attempt.json", "operation-receipt.json", "rollback-authorization.json",
    "rollback-attempt.json", "rollback-receipt.json",
}


class InstallerError(RuntimeError):
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


def reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise InstallerError("JSON contains duplicate fields")
        result[key] = value
    return result


def sanitized_error(value: Any, limit: int = 400) -> str:
    text = " ".join(str(value or "").split())
    text = re.sub(
        r"(?i)(authorization|token|secret|password|passwd|api[_ -]?key|private[_ -]?key)"
        r"(\s*[:=]\s*|\s+)(\"[^\"]*\"|'[^']*'|[^\s,;]+)",
        lambda match: f"{match.group(1)}{match.group(2)}[REDACTED]",
        text,
    )
    text = re.sub(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{8,}", "Bearer [REDACTED]", text)
    return text[-limit:] or "unspecified error"


def safe_local_file(path: Path, root: Path, *, maximum: int) -> bytes:
    resolved_root = root.resolve(strict=True)
    resolved = path.resolve(strict=True)
    try:
        resolved.relative_to(resolved_root)
    except ValueError as exc:
        raise InstallerError("local file escapes its fixed root") from exc
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        before = os.fstat(fd)
        linked = os.lstat(path)
        if (
            not stat.S_ISREG(before.st_mode)
            or stat.S_ISLNK(linked.st_mode)
            or before.st_nlink != 1
            or (before.st_dev, before.st_ino) != (linked.st_dev, linked.st_ino)
            or not 0 < before.st_size <= maximum
        ):
            raise InstallerError("local file topology is unsafe")
        raw = b""
        while len(raw) <= maximum:
            chunk = os.read(fd, min(64 * 1024, maximum + 1 - len(raw)))
            if not chunk:
                break
            raw += chunk
        after = os.fstat(fd)
        if len(raw) > maximum or (
            before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns
        ) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
            raise InstallerError("local file changed during read")
        return raw
    finally:
        os.close(fd)


def write_receipt(prefix: str, payload: dict[str, Any]) -> Path:
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    path = REPORT_ROOT / f"{stamp}-{prefix}.json"
    raw = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8") + b"\n"
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        view = memoryview(raw)
        while view:
            count = os.write(fd, view)
            if count <= 0:
                raise InstallerError("local receipt write did not progress")
            view = view[count:]
        os.fsync(fd)
    finally:
        os.close(fd)
    return path


def run_git(args: list[str], *, maximum: int = MAX_SCRIPT_BYTES) -> bytes:
    completed = subprocess.run(
        ["git", *args], cwd=PROJECT_ROOT, stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=False,
    )
    if completed.returncode != 0:
        raise InstallerError(f"fixed Git proof failed: {sanitized_error(completed.stderr.decode('utf-8', 'replace'))}")
    if len(completed.stdout) > maximum:
        raise InstallerError("fixed Git output exceeds size limit")
    return completed.stdout


def target_blobs() -> dict[str, bytes]:
    run_git(["merge-base", "--is-ancestor", TARGET_COMMIT, "HEAD"], maximum=1)
    blobs: dict[str, bytes] = {}
    for key, spec in PAIR_SPECS.items():
        tree = run_git(["ls-tree", TARGET_COMMIT, "--", spec["path"]], maximum=1024).decode("utf-8", "strict")
        if not re.fullmatch(rf"{spec['mode']} blob [0-9a-f]{{40}}\t{re.escape(spec['path'])}\n", tree):
            raise InstallerError(f"pinned Git mode/path mismatch: {key}")
        raw = run_git(["show", f"{TARGET_COMMIT}:{spec['path']}"])
        if not raw or sha256_bytes(raw) != spec["new_sha256"]:
            raise InstallerError(f"pinned Git blob SHA-256 mismatch: {key}")
        blobs[key] = raw
    return blobs


def operator_bytes() -> bytes:
    raw = safe_local_file(OPERATOR_PATH, PROJECT_ROOT, maximum=MAX_OPERATOR_BYTES)
    if sha256_bytes(raw) != OPERATOR_SHA256:
        raise InstallerError("fixed pair-installer operator SHA-256 mismatch")
    markers = (
        SCHEMA.encode("ascii"), TARGET_COMMIT.encode("ascii"),
        PAIR_SPECS["release"]["new_sha256"].encode("ascii"),
        PAIR_SPECS["rollback"]["new_sha256"].encode("ascii"),
        b"freeze_old_executables", b"scan_legacy_script_processes",
        MIGRATION_COVERAGE.encode("ascii"), b"installed_scripts_executed",
        b"root-audit", b"root_preflight",
    )
    if any(marker not in raw for marker in markers):
        raise InstallerError("fixed pair-installer operator marker is missing")
    return raw


def pinned_identity() -> paramiko.PKey:
    expected = Path.home().resolve(strict=True) / ".ssh" / "id_ed25519"
    if IDENTITY_FILE.resolve(strict=True) != expected:
        raise InstallerError("pinned identity realpath mismatch")
    details = os.lstat(IDENTITY_FILE)
    if not stat.S_ISREG(details.st_mode) or stat.S_ISLNK(details.st_mode) or details.st_nlink != 1:
        raise InstallerError("pinned identity topology is unsafe")
    try:
        key = paramiko.Ed25519Key.from_private_key_file(str(IDENTITY_FILE))
    except Exception as exc:
        raise InstallerError(f"pinned identity cannot be loaded: {type(exc).__name__}") from exc
    observed = "SHA256:" + base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode("ascii").rstrip("=")
    if observed != EXPECTED_PUBLIC_KEY_FINGERPRINT:
        raise InstallerError("pinned SSH public-key fingerprint mismatch")
    return key


def connect(login: str) -> paramiko.SSHClient:
    if login not in {AUDIT_LOGIN, APPLY_LOGIN}:
        raise InstallerError("unsupported pinned SSH role")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(PinnedHostKeyPolicy())
    try:
        client.connect(
            hostname=HOST, port=PORT, username=login, pkey=pinned_identity(),
            look_for_keys=False, allow_agent=False, timeout=20,
            banner_timeout=20, auth_timeout=20,
        )
        transport = client.get_transport()
        if transport is None or not transport.is_active() or transport.get_username() != login:
            raise InstallerError("pinned SSH role identity is not active")
        return client
    except Exception:
        client.close()
        raise


def drain_channel(channel: Any, timeout: int) -> dict[str, Any]:
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
        if len(stdout) > MAX_REMOTE_OUTPUT or len(stderr) > MAX_REMOTE_OUTPUT:
            channel.close()
            raise InstallerError("fixed remote output exceeds size limit")
        ready = channel.exit_status_ready()
        eof = bool(getattr(channel, "eof_received", False) or getattr(channel, "closed", False))
        if ready and eof and not channel.recv_ready() and not channel.recv_stderr_ready():
            break
        if time.monotonic() >= deadline:
            channel.close()
            raise InstallerError("fixed remote operator timed out")
        if not progress:
            time.sleep(0.01)
    code = channel.recv_exit_status()
    channel.close()
    return {
        "exit_code": code,
        "stdout": bytes(stdout).decode("utf-8", "replace"),
        "stderr": bytes(stderr).decode("utf-8", "replace"),
    }


def run_remote(client: paramiko.SSHClient, command: str, stdin: bytes, timeout: int = 240) -> dict[str, Any]:
    allowed = command in {"/bin/bash -s -- audit", "/bin/bash -s -- root-audit"}
    if not allowed:
        for mode in ("apply", "recover", "rollback"):
            prefix = f"/bin/bash -s -- {mode} "
            if command.startswith(prefix) and REMOTE_BUNDLE_RE.fullmatch(command[len(prefix):]):
                allowed = True
                break
    if not allowed:
        raise InstallerError("refusing a non-fixed remote command")
    transport = client.get_transport()
    if transport is None or not transport.is_active():
        raise InstallerError("SSH transport is unavailable")
    channel = transport.open_session(timeout=20)
    channel.settimeout(timeout)
    channel.exec_command(command)
    channel.sendall(stdin)
    channel.shutdown_write()
    return drain_channel(channel, timeout)


def parse_operator(result: dict[str, Any]) -> dict[str, Any]:
    try:
        payload = json.loads(str(result.get("stdout", "")).strip(), object_pairs_hook=reject_duplicates)
    except (json.JSONDecodeError, InstallerError) as exc:
        raise InstallerError(
            f"fixed operator returned invalid JSON; stderr={sanitized_error(result.get('stderr'))}"
        ) from exc
    if not isinstance(payload, dict) or payload.get("schema") != SCHEMA:
        raise InstallerError("fixed operator schema mismatch")
    if result.get("exit_code") != 0 or payload.get("status") == "error":
        raise InstallerError(
            f"fixed operator failed: {sanitized_error(payload.get('error'))}; "
            f"stderr={sanitized_error(result.get('stderr'))}"
        )
    return payload


def invoke(client: paramiko.SSHClient, mode: str, operator: bytes, remote_dir: str | None = None) -> dict[str, Any]:
    if mode in {"audit", "root-audit"} and remote_dir is None:
        command = f"/bin/bash -s -- {mode}"
    elif mode in {"apply", "recover", "rollback"} and remote_dir and REMOTE_BUNDLE_RE.fullmatch(remote_dir):
        command = f"/bin/bash -s -- {mode} {remote_dir}"
    else:
        raise InstallerError("invalid fixed operator invocation")
    return parse_operator(run_remote(client, command, operator))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        return None


def http_bytes(url: str, maximum: int) -> tuple[bytes, dict[str, Any]]:
    opener = urllib.request.build_opener(NoRedirect())
    request = urllib.request.Request(url, headers={"User-Agent": "RosomahaReleasePairInstaller/2.0"})
    try:
        with opener.open(request, timeout=60) as response:
            status_code = int(response.status)
            final_url = response.geturl()
            raw = response.read(maximum + 1)
    except urllib.error.HTTPError as exc:
        raise InstallerError(f"public HTTP status is not 200 for {url}: {exc.code}") from exc
    if status_code != 200 or final_url != url or not raw or len(raw) > maximum:
        raise InstallerError(f"public HTTP contract failed for {url}")
    return raw, {
        "status": status_code, "final_url": final_url, "bytes": len(raw),
        "raw_sha256": sha256_bytes(raw),
    }


def article_summary(raw: bytes, source: str) -> dict[str, Any]:
    try:
        payload = json.loads(raw.decode("utf-8-sig"), object_pairs_hook=reject_duplicates)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise InstallerError(f"article export is invalid: {source}") from exc
    if not isinstance(payload, list):
        raise InstallerError(f"article export is not an array: {source}")
    slugs = []
    for item in payload:
        if not isinstance(item, dict) or not isinstance(item.get("slug"), str):
            raise InstallerError(f"article export has invalid slug: {source}")
        slug = item["slug"].strip()
        if not slug or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,199}", slug):
            raise InstallerError(f"article export has unsafe slug: {source}")
        slugs.append(slug)
    if len(slugs) != len(set(slugs)):
        raise InstallerError(f"article export has duplicate slugs: {source}")
    return {
        "source": source, "raw_sha256": sha256_bytes(raw), "bytes": len(raw),
        "count": len(slugs), "slug_digest": sha256_bytes(canonical_json(sorted(slugs))),
    }


def independent_public_snapshot() -> dict[str, Any]:
    pages = {}
    for public_path in KEY_PUBLIC_PATHS:
        _raw, evidence = http_bytes(BASE_URL + public_path, MAX_PAGE_BYTES)
        pages[public_path] = evidence
    live_raw, live_http = http_bytes(PUBLIC_ARTICLES_URL, MAX_HTTP_BYTES)
    return {
        "pages": pages,
        "live_articles": {**article_summary(live_raw, "live"), **live_http},
    }


def valid_digest(value: Any) -> bool:
    return bool(re.fullmatch(r"[0-9a-f]{64}", str(value)))


def validate_topology(
    item: Any, *, uid: int, gid: int | None, mode: str | None,
    non_022: bool, context: str, nlink: int | None = 1,
) -> None:
    if context not in TOPOLOGY_CONTEXTS:
        raise InstallerError("file topology diagnostic context is invalid")
    fields = set(item) if isinstance(item, dict) else set()
    missing = sorted(TOPOLOGY_FIELDS - fields)
    unexpected_count = len(fields - TOPOLOGY_FIELDS)
    if not isinstance(item, dict) or missing or unexpected_count:
        missing_text = ",".join(missing) if missing else "none"
        raise InstallerError(
            "file topology evidence fields mismatch: "
            f"context={context} missing={missing_text} "
            f"unexpected_count={unexpected_count}"
        )
    if (
        item.get("uid") != uid
        or (gid is not None and item.get("gid") != gid)
        or not isinstance(item.get("nlink"), int)
        or item["nlink"] < 1
        or (nlink is not None and item["nlink"] != nlink)
    ):
        raise InstallerError("file topology owner/link evidence is not exact")
    if mode is not None and item.get("mode") != mode:
        raise InstallerError("file topology mode is not exact")
    try:
        numeric_mode = int(str(item.get("mode")), 8)
    except ValueError as exc:
        raise InstallerError("file topology mode is invalid") from exc
    if non_022 and numeric_mode & 0o022:
        raise InstallerError("runtime article file is group/world writable")
    if item.get("same_inode") is not True:
        raise InstallerError("file topology inode binding is not exact")


def validate_public_pages(pages: Any) -> None:
    if not isinstance(pages, dict) or set(pages) != set(KEY_PUBLIC_PATHS):
        raise InstallerError("public-page evidence is not exact")
    for public_path, item in pages.items():
        if (
            not isinstance(item, dict)
            or set(item) != {"status", "final_url", "bytes", "raw_sha256"}
            or item.get("status") != 200
            or item.get("final_url") != BASE_URL + public_path
            or not isinstance(item.get("bytes"), int)
            or item.get("bytes", 0) <= 0
            or not valid_digest(item.get("raw_sha256"))
        ):
            raise InstallerError("public-page evidence is invalid")


def validate_article(item: Any, source: str, *, topology_kind: str | None, live: bool = False) -> None:
    expected = {"source", "raw_sha256", "bytes", "count", "slug_digest"}
    if topology_kind:
        expected.add("topology")
    if live:
        expected |= {"status", "final_url"}
    if (
        not isinstance(item, dict)
        or set(item) != expected
        or item.get("source") != source
        or not valid_digest(item.get("raw_sha256"))
        or not valid_digest(item.get("slug_digest"))
        or not isinstance(item.get("bytes"), int)
        or item.get("bytes", 0) <= 0
        or not isinstance(item.get("count"), int)
        or item.get("count", 0) <= 0
    ):
        raise InstallerError("article evidence is invalid")
    if topology_kind == "canonical":
        validate_topology(
            item["topology"], uid=0, gid=33, mode="0o664", non_022=False,
            context="canonical-article",
        )
    elif topology_kind == "runtime":
        validate_topology(
            item["topology"], uid=0, gid=None, mode=None, non_022=True,
            context="runtime-article",
        )
    if live and (item.get("status") != 200 or item.get("final_url") != PUBLIC_ARTICLES_URL):
        raise InstallerError("live article HTTP evidence is invalid")


def validate_pair(pair: Any) -> None:
    if (
        not isinstance(pair, dict)
        or set(pair) != {"valid", "pair_state", "members", "trusted_ancestors"}
        or pair.get("pair_state") not in {"old/old", "new/new", "mixed", "unknown"}
        or not isinstance(pair.get("members"), dict)
        or set(pair["members"]) != set(PAIR_SPECS)
    ):
        raise InstallerError("pair evidence is not exact")
    states = []
    for key, spec in PAIR_SPECS.items():
        item = pair["members"][key]
        if not isinstance(item, dict) or item.get("state") not in {"old", "new", "unknown"}:
            raise InstallerError("pair member evidence is invalid")
        if item.get("valid") is True:
            if set(item) != {
                "valid", "state", "sha256", "size", "uid", "gid", "mode", "nlink",
                "dev", "ino",
            }:
                raise InstallerError("pair member fields are not exact")
            expected = spec["old_sha256"] if item["state"] == "old" else spec["new_sha256"] if item["state"] == "new" else None
            if (
                expected is None
                or item.get("sha256") != expected
                or not isinstance(item.get("size"), int)
                or not 0 < item["size"] <= MAX_SCRIPT_BYTES
                or item.get("uid") != 0
                or item.get("gid") != 0
                or item.get("mode") != "0o755"
                or item.get("nlink") != 1
            ):
                raise InstallerError("pair member topology/hash is invalid")
            states.append(item["state"])
        else:
            if (
                set(item) != {"valid", "state", "error"}
                or item.get("valid") is not False
                or item.get("state") != "unknown"
                or not isinstance(item.get("error"), str)
                or not item["error"]
                or len(item["error"]) > 300
            ):
                raise InstallerError("unknown pair member evidence is not exact")
            states.append("unknown")
    calculated = (
        "old/old" if states == ["old", "old"] else
        "new/new" if states == ["new", "new"] else
        "mixed" if set(states) == {"old", "new"} else "unknown"
    )
    if pair["pair_state"] != calculated or pair.get("valid") is not all(state != "unknown" for state in states):
        raise InstallerError("pair classification is inconsistent")
    ancestors = pair.get("trusted_ancestors")
    if not isinstance(ancestors, dict) or set(ancestors) != {"root", "var", "var-www", "application", "scripts"}:
        raise InstallerError("pair ancestor evidence is invalid")
    for label, item in ancestors.items():
        if (
            not isinstance(item, dict)
            or set(item) != {"uid", "gid", "mode", "nlink", "dev", "ino", "same_inode"}
            or item.get("uid") != 0
            or item.get("same_inode") is not True
        ):
            raise InstallerError(f"{label} ancestor evidence is not exact")
        try:
            ancestor_mode = int(str(item.get("mode")), 8)
        except ValueError as exc:
            raise InstallerError(f"{label} ancestor mode is invalid") from exc
        if label in {"root", "var", "var-www"} and (item.get("gid") != 0 or ancestor_mode & 0o022):
            raise InstallerError(f"{label} ancestor permissions are unsafe")
    if ancestors["application"].get("mode") != "0o3775" or ancestors["application"].get("uid") != 0 or ancestors["application"].get("gid") != 33:
        raise InstallerError("application ancestor topology is not exact")
    if ancestors["scripts"].get("mode") != "0o775" or ancestors["scripts"].get("uid") != 0 or ancestors["scripts"].get("gid") != 0:
        raise InstallerError("scripts ancestor topology is not exact")
    if any(item.get("same_inode") is not True for item in ancestors.values()):
        raise InstallerError("ancestor inode evidence is not exact")


def validate_seo_snapshot(snapshot: Any) -> None:
    if not isinstance(snapshot, dict) or set(snapshot) != {
        "current", "articles", "article_parity", "articles_cz", "release_labels",
    }:
        raise InstallerError("SEO snapshot fields are not exact")
    current = snapshot["current"]
    if (
        not isinstance(current, dict)
        or set(current) != {"target", "realpath", "uid", "gid", "mode", "nlink", "dev", "ino"}
        or not re.fullmatch(r"/var/www/rosomaha/_releases/[A-Za-z0-9][A-Za-z0-9._-]{0,127}", str(current.get("target", "")))
        or current.get("realpath") != current.get("target")
        or current.get("uid") != 0
    ):
        raise InstallerError("current release evidence is invalid")
    articles = snapshot["articles"]
    if not isinstance(articles, dict) or set(articles) != {"canonical", "current"}:
        raise InstallerError("article parity evidence is not exact")
    validate_article(articles["canonical"], "canonical", topology_kind="canonical")
    validate_article(articles["current"], "current", topology_kind="runtime")
    signatures = {
        (item["raw_sha256"], item["count"], item["slug_digest"])
        for item in articles.values()
    }
    if snapshot.get("article_parity") is not True or len(signatures) != 1:
        raise InstallerError("canonical/current/live article parity is not exact")
    cz = snapshot["articles_cz"]
    if not isinstance(cz, dict) or set(cz) != {"directory", "count", "files", "digest"}:
        raise InstallerError("articles-cz evidence is not exact")
    validate_topology(
        cz["directory"], uid=0, gid=33, mode="0o2775", non_022=False,
        context="articles-cz-directory", nlink=None,
    )
    if not isinstance(cz.get("files"), list) or len(cz["files"]) != cz.get("count") or not valid_digest(cz.get("digest")):
        raise InstallerError("articles-cz manifest is invalid")
    for item in cz["files"]:
        if (
            not isinstance(item, dict)
            or set(item) != {"name", "bytes", "sha256", "topology"}
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.ts", str(item.get("name", "")))
            or not valid_digest(item.get("sha256"))
        ):
            raise InstallerError("articles-cz file evidence is invalid")
        validate_topology(
            item["topology"], uid=0, gid=33, mode="0o664", non_022=False,
            context="articles-cz-file",
        )
    labels = snapshot["release_labels"]
    if (
        not isinstance(labels, dict)
        or set(labels) != {"count", "labels", "digest"}
        or not isinstance(labels.get("labels"), list)
        or len(labels["labels"]) != labels.get("count")
        or not valid_digest(labels.get("digest"))
    ):
        raise InstallerError("release-label evidence is invalid")
    for label in labels["labels"]:
        if not re.fullmatch(r"[0-9]{8}-[0-9]{6}-[A-Za-z0-9][A-Za-z0-9._-]{0,63}", str(label)):
            raise InstallerError("release-label value is invalid")


def validate_independent_public(snapshot: Any) -> None:
    if not isinstance(snapshot, dict) or set(snapshot) != {"pages", "live_articles"}:
        raise InstallerError("independent public snapshot is not exact")
    validate_public_pages(snapshot["pages"])
    validate_article(snapshot["live_articles"], "live", topology_kind=None, live=True)


def validate_audit(payload: dict[str, Any]) -> None:
    expected = {
        "schema", "status", "mode", "account", "read_only", "target_commit",
        "targets", "olds", "pair", "seo_snapshot", "scope",
    }
    if (
        not isinstance(payload, dict)
        or set(payload) != expected
        or payload.get("schema") != SCHEMA
        or payload.get("status") != "audited"
        or payload.get("mode") != "audit"
        or payload.get("account") != AUDIT_LOGIN
        or payload.get("read_only") is not True
        or payload.get("target_commit") != TARGET_COMMIT
        or payload.get("targets") != {key: spec["new_sha256"] for key, spec in PAIR_SPECS.items()}
        or payload.get("olds") != {key: spec["old_sha256"] for key, spec in PAIR_SPECS.items()}
        or payload.get("scope") != {
            "pair_only": True, "installed_scripts_executed": False,
            "state_evidence_read_only": True, "coverage": MIGRATION_COVERAGE,
        }
    ):
        raise InstallerError("remote audit contract is not exact")
    validate_pair(payload["pair"])
    validate_seo_snapshot(payload["seo_snapshot"])


def classify_readback(members: dict[str, dict[str, Any]]) -> str:
    states = [members[key]["state"] for key in ("release", "rollback")]
    if states == ["old", "old"]:
        return "old/old"
    if states == ["new", "new"]:
        return "new/new"
    if set(states) == {"old", "new"}:
        return "mixed"
    return "unknown"


def validate_sftp_readback(readback: Any) -> None:
    if (
        not isinstance(readback, dict)
        or set(readback) != {"pair_state", "members"}
        or readback.get("pair_state") not in {"old/old", "new/new", "mixed", "unknown"}
        or not isinstance(readback.get("members"), dict)
        or set(readback["members"]) != set(PAIR_SPECS)
    ):
        raise InstallerError("independent SFTP pair evidence is not exact")
    for key, spec in PAIR_SPECS.items():
        item = readback["members"][key]
        if (
            not isinstance(item, dict)
            or set(item) != {
                "topology_valid", "state", "sha256", "size", "uid", "gid", "mode",
                "nlink", "nlink_proved",
            }
            or item.get("topology_valid") is not True
            or item.get("state") not in {"old", "new", "unknown"}
            or not valid_digest(item.get("sha256"))
            or not isinstance(item.get("size"), int)
            or not 0 < item["size"] <= MAX_SCRIPT_BYTES
            or item.get("uid") != 0
            or item.get("gid") != 0
            or item.get("mode") != "0o755"
            or item.get("nlink_proved") not in {True, False}
            or (
                item.get("nlink_proved") is True
                and item.get("nlink") != 1
            )
            or (
                item.get("nlink_proved") is False
                and item.get("nlink") is not None
            )
        ):
            raise InstallerError(f"independent SFTP member evidence is invalid: {key}")
        expected_state = (
            "old" if item["sha256"] == spec["old_sha256"] else
            "new" if item["sha256"] == spec["new_sha256"] else "unknown"
        )
        if item["state"] != expected_state:
            raise InstallerError(f"independent SFTP member classification is inconsistent: {key}")
    if readback["pair_state"] != classify_readback(readback["members"]):
        raise InstallerError("independent SFTP pair classification is inconsistent")


def validate_readback_agreement(
    remote: Any, readback: Any, public: Any, *, expected_state: str | None = None,
) -> None:
    validate_audit(remote)
    validate_sftp_readback(readback)
    validate_independent_public(public)
    remote_state = remote["pair"]["pair_state"]
    if remote_state != readback["pair_state"] or (
        expected_state is not None and remote_state != expected_state
    ):
        raise InstallerError("operator and SFTP pair classifications disagree")
    for key in PAIR_SPECS:
        if (
            remote["pair"]["members"][key].get("sha256") != readback["members"][key]["sha256"]
            or remote["pair"]["members"][key].get("state") != readback["members"][key]["state"]
        ):
            raise InstallerError("operator and SFTP pair member readbacks disagree")
    remote_canonical = remote["seo_snapshot"]["articles"]["canonical"]
    remote_current = remote["seo_snapshot"]["articles"]["current"]
    public_live = public["live_articles"]
    signature_fields = ("raw_sha256", "bytes", "count", "slug_digest")
    public_signature = tuple(public_live[field] for field in signature_fields)
    if (
        tuple(remote_canonical[field] for field in signature_fields) != public_signature
        or tuple(remote_current[field] for field in signature_fields) != public_signature
    ):
        raise InstallerError("remote canonical/current and independent live article readback disagree")


def sftp_readback(client: paramiko.SSHClient) -> dict[str, Any]:
    sftp = client.open_sftp()
    members = {}
    try:
        for key, spec in PAIR_SPECS.items():
            attr = sftp.lstat(spec["remote"])
            observed_nlink = getattr(attr, "st_nlink", None)
            if (
                not stat.S_ISREG(attr.st_mode)
                or stat.S_ISLNK(attr.st_mode)
                or getattr(attr, "st_uid", None) != 0
                or getattr(attr, "st_gid", None) != 0
                or stat.S_IMODE(attr.st_mode) != 0o755
                or (observed_nlink is not None and observed_nlink != 1)
                or not 0 < attr.st_size <= MAX_SCRIPT_BYTES
            ):
                raise InstallerError(f"independent SFTP topology is unsafe: {key}")
            with sftp.open(spec["remote"], "rb") as handle:
                raw = handle.read(MAX_SCRIPT_BYTES + 1)
            if len(raw) != attr.st_size or len(raw) > MAX_SCRIPT_BYTES:
                raise InstallerError(f"independent SFTP readback is incomplete: {key}")
            digest = sha256_bytes(raw)
            state = "old" if digest == spec["old_sha256"] else "new" if digest == spec["new_sha256"] else "unknown"
            members[key] = {
                "topology_valid": True, "state": state, "sha256": digest,
                "size": len(raw), "uid": attr.st_uid, "gid": attr.st_gid,
                "mode": "0o755", "nlink": observed_nlink,
                "nlink_proved": observed_nlink is not None,
            }
    finally:
        sftp.close()
    return {"pair_state": classify_readback(members), "members": members}


def read_only_snapshot(operator: bytes) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    client = connect(AUDIT_LOGIN)
    try:
        remote = invoke(client, "audit", operator)
        validate_audit(remote)
        readback = sftp_readback(client)
        validate_sftp_readback(readback)
    finally:
        client.close()
    public = independent_public_snapshot()
    validate_readback_agreement(remote, readback, public)
    return remote, readback, public


def root_read_only_preflight(operator: bytes) -> dict[str, Any]:
    client = connect(APPLY_LOGIN)
    try:
        root = invoke(client, "root-audit", operator)
    finally:
        client.close()
    validate_root_audit(root, expected_state="old/old")
    return root


def audit() -> tuple[dict[str, Any], Path]:
    target_blobs()
    operator = operator_bytes()
    remote, readback, public = read_only_snapshot(operator)
    root_preflight = root_read_only_preflight(operator)
    validate_root_preflight_agreement(
        root_preflight, remote, readback, expected_state="old/old",
    )
    unsigned = {
        "schema": BASELINE_SCHEMA, "status": "audited", "created_at": utc_now(),
        "target_commit": TARGET_COMMIT,
        "targets": {key: spec["new_sha256"] for key, spec in PAIR_SPECS.items()},
        "olds": {key: spec["old_sha256"] for key, spec in PAIR_SPECS.items()},
        "operator_sha256": sha256_bytes(operator), "remote": remote,
        "independent_readback": readback, "independent_public": public,
        "root_preflight": root_preflight,
    }
    payload = {**unsigned, "baseline_token": sha256_bytes(canonical_json(unsigned))}
    return payload, write_receipt("rosomaha-release-pair-baseline", payload)


def load_baseline(path: Path, operator: bytes) -> tuple[dict[str, Any], bytes]:
    raw = safe_local_file(path, REPORT_ROOT, maximum=MAX_RECEIPT_BYTES)
    try:
        payload = json.loads(raw.decode("utf-8"), object_pairs_hook=reject_duplicates)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise InstallerError("baseline receipt is invalid JSON") from exc
    expected = {
        "schema", "status", "created_at", "target_commit", "targets", "olds",
        "operator_sha256", "remote", "independent_readback", "independent_public",
        "root_preflight", "baseline_token",
    }
    unsigned = dict(payload) if isinstance(payload, dict) else {}
    token = unsigned.pop("baseline_token", None)
    if (
        not isinstance(payload, dict)
        or set(payload) != expected
        or payload.get("schema") != BASELINE_SCHEMA
        or payload.get("status") != "audited"
        or payload.get("target_commit") != TARGET_COMMIT
        or payload.get("targets") != {key: spec["new_sha256"] for key, spec in PAIR_SPECS.items()}
        or payload.get("olds") != {key: spec["old_sha256"] for key, spec in PAIR_SPECS.items()}
        or payload.get("operator_sha256") != OPERATOR_SHA256
        or payload.get("operator_sha256") != sha256_bytes(operator)
        or not isinstance(token, str)
        or token != sha256_bytes(canonical_json(unsigned))
        or payload.get("remote", {}).get("pair", {}).get("pair_state") != "old/old"
        or payload.get("independent_readback", {}).get("pair_state") != "old/old"
    ):
        raise InstallerError("baseline identity/digest is invalid or not old/old")
    validate_audit(payload["remote"])
    validate_readback_agreement(
        payload["remote"], payload["independent_readback"],
        payload["independent_public"], expected_state="old/old",
    )
    validate_root_preflight_agreement(
        payload["root_preflight"], payload["remote"],
        payload["independent_readback"], expected_state="old/old",
    )
    return payload, canonical_json(payload) + b"\n"


def remote_bundle_path(token: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{64}", token):
        raise InstallerError("baseline token is invalid")
    return f"/tmp/rosomaha-release-pair-installer-29f90f1-{token[:16]}"


def sftp_missing(sftp: paramiko.SFTPClient, path: str) -> bool:
    try:
        sftp.lstat(path)
    except FileNotFoundError:
        return True
    except OSError as exc:
        if getattr(exc, "errno", None) == 2:
            return True
        raise
    return False


def upload_bytes(sftp: paramiko.SFTPClient, remote_dir: str, name: str, raw: bytes, mode: int = 0o600) -> None:
    if PurePosixPath(name).name != name or name not in REMOTE_BUNDLE_FILES:
        raise InstallerError("remote bundle filename is outside the allowlist")
    remote_path = f"{remote_dir}/{name}"
    if not sftp_missing(sftp, remote_path):
        raise InstallerError(f"remote bundle file already exists: {name}")
    with sftp.open(remote_path, "wx") as handle:
        handle.write(raw)
    sftp.chmod(remote_path, mode)
    attr = sftp.lstat(remote_path)
    if (
        not stat.S_ISREG(attr.st_mode)
        or stat.S_ISLNK(attr.st_mode)
        or stat.S_IMODE(attr.st_mode) != mode
        or getattr(attr, "st_uid", None) != 0
        or getattr(attr, "st_gid", None) != 0
        or attr.st_size != len(raw)
    ):
        raise InstallerError(f"remote uploaded file topology mismatch: {name}")


def create_bundle(
    client: paramiko.SSHClient,
    baseline: dict[str, Any],
    baseline_raw: bytes,
    operator: bytes,
    *,
    targets: dict[str, bytes] | None = None,
    rollback_authorization: bytes | None = None,
) -> str:
    remote_dir = remote_bundle_path(baseline["baseline_token"])
    sftp = client.open_sftp()
    created = False
    try:
        if not sftp_missing(sftp, remote_dir):
            raise InstallerError("fixed remote bundle already exists; classify instead of retrying")
        sftp.mkdir(remote_dir, mode=0o700)
        created = True
        directory = sftp.lstat(remote_dir)
        if (
            not stat.S_ISDIR(directory.st_mode)
            or stat.S_ISLNK(directory.st_mode)
            or stat.S_IMODE(directory.st_mode) != 0o700
            or getattr(directory, "st_uid", None) != 0
            or getattr(directory, "st_gid", None) != 0
        ):
            raise InstallerError("remote bundle directory topology mismatch")
        upload_bytes(sftp, remote_dir, "baseline.json", baseline_raw)
        upload_bytes(sftp, remote_dir, "operator.sh", operator)
        if targets is not None:
            for key, spec in PAIR_SPECS.items():
                upload_bytes(sftp, remote_dir, spec["name"], targets[key])
        if rollback_authorization is not None:
            upload_bytes(sftp, remote_dir, "rollback-authorization.json", rollback_authorization)
        return remote_dir
    except Exception as exc:
        if created and not cleanup_bundle_sftp(sftp, remote_dir):
            raise InstallerError("bundle upload failed and cleanup could not be proved; bundle preserved") from exc
        raise
    finally:
        sftp.close()


def cleanup_bundle_sftp(sftp: paramiko.SFTPClient, remote_dir: str) -> bool:
    if not REMOTE_BUNDLE_RE.fullmatch(remote_dir):
        raise InstallerError("refusing cleanup outside the fixed bundle path")
    try:
        directory = sftp.lstat(remote_dir)
    except FileNotFoundError:
        return True
    except OSError:
        return False
    if (
        not stat.S_ISDIR(directory.st_mode)
        or stat.S_ISLNK(directory.st_mode)
        or stat.S_IMODE(directory.st_mode) != 0o700
        or getattr(directory, "st_uid", None) != 0
        or getattr(directory, "st_gid", None) != 0
    ):
        return False
    try:
        names = sorted(sftp.listdir(remote_dir))
    except OSError:
        return False
    if not set(names).issubset(REMOTE_BUNDLE_FILES):
        return False
    for name in names:
        try:
            attr = sftp.lstat(f"{remote_dir}/{name}")
        except OSError:
            return False
        if (
            PurePosixPath(name).name != name
            or not stat.S_ISREG(attr.st_mode)
            or stat.S_ISLNK(attr.st_mode)
            or getattr(attr, "st_uid", None) != 0
            or getattr(attr, "st_gid", None) != 0
            or stat.S_IMODE(attr.st_mode) & 0o022
        ):
            return False
    try:
        for name in names:
            sftp.remove(f"{remote_dir}/{name}")
        sftp.rmdir(remote_dir)
    except OSError:
        return False
    return True


def cleanup_bundle(client: paramiko.SSHClient, remote_dir: str) -> bool:
    sftp = client.open_sftp()
    try:
        return cleanup_bundle_sftp(sftp, remote_dir)
    finally:
        sftp.close()


def download_bundle_file(client: paramiko.SSHClient, remote_dir: str, name: str) -> bytes:
    if not REMOTE_BUNDLE_RE.fullmatch(remote_dir) or name not in REMOTE_BUNDLE_FILES:
        raise InstallerError("remote receipt path is outside the fixed bundle")
    sftp = client.open_sftp()
    try:
        remote_path = f"{remote_dir}/{name}"
        attr = sftp.lstat(remote_path)
        if (
            not stat.S_ISREG(attr.st_mode)
            or stat.S_ISLNK(attr.st_mode)
            or getattr(attr, "st_uid", None) != 0
            or getattr(attr, "st_gid", None) != 0
            or stat.S_IMODE(attr.st_mode) != 0o600
            or not 0 < attr.st_size <= MAX_RECEIPT_BYTES
        ):
            raise InstallerError("remote receipt topology is unsafe")
        with sftp.open(remote_path, "rb") as handle:
            raw = handle.read(MAX_RECEIPT_BYTES + 1)
        if len(raw) != attr.st_size or len(raw) > MAX_RECEIPT_BYTES:
            raise InstallerError("remote receipt readback is incomplete")
        return raw
    finally:
        sftp.close()


def independent_terminal_readback(expected_state: str, operator: bytes) -> dict[str, Any]:
    remote, readback, public = read_only_snapshot(operator)
    if remote["pair"]["pair_state"] != expected_state or readback["pair_state"] != expected_state:
        raise InstallerError(f"independent deploy readback does not prove {expected_state}")
    return {"operator": remote, "sftp": readback, "public": public}


def verify_process_scan(item: Any) -> None:
    if (
        not isinstance(item, dict)
        or set(item) != {
            "complete_within_bound", "exact_argv_path_only", "pid_limit", "pid_entries",
            "cmdlines_scanned", "disappeared_during_scan", "matches",
            "absolute_protection_claimed",
        }
        or item.get("complete_within_bound") is not True
        or item.get("exact_argv_path_only") is not True
        or item.get("pid_limit") != 32768
        or not isinstance(item.get("pid_entries"), int)
        or not 0 <= item["pid_entries"] <= item["pid_limit"]
        or not isinstance(item.get("cmdlines_scanned"), int)
        or not isinstance(item.get("disappeared_during_scan"), int)
        or item["cmdlines_scanned"] < 0
        or item["disappeared_during_scan"] < 0
        or item["cmdlines_scanned"] + item["disappeared_during_scan"] != item["pid_entries"]
        or item.get("matches") != []
        or item.get("absolute_protection_claimed") is not False
    ):
        raise InstallerError("bounded migration process scan is not exact")


def validate_lock_evidence(lock: Any) -> None:
    if (
        not isinstance(lock, dict)
        or set(lock) != {
            "path", "uid", "gid", "mode", "nlink", "exclusive", "existing", "created",
            "coverage", "legacy_direct_invocation_absolute_protection",
            "post_install_pair_uses_shared_lock",
        }
        or lock.get("path") != "/var/www/rosomaha/.rosomaha-main-price-release.lock"
        or lock.get("uid") != 0
        or lock.get("gid") not in {0, 33}
        or lock.get("mode") != "0o600"
        or lock.get("nlink") != 1
        or lock.get("exclusive") is not True
        or lock.get("existing") is not True
        or lock.get("created") is not False
        or lock.get("coverage") != MIGRATION_COVERAGE
        or lock.get("legacy_direct_invocation_absolute_protection") is not False
        or lock.get("post_install_pair_uses_shared_lock") is not True
    ):
        raise InstallerError("shared release-lock evidence is not exact")


def validate_root_audit(payload: Any, *, expected_state: str | None = None) -> None:
    expected = {
        "schema", "status", "mode", "account", "read_only", "target_commit",
        "targets", "olds", "pair", "seo_snapshot", "process_scan",
        "shared_release_lock", "scope",
    }
    if (
        not isinstance(payload, dict)
        or set(payload) != expected
        or payload.get("schema") != SCHEMA
        or payload.get("status") != "root-audited"
        or payload.get("mode") != "root-audit"
        or payload.get("account") != APPLY_LOGIN
        or payload.get("read_only") is not True
        or payload.get("target_commit") != TARGET_COMMIT
        or payload.get("targets") != {key: spec["new_sha256"] for key, spec in PAIR_SPECS.items()}
        or payload.get("olds") != {key: spec["old_sha256"] for key, spec in PAIR_SPECS.items()}
        or payload.get("scope") != ROOT_AUDIT_SCOPE
    ):
        raise InstallerError("root audit contract is not exact")
    validate_pair(payload["pair"])
    validate_seo_snapshot(payload["seo_snapshot"])
    verify_process_scan(payload["process_scan"])
    validate_lock_evidence(payload["shared_release_lock"])
    if expected_state is not None and payload["pair"]["pair_state"] != expected_state:
        raise InstallerError(f"root audit does not prove {expected_state}")


def validate_root_preflight_agreement(
    root: Any, remote: Any, readback: Any, *, expected_state: str,
) -> None:
    validate_audit(remote)
    validate_sftp_readback(readback)
    validate_root_audit(root, expected_state=expected_state)
    if remote["pair"]["pair_state"] != expected_state or readback["pair_state"] != expected_state:
        raise InstallerError("root/deploy/SFTP pair classifications disagree")
    if root["pair"] != remote["pair"]:
        raise InstallerError("root and deploy pair evidence disagree")
    for key in PAIR_SPECS:
        root_member = root["pair"]["members"][key]
        sftp_member = readback["members"][key]
        if any(
            root_member[field] != sftp_member[field]
            for field in ("state", "sha256", "size", "uid", "gid", "mode")
        ) or (
            sftp_member["nlink_proved"] is True
            and root_member["nlink"] != sftp_member["nlink"]
        ):
            raise InstallerError("root and SFTP pair-member evidence disagree")
    if root["seo_snapshot"] != remote["seo_snapshot"]:
        raise InstallerError("root and deploy SEO snapshots disagree")


def expected_backup_manifest() -> dict[str, Any]:
    return {
        "schema": "rosomaha-release-script-pair-backup/v1",
        "target_commit": TARGET_COMMIT,
        "scripts": {
            key: {"name": spec["name"], "sha256": spec["old_sha256"]}
            for key, spec in PAIR_SPECS.items()
        },
    }


def validate_complete_backup(backup: Any) -> None:
    expected_names = sorted([
        "pair-manifest.json",
        *(f"{spec['name']}.{spec['old_sha256']}.bak" for spec in PAIR_SPECS.values()),
    ])
    expected_hashes = {key: spec["old_sha256"] for key, spec in PAIR_SPECS.items()}
    manifest_raw = canonical_json(expected_backup_manifest()) + b"\n"
    if (
        not isinstance(backup, dict)
        or set(backup) != {"status", "complete", "present", "hashes", "manifest_sha256"}
        or backup.get("status") != "complete"
        or backup.get("complete") is not True
        or backup.get("present") != expected_names
        or backup.get("hashes") != expected_hashes
        or backup.get("manifest_sha256") != sha256_bytes(manifest_raw)
    ):
        raise InstallerError("immutable pair-backup evidence is not exact")


def validate_migration_freeze(freeze: Any, expected_replaced: list[str]) -> None:
    if (
        not isinstance(freeze, dict)
        or set(freeze) != {
            "executables_disabled_before_final_scan", "unreplaced_old_modes_restored",
            "replaced_members", "residual_root_bypass_possible", "absolute_protection_claimed",
        }
        or freeze.get("executables_disabled_before_final_scan") is not True
        or freeze.get("unreplaced_old_modes_restored") is not True
        or freeze.get("replaced_members") != sorted(expected_replaced)
        or freeze.get("residual_root_bypass_possible") is not True
        or freeze.get("absolute_protection_claimed") is not False
    ):
        raise InstallerError("migration executable-freeze evidence is not exact")


def validate_recovery_receipt(root: Any, baseline: dict[str, Any]) -> None:
    if (
        not isinstance(root, dict)
        or set(root) != {
            "schema", "status", "mode", "account", "read_only", "baseline_token",
            "attempted", "classification", "pair", "backup", "seo_snapshot",
            "process_scan", "shared_release_lock", "apply_retry_allowed",
            "automatic_rollback_allowed",
        }
        or root.get("schema") != SCHEMA
        or root.get("status") != "recovered"
        or root.get("mode") != "recover"
        or root.get("account") != APPLY_LOGIN
        or root.get("read_only") is not True
        or root.get("baseline_token") != baseline["baseline_token"]
        or not isinstance(root.get("attempted"), bool)
        or root.get("classification") not in {"old/old", "new/new", "mixed", "unknown"}
        or root.get("apply_retry_allowed") is not False
        or root.get("automatic_rollback_allowed") is not False
    ):
        raise InstallerError("root recovery receipt contract is not exact")
    validate_pair(root["pair"])
    validate_seo_snapshot(root["seo_snapshot"])
    verify_process_scan(root["process_scan"])
    validate_lock_evidence(root["shared_release_lock"])
    if root["classification"] in {"new/new", "mixed"}:
        if root["pair"]["pair_state"] != root["classification"]:
            raise InstallerError("root recovery pair classification is inconsistent")
        validate_complete_backup(root["backup"])


def validate_apply_receipt(result: dict[str, Any], baseline: dict[str, Any]) -> None:
    if (
        not isinstance(result, dict)
        or set(result) != {
            "schema", "status", "mode", "account", "baseline_token", "target_commit",
            "pair_before", "pair_after", "backup", "process_scans", "migration_freeze",
            "shared_release_lock", "before", "after", "state_unchanged", "staging_cleanup",
            "scope",
        }
        or result.get("schema") != SCHEMA
        or result.get("status") != "installed"
        or result.get("mode") != "apply"
        or result.get("account") != APPLY_LOGIN
        or result.get("baseline_token") != baseline["baseline_token"]
        or result.get("target_commit") != TARGET_COMMIT
        or result.get("pair_before", {}).get("pair_state") != "old/old"
        or result.get("pair_after", {}).get("pair_state") != "new/new"
        or result.get("backup", {}).get("complete") is not True
        or result.get("state_unchanged") is not True
        or result.get("before") != baseline["remote"]["seo_snapshot"]
        or result.get("after") != result.get("before")
    ):
        raise InstallerError("remote apply receipt contract is not exact")
    validate_pair(result["pair_before"])
    validate_pair(result["pair_after"])
    validate_complete_backup(result["backup"])
    scans = result.get("process_scans")
    if not isinstance(scans, list) or len(scans) != 2:
        raise InstallerError("apply receipt process scans are incomplete")
    for scan in scans:
        verify_process_scan(scan)
    validate_migration_freeze(result["migration_freeze"], ["release", "rollback"])
    validate_lock_evidence(result["shared_release_lock"])
    if result.get("staging_cleanup") != "verified_cleanup_complete":
        raise InstallerError("apply receipt staging cleanup is not exact")
    if result.get("scope") != {
        "pair_only": True, "installed_scripts_executed": False,
        "current_unchanged_proved": True, "content_unchanged_proved": True,
        "coverage": MIGRATION_COVERAGE,
    }:
        raise InstallerError("apply receipt scope overclaims or is incomplete")


def validate_rollback_receipt(
    result: dict[str, Any], baseline: dict[str, Any], authorization: dict[str, Any],
) -> None:
    if (
        not isinstance(result, dict)
        or set(result) != {
            "schema", "status", "mode", "account", "baseline_token", "target_commit",
            "authorization", "pair_before", "pair_after", "backup", "process_scans",
            "migration_freeze", "shared_release_lock", "before", "after", "state_unchanged",
            "staging_cleanup", "installed_scripts_executed", "current_unchanged_proved",
            "content_unchanged_proved",
        }
        or result.get("schema") != SCHEMA
        or result.get("status") != "rolled_back"
        or result.get("mode") != "rollback"
        or result.get("account") != APPLY_LOGIN
        or result.get("baseline_token") != baseline["baseline_token"]
        or result.get("target_commit") != TARGET_COMMIT
        or result.get("authorization") != authorization
        or result.get("pair_before", {}).get("pair_state") != authorization["authorized_pair_state"]
        or result.get("pair_after", {}).get("pair_state") != "old/old"
        or result.get("before") != baseline["remote"]["seo_snapshot"]
        or result.get("after") != result.get("before")
        or result.get("state_unchanged") is not True
        or result.get("staging_cleanup") != "verified_cleanup_complete"
        or result.get("installed_scripts_executed") is not False
        or result.get("current_unchanged_proved") is not True
        or result.get("content_unchanged_proved") is not True
    ):
        raise InstallerError("remote pair rollback receipt contract is not exact")
    validate_pair(result["pair_before"])
    validate_pair(result["pair_after"])
    observed_states = {
        key: result["pair_before"]["members"][key]["state"]
        for key in PAIR_SPECS
    }
    if observed_states != authorization["authorized_member_states"]:
        raise InstallerError("rollback receipt pair members differ from authorization")
    validate_complete_backup(result["backup"])
    scans = result["process_scans"]
    if not isinstance(scans, list) or len(scans) != 2:
        raise InstallerError("rollback receipt process scans are incomplete")
    for scan in scans:
        verify_process_scan(scan)
    validate_migration_freeze(
        result["migration_freeze"],
        [key for key, state in authorization["authorized_member_states"].items() if state == "new"],
    )
    validate_lock_evidence(result["shared_release_lock"])


def classify_recovery(
    root: dict[str, Any], deploy_remote: dict[str, Any], deploy_sftp: dict[str, Any],
    deploy_public: dict[str, Any], baseline: dict[str, Any],
) -> str:
    root_state = root.get("classification")
    if root_state not in {"old/old", "new/new", "mixed", "unknown"}:
        return "unknown"
    try:
        validate_recovery_receipt(root, baseline)
        validate_readback_agreement(
            deploy_remote, deploy_sftp, deploy_public, expected_state=root_state,
        )
    except InstallerError:
        return "unknown"
    if (
        root.get("apply_retry_allowed") is not False
        or root.get("automatic_rollback_allowed") is not False
        or deploy_remote.get("pair", {}).get("pair_state") != root_state
        or deploy_sftp.get("pair_state") != root_state
        or root.get("pair", {}).get("members") != deploy_remote.get("pair", {}).get("members")
        or root.get("seo_snapshot") != baseline.get("remote", {}).get("seo_snapshot")
        or deploy_remote.get("seo_snapshot") != baseline.get("remote", {}).get("seo_snapshot")
        or deploy_public != baseline.get("independent_public")
    ):
        return "unknown"
    if root_state in {"new/new", "mixed"} and root.get("backup", {}).get("complete") is not True:
        return "unknown"
    return root_state


def recover_ambiguous(remote_dir: str, baseline: dict[str, Any], operator: bytes, original: Exception) -> dict[str, Any]:
    client = connect(APPLY_LOGIN)
    try:
        root = invoke(client, "recover", operator, remote_dir)
    except Exception as recovery_error:
        return {
            "schema": SCHEMA, "status": "unknown_requires_manual_recovery", "mode": "recover",
            "baseline_token": baseline["baseline_token"], "remote_bundle": remote_dir,
            "apply_retried": False, "bundle_preserved": True,
            "original_error": sanitized_error(original), "recovery_error": sanitized_error(recovery_error),
        }
    finally:
        client.close()
    try:
        deploy_remote, deploy_sftp, deploy_public = read_only_snapshot(operator)
    except Exception as deploy_error:
        return {
            "schema": SCHEMA, "status": "recovered_unknown", "mode": "recover",
            "baseline_token": baseline["baseline_token"], "remote_bundle": remote_dir,
            "apply_retried": False, "bundle_preserved": True,
            "original_error": sanitized_error(original), "recovery": root,
            "independent_error": sanitized_error(deploy_error),
        }
    classification = classify_recovery(root, deploy_remote, deploy_sftp, deploy_public, baseline)
    return {
        "schema": SCHEMA, "status": f"recovered_{classification.replace('/', '_')}",
        "mode": "recover", "classification": classification,
        "baseline_token": baseline["baseline_token"], "remote_bundle": remote_dir,
        "apply_retried": False, "bundle_preserved": True,
        "original_error": sanitized_error(original), "recovery": root,
        "independent_deploy": {
            "operator": deploy_remote, "sftp": deploy_sftp, "public": deploy_public,
        },
    }


def apply(commit: str, baseline_path: Path) -> tuple[dict[str, Any], Path]:
    if commit != TARGET_COMMIT:
        raise InstallerError(f"apply requires exact commit {TARGET_COMMIT}")
    targets = target_blobs()
    operator = operator_bytes()
    baseline, baseline_raw = load_baseline(baseline_path, operator)
    preflight = independent_terminal_readback("old/old", operator)
    if (
        preflight["operator"]["pair"] != baseline["root_preflight"]["pair"]
        or preflight["operator"]["seo_snapshot"] != baseline["remote"]["seo_snapshot"]
        or preflight["public"] != baseline["independent_public"]
    ):
        raise InstallerError("fresh deploy preflight differs from immutable root/SEO baseline")
    client = connect(APPLY_LOGIN)
    remote_dir = None
    invoked = False
    try:
        remote_dir = create_bundle(client, baseline, baseline_raw, operator, targets=targets)
        invoked = True
        try:
            result = invoke(client, "apply", operator, remote_dir)
            validate_apply_receipt(result, baseline)
            remote_receipt = download_bundle_file(client, remote_dir, "operation-receipt.json")
            parsed = json.loads(remote_receipt.decode("utf-8"), object_pairs_hook=reject_duplicates)
            if parsed != result or remote_receipt != canonical_json(result) + b"\n":
                raise InstallerError("remote immutable apply receipt differs from operator result")
            postflight = independent_terminal_readback("new/new", operator)
            if (
                postflight["operator"]["seo_snapshot"] != preflight["operator"]["seo_snapshot"]
                or postflight["public"] != preflight["public"]
            ):
                raise InstallerError("independent SEO state changed across pair installation")
            cleanup_ok = cleanup_bundle(client, remote_dir)
            payload = {
                "schema": SCHEMA,
                "status": "installed_verified" if cleanup_ok else "installed_verified_cleanup_required",
                "mode": "apply", "completed_at": utc_now(), "target_commit": TARGET_COMMIT,
                "baseline_token": baseline["baseline_token"], "preflight": preflight,
                "operator_receipt": result, "operator_receipt_sha256": sha256_bytes(remote_receipt),
                "independent_deploy_readback": postflight, "bundle_preserved": not cleanup_ok,
                "installed_scripts_executed": False, "apply_retried": False,
                "current_unchanged_proved": True, "content_unchanged_proved": True,
            }
            return payload, write_receipt("rosomaha-release-pair-install", payload)
        except Exception as exc:
            if not invoked or remote_dir is None:
                raise
            client.close()
            recovered = recover_ambiguous(remote_dir, baseline, operator, exc)
            return recovered, write_receipt("rosomaha-release-pair-recovery", recovered)
    finally:
        client.close()


def recover(commit: str, baseline_path: Path) -> tuple[dict[str, Any], Path]:
    if commit != TARGET_COMMIT:
        raise InstallerError(f"recover requires exact commit {TARGET_COMMIT}")
    target_blobs()
    operator = operator_bytes()
    baseline, _raw = load_baseline(baseline_path, operator)
    remote_dir = remote_bundle_path(baseline["baseline_token"])
    payload = recover_ambiguous(remote_dir, baseline, operator, TimeoutError("explicit recovery"))
    return payload, write_receipt("rosomaha-release-pair-recovery", payload)


def rollback_authorization(source_path: Path, baseline: dict[str, Any]) -> tuple[dict[str, Any], bytes]:
    raw = safe_local_file(source_path, REPORT_ROOT, maximum=MAX_RECEIPT_BYTES)
    try:
        source = json.loads(raw.decode("utf-8"), object_pairs_hook=reject_duplicates)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise InstallerError("rollback source receipt is invalid JSON") from exc
    member_states: dict[str, str]
    if (
        source.get("schema") == SCHEMA
        and source.get("status") in {"installed_verified", "installed_verified_cleanup_required"}
        and source.get("baseline_token") == baseline["baseline_token"]
        and source.get("target_commit") == TARGET_COMMIT
        and source.get("operator_receipt", {}).get("pair_after", {}).get("pair_state") == "new/new"
    ):
        operation = source["operator_receipt"]
        validate_apply_receipt(operation, baseline)
        independent = source.get("independent_deploy_readback")
        if (
            not isinstance(independent, dict)
            or set(independent) != {"operator", "sftp", "public"}
            or independent["operator"].get("pair", {}).get("pair_state") != "new/new"
            or independent["sftp"].get("pair_state") != "new/new"
            or independent["operator"].get("seo_snapshot") != baseline["remote"]["seo_snapshot"]
            or independent["public"] != baseline["independent_public"]
            or source.get("operator_receipt_sha256") != sha256_bytes(canonical_json(operation) + b"\n")
            or source.get("apply_retried") is not False
        ):
            raise InstallerError("apply receipt lacks independent verified new/new proof")
        validate_readback_agreement(
            independent["operator"], independent["sftp"], independent["public"],
            expected_state="new/new",
        )
        member_states = {key: "new" for key in PAIR_SPECS}
        pair_state = "new/new"
    elif (
        source.get("schema") == SCHEMA
        and source.get("status") in {"recovered_new_new", "recovered_mixed"}
        and source.get("baseline_token") == baseline["baseline_token"]
        and source.get("classification") in {"new/new", "mixed"}
    ):
        root = source.get("recovery")
        independent = source.get("independent_deploy")
        if (
            not isinstance(root, dict)
            or not isinstance(independent, dict)
            or set(independent) != {"operator", "sftp", "public"}
            or source.get("apply_retried") is not False
            or source.get("bundle_preserved") is not True
        ):
            raise InstallerError("recovery receipt lacks independent verified pair proof")
        validate_readback_agreement(
            independent["operator"], independent["sftp"], independent["public"],
            expected_state=source["classification"],
        )
        if classify_recovery(
            root,
            independent["operator"],
            independent["sftp"],
            independent["public"],
            baseline,
        ) != source["classification"]:
            raise InstallerError("recovery receipt classification is not independently reproducible")
        pair = source.get("recovery", {}).get("pair", {})
        member_states = {
            key: pair.get("members", {}).get(key, {}).get("state")
            for key in PAIR_SPECS
        }
        pair_state = source["classification"]
    else:
        raise InstallerError("source receipt cannot authorize pair rollback")
    if any(state not in {"old", "new"} for state in member_states.values()):
        raise InstallerError("rollback source member states are not exact")
    calculated = classify_readback({key: {"state": state} for key, state in member_states.items()})
    if calculated != pair_state or pair_state not in {"new/new", "mixed"}:
        raise InstallerError("rollback source pair state is inconsistent")
    auth = {
        "schema": ROLLBACK_AUTH_SCHEMA, "target_commit": TARGET_COMMIT,
        "baseline_token": baseline["baseline_token"], "authorized_pair_state": pair_state,
        "authorized_member_states": member_states, "source_receipt_sha256": sha256_bytes(raw),
    }
    return auth, canonical_json(auth) + b"\n"


def rollback(commit: str, baseline_path: Path, source_receipt_path: Path) -> tuple[dict[str, Any], Path]:
    if commit != TARGET_COMMIT:
        raise InstallerError(f"rollback requires exact commit {TARGET_COMMIT}")
    target_blobs()
    operator = operator_bytes()
    baseline, baseline_raw = load_baseline(baseline_path, operator)
    authorization, authorization_raw = rollback_authorization(source_receipt_path, baseline)
    preflight = independent_terminal_readback(authorization["authorized_pair_state"], operator)
    observed_states = {
        key: preflight["operator"]["pair"]["members"][key]["state"]
        for key in PAIR_SPECS
    }
    if (
        observed_states != authorization["authorized_member_states"]
        or preflight["operator"]["seo_snapshot"] != baseline["remote"]["seo_snapshot"]
        or preflight["public"] != baseline["independent_public"]
    ):
        raise InstallerError("rollback preflight differs from authorization or SEO baseline")
    client = connect(APPLY_LOGIN)
    remote_dir = None
    invoked = False
    try:
        remote_dir = create_bundle(
            client, baseline, baseline_raw, operator,
            rollback_authorization=authorization_raw,
        )
        invoked = True
        try:
            result = invoke(client, "rollback", operator, remote_dir)
            validate_rollback_receipt(result, baseline, authorization)
            remote_receipt = download_bundle_file(client, remote_dir, "rollback-receipt.json")
            parsed = json.loads(remote_receipt.decode("utf-8"), object_pairs_hook=reject_duplicates)
            if parsed != result or remote_receipt != canonical_json(result) + b"\n":
                raise InstallerError("remote immutable rollback receipt differs from operator result")
            postflight = independent_terminal_readback("old/old", operator)
            if (
                postflight["operator"]["seo_snapshot"] != preflight["operator"]["seo_snapshot"]
                or postflight["public"] != preflight["public"]
            ):
                raise InstallerError("independent SEO state changed across pair rollback")
            cleanup_ok = cleanup_bundle(client, remote_dir)
            payload = {
                "schema": SCHEMA,
                "status": "rolled_back_verified" if cleanup_ok else "rolled_back_verified_cleanup_required",
                "mode": "rollback", "completed_at": utc_now(), "target_commit": TARGET_COMMIT,
                "baseline_token": baseline["baseline_token"], "authorization": authorization,
                "operator_receipt": result, "operator_receipt_sha256": sha256_bytes(remote_receipt),
                "independent_deploy_readback": postflight, "bundle_preserved": not cleanup_ok,
                "installed_scripts_executed": False, "rollback_retried": False,
                "current_unchanged_proved": True, "content_unchanged_proved": True,
            }
            return payload, write_receipt("rosomaha-release-pair-rollback", payload)
        except Exception as exc:
            if not invoked or remote_dir is None:
                raise
            client.close()
            recovered = recover_ambiguous(remote_dir, baseline, operator, exc)
            return recovered, write_receipt("rosomaha-release-pair-rollback-recovery", recovered)
    finally:
        client.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Fixed Rosomaha release/rollback pair installer")
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--apply", action="store_true")
    modes.add_argument("--recover", action="store_true")
    modes.add_argument("--rollback", action="store_true")
    parser.add_argument("--commit")
    parser.add_argument("--baseline", type=Path)
    parser.add_argument("--source-receipt", type=Path)
    args = parser.parse_args()
    try:
        if args.apply:
            if args.commit != TARGET_COMMIT or args.baseline is None:
                raise InstallerError(f"--apply requires --commit {TARGET_COMMIT} --baseline <receipt>")
            payload, receipt = apply(args.commit, args.baseline)
        elif args.recover:
            if args.commit != TARGET_COMMIT or args.baseline is None:
                raise InstallerError(f"--recover requires --commit {TARGET_COMMIT} --baseline <receipt>")
            payload, receipt = recover(args.commit, args.baseline)
        elif args.rollback:
            if args.commit != TARGET_COMMIT or args.baseline is None or args.source_receipt is None:
                raise InstallerError(
                    f"--rollback requires --commit {TARGET_COMMIT} --baseline <receipt> "
                    "--source-receipt <apply-or-recovery-receipt>"
                )
            payload, receipt = rollback(args.commit, args.baseline, args.source_receipt)
        else:
            payload, receipt = audit()
        print(json.dumps({"status": payload["status"], "receipt": str(receipt)}, ensure_ascii=False))
        return 0
    except Exception as exc:
        error = {
            "schema": SCHEMA, "status": "error", "error_type": type(exc).__name__,
            "error": sanitized_error(exc), "apply_retried": False,
        }
        receipt = write_receipt("rosomaha-release-pair-error", error)
        print(json.dumps({"status": "error", "error": error["error"], "receipt": str(receipt)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
