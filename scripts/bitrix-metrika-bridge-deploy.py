#!/usr/bin/env python3
"""Fail-closed deployment operator for the rosomaha-rus.ru Metrika bridge.

The host, account and four production targets are intentionally fixed.  Audit
and dry-run are read-only.  Apply and rollback require explicit environment
guards, exact baseline/candidate CAS, same-directory atomic renames, immutable
backups outside the document root and redacted receipts.

The local runtime JSON is parsed and reduced to the two values consumed by the
PHP bridge.  Its Measurement Protocol credential is never printed, logged,
hashed into an operation id or stored in a receipt.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import logging
import os
import re
import shlex
import stat
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

import paramiko


logging.getLogger("paramiko").setLevel(logging.CRITICAL)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = PROJECT_ROOT / ".env"
BRIDGE_SOURCE = (
    PROJECT_ROOT
    / "integrations"
    / "legacy-bitrix"
    / "local"
    / "php_interface"
    / "rosomaha_crm_bridge.php"
)
RUNTIME_SOURCE = (
    PROJECT_ROOT
    / ".local-artifacts"
    / "yandex-metrika"
    / "rosomaha-rus-runtime.json"
)
REPORT_ROOT = PROJECT_ROOT / "marketing-audits" / "bitrix-metrika"

HOST = "ocelot.beget.com"
PORT = 22
EXPECTED_LOGIN = "berkutm4"
EXPECTED_HOST_KEY_SHA256 = "9NXXK7D+NukzmR6c/Ov2rAZElXlr2s1oP0QAAmUWs+c"
EXPECTED_UID = 8476
EXPECTED_GID = 601

HOME_ROOT = "/home/b/berkutm4"
SITE_ROOT = HOME_ROOT + "/rosomaha-rus.ru/public_html"
PHP_INTERFACE_DIRECTORY = SITE_ROOT + "/local/php_interface"
BRIDGE_PATH = PHP_INTERFACE_DIRECTORY + "/rosomaha_crm_bridge.php"
INIT_PATH = PHP_INTERFACE_DIRECTORY + "/init.php"
COUNTER_DIRECTORY = SITE_ROOT + "/include"
COUNTER_PATH = COUNTER_DIRECTORY + "/invis-counter.php"
CONFIG_PARENT = HOME_ROOT + "/.config"
CONFIG_DIRECTORY = CONFIG_PARENT + "/rosomaha"
CONFIG_PATH = CONFIG_DIRECTORY + "/metrika.json"
OPERATION_PARENT = HOME_ROOT + "/migration/rosomaha-rus/ops"
OPERATION_ROOT = OPERATION_PARENT + "/bitrix-metrika-bridge"

DOMAIN = "rosomaha-rus.ru"
PUBLIC_ORIGIN = "https://rosomaha-rus.ru"
OLD_COUNTER_ID = 50606578
TARGET_COUNTER_ID = 111905412

# Exported read-only from production on 2026-08-24.  Apply accepts no other
# pre-deployment bridge or counter state.
BRIDGE_BASELINE_BYTES = 28_581
BRIDGE_BASELINE_SHA256 = "7ccfa6f65a841ac5361fe80c3b628c0ecae45e802a93a7c3b05b3c634af9ee85"
BRIDGE_CANDIDATE_BYTES = 53_777
BRIDGE_CANDIDATE_SHA256 = "29ea870f2d17c553844eeef5aa66acbe5fd9902a22b51bb53925525433985e67"
COUNTER_BASELINE_BYTES = 7_122
COUNTER_BASELINE_SHA256 = "4e137416b98ce58b81e5e69a9806d9f9859e9c0eaab2fef8517b4c11195d6475"
COUNTER_CANDIDATE_BYTES = 7_284
COUNTER_CANDIDATE_SHA256 = "c9a59044c7b8778086a64a5ea6921a222a6bb2aa55c86df9db0f794bb1d7beb3"

INIT_BASELINE_BYTES = 1_268
INIT_BASELINE_SHA256 = "442b437a13d6ca39c27c2256cdcf9cfde7163c184cca4514d48be395b25a0175"

EXPECTED_FILE_MODE = 0o600
EXPECTED_DIRECTORY_MODE = 0o700
MAX_FILE_BYTES = 160_000
MAX_RUNTIME_BYTES = 8_192
MAX_RECEIPT_BYTES = 1_000_000
MAX_REMOTE_OUTPUT = 32_000
MAX_PUBLIC_BYTES = 4_000_000
EXPECTED_PHP_SERIES = "8.2"
PHP_CANDIDATES = (
    "/usr/local/php/cgi/8.2/bin/php",
    "/usr/local/php/8.2/bin/php",
    "/usr/local/php82/bin/php",
    "/opt/php/8.2/bin/php",
    "/usr/bin/php8.2",
    "/usr/local/bin/php8.2",
)

INCLUDE_REFERENCE = b"rosomaha_crm_bridge.php"
INCLUDE_BLOCK_LF = (
    b"$rosomahaCrmBridge = __DIR__ . '/rosomaha_crm_bridge.php';\n"
    b"if (is_file($rosomahaCrmBridge)) {\n"
    b"    require_once $rosomahaCrmBridge;\n"
    b"}\n"
)
INCLUDE_PATTERN = re.compile(
    rb"\$rosomahaCrmBridge\s*=\s*__DIR__\s*\.\s*['\"]\/rosomaha_crm_bridge\.php['\"]\s*;"
    rb"\s*if\s*\(\s*is_file\s*\(\s*\$rosomahaCrmBridge\s*\)\s*\)\s*\{"
    rb"\s*require_once\s+\$rosomahaCrmBridge\s*;\s*\}",
    flags=re.DOTALL,
)
OLD_INIT_CALL = f'ym({OLD_COUNTER_ID}, "init"'.encode("ascii")
OLD_WATCH_URL = f"https://mc.yandex.ru/watch/{OLD_COUNTER_ID}".encode("ascii")
ATTRIBUTION_MARKER = b"ROSOMAHA_ATTRIBUTION_V1"
ATTRIBUTION_KEYS = (
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "utm_id",
    "yclid",
    "gclid",
    "vkclid",
    "vk_click_id",
)
METRIKA_INIT_BLOCK_PATTERN = re.compile(
    rb"(?ms)^(?P<indent>[ \t]*)ym\(\s*50606578\s*,\s*['\"]init['\"]\s*,\s*\{.*?^(?P=indent)\}\);[ \t]*$"
)
LEGACY_ATTRIBUTION_PATTERN = re.compile(
    rb"(?ms)^        function getParameterByName\(name\) \{.*?(?=^        function getCookie\(name\) \{)"
)

APPLY_GUARD_ENV = "ROSOMAHA_BITRIX_METRIKA_APPLY"
APPLY_GUARD_VALUE = "APPLY_PINNED_METRIKA_BRIDGE_WITH_CAS"
ROLLBACK_GUARD_ENV = "ROSOMAHA_BITRIX_METRIKA_ROLLBACK"
ROLLBACK_GUARD_VALUE = "ROLLBACK_PINNED_METRIKA_BRIDGE_BY_OPERATION_ID"
OPERATOR_REVISION = "bitrix-metrika-bridge-pinned-v1"
ASPRO_MODULE = "aspro.allcorp3"
ASPRO_OPTION = "YA_COUNTER_ID"
ASPRO_SITE_ID = "s1"
OWNED_FILES = (
    "integrations/legacy-bitrix/local/php_interface/rosomaha_crm_bridge.php",
    "scripts/bitrix-metrika-bridge-deploy.py",
    "scripts/bitrix-metrika-bridge-deploy.test.py",
)


class DeployError(RuntimeError):
    """Bounded error that must not contain credentials or form data."""


class CredentialError(DeployError):
    pass


class PublicVerificationError(DeployError):
    pass


class RejectRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        raise PublicVerificationError("Pinned public probe redirected")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _validate_baseline_pins() -> None:
    pins = (
        (BRIDGE_BASELINE_BYTES, BRIDGE_BASELINE_SHA256),
        (INIT_BASELINE_BYTES, INIT_BASELINE_SHA256),
        (COUNTER_BASELINE_BYTES, COUNTER_BASELINE_SHA256),
    )
    if any(
        size < 1 or re.fullmatch(r"[a-f0-9]{64}", digest or "") is None
        for size, digest in pins
    ):
        raise DeployError("One or more production baseline pins are unavailable")


def _parse_env_value(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        value = value[1:-1]
    if not value or "\x00" in value or "\r" in value or "\n" in value:
        raise CredentialError("Pinned credential value is malformed")
    return value


def credentials_from_text(text: str) -> tuple[str, str]:
    found: dict[str, list[str]] = {"BEGET_LOGIN": [], "BEGET_PASSWORD": []}
    for key in found:
        found[key] = re.findall(
            rf"(?im)^\s*(?:export\s+)?{key}\s*=\s*(.+?)\s*$", text
        )
    if any(found.values()):
        if any(len(found[key]) != 1 for key in found):
            raise CredentialError("Pinned credential source is ambiguous")
        return _parse_env_value(found["BEGET_LOGIN"][0]), _parse_env_value(
            found["BEGET_PASSWORD"][0]
        )
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
        digest = base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode(
            "ascii"
        ).rstrip("=")
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
            raise DeployError("SSH transport is unavailable")
        digest = base64.b64encode(
            hashlib.sha256(transport.get_remote_server_key().asbytes()).digest()
        ).decode("ascii").rstrip("=")
        if digest != EXPECTED_HOST_KEY_SHA256:
            raise DeployError("Pinned Beget SSH host key mismatch")
        return client
    except Exception:
        client.close()
        raise


def _runtime_windows_reparse(info: os.stat_result) -> bool:
    attributes = getattr(info, "st_file_attributes", 0)
    reparse = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    return bool(attributes & reparse)


def load_runtime(path: Path = RUNTIME_SOURCE) -> dict[str, Any]:
    try:
        info = path.lstat()
    except OSError as exc:
        raise DeployError("Pinned ignored Metrika runtime is unavailable") from exc
    if (
        path.is_symlink()
        or _runtime_windows_reparse(info)
        or not stat.S_ISREG(info.st_mode)
        or info.st_size < 1
        or info.st_size > MAX_RUNTIME_BYTES
    ):
        raise DeployError("Pinned ignored Metrika runtime type/size is unsafe")
    if os.name != "nt" and stat.S_IMODE(info.st_mode) != 0o600:
        raise DeployError("Pinned ignored Metrika runtime mode must be 0600")
    try:
        root = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise DeployError("Pinned ignored Metrika runtime is invalid JSON") from exc
    if not isinstance(root, dict):
        raise DeployError("Pinned ignored Metrika runtime root is invalid")

    counter = root.get("counter_id")
    token = root.get("measurement_token")
    goals = root.get("goal_ids")
    if (
        isinstance(counter, bool)
        or not isinstance(counter, int)
        or re.fullmatch(r"[1-9][0-9]{4,14}", str(counter)) is None
        or counter != TARGET_COUNTER_ID
    ):
        raise DeployError("Pinned ignored Metrika runtime counter id is invalid")
    if (
        not isinstance(token, str)
        or re.fullmatch(r"[\x21-\x7E]{16,1024}", token) is None
    ):
        raise DeployError("Pinned ignored Metrika runtime credential is invalid")
    if not isinstance(goals, dict):
        raise DeployError("Pinned ignored Metrika runtime goal map is invalid")
    hard_goal = goals.get("crm_conversion")
    soft_goal = goals.get("lead_submit")
    if any(
        isinstance(item, bool) or not isinstance(item, int) or item <= 0
        for item in (hard_goal, soft_goal)
    ):
        raise DeployError("Pinned ignored Metrika runtime goal ids are invalid")

    # Do not return the source object: only the allowlisted deployment values
    # survive parsing, so accidental extra fields cannot reach production.
    return {
        "counter_id": counter,
        "credential": token,
        "goal_ids": {
            "crm_conversion": hard_goal,
            "lead_submit": soft_goal,
        },
    }


def config_candidate(runtime: Mapping[str, Any]) -> bytes:
    body = {
        "counter_id": int(runtime["counter_id"]),
        "measurement_token": str(runtime["credential"]),
    }
    return json.dumps(body, sort_keys=True, separators=(",", ":")).encode("ascii") + b"\n"


def validate_bridge_candidate(path: Path = BRIDGE_SOURCE) -> bytes:
    try:
        data = path.read_bytes()
        text = data.decode("utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise DeployError("Tracked CRM bridge candidate is unavailable or not UTF-8") from exc
    if (
        len(data) != BRIDGE_CANDIDATE_BYTES
        or sha256_bytes(data) != BRIDGE_CANDIDATE_SHA256
        or b"\x00" in data
    ):
        raise DeployError("Tracked CRM bridge candidate byte contract failed")
    required = (
        "final class RosomahaCrmBridge",
        "private const METRIKA_CONFIG_PATH = '/home/b/berkutm4/.config/rosomaha/metrika.json';",
        "private const METRIKA_HARD_ACTION = 'crm_conversion';",
        "private const METRIKA_SOFT_ACTION = 'lead_submit';",
        "RosomahaCrmBridge::register();",
        "lead_submission_id",
        "deal_id",
    )
    if any(text.count(marker) < 1 for marker in required):
        raise DeployError("Tracked CRM bridge candidate contract is incomplete")
    if text.count("RosomahaCrmBridge::register();") != 1:
        raise DeployError("Tracked CRM bridge registration is not unique")
    return data


def build_init_candidate(baseline: bytes) -> bytes:
    if not baseline or len(baseline) > MAX_FILE_BYTES or b"\x00" in baseline:
        raise DeployError("Pinned init.php baseline byte contract failed")
    try:
        baseline.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise DeployError("Pinned init.php baseline is not UTF-8") from exc
    references = baseline.count(INCLUDE_REFERENCE)
    canonical = list(INCLUDE_PATTERN.finditer(baseline))
    if references == 1 and len(canonical) == 1:
        return baseline
    if references != 0 or canonical:
        raise DeployError("init.php contains an ambiguous CRM bridge include")

    eol = b"\r\n" if b"\r\n" in baseline else b"\n"
    block = INCLUDE_BLOCK_LF.replace(b"\n", eol)
    stripped = baseline.rstrip()
    trailer = baseline[len(stripped) :]
    if stripped.endswith(b"?>"):
        body = stripped[:-2].rstrip() + eol + eol + block + b"?>" + trailer
    else:
        body = stripped + eol + eol + block
    if body.count(INCLUDE_REFERENCE) != 1 or len(INCLUDE_PATTERN.findall(body)) != 1:
        raise DeployError("init.php candidate include is not exactly once")
    return body


def _attribution_block(counter_id: int, eol: bytes) -> bytes:
    keys = ", ".join(json.dumps(key) for key in ATTRIBUTION_KEYS)
    text = f"""   /* ROSOMAHA_ATTRIBUTION_V1 */
   (function () {{
       var rosomahaKeys = [{keys}];
       var rosomahaParams;
       try {{
           rosomahaParams = new URLSearchParams(window.location.search);
       }} catch (error) {{
           return;
       }}
       var rosomahaSecure = window.location.protocol === "https:" ? "; Secure" : "";
       rosomahaKeys.forEach(function (key) {{
           var value = rosomahaParams.get(key);
           if (value === null) {{ return; }}
           value = String(value).slice(0, 512);
           if (value === "") {{ return; }}
           document.cookie = key + "=" + encodeURIComponent(value)
               + "; Path=/; Max-Age=7776000; SameSite=Lax" + rosomahaSecure;
       }});
       ym({counter_id}, "getClientID", function (clientID) {{
           clientID = String(clientID || "");
           if (!/^\\d{{6,32}}$/.test(clientID)) {{ return; }}
           document.cookie = "ym_client_id=" + encodeURIComponent(clientID)
               + "; Path=/; Max-Age=31536000; SameSite=Lax" + rosomahaSecure;
       }});
   }})();
   /* /rosomaha attribution */"""
    return text.encode("ascii").replace(b"\n", eol)


def _validate_counter_candidate(candidate: bytes, counter_id: int) -> None:
    new_init = f'ym({counter_id}, "init"'.encode("ascii")
    new_watch = f"https://mc.yandex.ru/watch/{counter_id}".encode("ascii")
    get_client = f'ym({counter_id}, "getClientID"'.encode("ascii")
    if (
        candidate.count(ATTRIBUTION_MARKER) != 1
        or candidate.count(str(OLD_COUNTER_ID).encode("ascii")) != 0
        or candidate.count(new_init) != 1
        or candidate.count(new_watch) != 1
        or candidate.count(get_client) != 1
        or candidate.count(b"ym_client_id=") != 1
        or candidate.count(b"new URLSearchParams(window.location.search)") != 1
        or candidate.count(b"encodeURIComponent(value)") != 1
        or candidate.count(b"Max-Age=7776000") != 1
        or candidate.count(b"Max-Age=31536000") != 1
        or candidate.count(b"SameSite=Lax") != 2
        or candidate.count(b"window.location.protocol === \"https:\"") != 1
        or candidate.count(b"function getParameterByName(name)") != 0
    ):
        raise DeployError("invis-counter.php attribution candidate contract failed")
    for key in ATTRIBUTION_KEYS:
        if candidate.count(json.dumps(key).encode("ascii")) != 1:
            raise DeployError("invis-counter.php attribution whitelist is incomplete")
    marker_position = candidate.index(ATTRIBUTION_MARKER)
    init_position = candidate.index(new_init)
    watch_position = candidate.index(new_watch)
    if not (init_position < marker_position < watch_position):
        raise DeployError("invis-counter.php attribution block is not adjacent to Metrika init")
    block_start = candidate.rfind(b"/*", init_position, marker_position + 1)
    block_end = candidate.find(b"/* /rosomaha attribution */", marker_position)
    if block_start < 0 or block_end < 0:
        raise DeployError("invis-counter.php attribution marker boundaries are invalid")
    attribution = candidate[block_start:block_end]
    forbidden = (b"$.ajax", b"jQuery.ajax", b"fetch(", b"XMLHttpRequest", b"lead_submission_id", b"crm_conversion")
    if any(value in attribution for value in forbidden):
        raise DeployError("invis-counter.php attribution block has a form/CRM side effect")
    if COUNTER_CANDIDATE_BYTES and (
        len(candidate) != COUNTER_CANDIDATE_BYTES
        or sha256_bytes(candidate) != COUNTER_CANDIDATE_SHA256
    ):
        raise DeployError("invis-counter.php candidate differs from its pinned hash")


def build_counter_candidate(baseline: bytes, counter_id: int) -> bytes:
    if counter_id != TARGET_COUNTER_ID:
        raise DeployError("Only the pinned rosomaha-rus.ru counter id is allowed")
    if ATTRIBUTION_MARKER in baseline:
        _validate_counter_candidate(baseline, counter_id)
        return baseline
    if (
        not baseline
        or len(baseline) > MAX_FILE_BYTES
        or b"\x00" in baseline
        or baseline.count(str(OLD_COUNTER_ID).encode("ascii")) != 2
        or baseline.count(OLD_INIT_CALL) != 1
        or baseline.count(OLD_WATCH_URL) != 1
    ):
        raise DeployError("Pinned invis-counter.php baseline contract failed")
    init_blocks = list(METRIKA_INIT_BLOCK_PATTERN.finditer(baseline))
    attribution_blocks = list(LEGACY_ATTRIBUTION_PATTERN.finditer(baseline))
    if len(init_blocks) != 1 or len(attribution_blocks) != 1:
        raise DeployError("Pinned Metrika/legacy attribution marker is not unique")
    legacy = attribution_blocks[0]
    legacy_bytes = baseline[legacy.start() : legacy.end()]
    required_legacy = tuple(f"getParameterByName('{key}')".encode("ascii") for key in ATTRIBUTION_KEYS[:5])
    if any(marker not in legacy_bytes for marker in required_legacy):
        raise DeployError("Pinned legacy attribution block is incomplete")
    new_init = f'ym({counter_id}, "init"'.encode("ascii")
    new_watch = f"https://mc.yandex.ru/watch/{counter_id}".encode("ascii")
    eol = b"\r\n" if b"\r\n" in baseline else b"\n"
    init = init_blocks[0]
    candidate = baseline[: init.end()] + eol + _attribution_block(counter_id, eol) + baseline[init.end() :]
    # The insertion is before the legacy block, so its original offsets shift.
    shifted_start = candidate.find(legacy_bytes)
    if shifted_start < 0 or candidate.count(legacy_bytes) != 1:
        raise DeployError("Pinned legacy attribution block changed during candidate construction")
    candidate = candidate[:shifted_start] + candidate[shifted_start + len(legacy_bytes) :]
    candidate = candidate.replace(OLD_INIT_CALL, new_init, 1).replace(OLD_WATCH_URL, new_watch, 1)
    _validate_counter_candidate(candidate, counter_id)
    return candidate


def _operation_id(
    *, bridge: bytes, init: bytes, counter: bytes, counter_id: int, goal_ids: Mapping[str, int]
) -> str:
    material = "|".join(
        (
            OPERATOR_REVISION,
            BRIDGE_BASELINE_SHA256,
            INIT_BASELINE_SHA256,
            COUNTER_BASELINE_SHA256,
            sha256_bytes(bridge),
            sha256_bytes(init),
            sha256_bytes(counter),
            str(counter_id),
            str(goal_ids["crm_conversion"]),
            str(goal_ids["lead_submit"]),
        )
    ).encode("ascii")
    return "bitrix-metrika-" + sha256_bytes(material)[:24]


def _missing(exc: BaseException) -> bool:
    return isinstance(exc, FileNotFoundError) or getattr(exc, "errno", None) == 2


def _exists(sftp: Any, path: str) -> bool:
    try:
        sftp.lstat(path)
        return True
    except OSError as exc:
        if _missing(exc):
            return False
        raise


def _attrs(attrs: Any) -> dict[str, Any]:
    return {
        "bytes": int(attrs.st_size),
        "mode": f"{stat.S_IMODE(attrs.st_mode):04o}",
        "uid": int(attrs.st_uid),
        "gid": int(attrs.st_gid),
        "regular_non_symlink": bool(stat.S_ISREG(attrs.st_mode)),
    }


def _require_directory(
    sftp: Any,
    path: str,
    *,
    exact_mode: int | None = None,
    allow_group_world_read: bool = True,
) -> dict[str, Any]:
    attrs = sftp.lstat(path)
    if not stat.S_ISDIR(attrs.st_mode):
        raise DeployError("Pinned remote parent is not a plain directory")
    info = {
        "mode": f"{stat.S_IMODE(attrs.st_mode):04o}",
        "uid": int(attrs.st_uid),
        "gid": int(attrs.st_gid),
        "directory_non_symlink": True,
    }
    mode = stat.S_IMODE(attrs.st_mode)
    if info["uid"] != EXPECTED_UID or info["gid"] != EXPECTED_GID:
        raise DeployError("Pinned remote parent ownership drifted")
    if exact_mode is not None and mode != exact_mode:
        raise DeployError("Pinned remote protected directory mode drifted")
    if mode & 0o022 or (not allow_group_world_read and mode & 0o077):
        raise DeployError("Pinned remote parent permissions are unsafe")
    return info


def read_remote_file(
    sftp: Any, path: str, *, allow_missing: bool = False, sensitive: bool = False
) -> tuple[bytes | None, dict[str, Any]]:
    if allow_missing and not _exists(sftp, path):
        return None, {"state": "missing"}
    attrs = sftp.lstat(path)
    info = _attrs(attrs)
    if (
        not info["regular_non_symlink"]
        or info["bytes"] < 1
        or info["bytes"] > (MAX_RUNTIME_BYTES if sensitive else MAX_FILE_BYTES)
    ):
        raise DeployError("Pinned remote file type/size is unsafe")
    with sftp.open(path, "rb") as handle:
        data = handle.read((MAX_RUNTIME_BYTES if sensitive else MAX_FILE_BYTES) + 1)
    if len(data) != info["bytes"]:
        raise DeployError("Pinned remote file readback is incomplete")
    if info["mode"] != f"{EXPECTED_FILE_MODE:04o}" or info["uid"] != EXPECTED_UID or info["gid"] != EXPECTED_GID:
        raise DeployError("Pinned remote file mode/ownership identity drifted")
    if not sensitive:
        info["sha256"] = sha256_bytes(data)
    return data, info


def _classify_public_file(
    sftp: Any,
    path: str,
    *,
    baseline_size: int,
    baseline_sha: str,
    candidate: bytes,
) -> tuple[bytes, dict[str, Any]]:
    data, info = read_remote_file(sftp, path)
    assert data is not None
    baseline_match = len(data) == baseline_size and info["sha256"] == baseline_sha
    candidate_match = data == candidate
    if baseline_match and candidate_match:
        state = "baseline_and_candidate"
    elif baseline_match:
        state = "baseline"
    elif candidate_match:
        state = "candidate"
    else:
        raise DeployError("Remote target differs from both pinned safe states")
    return data, {"state": state, **info}


def _classify_config(sftp: Any, candidate: bytes) -> tuple[bytes | None, dict[str, Any]]:
    data, info = read_remote_file(sftp, CONFIG_PATH, allow_missing=True, sensitive=True)
    if data is None:
        return None, info
    if data != candidate:
        raise DeployError("Existing runtime config is not the exact pinned candidate")
    return data, {
        "state": "candidate",
        "bytes": info["bytes"],
        "mode": info["mode"],
        "uid": info["uid"],
        "gid": info["gid"],
        "regular_non_symlink": True,
    }


def _plans_from_remote(sftp: Any, runtime: Mapping[str, Any], bridge: bytes) -> tuple[list[dict[str, Any]], str]:
    _validate_baseline_pins()
    bridge_current, bridge_info = _classify_public_file(
        sftp,
        BRIDGE_PATH,
        baseline_size=BRIDGE_BASELINE_BYTES,
        baseline_sha=BRIDGE_BASELINE_SHA256,
        candidate=bridge,
    )
    init_current, init_info = read_remote_file(sftp, INIT_PATH)
    assert init_current is not None
    if len(init_current) != INIT_BASELINE_BYTES or init_info["sha256"] != INIT_BASELINE_SHA256:
        # It may already be the deterministic candidate, but that candidate can
        # only be constructed from the pinned baseline backup.  Unknown active
        # init.php is therefore never transformed opportunistically.
        raise DeployError("Remote init.php differs from the pinned baseline")
    init_candidate = build_init_candidate(init_current)
    init_state = "baseline_and_candidate" if init_candidate == init_current else "baseline"
    init_info = {"state": init_state, **init_info}

    counter_current, counter_raw_info = read_remote_file(sftp, COUNTER_PATH)
    assert counter_current is not None
    counter_id = int(runtime["counter_id"])
    if (
        len(counter_current) == COUNTER_BASELINE_BYTES
        and counter_raw_info["sha256"] == COUNTER_BASELINE_SHA256
    ):
        counter_baseline = counter_current
        counter_candidate = build_counter_candidate(counter_baseline, counter_id)
        counter_state = "baseline"
    else:
        if (
            len(counter_current) != COUNTER_CANDIDATE_BYTES
            or counter_raw_info["sha256"] != COUNTER_CANDIDATE_SHA256
        ):
            raise DeployError("Remote counter differs from both pinned safe states")
        _validate_counter_candidate(counter_current, counter_id)
        # A repeat apply returns before backups are needed.  Explicit rollback
        # reconstructs the exact baseline from the immutable operation backup.
        counter_baseline = b""
        counter_candidate = counter_current
        counter_state = "candidate"
    counter_info = {"state": counter_state, **counter_raw_info}
    config_bytes = config_candidate(runtime)
    _, config_info = _classify_config(sftp, config_bytes)

    operation_id = _operation_id(
        bridge=bridge,
        init=init_candidate,
        counter=counter_candidate,
        counter_id=int(runtime["counter_id"]),
        goal_ids=runtime["goal_ids"],
    )
    plans = [
        {
            "name": "runtime_config",
            "path": CONFIG_PATH,
            "directory": CONFIG_DIRECTORY,
            "baseline": None,
            "baseline_size": 0,
            "baseline_sha": None,
            "candidate": config_bytes,
            "sensitive": True,
            "state": config_info,
        },
        {
            "name": "bridge",
            "path": BRIDGE_PATH,
            "directory": PHP_INTERFACE_DIRECTORY,
            "baseline": bridge_current,
            "baseline_size": BRIDGE_BASELINE_BYTES,
            "baseline_sha": BRIDGE_BASELINE_SHA256,
            "candidate": bridge,
            "sensitive": False,
            "state": bridge_info,
        },
        {
            "name": "init",
            "path": INIT_PATH,
            "directory": PHP_INTERFACE_DIRECTORY,
            "baseline": init_current,
            "baseline_size": INIT_BASELINE_BYTES,
            "baseline_sha": INIT_BASELINE_SHA256,
            "candidate": init_candidate,
            "sensitive": False,
            "state": init_info,
        },
        {
            "name": "counter",
            "path": COUNTER_PATH,
            "directory": COUNTER_DIRECTORY,
            "baseline": counter_baseline,
            "baseline_size": COUNTER_BASELINE_BYTES,
            "baseline_sha": COUNTER_BASELINE_SHA256,
            "candidate": counter_candidate,
            "sensitive": False,
            "state": counter_info,
        },
    ]
    return plans, operation_id


def _paths(operation_id: str, plans: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    if re.fullmatch(r"bitrix-metrika-[a-f0-9]{24}", operation_id) is None:
        raise DeployError("Operation id is invalid")
    operation_directory = OPERATION_ROOT + "/" + operation_id
    items = {}
    for plan in plans:
        name = str(plan["name"])
        suffix = ".json" if name == "runtime_config" else ".php"
        items[name] = {
            "backup": operation_directory + f"/{name}.before",
            "missing_marker": operation_directory + f"/{name}.before-missing.json",
            "candidate_temp": str(plan["directory"]) + f"/.{name}.{operation_id}.candidate{suffix}",
            "rollback_temp": str(plan["directory"]) + f"/.{name}.{operation_id}.rollback{suffix}",
        }
    return {
        "directory": operation_directory,
        "operation_receipt": operation_directory + "/operation.json",
        "rollback_receipt": operation_directory + "/rollback.json",
        "items": items,
    }


def _write_exact_file(
    sftp: Any,
    path: str,
    data: bytes,
    *,
    sensitive: bool = False,
) -> dict[str, Any]:
    if _exists(sftp, path):
        raise DeployError("Exact remote artifact already exists")
    with sftp.open(path, "wx") as handle:
        handle.write(data)
        handle.flush()
    sftp.chmod(path, EXPECTED_FILE_MODE)
    sftp.chown(path, EXPECTED_UID, EXPECTED_GID)
    readback, info = read_remote_file(sftp, path, sensitive=sensitive)
    if readback != data:
        raise DeployError("Exact remote artifact readback failed")
    return info


def _atomic_replace(sftp: Any, source: str, destination: str) -> None:
    try:
        sftp.posix_rename(source, destination)
    except (AttributeError, IOError) as exc:
        raise DeployError("Server did not prove atomic POSIX rename") from exc


def _remove_exact(sftp: Any, path: str, allowlist: set[str]) -> None:
    if path not in allowlist:
        raise DeployError("Temporary cleanup path is outside the exact allowlist")
    if _exists(sftp, path):
        sftp.remove(path)


def _make_directory(sftp: Any, path: str) -> None:
    if _exists(sftp, path):
        _require_directory(
            sftp,
            path,
            exact_mode=EXPECTED_DIRECTORY_MODE,
            allow_group_world_read=False,
        )
        return
    sftp.mkdir(path, EXPECTED_DIRECTORY_MODE)
    sftp.chmod(path, EXPECTED_DIRECTORY_MODE)
    info = _require_directory(
        sftp,
        path,
        exact_mode=EXPECTED_DIRECTORY_MODE,
        allow_group_world_read=False,
    )
    if info["uid"] != EXPECTED_UID:
        raise DeployError("Created protected directory ownership is unsafe")


def _prepare_directories(sftp: Any, paths: Mapping[str, Any]) -> None:
    _require_directory(sftp, HOME_ROOT)
    _require_directory(sftp, SITE_ROOT)
    _require_directory(sftp, PHP_INTERFACE_DIRECTORY)
    _require_directory(sftp, COUNTER_DIRECTORY)
    _require_directory(sftp, OPERATION_PARENT)
    _make_directory(sftp, OPERATION_ROOT)
    if _exists(sftp, str(paths["directory"])):
        raise DeployError("Operation directory already exists; inspect before retry")
    _make_directory(sftp, str(paths["directory"]))
    _make_directory(sftp, CONFIG_PARENT)
    _make_directory(sftp, CONFIG_DIRECTORY)


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
            raise DeployError("Remote command output exceeded its bound")
        if channel.exit_status_ready():
            while channel.recv_ready():
                out.extend(channel.recv(8192))
            while channel.recv_stderr_ready():
                err.extend(channel.recv_stderr(4096))
            return channel.recv_exit_status(), bytes(out), bytes(err)
        if time.monotonic() >= deadline:
            channel.close()
            raise DeployError("Remote command timed out")
        time.sleep(0.05)


def discover_php(client: Any) -> str:
    for path in PHP_CANDIDATES:
        command = (
            f"test -x {shlex.quote(path)} && "
            f"{shlex.quote(path)} -r 'echo PHP_MAJOR_VERSION,\".\",PHP_MINOR_VERSION;'"
        )
        status, out, err = _exec_bounded(client, command)
        if status == 0 and not err and out.decode("ascii", "strict") == EXPECTED_PHP_SERIES:
            return path
    raise DeployError("Pinned PHP 8.2 CLI was not found")


def _aspro_php(mode: str, target_counter_id: int) -> str:
    if mode not in {"audit", "apply", "rollback"}:
        raise ValueError("Aspro option mode is invalid")
    if re.fullmatch(r"[1-9][0-9]{4,14}", str(target_counter_id)) is None:
        raise ValueError("Aspro option target counter id is invalid")
    # All interpolated values above are fixed identifiers or validated digits.
    # The helper emits only the two non-sensitive option values and mutation
    # counts; it never reads form results, sessions or runtime credentials.
    common = f"""
