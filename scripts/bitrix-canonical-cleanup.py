#!/usr/bin/env python3
"""Fail-closed operator for the one pinned Bitrix canonical template file.

Audit, dry-run, and recover are read-only. Apply and rollback are explicit,
single-file operations. The operator has no host, path, URL, or account
arguments and never clears caches, syncs trees, or deletes broad paths.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import html
import json
import logging
import os
import re
import shlex
import stat
import subprocess
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urljoin, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

import paramiko


logging.getLogger("paramiko").setLevel(logging.CRITICAL)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = PROJECT_ROOT / ".env"
CANDIDATE_PATH = (
    PROJECT_ROOT
    / "integrations"
    / "legacy-bitrix"
    / "templates"
    / "aspro-allcorp3"
    / "header.php"
)
MANIFEST_PATH = CANDIDATE_PATH.with_name("manifest.json")
REPORT_ROOT = PROJECT_ROOT / "marketing-audits" / "bitrix-canonical"

HOST = "ocelot.beget.com"
PORT = 22
EXPECTED_LOGIN = "berkutm4"
EXPECTED_HOST_KEY_SHA256 = "9NXXK7D+NukzmR6c/Ov2rAZElXlr2s1oP0QAAmUWs+c"
SITE_ROOT = "/home/b/berkutm4/rosomaha-rus.ru/public_html"
TARGET_PATH = SITE_ROOT + "/bitrix/templates/aspro-allcorp3/header.php"
TARGET_DIRECTORY = TARGET_PATH.rsplit("/", 1)[0]
OPERATION_PARENT = "/home/b/berkutm4/migration/rosomaha-rus/ops"
OPERATION_ROOT = OPERATION_PARENT + "/bitrix-canonical-cleanup"

DOMAIN = "rosomaha-rus.ru"
PUBLIC_ORIGIN = "https://rosomaha-rus.ru"
PUBLIC_PROBES = (
    {
        "name": "root",
        "url": PUBLIC_ORIGIN + "/?utm_source=canonical_verify&YCLID=991001",
        "candidate_query": (),
    },
    {
        "name": "category",
        "url": (
            PUBLIC_ORIGIN
            + "/product/kvadrotsikly/?display=price&utm_medium=cpc&yclid=991002"
        ),
        "candidate_query": (("display", "price"),),
    },
    {
        "name": "product",
        "url": (
            PUBLIC_ORIGIN
            + "/product/extrime-s-1-5l-dvs-1nz-fe/?oid=812"
            + "&utm_campaign=canonical_verify&gclid=991003"
        ),
        "candidate_query": (("oid", "812"),),
    },
)
PUBLIC_ALLOWLIST = frozenset(item["url"] for item in PUBLIC_PROBES)

BASELINE_BYTES = 4897
BASELINE_SHA256 = "f5a8256054c4ee53d469ec5f17076e6ea5c438b2a061fec925e2643767997baf"
CANDIDATE_BYTES = 5598
CANDIDATE_SHA256 = "075909d8e940145077a47abfa2bc5ba32fc67ead66a0fd3ce86c54c4592251e7"
EXPECTED_MODE = 0o600
EXPECTED_UID = 8476
EXPECTED_GID = 601
OPERATION_ID = "bitrix-canonical-" + hashlib.sha256(
    f"{TARGET_PATH}|{BASELINE_SHA256}|{CANDIDATE_SHA256}".encode("ascii")
).hexdigest()[:24]

BASELINE_CANONICAL = (
    b'        <link rel="canonical" href="<?= $APPLICATION->GetCurPageParam() ?>" />'
)
CANDIDATE_CANONICAL = b"\n".join(
    (
        b"\t\t<?",
        b"\t\t$rosomahaCanonicalTrackingParams = array('yclid', 'gclid', 'fbclid', 'msclkid', '_openstat', 'gbraid', 'wbraid');",
        b"\t\t$rosomahaCanonicalKillParams = array();",
        b"\t\tforeach (array_keys($_GET) as $rosomahaCanonicalParamName) {",
        b"\t\t\t$rosomahaCanonicalParamName = (string)$rosomahaCanonicalParamName;",
        b"\t\t\t$rosomahaCanonicalParamNameLower = strtolower($rosomahaCanonicalParamName);",
        b"\t\t\tif (strpos($rosomahaCanonicalParamNameLower, 'utm_') === 0 || in_array($rosomahaCanonicalParamNameLower, $rosomahaCanonicalTrackingParams, true)) {",
        b"\t\t\t\t$rosomahaCanonicalKillParams[] = $rosomahaCanonicalParamName;",
        b"\t\t\t}",
        b"\t\t}",
        b"\t\t$rosomahaCanonicalHref = $APPLICATION->GetCurPageParam('', $rosomahaCanonicalKillParams);",
        b"\t\t?>",
        b'\t\t<link rel="canonical" href="<?=htmlspecialcharsbx($rosomahaCanonicalHref)?>" />',
    )
)

APPLY_GUARD_ENV = "ROSOMAHA_BITRIX_CANONICAL_APPLY"
APPLY_GUARD_VALUE = "APPLY_ONE_PINNED_HEADER_WITH_CAS"
ROLLBACK_GUARD_ENV = "ROSOMAHA_BITRIX_CANONICAL_ROLLBACK"
ROLLBACK_GUARD_VALUE = "ROLLBACK_ONE_PINNED_HEADER_BY_OPERATION_ID"
EXPECTED_PHP_SERIES = "8.2"
PHP_CANDIDATES = (
    "/usr/local/php/cgi/8.2/bin/php",
    "/usr/local/php/8.2/bin/php",
    "/usr/local/php82/bin/php",
    "/opt/php/8.2/bin/php",
    "/usr/bin/php8.2",
    "/usr/local/bin/php8.2",
)
MAX_HEADER_BYTES = 64_000
MAX_PUBLIC_BYTES = 4_000_000
MAX_REMOTE_OUTPUT = 32_000
MAX_RECEIPT_BYTES = 1_000_000
OWNED_FILES = (
    "integrations/legacy-bitrix/templates/aspro-allcorp3/header.php",
    "integrations/legacy-bitrix/templates/aspro-allcorp3/manifest.json",
    "scripts/bitrix-canonical-cleanup.py",
    "scripts/bitrix-canonical-cleanup.test.py",
)


class CanonicalOperatorError(RuntimeError):
    """A bounded operator error that contains no credentials."""


class CredentialError(CanonicalOperatorError):
    pass


class PublicVerificationError(CanonicalOperatorError):
    pass


class RejectRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        raise PublicVerificationError("Pinned public probe redirected")


class CanonicalParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.canonicals: list[str] = []
        self.nodes = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.nodes += 1
        if self.nodes > 75_000:
            raise PublicVerificationError("Public HTML node bound exceeded")
        values = {key.casefold(): value or "" for key, value in attrs}
        if tag.casefold() == "link" and "canonical" in values.get("rel", "").casefold().split():
            self.canonicals.append(values.get("href", ""))


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_error(exc: BaseException) -> str:
    text = str(exc) or type(exc).__name__
    for value in (EXPECTED_LOGIN, SITE_ROOT, str(ENV_PATH)):
        text = text.replace(value, "[pinned]")
    text = re.sub(r"(?i)(password|token|secret)\s*[=:]\s*\S+", r"\1=[redacted]", text)
    return f"{type(exc).__name__}: {text}"[:500]


def load_manifest(path: Path = MANIFEST_PATH) -> dict[str, Any]:
    try:
        root = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CanonicalOperatorError("Pinned manifest is unreadable") from exc
    if not isinstance(root, dict):
        raise CanonicalOperatorError("Pinned manifest root is invalid")
    source = root.get("source_export")
    candidate = root.get("candidate")
    if (
        root.get("schema") != "rosomaha-bitrix-template-file/v1"
        or root.get("domain") != DOMAIN
        or root.get("site_id") != "s1"
        or root.get("template_id") != "aspro-allcorp3"
        or root.get("remote_path") != TARGET_PATH
        or not isinstance(source, dict)
        or source.get("bytes") != BASELINE_BYTES
        or source.get("sha256") != BASELINE_SHA256
        or source.get("mode") != "0600"
        or source.get("uid") != EXPECTED_UID
        or source.get("gid") != EXPECTED_GID
        or not isinstance(candidate, dict)
        or candidate.get("file") != "header.php"
        or candidate.get("bytes") != CANDIDATE_BYTES
        or candidate.get("sha256") != CANDIDATE_SHA256
    ):
        raise CanonicalOperatorError("Pinned manifest identity/hash contract failed")
    return root


def reconstruct_baseline(candidate: bytes) -> bytes:
    if candidate.count(CANDIDATE_CANONICAL) != 1 or BASELINE_CANONICAL in candidate:
        raise CanonicalOperatorError("Candidate canonical block is not unique")
    return candidate.replace(CANDIDATE_CANONICAL, BASELINE_CANONICAL, 1)


def validate_candidate(path: Path = CANDIDATE_PATH) -> bytes:
    load_manifest()
    try:
        data = path.read_bytes()
        data.decode("utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise CanonicalOperatorError("Candidate header is unavailable or not UTF-8") from exc
    if len(data) != CANDIDATE_BYTES or sha256_bytes(data) != CANDIDATE_SHA256:
        raise CanonicalOperatorError("Candidate header hash/size differs from the manifest")
    if b"\r" in data or b"\x00" in data or not data.startswith(b"<?\n"):
        raise CanonicalOperatorError("Candidate header byte contract failed")
    required = (
        b"$APPLICATION->GetCurPageParam('', $rosomahaCanonicalKillParams)",
        b"htmlspecialcharsbx($rosomahaCanonicalHref)",
        b"array_keys($_GET)",
        b"strtolower($rosomahaCanonicalParamName)",
        b"strpos($rosomahaCanonicalParamNameLower, 'utm_') === 0",
    )
    if any(data.count(marker) != 1 for marker in required):
        raise CanonicalOperatorError("Candidate canonical API/escaping contract failed")
    if data.count(b'rel="canonical"') != 1 or b"OnEndBufferContent" in data:
        raise CanonicalOperatorError("Candidate canonical handler count is unsafe")
    baseline = reconstruct_baseline(data)
    if len(baseline) != BASELINE_BYTES or sha256_bytes(baseline) != BASELINE_SHA256:
        raise CanonicalOperatorError("Candidate differs from export outside canonical generation")
    return data


def local_php_lint(candidate: bytes) -> dict[str, Any]:
    result = subprocess.run(
        ["php", "-d", "short_open_tag=1", "-l", str(CANDIDATE_PATH)],
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=20,
        check=False,
    )
    if result.returncode != 0 or "No syntax errors detected" not in result.stdout:
        raise CanonicalOperatorError("Local PHP lint rejected the candidate")
    return {"status": "pass", "candidate_sha256": sha256_bytes(candidate)}


def _parse_env_value(raw: str) -> str:
    value = raw.strip()
    if not value:
        raise CredentialError("Pinned credential value is empty")
    if value[:1] in {'"', "'"}:
        if len(value) < 2 or value[-1] != value[0]:
            raise CredentialError("Pinned credential quoting is malformed")
        value = value[1:-1]
    elif value[-1:] in {'"', "'"}:
        raise CredentialError("Pinned credential quoting is malformed")
    if not value or "\r" in value or "\n" in value:
        raise CredentialError("Pinned credential value is invalid")
    return value


def credentials_from_text(text: str) -> tuple[str, str]:
    found: dict[str, list[str]] = {"BEGET_LOGIN": [], "BEGET_PASSWORD": []}
    pattern = re.compile(r"^\s*(?:export\s+)?(BEGET_LOGIN|BEGET_PASSWORD)\s*=\s*(.*?)\s*$")
    for line in text.splitlines():
        match = pattern.fullmatch(line)
        if match:
            found[match.group(1)].append(match.group(2))
    if any(found.values()):
        if any(len(found[key]) != 1 for key in found):
            raise CredentialError("Pinned credential source is ambiguous")
        return _parse_env_value(found["BEGET_LOGIN"][0]), _parse_env_value(found["BEGET_PASSWORD"][0])
    legacy = re.findall(
        r"https://cp\.beget\.com/\s+логин\s+(\S+)\s+пароль\s+(\S+)",
        text,
        flags=re.IGNORECASE,
    )
    if len(legacy) != 1:
        raise CredentialError("Pinned credentials were not found exactly once")
    return _parse_env_value(legacy[0][0]), _parse_env_value(legacy[0][1])


def load_credentials(
    *, environ: Mapping[str, str] | None = None, env_path: Path = ENV_PATH
) -> tuple[str, str]:
    source = os.environ if environ is None else environ
    present = {key: key in source for key in ("BEGET_LOGIN", "BEGET_PASSWORD")}
    if any(present.values()):
        if not all(present.values()):
            raise CredentialError("Pinned environment credentials are incomplete")
        login = _parse_env_value(str(source["BEGET_LOGIN"]))
        password = _parse_env_value(str(source["BEGET_PASSWORD"]))
    else:
        if not env_path.is_file():
            raise CredentialError("Pinned project credential source is missing")
        login, password = credentials_from_text(env_path.read_text(encoding="utf-8-sig"))
    if login != EXPECTED_LOGIN:
        raise CredentialError("Unexpected Beget account; connection refused")
    return login, password


class PinnedHostKeyPolicy(paramiko.MissingHostKeyPolicy):
    def missing_host_key(
        self, client: paramiko.SSHClient, hostname: str, key: paramiko.PKey
    ) -> None:
        digest = base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode("ascii").rstrip("=")
        if hostname != HOST or digest != EXPECTED_HOST_KEY_SHA256:
            raise paramiko.SSHException("Pinned Beget SSH host key mismatch")
        client.get_host_keys().add(hostname, key.get_name(), key)


def connect(
    *, environ: Mapping[str, str] | None = None, env_path: Path = ENV_PATH
) -> paramiko.SSHClient:
    login, password = load_credentials(environ=environ, env_path=env_path)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(PinnedHostKeyPolicy())
    try:
        client.connect(
            HOST,
            port=PORT,
            username=login,
            password=password,
            timeout=20,
            banner_timeout=20,
            auth_timeout=20,
            look_for_keys=False,
            allow_agent=False,
        )
        transport = client.get_transport()
        if transport is None:
            raise CanonicalOperatorError("SSH transport is unavailable")
        digest = base64.b64encode(
            hashlib.sha256(transport.get_remote_server_key().asbytes()).digest()
        ).decode("ascii").rstrip("=")
        if digest != EXPECTED_HOST_KEY_SHA256:
            raise CanonicalOperatorError("Pinned Beget SSH host key mismatch")
        return client
    except Exception:
        client.close()
        raise


def _missing(exc: BaseException) -> bool:
    return isinstance(exc, FileNotFoundError) or getattr(exc, "errno", None) == 2


def _attrs_dict(attrs: Any) -> dict[str, Any]:
    return {
        "bytes": int(attrs.st_size),
        "mode": f"{stat.S_IMODE(attrs.st_mode):04o}",
        "uid": int(attrs.st_uid),
        "gid": int(attrs.st_gid),
        "regular_non_symlink": bool(stat.S_ISREG(attrs.st_mode)),
    }


def read_remote_file(sftp: Any, path: str, *, limit: int = MAX_HEADER_BYTES) -> tuple[bytes, dict[str, Any]]:
    attrs = sftp.lstat(path)
    info = _attrs_dict(attrs)
    if not info["regular_non_symlink"] or info["bytes"] < 1 or info["bytes"] > limit:
        raise CanonicalOperatorError("Pinned remote file type/size is unsafe")
    with sftp.open(path, "rb") as handle:
        data = handle.read(limit + 1)
    if len(data) != info["bytes"] or len(data) > limit:
        raise CanonicalOperatorError("Pinned remote file readback is incomplete")
    info["sha256"] = sha256_bytes(data)
    return data, info


def validate_target_metadata(info: Mapping[str, Any]) -> None:
    if (
        info.get("mode") != f"{EXPECTED_MODE:04o}"
        or info.get("uid") != EXPECTED_UID
        or info.get("gid") != EXPECTED_GID
        or info.get("regular_non_symlink") is not True
    ):
        raise CanonicalOperatorError("Pinned target mode/ownership identity drifted")


def classify_remote_target(sftp: Any) -> dict[str, Any]:
    data, info = read_remote_file(sftp, TARGET_PATH)
    validate_target_metadata(info)
    if info["sha256"] == BASELINE_SHA256 and len(data) == BASELINE_BYTES:
        state = "baseline"
    elif info["sha256"] == CANDIDATE_SHA256 and len(data) == CANDIDATE_BYTES:
        state = "candidate"
    else:
        raise CanonicalOperatorError("Remote target differs from both pinned safe states")
    return {"state": state, **info}


def _exec_bounded(client: Any, command: str, *, timeout: int = 30) -> tuple[int, bytes, bytes]:
    _, stdout, _ = client.exec_command(command, timeout=20)
    channel = stdout.channel
    out = bytearray()
    err = bytearray()
    deadline = time.monotonic() + timeout
    while True:
        while channel.recv_ready():
            out.extend(channel.recv(8192))
        while channel.recv_stderr_ready():
            err.extend(channel.recv_stderr(4096))
        if len(out) > MAX_REMOTE_OUTPUT or len(err) > MAX_REMOTE_OUTPUT:
            channel.close()
            raise CanonicalOperatorError("Remote command output exceeded its bound")
        if channel.exit_status_ready():
            while channel.recv_ready():
                out.extend(channel.recv(8192))
            while channel.recv_stderr_ready():
                err.extend(channel.recv_stderr(4096))
            return channel.recv_exit_status(), bytes(out), bytes(err)
        if time.monotonic() >= deadline:
            channel.close()
            raise CanonicalOperatorError("Remote command timed out")
        time.sleep(0.05)


def discover_php(client: Any) -> str:
    for path in PHP_CANDIDATES:
        command = f"test -x {shlex.quote(path)} && {shlex.quote(path)} -r 'echo PHP_MAJOR_VERSION,\".\",PHP_MINOR_VERSION;'"
        status, out, err = _exec_bounded(client, command)
        if status == 0 and not err and out.decode("ascii", "strict") == EXPECTED_PHP_SERIES:
            return path
    raise CanonicalOperatorError("Pinned PHP 8.2 CLI was not found")


def remote_php_lint(client: Any, php_binary: str, path: str) -> dict[str, Any]:
    if php_binary not in PHP_CANDIDATES or path not in {
        TARGET_PATH,
        TARGET_DIRECTORY + f"/.header.{OPERATION_ID}.candidate.php",
        TARGET_DIRECTORY + f"/.header.{OPERATION_ID}.rollback.php",
    }:
        raise CanonicalOperatorError("Remote PHP lint path is outside the fixed allowlist")
    command = f"{shlex.quote(php_binary)} -d short_open_tag=1 -l {shlex.quote(path)}"
    status, out, err = _exec_bounded(client, command)
    combined = out + err
    if status != 0 or b"No syntax errors detected" not in combined:
        raise CanonicalOperatorError("Remote PHP lint rejected the pinned header")
    return {"status": "pass", "php_series": EXPECTED_PHP_SERIES}


def fetch_probe(url: str) -> bytes:
    if url not in PUBLIC_ALLOWLIST:
        raise ValueError("Public URL is outside the fixed allowlist")
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.netloc != DOMAIN or parsed.fragment:
        raise ValueError("Public probe identity is invalid")
    request = Request(
        url,
        headers={
            "Accept": "text/html",
            "Cache-Control": "no-cache",
            "User-Agent": "RosomahaCanonicalCleanup/1.0",
        },
    )
    try:
        with build_opener(RejectRedirects()).open(request, timeout=30) as response:
            body = response.read(MAX_PUBLIC_BYTES + 1)
            status = int(response.status)
            final_url = response.geturl()
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        raise PublicVerificationError(f"Pinned public read failed: {type(exc).__name__}") from exc
    if status != 200 or final_url != url or not body or len(body) > MAX_PUBLIC_BYTES:
        raise PublicVerificationError("Pinned public response status/identity/size is invalid")
    return body


def validate_public_html(
    request_url: str,
    body: bytes,
    *,
    expected_state: str,
    candidate_query: Sequence[tuple[str, str]],
) -> dict[str, Any]:
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise PublicVerificationError("Public HTML is not UTF-8") from exc
    parser = CanonicalParser()
    parser.feed(text)
    parser.close()
    if len(parser.canonicals) != 1:
        raise PublicVerificationError("Public page does not contain one canonical")
    canonical = urljoin(request_url, html.unescape(parser.canonicals[0]))
    request = urlparse(request_url)
    target = urlparse(canonical)
    if (
        target.scheme != "https"
        or target.netloc != DOMAIN
        or target.path != request.path
        or target.fragment
        or target.username is not None
        or target.password is not None
        or target.port is not None
    ):
        raise PublicVerificationError("Public canonical host/path identity is invalid")
    observed = tuple(parse_qsl(target.query, keep_blank_values=True))
    expected = (
        tuple(parse_qsl(request.query, keep_blank_values=True))
        if expected_state == "baseline"
        else tuple(candidate_query)
    )
    if Counter(observed) != Counter(expected):
        raise PublicVerificationError("Public canonical query does not match the expected state")
    if expected_state == "candidate":
        for key, _ in observed:
            folded = key.casefold()
            if folded.startswith("utm_") or folded in {
                "yclid", "gclid", "fbclid", "msclkid", "_openstat", "gbraid", "wbraid",
            }:
                raise PublicVerificationError("Tracking parameter survived in public canonical")
    return {
        "status": 200,
        "canonical": canonical,
        "query": list(observed),
        "html_sha256": sha256_bytes(body),
    }


def verify_public(expected_state: str, *, fetcher: Callable[[str], bytes] = fetch_probe) -> list[dict[str, Any]]:
    if expected_state not in {"baseline", "candidate"}:
        raise ValueError("Expected public state is invalid")
    results = []
    for probe in PUBLIC_PROBES:
        body = fetcher(str(probe["url"]))
        verified = validate_public_html(
            str(probe["url"]),
            body,
            expected_state=expected_state,
            candidate_query=probe["candidate_query"],
        )
        results.append({"name": probe["name"], "url": probe["url"], **verified})
    return results


def _operation_paths(operation_id: str) -> dict[str, str]:
    if operation_id != OPERATION_ID:
        raise CanonicalOperatorError("Operation id does not match the pinned candidate")
    operation_dir = OPERATION_ROOT + "/" + operation_id
    return {
        "directory": operation_dir,
        "backup": operation_dir + "/header.php.before",
        "receipt": operation_dir + "/operation.json",
        "rollback_receipt": operation_dir + "/rollback.json",
        "candidate_temp": TARGET_DIRECTORY + f"/.header.{operation_id}.candidate.php",
        "rollback_temp": TARGET_DIRECTORY + f"/.header.{operation_id}.rollback.php",
    }


def _exists(sftp: Any, path: str) -> bool:
    try:
        sftp.lstat(path)
        return True
    except OSError as exc:
        if _missing(exc):
            return False
        raise


def _require_directory(sftp: Any, path: str) -> dict[str, Any]:
    attrs = sftp.lstat(path)
    if not stat.S_ISDIR(attrs.st_mode):
        raise CanonicalOperatorError("Pinned remote parent is not a directory")
    return {
        "mode": f"{stat.S_IMODE(attrs.st_mode):04o}",
        "uid": int(attrs.st_uid),
        "gid": int(attrs.st_gid),
        "directory_non_symlink": True,
    }


def _make_operation_directory(sftp: Any, paths: Mapping[str, str]) -> None:
    _require_directory(sftp, OPERATION_PARENT)
    if not _exists(sftp, OPERATION_ROOT):
        sftp.mkdir(OPERATION_ROOT, 0o700)
        sftp.chmod(OPERATION_ROOT, 0o700)
    root = _require_directory(sftp, OPERATION_ROOT)
    if root["uid"] != EXPECTED_UID or (int(root["mode"], 8) & 0o022):
        raise CanonicalOperatorError("Pinned operation root ownership/mode is unsafe")
    if _exists(sftp, paths["directory"]):
        raise CanonicalOperatorError("Operation directory already exists; run recover")
    sftp.mkdir(paths["directory"], 0o700)
    sftp.chmod(paths["directory"], 0o700)
    directory = _require_directory(sftp, paths["directory"])
    if directory["uid"] != EXPECTED_UID or directory["mode"] != "0700":
        raise CanonicalOperatorError("Operation directory identity/mode is unsafe")


def _write_exact_file(
    sftp: Any,
    path: str,
    data: bytes,
    *,
    mode: int,
    uid: int,
    gid: int,
) -> dict[str, Any]:
    if _exists(sftp, path):
        raise CanonicalOperatorError("Exact remote artifact already exists")
    with sftp.open(path, "x") as handle:
        handle.write(data)
        handle.flush()
    sftp.chmod(path, mode)
    sftp.chown(path, uid, gid)
    readback, info = read_remote_file(sftp, path, limit=max(MAX_HEADER_BYTES, len(data)))
    if readback != data or info["mode"] != f"{mode:04o}" or info["uid"] != uid or info["gid"] != gid:
        raise CanonicalOperatorError("Exact remote artifact readback/metadata failed")
    return info


def _atomic_replace(sftp: Any, source: str, destination: str) -> None:
    try:
        sftp.posix_rename(source, destination)
    except (AttributeError, IOError) as exc:
        raise CanonicalOperatorError("Server did not prove atomic POSIX rename") from exc


def _write_remote_receipt(sftp: Any, path: str, payload: Mapping[str, Any]) -> dict[str, Any]:
    data = json.dumps(dict(payload), sort_keys=True, separators=(",", ":")).encode("utf-8") + b"\n"
    if len(data) > 64_000 or _contains_forbidden_key(payload):
        raise CanonicalOperatorError("Remote operation receipt is unsafe")
    return _write_exact_file(
        sftp, path, data, mode=0o600, uid=EXPECTED_UID, gid=EXPECTED_GID
    )


def _remove_exact_temp(sftp: Any, path: str) -> None:
    if path not in {
        _operation_paths(OPERATION_ID)["candidate_temp"],
        _operation_paths(OPERATION_ID)["rollback_temp"],
    }:
        raise CanonicalOperatorError("Temporary cleanup path is not exact")
    if _exists(sftp, path):
        sftp.remove(path)


def _restore_backup(
    client: Any,
    sftp: Any,
    paths: Mapping[str, str],
    *,
    require_candidate: bool,
    public_verifier: Callable[[str], list[dict[str, Any]]],
) -> dict[str, Any]:
    backup, backup_info = read_remote_file(sftp, paths["backup"])
    if len(backup) != BASELINE_BYTES or backup_info["sha256"] != BASELINE_SHA256:
        raise CanonicalOperatorError("Exact operation backup is missing or invalid")
    current = classify_remote_target(sftp)
    if current["state"] == "baseline":
        return {"status": "already_rolled_back", "before": current, "after": current}
    if require_candidate and current["state"] != "candidate":
        raise CanonicalOperatorError("Rollback CAS requires the pinned candidate")
    _remove_exact_temp(sftp, paths["rollback_temp"])
    _write_exact_file(
        sftp,
        paths["rollback_temp"],
        backup,
        mode=EXPECTED_MODE,
        uid=EXPECTED_UID,
        gid=EXPECTED_GID,
    )
    php_binary = discover_php(client)
    lint = remote_php_lint(client, php_binary, paths["rollback_temp"])
    if classify_remote_target(sftp)["state"] != "candidate":
        raise CanonicalOperatorError("Rollback CAS changed before atomic replacement")
    _atomic_replace(sftp, paths["rollback_temp"], TARGET_PATH)
    after = classify_remote_target(sftp)
    if after["state"] != "baseline":
        raise CanonicalOperatorError("Rollback post-write SHA failed")
    public = public_verifier("baseline")
    return {"status": "rolled_back", "before": current, "after": after, "php_lint": lint, "public": public}


def apply_remote(
    client: Any,
    candidate: bytes,
    *,
    public_verifier: Callable[[str], list[dict[str, Any]]] = verify_public,
) -> dict[str, Any]:
    sftp = client.open_sftp()
    paths = _operation_paths(OPERATION_ID)
    switched = False
    try:
        before = classify_remote_target(sftp)
        if before["state"] != "baseline" or before["sha256"] != BASELINE_SHA256:
            raise CanonicalOperatorError("Apply CAS requires the exact pinned source SHA")
        public_before = public_verifier("baseline")
        _make_operation_directory(sftp, paths)
        baseline, _ = read_remote_file(sftp, TARGET_PATH)
        backup = _write_exact_file(
            sftp,
            paths["backup"],
            baseline,
            mode=EXPECTED_MODE,
            uid=EXPECTED_UID,
            gid=EXPECTED_GID,
        )
        candidate_info = _write_exact_file(
            sftp,
            paths["candidate_temp"],
            candidate,
            mode=EXPECTED_MODE,
            uid=EXPECTED_UID,
            gid=EXPECTED_GID,
        )
        php_binary = discover_php(client)
        lint = remote_php_lint(client, php_binary, paths["candidate_temp"])
        cas = classify_remote_target(sftp)
        if cas != before:
            raise CanonicalOperatorError("Apply CAS changed before atomic replacement")
        _atomic_replace(sftp, paths["candidate_temp"], TARGET_PATH)
        switched = True
        after = classify_remote_target(sftp)
        if after["state"] != "candidate" or after["sha256"] != CANDIDATE_SHA256:
            raise CanonicalOperatorError("Apply post-write SHA failed")
        public_after = public_verifier("candidate")
        receipt_payload = {
            "schema": 1,
            "operation_id": OPERATION_ID,
            "status": "applied",
            "target_path": TARGET_PATH,
            "backup_path": paths["backup"],
            "backup_outside_docroot": not paths["backup"].startswith(SITE_ROOT + "/"),
            "before": before,
            "candidate_temp": candidate_info,
            "backup": backup,
            "php_lint": lint,
            "after": after,
            "public_after": public_after,
            "filesystem_scope": "one_exact_file",
        }
        remote_receipt = _write_remote_receipt(sftp, paths["receipt"], receipt_payload)
        return {
            **receipt_payload,
            "public_before": public_before,
            "remote_receipt": remote_receipt,
            "atomic_replace": True,
            "mode_ownership_preserved": True,
        }
    except Exception as exc:
        if switched:
            try:
                rollback = _restore_backup(
                    client,
                    sftp,
                    paths,
                    require_candidate=True,
                    public_verifier=public_verifier,
                )
            except Exception as rollback_exc:
                raise CanonicalOperatorError(
                    f"Apply failed and automatic rollback needs recover: {safe_error(rollback_exc)}"
                ) from exc
            raise CanonicalOperatorError(
                f"Apply failed after switch; exact backup restored ({rollback['status']})"
            ) from exc
        try:
            _remove_exact_temp(sftp, paths["candidate_temp"])
        except Exception:
            pass
        raise
    finally:
        sftp.close()


def recover_remote(client: Any, operation_id: str) -> dict[str, Any]:
    paths = _operation_paths(operation_id)
    sftp = client.open_sftp()
    try:
        active = classify_remote_target(sftp)
        if not _exists(sftp, paths["directory"]):
            return {"classification": "not_started", "active": active, "read_only": True}
        directory = _require_directory(sftp, paths["directory"])
        backup = None
        if _exists(sftp, paths["backup"]):
            _, backup = read_remote_file(sftp, paths["backup"])
        receipt_exists = _exists(sftp, paths["receipt"])
        rollback_receipt_exists = _exists(sftp, paths["rollback_receipt"])
        temps = {
            "candidate": _exists(sftp, paths["candidate_temp"]),
            "rollback": _exists(sftp, paths["rollback_temp"]),
        }
        backup_valid = bool(
            backup
            and backup.get("sha256") == BASELINE_SHA256
            and backup.get("bytes") == BASELINE_BYTES
        )
        if active["state"] == "candidate" and backup_valid and receipt_exists:
            classification = "applied"
        elif active["state"] == "candidate" and backup_valid:
            classification = "candidate_without_receipt"
        elif active["state"] == "baseline" and backup_valid and rollback_receipt_exists:
            classification = "rolled_back"
        elif active["state"] == "baseline" and backup_valid:
            classification = "backup_only_or_auto_rolled_back"
        else:
            classification = "indeterminate"
        return {
            "classification": classification,
            "active": active,
            "operation_directory": directory,
            "backup": backup,
            "receipt_exists": receipt_exists,
            "rollback_receipt_exists": rollback_receipt_exists,
            "temporary_files": temps,
            "read_only": True,
        }
    finally:
        sftp.close()


def rollback_remote(
    client: Any,
    operation_id: str,
    *,
    public_verifier: Callable[[str], list[dict[str, Any]]] = verify_public,
) -> dict[str, Any]:
    paths = _operation_paths(operation_id)
    sftp = client.open_sftp()
    try:
        result = _restore_backup(
            client,
            sftp,
            paths,
            require_candidate=True,
            public_verifier=public_verifier,
        )
        payload = {
            "schema": 1,
            "operation_id": operation_id,
            "status": result["status"],
            "target_path": TARGET_PATH,
            "backup_path": paths["backup"],
            "result": result,
            "filesystem_scope": "one_exact_file",
        }
        if result["status"] == "rolled_back":
            payload["remote_receipt"] = _write_remote_receipt(
                sftp, paths["rollback_receipt"], payload
            )
        return payload
    finally:
        sftp.close()


def remote_snapshot(client: Any) -> dict[str, Any]:
    sftp = client.open_sftp()
    try:
        state = classify_remote_target(sftp)
        operation = {
            "operation_id": OPERATION_ID,
            "directory_exists": _exists(sftp, _operation_paths(OPERATION_ID)["directory"]),
            "backup_outside_docroot": not _operation_paths(OPERATION_ID)["backup"].startswith(SITE_ROOT + "/"),
        }
        return {"target": state, "operation": operation}
    finally:
        sftp.close()


def _contains_forbidden_key(value: Any) -> bool:
    if isinstance(value, Mapping):
        return any(
            re.search(r"(?i)password|token|secret|credential", str(key))
            or _contains_forbidden_key(item)
            for key, item in value.items()
        )
    if isinstance(value, (list, tuple)):
        return any(_contains_forbidden_key(item) for item in value)
    return False


def write_receipt(kind: str, payload: Mapping[str, Any]) -> Path:
    if re.fullmatch(r"[a-z-]{3,24}", kind) is None or _contains_forbidden_key(payload):
        raise CanonicalOperatorError("Local receipt payload is unsafe")
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%fZ")
    path = REPORT_ROOT / f"ROSOMAHA_BITRIX_CANONICAL_{stamp}_{kind.upper()}.json"
    body = json.dumps(dict(payload), ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
    if len(body) > MAX_RECEIPT_BYTES:
        raise CanonicalOperatorError("Local receipt exceeds its bound")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb", closefd=False) as handle:
            handle.write(body)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(path, stat.S_IREAD)
    finally:
        os.close(fd)
    return path


def git_head() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=PROJECT_ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    head = result.stdout.strip()
    if re.fullmatch(r"[a-f0-9]{40}", head) is None:
        raise CanonicalOperatorError("Git HEAD is invalid")
    return head


def require_committed_operator() -> str:
    subprocess.run(
        ["git", "diff", "--quiet", "HEAD", "--", *OWNED_FILES],
        cwd=PROJECT_ROOT,
        check=True,
    )
    for name in OWNED_FILES:
        subprocess.run(
            ["git", "ls-files", "--error-unmatch", "--", name],
            cwd=PROJECT_ROOT,
            check=True,
            capture_output=True,
        )
    return git_head()


def _receipt_base(mode: str) -> dict[str, Any]:
    return {
        "schema": 1,
        "mode": mode,
        "operation_id": OPERATION_ID,
        "created_at_utc": utc_now(),
        "domain": DOMAIN,
        "site_id": "s1",
        "template_id": "aspro-allcorp3",
        "target_path": TARGET_PATH,
        "baseline": {"bytes": BASELINE_BYTES, "sha256": BASELINE_SHA256},
        "candidate": {"bytes": CANDIDATE_BYTES, "sha256": CANDIDATE_SHA256},
        "remote_writes_requested": mode in {"apply", "rollback"},
        "sensitive_values_exported": False,
    }


def _connect_and_close(action: Callable[[Any], dict[str, Any]]) -> dict[str, Any]:
    client = connect()
    try:
        return action(client)
    finally:
        client.close()


def run_audit() -> tuple[dict[str, Any], Path]:
    candidate = validate_candidate()
    lint = local_php_lint(candidate)
    remote = _connect_and_close(remote_snapshot)
    public = verify_public(remote["target"]["state"])
    payload = _receipt_base("audit") | {
        "status": "ok",
        "read_only": True,
        "local_php_lint": lint,
        "remote": remote,
        "public": public,
    }
    return payload, write_receipt("audit", payload)


def run_dry_run() -> tuple[dict[str, Any], Path]:
    candidate = validate_candidate()
    lint = local_php_lint(candidate)
    remote = _connect_and_close(remote_snapshot)
    if remote["target"]["state"] != "baseline":
        raise CanonicalOperatorError("Dry-run requires the exact baseline SHA")
    public = verify_public("baseline")
    payload = _receipt_base("dry-run") | {
        "status": "ready",
        "read_only": True,
        "local_php_lint": lint,
        "remote": remote,
        "public": public,
        "planned": {
            "backup": _operation_paths(OPERATION_ID)["backup"],
            "backup_outside_docroot": True,
            "candidate_php_lint_before_switch": True,
            "atomic_exact_file_replace": True,
            "preserve_mode_uid_gid": True,
            "public_probes": [item["name"] for item in PUBLIC_PROBES],
        },
    }
    return payload, write_receipt("dry-run", payload)


def run_apply(*, environ: Mapping[str, str] | None = None) -> tuple[dict[str, Any], Path]:
    source = os.environ if environ is None else environ
    if source.get(APPLY_GUARD_ENV) != APPLY_GUARD_VALUE:
        raise CanonicalOperatorError("Explicit apply guard is missing")
    head = require_committed_operator()
    candidate = validate_candidate()
    lint = local_php_lint(candidate)
    pending = _receipt_base("apply") | {
        "status": "pending",
        "git_head": head,
        "local_php_lint": lint,
        "dispatch_limit": 1,
    }
    pending_path = write_receipt("pending", pending)
    remote = _connect_and_close(lambda client: apply_remote(client, candidate))
    payload = _receipt_base("apply") | {
        "status": "applied",
        "git_head": head,
        "pending_receipt": pending_path.name,
        "remote": remote,
        "apply_dispatches": 1,
    }
    return payload, write_receipt("apply", payload)


def run_recover(operation_id: str) -> tuple[dict[str, Any], Path]:
    validate_candidate()
    remote = _connect_and_close(lambda client: recover_remote(client, operation_id))
    payload = _receipt_base("recover") | {
        "status": remote["classification"],
        "read_only": True,
        "requested_operation_id": operation_id,
        "remote": remote,
    }
    return payload, write_receipt("recover", payload)


def run_rollback(
    operation_id: str, *, environ: Mapping[str, str] | None = None
) -> tuple[dict[str, Any], Path]:
    source = os.environ if environ is None else environ
    if source.get(ROLLBACK_GUARD_ENV) != ROLLBACK_GUARD_VALUE:
        raise CanonicalOperatorError("Explicit rollback guard is missing")
    head = require_committed_operator()
    validate_candidate()
    pending = _receipt_base("rollback") | {
        "status": "pending",
        "git_head": head,
        "requested_operation_id": operation_id,
        "dispatch_limit": 1,
    }
    pending_path = write_receipt("pending", pending)
    remote = _connect_and_close(lambda client: rollback_remote(client, operation_id))
    payload = _receipt_base("rollback") | {
        "status": remote["status"],
        "git_head": head,
        "pending_receipt": pending_path.name,
        "remote": remote,
        "rollback_dispatches": 1,
    }
    return payload, write_receipt("rollback", payload)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Pinned rosomaha-rus.ru canonical cleanup operator")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--audit", action="store_true")
    group.add_argument("--dry-run", action="store_true")
    group.add_argument("--apply", action="store_true")
    group.add_argument("--recover", metavar="OPERATION_ID")
    group.add_argument("--rollback", metavar="OPERATION_ID")
    return parser.parse_args(list(sys.argv[1:] if argv is None else argv))


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    mode = "audit" if args.audit else "dry-run" if args.dry_run else "apply" if args.apply else "recover" if args.recover else "rollback"
    try:
        if args.audit:
            payload, receipt = run_audit()
        elif args.dry_run:
            payload, receipt = run_dry_run()
        elif args.apply:
            payload, receipt = run_apply()
        elif args.recover:
            payload, receipt = run_recover(args.recover)
        else:
            payload, receipt = run_rollback(args.rollback)
        print(json.dumps({"status": payload["status"], "receipt": str(receipt)}, ensure_ascii=False))
        return 0
    except Exception as exc:
        error = _receipt_base(mode) | {"status": "error", "error": safe_error(exc)}
        try:
            receipt = write_receipt("error", error)
            suffix = f"; receipt={receipt}"
        except Exception:
            suffix = ""
        print(f"Ошибка фиксированной операции canonical: {safe_error(exc)}{suffix}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
