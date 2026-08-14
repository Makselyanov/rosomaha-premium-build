#!/usr/bin/env python3
"""Read-only phase-1 audit for a future Bitrix fan-button option.

The helper is deliberately incapable of applying or recovering changes.  It
streams the pinned PHP reader to the pinned Beget account, validates the
returned schema, and writes one immutable, ignored JSON receipt.
"""

from __future__ import annotations

import argparse
import base64
import html as html_module
import hashlib
import json
import logging
import os
import re
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Callable, Mapping, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

import paramiko


logging.getLogger("paramiko").setLevel(logging.CRITICAL)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = PROJECT_ROOT / ".env"
PHP_SCRIPT = PROJECT_ROOT / "scripts" / "bitrix-fan-button-option.php"
REPORT_ROOT = PROJECT_ROOT / "marketing-audits" / "bitrix"

HOST = "ocelot.beget.com"
PORT = 22
EXPECTED_LOGIN = "berkutm4"
EXPECTED_HOST_KEY_SHA256 = "9NXXK7D+NukzmR6c/Ov2rAZElXlr2s1oP0QAAmUWs+c"
SITE_ROOT = "/home/b/berkutm4/rosomaha-rus.ru/public_html"
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
ANCHOR_ID = 877
ANCHOR_CODE = "dop-okhlazhdenie-gur"
COMPARATOR_ID = 997
COMPARATOR_ROLE = "bagira"
TARGET_NAME = "Дополнительная кнопка включения вентилятора"
TARGET_CODE = "dopolnitelnaya-knopka-vklyucheniya-ventilyatora"
TARGET_PRICE = 7_000
LINK_GOODS_PROPERTY_ID = 1219
OPTIONS_SECTION_ID = 302
TARGET_SORT = 506
TEMPLATE_PEER_IDS = (876, 877, 856, 1099)

# Canonical twelve-technique scope from src/data/products.ts:classicVariants.
# The trailer is intentionally not present.
MODEL_CODES = (
    "snegobolotokhod-rosomakha-model-pro-4kh4-s-dvs-1zz-fe-1-8-litra-mosty-toyota",
    "rosomakha-model-eger-1-dvs-30-l-s-s-mostami-volga-",
    "standart-plus-1-5-litra",
    "rosomakha-standart-plyus-uaz-timken",
    "extrime-s-1-5l-dvs-1nz-fe",
    "extrime-1-5-litra-mosty-toyota",
    "extrime-plus-s-1-8l-dvs-1zz-fe",
    "hunter-s-1-5l-dvs-1nz-fe",
    "snegobolotokhod-rosomakha-komplektatsiya-pikap-s-dvs-1nz-fe-1-5-litra-s-mostami-uaz-timken",
    "snegobolotokhod-rosomakha-pikap-dvs-1-8-litra-uaz",
    "snegobolotokhod-rosomakha-komplektatsiya-pikap-s-dvs-1zz-fe-1-8-litra-s-mostami-toyota",
    "snegobolotokhod-rosomakha-komplektatsiya-shestikolyesnik-s-dvs-1zz-fe-1-8-litra-s-mostami-toyota",
)

EXPECTED_LINKED_OPTION_IDS = (
    841, 842, 843, 844, 847, 848, 849, 850, 851, 852, 853, 854, 855, 856,
    859, 860, 862, 865, 867, 868, 869, 870, 871, 872, 873, 874, 875, 876,
    877, 878, 882, 883, 886, 887, 893, 894, 895, 937, 938, 951, 952, 961,
    962, 975, 976, 977, 992, 998, 999, 1072, 1073, 1084, 1091, 1093, 1095,
    1096, 1097, 1098, 1099, 1112, 1113, 1114,
)

PUBLIC_ORIGIN = "https://rosomaha-rus.ru"
PUBLIC_MODEL_URLS = tuple(f"{PUBLIC_ORIGIN}/product/{code}/" for code in MODEL_CODES)
PUBLIC_USER_AGENT = "RosomahaFanOptionPhase1bAudit/1.0"
MAX_PUBLIC_BODY_BYTES = 2_000_000
MAX_PUBLIC_WORKERS = 4
MAX_PUBLIC_OPTION_OCCURRENCES = 256
MAX_PUBLIC_IMAGES = 256
MAX_PUBLIC_HTML_NODES = 50_000
MAX_PUBLIC_HTML_DEPTH = 128
MAX_PUBLIC_ATTRIBUTE_BYTES = 2_048
MAX_PUBLIC_TITLE_BYTES = 2_048
MAX_PUBLIC_PARSE_ERRORS = 32
MAX_RECEIPT_BYTES = 12_000_000

MAX_PHP_BYTES = 256_000
# The ASCII base64 frame can be 4/3 the bounded JSON size, plus six markers.
MAX_STDOUT_BYTES = 10_500_000
MAX_STDERR_BYTES = 32_000
MAX_REMOTE_SECONDS = 150
MAX_JSON_BYTES = 7_500_000
MAX_PROPERTIES = 192
MAX_ENUMS_PER_PROPERTY = 128
MAX_PROPERTY_VALUES = 128
MAX_SECTION_SIBLINGS = 256
MAX_LINKED_OPTIONS = 96

FORBIDDEN_MODE_PREFIXES = ("--apply", "--recover", "--rollback")
FORBIDDEN_PHP_PATTERNS = (
    r"CIBlockElement\s*::\s*(?:Add|Update|Delete|SetPropertyValues(?:Ex)?)\s*\(",
    r"->\s*(?:Add|Update|Delete|SetPropertyValues(?:Ex)?)\s*\(",
    r"\b(?:file_put_contents|fopen|fwrite|mkdir|rename|copy|unlink|chmod)\s*\(",
    r"\beval\s*\(",
    r"\b(?:exec|system|shell_exec|passthru|proc_open|popen)\s*\(",
    r"\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|TRUNCATE)\s+(?:INTO|TABLE|FROM|[A-Za-z_])",
)


class CredentialError(RuntimeError):
    """Credential source is absent, ambiguous, or outside the pinned account."""


class RemoteAuditError(RuntimeError):
    """The bounded remote read-only audit did not produce trusted evidence."""


class ForbiddenModeError(ValueError):
    """A caller attempted to select a mutation-oriented mode."""


class PinnedHostKeyPolicy(paramiko.MissingHostKeyPolicy):
    def missing_host_key(
        self,
        client: paramiko.SSHClient,
        hostname: str,
        key: paramiko.PKey,
    ) -> None:
        if hostname != HOST:
            raise paramiko.SSHException("Unexpected SSH host")
        fingerprint = base64.b64encode(
            hashlib.sha256(key.asbytes()).digest()
        ).decode("ascii").rstrip("=")
        if fingerprint != EXPECTED_HOST_KEY_SHA256:
            raise paramiko.SSHException("Beget SSH host key mismatch")
        client.get_host_keys().add(hostname, key.get_name(), key)


def _parse_env_value(raw: str) -> str:
    value = raw.strip()
    if not value:
        raise CredentialError("Pinned credential value is empty")
    if value[0] in {'"', "'"}:
        if len(value) < 2 or value[-1] != value[0]:
            raise CredentialError("Pinned credential quoting is malformed")
        value = value[1:-1]
    elif value[-1:] in {'"', "'"}:
        raise CredentialError("Pinned credential quoting is malformed")
    if not value or "\r" in value or "\n" in value:
        raise CredentialError("Pinned credential value is invalid")
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
            raise CredentialError("Pinned credential source is ambiguous")
        return (
            _parse_env_value(matches["BEGET_LOGIN"][0]),
            _parse_env_value(matches["BEGET_PASSWORD"][0]),
        )
    if len(legacy) != 1:
        raise CredentialError("Pinned credentials were not found exactly once")
    return _parse_env_value(legacy[0][0]), _parse_env_value(legacy[0][1])