$_SERVER['DOCUMENT_ROOT'] = '{SITE_ROOT}';
define('NO_KEEP_STATISTIC', true);
define('NO_AGENT_STATISTIC', true);
define('NOT_CHECK_PERMISSIONS', true);
ob_start();
require $_SERVER['DOCUMENT_ROOT'].'/bitrix/modules/main/include/prolog_before.php';
ob_end_clean();
if (!class_exists('COption')) {{ fwrite(STDERR, 'option_api_unavailable'); exit(20); }}
function rosomaha_read_options() {{
    return array(
        'site_s1' => (string)COption::GetOptionString('{ASPRO_MODULE}', '{ASPRO_OPTION}', '__missing__', '{ASPRO_SITE_ID}'),
        'global' => (string)COption::GetOptionString('{ASPRO_MODULE}', '{ASPRO_OPTION}', '__missing__', false),
    );
}}
function rosomaha_emit($status, $before, $after, $mutations) {{
    echo json_encode(array(
        'status' => $status,
        'before' => $before,
        'after' => $after,
        'mutations' => (int)$mutations,
    ), JSON_UNESCAPED_SLASHES);
}}
$before = rosomaha_read_options();
""".strip()
    if mode == "audit":
        return common + "\nrosomaha_emit('audited', $before, $before, 0);"
    from_value = OLD_COUNTER_ID if mode == "apply" else target_counter_id
    to_value = target_counter_id if mode == "apply" else OLD_COUNTER_ID
    success_status = "applied" if mode == "apply" else "rolled_back"
    return common + f"""
