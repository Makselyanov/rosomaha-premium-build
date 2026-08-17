#!/usr/bin/env python3
"""Fixed, receipt-bound image operator for Bitrix element 952.

The only supported change makes the tracked dimensions drawing the new
DETAIL_PICTURE, preserves the existing eight PHOTOS rows and CFile ids in their
original order, and appends a binary copy of the previous DETAIL_PICTURE as the
last PHOTOS value.  Audit, dry-run, and recover are read-only.  Apply and
rollback each dispatch at most one remote write operation and are never
retried automatically.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import logging
import os
import re
import stat
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Callable, Mapping, Sequence
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

import paramiko


logging.getLogger("paramiko").setLevel(logging.CRITICAL)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = PROJECT_ROOT / ".env"
PHP_SCRIPT = PROJECT_ROOT / "scripts" / "bitrix-coffer-image.php"
TEST_SCRIPT = PROJECT_ROOT / "scripts" / "bitrix-coffer-image.test.py"
SOURCE_IMAGE = (
    PROJECT_ROOT
    / "public"
    / "media"
    / "options"
    / "extreme-three-section-coffer-dimensions.jpg"
)
REPORT_ROOT = PROJECT_ROOT / "marketing-audits" / "bitrix"
CLONE_PROOF_RECEIPT = REPORT_ROOT / "ROSOMAHA_BITRIX_COFFER_IMAGE_CLONE_PROOF.json"

HOST = "ocelot.beget.com"
PORT = 22
EXPECTED_LOGIN = "berkutm4"
EXPECTED_HOST_KEY_SHA256 = "9NXXK7D+NukzmR6c/Ov2rAZElXlr2s1oP0QAAmUWs+c"
SITE_ROOT = "/home/b/berkutm4/rosomaha-rus.ru/public_html"
OPERATION_ROOT = "/home/b/berkutm4/migration/rosomaha-rus/ops/bitrix-coffer-image"
DOMAIN = "rosomaha-rus.ru"
SITE_ID = "s1"
EXPECTED_PHP_SERIES = "8.2"
PHP_CANDIDATES = (
    "/usr/local/php/cgi/8.2/bin/php",
    "/usr/local/php/8.2/bin/php",
    "/usr/local/php82/bin/php",
    "/opt/php/8.2/bin/php",
    "/usr/bin/php8.2",
    "/usr/local/bin/php8.2",
)

IBLOCK_ID = 86
ELEMENT_ID = 952
ELEMENT_CODE = "zadniy-kofr-plastikovyy-ekstrim-trekhsektsionnyy"
ELEMENT_NAME = "Задний кофр, пластиковый трехсекционный ЭКСТРИМ"
PRIMARY_SECTION_ID = 340
PHOTOS_PROPERTY_ID = 1201
PREVIEW_PICTURE_ID = 3335
BASELINE_DETAIL_PICTURE_ID = 3883
TARGET_SORT = 102
MODEL_IDS = (768, 879, 769)
MODEL_CODES = (
    "extrime-s-1-5l-dvs-1nz-fe",
    "extrime-1-5-litra-mosty-toyota",
    "extrime-plus-s-1-8l-dvs-1zz-fe",
)

SOURCE_SHA256 = "14d3973bbc0cab0cdcf43e88e97b1632116f0e4219837fd2fb36d07b43ff0eb6"
SOURCE_BYTES = 837_737
SOURCE_WIDTH = 3_000
SOURCE_HEIGHT = 2_636
ORIGINAL_SOURCE_SHA256 = (
    "a14f20ca64d2fe70f06a0915f127136bf30a58a20d1d186c69e9cf21e62866fd"
)

# Production apply stays fail-closed until the exact PHOTOS append call has a
# receipt from an isolated Bitrix copy proving that all eight existing property
# row IDs, CFile IDs, URLs and bytes survive both success and injected failure.
PHOTOS_APPEND_CLONE_PROOF_VERIFIED = False
THUMBNAIL_CLONE_PROOF_RECEIPT_SHA256: str | None = None
THUMBNAIL_EXPECTED_SHA256: str | None = None
THUMBNAIL_EXPECTED_BYTES: int | None = None
THUMBNAIL_EXPECTED_WIDTH: int | None = None
THUMBNAIL_EXPECTED_HEIGHT: int | None = None

PUBLIC_ORIGIN = "https://rosomaha-rus.ru"
OPTION_URL = f"{PUBLIC_ORIGIN}/product/{ELEMENT_CODE}/"
MODEL_URLS = tuple(f"{PUBLIC_ORIGIN}/product/{code}/" for code in MODEL_CODES)
SITEMAP_URL = f"{PUBLIC_ORIGIN}/sitemap.xml"
ALLOWED_PUBLIC_PAGES = frozenset((OPTION_URL, *MODEL_URLS, SITEMAP_URL))

MAX_PHP_BYTES = 128_000
MAX_REMOTE_COMMAND_BYTES = 220_000
MAX_REMOTE_SECONDS = 150
MAX_STDOUT_BYTES = 2_000_000
MAX_STDERR_BYTES = 32_000
MAX_JSON_BYTES = 1_000_000
MAX_OPERATION_BYTES = 128_000
MAX_HTML_BYTES = 1_000_000
MAX_SITEMAP_BYTES = 512_000
MAX_IMAGE_BYTES = 8_000_000
MAX_STAGE_TOTAL_BYTES = 32_000_000
MAX_PUBLIC_IMAGE_COUNT = 16
MAX_RECEIPT_BYTES = 4_000_000
MAX_ERROR_TEXT = 500

FRAME_BYTES = "__ROSOMAHA_COFFER_JSON_BYTES__="
FRAME_SHA = "__ROSOMAHA_COFFER_JSON_SHA256__="
FRAME_B64 = "__ROSOMAHA_COFFER_JSON_BASE64__="
PHP_VERSION_MARKER = "__ROSOMAHA_COFFER_PHP_VERSION__="
PHP_SHA_MARKER = "__ROSOMAHA_COFFER_PHP_SHA256__="
PHP_LINT_MARKER = "__ROSOMAHA_COFFER_PHP_LINT__=ok"
PREFLIGHT_ERROR_MARKER = "__ROSOMAHA_COFFER_PREFLIGHT_ERROR__="

OPERATION_MODES = frozenset({"apply", "recover", "rollback"})
WRITE_MODES = frozenset({"apply", "rollback"})


class CofferHelperError(RuntimeError):
    """Base error with a deliberately bounded user-facing message."""


class CredentialError(CofferHelperError):
    pass


class RemoteError(CofferHelperError):
    pass


class PublicGateError(CofferHelperError):
    pass


class AmbiguousApplyError(CofferHelperError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def safe_stamp(value: str | None = None) -> str:
    return re.sub(r"[^0-9TZ-]", "-", value or utc_now()).strip("-")


def canonical_json_bytes(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def evidence_sha256(value: object) -> str:
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def jpeg_dimensions(data: bytes) -> tuple[int, int]:
    if len(data) < 4 or data[:2] != b"\xff\xd8":
        raise CofferHelperError("Источник не является JPEG")
    offset = 2
    while offset + 9 <= len(data):
        if data[offset] != 0xFF:
            offset += 1
            continue
        marker = data[offset + 1]
        if marker in {0xD8, 0xD9}:
            offset += 2
            continue
        if offset + 4 > len(data):
            break
        length = int.from_bytes(data[offset + 2 : offset + 4], "big")
        if length < 2 or offset + 2 + length > len(data):
            break
        if marker in {
            0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
            0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF,
        }:
            height = int.from_bytes(data[offset + 5 : offset + 7], "big")
            width = int.from_bytes(data[offset + 7 : offset + 9], "big")
            if width < 1 or height < 1:
                raise CofferHelperError("Размеры JPEG недопустимы")
            return width, height
        offset += 2 + length
    raise CofferHelperError("В JPEG отсутствует корректный заголовок размеров")


def validate_source_image(path: Path = SOURCE_IMAGE) -> dict[str, object]:
    if (
        path.resolve() != SOURCE_IMAGE.resolve()
        or not path.is_file()
        or path.is_symlink()
        or path.stat().st_nlink != 1
    ):
        raise CofferHelperError("Разрешён только закреплённый файл изображения проекта")
    data = path.read_bytes()
    width, height = jpeg_dimensions(data)
    evidence = {
        "bytes": len(data),
        "sha256": sha256_bytes(data),
        "width": width,
        "height": height,
        "mime": "image/jpeg",
        "original_source_sha256": ORIGINAL_SOURCE_SHA256,
    }
    expected = {
        "bytes": SOURCE_BYTES,
        "sha256": SOURCE_SHA256,
        "width": SOURCE_WIDTH,
        "height": SOURCE_HEIGHT,
        "mime": "image/jpeg",
    }
    if any(evidence[key] != value for key, value in expected.items()):
        raise CofferHelperError("Закреплённое изображение не совпало с контрактом")
    try:
        evidence["path"] = str(path.relative_to(PROJECT_ROOT)).replace("\\", "/")
    except ValueError as exc:
        raise CofferHelperError(
            "Закреплённое изображение находится вне проекта"
        ) from exc
    return evidence


def _parse_env_value(raw: str) -> str:
    value = raw.strip()
    if not value:
        raise CredentialError("Закреплённое значение учётных данных пусто")
    if value[0] in {'"', "'"}:
        if len(value) < 2 or value[-1] != value[0]:
            raise CredentialError("Кавычки учётных данных повреждены")
        value = value[1:-1]
    elif value[-1:] in {'"', "'"}:
        raise CredentialError("Кавычки учётных данных повреждены")
    if not value or "\n" in value or "\r" in value:
        raise CredentialError("Значение учётных данных недопустимо")
    return value


def _credentials_from_text(text: str) -> tuple[str, str]:
    matches: dict[str, list[str]] = {"BEGET_LOGIN": [], "BEGET_PASSWORD": []}
    assignment = re.compile(
        r"^\s*(?:export\s+)?(BEGET_LOGIN|BEGET_PASSWORD)\s*=\s*(.*?)\s*$"
    )
    for line in text.splitlines():
        match = assignment.fullmatch(line)
        if match:
            matches[match.group(1)].append(match.group(2))
    standard_seen = any(matches.values())
    legacy = re.findall(
        r"https://cp\.beget\.com/\s+логин\s+(\S+)\s+пароль\s+(\S+)",
        text,
        flags=re.IGNORECASE,
    )
    if standard_seen:
        if legacy or any(len(matches[key]) != 1 for key in matches):
            raise CredentialError("Проектные учётные данные Beget неоднозначны")
        return (
            _parse_env_value(matches["BEGET_LOGIN"][0]),
            _parse_env_value(matches["BEGET_PASSWORD"][0]),
        )
    if len(legacy) != 1:
        raise CredentialError("Учётные данные Beget не найдены ровно один раз")
    return _parse_env_value(legacy[0][0]), _parse_env_value(legacy[0][1])


def load_credentials(
    *,
    environ: Mapping[str, str] | None = None,
    env_path: Path = ENV_PATH,
) -> tuple[str, str]:
    source = os.environ if environ is None else environ
    keys = ("BEGET_LOGIN", "BEGET_PASSWORD")
    present = [key in source for key in keys]
    if any(present):
        if not all(present):
            raise CredentialError("Учётные данные Beget в окружении неполны")
        login, password = (_parse_env_value(str(source[key])) for key in keys)
    else:
        if not env_path.is_file():
            raise CredentialError("Файл проектных учётных данных отсутствует")
        login, password = _credentials_from_text(
            env_path.read_text(encoding="utf-8-sig")
        )
    if login != EXPECTED_LOGIN:
        raise CredentialError("Обнаружен другой аккаунт Beget; соединение запрещено")
    return login, password


class PinnedHostKeyPolicy(paramiko.MissingHostKeyPolicy):
    def missing_host_key(
        self,
        client: paramiko.SSHClient,
        hostname: str,
        key: paramiko.PKey,
    ) -> None:
        fingerprint = base64.b64encode(
            hashlib.sha256(key.asbytes()).digest()
        ).decode("ascii").rstrip("=")
        if hostname != HOST or fingerprint != EXPECTED_HOST_KEY_SHA256:
            raise paramiko.SSHException("Ключ SSH-хоста не совпал с закреплённым")
        client.get_host_keys().add(hostname, key.get_name(), key)


def connect(
    *,
    environ: Mapping[str, str] | None = None,
    env_path: Path = ENV_PATH,
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
            raise RemoteError("SSH transport недоступен")
        fingerprint = base64.b64encode(
            hashlib.sha256(transport.get_remote_server_key().asbytes()).digest()
        ).decode("ascii").rstrip("=")
        if fingerprint != EXPECTED_HOST_KEY_SHA256:
            raise RemoteError("Ключ SSH-хоста изменился")
        return client
    except Exception:
        client.close()
        raise


FORBIDDEN_PHP_PATTERNS = (
    r"CIBlockElement\s*::\s*(?:Add|Delete)\s*\(",
    r"->\s*(?:Add|Delete)\s*\(",
    r"\$DB\s*->",
    r"\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|TRUNCATE)\s+",
    r"\beval\s*\(",
    r"\b(?:exec|system|shell_exec|passthru|proc_open|popen)\s*\(",
)


def validate_php_source(script_bytes: bytes) -> str:
    if not script_bytes or len(script_bytes) > MAX_PHP_BYTES:
        raise CofferHelperError("Размер закреплённого PHP helper недопустим")
    try:
        source = script_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise CofferHelperError("PHP helper должен быть UTF-8") from exc
    required = (
        "ROSOMAHA_COFFER_IBLOCK_ID = 86",
        "ROSOMAHA_COFFER_ELEMENT_ID = 952",
        "ROSOMAHA_COFFER_PHOTOS_PROPERTY_ID = 1201",
        "ROSOMAHA_COFFER_PRIMARY_SECTION_ID = 340",
        "ROSOMAHA_COFFER_PREVIEW",
        "ROSOMAHA_COFFER_PHOTOS_APPEND_CLONE_PROOF = false",
        "ROSOMAHA_COFFER_CLONE_PROOF_RECEIPT_SHA256 = null",
        "'thumbnail_clone_proof'",
        SOURCE_SHA256,
        ORIGINAL_SOURCE_SHA256,
        "rosomahaCofferAppendOldDetail(",
        "rosomahaCofferRemoveAppendedPhoto(",
        "rosomahaCofferApply(",
        "rosomahaCofferRecover(",
        "rosomahaCofferRollback(",
        FRAME_BYTES,
        FRAME_SHA,
        FRAME_B64,
    )
    # PREVIEW_PICTURE is intentionally a read-only invariant; this alias makes
    # that rule visible to the static validator without adding a write surface.
    required = tuple(
        "'PREVIEW_PICTURE'" if item == "ROSOMAHA_COFFER_PREVIEW" else item
        for item in required
    )
    if not source.startswith("<?php") or any(item not in source for item in required):
        raise CofferHelperError("Контракт PHP helper неполон")
    if any(re.search(pattern, source, re.IGNORECASE) for pattern in FORBIDDEN_PHP_PATTERNS):
        raise CofferHelperError("PHP helper содержит запрещённую поверхность")
    if source.count("CIBlockElement::SetPropertyValuesEx(") != 2:
        raise CofferHelperError("PHP helper должен иметь ровно два guarded PHOTOS writer")
    if source.count("->Update(") != 1:
        raise CofferHelperError("PHP helper должен иметь ровно один guarded field writer")
    update_fragment = source.split("function rosomahaCofferSetDetail", 1)[1].split(
        "function rosomahaCofferClassification", 1
    )[0]
    if "'DETAIL_PICTURE'" not in update_fragment or "'PREVIEW_PICTURE'" in update_fragment:
        raise CofferHelperError("Field writer вышел за DETAIL_PICTURE")
    apply_fragment = source.split("function rosomahaCofferApply", 1)[1].split(
        "function rosomahaCofferRecover", 1
    )[0]
    if (
        "ROSOMAHA_COFFER_PHOTOS_APPEND_CLONE_PROOF !== true" not in apply_fragment
        or "photos_append_clone_proof_missing" not in apply_fragment
    ):
        raise CofferHelperError("PHP apply должен оставаться fail-closed до clone proof")
    return sha256_bytes(script_bytes)


def _canonical_operation_bytes(payload: Mapping[str, object]) -> bytes:
    data = canonical_json_bytes(dict(payload))
    if not data or len(data) > MAX_OPERATION_BYTES:
        raise CofferHelperError("Размер operation payload недопустим")
    return data


def build_remote_command(
    script_bytes: bytes,
    mode: str = "audit",
    operation_payload: Mapping[str, object] | None = None,
) -> tuple[str, str]:
    digest = validate_php_source(script_bytes)
    if mode == "audit":
        if operation_payload is not None:
            raise ValueError("Audit не принимает operation payload")
        remote_args = "'audit'"
    elif mode in OPERATION_MODES:
        if operation_payload is None:
            raise ValueError("Operation mode требует payload")
        operation_id = operation_payload.get("operation_id")
        if not isinstance(operation_id, str) or re.fullmatch(
            r"bitrix-coffer-[a-f0-9]{24}", operation_id
        ) is None:
            raise ValueError("Operation id недопустим")
        raw = _canonical_operation_bytes(operation_payload)
        encoded = base64.b64encode(raw).decode("ascii")
        remote_args = (
            f"'{mode}' '{operation_id}' '{encoded}' '{sha256_bytes(raw)}'"
        )
    else:
        raise ValueError("Remote mode не входит в allowlist")
    encoded_script = base64.b64encode(script_bytes).decode("ascii")
    if not re.fullmatch(r"[A-Za-z0-9+/]+={0,2}", encoded_script):
        raise CofferHelperError("Кодирование PHP helper не прошло контракт")
    candidates = " ".join(f"'{item}'" for item in PHP_CANDIDATES)
    command = f"""
