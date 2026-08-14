#!/usr/bin/env python3
"""Read-only phase-1 audit for a future Bitrix fan-button option.

The helper is deliberately incapable of applying or recovering changes.  It
streams the pinned PHP reader to the pinned Beget account, validates the
returned schema, and writes one immutable, ignored JSON receipt.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import logging
import os
import re
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Mapping, Sequence

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

MAX_PHP_BYTES = 256_000
MAX_STDOUT_BYTES = 2_000_000
MAX_STDERR_BYTES = 32_000
MAX_REMOTE_SECONDS = 150
MAX_JSON_BYTES = 1_900_000
MAX_PROPERTIES = 192
MAX_ENUMS_PER_PROPERTY = 128
MAX_PROPERTY_VALUES = 128
MAX_SECTION_SIBLINGS = 256

FORBIDDEN_MODE_PREFIXES = ("--apply", "--recover")
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
            while channel.recv_ready():
                output.extend(channel.recv(65536))
                if len(output) > MAX_STDOUT_BYTES:
                    channel.close()
                    raise RemoteAuditError("Remote stdout exceeded the fixed limit")
            while channel.recv_stderr_ready():
                error.extend(channel.recv_stderr(16384))
                if len(error) > MAX_STDERR_BYTES:
                    channel.close()
                    raise RemoteAuditError("Remote stderr exceeded the fixed limit")
            if channel.exit_status_ready():
                while channel.recv_ready():
                    output.extend(channel.recv(65536))
                    if len(output) > MAX_STDOUT_BYTES:
                        channel.close()
                        raise RemoteAuditError("Remote stdout exceeded the fixed limit")
                while channel.recv_stderr_ready():
                    error.extend(channel.recv_stderr(16384))
                    if len(error) > MAX_STDERR_BYTES:
                        channel.close()
                        raise RemoteAuditError("Remote stderr exceeded the fixed limit")
                return (
                    channel.recv_exit_status(),
                    output.decode("utf-8", errors="strict").strip(),
                    error.decode("utf-8", errors="replace").strip(),
                )
            if time.monotonic() >= deadline:
                channel.close()
                raise RemoteAuditError("Remote read-only audit timed out")
            time.sleep(0.1)
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
    ready = remote.get("ready_for_apply")
    if not isinstance(ready, bool):
        raise RemoteAuditError("Remote readiness flag is invalid")
    expected_ready = (
        unambiguous
        and single_element_expected
        and price_unambiguous
        and not duplicate_union
        and sort_unambiguous
        and not expected_blockers
    )
    if ready is not expected_ready:
        raise RemoteAuditError("Remote readiness is not the exact gate conjunction")

    # A JSON round trip removes custom mapping subclasses and keeps only data.
    return json.loads(json.dumps(remote, ensure_ascii=False))


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
    lines = stdout.splitlines()
    markers: dict[str, str] = {}
    for line in lines[:-1]:
        if line.startswith("__ROSOMAHA_FAN_") and "=" in line:
            key, value = line.split("=", 1)
            markers[key] = value
    if markers.get("__ROSOMAHA_FAN_PHP_LINT__") != "ok":
        raise RemoteAuditError("Remote PHP lint marker is missing")
    if markers.get("__ROSOMAHA_FAN_PHP_SHA256__") != digest:
        raise RemoteAuditError("Remote PHP byte digest does not match")
    php_version = markers.get("__ROSOMAHA_FAN_PHP_VERSION__", "")
    if not php_version.startswith(EXPECTED_PHP_SERIES + "."):
        raise RemoteAuditError("Remote PHP version is outside the pinned series")
    if status != 0 or not lines:
        raise RemoteAuditError("Remote read-only helper failed")
    try:
        parsed = json.loads(lines[-1])
    except json.JSONDecodeError as exc:
        raise RemoteAuditError("Remote helper returned malformed JSON") from exc
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


def write_receipt(remote: dict[str, object], *, path: Path | None = None) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%fZ")
    destination = path or (
        REPORT_ROOT / f"ROSOMAHA_BITRIX_FAN_BUTTON_{stamp}_AUDIT.json"
    )
    receipt = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "domain": DOMAIN,
        "mode": "audit",
        "phase": "schema_and_relation_discovery",
        "read_only": True,
        "secrets_exported": False,
        "pii_exported": False,
        "remote": remote,
    }
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


def run_audit(
    *,
    execute_fn: Callable[[str], dict[str, object]] = execute_remote,
    receipt_fn: Callable[[dict[str, object]], Path] = write_receipt,
) -> tuple[dict[str, object], int]:
    remote = execute_fn("audit")
    receipt = receipt_fn(remote)
    relation = _require_dict(remote.get("relation_analysis"), "relation analysis")
    result = {
        "status": "ok",
        "mode": "audit",
        "phase": "schema_and_relation_discovery",
        "database_mutations": 0,
        "apply_supported": False,
        "ready_for_apply": remote.get("ready_for_apply", False),
        "relation_unambiguous": relation.get("unambiguous", False),
        "strong_relation_candidates": relation.get("strong_candidate_count", 0),
        "receipt": str(receipt),
    }
    return result, 0


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