$from = '{from_value}';
$to = '{to_value}';
if ($before['site_s1'] === $to && $before['global'] === $to) {{
    rosomaha_emit('already_target', $before, $before, 0); exit(0);
}}
if ($before['site_s1'] !== $from || $before['global'] !== $from) {{
    rosomaha_emit('cas_blocked', $before, $before, 0); exit(21);
}}
COption::SetOptionString('{ASPRO_MODULE}', '{ASPRO_OPTION}', $to, false, '{ASPRO_SITE_ID}');
$middle = rosomaha_read_options();
if ($middle['site_s1'] !== $to || $middle['global'] !== $from) {{
    if ($middle['site_s1'] === $to) {{
        COption::SetOptionString('{ASPRO_MODULE}', '{ASPRO_OPTION}', $from, false, '{ASPRO_SITE_ID}');
    }}
    rosomaha_emit('first_write_failed', $before, rosomaha_read_options(), 1); exit(22);
}}
COption::SetOptionString('{ASPRO_MODULE}', '{ASPRO_OPTION}', $to, false, false);
$after = rosomaha_read_options();
if ($after['site_s1'] !== $to || $after['global'] !== $to) {{
    if ($after['global'] === $to) {{
        COption::SetOptionString('{ASPRO_MODULE}', '{ASPRO_OPTION}', $from, false, false);
    }}
    if ($after['site_s1'] === $to) {{
        COption::SetOptionString('{ASPRO_MODULE}', '{ASPRO_OPTION}', $from, false, '{ASPRO_SITE_ID}');
    }}
    rosomaha_emit('second_write_failed_rolled_back', $before, rosomaha_read_options(), 2); exit(23);
}}
rosomaha_emit('{success_status}', $before, $after, 2);
""".strip()


def aspro_options(
    client: Any,
    mode: str,
    target_counter_id: int,
    *,
    php_binary: str | None = None,
) -> dict[str, Any]:
    php = php_binary or discover_php(client)
    if php not in PHP_CANDIDATES:
        raise DeployError("Aspro option PHP binary is outside the fixed allowlist")
    code = _aspro_php(mode, target_counter_id)
    command = f"{shlex.quote(php)} -d display_errors=stderr -d log_errors=0 -r {shlex.quote(code)}"
    status, out, err = _exec_bounded(client, command, timeout=45)
    if len(out) > 8_192 or len(err) > 2_048:
        raise DeployError("Aspro option helper output exceeded its narrow bound")
    try:
        payload = json.loads(out.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise DeployError("Aspro option helper did not return exact JSON") from exc
    if (
        status != 0
        or not isinstance(payload, dict)
        or set(payload) != {"status", "before", "after", "mutations"}
        or not isinstance(payload.get("before"), dict)
        or not isinstance(payload.get("after"), dict)
        or set(payload["before"]) != {"site_s1", "global"}
        or set(payload["after"]) != {"site_s1", "global"}
        or not isinstance(payload.get("mutations"), int)
    ):
        raise DeployError("Aspro option helper CAS/readback failed")
    allowed_values = {str(OLD_COUNTER_ID), str(target_counter_id)}
    if any(
        value not in allowed_values
        for snapshot in (payload["before"], payload["after"])
        for value in snapshot.values()
    ):
        raise DeployError("Aspro option helper observed an unpinned value")
    if mode == "audit" and (
        payload["status"] != "audited"
        or payload["mutations"] != 0
        or payload["before"] != payload["after"]
    ):
        raise DeployError("Read-only Aspro option audit contract failed")
    return payload


def remote_php_lint(client: Any, php_binary: str, paths: Sequence[str], allowlist: set[str]) -> dict[str, Any]:
    if php_binary not in PHP_CANDIDATES or not paths or any(path not in allowlist for path in paths):
        raise DeployError("Remote PHP lint path is outside the fixed operation allowlist")
    for path in paths:
        command = f"{shlex.quote(php_binary)} -d short_open_tag=1 -l {shlex.quote(path)}"
        status, out, err = _exec_bounded(client, command)
        if status != 0 or b"No syntax errors detected" not in out + err:
            raise DeployError("Remote PHP lint rejected a staged candidate")
    return {"status": "pass", "php_series": EXPECTED_PHP_SERIES, "files": len(paths)}


def _contains_forbidden_key(value: Any) -> bool:
    if isinstance(value, Mapping):
        return any(
            re.search(r"(?i)password|token|secret|credential|phone|email", str(key))
            or _contains_forbidden_key(item)
            for key, item in value.items()
        )
    if isinstance(value, (list, tuple)):
        return any(_contains_forbidden_key(item) for item in value)
    return False


def _receipt_bytes(payload: Mapping[str, Any]) -> bytes:
    if _contains_forbidden_key(payload):
        raise DeployError("Receipt payload contains a forbidden field")
    data = json.dumps(dict(payload), ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8") + b"\n"
    if len(data) > MAX_RECEIPT_BYTES:
        raise DeployError("Receipt exceeded its bound")
    return data


def _write_remote_receipt(sftp: Any, path: str, payload: Mapping[str, Any]) -> dict[str, Any]:
    return _write_exact_file(sftp, path, _receipt_bytes(payload))


def write_local_receipt(kind: str, payload: Mapping[str, Any]) -> Path:
    if re.fullmatch(r"[a-z-]{3,24}", kind) is None:
        raise DeployError("Receipt kind is invalid")
    body = _receipt_bytes(payload)
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%fZ")
    path = REPORT_ROOT / f"ROSOMAHA_BITRIX_METRIKA_{stamp}_{kind.upper()}.json"
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb", closefd=False) as handle:
            handle.write(body)
            handle.flush()
            os.fsync(handle.fileno())
        if os.name != "nt":
            os.chmod(path, 0o400)
    finally:
        os.close(fd)
    return path


def _safe_plan_info(plan: Mapping[str, Any]) -> dict[str, Any]:
    state = dict(plan["state"])
    state.pop("sha256", None) if plan["sensitive"] else None
    return {
        "name": plan["name"],
        "path": plan["path"],
        "state": state,
        "baseline": "missing" if plan["baseline"] is None else {
            "bytes": plan["baseline_size"],
            "sha256": plan["baseline_sha"],
            "mode": f"{EXPECTED_FILE_MODE:04o}",
            "uid": EXPECTED_UID,
            "gid": EXPECTED_GID,
            "type": "regular_non_symlink",
        },
        "candidate": {
            "bytes": len(plan["candidate"]),
            **({} if plan["sensitive"] else {"sha256": sha256_bytes(plan["candidate"])}),
            "mode": f"{EXPECTED_FILE_MODE:04o}",
            "uid": EXPECTED_UID,
            "gid": EXPECTED_GID,
            "type": "regular_non_symlink",
        },
    }


def _is_baseline(plan: Mapping[str, Any]) -> bool:
    state = str(plan["state"].get("state"))
    if plan["baseline"] is None:
        return state == "missing"
    return state in {"baseline", "baseline_and_candidate"}


def _is_candidate(plan: Mapping[str, Any]) -> bool:
    state = str(plan["state"].get("state"))
    if plan["baseline"] is not None and plan["baseline"] == plan["candidate"]:
        return state == "baseline_and_candidate"
    return state == "candidate"


def _snapshot(client: Any, runtime: Mapping[str, Any], bridge: bytes) -> tuple[list[dict[str, Any]], str, dict[str, Any]]:
    sftp = client.open_sftp()
    try:
        plans, operation_id = _plans_from_remote(sftp, runtime, bridge)
    finally:
        sftp.close()
    options = aspro_options(client, "audit", int(runtime["counter_id"]))
    return plans, operation_id, options


def _connect_and_close(callback: Callable[[Any], Any]) -> Any:
    client = connect()
    try:
        return callback(client)
    finally:
        client.close()


def _candidate_lint_local(bridge: bytes) -> dict[str, Any]:
    # The tracked bridge is the only local PHP file.  Derived init/counter
    # candidates are linted remotely from their same-directory staged files.
    result = subprocess.run(
        ["php", "-d", "short_open_tag=1", "-l", str(BRIDGE_SOURCE)],
        cwd=PROJECT_ROOT,
        check=False,
        capture_output=True,
        timeout=30,
    )
    if result.returncode != 0 or b"No syntax errors detected" not in result.stdout + result.stderr:
        raise DeployError("Local PHP lint rejected the tracked bridge")
    if BRIDGE_SOURCE.read_bytes() != bridge:
        raise DeployError("Tracked bridge changed during local lint")
    return {"status": "pass", "files": 1}


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
    ignored = subprocess.run(
        ["git", "check-ignore", "--quiet", "--", str(RUNTIME_SOURCE.relative_to(PROJECT_ROOT))],
        cwd=PROJECT_ROOT,
        check=False,
    )
    if ignored.returncode != 0:
        raise DeployError("Runtime source is not ignored by Git")
    head = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=PROJECT_ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    ).stdout.strip()
    if re.fullmatch(r"[a-f0-9]{40}", head) is None:
        raise DeployError("Git HEAD is invalid")
    return head


def _public_url(counter_id: int) -> str:
    return PUBLIC_ORIGIN + f"/?rosomaha_metrika_verify={counter_id}"


def fetch_public(counter_id: int) -> bytes:
    url = _public_url(counter_id)
    request = Request(
        url,
        headers={
            "Accept": "text/html",
            "Cache-Control": "no-cache",
            "User-Agent": "RosomahaBitrixMetrikaDeploy/1.0",
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


def verify_public_counter(
    counter_id: int,
    *,
    expected: str,
    fetcher: Callable[[int], bytes] = fetch_public,
) -> dict[str, Any]:
    if expected not in {"baseline", "candidate"}:
        raise ValueError("Public counter state is invalid")
    body = fetcher(counter_id)
    wanted = OLD_COUNTER_ID if expected == "baseline" else counter_id
    unwanted = counter_id if expected == "baseline" else OLD_COUNTER_ID
    wanted_init = re.compile(rb"ym\(\s*" + str(wanted).encode("ascii") + rb"\s*,\s*['\"]init['\"]")
    wanted_watch = f"https://mc.yandex.ru/watch/{wanted}".encode("ascii")
    unwanted_init = re.compile(rb"ym\(\s*" + str(unwanted).encode("ascii") + rb"\s*,\s*['\"]init['\"]")
    unwanted_watch = f"https://mc.yandex.ru/watch/{unwanted}".encode("ascii")
    if len(wanted_init.findall(body)) != 1 or body.count(wanted_watch) != 1:
        raise PublicVerificationError("Public page does not expose the expected Metrika counter once")
    if unwanted_init.search(body) or unwanted_watch in body:
        raise PublicVerificationError("Public page exposes both old and new Metrika counters")
    if expected == "candidate":
        get_client = re.compile(
            rb"ym\(\s*"
            + str(counter_id).encode("ascii")
            + rb"\s*,\s*['\"]getClientID['\"]"
        )
        if (
            body.count(ATTRIBUTION_MARKER) != 1
            or len(get_client.findall(body)) != 1
            or body.count(b"ym_client_id=") != 1
            or body.count(b"new URLSearchParams(window.location.search)") != 1
        ):
            raise PublicVerificationError("Public attribution/client-id marker is missing or duplicated")
        for key in ATTRIBUTION_KEYS:
            if json.dumps(key).encode("ascii") not in body:
                raise PublicVerificationError("Public attribution whitelist is incomplete")
    elif ATTRIBUTION_MARKER in body or b"ym_client_id=" in body:
        raise PublicVerificationError("Baseline public page unexpectedly contains the new attribution block")
    return {
        "status": 200,
        "state": expected,
        "counter_id": wanted,
        "html_sha256": sha256_bytes(body),
    }


def _read_plan_state(sftp: Any, plan: Mapping[str, Any]) -> dict[str, Any]:
    if plan["sensitive"]:
        return _classify_config(sftp, plan["candidate"])[1]
    return _classify_public_file(
        sftp,
        plan["path"],
        baseline_size=int(plan["baseline_size"]),
        baseline_sha=str(plan["baseline_sha"]),
        candidate=plan["candidate"],
    )[1]


def _backup_plans(sftp: Any, paths: Mapping[str, Any], plans: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    backups = []
    for plan in plans:
        item = paths["items"][plan["name"]]
        if plan["baseline"] is None:
            marker = _receipt_bytes({"schema": 1, "state": "missing", "name": plan["name"]})
            info = _write_exact_file(sftp, item["missing_marker"], marker)
            backups.append({"name": plan["name"], "state": "missing", "marker": info})
        else:
            info = _write_exact_file(sftp, item["backup"], plan["baseline"])
            backups.append({"name": plan["name"], "state": "file", "file": info})
    return backups


def _stage_plans(sftp: Any, paths: Mapping[str, Any], plans: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    staged = []
    for plan in plans:
        if plan["baseline"] == plan["candidate"]:
            staged.append({"name": plan["name"], "status": "unchanged_not_staged"})
            continue
        temp = paths["items"][plan["name"]]["candidate_temp"]
        info = _write_exact_file(
            sftp, temp, plan["candidate"], sensitive=bool(plan["sensitive"])
        )
        if plan["sensitive"]:
            info = {key: info[key] for key in ("bytes", "mode", "uid", "gid", "regular_non_symlink")}
        staged.append({"name": plan["name"], "file": info})
    return staged


def _restore_all(
    sftp: Any,
    paths: Mapping[str, Any],
    plans: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    results = []
    cleanup_allowlist = {
        details["rollback_temp"] for details in paths["items"].values()
    }
    for plan in reversed(plans):
        current = _read_plan_state(sftp, plan)
        if plan["baseline"] is None:
            if current["state"] == "missing":
                results.append({"name": plan["name"], "status": "already_baseline"})
                continue
            if current["state"] != "candidate":
                raise DeployError("Rollback config CAS is not the pinned candidate")
            tombstone = paths["items"][plan["name"]]["rollback_temp"]
            _remove_exact(sftp, tombstone, cleanup_allowlist)
            _atomic_replace(sftp, plan["path"], tombstone)
            if _exists(sftp, plan["path"]):
                raise DeployError("Rollback did not restore missing config baseline")
            _remove_exact(sftp, tombstone, cleanup_allowlist)
            results.append({"name": plan["name"], "status": "rolled_back_to_missing"})
            continue
        if current["state"] in {"baseline", "baseline_and_candidate"}:
            results.append({"name": plan["name"], "status": "already_baseline"})
            continue
        if current["state"] != "candidate":
            raise DeployError("Rollback file CAS is not the pinned candidate")
        backup_path = paths["items"][plan["name"]]["backup"]
        backup, backup_info = read_remote_file(sftp, backup_path)
        assert backup is not None
        if (
            len(backup) != plan["baseline_size"]
            or backup_info["sha256"] != plan["baseline_sha"]
            or backup != plan["baseline"]
        ):
            raise DeployError("Rollback exact backup is invalid")
        rollback_temp = paths["items"][plan["name"]]["rollback_temp"]
        _remove_exact(sftp, rollback_temp, cleanup_allowlist)
        _write_exact_file(sftp, rollback_temp, backup)
        _atomic_replace(sftp, rollback_temp, plan["path"])
        after = _read_plan_state(sftp, plan)
        if after["state"] not in {"baseline", "baseline_and_candidate"}:
            raise DeployError("Rollback post-write CAS failed")
        results.append({"name": plan["name"], "status": "rolled_back"})
    return results


def apply_remote(
    client: Any,
    runtime: Mapping[str, Any],
    bridge: bytes,
    *,
    public_verifier: Callable[[int], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    sftp = client.open_sftp()
    plans: list[dict[str, Any]] = []
    paths: dict[str, Any] = {}
    switched = False
    options_switched = False
    options_state_unknown = False
    try:
        plans, operation_id = _plans_from_remote(sftp, runtime, bridge)
        php_binary = discover_php(client)
        options_before = aspro_options(
            client, "audit", int(runtime["counter_id"]), php_binary=php_binary
        )
        old_value = str(OLD_COUNTER_ID)
        new_value = str(runtime["counter_id"])
        options_are_baseline = all(
            value == old_value for value in options_before["after"].values()
        )
        options_are_candidate = all(
            value == new_value for value in options_before["after"].values()
        )
        if not all(_is_baseline(plan) for plan in plans):
            if all(_is_candidate(plan) for plan in plans) and options_are_candidate:
                return {"status": "already_applied", "operation_id": operation_id}
            raise DeployError("Apply requires one coherent exact baseline state")
        if not options_are_baseline:
            raise DeployError("Apply requires exact baseline Aspro counter options")
        paths = _paths(operation_id, plans)
        _prepare_directories(sftp, paths)
        backups = _backup_plans(sftp, paths, plans)
        staged = _stage_plans(sftp, paths, plans)
        lint_paths = [
            paths["items"][plan["name"]]["candidate_temp"]
            for plan in plans
            if plan["name"] != "runtime_config" and plan["baseline"] != plan["candidate"]
        ]
        lint = remote_php_lint(client, php_binary, lint_paths, set(lint_paths))

        for plan in plans:
            fresh = _read_plan_state(sftp, plan)
            expected = "missing" if plan["baseline"] is None else plan["state"]["state"]
            if fresh["state"] != expected:
                raise DeployError("Apply CAS changed before atomic replacement")

        after = []
        for plan in plans:
            if plan["baseline"] == plan["candidate"]:
                after.append({"name": plan["name"], "status": "unchanged"})
                continue
            temp = paths["items"][plan["name"]]["candidate_temp"]
            _atomic_replace(sftp, temp, plan["path"])
            switched = True
            state = _read_plan_state(sftp, plan)
            if state["state"] != "candidate":
                raise DeployError("Apply post-write CAS failed")
            after.append({"name": plan["name"], "status": "applied"})

        try:
            options_after = aspro_options(
                client, "apply", int(runtime["counter_id"]), php_binary=php_binary
            )
        except Exception:
            try:
                option_readback = aspro_options(
                    client, "audit", int(runtime["counter_id"]), php_binary=php_binary
                )
                values = set(option_readback["after"].values())
                if values == {new_value}:
                    options_switched = True
                elif values != {old_value}:
                    options_state_unknown = True
            except Exception:
                options_state_unknown = True
            raise
        options_switched = all(
            value == new_value for value in options_after["after"].values()
        )
        if any(value != new_value for value in options_after["after"].values()):
            raise DeployError("Aspro counter option post-write readback failed")
        if options_after["status"] != "applied" or options_after["mutations"] != 2:
            raise DeployError("Aspro counter option CAS changed concurrently")

        public = (
            public_verifier(int(runtime["counter_id"]))
            if public_verifier is not None
            else verify_public_counter(int(runtime["counter_id"]), expected="candidate")
        )
        payload = {
            "schema": 1,
            "status": "applied",
            "operation_id": operation_id,
            "counter_id": int(runtime["counter_id"]),
            "goal_ids": dict(runtime["goal_ids"]),
            "backups": backups,
            "staged": staged,
            "php_lint": lint,
            "aspro_options": options_after,
            "after": after,
            "public": public,
            "atomic_same_directory_replace": True,
            "config_outside_docroot": not CONFIG_PATH.startswith(SITE_ROOT + "/"),
            "write_scope": [plan["path"] for plan in plans],
        }
        payload["remote_receipt"] = _write_remote_receipt(
            sftp, paths["operation_receipt"], payload
        )
        return payload
    except Exception as exc:
        if switched and plans and paths:
            try:
                if options_switched:
                    option_rollback = aspro_options(
                        client, "rollback", int(runtime["counter_id"])
                    )
                    if any(
                        value != str(OLD_COUNTER_ID)
                        for value in option_rollback["after"].values()
                    ):
                        raise DeployError("Automatic Aspro option rollback readback failed")
                rollback = _restore_all(sftp, paths, plans)
            except Exception as rollback_exc:
                raise DeployError(
                    "Apply failed and exact automatic rollback needs manual inspection: "
                    + safe_error(rollback_exc)
                ) from exc
            if options_state_unknown:
                raise DeployError(
                    "Apply failed; exact files were restored but Aspro options need read-only inspection"
                ) from exc
            raise DeployError(
                "Apply failed after a switch; exact files and known Aspro state were restored: "
                + ",".join(item["status"] for item in rollback)
            ) from exc
        raise
    finally:
        sftp.close()


def rollback_remote(
    client: Any,
    operation_id: str,
    runtime: Mapping[str, Any],
    bridge: bytes,
    *,
    public_verifier: Callable[[int], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    sftp = client.open_sftp()
    try:
        plans, expected_id = _plans_from_remote_for_rollback(
            sftp, operation_id, runtime, bridge
        )
        if operation_id != expected_id:
            raise DeployError("Rollback operation id does not match the pinned candidates")
        paths = _paths(operation_id, plans)
        _require_directory(
            sftp,
            paths["directory"],
            exact_mode=EXPECTED_DIRECTORY_MODE,
            allow_group_world_read=False,
        )
        php_binary = discover_php(client)
        option_rollback = aspro_options(
            client, "rollback", int(runtime["counter_id"]), php_binary=php_binary
        )
        if any(
            value != str(OLD_COUNTER_ID)
            for value in option_rollback["after"].values()
        ):
            raise DeployError("Rollback Aspro option readback failed")
        try:
            results = _restore_all(sftp, paths, plans)
        except Exception as exc:
            if option_rollback["status"] == "rolled_back":
                try:
                    option_restore = aspro_options(
                        client,
                        "apply",
                        int(runtime["counter_id"]),
                        php_binary=php_binary,
                    )
                    if any(
                        value != str(runtime["counter_id"])
                        for value in option_restore["after"].values()
                    ):
                        raise DeployError("Aspro candidate option restoration failed")
                except Exception as option_exc:
                    raise DeployError(
                        "Rollback file failure left Aspro option state needing inspection: "
                        + safe_error(option_exc)
                    ) from exc
            raise
        public = (
            public_verifier(int(runtime["counter_id"]))
            if public_verifier is not None
            else verify_public_counter(int(runtime["counter_id"]), expected="baseline")
        )
        payload = {
            "schema": 1,
            "status": "rolled_back",
            "operation_id": operation_id,
            "counter_id": int(runtime["counter_id"]),
            "result": results,
            "aspro_options": option_rollback,
            "public": public,
            "atomic_same_directory_replace": True,
        }
        if not _exists(sftp, paths["rollback_receipt"]):
            payload["remote_receipt"] = _write_remote_receipt(
                sftp, paths["rollback_receipt"], payload
            )
        return payload
    finally:
        sftp.close()


def _plans_from_remote_for_rollback(
    sftp: Any,
    operation_id: str,
    runtime: Mapping[str, Any],
    bridge: bytes,
) -> tuple[list[dict[str, Any]], str]:
    """Reconstruct exact candidates from immutable operation backups."""
    _validate_baseline_pins()
    counter_id = int(runtime["counter_id"])
    config_bytes = config_candidate(runtime)
    skeleton = [
        {"name": "runtime_config", "directory": CONFIG_DIRECTORY},
        {"name": "bridge", "directory": PHP_INTERFACE_DIRECTORY},
        {"name": "init", "directory": PHP_INTERFACE_DIRECTORY},
        {"name": "counter", "directory": COUNTER_DIRECTORY},
    ]
    operation_paths = _paths(operation_id, skeleton)
    init_baseline, init_backup_info = read_remote_file(
        sftp, operation_paths["items"]["init"]["backup"]
    )
    bridge_baseline, bridge_backup_info = read_remote_file(
        sftp, operation_paths["items"]["bridge"]["backup"]
    )
    counter_baseline, counter_backup_info = read_remote_file(
        sftp, operation_paths["items"]["counter"]["backup"]
    )
    marker, marker_info = read_remote_file(
        sftp, operation_paths["items"]["runtime_config"]["missing_marker"]
    )
    assert (
        init_baseline is not None
        and bridge_baseline is not None
        and counter_baseline is not None
        and marker is not None
    )
    expected_marker = _receipt_bytes(
        {"schema": 1, "state": "missing", "name": "runtime_config"}
    )
    if (
        len(init_baseline) != INIT_BASELINE_BYTES
        or init_backup_info["sha256"] != INIT_BASELINE_SHA256
        or len(bridge_baseline) != BRIDGE_BASELINE_BYTES
        or bridge_backup_info["sha256"] != BRIDGE_BASELINE_SHA256
        or len(counter_baseline) != COUNTER_BASELINE_BYTES
        or counter_backup_info["sha256"] != COUNTER_BASELINE_SHA256
        or marker != expected_marker
        or marker_info["mode"] != "0600"
    ):
        raise DeployError("Rollback immutable baseline evidence is invalid")

    init_candidate = build_init_candidate(init_baseline)
    counter_candidate = build_counter_candidate(counter_baseline, counter_id)
    expected_id = _operation_id(
        bridge=bridge,
        init=init_candidate,
        counter=counter_candidate,
        counter_id=counter_id,
        goal_ids=runtime["goal_ids"],
    )
    if operation_id != expected_id:
        raise DeployError("Rollback operation id differs from immutable candidates")

    _, bridge_state = _classify_public_file(
        sftp,
        BRIDGE_PATH,
        baseline_size=BRIDGE_BASELINE_BYTES,
        baseline_sha=BRIDGE_BASELINE_SHA256,
        candidate=bridge,
    )
    _, init_state = _classify_public_file(
        sftp,
        INIT_PATH,
        baseline_size=INIT_BASELINE_BYTES,
        baseline_sha=INIT_BASELINE_SHA256,
        candidate=init_candidate,
    )
    _, counter_state = _classify_public_file(
        sftp,
        COUNTER_PATH,
        baseline_size=COUNTER_BASELINE_BYTES,
        baseline_sha=COUNTER_BASELINE_SHA256,
        candidate=counter_candidate,
    )
    _, config_state = _classify_config(sftp, config_bytes)
    plans = [
        {"name": "runtime_config", "path": CONFIG_PATH, "directory": CONFIG_DIRECTORY,
         "baseline": None, "baseline_size": 0, "baseline_sha": None,
         "candidate": config_bytes, "sensitive": True, "state": config_state},
        {"name": "bridge", "path": BRIDGE_PATH, "directory": PHP_INTERFACE_DIRECTORY,
         "baseline": bridge_baseline, "baseline_size": BRIDGE_BASELINE_BYTES,
         "baseline_sha": BRIDGE_BASELINE_SHA256, "candidate": bridge, "sensitive": False,
         "state": bridge_state},
        {"name": "init", "path": INIT_PATH, "directory": PHP_INTERFACE_DIRECTORY,
         "baseline": init_baseline, "baseline_size": INIT_BASELINE_BYTES,
         "baseline_sha": INIT_BASELINE_SHA256, "candidate": init_candidate,
         "sensitive": False, "state": init_state},
        {"name": "counter", "path": COUNTER_PATH, "directory": COUNTER_DIRECTORY,
         "baseline": counter_baseline, "baseline_size": COUNTER_BASELINE_BYTES,
         "baseline_sha": COUNTER_BASELINE_SHA256, "candidate": counter_candidate,
         "sensitive": False, "state": counter_state},
    ]
    return plans, expected_id


def safe_error(exc: BaseException) -> str:
    text = str(exc) or type(exc).__name__
    for value in (EXPECTED_LOGIN, HOME_ROOT, SITE_ROOT, str(ENV_PATH), str(RUNTIME_SOURCE)):
        text = text.replace(value, "[pinned]")
    text = re.sub(r"(?i)(password|token|secret|credential)\s*[=:]\s*\S+", r"\1=[redacted]", text)
    return f"{type(exc).__name__}: {text}"[:700]


def _base_receipt(mode: str, runtime: Mapping[str, Any] | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "schema": 1,
        "mode": mode,
        "created_at_utc": utc_now(),
        "domain": DOMAIN,
        "account": EXPECTED_LOGIN,
        "operator_revision": OPERATOR_REVISION,
        "remote_writes_requested": mode in {"apply", "rollback"},
    }
    if runtime is not None:
        payload["counter_id"] = int(runtime["counter_id"])
        payload["goal_ids"] = dict(runtime["goal_ids"])
        payload["runtime_config"] = {
            "source": str(RUNTIME_SOURCE.relative_to(PROJECT_ROOT)).replace("\\", "/"),
            "validated": True,
            "sensitive_values_exported": False,
        }
    return payload


def run_audit() -> tuple[dict[str, Any], Path]:
    runtime = load_runtime()
    bridge = validate_bridge_candidate()
    _candidate_lint_local(bridge)
    plans, operation_id, options = _connect_and_close(
        lambda client: _snapshot(client, runtime, bridge)
    )
    payload = _base_receipt("audit", runtime) | {
        "status": "audited",
        "operation_id": operation_id,
        "read_only": True,
        "targets": [_safe_plan_info(plan) for plan in plans],
        "aspro_options": options,
    }
    return payload, write_local_receipt("audit", payload)


def run_dry_run() -> tuple[dict[str, Any], Path]:
    runtime = load_runtime()
    bridge = validate_bridge_candidate()
    lint = _candidate_lint_local(bridge)
    plans, operation_id, options = _connect_and_close(
        lambda client: _snapshot(client, runtime, bridge)
    )
    ready = all(_is_baseline(plan) for plan in plans) and all(
        value == str(OLD_COUNTER_ID) for value in options["after"].values()
    )
    payload = _base_receipt("dry-run", runtime) | {
        "status": "plan_ready" if ready else "blocked",
        "operation_id": operation_id,
        "read_only": True,
        "local_php_lint": lint,
        "targets": [_safe_plan_info(plan) for plan in plans],
        "aspro_options": options,
        "apply_guard": {"environment": APPLY_GUARD_ENV, "exact_value_required": True},
        "transaction": {
            "same_directory_atomic_renames": 3,
            "backups_outside_docroot": 3,
            "missing_baseline_markers": 1,
            "bitrix_option_cas_updates": 2,
            "automatic_rollback_after_switch_failure": True,
        },
    }
    return payload, write_local_receipt("dry-run", payload)


def run_apply() -> tuple[dict[str, Any], Path]:
    if os.environ.get(APPLY_GUARD_ENV) != APPLY_GUARD_VALUE:
        raise DeployError("Explicit apply guard is missing")
    head = require_committed_operator()
    runtime = load_runtime()
    bridge = validate_bridge_candidate()
    _candidate_lint_local(bridge)
    pending = _base_receipt("apply", runtime) | {
        "status": "dispatch_pending",
        "git_head": head,
        "write_dispatches": 0,
    }
    pending_path = write_local_receipt("pending", pending)
    remote = _connect_and_close(lambda client: apply_remote(client, runtime, bridge))
    payload = _base_receipt("apply", runtime) | {
        "status": remote["status"],
        "operation_id": remote["operation_id"],
        "git_head": head,
        "pending_receipt": pending_path.name,
        "write_dispatches": 1,
        "remote": remote,
    }
    return payload, write_local_receipt("apply", payload)


def run_rollback(operation_id: str) -> tuple[dict[str, Any], Path]:
    if os.environ.get(ROLLBACK_GUARD_ENV) != ROLLBACK_GUARD_VALUE:
        raise DeployError("Explicit rollback guard is missing")
    head = require_committed_operator()
    runtime = load_runtime()
    bridge = validate_bridge_candidate()
    pending = _base_receipt("rollback", runtime) | {
        "status": "dispatch_pending",
        "operation_id": operation_id,
        "git_head": head,
        "write_dispatches": 0,
    }
    pending_path = write_local_receipt("pending", pending)
    remote = _connect_and_close(
        lambda client: rollback_remote(client, operation_id, runtime, bridge)
    )
    payload = _base_receipt("rollback", runtime) | {
        "status": remote["status"],
        "operation_id": operation_id,
        "git_head": head,
        "pending_receipt": pending_path.name,
        "write_dispatches": 1,
        "remote": remote,
    }
    return payload, write_local_receipt("rollback", payload)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--audit", action="store_true")
    group.add_argument("--dry-run", action="store_true")
    group.add_argument("--apply", action="store_true")
    group.add_argument("--rollback", metavar="OPERATION_ID")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    mode = (
        "audit"
        if args.audit
        else "dry-run"
        if args.dry_run
        else "apply"
        if args.apply
        else "rollback"
    )
    try:
        if args.audit:
            payload, receipt = run_audit()
        elif args.dry_run:
            payload, receipt = run_dry_run()
        elif args.apply:
            payload, receipt = run_apply()
        else:
            payload, receipt = run_rollback(args.rollback)
        print(
            json.dumps(
                {
                    "status": payload["status"],
                    "operation_id": payload.get("operation_id"),
                    "receipt": str(receipt),
                },
                ensure_ascii=False,
            )
        )
        return 0 if payload["status"] not in {"blocked", "error"} else 1
    except Exception as exc:
        payload = _base_receipt(mode) | {"status": "error", "error": safe_error(exc)}
        suffix = ""
        try:
            receipt = write_local_receipt("error", payload)
            suffix = f"; receipt={receipt}"
        except Exception:
            pass
        print(f"ERROR: {safe_error(exc)}{suffix}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