set -eu
if [ "$(/usr/bin/id -un)" != '{EXPECTED_LOGIN}' ]; then
  printf '%s%s\n' '{PREFLIGHT_ERROR_MARKER}' 'login_mismatch'
  exit 1
fi
if [ "$(/usr/bin/realpath -- '{SITE_ROOT}')" != '{SITE_ROOT}' ]; then
  printf '%s%s\n' '{PREFLIGHT_ERROR_MARKER}' 'site_root_mismatch'
  exit 1
fi
if [ ! -f '{SITE_ROOT}/bitrix/modules/main/include/prolog_before.php' ]; then
  printf '%s%s\n' '{PREFLIGHT_ERROR_MARKER}' 'prolog_missing'
  exit 1
fi
php_binary=''
php_version=''
for candidate in {candidates}; do
  if [ -x "$candidate" ]; then
    version="$("$candidate" -r 'echo PHP_VERSION;' 2>/dev/null || true)"
    case "$version" in
      {EXPECTED_PHP_SERIES}.*) php_binary="$candidate"; php_version="$version"; break ;;
    esac
  fi
done
if [ -z "$php_binary" ]; then
  printf '%s%s\n' '{PREFLIGHT_ERROR_MARKER}' 'php_series_missing'
  exit 1
fi
payload() {{ printf '%s' '{encoded_script}' | /usr/bin/base64 -d; }}
payload_sha="$(payload | /usr/bin/sha256sum | /usr/bin/awk '{{print $1}}')"
if [ "$payload_sha" != '{digest}' ]; then
  printf '%s%s\n' '{PREFLIGHT_ERROR_MARKER}' 'php_sha_mismatch'
  exit 1
fi
if ! payload | /usr/bin/timeout 20s "$php_binary" -l >/dev/null 2>/dev/null; then
  printf '%s%s\n' '{PREFLIGHT_ERROR_MARKER}' 'php_lint_failed'
  exit 1