def load_credentials(
    *,
    environ: Mapping[str, str] | None = None,
    env_path: Path = ENV_PATH,
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
        login, password = _credentials_from_text(
            env_path.read_text(encoding="utf-8-sig")
        )
    if login != EXPECTED_LOGIN:
        raise CredentialError("Unexpected Beget account; connection refused")
    return login, password


def connect(
    *,
    environ: Mapping[str, str] | None = None,
    env_path: Path = ENV_PATH,
) -> paramiko.SSHClient:
    # Parse and validate before constructing a network client.
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
            raise RemoteAuditError("SSH transport is unavailable")
        peer_key = transport.get_remote_server_key()
        fingerprint = base64.b64encode(
            hashlib.sha256(peer_key.asbytes()).digest()
        ).decode("ascii").rstrip("=")
        if fingerprint != EXPECTED_HOST_KEY_SHA256:
            raise RemoteAuditError("Beget SSH host key mismatch")
        return client
    except Exception:
        client.close()
        raise


def validate_php_source(script_bytes: bytes) -> str:
    if not script_bytes or len(script_bytes) > MAX_PHP_BYTES:
        raise RuntimeError("Pinned PHP reader size is invalid")
    try:
        source = script_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise RuntimeError("Pinned PHP reader is not UTF-8") from exc
    if not source.startswith("<?php"):
        raise RuntimeError("Pinned PHP reader header is invalid")
    for pattern in FORBIDDEN_PHP_PATTERNS:
        if re.search(pattern, source, flags=re.IGNORECASE):
            raise RuntimeError("Pinned PHP reader contains a forbidden operation")
    required = (
        "ROSOMAHA_FAN_IBLOCK_ID = 86",
        "ROSOMAHA_FAN_ANCHOR_ID = 877",
        "ROSOMAHA_FAN_COMPARATOR_ID = 997",
        TARGET_NAME,
        TARGET_CODE,
        "'price' => 7000",
        "'mode' => 'audit'",
        "'database_mutations' => 0",
        "__ROSOMAHA_FAN_JSON_BYTES__=",
        "__ROSOMAHA_FAN_JSON_SHA256__=",
        "__ROSOMAHA_FAN_JSON_BASE64__=",
    )
    if any(item not in source for item in required):
        raise RuntimeError("Pinned PHP reader identity contract is incomplete")
    return hashlib.sha256(script_bytes).hexdigest()


def build_remote_command(script_bytes: bytes) -> tuple[str, str]:
    digest = validate_php_source(script_bytes)
    if not PHP_CANDIDATES or any(not item.startswith("/") for item in PHP_CANDIDATES):
        raise RuntimeError("Pinned PHP candidates must be absolute paths")
    encoded = base64.b64encode(script_bytes).decode("ascii")
    candidates = " ".join(f"'{item}'" for item in PHP_CANDIDATES)
    command = f"""
set -eu
script_payload='{encoded}'
decoded_with_marker="$(
  printf '%s' "$script_payload" | /usr/bin/base64 -d
  printf '__ROSOMAHA_FAN_PAYLOAD_END__'
)"
case "$decoded_with_marker" in
  *__ROSOMAHA_FAN_PAYLOAD_END__) ;;
  *) printf 'Decoded helper marker is missing\n' >&2; exit 43 ;;
esac
decoded_script="${{decoded_with_marker%__ROSOMAHA_FAN_PAYLOAD_END__}}"
decoded_sha256="$(printf '%s' "$decoded_script" | /usr/bin/sha256sum | /usr/bin/awk '{{print $1}}')"
test "$decoded_sha256" = '{digest}'
test "$(/usr/bin/realpath -- '{SITE_ROOT}')" = '{SITE_ROOT}'
test -f '{SITE_ROOT}/bitrix/modules/main/include/prolog_before.php'
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
  printf 'Pinned PHP series was not found\n' >&2
  exit 42
fi
printf '%s' "$decoded_script" | /usr/bin/timeout 15s "$php_binary" -l >/dev/null
printf '__ROSOMAHA_FAN_PHP_VERSION__=%s\n' "$php_version"
printf '__ROSOMAHA_FAN_PHP_SHA256__=%s\n' "$decoded_sha256"
printf '__ROSOMAHA_FAN_PHP_LINT__=ok\n'
printf '%s' "$decoded_script" | /usr/bin/timeout 120s "$php_binary" \
  -d display_errors=stderr -d log_errors=0 -- 'audit'
"""
    return command, digest


def run_remote_command(
    client: paramiko.SSHClient,
    command: str,
    *,
    timeout_seconds: int = MAX_REMOTE_SECONDS,
) -> tuple[int, str, str]:
    output = bytearray()
    error = bytearray()
    try:
        _, stdout, _ = client.exec_command(command, timeout=20)
        channel = stdout.channel
        deadline = time.monotonic() + timeout_seconds
        while True:
            progress = False
            while channel.recv_ready():
                if time.monotonic() >= deadline:
                    channel.close()
                    raise RemoteAuditError(
                        "Remote read-only audit timed out before full EOF"
                    )
                chunk = channel.recv(65536)
                if not chunk:
                    break
                output.extend(chunk)
                progress = True
                if len(output) > MAX_STDOUT_BYTES:
                    channel.close()
                    raise RemoteAuditError("Remote stdout exceeded the fixed limit")
            while channel.recv_stderr_ready():
                if time.monotonic() >= deadline:
                    channel.close()
                    raise RemoteAuditError(
                        "Remote read-only audit timed out before full EOF"
                    )
                chunk = channel.recv_stderr(16384)
                if not chunk:
                    break
                error.extend(chunk)
                progress = True
                if len(error) > MAX_STDERR_BYTES:
                    channel.close()
                    raise RemoteAuditError("Remote stderr exceeded the fixed limit")
            exit_ready = channel.exit_status_ready()
            eof_or_closed = bool(
                getattr(channel, "eof_received", False)
                or getattr(channel, "closed", False)
            )
            if (
                exit_ready
                and eof_or_closed
                and not channel.recv_ready()
                and not channel.recv_stderr_ready()
            ):
                status = channel.recv_exit_status()
                channel.close()
                return (
                    status,
                    output.decode("utf-8", errors="strict"),
                    error.decode("utf-8", errors="replace"),
                )
            if time.monotonic() >= deadline:
                channel.close()
                raise RemoteAuditError("Remote read-only audit timed out before full EOF")
            if not progress:
                time.sleep(0.01)
    except RemoteAuditError:
        raise
    except Exception as exc:
        raise RemoteAuditError(
            f"Remote transport failed ({type(exc).__name__})"
        ) from exc


def _require_dict(value: object, label: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise RemoteAuditError(f"Remote {label} must be an object")
    return value


def _require_list(value: object, label: str, maximum: int) -> list[object]:
    if not isinstance(value, list) or len(value) > maximum:
        raise RemoteAuditError(f"Remote {label} list is invalid")
    return value


def _validate_normalized_value(value: object, label: str, depth: int = 0) -> None:
    if depth > 4:
        raise RemoteAuditError(f"Remote {label} value nesting is invalid")
    if value is None or isinstance(value, (bool, int, float)):
        return
    if isinstance(value, str):
        if len(value.encode("utf-8")) > 512:
            raise RemoteAuditError(f"Remote {label} string was not normalized")
        return
    if isinstance(value, list):
        if len(value) > 32:
            raise RemoteAuditError(f"Remote {label} array exceeded the fixed limit")
        for item in value:
            _validate_normalized_value(item, label, depth + 1)
        return
    if isinstance(value, dict):
        if "kind" in value:
            if (
                set(value) != {"kind", "bytes", "sha256"}
                or value.get("kind") not in {"string_digest", "binary_digest"}
                or not isinstance(value.get("bytes"), int)
                or not isinstance(value.get("sha256"), str)
                or re.fullmatch(r"[a-f0-9]{64}", str(value.get("sha256"))) is None
            ):
                raise RemoteAuditError(f"Remote {label} digest is invalid")
            return
        if len(value) > 32 or any(not isinstance(key, str) for key in value):
            raise RemoteAuditError(f"Remote {label} object exceeded the fixed limit")
        for item in value.values():
            _validate_normalized_value(item, label, depth + 1)
        return
    raise RemoteAuditError(f"Remote {label} value type is invalid")


def _validate_element_properties(
    element: dict[str, object], definitions_by_id: dict[int, dict[str, object]], label: str
) -> None:
    properties = _require_list(element.get("properties"), f"{label} properties", MAX_PROPERTIES)
    seen: set[int] = set()
    for item in properties:
        prop = _require_dict(item, f"{label} property")
        prop_id = prop.get("id")
        if not isinstance(prop_id, int) or prop_id not in definitions_by_id or prop_id in seen:
            raise RemoteAuditError(f"Remote {label} property identity is invalid")
        seen.add(prop_id)
        definition = definitions_by_id[prop_id]
        expected_shape = {
            "id": prop_id,
            "code": definition.get("code"),
            "type": definition.get("type"),
            "multiple": definition.get("multiple"),
            "link_iblock_id": definition.get("link_iblock_id"),
        }
        if any(prop.get(key) != value for key, value in expected_shape.items()):
            raise RemoteAuditError(f"Remote {label} property schema drifted")
        values = _require_list(
            prop.get("values"), f"{label} property values", MAX_PROPERTY_VALUES
        )
        for value_item in values:
            entry = _require_dict(value_item, f"{label} property value")
            if set(entry) != {"value", "enum_value", "enum_xml_id", "description"}:
                raise RemoteAuditError(f"Remote {label} property value shape is invalid")
            for normalized in entry.values():
                _validate_normalized_value(normalized, f"{label} property")
    if seen != set(definitions_by_id):
        raise RemoteAuditError(f"Remote {label} does not contain the full property schema")


def _evidence_sha256(value: object) -> str:
    return hashlib.sha256(
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()


def _ordered_link_goods_ids(model: dict[str, object]) -> list[int]:
    properties = _require_list(model.get("properties"), "model properties", MAX_PROPERTIES)
    matches = [
        _require_dict(item, "LINK_GOODS property")
        for item in properties
        if isinstance(item, dict) and item.get("id") == LINK_GOODS_PROPERTY_ID
    ]
    if len(matches) != 1:
        raise RemoteAuditError("Remote model LINK_GOODS property is not unique")
    prop = matches[0]
    if (
        prop.get("code") != "LINK_GOODS"
        or prop.get("type") != "E"
        or prop.get("multiple") is not True
        or prop.get("link_iblock_id") != IBLOCK_ID
    ):
        raise RemoteAuditError("Remote LINK_GOODS property shape drifted")
    values = _require_list(prop.get("values"), "LINK_GOODS values", MAX_PROPERTY_VALUES)
    ids: list[int] = []
    for item in values:
        entry = _require_dict(item, "LINK_GOODS value")
        raw = entry.get("value")
        if isinstance(raw, int) and not isinstance(raw, bool) and raw > 0:
            value = raw
        elif isinstance(raw, str) and re.fullmatch(r"[1-9][0-9]*", raw):
            value = int(raw)
        else:
            raise RemoteAuditError("Remote LINK_GOODS contains a non-id value")
        ids.append(value)
    if len(ids) != len(set(ids)):
        raise RemoteAuditError("Remote LINK_GOODS contains duplicate ids")
    return ids


def _filter_price_contract(
    values_value: object,
    *,
    active: bool,
) -> dict[str, object]:
    values = _require_list(values_value, "FILTER_PRICE values", MAX_PROPERTY_VALUES)
    numeric_values: list[int | float] = []
    for item in values:
        entry = _require_dict(item, "FILTER_PRICE value")
        value = entry.get("value")
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            numeric_values.append(value)
        elif isinstance(value, str) and re.fullmatch(r"-?[0-9]+(?:\.[0-9]+)?", value):
            numeric_values.append(float(value))
    positive = (
        numeric_values[0]
        if len(values) == 1 and len(numeric_values) == 1 and numeric_values[0] > 0
        else None
    )
    return {
        "rule": "active_and_exactly_one_positive_filter_price",
        "property_value_count": len(values),
        "numeric_value_count": len(numeric_values),
        "positive_filter_price": positive,
        "eligible": active and positive is not None,
    }


def _validate_phase1b_evidence(
    remote: dict[str, object],
    definitions_by_id: dict[int, dict[str, object]],
    models: list[object],
) -> None:
    phase = _require_dict(remote.get("phase1b_evidence"), "phase1b evidence")
    if phase.get("database_mutations") != 0:
        raise RemoteAuditError("Remote phase1b evidence violated read-only mode")

    model_links = _require_list(
        phase.get("model_link_goods"), "model LINK_GOODS evidence", len(MODEL_CODES)
    )
    if len(model_links) != len(MODEL_CODES):
        raise RemoteAuditError("Remote model LINK_GOODS evidence is incomplete")
    expected_union: set[int] = set()
    gur_model_count = 0
    model_ids_by_code: dict[str, int] = {}
    model_ordered_ids: dict[str, list[int]] = {}
    for index, (model_item, evidence_item) in enumerate(zip(models, model_links)):
        model = _require_dict(model_item, f"phase1b model {index}")
        evidence = _require_dict(evidence_item, f"model LINK_GOODS {index}")
        ids = _ordered_link_goods_ids(model)
        if (
            evidence.get("model_id") != model.get("id")
            or evidence.get("model_code") != model.get("code")
            or evidence.get("ordered_ids") != ids
            or evidence.get("ordered_ids_sha256") != _evidence_sha256(ids)
            or evidence.get("count") != len(ids)
        ):
            raise RemoteAuditError("Remote ordered LINK_GOODS evidence is inconsistent")
        positions = [position for position, value in enumerate(ids) if value == ANCHOR_ID]
        if evidence.get("gur_positions_zero_based") != positions:
            raise RemoteAuditError("Remote GUR position evidence is inconsistent")
        if len(positions) == 1:
            gur_model_count += 1
        elif positions:
            raise RemoteAuditError("Remote GUR option is duplicated in LINK_GOODS")
        expected_union.update(ids)
        code = str(model.get("code"))
        model_ids_by_code[code] = int(model.get("id"))
        model_ordered_ids[code] = ids

    union_ids = sorted(expected_union)
    union = _require_dict(phase.get("linked_option_union"), "linked option union")
    if (
        len(union_ids) > MAX_LINKED_OPTIONS
        or union.get("ids") != union_ids
        or union.get("count") != len(union_ids)
        or union.get("sha256") != _evidence_sha256(union_ids)
        or union.get("expected_ids_from_pinned_audit") != list(EXPECTED_LINKED_OPTION_IDS)
        or union.get("matches_pinned_audit") is not (tuple(union_ids) == EXPECTED_LINKED_OPTION_IDS)
    ):
        raise RemoteAuditError("Remote linked option union is inconsistent")
    if phase.get("gur_model_count") != gur_model_count:
        raise RemoteAuditError("Remote GUR coverage evidence is inconsistent")

    linked_options = _require_list(
        phase.get("linked_options"), "linked options", MAX_LINKED_OPTIONS
    )
    if len(linked_options) != len(union_ids):
        raise RemoteAuditError("Remote linked option evidence is incomplete")
    linked_by_id: dict[int, dict[str, object]] = {}
    for expected_id, item in zip(union_ids, linked_options):
        linked = _require_dict(item, "linked option")
        linked_id = linked.get("id")
        if linked_id != expected_id or not isinstance(linked.get("code"), str):
            raise RemoteAuditError("Remote linked option order/identity is invalid")
        fields = _require_dict(linked.get("fields"), "linked option fields")
        if not isinstance(fields.get("sort"), int) or not isinstance(fields.get("active"), bool):
            raise RemoteAuditError("Remote linked option field shape is invalid")
        _require_list(linked.get("sections"), "linked option sections", 16)
        shapes = _require_list(
            linked.get("property_shapes"), "linked option property shapes", MAX_PROPERTIES
        )
        if len(shapes) != len(definitions_by_id):
            raise RemoteAuditError("Remote linked option property shape count drifted")
        shape_ids: set[int] = set()
        for shape_item in shapes:
            shape = _require_dict(shape_item, "linked option property shape")
            prop_id = shape.get("id")
            definition = definitions_by_id.get(prop_id) if isinstance(prop_id, int) else None
            if (
                definition is None
                or prop_id in shape_ids
                or shape.get("code") != definition.get("code")
                or shape.get("type") != definition.get("type")
                or shape.get("multiple") != definition.get("multiple")
                or shape.get("link_iblock_id") != definition.get("link_iblock_id")
                or not isinstance(shape.get("value_count"), int)
                or re.fullmatch(r"[a-f0-9]{64}", str(shape.get("values_sha256"))) is None
            ):
                raise RemoteAuditError("Remote linked option property shape is invalid")
            shape_ids.add(prop_id)
        if shape_ids != set(definitions_by_id):
            raise RemoteAuditError("Remote linked option property schema is incomplete")
        for key in ("price_values", "filter_price_values"):
            _require_list(linked.get(key), f"linked option {key}", MAX_PROPERTY_VALUES)
        if re.fullmatch(r"[a-f0-9]{64}", str(linked.get("full_snapshot_sha256"))) is None:
            raise RemoteAuditError("Remote linked option snapshot hash is invalid")
        linked_by_id[linked_id] = linked

    peers = _require_dict(phase.get("template_peers"), "template peers")
    if peers.get("peer_ids") != list(TEMPLATE_PEER_IDS):
        raise RemoteAuditError("Remote template peer allowlist drifted")
    peer_elements = _require_list(peers.get("elements"), "template peer elements", 4)
    if [item.get("id") for item in peer_elements if isinstance(item, dict)] != list(
        TEMPLATE_PEER_IDS
    ):
        raise RemoteAuditError("Remote template peer identity/order is invalid")
    for index, item in enumerate(peer_elements):
        peer = _require_dict(item, f"template peer {index}")
        _validate_element_properties(peer, definitions_by_id, f"template peer {index}")
    if peers.get("full_snapshot_sha256") != _evidence_sha256(peer_elements):
        raise RemoteAuditError("Remote template peer snapshot hash is inconsistent")

    render = _require_dict(phase.get("render_order"), "render order")
    if (
        render.get("candidate_sources")
        != [
            "link_goods_order",
            "element_sort_then_id_asc",
            "element_sort_then_id_desc",
        ]
        or render.get("selectable_db_rule")
        != "active_and_exactly_one_positive_filter_price"
        or render.get("target_sort_from_section_gap") != TARGET_SORT
        or render.get("render_order_source") is not None
        or render.get("requires_public_model_page_evidence") is not True
    ):
        raise RemoteAuditError("Remote render-order hypothesis contract drifted")
    render_models = _require_list(
        render.get("models"), "render-order models", len(MODEL_CODES)
    )
    if len(render_models) != len(MODEL_CODES):
        raise RemoteAuditError("Remote render-order evidence is incomplete")
    expected_existing_at_target_sort: list[dict[str, object]] = []
    for linked_id in union_ids:
        linked = linked_by_id[linked_id]
        fields = _require_dict(linked.get("fields"), "linked option fields")
        price_contract = _filter_price_contract(
            linked.get("filter_price_values"), active=fields.get("active") is True
        )
        if fields.get("sort") == TARGET_SORT:
            expected_existing_at_target_sort.append(
                {
                    "id": linked_id,
                    "code": linked.get("code"),
                    "name": fields.get("name"),
                    "active": fields.get("active"),
                    "sort": fields.get("sort"),
                    "filter_price_values": linked.get("filter_price_values"),
                    "selectable_contract": price_contract,
                }
            )
    if (
        render.get("existing_union_items_at_target_sort")
        != expected_existing_at_target_sort
        or render.get("target_sort_is_unique_in_linked_union")
        is not (expected_existing_at_target_sort == [])
    ):
        raise RemoteAuditError("Remote target SORT uniqueness evidence is inconsistent")

    for code, item in zip(MODEL_CODES, render_models):
        render_model = _require_dict(item, "render-order model")
        if (
            render_model.get("model_code") != code
            or render_model.get("model_id") != model_ids_by_code[code]
        ):
            raise RemoteAuditError("Remote render-order model identity drifted")
        hypotheses = _require_dict(render_model.get("hypotheses"), "render hypotheses")
        expected_relation_items: list[dict[str, object]] = []
        for linked_id in model_ordered_ids[code]:
            linked = linked_by_id[linked_id]
            fields = _require_dict(linked.get("fields"), "linked option fields")
            expected_relation_items.append(
                {
                    "id": linked_id,
                    "code": linked.get("code"),
                    "name": fields.get("name"),
                    "active": fields.get("active"),
                    "sort": fields.get("sort"),
                    "filter_price_values": linked.get("filter_price_values"),
                    "selectable_contract": _filter_price_contract(
                        linked.get("filter_price_values"),
                        active=fields.get("active") is True,
                    ),
                }
            )
        relation_items = _require_list(
            render_model.get("relation_items"), "render relation items", MAX_PROPERTY_VALUES
        )
        if relation_items != expected_relation_items:
            raise RemoteAuditError("Remote render relation items are inconsistent")
        selectable_relation = [
            relation_item["id"]
            for relation_item in expected_relation_items
            if relation_item["selectable_contract"]["eligible"] is True
        ]
        selectable_sorted_asc = sorted(
            selectable_relation,
            key=lambda linked_id: (
                linked_by_id[linked_id]["fields"]["sort"],
                linked_id,
            ),
        )
        selectable_sorted_desc = sorted(
            selectable_relation,
            key=lambda linked_id: (
                linked_by_id[linked_id]["fields"]["sort"],
                -linked_id,
            ),
        )
        if (
            hypotheses.get("link_goods_order") != selectable_relation
            or hypotheses.get("element_sort_then_id_asc") != selectable_sorted_asc
            or hypotheses.get("element_sort_then_id_desc") != selectable_sorted_desc
            or render_model.get("expected_selectable_count") != len(selectable_relation)
            or render_model.get("expected_selectable_ids_as_set")
            != sorted(selectable_relation)
        ):
            raise RemoteAuditError("Remote render-order hypotheses are inconsistent")
        target_hypothesis = _require_dict(
            render_model.get("target_hypothesis"), "target render hypothesis"
        )
        sorted_items = sorted(
            (
                relation_item
                for relation_item in expected_relation_items
                if relation_item["selectable_contract"]["eligible"] is True
            ),
            key=lambda relation_item: (relation_item["sort"], -relation_item["id"]),
        )
        below = [item for item in sorted_items if item["sort"] < TARGET_SORT]
        equal = [item for item in sorted_items if item["sort"] == TARGET_SORT]
        above = [item for item in sorted_items if item["sort"] > TARGET_SORT]
        if (
            target_hypothesis.get("target_sort") != TARGET_SORT
            or target_hypothesis.get("link_goods_append_position_zero_based")
            != len(model_ordered_ids[code])
            or target_hypothesis.get("sort_neighbor_before")
            != (below[-1] if below else None)
            or target_hypothesis.get("same_sort_items") != equal
            or target_hypothesis.get("sort_neighbor_after")
            != (above[0] if above else None)
            or target_hypothesis.get("tie_break_is_unprovable_before_target_id_exists")
            is not bool(equal)
        ):
            raise RemoteAuditError("Remote target render hypothesis is inconsistent")

    no_content = _require_dict(
        phase.get("active_no_picture_no_text_options"), "no-content option samples"
    )
    if no_content.get("section_id") != OPTIONS_SECTION_ID:
        raise RemoteAuditError("Remote no-content option section drifted")
    samples = _require_list(
        no_content.get("samples"), "no-content option samples", 16
    )
    eligible_count = no_content.get("eligible_count")
    if not isinstance(eligible_count, int) or eligible_count < len(samples):
        raise RemoteAuditError("Remote no-content option count is invalid")
    sample_ids: set[int] = set()
    for item in samples:
        sample = _require_dict(item, "no-content option sample")
        sample_id = sample.get("id")
        sample_code = sample.get("code")
        if (
            not isinstance(sample_id, int)
            or sample_id <= 0
            or sample_id in sample_ids
            or not isinstance(sample_code, str)
            or not sample_code
        ):
            raise RemoteAuditError("Remote no-content option identity is invalid")
        sample_ids.add(sample_id)
        fields = _require_dict(sample.get("fields"), "no-content option fields")
        if (
            fields.get("active") is not True
            or not isinstance(fields.get("sort"), int)
            or fields.get("preview_picture_id") != 0
            or fields.get("detail_picture_id") != 0
            or _require_dict(fields.get("preview_text"), "preview text shape").get("empty")
            is not True
            or _require_dict(fields.get("detail_text"), "detail text shape").get("empty")
            is not True
        ):
            raise RemoteAuditError("Remote no-content option sample is not empty")
        sections = _require_list(sample.get("sections"), "no-content option sections", 16)
        if OPTIONS_SECTION_ID not in {
            section.get("id")
            for section in sections
            if isinstance(section, dict)
        }:
            raise RemoteAuditError("Remote no-content option is outside section 302")
        shapes = _require_list(
            sample.get("property_shapes"),
            "no-content option property shapes",
            MAX_PROPERTIES,
        )
        if {shape.get("id") for shape in shapes if isinstance(shape, dict)} != set(
            definitions_by_id
        ):
            raise RemoteAuditError("Remote no-content option property schema is incomplete")
        if re.fullmatch(r"[a-f0-9]{64}", str(sample.get("full_snapshot_sha256"))) is None:
            raise RemoteAuditError("Remote no-content option snapshot hash is invalid")
        expected_url = f"{PUBLIC_ORIGIN}/product/{sample_code}/"
        if sample.get("public_url") != expected_url:
            raise RemoteAuditError("Remote no-content option URL is invalid")

    metadata = _require_dict(phase.get("metadata_templates"), "metadata template evidence")
    if set(metadata) != {
        "iblock_page_url_templates",
        "iblock_inherited_templates",
        "section_inherited_templates",
    }:
        raise RemoteAuditError("Remote metadata template evidence shape drifted")
    page_templates = _require_dict(
        metadata.get("iblock_page_url_templates"), "iblock page URL templates"
    )
    if set(page_templates) != {"LIST_PAGE_URL", "SECTION_PAGE_URL", "DETAIL_PAGE_URL"}:
        raise RemoteAuditError("Remote iblock page URL template keys drifted")
    for value in page_templates.values():
        _validate_normalized_value(value, "iblock page URL template")
    for key in ("iblock_inherited_templates", "section_inherited_templates"):
        inherited = _require_dict(metadata.get(key), f"{key} evidence")
        if not isinstance(inherited.get("available"), bool):
            raise RemoteAuditError("Remote inherited metadata availability is invalid")
        if inherited.get("available") is True:
            templates = _require_dict(inherited.get("templates"), f"{key} templates")
            if len(templates) > 64 or "reason" in inherited:
                raise RemoteAuditError("Remote inherited metadata templates are invalid")
            for template_key, value in templates.items():
                if not isinstance(template_key, str) or len(template_key) > 128:
                    raise RemoteAuditError("Remote inherited metadata key is invalid")
                _validate_normalized_value(value, "inherited metadata template")
        elif inherited.get("templates") is not None or not isinstance(
            inherited.get("reason"), str
        ):
            raise RemoteAuditError("Remote unavailable metadata evidence is invalid")

    contract = _require_dict(
        phase.get("public_verification_contract"), "public verification contract"
    )
    if (
        contract.get("model_urls") != list(PUBLIC_MODEL_URLS)
        or contract.get("required_model_page_fields")
        != [
            "http_status",
            "final_url",
            "self_canonical",
            "robots",
            "body_sha256",
            "ordered_selectable_option_ids",
            "ordered_selectable_option_sums",
        ]
        or contract.get("render_order_source_rule")
        != "exactly_one_database_hypothesis_must_match_all_12_public_pages"
        or contract.get("control_selector_contract")
        != {
            "tag": "span",
            "required_classes": ["btn", "bg-theme-target"],
            "required_attributes": [
                "data-product-id",
                "data-sum",
                "data-name",
                "data-row-id",
                "onclick",
            ],
            "onclick": "priceCalculator.toggleOption(this)",
        }
        or contract.get("selectable_db_rule")
        != "active_and_exactly_one_positive_filter_price"
        or contract.get("no_content_policy_baseline_required") is not True
    ):
        raise RemoteAuditError("Remote public model URL allowlist drifted")

    expected_phase_blockers: list[str] = []
    if tuple(union_ids) != EXPECTED_LINKED_OPTION_IDS:
        expected_phase_blockers.append("linked_option_union_drifted_from_pinned_audit")
    if len(union_ids) != 62:
        expected_phase_blockers.append("linked_option_union_count_is_not_62")
    if gur_model_count != 8:
        expected_phase_blockers.append("gur_coverage_is_not_8_of_12")
    if eligible_count == 0:
        expected_phase_blockers.append("no_active_no_picture_no_text_option_baseline")
    if expected_existing_at_target_sort:
        expected_phase_blockers.append("target_sort_506_is_not_unique_in_linked_union")
    expected_phase_blockers.append("public_render_order_source_not_verified")
    if phase.get("blockers") != expected_phase_blockers:
        raise RemoteAuditError("Remote phase1b blocker list is inconsistent")
    if phase.get("phase1b_evidence_ready") is not False:
        raise RemoteAuditError("Remote phase1b evidence cannot be ready before public proof")


def normalize_remote_payload(payload: object) -> dict[str, object]:
    remote = _require_dict(payload, "payload")
    encoded = json.dumps(remote, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_JSON_BYTES:
        raise RemoteAuditError("Remote JSON exceeded the fixed limit")
    if remote.get("status") != "ok" or remote.get("mode") != "audit":
        raise RemoteAuditError("Remote helper did not return a successful audit")
    if remote.get("database_mutations") != 0 or remote.get("apply_supported") is not False:
        raise RemoteAuditError("Remote helper violated the read-only contract")

    expected_identity = {
        "domain": DOMAIN,
        "site_id": SITE_ID,
        "site_root": SITE_ROOT,
        "iblock_id": IBLOCK_ID,
        "anchor_id": ANCHOR_ID,
        "anchor_code": ANCHOR_CODE,
        "comparator_id": COMPARATOR_ID,
        "comparator_role": COMPARATOR_ROLE,
        "target": {"name": TARGET_NAME, "code": TARGET_CODE, "price": TARGET_PRICE},
        "model_codes": list(MODEL_CODES),
        "trailer_included": False,
    }
    if remote.get("identity") != expected_identity:
        raise RemoteAuditError("Remote helper identity does not match the fixed scope")

    schema = _require_dict(remote.get("schema"), "schema")
    definitions = _require_list(
        schema.get("property_definitions"), "property definitions", MAX_PROPERTIES
    )
    if not definitions:
        raise RemoteAuditError("Remote property schema is empty")
    site_schema = _require_dict(schema.get("site"), "site schema")
    iblock_schema = _require_dict(schema.get("iblock"), "iblock schema")
    if site_schema.get("id") != SITE_ID or site_schema.get("active") is not True:
        raise RemoteAuditError("Remote site schema does not match the active pinned site")
    site_ids = _require_list(iblock_schema.get("site_ids"), "iblock site ids", 16)
    if (
        iblock_schema.get("id") != IBLOCK_ID
        or iblock_schema.get("active") is not True
        or SITE_ID not in site_ids
    ):
        raise RemoteAuditError("Remote iblock schema does not match the active pinned iblock")
    definitions_by_id: dict[int, dict[str, object]] = {}
    for item in definitions:
        definition = _require_dict(item, "property definition")
        prop_id = definition.get("id")
        if not isinstance(prop_id, int) or prop_id <= 0 or prop_id in definitions_by_id:
            raise RemoteAuditError("Remote property definition identity is invalid")
        definitions_by_id[prop_id] = definition
        _require_list(
            definition.get("enums"), "property enums", MAX_ENUMS_PER_PROPERTY
        )

    elements = _require_dict(remote.get("elements"), "elements")
    anchor = _require_dict(elements.get("anchor"), "anchor")
    comparator = _require_dict(elements.get("comparator"), "comparator")
    if anchor.get("id") != ANCHOR_ID or comparator.get("id") != COMPARATOR_ID:
        raise RemoteAuditError("Remote anchor/comparator identity is invalid")
    if anchor.get("code") != ANCHOR_CODE:
        raise RemoteAuditError("Remote anchor code drifted")
    _validate_element_properties(anchor, definitions_by_id, "anchor")
    _validate_element_properties(comparator, definitions_by_id, "comparator")

    models = _require_list(elements.get("models"), "models", len(MODEL_CODES))
    if len(models) != len(MODEL_CODES):
        raise RemoteAuditError("Remote model count does not match the fixed scope")
    model_codes: list[str] = []
    model_ids: set[int] = set()
    for index, item in enumerate(models):
        model = _require_dict(item, "model")
        code = model.get("code")
        model_id = model.get("id")
        if code != MODEL_CODES[index] or not isinstance(model_id, int) or model_id <= 0:
            raise RemoteAuditError("Remote model identity/order is invalid")
        if model_id in model_ids or model_id in {ANCHOR_ID, COMPARATOR_ID}:
            raise RemoteAuditError("Remote model ids are not unique")
        model_codes.append(code)
        model_ids.add(model_id)
        _validate_element_properties(model, definitions_by_id, f"model {index}")
    if tuple(model_codes) != MODEL_CODES:
        raise RemoteAuditError("Remote model allowlist drifted")

    relation = _require_dict(remote.get("relation_analysis"), "relation analysis")
    expected_scope = {
        "model_codes": list(MODEL_CODES),
        "model_count": len(MODEL_CODES),
        "trailer_included": False,
        "anchor_scope_is_not_target_scope": True,
        "future_new_elements_max": 1,
        "future_existing_element_writes_max": 0,
    }
    if relation.get("desired_scope") != expected_scope:
        raise RemoteAuditError("Remote desired relation scope drifted")
    candidates = _require_list(
        relation.get("candidate_relations"),
        "relation candidates",
        MAX_PROPERTIES * 2,
    )
    strong_candidates: list[dict[str, object]] = []
    for item in candidates:
        candidate = _require_dict(item, "relation candidate")
        direction = candidate.get("direction")
        if direction not in {"option_to_models", "models_to_option"}:
            raise RemoteAuditError("Remote relation direction is invalid")
        prop = _require_dict(candidate.get("property"), "relation property")
        prop_id = prop.get("id")
        if not isinstance(prop_id, int) or definitions_by_id.get(prop_id) != prop:
            raise RemoteAuditError("Remote relation property is outside the schema")
        if prop.get("type") != "E" or prop.get("link_iblock_id") != IBLOCK_ID:
            raise RemoteAuditError("Remote relation property is not a pinned element link")
        if not isinstance(candidate.get("strong"), bool):
            raise RemoteAuditError("Remote relation strength is invalid")
        if direction == "option_to_models":
            anchor_codes = _require_list(
                candidate.get("anchor_model_codes"), "anchor relation models", len(MODEL_CODES)
            )
            comparator_codes = _require_list(
                candidate.get("comparator_model_codes"),
                "comparator relation models",
                len(MODEL_CODES),
            )
            anchor_foreign = _require_list(
                candidate.get("anchor_foreign_link_ids"), "anchor foreign links", 128
            )
            comparator_foreign = _require_list(
                candidate.get("comparator_foreign_link_ids"),
                "comparator foreign links",
                128,
            )
            if (
                any(not isinstance(code, str) for code in [*anchor_codes, *comparator_codes])
                or len(set(anchor_codes)) != len(anchor_codes)
                or len(set(comparator_codes)) != len(comparator_codes)
                or any(code not in MODEL_CODES for code in [*anchor_codes, *comparator_codes])
                or any(type(link_id) is not int or link_id <= 0 for link_id in [*anchor_foreign, *comparator_foreign])
            ):
                raise RemoteAuditError("Remote option-to-model relation evidence is invalid")
            expected_strong = bool(
                anchor_codes and comparator_codes and not anchor_foreign and not comparator_foreign
            )
        else:
            anchor_codes = _require_list(
                candidate.get("models_referencing_anchor"),
                "models referencing anchor",
                len(MODEL_CODES),
            )
            comparator_codes = _require_list(
                candidate.get("models_referencing_comparator"),
                "models referencing comparator",
                len(MODEL_CODES),
            )
            if (
                any(not isinstance(code, str) for code in [*anchor_codes, *comparator_codes])
                or len(set(anchor_codes)) != len(anchor_codes)
                or len(set(comparator_codes)) != len(comparator_codes)
                or any(code not in MODEL_CODES for code in [*anchor_codes, *comparator_codes])
            ):
                raise RemoteAuditError("Remote model-to-option relation evidence is invalid")
            expected_strong = bool(anchor_codes and comparator_codes)
        if candidate.get("strong") is not expected_strong:
            raise RemoteAuditError("Remote relation strength does not match its evidence")
        if candidate.get("strong") is True:
            strong_candidates.append(candidate)
    strong_count = relation.get("strong_candidate_count")
    unambiguous = relation.get("unambiguous")
    if not isinstance(strong_count, int) or strong_count != len(strong_candidates):
        raise RemoteAuditError("Remote relation candidate count is invalid")
    if unambiguous is not (strong_count == 1):
        raise RemoteAuditError("Remote relation ambiguity flag is inconsistent")
    expected_derived = strong_candidates[0] if len(strong_candidates) == 1 else None
    if relation.get("derived_relation") != expected_derived:
        raise RemoteAuditError("Remote derived relation is inconsistent")
    single_element_expected = bool(
        expected_derived
        and expected_derived.get("direction") == "option_to_models"
        and isinstance(expected_derived.get("property"), dict)
        and expected_derived["property"].get("type") == "E"
        and expected_derived["property"].get("multiple") is True
        and expected_derived["property"].get("link_iblock_id") == IBLOCK_ID
    )
    if relation.get("single_element_write_supported") is not single_element_expected:
        raise RemoteAuditError("Remote single-element relation gate is inconsistent")

    price = _require_dict(remote.get("price_analysis"), "price analysis")
    if price.get("target_price") != TARGET_PRICE:
        raise RemoteAuditError("Remote target price drifted")
    price_candidates = _require_list(
        price.get("candidates"), "price candidates", MAX_PROPERTIES
    )
    strong_price_candidates: list[dict[str, object]] = []
    for item in price_candidates:
        candidate = _require_dict(item, "price candidate")
        prop = _require_dict(candidate.get("property"), "price property")
        prop_id = prop.get("id")
        if not isinstance(prop_id, int) or definitions_by_id.get(prop_id) != prop:
            raise RemoteAuditError("Remote price property is outside the schema")
        anchor_prices = _require_list(
            candidate.get("anchor_numeric_values"), "anchor prices", 8
        )
        comparator_prices = _require_list(
            candidate.get("comparator_numeric_values"), "comparator prices", 8
        )
        if any(
            isinstance(value, bool) or not isinstance(value, (int, float))
            for value in [*anchor_prices, *comparator_prices]
        ):
            raise RemoteAuditError("Remote numeric price evidence is invalid")
        if not isinstance(candidate.get("strong"), bool):
            raise RemoteAuditError("Remote price strength is invalid")
        expected_price_strong = len(anchor_prices) == 1 and len(comparator_prices) == 1
        if candidate.get("strong") is not expected_price_strong:
            raise RemoteAuditError("Remote price strength does not match its evidence")
        if candidate.get("strong") is True:
            strong_price_candidates.append(candidate)
    price_strong_count = price.get("strong_candidate_count")
    price_unambiguous = price.get("unambiguous")
    if price_strong_count != len(strong_price_candidates):
        raise RemoteAuditError("Remote price candidate count is inconsistent")
    if price_unambiguous is not (len(strong_price_candidates) == 1):
        raise RemoteAuditError("Remote price ambiguity flag is inconsistent")
    expected_price_property = (
        strong_price_candidates[0]["property"]
        if len(strong_price_candidates) == 1
        else None
    )
    if price.get("derived_property") != expected_price_property:
        raise RemoteAuditError("Remote derived price property is inconsistent")

    section_order = _require_dict(remote.get("section_order"), "section order")
    anchor_sort = section_order.get("anchor_sort")
    if not isinstance(anchor_sort, int):
        raise RemoteAuditError("Remote anchor sort is invalid")
    section_plans = _require_list(section_order.get("sections"), "section plans", 16)
    for item in section_plans:
        plan = _require_dict(item, "section plan")
        siblings = _require_list(plan.get("siblings"), "section siblings", MAX_SECTION_SIBLINGS)
        position = plan.get("anchor_position_zero_based")
        if not isinstance(position, int) or position < 0 or position >= len(siblings):
            raise RemoteAuditError("Remote anchor section position is invalid")
        sibling = _require_dict(siblings[position], "anchor sibling")
        if sibling.get("id") != ANCHOR_ID or plan.get("anchor") != sibling:
            raise RemoteAuditError("Remote section anchor evidence is inconsistent")
        expected_previous = siblings[position - 1] if position > 0 else None
        expected_next = siblings[position + 1] if position + 1 < len(siblings) else None
        if plan.get("previous") != expected_previous or plan.get("next") != expected_next:
            raise RemoteAuditError("Remote section adjacency evidence is inconsistent")
        next_sort = expected_next.get("sort") if isinstance(expected_next, dict) else None
        expected_gap = next_sort - anchor_sort if isinstance(next_sort, int) else None
        if plan.get("sort_gap_after_anchor") != expected_gap:
            raise RemoteAuditError("Remote section sort gap is inconsistent")
    sort_plan = _require_dict(section_order.get("global_sort_plan"), "global sort plan")
    sort_unambiguous = sort_plan.get("unambiguous")
    candidate_sort = sort_plan.get("candidate_sort")
    requires_resort = sort_plan.get("requires_sibling_resort")
    if sort_unambiguous is True:
        if (
            not isinstance(candidate_sort, int)
            or candidate_sort != TARGET_SORT
            or candidate_sort <= anchor_sort
            or requires_resort is not False
            or not section_plans
        ):
            raise RemoteAuditError("Remote safe sort plan is inconsistent")
        for item in section_plans:
            next_item = item.get("next")
            if isinstance(next_item, dict) and (
                not isinstance(next_item.get("sort"), int)
                or candidate_sort >= next_item["sort"]
            ):
                raise RemoteAuditError("Remote candidate sort is outside a section gap")
    elif sort_unambiguous is False:
        if candidate_sort is not None or requires_resort is not True:
            raise RemoteAuditError("Remote blocked sort plan is inconsistent")
    else:
        raise RemoteAuditError("Remote sort ambiguity flag is invalid")

    duplicates = _require_dict(remote.get("target_duplicates"), "target duplicates")
    duplicate_by_name = _require_list(
        duplicates.get("by_exact_name"), "target name duplicates", 32
    )
    duplicate_by_code = _require_list(
        duplicates.get("by_exact_code"), "target code duplicates", 32
    )
    duplicate_union = _require_list(duplicates.get("union"), "target duplicate union", 32)
    expected_duplicate_map: dict[int, dict[str, object]] = {}
    for item in [*duplicate_by_name, *duplicate_by_code]:
        duplicate = _require_dict(item, "target duplicate")
        duplicate_id = duplicate.get("id")
        if not isinstance(duplicate_id, int) or duplicate_id <= 0:
            raise RemoteAuditError("Remote target duplicate identity is invalid")
        expected_duplicate_map[duplicate_id] = duplicate
    expected_duplicate_union = [
        expected_duplicate_map[key] for key in sorted(expected_duplicate_map)
    ]
    if duplicate_union != expected_duplicate_union:
        raise RemoteAuditError("Remote target duplicate union is inconsistent")

    expected_blockers: list[str] = []
    if not unambiguous:
        expected_blockers.append("relation_property_or_direction_is_ambiguous")
    elif not single_element_expected:
        expected_blockers.append(
            "relation_is_not_compatible_with_single_new_element_scope"
        )
    if not price_unambiguous:
        expected_blockers.append("price_property_is_ambiguous")
    if duplicate_union:
        expected_blockers.append("target_exact_name_or_code_already_exists")
    if not sort_unambiguous:
        expected_blockers.append("no_safe_sort_gap_after_anchor")
    blockers = _require_list(remote.get("blockers"), "blockers", 32)
    if blockers != expected_blockers:
        raise RemoteAuditError("Remote blocker list is inconsistent")
    base_audit_gates_passed = (
        unambiguous
        and single_element_expected
        and price_unambiguous
        and not duplicate_union
        and sort_unambiguous
        and not expected_blockers
    )
    if remote.get("base_audit_gates_passed") is not base_audit_gates_passed:
        raise RemoteAuditError("Remote base audit gate conjunction is inconsistent")
    if remote.get("ready_for_apply") is not False:
        raise RemoteAuditError("Remote audit-only helper cannot be ready for apply")

    _validate_phase1b_evidence(remote, definitions_by_id, models)

    # A JSON round trip removes custom mapping subclasses and keeps only data.
    return json.loads(json.dumps(remote, ensure_ascii=False))


def parse_remote_stdout_frame(
    stdout: str,
    *,
    expected_script_sha256: str,
) -> tuple[object, str]:
    """Parse one exact ASCII frame; reject truncation and stdout contamination."""
    if (
        not stdout
        or not stdout.endswith("\n")
        or "\r" in stdout
        or len(stdout.encode("utf-8")) > MAX_STDOUT_BYTES
    ):
        raise RemoteAuditError("Remote stdout frame boundaries are invalid")
    lines = stdout[:-1].split("\n")
    if len(lines) != 6:
        raise RemoteAuditError("Remote stdout contains missing or unexpected frame lines")
    expected_prefixes = (
        "__ROSOMAHA_FAN_PHP_VERSION__=",
        "__ROSOMAHA_FAN_PHP_SHA256__=",
        "__ROSOMAHA_FAN_PHP_LINT__=",
        "__ROSOMAHA_FAN_JSON_BYTES__=",
        "__ROSOMAHA_FAN_JSON_SHA256__=",
        "__ROSOMAHA_FAN_JSON_BASE64__=",
    )
    if any(not line.startswith(prefix) for line, prefix in zip(lines, expected_prefixes)):
        raise RemoteAuditError("Remote stdout frame marker order is invalid")
    values = [line[len(prefix):] for line, prefix in zip(lines, expected_prefixes)]
    php_version, script_sha256, lint_status, byte_text, payload_sha256, encoded = values
    if re.fullmatch(
        re.escape(EXPECTED_PHP_SERIES) + r"\.[0-9]+(?:[-+][A-Za-z0-9._-]+)?",
        php_version,
    ) is None:
        raise RemoteAuditError("Remote PHP version is outside the pinned series")
    if script_sha256 != expected_script_sha256:
        raise RemoteAuditError("Remote PHP byte digest does not match")
    if lint_status != "ok":
        raise RemoteAuditError("Remote PHP lint marker is invalid")
    if re.fullmatch(r"[1-9][0-9]*", byte_text) is None:
        raise RemoteAuditError("Remote JSON byte marker is invalid")
    payload_bytes_expected = int(byte_text)
    if payload_bytes_expected > MAX_JSON_BYTES:
        raise RemoteAuditError("Remote JSON exceeded the fixed limit")
    if re.fullmatch(r"[a-f0-9]{64}", payload_sha256) is None:
        raise RemoteAuditError("Remote JSON digest marker is invalid")
    expected_base64_length = 4 * ((payload_bytes_expected + 2) // 3)
    if (
        len(encoded) != expected_base64_length
        or not encoded.isascii()
        or re.fullmatch(r"[A-Za-z0-9+/]+={0,2}", encoded) is None
    ):
        raise RemoteAuditError("Remote JSON base64 frame is invalid")
    try:
        payload_bytes = base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise RemoteAuditError("Remote JSON base64 frame is invalid") from exc
    if len(payload_bytes) != payload_bytes_expected:
        raise RemoteAuditError("Remote JSON byte marker does not match the frame")
    if hashlib.sha256(payload_bytes).hexdigest() != payload_sha256:
        raise RemoteAuditError("Remote JSON digest does not match the frame")
    try:
        payload_text = payload_bytes.decode("utf-8", errors="strict")
        parsed = json.loads(payload_text)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RemoteAuditError("Remote framed payload is not valid UTF-8 JSON") from exc
    return parsed, php_version


def execute_remote(
    mode: str = "audit",
    *,
    connect_fn: Callable[[], paramiko.SSHClient] = connect,
) -> dict[str, object]:
    if mode != "audit":
        raise ForbiddenModeError("This phase-1 helper supports audit only")
    if not PHP_SCRIPT.is_file():
        raise RuntimeError("Pinned PHP reader is missing")
    script_bytes = PHP_SCRIPT.read_bytes()
    command, digest = build_remote_command(script_bytes)
    client = connect_fn()
    try:
        status, stdout, stderr = run_remote_command(client, command)
    finally:
        client.close()
    if stderr:
        raise RemoteAuditError("Remote read-only audit emitted stderr")
    if status != 0:
        raise RemoteAuditError("Remote read-only helper failed")
    parsed, php_version = parse_remote_stdout_frame(
        stdout,
        expected_script_sha256=digest,
    )
    normalized = normalize_remote_payload(parsed)
    normalized["runtime"] = {
        "php_version": php_version,
        "php_series_matches": True,
        "php_lint": "ok",
        "php_script_sha256": digest,
        "remote_exit_status": status,
    }
    return normalized


def _contains_forbidden_receipt_key(value: object) -> bool:
    if isinstance(value, dict):
        for key, item in value.items():
            lowered = str(key).lower()
            if any(word in lowered for word in ("password", "credential", "private_key", "access_token")):
                return True
            if _contains_forbidden_receipt_key(item):
                return True
    elif isinstance(value, list):
        return any(_contains_forbidden_receipt_key(item) for item in value)
    return False


def _atomic_immutable_json(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if _contains_forbidden_receipt_key(payload):
        raise RuntimeError("Receipt payload contains a forbidden secret field")
    data = (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    if len(data) > MAX_RECEIPT_BYTES:
        raise RuntimeError("Receipt payload exceeded the fixed byte limit")
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp")
    descriptor: int | None = None
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        offset = 0
        while offset < len(data):
            written = os.write(descriptor, data[offset:])
            if written <= 0:
                raise OSError("Receipt write made no progress")
            offset += written
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = None
        os.link(temporary, path)
        # On Windows both hard-link names share the read-only attribute.  Drop
        # the temporary name before freezing the final receipt.
        temporary.unlink()
        try:
            os.chmod(path, 0o444)
        except Exception:
            path.unlink()
            raise
    finally:
        if descriptor is not None:
            os.close(descriptor)
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def write_receipt(
    remote: dict[str, object],
    *,
    public_evidence: dict[str, object] | None = None,
    path: Path | None = None,
) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%fZ")
    destination = path or (
        REPORT_ROOT / f"ROSOMAHA_BITRIX_FAN_BUTTON_{stamp}_AUDIT.json"
    )
    receipt = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "domain": DOMAIN,
        "mode": "audit",
        "phase": (
            "phase1b_database_and_public_render_order"
            if public_evidence is not None
            else "schema_and_relation_discovery"
        ),
        "read_only": True,
        "secrets_exported": False,
        "pii_exported": False,
        "remote": remote,
    }
    if public_evidence is not None:
        receipt["public"] = public_evidence
    _atomic_immutable_json(destination, receipt)
    return destination


def reject_forbidden_modes(argv: Sequence[str]) -> None:
    for argument in argv:
        lowered = argument.lower()
        if any(
            lowered == prefix or lowered.startswith(prefix + "=")
            for prefix in FORBIDDEN_MODE_PREFIXES
        ):
            raise ForbiddenModeError(
                "This phase-1 helper has no apply or recovery capability"
            )


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    raw = list(sys.argv[1:] if argv is None else argv)
    reject_forbidden_modes(raw)
    parser = argparse.ArgumentParser(
        description="Audit the pinned Bitrix schema for one future fan-button option."
    )
    parser.add_argument(
        "--audit",
        action="store_true",
        help="Explicitly select the default read-only audit mode.",
    )
    return parser.parse_args(raw)


def _safe_error(error: BaseException) -> str:
    text = str(error) or type(error).__name__
    for sensitive in (EXPECTED_LOGIN, SITE_ROOT, str(ENV_PATH)):
        text = text.replace(sensitive, "[pinned]")
    text = re.sub(r"(?i)(password|token|secret)\s*[=:]\s*\S+", r"\1=[redacted]", text)
    return f"{type(error).__name__}: {text}"[:500]


def _validate_exact_public_url(url: object, allowed_urls: frozenset[str]) -> str:
    if not isinstance(url, str) or len(url.encode("utf-8")) > MAX_PUBLIC_ATTRIBUTE_BYTES:
        raise RemoteAuditError("Public URL is invalid")
    parsed = urlparse(url)
    if (
        url not in allowed_urls
        or parsed.scheme != "https"
        or parsed.netloc != DOMAIN
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port is not None
        or parsed.query
        or parsed.fragment
        or not parsed.path.startswith("/product/")
        or not parsed.path.endswith("/")
    ):
        raise RemoteAuditError("Public URL is outside the exact HTTPS allowlist")
    return url


class ExactPublicRedirectHandler(HTTPRedirectHandler):
    max_repeats = 1
    max_redirections = 2

    def __init__(self, allowed_urls: frozenset[str]) -> None:
        super().__init__()
        self.allowed_urls = allowed_urls

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        target = urljoin(req.full_url, html_module.unescape(newurl))
        _validate_exact_public_url(target, self.allowed_urls)
        return super().redirect_request(req, fp, code, msg, headers, target)


def fetch_public_html(
    url: str,
    allowed_urls: frozenset[str],
) -> dict[str, object]:
    requested = _validate_exact_public_url(url, allowed_urls)
    opener = build_opener(ExactPublicRedirectHandler(allowed_urls))
    request = Request(
        requested,
        headers={
            "User-Agent": PUBLIC_USER_AGENT,
            "Accept": "text/html,application/xhtml+xml;q=0.9",
            "Accept-Encoding": "identity",
            "Connection": "close",
        },
        method="GET",
    )
    response = None
    try:
        try:
            response = opener.open(request, timeout=20)
        except HTTPError as error:
            response = error
        body = response.read(MAX_PUBLIC_BODY_BYTES + 1)
        if len(body) > MAX_PUBLIC_BODY_BYTES:
            raise RemoteAuditError("Public HTML exceeded the fixed byte limit")
        final_url = response.geturl()
        _validate_exact_public_url(final_url, allowed_urls)
        status = getattr(response, "status", None)
        if not isinstance(status, int):
            status = response.getcode()
        if not isinstance(status, int):
            raise RemoteAuditError("Public HTTP status is invalid")
        content_type = str(response.headers.get("Content-Type", ""))
        if len(content_type.encode("utf-8")) > 256:
            raise RemoteAuditError("Public Content-Type exceeded the fixed limit")
        return {
            "http_status": status,
            "final_url": final_url,
            "content_type": content_type,
            "body": body,
        }
    except (URLError, TimeoutError) as exc:
        raise RemoteAuditError(
            f"Public HTTPS fetch failed ({type(exc).__name__})"
        ) from exc
    finally:
        if response is not None:
            response.close()


_VOID_HTML_TAGS = frozenset(
    {
        "area",
        "base",
        "br",
        "col",
        "embed",
        "hr",
        "img",
        "input",
        "link",
        "meta",
        "param",
        "source",
        "track",
        "wbr",
    }
)
_HIDDEN_CLASS_TOKENS = frozenset({"hidden", "d-none", "is-hidden", "u-hidden"})
_PLACEHOLDER_MARKERS = (
    "placeholder",
    "no-photo",
    "no_photo",
    "nophoto",
    "no-image",
    "no_image",
    "default-image",
    "default_image",
)
_PRODUCT_IMAGE_MARKERS = frozenset(
    {"product", "detail", "gallery", "slider", "image", "images", "photo", "photos"}
)


def _parse_public_sum(raw: str) -> int | None:
    normalized = raw.strip().replace("\u00a0", "").replace(" ", "").replace(",", ".")
    if re.fullmatch(r"[+]?[0-9]+(?:\.0+)?", normalized) is None:
        return None
    value = int(normalized.split(".", 1)[0].lstrip("+") or "0")
    return value if value > 0 else None


class PublicPageParser(HTMLParser):
    """Bounded structural parser for the exact public additional-option control."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.canonicals: list[str] = []
        self.robots: list[str] = []
        self.strict_controls: list[dict[str, object]] = []
        self.near_controls: list[dict[str, object]] = []
        self.images: list[dict[str, object]] = []
        self.og_images: list[str] = []
        self.picture_tag_count = 0
        self.source_tag_count = 0
        self.structural_errors: list[str] = []
        self.control_errors: list[str] = []
        self.title_parts: list[str] = []
        self.title_bytes = 0
        self._stack: list[dict[str, object]] = []
        self._node_count = 0

    def _error(self, target: list[str], code: str) -> None:
        if code not in target and len(target) < MAX_PUBLIC_PARSE_ERRORS:
            target.append(code)

    @staticmethod
    def _attributes(
        attrs: list[tuple[str, str | None]],
    ) -> tuple[dict[str, str], set[str]]:
        result: dict[str, str] = {}
        duplicates: set[str] = set()
        for raw_name, raw_value in attrs:
            name = raw_name.casefold()
            if name in result:
                duplicates.add(name)
                continue
            result[name] = "" if raw_value is None else raw_value
        return result, duplicates

    @staticmethod
    def _class_tokens(attributes: dict[str, str]) -> list[str]:
        return sorted(
            {item[:128] for item in attributes.get("class", "").split() if item}
        )[:32]

    def _hidden(self, attributes: dict[str, str], class_tokens: list[str]) -> bool:
        style = re.sub(r"\s+", "", attributes.get("style", "").casefold())
        own_hidden = (
            "hidden" in attributes
            or attributes.get("aria-hidden", "").casefold() == "true"
            or bool(_HIDDEN_CLASS_TOKENS.intersection(class_tokens))
            or "display:none" in style
            or "visibility:hidden" in style
        )
        return own_hidden or bool(self._stack and self._stack[-1]["hidden"] is True)

    def _bounded_attribute(
        self,
        value: str,
        *,
        error_target: list[str],
        error_code: str,
    ) -> str | None:
        if len(value.encode("utf-8")) > MAX_PUBLIC_ATTRIBUTE_BYTES:
            self._error(error_target, error_code)
            return None
        return value

    def _record_control(
        self,
        tag: str,
        attributes: dict[str, str],
        duplicates: set[str],
        class_tokens: list[str],
        hidden: bool,
    ) -> None:
        paired = "data-product-id" in attributes and "data-sum" in attributes
        if not paired:
            return
        required_attributes = {
            "data-product-id",
            "data-sum",
            "data-name",
            "data-row-id",
            "onclick",
        }
        raw_onclick = attributes.get("onclick", "")
        onclick_bounded = len(raw_onclick.encode("utf-8")) <= MAX_PUBLIC_ATTRIBUTE_BYTES
        onclick = (
            re.sub(r"\s+", "", raw_onclick).rstrip(";") if onclick_bounded else ""
        )
        strict_shape = (
            tag == "span"
            and {"btn", "bg-theme-target"}.issubset(class_tokens)
            and required_attributes.issubset(attributes)
            and onclick == "priceCalculator.toggleOption(this)"
        )
        if not strict_shape:
            if (
                tag == "span"
                and {"btn", "bg-theme-target"}.issubset(class_tokens)
                and not onclick_bounded
            ):
                self._error(self.control_errors, "strict_control_onclick_too_long")
            if len(self.near_controls) >= MAX_PUBLIC_OPTION_OCCURRENCES:
                self._error(self.control_errors, "near_control_count_exceeded_limit")
                return
            attribute_names = sorted(attributes)
            if len(attribute_names) > 64:
                self._error(self.control_errors, "near_control_attribute_count_exceeded_limit")
                attribute_names = attribute_names[:64]
            raw_id = attributes.get("data-product-id", "")
            raw_sum = attributes.get("data-sum", "")
            product_id = (
                int(raw_id) if re.fullmatch(r"[1-9][0-9]*", raw_id) else None
            )
            price_sum = _parse_public_sum(raw_sum)
            disabled = (
                hidden
                or "disabled" in attributes
                or attributes.get("aria-disabled", "").casefold() == "true"
                or "disabled" in class_tokens
                or "is-disabled" in class_tokens
            )
            lowered_classes = [item.casefold() for item in class_tokens]
            option_like = (
                tag == "span"
                or any(
                    item in {"btn", "bg-theme-target"}
                    or "option" in item
                    or "theme-target" in item
                    for item in lowered_classes
                )
                or bool(raw_onclick.strip())
            )
            self.near_controls.append(
                {
                    "tag": tag,
                    "class_tokens": class_tokens,
                    "attribute_names": attribute_names,
                    "product_id": product_id,
                    "sum": price_sum,
                    "hidden_or_disabled": disabled,
                    "option_like": option_like,
                    "onclick_present": bool(raw_onclick.strip()),
                    "onclick_sha256": (
                        hashlib.sha256(raw_onclick.encode("utf-8")).hexdigest()
                        if raw_onclick
                        else None
                    ),
                    "ancestor_depth": len(self._stack),
                    "ancestor_fingerprint": _evidence_sha256(self._stack),
                }
            )
            return
        if len(self.strict_controls) >= MAX_PUBLIC_OPTION_OCCURRENCES:
            self._error(self.control_errors, "strict_control_count_exceeded_limit")
            return
        relevant_duplicates = required_attributes.intersection(duplicates)
        if relevant_duplicates:
            self._error(self.control_errors, "strict_control_has_duplicate_attributes")
        raw_id = self._bounded_attribute(
            attributes["data-product-id"],
            error_target=self.control_errors,
            error_code="strict_control_product_id_too_long",
        )
        raw_sum = self._bounded_attribute(
            attributes["data-sum"],
            error_target=self.control_errors,
            error_code="strict_control_sum_too_long",
        )
        data_name = self._bounded_attribute(
            attributes["data-name"],
            error_target=self.control_errors,
            error_code="strict_control_name_too_long",
        )
        row_id = self._bounded_attribute(
            attributes["data-row-id"],
            error_target=self.control_errors,
            error_code="strict_control_row_id_too_long",
        )
        product_id = (
            int(raw_id)
            if isinstance(raw_id, str) and re.fullmatch(r"[1-9][0-9]*", raw_id)
            else None
        )
        price_sum = _parse_public_sum(raw_sum) if isinstance(raw_sum, str) else None
        row_id_exact = bool(
            product_id is not None
            and isinstance(row_id, str)
            and re.fullmatch(rf"bx_[0-9]+_{product_id}", row_id)
        )
        disabled = (
            hidden
            or "disabled" in attributes
            or attributes.get("aria-disabled", "").casefold() == "true"
            or "disabled" in class_tokens
            or "is-disabled" in class_tokens
        )
        if product_id is None:
            self._error(self.control_errors, "strict_control_product_id_is_invalid")
        if price_sum is None:
            self._error(self.control_errors, "strict_control_sum_is_not_positive_integer")
        if not isinstance(data_name, str) or not data_name.strip():
            self._error(self.control_errors, "strict_control_name_is_empty")
        if not row_id_exact:
            self._error(self.control_errors, "strict_control_row_id_is_invalid")
        if disabled:
            self._error(self.control_errors, "strict_control_is_hidden_or_disabled")
        self.strict_controls.append(
            {
                "product_id": product_id,
                "sum": price_sum,
                "data_name": data_name.strip() if isinstance(data_name, str) else None,
                "data_name_sha256": (
                    hashlib.sha256(data_name.encode("utf-8")).hexdigest()
                    if isinstance(data_name, str)
                    else None
                ),
                "data_row_id": row_id,
                "row_id_exact": row_id_exact,
                "hidden_or_disabled": disabled,
                "class_tokens": class_tokens,
            }
        )

    def _record_page_metadata(
        self,
        tag: str,
        attributes: dict[str, str],
        duplicates: set[str],
    ) -> None:
        if tag == "link" and "canonical" in {
            item.casefold() for item in attributes.get("rel", "").split()
        }:
            if "href" in duplicates:
                self._error(self.structural_errors, "canonical_has_duplicate_href")
            href = self._bounded_attribute(
                attributes.get("href", ""),
                error_target=self.structural_errors,
                error_code="canonical_href_too_long",
            )
            if href is not None:
                if len(self.canonicals) >= 8:
                    self._error(self.structural_errors, "canonical_count_exceeded_limit")
                else:
                    self.canonicals.append(href)
        if tag == "meta" and attributes.get("name", "").casefold() == "robots":
            if "content" in duplicates:
                self._error(self.structural_errors, "robots_has_duplicate_content")
            content = self._bounded_attribute(
                attributes.get("content", ""),
                error_target=self.structural_errors,
                error_code="robots_content_too_long",
            )
            if content is not None:
                if len(self.robots) >= 8:
                    self._error(self.structural_errors, "robots_count_exceeded_limit")
                else:
                    self.robots.append(content)
        if (
            tag == "meta"
            and attributes.get("property", "").casefold() == "og:image"
        ):
            content = self._bounded_attribute(
                attributes.get("content", ""),
                error_target=self.structural_errors,
                error_code="og_image_url_too_long",
            )
            if content is not None:
                if len(self.og_images) >= 16:
                    self._error(self.structural_errors, "og_image_count_exceeded_limit")
                else:
                    self.og_images.append(content)

    def _record_image(
        self,
        tag: str,
        attributes: dict[str, str],
        class_tokens: list[str],
    ) -> None:
        if tag == "picture":
            self.picture_tag_count += 1
        if tag == "source":
            self.source_tag_count += 1
        if tag != "img":
            return
        if len(self.images) >= MAX_PUBLIC_IMAGES:
            self._error(self.structural_errors, "image_count_exceeded_limit")
            return
        source = attributes.get("src", "") or attributes.get("data-src", "")
        source = self._bounded_attribute(
            source,
            error_target=self.structural_errors,
            error_code="image_source_too_long",
        )
        alt = self._bounded_attribute(
            attributes.get("alt", ""),
            error_target=self.structural_errors,
            error_code="image_alt_too_long",
        )
        ancestor_tokens: set[str] = set(class_tokens)
        ancestor_ids: list[str] = []
        semantic_itemprop = attributes.get("itemprop", "").casefold() == "image"
        for node in self._stack:
            ancestor_tokens.update(node["classes"])
            if node["id"]:
                ancestor_ids.append(str(node["id"]))
            semantic_itemprop = semantic_itemprop or node["itemprop"] == "image"
        marker_text = " ".join(
            [
                source or "",
                alt or "",
                " ".join(class_tokens),
                " ".join(ancestor_ids),
            ]
        ).casefold()
        semantic_text = " ".join([*ancestor_tokens, *ancestor_ids]).casefold()
        semantic_product = semantic_itemprop or any(
            marker in semantic_text for marker in _PRODUCT_IMAGE_MARKERS
        )
        self.images.append(
            {
                "source": source,
                "source_sha256": (
                    hashlib.sha256(source.encode("utf-8")).hexdigest() if source else None
                ),
                "placeholder_marker": any(
                    marker in marker_text for marker in _PLACEHOLDER_MARKERS
                ),
                "semantic_product_image": semantic_product,
            }
        )

    def _start(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
        *,
        push: bool,
    ) -> None:
        self._node_count += 1
        if self._node_count > MAX_PUBLIC_HTML_NODES:
            raise RemoteAuditError("Public HTML node count exceeded the fixed limit")
        attributes, duplicates = self._attributes(attrs)
        for attribute_name in ("class", "id", "style", "itemprop"):
            attribute_value = attributes.get(attribute_name, "")
            if len(attribute_value.encode("utf-8")) > MAX_PUBLIC_ATTRIBUTE_BYTES:
                self._error(
                    self.structural_errors,
                    f"{attribute_name}_attribute_exceeded_limit",
                )
                attributes[attribute_name] = ""
        class_tokens = self._class_tokens(attributes)
        hidden = self._hidden(attributes, class_tokens)
        self._record_page_metadata(tag, attributes, duplicates)
        self._record_control(tag, attributes, duplicates, class_tokens, hidden)
        self._record_image(tag, attributes, class_tokens)
        if push and tag not in _VOID_HTML_TAGS:
            if len(self._stack) >= MAX_PUBLIC_HTML_DEPTH:
                raise RemoteAuditError("Public HTML depth exceeded the fixed limit")
            self._stack.append(
                {
                    "tag": tag,
                    "classes": class_tokens,
                    "id": attributes.get("id", "")[:128],
                    "itemprop": attributes.get("itemprop", "").casefold(),
                    "hidden": hidden,
                }
            )

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._start(tag.casefold(), attrs, push=True)

    def handle_startendtag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        self._start(tag.casefold(), attrs, push=False)

    def handle_endtag(self, tag: str) -> None:
        lowered = tag.casefold()
        for index in range(len(self._stack) - 1, -1, -1):
            if self._stack[index]["tag"] == lowered:
                del self._stack[index:]
                return

    def handle_data(self, data: str) -> None:
        if not self._stack or self._stack[-1]["tag"] != "title":
            return
        encoded = data.encode("utf-8")
        if self.title_bytes + len(encoded) > MAX_PUBLIC_TITLE_BYTES:
            self._error(self.structural_errors, "title_text_exceeded_limit")
            return
        self.title_parts.append(data)
        self.title_bytes += len(encoded)


def _decode_public_html(body: bytes, content_type: str) -> tuple[str, str]:
    match = re.search(r"charset\s*=\s*['\"]?([A-Za-z0-9._-]+)", content_type, re.I)
    charset = (match.group(1) if match else "utf-8").casefold()
    aliases = {
        "utf8": "utf-8",
        "utf-8": "utf-8",
        "windows-1251": "cp1251",
        "cp1251": "cp1251",
    }
    codec = aliases.get(charset)
    if codec is None:
        raise RemoteAuditError("Public HTML charset is outside the fixed allowlist")
    try:
        return body.decode(codec, errors="strict"), codec
    except UnicodeDecodeError as exc:
        raise RemoteAuditError("Public HTML decoding failed") from exc


def _image_structure(parser: PublicPageParser, page_url: str) -> dict[str, object]:
    images = []
    for item in parser.images:
        source = item.get("source")
        resolved = urljoin(page_url, source) if isinstance(source, str) and source else None
        images.append(
            {
                "resolved_source": resolved,
                "source_sha256": item.get("source_sha256"),
                "placeholder_marker": item.get("placeholder_marker"),
                "semantic_product_image": item.get("semantic_product_image"),
            }
        )
    product_images = [item for item in images if item["semantic_product_image"] is True]
    if not product_images:
        product_state = "no_semantic_product_image_markup"
    elif all(item["placeholder_marker"] is True for item in product_images):
        product_state = "placeholder_only_product_image_markup"
    elif any(item["placeholder_marker"] is True for item in product_images):
        product_state = "mixed_placeholder_and_nonplaceholder_product_image_markup"
    else:
        product_state = "nonplaceholder_product_image_markup"
    resolved_og = [urljoin(page_url, item) for item in parser.og_images]
    return {
        "img_tag_count": len(images),
        "picture_tag_count": parser.picture_tag_count,
        "source_tag_count": parser.source_tag_count,
        "semantic_product_image_count": len(product_images),
        "placeholder_product_image_count": sum(
            item["placeholder_marker"] is True for item in product_images
        ),
        "product_image_state": product_state,
        "resolved_source_sha256": _evidence_sha256(
            [item["resolved_source"] for item in images]
        ),
        "resolved_source_samples": [item["resolved_source"] for item in images[:16]],
        "og_image_count": len(resolved_og),
        "og_image_sha256": _evidence_sha256(resolved_og),
        "og_image_samples": resolved_og[:8],
        "structural_sha256": _evidence_sha256(images),
    }


def _parse_public_response(
    requested_url: str,
    fetched: object,
) -> tuple[dict[str, object], PublicPageParser | None]:
    if not isinstance(fetched, dict):
        return (
            {
                "requested_url": requested_url,
                "http_status": None,
                "final_url": None,
                "content_type": None,
                "body_bytes": 0,
                "body_sha256": None,
                "canonical_urls": [],
                "self_canonical": False,
                "robots": [],
                "robots_indexable": False,
                "title": None,
                "structural_errors": ["fetch_result_shape_is_invalid"],
                "base_contract_ok": False,
                "base_blockers": ["fetch_failed"],
            },
            None,
        )
    if "error" in fetched:
        return (
            {
                "requested_url": requested_url,
                "http_status": None,
                "final_url": None,
                "content_type": None,
                "body_bytes": 0,
                "body_sha256": None,
                "canonical_urls": [],
                "self_canonical": False,
                "robots": [],
                "robots_indexable": False,
                "title": None,
                "structural_errors": [],
                "fetch_error": str(fetched.get("error"))[:500],
                "base_contract_ok": False,
                "base_blockers": ["fetch_failed"],
            },
            None,
        )
    body = fetched.get("body")
    status = fetched.get("http_status")
    final_url = fetched.get("final_url")
    content_type = fetched.get("content_type")
    if not isinstance(body, bytes) or len(body) > MAX_PUBLIC_BODY_BYTES:
        return _parse_public_response(
            requested_url,
            {"error": "RemoteAuditError: Public body shape is invalid"},
        )
    evidence: dict[str, object] = {
        "requested_url": requested_url,
        "http_status": status if isinstance(status, int) else None,
        "final_url": final_url if isinstance(final_url, str) else None,
        "content_type": content_type if isinstance(content_type, str) else None,
        "body_bytes": len(body),
        "body_sha256": hashlib.sha256(body).hexdigest(),
        "canonical_urls": [],
        "self_canonical": False,
        "robots": [],
        "robots_indexable": False,
        "title": None,
        "structural_errors": [],
    }
    blockers: list[str] = []
    if status != 200:
        blockers.append("http_status_not_200")
    if final_url != requested_url:
        blockers.append("final_url_is_not_exact")
    if not isinstance(content_type, str) or not any(
        item in content_type.casefold() for item in ("text/html", "application/xhtml+xml")
    ):
        blockers.append("content_type_is_not_html")
    if not body:
        blockers.append("body_is_empty")
    parser: PublicPageParser | None = None
    try:
        page, charset = _decode_public_html(body, content_type if isinstance(content_type, str) else "")
        parser = PublicPageParser()
        parser.feed(page)
        parser.close()
        resolved_canonicals = [
            urljoin(requested_url, html_module.unescape(item))
            for item in parser.canonicals
        ]
        robots = [re.sub(r"\s+", " ", item).strip() for item in parser.robots]
        robot_tokens = {
            token
            for directive in robots
            for token in re.split(r"[,\s]+", directive.casefold())
            if token
        }
        title = re.sub(r"\s+", " ", "".join(parser.title_parts)).strip()
        evidence.update(
            {
                "charset": charset,
                "canonical_urls": resolved_canonicals,
                "self_canonical": resolved_canonicals == [requested_url],
                "robots": robots,
                "robots_indexable": "noindex" not in robot_tokens,
                "title": title,
                "title_sha256": hashlib.sha256(title.encode("utf-8")).hexdigest(),
                "structural_errors": parser.structural_errors,
                "image_structure": _image_structure(parser, requested_url),
            }
        )
        if resolved_canonicals != [requested_url]:
            blockers.append("self_canonical_is_not_exact")
        if "noindex" in robot_tokens:
            blockers.append("robots_noindex_present")
        if parser.structural_errors:
            blockers.append("html_structural_errors_present")
    except Exception as exc:
        evidence["parse_error"] = _safe_error(exc)
        blockers.append("html_parse_failed")
        parser = None
    evidence["base_blockers"] = blockers
    evidence["base_contract_ok"] = blockers == []
    return evidence, parser


def _tie_order_classification(ids: list[int], sorts_by_id: dict[int, int]) -> str:
    groups: list[list[int]] = []
    current: list[int] = []
    previous_sort: int | None = None
    for product_id in ids:
        current_sort = sorts_by_id[product_id]
        if previous_sort is None or current_sort == previous_sort:
            current.append(product_id)
        else:
            if len(current) > 1:
                groups.append(current)
            current = [product_id]
        previous_sort = current_sort
    if len(current) > 1:
        groups.append(current)
    if not groups:
        return "not_observable"
    if all(group == sorted(group) for group in groups):
        return "id_asc"
    if all(group == sorted(group, reverse=True) for group in groups):
        return "id_desc"
    return "mixed_or_unknown"


def _near_control_contract(
    near_controls: list[dict[str, object]],
    *,
    model_id: object,
    expected_option_ids: set[int],
) -> tuple[bool, list[str]]:
    blockers: list[str] = []
    if len(near_controls) != 1:
        blockers.append("near_control_count_is_not_exactly_one")
    parsed_ids = [
        item.get("product_id")
        for item in near_controls
        if isinstance(item.get("product_id"), int)
    ]
    if len(parsed_ids) != len(set(parsed_ids)):
        blockers.append("near_control_product_id_is_duplicated")
    for item in near_controls:
        product_id = item.get("product_id")
        if not isinstance(product_id, int) or not isinstance(item.get("sum"), int):
            blockers.append("near_control_id_or_sum_is_invalid")
        if product_id in expected_option_ids:
            blockers.append("near_control_contains_expected_option_id")
        if item.get("hidden_or_disabled") is True:
            blockers.append("near_control_is_hidden_or_disabled")
        if item.get("option_like") is True:
            blockers.append("near_control_is_option_like")
    if len(near_controls) == 1:
        item = near_controls[0]
        exact_base_shape = (
            isinstance(model_id, int)
            and item.get("product_id") == model_id
            and isinstance(item.get("sum"), int)
            and item["sum"] > 0
            and item.get("tag") == "div"
            and item.get("class_tokens") == ["main-product"]
            and item.get("attribute_names")
            == ["class", "data-product-id", "data-sum"]
            and item.get("hidden_or_disabled") is False
            and item.get("option_like") is False
            and item.get("onclick_present") is False
            and item.get("onclick_sha256") is None
            and isinstance(item.get("ancestor_depth"), int)
            and item["ancestor_depth"] > 0
            and re.fullmatch(
                r"[a-f0-9]{64}", str(item.get("ancestor_fingerprint"))
            )
            is not None
        )
        if not exact_base_shape:
            blockers.append("near_control_is_not_exact_pinned_base_product_shape")
    return blockers == [], list(dict.fromkeys(blockers))


def _analyze_public_model_page(
    code: str,
    requested_url: str,
    fetched: object,
    render_model: dict[str, object],
) -> dict[str, object]:
    evidence, parser = _parse_public_response(requested_url, fetched)
    page_blockers = list(evidence.get("base_blockers", []))
    controls = parser.strict_controls if parser is not None else []
    near_controls = parser.near_controls if parser is not None else []
    ordered_ids = [item.get("product_id") for item in controls]
    ordered_sums = [item.get("sum") for item in controls]
    evidence.update(
        {
            "model_code": code,
            "selector_contract": {
                "tag": "span",
                "required_classes": ["btn", "bg-theme-target"],
                "required_attributes": [
                    "data-product-id",
                    "data-sum",
                    "data-name",
                    "data-row-id",
                    "onclick",
                ],
                "onclick": "priceCalculator.toggleOption(this)",
            },
            "strict_control_count": len(controls),
            "near_control_count": len(near_controls),
            "near_controls": near_controls,
            "near_controls_sha256": _evidence_sha256(near_controls),
            "ordered_selectable_option_ids": ordered_ids,
            "ordered_selectable_option_sums": ordered_sums,
            "strict_controls": controls,
            "control_errors": parser.control_errors if parser else [],
        }
    )
    hypotheses = _require_dict(render_model.get("hypotheses"), "public render hypotheses")
    relation_items = _require_list(
        render_model.get("relation_items"), "public render relation items", MAX_PROPERTY_VALUES
    )
    expected_price_by_id: dict[int, int | float] = {}
    sorts_by_id: dict[int, int] = {}
    for raw_item in relation_items:
        item = _require_dict(raw_item, "public render relation item")
        item_id = item.get("id")
        sort = item.get("sort")
        contract = _require_dict(item.get("selectable_contract"), "public selectable contract")
        if isinstance(item_id, int) and isinstance(sort, int):
            sorts_by_id[item_id] = sort
            price = contract.get("positive_filter_price")
            if contract.get("eligible") is True and isinstance(price, (int, float)):
                expected_price_by_id[item_id] = price
    expected_set = render_model.get("expected_selectable_ids_as_set")
    expected_option_ids = (
        {item for item in expected_set if isinstance(item, int)}
        if isinstance(expected_set, list)
        else set()
    )
    near_control_ok, near_control_blockers = _near_control_contract(
        near_controls,
        model_id=render_model.get("model_id"),
        expected_option_ids=expected_option_ids,
    )
    ids_are_valid = all(isinstance(item, int) for item in ordered_ids)
    sums_are_valid = all(isinstance(item, int) for item in ordered_sums)
    typed_ids = [int(item) for item in ordered_ids if isinstance(item, int)]
    typed_sums = [int(item) for item in ordered_sums if isinstance(item, int)]
    duplicate_ids = sorted(
        {item for item in typed_ids if typed_ids.count(item) > 1}
    )
    exact_set = (
        ids_are_valid
        and not duplicate_ids
        and isinstance(expected_set, list)
        and sorted(typed_ids) == expected_set
        and len(typed_ids) == render_model.get("expected_selectable_count")
    )
    sum_mismatches = [
        {
            "id": product_id,
            "expected": expected_price_by_id.get(product_id),
            "observed": price_sum,
        }
        for product_id, price_sum in zip(typed_ids, typed_sums)
        if expected_price_by_id.get(product_id) != price_sum
    ]
    expected_name_by_id = {
        item["id"]: item.get("name")
        for item in relation_items
        if isinstance(item, dict) and isinstance(item.get("id"), int)
    }
    name_mismatches = [
        {
            "id": control.get("product_id"),
            "expected_sha256": hashlib.sha256(
                str(expected_name_by_id.get(control.get("product_id"), "")).encode("utf-8")
            ).hexdigest(),
            "observed_sha256": control.get("data_name_sha256"),
        }
        for control in controls
        if control.get("data_name")
        != expected_name_by_id.get(control.get("product_id"))
    ]
    matching_hypotheses = [
        source
        for source in render_model.get("hypotheses", {})
        if hypotheses.get(source) == typed_ids
    ] if ids_are_valid else []
    primary_sort_nondecreasing = bool(typed_ids) and all(
        typed_ids[index] in sorts_by_id
        and typed_ids[index + 1] in sorts_by_id
        and sorts_by_id[typed_ids[index]] <= sorts_by_id[typed_ids[index + 1]]
        for index in range(len(typed_ids) - 1)
    )
    tie_order = (
        _tie_order_classification(typed_ids, sorts_by_id)
        if primary_sort_nondecreasing
        else "not_classifiable"
    )
    if parser is None or parser.control_errors:
        page_blockers.append("strict_control_structure_is_invalid")
    if not near_control_ok:
        page_blockers.append("near_control_contract_is_not_exact")
    if not controls:
        page_blockers.append("strict_selectable_controls_are_absent")
    if duplicate_ids:
        page_blockers.append("strict_selectable_control_ids_are_duplicated")
    if not exact_set:
        page_blockers.append("public_selectable_set_differs_from_db_contract")
    if not sums_are_valid or sum_mismatches:
        page_blockers.append("public_selectable_sums_differ_from_db_contract")
    if name_mismatches:
        page_blockers.append("public_selectable_names_differ_from_db_contract")
    if not matching_hypotheses:
        page_blockers.append("public_order_matches_no_database_hypothesis")
    if not primary_sort_nondecreasing:
        page_blockers.append("public_order_is_not_nondecreasing_by_element_sort")
    page_blockers = list(dict.fromkeys(page_blockers))
    evidence.update(
        {
            "expected_selectable_count": render_model.get("expected_selectable_count"),
            "expected_selectable_ids_as_set": expected_set,
            "duplicate_selectable_option_ids": duplicate_ids,
            "exact_selectable_set": exact_set,
            "sum_mismatches": sum_mismatches,
            "name_mismatches": name_mismatches,
            "near_control_contract_ok": near_control_ok,
            "near_control_blockers": near_control_blockers,
            "matching_hypotheses": matching_hypotheses,
            "primary_sort_nondecreasing": primary_sort_nondecreasing,
            "tie_order_classification": tie_order,
            "page_blockers": page_blockers,
            "public_contract_ok": page_blockers == [],
        }
    )
    return evidence


def _analyze_no_content_baseline(
    sample: dict[str, object] | None,
    fetched: object | None,
) -> dict[str, object]:
    if sample is None:
        return {
            "database_sample": None,
            "policy_baseline_ok": False,
            "blockers": ["database_no_content_sample_is_absent"],
        }
    requested_url = str(sample.get("public_url"))
    evidence, _ = _parse_public_response(requested_url, fetched)
    blockers = list(evidence.get("base_blockers", []))
    image_structure = evidence.get("image_structure")
    product_image_state = (
        image_structure.get("product_image_state")
        if isinstance(image_structure, dict)
        else None
    )
    if product_image_state != "placeholder_only_product_image_markup":
        blockers.append("image_placeholder_structural_state_is_not_exact_safe_baseline")
    blockers = list(dict.fromkeys(blockers))
    return {
        "database_sample": {
            "id": sample.get("id"),
            "code": sample.get("code"),
            "public_url": sample.get("public_url"),
            "sort": _require_dict(sample.get("fields"), "baseline fields").get("sort"),
            "full_snapshot_sha256": sample.get("full_snapshot_sha256"),
            "database_no_picture_no_text": True,
        },
        "public_page": evidence,
        "image_placeholder_structural_state": (
            product_image_state
        ),
        "blockers": blockers,
        "policy_baseline_ok": blockers == [],
    }


def collect_public_evidence(
    remote: dict[str, object],
    *,
    fetch_fn: Callable[[str, frozenset[str]], dict[str, object]] = fetch_public_html,
) -> dict[str, object]:
    phase = _require_dict(remote.get("phase1b_evidence"), "phase1b evidence")
    render = _require_dict(phase.get("render_order"), "render order")
    render_models = _require_list(
        render.get("models"), "render-order models", len(MODEL_CODES)
    )
    if len(render_models) != len(MODEL_CODES):
        raise RemoteAuditError("Remote render model allowlist is incomplete")
    no_content = _require_dict(
        phase.get("active_no_picture_no_text_options"), "no-content options"
    )
    samples = _require_list(no_content.get("samples"), "no-content samples", 16)
    baseline_sample = (
        min(
            (_require_dict(item, "no-content sample") for item in samples),
            key=lambda item: (
                _require_dict(item.get("fields"), "no-content fields").get("sort"),
                item.get("id"),
            ),
        )
        if samples
        else None
    )
    requested_urls = list(PUBLIC_MODEL_URLS)
    if baseline_sample is not None:
        requested_urls.append(str(baseline_sample.get("public_url")))
    allowed_urls = frozenset(requested_urls)
    if len(allowed_urls) != len(requested_urls):
        raise RemoteAuditError("Public URL allowlist contains duplicates")
    for url in requested_urls:
        _validate_exact_public_url(url, allowed_urls)

    fetched_by_url: dict[str, object] = {}
    with ThreadPoolExecutor(max_workers=min(MAX_PUBLIC_WORKERS, len(requested_urls))) as pool:
        future_by_url = {
            pool.submit(fetch_fn, url, allowed_urls): url for url in requested_urls
        }
        for future in as_completed(future_by_url):
            url = future_by_url[future]
            try:
                fetched_by_url[url] = future.result()
            except Exception as exc:
                fetched_by_url[url] = {"error": _safe_error(exc)}

    pages: list[dict[str, object]] = []
    for code, url, render_item in zip(MODEL_CODES, PUBLIC_MODEL_URLS, render_models):
        pages.append(
            _analyze_public_model_page(
                code,
                url,
                fetched_by_url.get(url),
                _require_dict(render_item, "render-order model"),
            )
        )
    candidate_sources = _require_list(
        render.get("candidate_sources"), "render candidate sources", 8
    )
    matching_sources = [
        source
        for source in candidate_sources
        if all(
            page.get("public_contract_ok") is True
            and source in page.get("matching_hypotheses", [])
            for page in pages
        )
    ]
    render_order_source = matching_sources[0] if len(matching_sources) == 1 else None
    baseline = _analyze_no_content_baseline(
        baseline_sample,
        fetched_by_url.get(str(baseline_sample.get("public_url")))
        if baseline_sample is not None
        else None,
    )
    blockers = [
        blocker
        for blocker in _require_list(phase.get("blockers"), "phase1b blockers", 32)
        if blocker != "public_render_order_source_not_verified"
    ]
    blockers.extend(
        f"public_model_page_contract_failed:{page['model_code']}"
        for page in pages
        if page.get("public_contract_ok") is not True
    )
    if render_order_source is None:
        blockers.append("public_render_order_source_is_not_unique")
    if not all(page.get("primary_sort_nondecreasing") is True for page in pages):
        blockers.append("public_primary_sort_not_proven_on_all_12_models")
    if baseline.get("policy_baseline_ok") is not True:
        blockers.append("public_no_content_policy_baseline_failed")
    blockers = list(dict.fromkeys(blockers))
    phase1b_ready = blockers == [] and render_order_source is not None
    return {
        "status": "ok" if phase1b_ready else "blocked",
        "phase": "phase1b_public_render_order_and_no_content_policy",
        "read_only": True,
        "database_mutations": 0,
        "network_scope": {
            "scheme": "https",
            "host": DOMAIN,
            "exact_requested_urls": requested_urls,
            "request_count": len(requested_urls),
            "max_workers": MAX_PUBLIC_WORKERS,
            "max_body_bytes_per_url": MAX_PUBLIC_BODY_BYTES,
        },
        "model_pages": pages,
        "model_page_count": len(pages),
        "all_12_model_pages_contract_ok": all(
            page.get("public_contract_ok") is True for page in pages
        ),
        "matching_sources_across_all_12": matching_sources,
        "render_order_source": render_order_source,
        "primary_sort_proven_on_all_12": all(
            page.get("primary_sort_nondecreasing") is True for page in pages
        ),
        "tie_rule_classification": (
            "id_desc"
            if render_order_source == "element_sort_then_id_desc"
            else "id_asc"
            if render_order_source == "element_sort_then_id_asc"
            else "link_goods_order"
            if render_order_source == "link_goods_order"
            else None
        ),
        "target_sort": TARGET_SORT,
        "target_sort_unique_in_linked_union": render.get(
            "target_sort_is_unique_in_linked_union"
        ),
        "no_content_policy_baseline": baseline,
        "blockers": blockers,
        "phase1b_evidence_ready": phase1b_ready,
        "ready_for_apply": False,
    }


def run_audit(
    *,
    execute_fn: Callable[[str], dict[str, object]] = execute_remote,
    public_fn: Callable[[dict[str, object]], dict[str, object]] = collect_public_evidence,
    receipt_fn: Callable[..., Path] = write_receipt,
) -> tuple[dict[str, object], int]:
    remote = execute_fn("audit")
    public = public_fn(remote)
    receipt = receipt_fn(remote, public_evidence=public)
    relation = _require_dict(remote.get("relation_analysis"), "relation analysis")
    result = {
        "status": public.get("status", "blocked"),
        "mode": "audit",
        "phase": "phase1b_database_and_public_render_order",
        "database_mutations": 0,
        "apply_supported": False,
        "ready_for_apply": False,
        "phase1b_evidence_ready": public.get("phase1b_evidence_ready", False),
        "render_order_source": public.get("render_order_source"),
        "phase1b_blockers": public.get("blockers", []),
        "relation_unambiguous": relation.get("unambiguous", False),
        "strong_relation_candidates": relation.get("strong_candidate_count", 0),
        "receipt": str(receipt),
    }
    if result["status"] == "ok" and result["phase1b_evidence_ready"] is True:
        exit_code = 0
    elif result["status"] == "blocked":
        exit_code = 3
    else:
        exit_code = 1
    return result, exit_code


def main(argv: Sequence[str] | None = None) -> int:
    raw = list(sys.argv[1:] if argv is None else argv)
    try:
        parse_args(raw)
    except ForbiddenModeError as exc:
        print(
            json.dumps(
                {
                    "status": "blocked",
                    "mode": "forbidden",
                    "error": _safe_error(exc),
                    "network_attempted": False,
                    "database_mutations": 0,
                },
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        return 2
    try:
        result, exit_code = run_audit()
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return exit_code
    except Exception as exc:
        print(
            json.dumps(
                {
                    "status": "error",
                    "mode": "audit",
                    "error": _safe_error(exc),
                    "database_mutations": 0,
                    "secrets_exported": False,
                },
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