fi
printf '%s%s\n' '{PHP_VERSION_MARKER}' "$php_version"
printf '%s%s\n' '{PHP_SHA_MARKER}' "$payload_sha"
printf '%s\n' '{PHP_LINT_MARKER}'
payload | /usr/bin/timeout 120s "$php_binary" -d display_errors=stderr -d log_errors=0 -- {remote_args}
"""
    if not command.isascii() or len(command.encode("ascii")) > MAX_REMOTE_COMMAND_BYTES:
        raise CofferHelperError("Remote command превысил закреплённый лимит")
    return command, digest


def run_remote_command(
    client: paramiko.SSHClient,
    command: str,
    *,
    timeout_seconds: int = MAX_REMOTE_SECONDS,
) -> tuple[int, str, str]:
    _, stdout, _ = client.exec_command(command, timeout=20)
    channel = stdout.channel
    output = bytearray()
    error = bytearray()
    deadline = time.monotonic() + timeout_seconds
    while True:
        progressed = False
        while channel.recv_ready():
            output.extend(channel.recv(65536))
            progressed = True
            if len(output) > MAX_STDOUT_BYTES:
                channel.close()
                raise RemoteError("Remote stdout превысил лимит")
        while channel.recv_stderr_ready():
            error.extend(channel.recv_stderr(16384))
            progressed = True
            if len(error) > MAX_STDERR_BYTES:
                channel.close()
                raise RemoteError("Remote stderr превысил лимит")
        if channel.exit_status_ready() and not channel.recv_ready() and not channel.recv_stderr_ready():
            break
        if time.monotonic() >= deadline:
            channel.close()
            raise RemoteError("Remote command завершился по таймауту")
        if not progressed:
            time.sleep(0.02)
    status = channel.recv_exit_status()
    try:
        return status, output.decode("ascii"), error.decode("utf-8", errors="replace")
    except UnicodeDecodeError as exc:
        raise RemoteError("Remote frame не является ASCII") from exc


def parse_remote_frame(
    status: int,
    stdout: str,
    stderr: str,
    *,
    expected_script_sha256: str,
) -> dict[str, object]:
    if stderr:
        raise RemoteError("Remote helper вывел stderr")
    lines = [line for line in stdout.splitlines() if line]
    preflight = [line for line in lines if line.startswith(PREFLIGHT_ERROR_MARKER)]
    if preflight:
        code = preflight[0][len(PREFLIGHT_ERROR_MARKER) :]
        if not re.fullmatch(r"[a-z0-9_]{3,80}", code):
            code = "invalid_preflight_frame"
        raise RemoteError(f"Remote preflight заблокирован: {code}")
    markers: dict[str, list[str]] = {}
    for prefix in (
        PHP_VERSION_MARKER,
        PHP_SHA_MARKER,
        FRAME_BYTES,
        FRAME_SHA,
        FRAME_B64,
    ):
        markers[prefix] = [line[len(prefix) :] for line in lines if line.startswith(prefix)]
        if len(markers[prefix]) != 1:
            raise RemoteError("Remote frame имеет неверное число маркеров")
    if PHP_LINT_MARKER not in lines or markers[PHP_SHA_MARKER][0] != expected_script_sha256:
        raise RemoteError("Remote PHP identity не подтверждена")
    if not markers[PHP_VERSION_MARKER][0].startswith(EXPECTED_PHP_SERIES + "."):
        raise RemoteError("Remote PHP version не совпала с закреплённой")
    try:
        raw = base64.b64decode(markers[FRAME_B64][0], validate=True)
        declared_bytes = int(markers[FRAME_BYTES][0])
    except (ValueError, TypeError) as exc:
        raise RemoteError("Remote JSON frame не декодируется") from exc
    if not raw or len(raw) > MAX_JSON_BYTES or len(raw) != declared_bytes:
        raise RemoteError("Размер Remote JSON frame недопустим")
    if sha256_bytes(raw) != markers[FRAME_SHA][0]:
        raise RemoteError("Remote JSON frame не прошёл SHA-256")
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RemoteError("Remote JSON frame повреждён") from exc
    if not isinstance(payload, dict) or status not in {0, 1}:
        raise RemoteError("Remote result shape недопустим")
    if status == 0 and payload.get("status") not in {"ok", "blocked"}:
        raise RemoteError("Remote success status не согласован с JSON")
    if status == 1 and payload.get("status") != "error":
        raise RemoteError("Remote error status не согласован с JSON")
    return payload


def validate_remote_audit(remote: Mapping[str, object]) -> dict[str, object]:
    if (
        remote.get("status") != "ok"
        or remote.get("mode") != "audit"
        or remote.get("read_only") is not True
        or remote.get("database_mutations") != 0
        or remote.get("apply_supported") is not False
    ):
        raise RemoteError("Remote audit не доказал read-only контракт")
    state = remote.get("state")
    if not isinstance(state, dict):
        raise RemoteError("Remote audit не вернул state")
    if (
        state.get("element_id") != ELEMENT_ID
        or state.get("code") != ELEMENT_CODE
        or not re.fullmatch(r"[a-f0-9]{64}", str(state.get("state_sha256", "")))
        or not re.fullmatch(r"[a-f0-9]{64}", str(state.get("invariant_sha256", "")))
    ):
        raise RemoteError("Remote state identity недопустима")
    if evidence_sha256({key: value for key, value in state.items() if key != "state_sha256"}) != state["state_sha256"]:
        raise RemoteError("Remote state SHA-256 не согласован")
    detail = state.get("detail_picture")
    photos = state.get("photos")
    gallery = state.get("gallery_sha256")
    if not isinstance(detail, dict) or not isinstance(photos, list) or len(photos) != 8:
        raise RemoteError("Remote baseline должен иметь DETAIL + 8 PHOTOS")
    if detail.get("id") != BASELINE_DETAIL_PICTURE_ID:
        raise RemoteError("DETAIL_PICTURE ID дрейфовал от подтверждённого baseline")
    if not isinstance(gallery, list) or len(gallery) != 9:
        raise RemoteError("Remote gallery baseline имеет неверный размер")
    if gallery != [detail.get("sha256"), *[row.get("file", {}).get("sha256") for row in photos]]:
        raise RemoteError("Remote gallery hashes не согласованы с файлами")
    if detail.get("sha256") == SOURCE_SHA256:
        raise RemoteError("Новое изображение уже является DETAIL_PICTURE")
    value_ids: list[int] = []
    file_ids: list[int] = []
    for row in photos:
        if not isinstance(row, dict) or not isinstance(row.get("file"), dict):
            raise RemoteError("PHOTOS row shape недопустим")
        value_ids.append(row.get("property_value_id"))
        file_ids.append(row["file"].get("id"))
    if any(type(value) is not int or value <= 0 for value in (*value_ids, *file_ids)):
        raise RemoteError("PHOTOS содержит недопустимые идентификаторы")
    if len(set(value_ids)) != 8 or len(set(file_ids)) != 8:
        raise RemoteError("PHOTOS содержит дублирующиеся идентификаторы")
    invariants = state.get("invariants")
    if not isinstance(invariants, dict):
        raise RemoteError("Remote invariants отсутствуют")
    preview = invariants.get("preview_picture")
    models = invariants.get("models")
    if not isinstance(preview, dict) or preview.get("id") != PREVIEW_PICTURE_ID:
        raise RemoteError("PREVIEW_PICTURE дрейфовал")
    if not isinstance(models, list) or [model.get("id") for model in models] != list(MODEL_IDS):
        raise RemoteError("Три model-link invariants не подтверждены")
    if any(model.get("target_position") is None for model in models):
        raise RemoteError("Опция отсутствует в одной из трёх моделей")
    if remote.get("ready_for_apply") is not False:
        raise RemoteError("Remote audit должен держать apply в NO-GO")
    return json.loads(json.dumps(state, ensure_ascii=False))


def require_photos_append_clone_proof() -> None:
    descriptor = thumbnail_clone_proof_descriptor()
    if (
        PHOTOS_APPEND_CLONE_PROOF_VERIFIED is not True
        or not thumbnail_clone_proof_is_exact(descriptor)
        or not validate_clone_proof_receipt(descriptor)
    ):
        raise CofferHelperError(
            "NO-GO: PHOTOS/thumbnail не доказаны на изолированной копии Bitrix; apply заблокирован"
        )


def thumbnail_clone_proof_descriptor() -> dict[str, object]:
    return {
        "receipt_sha256": THUMBNAIL_CLONE_PROOF_RECEIPT_SHA256,
        "sha256": THUMBNAIL_EXPECTED_SHA256,
        "bytes": THUMBNAIL_EXPECTED_BYTES,
        "width": THUMBNAIL_EXPECTED_WIDTH,
        "height": THUMBNAIL_EXPECTED_HEIGHT,
    }


def thumbnail_clone_proof_is_exact(value: object) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == {"receipt_sha256", "sha256", "bytes", "width", "height"}
        and re.fullmatch(r"[a-f0-9]{64}", str(value.get("receipt_sha256", "")))
            is not None
        and re.fullmatch(r"[a-f0-9]{64}", str(value.get("sha256", "")))
            is not None
        and type(value.get("bytes")) is int
        and 1 <= value["bytes"] <= 1_000_000
        and type(value.get("width")) is int
        and type(value.get("height")) is int
        and 1 <= value["width"] <= 520
        and 1 <= value["height"] <= 520
    )


def validate_clone_proof_receipt(descriptor: Mapping[str, object]) -> bool:
    if not CLONE_PROOF_RECEIPT.is_file() or CLONE_PROOF_RECEIPT.is_symlink():
        return False
    raw = CLONE_PROOF_RECEIPT.read_bytes()
    if (
        not raw
        or len(raw) > 1_000_000
        or sha256_bytes(raw) != descriptor.get("receipt_sha256")
    ):
        return False
    try:
        receipt = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return False
    return (
        isinstance(receipt, dict)
        and receipt.get("schema_version") == 1
        and receipt.get("isolated_bitrix_copy") is True
        and receipt.get("source_sha256") == SOURCE_SHA256
        and receipt.get("photos_append_success") == {
            "existing_eight_rows_exact": True,
            "old_detail_appended": True,
        }
        and receipt.get("photos_append_injected_failure") == {
            "baseline_exact": True,
            "existing_eight_rows_exact": True,
        }
        and receipt.get("thumbnail") == {
            "sha256": descriptor.get("sha256"),
            "bytes": descriptor.get("bytes"),
            "width": descriptor.get("width"),
            "height": descriptor.get("height"),
        }
    )


def validate_remote_operation_state(
    remote: Mapping[str, object],
    payload: Mapping[str, object],
) -> dict[str, object]:
    validate_operation_payload(payload)
    if (
        remote.get("operation_id") != payload.get("operation_id")
        or remote.get("mode") not in {"apply", "recover", "rollback"}
        or remote.get("classification") not in {
            "baseline_exact", "photos_prepared", "applied_exact",
            "rolled_back_semantic", "invariant_drift", "partial_or_external_drift",
        }
    ):
        raise RemoteError("Remote operation identity недопустима")
    state = remote.get("state")
    if not isinstance(state, dict) or set(state) != {
        "element_id", "code", "detail_picture", "photos", "invariants",
        "invariant_sha256", "gallery_sha256", "state_sha256",
    }:
        raise RemoteError("Remote operation state shape недопустим")
    if (
        evidence_sha256({key: value for key, value in state.items() if key != "state_sha256"})
        != state.get("state_sha256")
        or not isinstance(state.get("invariants"), dict)
        or evidence_sha256(state["invariants"]) != state.get("invariant_sha256")
        or state.get("element_id") != ELEMENT_ID
        or state.get("code") != ELEMENT_CODE
    ):
        raise RemoteError("Remote operation state hash недопустим")
    detail = state.get("detail_picture")
    photos = state.get("photos")
    gallery = state.get("gallery_sha256")
    if not isinstance(detail, dict) or not isinstance(photos, list) or not isinstance(gallery, list):
        raise RemoteError("Remote operation gallery shape недопустим")
    current_hashes = [
        detail.get("sha256"),
        *[
            row.get("file", {}).get("sha256")
            if isinstance(row, dict) and isinstance(row.get("file"), dict)
            else None
            for row in photos
        ],
    ]
    if gallery != current_hashes:
        raise RemoteError("Remote operation gallery hashes не согласованы")
    classification = remote["classification"]
    before = payload["before"]
    expected = payload["expected"]
    if classification == "baseline_exact":
        exact = state.get("state_sha256") == before["state_sha256"]
    elif classification == "applied_exact":
        exact = (
            len(photos) == 9
            and gallery == expected["gallery_sha256"]
            and photos[:8] == before["photos"]
            and state.get("invariant_sha256") == expected["invariant_sha256"]
        )
    elif classification == "rolled_back_semantic":
        exact = (
            len(photos) == 8
            and gallery == before["gallery_sha256"]
            and photos == before["photos"]
            and state.get("invariant_sha256") == expected["invariant_sha256"]
        )
    else:
        exact = True
    if not exact:
        raise RemoteError("Remote classification не согласована с state")
    return json.loads(json.dumps(state, ensure_ascii=False))


def execute_remote(
    mode: str = "audit",
    operation_payload: Mapping[str, object] | None = None,
    *,
    client: paramiko.SSHClient | None = None,
    connect_fn: Callable[[], paramiko.SSHClient] = connect,
) -> dict[str, object]:
    script_bytes = PHP_SCRIPT.read_bytes()
    command, digest = build_remote_command(script_bytes, mode, operation_payload)
    owned = client is None
    active_client = connect_fn() if owned else client
    if active_client is None:
        raise RemoteError("SSH client отсутствует")
    try:
        status, stdout, stderr = run_remote_command(active_client, command)
        return parse_remote_frame(
            status,
            stdout,
            stderr,
            expected_script_sha256=digest,
        )
    finally:
        if owned:
            active_client.close()


class ProductPageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.canonical: list[str] = []
        self.robots: list[str] = []
        self.descriptions: list[str] = []
        self.og_images: list[str] = []
        self.itemprop_images: list[str] = []
        self.gallery: list[str] = []
        self.gallery_thumbnails: list[str] = []
        self.controls: list[dict[str, str]] = []
        self._in_title = False
        self._in_h1 = 0
        self._in_body = 0
        self._ignored_depth = 0
        self._json_ld_parts: list[str] | None = None
        self._gallery_anchor_depth = 0
        self._title_parts: list[str] = []
        self._h1_parts: list[str] = []
        self._visible_parts: list[str] = []
        self.json_ld_blocks: list[str] = []

    @staticmethod
    def attrs(values: list[tuple[str, str | None]]) -> dict[str, str]:
        return {key.casefold(): value or "" for key, value in values}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = self.attrs(attrs)
        tag = tag.casefold()
        if tag == "body":
            self._in_body += 1
        if tag in {"script", "style", "noscript", "template"}:
            self._ignored_depth += 1
            if (
                tag == "script"
                and values.get("type", "").split(";", 1)[0].strip().casefold()
                == "application/ld+json"
            ):
                self._json_ld_parts = []
            return
        if self._ignored_depth:
            return
        if tag == "title":
            self._in_title = True
        elif tag == "h1":
            self._in_h1 += 1
        elif tag == "link":
            rel = {item.casefold() for item in values.get("rel", "").split()}
            if "canonical" in rel and values.get("href"):
                self.canonical.append(values["href"])
            if values.get("itemprop", "").casefold() == "image" and values.get("href"):
                self.itemprop_images.append(values["href"])
        elif tag == "meta":
            name = values.get("name", "").casefold()
            prop = values.get("property", "").casefold()
            if name == "robots":
                self.robots.append(values.get("content", ""))
            if name == "description":
                self.descriptions.append(values.get("content", ""))
            if prop == "og:image":
                self.og_images.append(values.get("content", ""))
        elif tag == "a" and values.get("data-fancybox") == "gallery":
            if values.get("href"):
                self.gallery.append(values["href"])
            self._gallery_anchor_depth += 1
        elif tag == "img" and self._gallery_anchor_depth > 0 and values.get("src"):
            self.gallery_thumbnails.append(values["src"])
        elif tag == "span" and values.get("onclick") == "priceCalculator.toggleOption(this)":
            self.controls.append(values)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.casefold()
        if tag in {"script", "style", "noscript", "template"}:
            if tag == "script" and self._json_ld_parts is not None:
                self.json_ld_blocks.append("".join(self._json_ld_parts))
                self._json_ld_parts = None
            if self._ignored_depth > 0:
                self._ignored_depth -= 1
            return
        if self._ignored_depth:
            return
        if tag == "title":
            self._in_title = False
        elif tag == "h1" and self._in_h1 > 0:
            self._in_h1 -= 1
        elif tag == "a" and self._gallery_anchor_depth > 0:
            self._gallery_anchor_depth -= 1
        if tag == "body" and self._in_body > 0:
            self._in_body -= 1

    def handle_data(self, data: str) -> None:
        if self._json_ld_parts is not None:
            self._json_ld_parts.append(data)
        if self._ignored_depth:
            return
        if self._in_title:
            self._title_parts.append(data)
        if self._in_h1:
            self._h1_parts.append(data)
        if self._in_body:
            self._visible_parts.append(data)

    @property
    def title(self) -> str:
        return re.sub(r"\s+", " ", "".join(self._title_parts)).strip()

    @property
    def h1(self) -> str:
        return re.sub(r"\s+", " ", "".join(self._h1_parts)).strip()

    @property
    def visible_text(self) -> str:
        return re.sub(r"\s+", " ", " ".join(self._visible_parts)).strip()


def structured_data_snapshot(
    blocks: Sequence[str],
    *,
    base_url: str,
) -> dict[str, object]:
    if not blocks or len(blocks) > 64:
        raise PublicGateError("JSON-LD blocks отсутствуют или вышли за лимит")
    documents: list[object] = []
    product_images: list[str] = []
    product_count = 0

    def image_urls(value: object) -> list[str]:
        if isinstance(value, str):
            return [urljoin(base_url, value)]
        if isinstance(value, list):
            return [url for item in value for url in image_urls(item)]
        if isinstance(value, dict):
            urls: list[str] = []
            for key in ("url", "contentUrl"):
                if key in value:
                    urls.extend(image_urls(value[key]))
            return urls
        return []

    def mask(value: object) -> object:
        nonlocal product_count
        if isinstance(value, list):
            return [mask(item) for item in value]
        if not isinstance(value, dict):
            return value
        raw_type = value.get("@type")
        types = raw_type if isinstance(raw_type, list) else [raw_type]
        is_product = any(
            isinstance(item, str) and item.casefold() == "product"
            for item in types
        )
        result: dict[str, object] = {}
        if is_product:
            product_count += 1
        for key, item in value.items():
            if is_product and key == "image":
                product_images.extend(image_urls(item))
                result[key] = "__ROSOMAHA_PRODUCT_IMAGE__"
            else:
                result[key] = mask(item)
        return result

    for raw in blocks:
        if not raw.strip():
            raise PublicGateError("JSON-LD block пуст")
        try:
            value = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise PublicGateError("JSON-LD повреждён") from exc
        documents.append(mask(value))
    if product_count != 1 or not product_images:
        raise PublicGateError("Нужен ровно один JSON-LD Product с image")
    return {
        "document_count": len(documents),
        "product_count": product_count,
        "product_images": product_images,
        "masked_sha256": evidence_sha256(documents),
    }


def fetch_public(url: str, *, max_bytes: int, accept: str) -> dict[str, object]:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.netloc != DOMAIN or parsed.username or parsed.password:
        raise PublicGateError("Public URL вышел за закреплённый домен")
    if url not in ALLOWED_PUBLIC_PAGES and not parsed.path.startswith("/upload/"):
        raise PublicGateError("Public URL вышел за allowlist")
    request = Request(
        url,
        headers={"Accept": accept, "User-Agent": "RosomahaCofferImageAudit/1.0"},
    )
    try:
        with urlopen(request, timeout=25) as response:
            body = response.read(max_bytes + 1)
            status = int(response.status)
            final = response.geturl()
            content_type = response.headers.get("Content-Type", "")
    except Exception as exc:
        raise PublicGateError(f"Public HTTP недоступен: {type(exc).__name__}") from exc
    if len(body) > max_bytes:
        raise PublicGateError("Public response превысил лимит")
    return {
        "status": status,
        "final_url": final,
        "content_type": content_type,
        "body": body,
    }


def parse_public_page(url: str) -> dict[str, object]:
    response = fetch_public(url, max_bytes=MAX_HTML_BYTES, accept="text/html")
    if response["status"] != 200 or response["final_url"] != url:
        raise PublicGateError("Public page не подтвердила exact 200 URL")
    try:
        text = response["body"].decode("utf-8")
    except UnicodeDecodeError as exc:
        raise PublicGateError("Public HTML не является UTF-8") from exc
    parser = ProductPageParser()
    parser.feed(text)
    parser.close()
    canonical = [urljoin(url, item) for item in parser.canonical]
    robots = ",".join(parser.robots).casefold()
    if canonical != [url] or "noindex" in robots or "none" in robots:
        raise PublicGateError("Public canonical/robots gate не пройден")
    visible_bytes = parser.visible_text.encode("utf-8")
    if not visible_bytes:
        raise PublicGateError("Public visible content пуст")
    structured_data = structured_data_snapshot(parser.json_ld_blocks, base_url=url)
    return {
        "status": 200,
        "final_url": url,
        "canonical": canonical,
        "robots": parser.robots,
        "indexable": True,
        "title": parser.title,
        "h1": parser.h1,
        "description": parser.descriptions,
        "og_image": [urljoin(url, item) for item in parser.og_images],
        "itemprop_image": [urljoin(url, item) for item in parser.itemprop_images],
        "visible_text": {
            "bytes": len(visible_bytes),
            "sha256": sha256_bytes(visible_bytes),
        },
        "structured_data": structured_data,
        "gallery_urls": [urljoin(url, item) for item in parser.gallery],
        "gallery_thumbnail_urls": [
            urljoin(url, item) for item in parser.gallery_thumbnails
        ],
        "controls": parser.controls,
    }


def public_image_snapshot(url: str) -> dict[str, object]:
    response = fetch_public(url, max_bytes=MAX_IMAGE_BYTES, accept="image/jpeg")
    if response["status"] != 200 or response["final_url"] != url:
        raise PublicGateError("Public image не подтвердила exact 200 URL")
    data = response["body"]
    width, height = jpeg_dimensions(data)
    return {
        "url": url,
        "bytes": len(data),
        "sha256": sha256_bytes(data),
        "width": width,
        "height": height,
        "content_type": response["content_type"],
    }


def public_audit() -> dict[str, object]:
    option = parse_public_page(OPTION_URL)
    gallery_urls = option.pop("gallery_urls")
    thumbnails = option.pop("gallery_thumbnail_urls")
    controls = option.pop("controls")
    if controls:
        # The option page itself is not one of the calculator pages.
        option["unexpected_calculator_controls"] = len(controls)
    if not isinstance(gallery_urls, list) or not 1 <= len(gallery_urls) <= MAX_PUBLIC_IMAGE_COUNT:
        raise PublicGateError("Public gallery count вышел за контракт")
    if len(set(gallery_urls)) != len(gallery_urls):
        raise PublicGateError("Public gallery содержит дубликаты URL")
    gallery = [public_image_snapshot(url) for url in gallery_urls]
    if option["itemprop_image"] != [gallery_urls[0]]:
        raise PublicGateError("itemprop=image не совпал с первым gallery image")
    structured = option["structured_data"]
    if structured["product_images"] != [gallery_urls[0]]:
        raise PublicGateError(
            "JSON-LD Product.image должен точно совпасть с первым gallery image"
        )
    thumbnail = public_image_snapshot(thumbnails[0]) if thumbnails else None
    if (
        thumbnail is None
        or thumbnail["bytes"] > 1_000_000
        or thumbnail["width"] > 520
        or thumbnail["height"] > 520
    ):
        raise PublicGateError("First rendered thumbnail не прошёл mobile weight gate")

    models: list[dict[str, object]] = []
    for model_id, model_code, url in zip(MODEL_IDS, MODEL_CODES, MODEL_URLS, strict=True):
        page = parse_public_page(url)
        controls = page.pop("controls")
        page.pop("gallery_urls")
        page.pop("gallery_thumbnail_urls")
        target_indexes = [
            index
            for index, item in enumerate(controls)
            if item.get("data-product-id") == str(ELEMENT_ID)
        ]
        if target_indexes != [5]:
            raise PublicGateError("Опция 952 должна оставаться шестой в каждой модели")
        target = controls[target_indexes[0]]
        if target.get("data-sum") != "75000" or target.get("data-name") != ELEMENT_NAME:
            raise PublicGateError("Публичная цена/имя опции 952 дрейфовали")
        models.append(
            {
                "id": model_id,
                "code": model_code,
                "page": page,
                "control_count": len(controls),
                "target_position": target_indexes[0],
                "target": {
                    "product_id": target.get("data-product-id"),
                    "sum": target.get("data-sum"),
                    "name": target.get("data-name"),
                    "row_id": target.get("data-row-id"),
                },
            }
        )

    sitemap = fetch_public(SITEMAP_URL, max_bytes=MAX_SITEMAP_BYTES, accept="application/xml")
    if sitemap["status"] != 200 or sitemap["final_url"] != SITEMAP_URL:
        raise PublicGateError("Public sitemap не подтвердила exact 200 URL")
    try:
        root = ET.fromstring(sitemap["body"])
    except ET.ParseError as exc:
        raise PublicGateError("Public sitemap XML повреждён") from exc
    locations = [
        element.text.strip()
        for element in root.iter()
        if element.tag.rsplit("}", 1)[-1] == "loc" and element.text
    ]
    if locations.count(OPTION_URL) != 1:
        raise PublicGateError("URL опции должен быть ровно один раз в sitemap")
    return {
        "generated_at_utc": utc_now(),
        "option": option,
        "gallery": gallery,
        "first_thumbnail": thumbnail,
        "models": models,
        "sitemap": {
            "url": SITEMAP_URL,
            "status": 200,
            "target_count": 1,
            "location_count": len(locations),
            "sha256": sha256_bytes(sitemap["body"]),
        },
    }


def validate_public_baseline(public: Mapping[str, object]) -> dict[str, object]:
    gallery = public.get("gallery")
    option = public.get("option")
    models = public.get("models")
    if not isinstance(gallery, list) or len(gallery) != 9:
        raise PublicGateError("Baseline public gallery должна содержать 9 файлов")
    if not isinstance(option, dict) or not option.get("title") or not option.get("h1"):
        raise PublicGateError("Baseline option head неполон")
    if (
        not isinstance(option.get("visible_text"), dict)
        or not isinstance(option.get("structured_data"), dict)
    ):
        raise PublicGateError("Baseline content/JSON-LD evidence неполна")
    if not isinstance(models, list) or [model.get("id") for model in models] != list(MODEL_IDS):
        raise PublicGateError("Baseline трёх моделей неполон")
    return json.loads(json.dumps(public, ensure_ascii=False))


def validate_database_public_parity(
    state: Mapping[str, object],
    public: Mapping[str, object],
) -> None:
    gallery = public.get("gallery")
    if not isinstance(gallery, list):
        raise PublicGateError("Public gallery evidence отсутствует")
    database_hashes = state.get("gallery_sha256")
    public_hashes = [row.get("sha256") for row in gallery]
    database_urls = [
        PUBLIC_ORIGIN + state["detail_picture"]["relative_path"],
        *[
            PUBLIC_ORIGIN + row["file"]["relative_path"]
            for row in state["photos"]
        ],
    ]
    public_urls = [row.get("url") for row in gallery]
    if database_hashes != public_hashes or database_urls != public_urls:
        raise PublicGateError("Database CFile order не совпал с public gallery")


def operation_id(before: Mapping[str, object]) -> str:
    state_hash = before.get("state_sha256")
    if not isinstance(state_hash, str) or re.fullmatch(r"[a-f0-9]{64}", state_hash) is None:
        raise CofferHelperError("Baseline state hash недопустим")
    seed = f"{ELEMENT_ID}|{SOURCE_SHA256}|{state_hash}".encode("ascii")
    return "bitrix-coffer-" + hashlib.sha256(seed).hexdigest()[:24]


def build_operation_payload(
    before: Mapping[str, object],
    source: Mapping[str, object],
) -> dict[str, object]:
    op_id = operation_id(before)
    photos = before["photos"]
    old_gallery = before["gallery_sha256"]
    expected_gallery = [SOURCE_SHA256, *old_gallery[1:], old_gallery[0]]
    before_files = [before["detail_picture"], *[row["file"] for row in photos]]
    backups = [
        {
            "path": f"{OPERATION_ROOT}/{op_id}/before-{index:02d}.jpg",
            "sha256": file["sha256"],
            "bytes": file["bytes"],
            "width": file["width"],
            "height": file["height"],
        }
        for index, file in enumerate(before_files)
    ]
    return {
        "schema": 1,
        "operation_id": op_id,
        "before": json.loads(json.dumps(before, ensure_ascii=False)),
        "expected": {
            "gallery_sha256": expected_gallery,
            "invariant_sha256": before["invariant_sha256"],
            "existing_photo_property_value_ids": [
                row["property_value_id"] for row in photos
            ],
            "existing_photo_file_ids": [row["file"]["id"] for row in photos],
            "public_gallery_count": 10,
            "old_detail_final": True,
            "thumbnail_clone_proof": thumbnail_clone_proof_descriptor(),
        },
        "source": {
            "path": f"{OPERATION_ROOT}/{op_id}/source.jpg",
            "sha256": source["sha256"],
            "bytes": source["bytes"],
            "width": source["width"],
            "height": source["height"],
        },
        "backups": backups,
    }


def validate_operation_payload(payload: Mapping[str, object]) -> None:
    if set(payload) != {
        "schema", "operation_id", "before", "expected", "source", "backups"
    }:
        raise CofferHelperError("Operation payload имеет лишние или пропущенные поля")
    expected = payload.get("expected")
    before = payload.get("before")
    source = payload.get("source")
    backups = payload.get("backups")
    if (
        payload.get("schema") != 1
        or not isinstance(before, dict)
        or not isinstance(expected, dict)
        or not isinstance(source, dict)
        or not isinstance(backups, list)
        or payload.get("operation_id") != operation_id(before)
    ):
        raise CofferHelperError("Operation payload не прошёл локальный контракт")

    required_state_keys = {
        "element_id", "code", "detail_picture", "photos", "invariants",
        "invariant_sha256", "gallery_sha256", "state_sha256",
    }
    if set(before) != required_state_keys:
        raise CofferHelperError("Operation preimage shape недопустим")
    state_without_hash = {key: value for key, value in before.items() if key != "state_sha256"}
    if evidence_sha256(state_without_hash) != before.get("state_sha256"):
        raise CofferHelperError("Operation preimage state SHA-256 не согласован")
    invariants = before.get("invariants")
    if (
        before.get("element_id") != ELEMENT_ID
        or before.get("code") != ELEMENT_CODE
        or not isinstance(invariants, dict)
        or evidence_sha256(invariants) != before.get("invariant_sha256")
    ):
        raise CofferHelperError("Operation preimage invariants не согласованы")

    def validate_file_snapshot(value: object, *, expected_id: int | None = None) -> dict[str, object]:
        if not isinstance(value, dict) or set(value) != {
            "id", "relative_path", "sha256", "bytes", "width", "height", "mime"
        }:
            raise CofferHelperError("Operation file snapshot shape недопустим")
        file_id = value.get("id")
        relative = value.get("relative_path")
        if (
            type(file_id) is not int
            or file_id <= 0
            or (expected_id is not None and file_id != expected_id)
            or not isinstance(relative, str)
            or not relative.startswith("/upload/")
            or ".." in relative
            or re.fullmatch(r"[a-f0-9]{64}", str(value.get("sha256", ""))) is None
            or type(value.get("bytes")) is not int
            or not 1 <= value["bytes"] <= MAX_IMAGE_BYTES
            or type(value.get("width")) is not int
            or type(value.get("height")) is not int
            or not 1 <= value["width"] <= 20_000
            or not 1 <= value["height"] <= 20_000
            or value.get("mime") != "image/jpeg"
        ):
            raise CofferHelperError("Operation file snapshot недопустим")
        return value

    detail = validate_file_snapshot(
        before.get("detail_picture"), expected_id=BASELINE_DETAIL_PICTURE_ID
    )
    photos = before.get("photos")
    if not isinstance(photos, list) or len(photos) != 8:
        raise CofferHelperError("Operation preimage должен иметь восемь PHOTOS")
    value_ids: list[int] = []
    file_ids: list[int] = []
    photo_files: list[dict[str, object]] = []
    for row in photos:
        if not isinstance(row, dict) or set(row) != {
            "property_value_id", "description", "file"
        }:
            raise CofferHelperError("Operation PHOTOS row shape недопустим")
        value_id = row.get("property_value_id")
        description = row.get("description")
        if (
            type(value_id) is not int
            or value_id <= 0
            or not isinstance(description, str)
            or len(description.encode("utf-8")) > 2_048
        ):
            raise CofferHelperError("Operation PHOTOS row недопустим")
        photo_file = validate_file_snapshot(row.get("file"))
        value_ids.append(value_id)
        file_ids.append(photo_file["id"])
        photo_files.append(photo_file)
    if len(set(value_ids)) != 8 or len(set(file_ids)) != 8:
        raise CofferHelperError("Operation PHOTOS identifiers не уникальны")
    old_gallery = [detail["sha256"], *[file["sha256"] for file in photo_files]]
    if before.get("gallery_sha256") != old_gallery:
        raise CofferHelperError("Operation preimage gallery не согласована")

    expected_gallery = [SOURCE_SHA256, *old_gallery[1:], old_gallery[0]]
    thumbnail_proof = expected.get("thumbnail_clone_proof")
    proof_is_empty = isinstance(thumbnail_proof, dict) and set(thumbnail_proof) == {
        "receipt_sha256", "sha256", "bytes", "width", "height"
    } and all(value is None for value in thumbnail_proof.values())
    if set(expected) != {
        "gallery_sha256", "invariant_sha256",
        "existing_photo_property_value_ids", "existing_photo_file_ids",
        "public_gallery_count", "old_detail_final", "thumbnail_clone_proof",
    } or {key: value for key, value in expected.items() if key != "thumbnail_clone_proof"} != {
        "gallery_sha256": expected_gallery,
        "invariant_sha256": before["invariant_sha256"],
        "existing_photo_property_value_ids": value_ids,
        "existing_photo_file_ids": file_ids,
        "public_gallery_count": 10,
        "old_detail_final": True,
    } or not (proof_is_empty or thumbnail_clone_proof_is_exact(thumbnail_proof)):
        raise CofferHelperError("Operation expected state не согласован")

    op_id = payload["operation_id"]
    if set(source) != {"path", "sha256", "bytes", "width", "height"} or source != {
        "path": f"{OPERATION_ROOT}/{op_id}/source.jpg",
        "sha256": SOURCE_SHA256,
        "bytes": SOURCE_BYTES,
        "width": SOURCE_WIDTH,
        "height": SOURCE_HEIGHT,
    }:
        raise CofferHelperError("Operation source descriptor не согласован")
    before_files = [detail, *photo_files]
    if len(backups) != 9:
        raise CofferHelperError("Operation backup count недопустим")
    for index, (descriptor, file) in enumerate(zip(backups, before_files, strict=True)):
        if not isinstance(descriptor, dict) or set(descriptor) != {
            "path", "sha256", "bytes", "width", "height"
        } or descriptor != {
            "path": f"{OPERATION_ROOT}/{op_id}/before-{index:02d}.jpg",
            "sha256": file["sha256"],
            "bytes": file["bytes"],
            "width": file["width"],
            "height": file["height"],
        }:
            raise CofferHelperError("Operation backup descriptor не согласован")


def current_git_head() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=PROJECT_ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=10,
    )
    head = result.stdout.strip()
    if re.fullmatch(r"[a-f0-9]{40}", head) is None:
        raise CofferHelperError("Git HEAD недопустим")
    return head


def require_committed_helpers() -> str:
    paths = [PHP_SCRIPT, Path(__file__).resolve(), TEST_SCRIPT, SOURCE_IMAGE]
    relative = [str(path.relative_to(PROJECT_ROOT)) for path in paths]
    result = subprocess.run(
        ["git", "status", "--porcelain", "--", *relative],
        cwd=PROJECT_ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=10,
    )
    if result.stdout.strip():
        raise CofferHelperError("Apply требует committed и чистые helper/source файлы")
    return current_git_head()


def _mkdir_exact(sftp: paramiko.SFTPClient, path: str, mode: int) -> None:
    try:
        info = sftp.lstat(path)
    except OSError:
        sftp.mkdir(path, mode=mode)
        info = sftp.lstat(path)
    if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
        raise RemoteError("Remote operation root не является каталогом")


def _write_remote_file(
    sftp: paramiko.SFTPClient,
    path: str,
    data: bytes,
    expected_sha: str,
) -> None:
    try:
        sftp.lstat(path)
    except OSError:
        pass
    else:
        raise RemoteError("Remote staging path уже существует")
    with sftp.open(path, "wb") as handle:
        for offset in range(0, len(data), 65536):
            handle.write(data[offset : offset + 65536])
        handle.flush()
    sftp.chmod(path, 0o600)
    info = sftp.lstat(path)
    if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode) or info.st_size != len(data):
        raise RemoteError("Remote staged file shape не подтверждён")
    with sftp.open(path, "rb") as handle:
        readback = handle.read(MAX_IMAGE_BYTES + 1)
    if len(readback) != len(data) or sha256_bytes(readback) != expected_sha:
        raise RemoteError("Remote staged file readback не прошёл SHA-256")


def stage_operation_files(
    client: paramiko.SSHClient,
    payload: Mapping[str, object],
    source_path: Path = SOURCE_IMAGE,
) -> dict[str, object]:
    validate_operation_payload(payload)
    source = validate_source_image(source_path)
    op_id = payload["operation_id"]
    operation_dir = f"{OPERATION_ROOT}/{op_id}"
    sftp = client.open_sftp()
    try:
        _mkdir_exact(sftp, OPERATION_ROOT, 0o700)
        try:
            sftp.lstat(operation_dir)
        except OSError:
            sftp.mkdir(operation_dir, mode=0o700)
        else:
            raise RemoteError("Operation staging уже существует; blind retry запрещён")
        operation_info = sftp.lstat(operation_dir)
        if not stat.S_ISDIR(operation_info.st_mode) or stat.S_ISLNK(operation_info.st_mode):
            raise RemoteError("Operation staging shape недопустим")
        sftp.chmod(operation_dir, 0o700)

        source_bytes = source_path.read_bytes()
        _write_remote_file(
            sftp,
            payload["source"]["path"],
            source_bytes,
            SOURCE_SHA256,
        )
        total = len(source_bytes)
        before_files = [
            payload["before"]["detail_picture"],
            *[row["file"] for row in payload["before"]["photos"]],
        ]
        for index, file in enumerate(before_files):
            relative = file.get("relative_path")
            if not isinstance(relative, str) or not relative.startswith("/upload/") or ".." in relative:
                raise RemoteError("Baseline file path вышел за /upload")
            remote_source = SITE_ROOT + relative
            info = sftp.lstat(remote_source)
            if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
                raise RemoteError("Baseline remote file не является regular file")
            if info.st_size != file.get("bytes"):
                raise RemoteError("Baseline remote file size дрейфовал")
            with sftp.open(remote_source, "rb") as handle:
                data = handle.read(MAX_IMAGE_BYTES + 1)
            if len(data) != file["bytes"] or sha256_bytes(data) != file["sha256"]:
                raise RemoteError("Baseline remote file SHA-256 дрейфовал")
            total += len(data)
            if total > MAX_STAGE_TOTAL_BYTES:
                raise RemoteError("Operation staging превысил общий лимит")
            descriptor = payload["backups"][index]
            _write_remote_file(sftp, descriptor["path"], data, descriptor["sha256"])
        return {
            "operation_dir": operation_dir,
            "source_sha256": source["sha256"],
            "backup_count": 9,
            "total_bytes": total,
            "permissions": "0700/0600",
            "verified": True,
        }
    finally:
        sftp.close()


def receipt_path(kind: str, *, operation_id_value: str | None = None) -> Path:
    suffix = f"_{operation_id_value}" if operation_id_value else ""
    return REPORT_ROOT / (
        f"ROSOMAHA_BITRIX_COFFER_IMAGE_{safe_stamp()}{suffix}_{kind.upper()}.json"
    )


def pending_path(operation_id_value: str) -> Path:
    if re.fullmatch(r"bitrix-coffer-[a-f0-9]{24}", operation_id_value) is None:
        raise CofferHelperError("Operation id недопустим")
    return REPORT_ROOT / f"ROSOMAHA_BITRIX_COFFER_IMAGE_{operation_id_value}_PENDING.json"


def write_immutable_json(path: Path, payload: Mapping[str, object]) -> Path:
    data = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"
    if not data or len(data) > MAX_RECEIPT_BYTES:
        raise CofferHelperError("Receipt size недопустим")
    path.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    fd = os.open(path, flags, 0o600)
    try:
        with os.fdopen(fd, "wb", closefd=False) as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
    finally:
        os.close(fd)
    return path


def load_pending(operation_id_value: str) -> tuple[dict[str, object], str]:
    path = pending_path(operation_id_value)
    if not path.is_file() or path.is_symlink():
        raise CofferHelperError("Immutable pending receipt не найден")
    raw = path.read_bytes()
    if not raw or len(raw) > MAX_RECEIPT_BYTES:
        raise CofferHelperError("Pending receipt size недопустим")
    try:
        receipt = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CofferHelperError("Pending receipt повреждён") from exc
    payload = receipt.get("operation_payload") if isinstance(receipt, dict) else None
    if not isinstance(payload, dict) or payload.get("operation_id") != operation_id_value:
        raise CofferHelperError("Pending receipt identity не совпала")
    validate_operation_payload(payload)
    return receipt, sha256_bytes(raw)


def base_receipt(mode: str, source: Mapping[str, object]) -> dict[str, object]:
    return {
        "schema_version": 1,
        "generated_at_utc": utc_now(),
        "mode": mode,
        "scope": {
            "domain": DOMAIN,
            "site_id": SITE_ID,
            "iblock_id": IBLOCK_ID,
            "element_id": ELEMENT_ID,
            "element_code": ELEMENT_CODE,
            "section_id": PRIMARY_SECTION_ID,
            "photos_property_id": PHOTOS_PROPERTY_ID,
            "model_ids": list(MODEL_IDS),
        },
        "input": dict(source),
        "no_apply_retry": True,
        "secrets_exported": False,
        "pii_exported": False,
    }


def verify_public_after(
    baseline: Mapping[str, object],
    after: Mapping[str, object],
    payload: Mapping[str, object],
) -> dict[str, object]:
    before_gallery = baseline["gallery"]
    after_gallery = after["gallery"]
    expected_hashes = payload["expected"]["gallery_sha256"]
    if [row["sha256"] for row in after_gallery] != expected_hashes:
        raise PublicGateError("Public gallery hashes не совпали с candidate")
    if len(after_gallery) != 10 or after_gallery[0]["sha256"] != SOURCE_SHA256:
        raise PublicGateError("Новое изображение не стало первым")
    if [row["url"] for row in after_gallery[1:9]] != [
        row["url"] for row in before_gallery[1:]
    ]:
        raise PublicGateError("Восемь существующих PHOTOS URL/order изменились")
    if after_gallery[9]["sha256"] != before_gallery[0]["sha256"]:
        raise PublicGateError("Старый DETAIL не сохранён последним")
    before_option = baseline["option"]
    after_option = after["option"]
    for key in (
        "status", "final_url", "canonical", "robots", "indexable", "title",
        "h1", "description", "og_image", "visible_text",
    ):
        if after_option.get(key) != before_option.get(key):
            raise PublicGateError(f"Option SEO field изменился: {key}")
    before_structured = before_option.get("structured_data")
    after_structured = after_option.get("structured_data")
    if (
        not isinstance(before_structured, dict)
        or not isinstance(after_structured, dict)
        or after_structured.get("document_count")
            != before_structured.get("document_count")
        or after_structured.get("product_count")
            != before_structured.get("product_count")
        or after_structured.get("masked_sha256")
            != before_structured.get("masked_sha256")
        or not isinstance(after_structured.get("product_images"), list)
        or after_structured["product_images"] != [after_gallery[0]["url"]]
    ):
        raise PublicGateError("Product JSON-LD contract изменился")
    before_thumbnail = baseline.get("first_thumbnail")
    after_thumbnail = after.get("first_thumbnail")
    thumbnail_proof = payload["expected"].get("thumbnail_clone_proof")
    if (
        not thumbnail_clone_proof_is_exact(thumbnail_proof)
        or not isinstance(before_thumbnail, dict)
        or not isinstance(after_thumbnail, dict)
        or after_thumbnail.get("url") == before_thumbnail.get("url")
        or after_thumbnail.get("sha256") == before_thumbnail.get("sha256")
        or after_thumbnail.get("sha256") != thumbnail_proof.get("sha256")
        or after_thumbnail.get("bytes") != thumbnail_proof.get("bytes")
        or after_thumbnail.get("width") != thumbnail_proof.get("width")
        or after_thumbnail.get("height") != thumbnail_proof.get("height")
        or type(after_thumbnail.get("width")) is not int
        or type(after_thumbnail.get("height")) is not int
        or after_thumbnail["height"] <= 0
        or abs(
            (after_thumbnail["width"] / after_thumbnail["height"])
            - (SOURCE_WIDTH / SOURCE_HEIGHT)
        ) > 0.02
    ):
        raise PublicGateError("Первый thumbnail не обновился вместе с DETAIL_PICTURE")
    if after["models"] != baseline["models"]:
        raise PublicGateError("Одна из трёх model pages изменила head/option contract")
    if after["sitemap"] != baseline["sitemap"]:
        raise PublicGateError("Sitemap bytes или target membership изменились")
    return {
        "verified": True,
        "gallery_count": 10,
        "new_image_first": True,
        "existing_eight_urls_and_ids_preserved": True,
        "old_detail_final": True,
        "thumbnail_changed": True,
        "thumbnail_matches_source_aspect": True,
        "seo_contract_unchanged": True,
        "models_unchanged": 3,
    }


def verify_public_rollback(
    baseline: Mapping[str, object],
    after: Mapping[str, object],
) -> dict[str, object]:
    baseline_gallery = baseline["gallery"]
    after_gallery = after["gallery"]
    if [row["sha256"] for row in after_gallery] != [
        row["sha256"] for row in baseline["gallery"]
    ]:
        raise PublicGateError("Rollback gallery content не совпал с baseline")
    if [row["url"] for row in after_gallery[1:]] != [
        row["url"] for row in baseline_gallery[1:]
    ]:
        raise PublicGateError("Rollback изменил URL восьми прежних PHOTOS")
    for key in (
        "status", "final_url", "canonical", "robots", "indexable", "title",
        "h1", "description", "og_image", "visible_text",
    ):
        if after["option"].get(key) != baseline["option"].get(key):
            raise PublicGateError(f"Rollback SEO field изменился: {key}")
    baseline_structured = baseline["option"].get("structured_data")
    after_structured = after["option"].get("structured_data")
    if (
        not isinstance(baseline_structured, dict)
        or not isinstance(after_structured, dict)
        or after_structured.get("document_count")
            != baseline_structured.get("document_count")
        or after_structured.get("product_count")
            != baseline_structured.get("product_count")
        or after_structured.get("masked_sha256")
            != baseline_structured.get("masked_sha256")
        or not isinstance(after_structured.get("product_images"), list)
        or after_structured["product_images"] != [after_gallery[0]["url"]]
    ):
        raise PublicGateError("Rollback Product JSON-LD contract изменился")
    baseline_thumbnail = baseline.get("first_thumbnail")
    after_thumbnail = after.get("first_thumbnail")
    if (
        not isinstance(baseline_thumbnail, dict)
        or not isinstance(after_thumbnail, dict)
        or after_thumbnail.get("sha256") != baseline_thumbnail.get("sha256")
    ):
        raise PublicGateError("Rollback thumbnail content не восстановлен")
    if after["models"] != baseline["models"] or after["sitemap"] != baseline["sitemap"]:
        raise PublicGateError("Rollback нарушил model/sitemap contract")
    urls_exact = [row["url"] for row in after_gallery] == [
        row["url"] for row in baseline_gallery
    ]
    return {
        "verified": False,
        "functional_gallery_restored": True,
        "identifier_restoration": False,
        "exact_restoration": False,
        "detail_url_restored": urls_exact,
        "seo_contract_unchanged": urls_exact,
        "seo_contract_status": "exact" if urls_exact else "unknown_due_detail_url_change",
    }


def verify_public_baseline_exact(
    baseline: Mapping[str, object],
    after: Mapping[str, object],
) -> dict[str, object]:
    baseline_copy = json.loads(json.dumps(baseline, ensure_ascii=False))
    after_copy = json.loads(json.dumps(after, ensure_ascii=False))
    baseline_copy.pop("generated_at_utc", None)
    after_copy.pop("generated_at_utc", None)
    if after_copy != baseline_copy:
        raise PublicGateError("Public baseline exact state не восстановлен")
    return {
        "verified": True,
        "exact_baseline_restored": True,
        "seo_contract_unchanged": True,
    }


def run_audit() -> tuple[dict[str, object], Path]:
    source = validate_source_image()
    remote = execute_remote("audit")
    state = validate_remote_audit(remote)
    public = validate_public_baseline(public_audit())
    validate_database_public_parity(state, public)
    receipt = base_receipt("audit", source)
    receipt.update(
        {
            "status": "ok",
            "read_only": True,
            "database_mutations": 0,
            "remote": remote,
            "public": public,
            "ready_for_dry_run": True,
            "ready_for_apply": False,
            "apply_blocker": "photos_append_clone_proof_missing",
            "state_sha256": state["state_sha256"],
        }
    )
    path = write_immutable_json(receipt_path("audit"), receipt)
    return receipt, path


def run_dry_run() -> tuple[dict[str, object], Path]:
    source = validate_source_image()
    remote = execute_remote("audit")
    before = validate_remote_audit(remote)
    public = validate_public_baseline(public_audit())
    validate_database_public_parity(before, public)
    payload = build_operation_payload(before, source)
    validate_operation_payload(payload)
    receipt = base_receipt("dry_run", source)
    receipt.update(
        {
            "status": "blocked",
            "read_only": True,
            "database_mutations": 0,
            "operation_id": payload["operation_id"],
            "remote_before": remote,
            "public_before": public,
            "operation_payload_sha256": evidence_sha256(payload),
            "expected": payload["expected"],
            "diff": {
                "detail_picture": "replace_with_tracked_source",
                "existing_photos": "preserve_same_8_property_value_and_file_ids",
                "old_detail": "append_as_new_final_photo",
                "gallery_count": "9 -> 10",
                "other_fields_or_relations": 0,
            },
            "ready_for_apply": False,
            "apply_blocker": "photos_append_clone_proof_missing",
        }
    )
    path = write_immutable_json(
        receipt_path("dry_run", operation_id_value=payload["operation_id"]),
        receipt,
    )
    return receipt, path


def run_apply() -> tuple[dict[str, object], Path]:
    source = validate_source_image()
    require_photos_append_clone_proof()
    git_head = require_committed_helpers()
    remote_before = execute_remote("audit")
    before = validate_remote_audit(remote_before)
    public_before = validate_public_baseline(public_audit())
    validate_database_public_parity(before, public_before)
    payload = build_operation_payload(before, source)
    validate_operation_payload(payload)
    op_id = payload["operation_id"]
    pending = base_receipt("apply_pending", source)
    pending.update(
        {
            "status": "pending",
            "operation_id": op_id,
            "git_head": git_head,
            "helper_sha256": {
                "python": sha256_bytes(Path(__file__).read_bytes()),
                "php": validate_php_source(PHP_SCRIPT.read_bytes()),
                "tests": sha256_bytes(TEST_SCRIPT.read_bytes()),
            },
            "remote_before": remote_before,
            "public_before": public_before,
            "operation_payload": payload,
            "database_mutations": 0,
        }
    )
    pending_file = write_immutable_json(pending_path(op_id), pending)
    client = connect()
    dispatched = False
    try:
        staging = stage_operation_files(client, payload)
        dispatched = True
        remote_after = execute_remote("apply", payload, client=client)
    except Exception as exc:
        receipt = base_receipt("apply", source)
        receipt.update(
            {
                "status": "indeterminate" if dispatched else "blocked_before_dispatch",
                "operation_id": op_id,
                "pending_receipt": str(pending_file),
                "apply_dispatched_once": dispatched,
                "automatic_retry": False,
                "database_mutations": "unknown" if dispatched else 0,
                "error": safe_error(exc),
                "next_action": f"python scripts/bitrix-coffer-image.py --recover {op_id}",
            }
        )
        path = write_immutable_json(
            receipt_path("dispatch_unknown" if dispatched else "apply_blocked", operation_id_value=op_id),
            receipt,
        )
        if dispatched:
            raise AmbiguousApplyError(
                f"Apply dispatch неопределён; blind retry запрещён. Receipt: {path}"
            ) from exc
        raise
    finally:
        client.close()
    try:
        remote_state = validate_remote_operation_state(remote_after, payload)
        remote_state_error = None
    except Exception as exc:
        remote_state = None
        remote_state_error = safe_error(exc)
    if (
        remote_state is None
        or remote_after.get("status") != "ok"
        or remote_after.get("classification") != "applied_exact"
        or remote_after.get("verified") is not True
    ):
        verification: dict[str, object] = {
            "verified": False,
            "reason": "remote_apply_not_exact",
            "error": remote_state_error,
        }
        public_after = None
        status = "indeterminate"
    else:
        try:
            public_after = public_audit()
            validate_database_public_parity(remote_state, public_after)
            verification = verify_public_after(public_before, public_after, payload)
            status = "applied"
        except Exception as exc:
            public_after = None
            verification = {
                "verified": False,
                "reason": "public_verification_failed",
                "error": safe_error(exc),
            }
            status = "indeterminate"
    receipt = base_receipt("apply", source)
    receipt.update(
        {
            "status": status,
            "operation_id": op_id,
            "pending_receipt": str(pending_file),
            "apply_dispatched_once": True,
            "automatic_retry": False,
            "staging": staging,
            "remote_after": remote_after,
            "public_after": public_after,
            "verification": verification,
            "database_mutations": remote_after.get("database_mutations"),
        }
    )
    path = write_immutable_json(receipt_path("apply", operation_id_value=op_id), receipt)
    return receipt, path


def run_existing(mode: str, op_id: str) -> tuple[dict[str, object], Path]:
    if mode not in {"recover", "rollback"}:
        raise ValueError("Existing operation mode недопустим")
    pending, pending_sha = load_pending(op_id)
    payload = pending["operation_payload"]
    source = pending["input"]
    if mode == "rollback":
        require_committed_helpers()
    try:
        remote = execute_remote(mode, payload)
    except Exception as exc:
        receipt = base_receipt(mode, source)
        receipt.update(
            {
                "status": "indeterminate" if mode == "rollback" else "blocked",
                "operation_id": op_id,
                "pending_receipt_sha256": pending_sha,
                "verification": {
                    "verified": False,
                    "reason": "remote_dispatch_failed",
                    "error": safe_error(exc),
                },
                "database_mutations": "unknown" if mode == "rollback" else 0,
                "write_dispatches": 1 if mode == "rollback" else 0,
                "automatic_retry": False,
                "next_action": (
                    f"python scripts/bitrix-coffer-image.py --recover {op_id}"
                    if mode == "rollback"
                    else "repeat read-only recover after connectivity is restored"
                ),
            }
        )
        path = write_immutable_json(
            receipt_path(f"{mode}_dispatch_unknown", operation_id_value=op_id),
            receipt,
        )
        return receipt, path
    try:
        remote_state = validate_remote_operation_state(remote, payload)
        remote_state_error = None
    except Exception as exc:
        remote_state = None
        remote_state_error = safe_error(exc)
    try:
        public_after = public_audit()
        public_error = None
    except Exception as exc:
        public_after = None
        public_error = safe_error(exc)
    verification: dict[str, object]
    classification = remote.get("classification")
    if remote_state_error is not None:
        verification = {
            "verified": False,
            "reason": "remote_state_invalid",
            "error": remote_state_error,
            "classification": classification,
            "read_only": mode == "recover",
        }
        receipt_status = "indeterminate" if mode == "rollback" else "blocked"
    elif remote.get("status") == "error":
        verification = {
            "verified": False,
            "reason": "remote_operation_failed",
            "classification": classification,
            "read_only": mode == "recover",
        }
        receipt_status = "indeterminate" if mode == "rollback" else "blocked"
    elif public_error is not None:
        verification = {
            "verified": False,
            "reason": "public_verification_failed",
            "error": public_error,
            "classification": classification,
            "read_only": mode == "recover",
        }
        receipt_status = "indeterminate" if mode == "rollback" else "blocked"
    else:
        try:
            if classification == "baseline_exact":
                validate_database_public_parity(remote_state, public_after)
                verification = verify_public_baseline_exact(
                    pending["public_before"], public_after
                )
                if mode == "rollback" and remote.get("status") == "blocked":
                    verification["rollback_performed"] = False
                    verification["reason"] = "already_at_exact_baseline"
                    receipt_status = "blocked"
                else:
                    receipt_status = "ok"
            elif classification == "applied_exact" and mode == "recover":
                validate_database_public_parity(remote_state, public_after)
                verification = verify_public_after(
                    pending["public_before"], public_after, payload
                )
                receipt_status = "ok"
            elif classification == "rolled_back_semantic":
                validate_database_public_parity(remote_state, public_after)
                verification = verify_public_rollback(
                    pending["public_before"], public_after
                )
                receipt_status = "semantic_only"
            else:
                verification = {
                    "verified": False,
                    "reason": "state_not_recoverable_exactly",
                    "classification": classification,
                }
                receipt_status = (
                    "indeterminate" if mode == "rollback" else "blocked"
                )
        except Exception as exc:
            verification = {
                "verified": False,
                "reason": "public_verification_failed",
                "error": safe_error(exc),
                "classification": classification,
            }
            receipt_status = "indeterminate" if mode == "rollback" else "blocked"
    receipt = base_receipt(mode, source)
    receipt.update(
        {
            "status": receipt_status,
            "operation_id": op_id,
            "pending_receipt_sha256": pending_sha,
            "remote": remote,
            "public": public_after,
            "verification": verification,
            "database_mutations": remote.get("database_mutations"),
            "write_dispatches": 1 if mode == "rollback" else 0,
            "automatic_retry": False,
        }
    )
    path = write_immutable_json(receipt_path(mode, operation_id_value=op_id), receipt)
    return receipt, path


def safe_error(error: BaseException) -> str:
    text = str(error) or type(error).__name__
    for sensitive in (EXPECTED_LOGIN, SITE_ROOT, OPERATION_ROOT, str(ENV_PATH)):
        text = text.replace(sensitive, "[pinned]")
    text = re.sub(
        r"(?i)(password|token|secret)\s*[=:]\s*\S+",
        r"\1=[redacted]",
        text,
    )
    return f"{type(error).__name__}: {text}"[:MAX_ERROR_TEXT]


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fixed Bitrix element-952 coffer image operator"
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--audit", action="store_true")
    group.add_argument("--dry-run", action="store_true")
    group.add_argument("--apply", action="store_true")
    group.add_argument("--recover", metavar="OPERATION_ID")
    group.add_argument("--rollback", metavar="OPERATION_ID")
    return parser.parse_args(list(sys.argv[1:] if argv is None else argv))


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.dry_run:
            receipt, path = run_dry_run()
        elif args.apply:
            receipt, path = run_apply()
        elif args.recover:
            receipt, path = run_existing("recover", args.recover)
        elif args.rollback:
            receipt, path = run_existing("rollback", args.rollback)
        else:
            receipt, path = run_audit()
        print(
            json.dumps(
                {
                    "status": receipt.get("status"),
                    "mode": receipt.get("mode"),
                    "operation_id": receipt.get("operation_id"),
                    "receipt": str(path),
                    "database_mutations": receipt.get("database_mutations"),
                },
                ensure_ascii=False,
            )
        )
        return 0 if receipt.get("status") in {"ok", "ready", "applied"} else 1
    except Exception as exc:
        print(f"Ошибка Bitrix coffer-image helper: {safe_error(exc)}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
