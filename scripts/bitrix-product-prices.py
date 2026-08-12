#!/usr/bin/env python3
"""Audit or apply the nine Vitaliy-approved Bitrix catalog price changes."""

from __future__ import annotations

import argparse
import base64
import hashlib
import html as html_module
import json
import logging
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urljoin, urlparse
from urllib.request import Request, urlopen

import paramiko

logging.getLogger("paramiko").setLevel(logging.CRITICAL)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = PROJECT_ROOT / ".env"
PHP_SCRIPT = PROJECT_ROOT / "scripts" / "bitrix-product-prices.php"
REPORT_ROOT = PROJECT_ROOT / "marketing-audits" / "bitrix"

HOST = "ocelot.beget.com"
PORT = 22
EXPECTED_LOGIN = "berkutm4"
EXPECTED_HOST_KEY_SHA256 = "9NXXK7D+NukzmR6c/Ov2rAZElXlr2s1oP0QAAmUWs+c"
SITE_ROOT = "/home/b/berkutm4/rosomaha-rus.ru/public_html"
EXPECTED_PHP_SERIES = "8.2"
PHP_CANDIDATES = [
    "/usr/local/php/cgi/8.2/bin/php",
    "/usr/local/php/8.2/bin/php",
    "/usr/local/php82/bin/php",
    "/opt/php/8.2/bin/php",
    "/usr/bin/php8.2",
    "/usr/local/bin/php8.2",
    "php8.2",
    "php82",
]

CATALOG_URL = "https://rosomaha-rus.ru/product/kvadrotsikly/?display=price"
PRICE_CHANGES = [
    (755, 764, "standart-plus-1-5-litra", 1_300_000, 1_350_000),
    (898, 907, "rosomakha-standart-plyus-uaz-timken", 1_400_000, 1_450_000),
    (768, 812, "extrime-s-1-5l-dvs-1nz-fe", 1_800_000, 1_850_000),
    (879, 824, "extrime-1-5-litra-mosty-toyota", 2_050_000, 2_100_000),
    (769, 788, "extrime-plus-s-1-8l-dvs-1zz-fe", 2_150_000, 2_200_000),
    (770, 800, "hunter-s-1-5l-dvs-1nz-fe", 2_180_000, 2_230_000),
    (
        979,
        991,
        "snegobolotokhod-rosomakha-komplektatsiya-pikap-s-dvs-1nz-fe-1-5-litra-s-mostami-uaz-timken",
        1_800_000,
        1_850_000,
    ),
    (
        881,
        929,
        "snegobolotokhod-rosomakha-pikap-dvs-1-8-litra-uaz",
        2_250_000,
        2_300_000,
    ),
    (
        880,
        919,
        "snegobolotokhod-rosomakha-komplektatsiya-pikap-s-dvs-1zz-fe-1-8-litra-s-mostami-toyota",
        2_450_000,
        2_500_000,
    ),
]

RECOVERY_SETTLE_SECONDS = 165
RECOVERY_ATTEMPTS = 3
RECOVERY_RETRY_DELAY_SECONDS = 5
REMOTE_BACKUP_ROOT = (
    "/home/b/berkutm4/migration/rosomaha-rus/backups/bitrix-product-prices"
)


def deterministic_operation_id() -> str:
    """Return the stable identifier for this exact, pinned nine-price rollout."""
    material = {
        "version": 1,
        "domain": "rosomaha-rus.ru",
        "site_root": SITE_ROOT,
        "target": "iblock:86+64/PRICE+FILTER_PRICE",
        "changes": PRICE_CHANGES,
    }
    digest = hashlib.sha256(
        json.dumps(material, ensure_ascii=True, sort_keys=True).encode("utf-8")
    ).hexdigest()[:24]
    return f"bitrix-prices-{digest}"


def expected_backup_path(operation_id: str) -> str:
    validate_operation_id(operation_id)
    return f"{REMOTE_BACKUP_ROOT}/{operation_id}-prices.json"


def validate_operation_id(operation_id: str) -> str:
    if re.fullmatch(r"bitrix-prices-[a-f0-9]{24}", operation_id) is None:
        raise ValueError("Invalid pinned Bitrix price operation id")
    return operation_id


class RemoteCommandFailure(Exception):
    def __init__(
        self,
        message: str,
        *,
        stdout: str = "",
        stderr: str = "",
        command_dispatched: bool = False,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.stdout = stdout
        self.stderr = stderr
        self.command_dispatched = command_dispatched

    def __str__(self) -> str:
        return self.message


class RemoteOperationFailure(Exception):
    def __init__(
        self,
        message: str,
        *,
        mode: str,
        operation_id: str | None = None,
        stdout: str = "",
        stderr: str = "",
        partial_payload: dict[str, object] | None = None,
        command_dispatched: bool = False,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.mode = mode
        self.operation_id = operation_id
        self.stdout = stdout
        self.stderr = stderr
        self.partial_payload = partial_payload
        self.command_dispatched = command_dispatched

    @property
    def ambiguous_apply(self) -> bool:
        return self.mode == "apply" and self.command_dispatched

    def __str__(self) -> str:
        return self.message


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
        if fingerprint != EXPECTED_HOST_KEY_SHA256:
            raise paramiko.SSHException("Beget SSH host key mismatch")
        client.get_host_keys().add(hostname, key.get_name(), key)


def _unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        return value[1:-1]
    return value


def load_credentials() -> tuple[str, str]:
    login = os.environ.get("BEGET_LOGIN", "").strip()
    password = os.environ.get("BEGET_PASSWORD", "")
    if login and password:
        return login, password

    if not ENV_PATH.is_file():
        raise RuntimeError("Pinned project credential source is missing")

    text = ENV_PATH.read_text(encoding="utf-8-sig")
    standard_login = re.search(
        r"(?im)^\s*(?:export\s+)?BEGET_LOGIN\s*=\s*(.+?)\s*$",
        text,
    )
    standard_password = re.search(
        r"(?im)^\s*(?:export\s+)?BEGET_PASSWORD\s*=\s*(.+?)\s*$",
        text,
    )
    if standard_login and standard_password:
        return _unquote(standard_login.group(1)), _unquote(standard_password.group(1))

    legacy = re.search(
        r"https://cp\.beget\.com/\s+логин\s+(\S+)\s+пароль\s+(\S+)",
        text,
        flags=re.IGNORECASE,
    )
    if legacy is None:
        raise RuntimeError("Beget credentials were not found in the pinned source")
    return legacy.group(1), legacy.group(2)


def connect() -> paramiko.SSHClient:
    login, password = load_credentials()
    if login != EXPECTED_LOGIN:
        raise RuntimeError("Unexpected Beget account; refusing connection")

    last_error: Exception | None = None
    for attempt in range(3):
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(PinnedHostKeyPolicy())
        try:
            client.connect(
                HOST,
                port=PORT,
                username=login,
                password=password,
                timeout=20,
                banner_timeout=25,
                auth_timeout=20,
                look_for_keys=False,
                allow_agent=False,
            )
            transport = client.get_transport()
            if transport is None:
                raise RuntimeError("Beget SSH transport is unavailable")
            peer_key = transport.get_remote_server_key()
            peer_fingerprint = base64.b64encode(
                hashlib.sha256(peer_key.asbytes()).digest()
            ).decode("ascii").rstrip("=")
            if peer_fingerprint != EXPECTED_HOST_KEY_SHA256:
                raise RuntimeError("Beget SSH host key mismatch")
            return client
        except Exception as exc:
            last_error = exc
            client.close()
            if attempt < 2:
                time.sleep(5 * (attempt + 1))
    raise RuntimeError(
        f"Beget SSH unavailable after 3 attempts: {type(last_error).__name__}: {last_error}"
    )


def run_remote_command(
    client: paramiko.SSHClient,
    command: str,
    timeout_seconds: int,
    input_data: bytes | None = None,
    on_dispatched: Callable[[], None] | None = None,
) -> tuple[int, str, str]:
    output = bytearray()
    error = bytearray()
    dispatched = False

    try:
        # Mark the boundary before asking Paramiko to send the exec request.
        # An exception from exec_command itself cannot prove the server did not
        # receive the request, so apply must be recovered read-only.
        dispatched = True
        if on_dispatched is not None:
            on_dispatched()
        _, stdout, _ = client.exec_command(command, timeout=20)
        channel = stdout.channel
        if input_data is not None:
            channel.sendall(input_data)
            channel.shutdown_write()
        deadline = time.monotonic() + timeout_seconds

        while True:
            while channel.recv_ready():
                output.extend(channel.recv(65536))
            while channel.recv_stderr_ready():
                error.extend(channel.recv_stderr(65536))

            if channel.exit_status_ready():
                while channel.recv_ready():
                    output.extend(channel.recv(65536))
                while channel.recv_stderr_ready():
                    error.extend(channel.recv_stderr(65536))
                return (
                    channel.recv_exit_status(),
                    output.decode("utf-8", errors="replace").strip(),
                    error.decode("utf-8", errors="replace").strip(),
                )

            if time.monotonic() >= deadline:
                channel.close()
                raise RemoteCommandFailure(
                    f"Remote command exceeded {timeout_seconds} seconds",
                    stdout=output.decode("utf-8", errors="replace").strip(),
                    stderr=error.decode("utf-8", errors="replace").strip(),
                    command_dispatched=dispatched,
                )
            time.sleep(0.2)
    except RemoteCommandFailure:
        raise
    except Exception as exc:
        raise RemoteCommandFailure(
            f"Remote transport failed: {type(exc).__name__}: {exc}",
            stdout=output.decode("utf-8", errors="replace").strip(),
            stderr=error.decode("utf-8", errors="replace").strip(),
            command_dispatched=dispatched,
        ) from exc


def _last_json_object(output: str) -> dict[str, object] | None:
    for line in reversed(output.splitlines()):
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            return payload
    return None


def execute_remote(
    mode: str,
    operation_id: str | None = None,
    on_dispatched: Callable[[], None] | None = None,
) -> dict[str, object]:
    if mode not in {"audit", "apply"}:
        raise ValueError("mode must be audit or apply")
    if mode == "apply":
        operation_id = validate_operation_id(operation_id or "")
    elif operation_id is not None:
        raise ValueError("operation_id is valid only for apply")
    if not PHP_SCRIPT.is_file():
        raise RuntimeError("Pinned Bitrix price operation script is missing")

    try:
        client = connect()
    except Exception as exc:
        raise RemoteOperationFailure(
            f"Beget SSH connection failed: {type(exc).__name__}: {exc}",
            mode=mode,
            operation_id=operation_id,
            command_dispatched=False,
        ) from exc
    stage = "single-session-preflight-and-operation"
    captured_output = ""
    captured_error = ""

    try:
        script_bytes = PHP_SCRIPT.read_bytes()
        encoded_script = base64.b64encode(script_bytes).decode("ascii")
        expected_script_sha256 = hashlib.sha256(script_bytes).hexdigest()
        quoted_candidates = " ".join(f"'{item}'" for item in PHP_CANDIDATES)
        remote_args = f"'{mode}'"
        if mode == "apply":
            remote_args += f" '{operation_id}'"
        command = f"""
set -eu
script_payload='{encoded_script}'
decoded_script_with_marker="$(
  printf '%s' "$script_payload" | base64 -d
  printf '__ROSOMAHA_PAYLOAD_END__'
)"
case "$decoded_script_with_marker" in
  *__ROSOMAHA_PAYLOAD_END__) ;;
  *) printf 'Decoded helper marker is missing\n' >&2; exit 43 ;;
esac
decoded_script="${{decoded_script_with_marker%__ROSOMAHA_PAYLOAD_END__}}"
decoded_sha256="$(printf '%s' "$decoded_script" | sha256sum | awk '{{print $1}}')"
test "$decoded_sha256" = '{expected_script_sha256}'
test "$(realpath -- '{SITE_ROOT}')" = '{SITE_ROOT}'
test -f '{SITE_ROOT}/bitrix/header.php'
php_binary=''
php_version=''
for candidate in {quoted_candidates}; do
  resolved="$(command -v -- "$candidate" 2>/dev/null || true)"
  if [ -n "$resolved" ] && [ -x "$resolved" ]; then
    version="$("$resolved" -r 'echo PHP_VERSION;' 2>/dev/null || true)"
    case "$version" in
      {EXPECTED_PHP_SERIES}.*)
        php_binary="$resolved"
        php_version="$version"
        break
        ;;
    esac
  fi
done
if [ -z "$php_binary" ]; then
  printf 'PHP {EXPECTED_PHP_SERIES} CLI was not found\n' >&2
  exit 42
fi
printf '%s' "$decoded_script" | timeout 15s "$php_binary" -l >/dev/null
printf '__ROSOMAHA_PHP_VERSION__=%s\n' "$php_version"
printf '%s' "$decoded_script" | timeout 150s "$php_binary" \
  -d display_errors=stderr -d log_errors=0 -- {remote_args}
"""
        try:
            status, output, error = run_remote_command(
                client,
                command,
                190,
                on_dispatched=on_dispatched,
            )
        except RemoteCommandFailure as exc:
            partial_payload = _last_json_object(exc.stdout)
            raise RemoteOperationFailure(
                f"Beget stage {stage} failed: {exc}",
                mode=mode,
                operation_id=operation_id,
                stdout=exc.stdout,
                stderr=exc.stderr,
                partial_payload=partial_payload,
                command_dispatched=exc.command_dispatched,
            ) from exc
        captured_output = output
        captured_error = error
        if not output:
            raise RemoteOperationFailure(
                "Bitrix price helper returned no JSON",
                mode=mode,
                operation_id=operation_id,
                stdout=output,
                stderr=error,
                command_dispatched=True,
            )
        output_lines = output.splitlines()
        version_marker = "__ROSOMAHA_PHP_VERSION__="
        php_version = next(
            (
                line[len(version_marker):]
                for line in output_lines
                if line.startswith(version_marker)
            ),
            "",
        )
        try:
            payload = json.loads(output_lines[-1])
        except json.JSONDecodeError as exc:
            detail = (error or output)[-500:]
            raise RemoteOperationFailure(
                f"Bitrix price helper returned malformed JSON: {detail}",
                mode=mode,
                operation_id=operation_id,
                stdout=output,
                stderr=error,
                partial_payload=_last_json_object(output),
                command_dispatched=True,
            ) from exc
        if not isinstance(payload, dict):
            raise RemoteOperationFailure(
                "Bitrix price helper returned a non-object JSON payload",
                mode=mode,
                operation_id=operation_id,
                stdout=output,
                stderr=error,
                command_dispatched=True,
            )
        if not php_version.startswith(EXPECTED_PHP_SERIES + "."):
            raise RemoteOperationFailure(
                "Remote PHP version marker was missing or unexpected",
                mode=mode,
                operation_id=operation_id,
                stdout=output,
                stderr=error,
                partial_payload=payload,
                command_dispatched=True,
            )
        payload["runtime"] = {
            "php_version": php_version,
            "php_series_matches_live": php_version.startswith(EXPECTED_PHP_SERIES + "."),
        }
        payload["remote_exit_status"] = status
        return payload
    except RemoteOperationFailure:
        raise
    except Exception as exc:
        raise RemoteOperationFailure(
            f"Beget stage {stage} failed: {type(exc).__name__}: {exc}",
            mode=mode,
            operation_id=operation_id,
            stdout=captured_output,
            stderr=captured_error,
            partial_payload=_last_json_object(captured_output),
            command_dispatched=bool(captured_output or captured_error),
        ) from exc
    finally:
        client.close()


def formatted_price(amount: int) -> str:
    return f"от {amount:,}".replace(",", " ") + " #CURRENCY#"


def fetch_html(url: str, attempts: int = 3) -> tuple[int, str, str]:
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            request = Request(url, headers={"User-Agent": "RosomahaBitrixPriceAudit/1.0"})
            with urlopen(request, timeout=45) as response:
                return (
                    response.status,
                    response.geturl(),
                    response.read().decode("utf-8", errors="replace"),
                )
        except (HTTPError, URLError, TimeoutError, OSError, EOFError) as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"Public request failed for {url}: {last_error}")


def extract_data_item(page: str, offer_id: int) -> dict[str, object]:
    for match in re.finditer(r'data-item="([^"]+)"', page):
        decoded = html_module.unescape(match.group(1))
        try:
            payload = json.loads(decoded)
        except json.JSONDecodeError:
            continue
        if str(payload.get("ID")) == str(offer_id):
            return payload
    raise RuntimeError(f"Offer {offer_id} data-item payload was not found")


def _html_attributes(opening_tag: str) -> dict[str, str]:
    """Parse the small, fixed set of attributes used by the public SKU widget."""
    attributes: dict[str, str] = {}
    attribute_pattern = re.compile(
        r"([^\s=/>]+)(?:\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|([^\s>]+)))?"
    )
    for match in attribute_pattern.finditer(opening_tag):
        name = match.group(1).lower()
        if name in {"<div", "div"}:
            continue
        value = next((item for item in match.groups()[1:] if item is not None), "")
        attributes[name] = html_module.unescape(value)
    return attributes


def verify_sku_binding(page: str, product_id: int, offer_id: int) -> bool:
    """Require the selected offer to be bound to the pinned product and iblocks."""
    expected = {
        "data-item-id": str(product_id),
        "data-iblockid": "86",
        "data-offer-id": str(offer_id),
        "data-offer-iblockid": "64",
    }
    bindings: list[dict[str, str]] = []

    for match in re.finditer(r"<div\b[^>]*>", page, flags=re.IGNORECASE):
        attributes = _html_attributes(match.group(0))
        classes = set(attributes.get("class", "").split())
        if "sku-props" not in classes:
            continue
        if attributes.get("data-offer-id") == str(offer_id):
            bindings.append(attributes)

    # Duplicate renderings are allowed only when every binding for the selected
    # offer independently proves the same product/offer/iblock relationship.
    return bool(bindings) and all(
        all(binding.get(name) == value for name, value in expected.items())
        for binding in bindings
    )


def verify_detail(
    product_id: int,
    offer_id: int,
    slug: str,
    expected_price: int,
) -> dict[str, object]:
    url = f"https://rosomaha-rus.ru/product/{slug}/?oid={offer_id}"
    status, final_url, page = fetch_html(url)
    canonical = re.search(r'<link\s+rel="canonical"\s+href="([^"]+)"', page)
    prices = {int(value) for value in re.findall(r'<meta\s+itemprop="price"\s+content="(\d+)"', page)}
    currency_ok = bool(
        re.search(r'<meta\s+itemprop="priceCurrency"\s+content="RUB"', page)
    )
    sku_ok = bool(
        re.search(
            rf'<meta\s+itemprop="sku"\s+content="{product_id}"\s*/?>',
            page,
        )
    )
    link_ok = bool(
        re.search(
            rf'<link\s+itemprop="url"\s+href="/product/{re.escape(slug)}/\?oid={offer_id}"\s*/?>',
            page,
        )
    )
    sku_props_ok = verify_sku_binding(page, product_id, offer_id)
    data_item = extract_data_item(page, offer_id)
    expected_path = f"/product/{slug}/?oid={offer_id}"
    expected_formatted = formatted_price(expected_price)
    data_item_ok = (
        str(data_item.get("IBLOCK_ID")) == "64"
        and str(data_item.get("ID")) == str(offer_id)
        and str(data_item.get("DETAIL_PAGE_URL")) == expected_path
        and str(data_item.get("PROPERTY_FILTER_PRICE_VALUE")) == str(expected_price)
        and str(data_item.get("PROPERTY_PRICE_VALUE")) == expected_formatted
    )
    canonical_value = html_module.unescape(canonical.group(1)) if canonical else ""
    canonical_url = urljoin(url, canonical_value) if canonical_value else ""
    canonical_parts = urlparse(canonical_url)
    canonical_oid = parse_qs(canonical_parts.query).get("oid", [])
    canonical_ok = (
        canonical_parts.scheme == "https"
        and canonical_parts.netloc == "rosomaha-rus.ru"
        and canonical_parts.path.rstrip("/") == f"/product/{slug}"
        and (not canonical_oid or canonical_oid == [str(offer_id)])
    )
    final_parts = urlparse(final_url)
    final_ok = (
        final_parts.scheme == "https"
        and final_parts.netloc == "rosomaha-rus.ru"
        and final_parts.path.rstrip("/") == f"/product/{slug}"
        and parse_qs(final_parts.query).get("oid") == [str(offer_id)]
    )
    ok = (
        status == 200
        and final_ok
        and canonical_ok
        and prices == {expected_price}
        and currency_ok
        and sku_ok
        and link_ok
        and sku_props_ok
        and data_item_ok
    )
    return {
        "url": url,
        "final_url": final_url,
        "http_status": status,
        "canonical": canonical_value,
        "canonical_ok": canonical_ok,
        "expected_price": expected_price,
        "observed_prices": sorted(prices),
        "currency_rub": currency_ok,
        "product_sku": sku_ok,
        "offer_link": link_ok,
        "sku_binding": sku_props_ok,
        "data_item": {
            "iblock_id": data_item.get("IBLOCK_ID"),
            "offer_id": data_item.get("ID"),
            "detail_page_url": data_item.get("DETAIL_PAGE_URL"),
            "filter_price": data_item.get("PROPERTY_FILTER_PRICE_VALUE"),
            "price": data_item.get("PROPERTY_PRICE_VALUE"),
        },
        "ok": ok,
    }


def verify_catalog(expected_prices: dict[str, tuple[int, int]]) -> dict[str, object]:
    status, final_url, page = fetch_html(CATALOG_URL)
    starts = list(re.finditer(r'<meta\s+itemprop="name"\s+content="[^"]+">', page))
    observed: dict[str, list[dict[str, object]]] = {}
    for index, match in enumerate(starts):
        end = starts[index + 1].start() if index + 1 < len(starts) else len(page)
        block = page[match.start():end]
        link = re.search(
            r'<link\s+itemprop="url"\s+href="/product/([^/?"]+)/\?oid=(\d+)"',
            block,
        )
        price = re.search(r'<meta\s+itemprop="price"\s+content="(\d+)"', block)
        currency = re.search(
            r'<meta\s+itemprop="priceCurrency"\s+content="([^"]+)"',
            block,
        )
        if link and price:
            observed.setdefault(link.group(1), []).append(
                {
                    "offer_id": int(link.group(2)),
                    "price": int(price.group(1)),
                    "currency": currency.group(1) if currency else "",
                }
            )

    failures = []
    for slug, (offer_id, expected_price) in expected_prices.items():
        items = observed.get(slug, [])
        expected = {"offer_id": offer_id, "price": expected_price, "currency": "RUB"}
        if items != [expected]:
            failures.append({"slug": slug, "expected": expected, "observed": items})
    return {
        "url": CATALOG_URL,
        "final_url": final_url,
        "http_status": status,
        "card_count": len(observed),
        "target_count": len(expected_prices),
        "failures": failures,
        "ok": status == 200 and final_url == CATALOG_URL and not failures,
    }


def expected_prices_from_remote(remote: dict[str, object]) -> dict[int, int]:
    classification = remote.get("classification")
    if classification not in {"all_old", "all_new"}:
        raise RuntimeError(
            "Public price verification requires an all_old or all_new database state"
        )
    rows = remote.get("database_readback")
    if not isinstance(rows, list):
        raise RuntimeError("Remote database readback is missing")
    prices: dict[int, int] = {}
    for row in rows:
        if not isinstance(row, dict):
            raise RuntimeError("Remote database readback contains an invalid row")
        prices[int(row["product_id"])] = int(row["effective_price"])
    if set(prices) != {item[0] for item in PRICE_CHANGES}:
        raise RuntimeError("Remote database readback does not contain the pinned product set")
    return prices


def verify_public(remote: dict[str, object]) -> dict[str, object]:
    expected_by_product = expected_prices_from_remote(remote)
    details = []
    catalog_expected = {}
    for product_id, offer_id, slug, _, _ in PRICE_CHANGES:
        expected_price = expected_by_product[product_id]
        details.append(verify_detail(product_id, offer_id, slug, expected_price))
        catalog_expected[slug] = (offer_id, expected_price)
    catalog = verify_catalog(catalog_expected)
    return {
        "details": details,
        "catalog": catalog,
        "ok": all(item["ok"] for item in details) and catalog["ok"],
    }


def unavailable_public(reason: str) -> dict[str, object]:
    return {
        "status": "unavailable",
        "reason": reason,
        "details": [],
        "catalog": None,
        "ok": False,
    }


def _utc_iso(epoch: float | None = None) -> str:
    value = datetime.now(timezone.utc) if epoch is None else datetime.fromtimestamp(
        epoch, timezone.utc
    )
    return value.isoformat()


def _safe_error(error: BaseException) -> str:
    message = str(error) or type(error).__name__
    message = message.replace(EXPECTED_LOGIN, "[pinned-account]")
    return message[:1000]


def backup_marker_evidence(stderr: str, operation_id: str) -> dict[str, object]:
    marker = re.search(
        rf"(?:^|\n)STAGE:backup-written:{re.escape(operation_id)}:([a-f0-9]{{64}})(?:\n|$)",
        stderr,
    )
    return {
        "backup_marker_observed": marker is not None,
        "backup_sha256_observed": marker.group(1) if marker else None,
        "expected_backup_path": expected_backup_path(operation_id),
    }


def sanitize_remote(remote: dict[str, object] | None) -> dict[str, object] | None:
    """Keep receipts useful while excluding Bitrix names, users and raw transport."""
    if remote is None:
        return None
    allowed = {
        "status",
        "mode",
        "operation_id",
        "classification",
        "idempotent_noop",
        "database_mutations",
        "database_mutations_before_rollback",
        "property_values_changed",
        "planned_element_mutations",
        "updated_ids",
        "backup_path",
        "backup_sha256",
        "backup_permissions",
        "backup_reused",
        "remote_exit_status",
    }
    safe = {key: remote[key] for key in allowed if key in remote}
    rows = remote.get("database_readback")
    if isinstance(rows, list):
        safe["database_readback"] = [
            {
                key: row.get(key)
                for key in (
                    "product_id",
                    "offer_id",
                    "slug",
                    "old_price",
                    "new_price",
                    "state",
                    "effective_price",
                    "snapshot_sha256",
                )
            }
            for row in rows
            if isinstance(row, dict)
        ]
    runtime = remote.get("runtime")
    if isinstance(runtime, dict):
        safe["runtime"] = {
            key: runtime.get(key)
            for key in ("php_version", "php_series_matches_live")
            if key in runtime
        }
    rollback = remote.get("rollback")
    if isinstance(rollback, dict):
        safe["rollback"] = {
            "status": rollback.get("status"),
            "result_count": len(rollback.get("results", []))
            if isinstance(rollback.get("results"), list)
            else 0,
            "error_count": len(rollback.get("errors", []))
            if isinstance(rollback.get("errors"), list)
            else 0,
        }
    if "error" in remote:
        safe["error"] = str(remote["error"])[:1000]
    return safe


def _atomic_json(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, path)


def pending_receipt_path(operation_id: str) -> Path:
    validate_operation_id(operation_id)
    return REPORT_ROOT / f"ROSOMAHA_BITRIX_PRODUCT_PRICES_{operation_id}_PENDING.json"


def read_pending(operation_id: str) -> dict[str, object] | None:
    path = pending_receipt_path(operation_id)
    if not path.is_file():
        return None
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or payload.get("operation_id") != operation_id:
        raise RuntimeError("Pending receipt does not match the requested operation")
    return payload


def update_pending(
    operation_id: str,
    state: str,
    **fields: object,
) -> Path:
    path = pending_receipt_path(operation_id)
    current = read_pending(operation_id) or {
        "created_at_utc": _utc_iso(),
        "domain": "rosomaha-rus.ru",
        "operation_id": operation_id,
        "target": "iblock:86+64/PRICE+FILTER_PRICE",
        "expected_backup_path": expected_backup_path(operation_id),
        "secrets_exported": False,
        "pii_exported": False,
    }
    current.update(fields)
    current["state"] = state
    current["updated_at_utc"] = _utc_iso()
    _atomic_json(path, current)
    return path


def write_receipt(
    mode: str,
    outcome: str,
    remote: dict[str, object] | None,
    public: dict[str, object] | None,
    operation_id: str | None = None,
    error: str | None = None,
) -> Path:
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%fZ")
    suffix = mode.upper()
    path = REPORT_ROOT / f"ROSOMAHA_BITRIX_PRODUCT_PRICES_{stamp}_{suffix}.json"
    receipt: dict[str, object] = {
        "generated_at_utc": _utc_iso(),
        "domain": "rosomaha-rus.ru",
        "mode": mode,
        "outcome": outcome,
        "operation_id": operation_id,
        "account_scope_pinned": True,
        "target": "iblock:86+64/PRICE+FILTER_PRICE",
        "remote": sanitize_remote(remote),
        "public_verification": public,
        "secrets_exported": False,
        "pii_exported": False,
    }
    if error:
        receipt["error"] = error[:1000]
    _atomic_json(path, receipt)
    return path


def verify_public_safely(remote: dict[str, object]) -> dict[str, object]:
    try:
        return verify_public(remote)
    except Exception as exc:
        return unavailable_public(_safe_error(exc))


def recovery_outcome(
    remote: dict[str, object],
    public: dict[str, object] | None,
) -> str:
    classification = remote.get("classification")
    if classification == "transition_mixed":
        return "needs_rollback"
    if classification == "drift":
        return "blocked"
    if classification == "all_old":
        return "recovered_noop" if public and public.get("ok") is True else "indeterminate"
    if classification == "all_new":
        return "recovered_success" if public and public.get("ok") is True else "indeterminate"
    return "indeterminate"


def recover_operation(
    operation_id: str,
    *,
    time_fn: Callable[[], float] = time.time,
    sleep_fn: Callable[[float], None] = time.sleep,
    execute_fn: Callable[..., dict[str, object]] = execute_remote,
    verify_fn: Callable[[dict[str, object]], dict[str, object]] = verify_public_safely,
) -> tuple[dict[str, object], int]:
    operation_id = validate_operation_id(operation_id)
    if operation_id != deterministic_operation_id():
        raise RuntimeError("Recovery operation id does not match this pinned rollout")
    pending = read_pending(operation_id)
    if pending is None:
        raise RuntimeError("Pending receipt for this operation was not found")

    not_before = float(pending.get("recovery_not_before_epoch") or 0)
    now = time_fn()
    if now < not_before:
        result = {
            "status": "settling",
            "operation_id": operation_id,
            "retry_after_seconds": max(1, int(not_before - now + 0.999)),
            "pending_receipt": str(pending_receipt_path(operation_id)),
            "no_apply_retry": True,
        }
        update_pending(operation_id, "settling")
        return result, 1

    last_error = ""
    last_remote: dict[str, object] | None = None
    last_public: dict[str, object] | None = None
    for attempt in range(1, RECOVERY_ATTEMPTS + 1):
        try:
            remote = execute_fn("audit")
            last_remote = remote
            if remote.get("status") != "ok":
                last_error = str(remote.get("error") or "Read-only audit did not succeed")
            else:
                classification = remote.get("classification")
                public = (
                    verify_fn(remote)
                    if classification in {"all_old", "all_new"}
                    else unavailable_public(
                        "Public expected price is unsafe to infer from a mixed or drift database state"
                    )
                )
                last_public = public
                outcome = recovery_outcome(remote, public)
                if outcome in {
                    "recovered_success",
                    "recovered_noop",
                    "needs_rollback",
                    "blocked",
                }:
                    receipt = write_receipt(
                        "recovery",
                        outcome,
                        remote,
                        public,
                        operation_id,
                    )
                    update_pending(
                        operation_id,
                        outcome,
                        recovery_attempts=attempt,
                        final_receipt=str(receipt),
                        remote=sanitize_remote(remote),
                        public_verification=public,
                        no_apply_retry=True,
                    )
                    result = {
                        "status": outcome,
                        "operation_id": operation_id,
                        "classification": classification,
                        "database_mutations": 0,
                        "public_verification": public,
                        "receipt": str(receipt),
                        "pending_receipt": str(pending_receipt_path(operation_id)),
                        "no_apply_retry": True,
                        "automatic_rollback": False,
                    }
                    return result, 0 if outcome == "recovered_success" else 1
                last_error = "Database and public evidence did not agree"
        except Exception as exc:
            last_error = _safe_error(exc)

        if attempt < RECOVERY_ATTEMPTS:
            sleep_fn(RECOVERY_RETRY_DELAY_SECONDS)

    receipt = write_receipt(
        "recovery",
        "indeterminate",
        last_remote,
        last_public,
        operation_id,
        last_error,
    )
    update_pending(
        operation_id,
        "indeterminate",
        recovery_attempts=RECOVERY_ATTEMPTS,
        final_receipt=str(receipt),
        remote=sanitize_remote(last_remote),
        public_verification=last_public,
        error=last_error,
        no_apply_retry=True,
    )
    return {
        "status": "indeterminate",
        "operation_id": operation_id,
        "error": last_error,
        "receipt": str(receipt),
        "pending_receipt": str(pending_receipt_path(operation_id)),
        "no_apply_retry": True,
        "automatic_rollback": False,
    }, 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Audit or apply the nine pinned Rosomaha Bitrix price changes."
    )
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument(
        "--apply",
        action="store_true",
        help="Perform the guarded update. Without this flag the command is read-only.",
    )
    modes.add_argument(
        "--recover",
        metavar="OPERATION_ID",
        help="Recover an ambiguous apply using fresh read-only audits only.",
    )
    return parser.parse_args()


def run_audit() -> tuple[dict[str, object], int]:
    remote = execute_remote("audit")
    classification = remote.get("classification")
    public = (
        verify_public_safely(remote)
        if remote.get("status") == "ok" and classification in {"all_old", "all_new"}
        else unavailable_public(
            "Public expected price is unsafe to infer from a mixed, drift, or failed database audit"
        )
    )
    outcome = (
        "ok"
        if remote.get("status") == "ok" and public.get("ok") is True
        else "blocked"
        if classification in {"transition_mixed", "drift"}
        else "verification_failed"
    )
    receipt = write_receipt("audit", outcome, remote, public)
    result = {
        "status": outcome,
        "mode": "audit",
        "classification": classification,
        "database_mutations": 0,
        "public_verification": public,
        "receipt": str(receipt),
        "secrets_exported": False,
        "pii_exported": False,
    }
    return result, 0 if outcome == "ok" else 1


def run_apply(
    *,
    time_fn: Callable[[], float] = time.time,
    execute_fn: Callable[..., dict[str, object]] = execute_remote,
    verify_fn: Callable[[dict[str, object]], dict[str, object]] = verify_public_safely,
) -> tuple[dict[str, object], int]:
    operation_id = deterministic_operation_id()
    existing = read_pending(operation_id)
    unresolved = {
        "prepared",
        "remote_dispatched",
        "ambiguous_apply",
        "settling",
        "indeterminate",
        "needs_rollback",
    }
    if existing and existing.get("state") in unresolved:
        result = {
            "status": "blocked_pending_recovery",
            "operation_id": operation_id,
            "pending_state": existing.get("state"),
            "pending_receipt": str(pending_receipt_path(operation_id)),
            "recovery_command": (
                f"python scripts/bitrix-product-prices.py --recover {operation_id}"
            ),
            "no_apply_retry": True,
        }
        return result, 1

    prepared_at = time_fn()
    update_pending(
        operation_id,
        "prepared",
        prepared_at_utc=_utc_iso(prepared_at),
        prepared_at_epoch=prepared_at,
        remote_command_dispatched=False,
        no_apply_retry=True,
    )
    dispatched_at: float | None = None

    def mark_dispatched() -> None:
        nonlocal dispatched_at
        dispatched_at = time_fn()
        update_pending(
            operation_id,
            "remote_dispatched",
            remote_command_dispatched=True,
            remote_dispatched_at_utc=_utc_iso(dispatched_at),
            remote_dispatched_at_epoch=dispatched_at,
            recovery_not_before_utc=_utc_iso(
                dispatched_at + RECOVERY_SETTLE_SECONDS
            ),
            recovery_not_before_epoch=dispatched_at + RECOVERY_SETTLE_SECONDS,
            no_apply_retry=True,
        )

    try:
        remote = execute_fn(
            "apply",
            operation_id=operation_id,
            on_dispatched=mark_dispatched,
        )
    except RemoteOperationFailure as exc:
        if not exc.ambiguous_apply:
            receipt = write_receipt(
                "apply",
                "not_started",
                exc.partial_payload,
                None,
                operation_id,
                _safe_error(exc),
            )
            update_pending(
                operation_id,
                "not_started",
                remote_command_dispatched=False,
                final_receipt=str(receipt),
                error=_safe_error(exc),
                no_apply_retry=True,
            )
            return {
                "status": "not_started",
                "operation_id": operation_id,
                "error": _safe_error(exc),
                "receipt": str(receipt),
                "pending_receipt": str(pending_receipt_path(operation_id)),
                "database_mutations": 0,
                "no_apply_retry": True,
            }, 1

        effective_dispatched_at = dispatched_at or prepared_at
        not_before = effective_dispatched_at + RECOVERY_SETTLE_SECONDS
        marker_evidence = backup_marker_evidence(exc.stderr, operation_id)
        update_pending(
            operation_id,
            "ambiguous_apply",
            remote_command_dispatched=True,
            remote_dispatched_at_utc=_utc_iso(effective_dispatched_at),
            remote_dispatched_at_epoch=effective_dispatched_at,
            recovery_not_before_utc=_utc_iso(not_before),
            recovery_not_before_epoch=not_before,
            partial_remote=sanitize_remote(exc.partial_payload),
            **marker_evidence,
            error=_safe_error(exc),
            no_apply_retry=True,
        )
        if time_fn() >= not_before:
            return recover_operation(
                operation_id,
                time_fn=time_fn,
                execute_fn=execute_fn,
                verify_fn=verify_fn,
            )
        return {
            "status": "ambiguous_apply",
            "operation_id": operation_id,
            "error": _safe_error(exc),
            "pending_receipt": str(pending_receipt_path(operation_id)),
            "recovery_not_before_utc": _utc_iso(not_before),
            "recovery_command": (
                f"python scripts/bitrix-product-prices.py --recover {operation_id}"
            ),
            **marker_evidence,
            "no_apply_retry": True,
            "automatic_rollback": False,
        }, 1

    classification = remote.get("classification")
    if remote.get("status") == "ok" and classification in {"all_old", "all_new"}:
        public = verify_fn(remote)
    else:
        public = unavailable_public(
            "Public expected price is unsafe to infer from a mixed, drift, or failed apply"
        )

    if remote.get("status") == "ok" and classification == "all_new" and public.get("ok") is True:
        outcome = "success"
    elif classification == "transition_mixed":
        outcome = "needs_rollback"
    elif classification == "drift":
        outcome = "blocked"
    elif remote.get("status") == "ok" and classification == "all_old":
        outcome = "noop_old"
    else:
        outcome = "verification_failed"

    receipt = write_receipt("apply", outcome, remote, public, operation_id)
    update_pending(
        operation_id,
        "completed" if outcome == "success" else outcome,
        final_receipt=str(receipt),
        remote=sanitize_remote(remote),
        public_verification=public,
        no_apply_retry=True,
    )
    result = {
        "status": outcome,
        "mode": "apply",
        "operation_id": operation_id,
        "classification": classification,
        "database_mutations": remote.get("database_mutations", 0),
        "updated_ids": remote.get("updated_ids", []),
        "backup_path": remote.get("backup_path"),
        "public_verification": public,
        "receipt": str(receipt),
        "pending_receipt": str(pending_receipt_path(operation_id)),
        "no_apply_retry": True,
        "automatic_rollback": False,
        "secrets_exported": False,
        "pii_exported": False,
    }
    return result, 0 if outcome == "success" else 1


def main() -> int:
    args = parse_args()
    try:
        if args.recover:
            result, exit_code = recover_operation(args.recover)
        elif args.apply:
            result, exit_code = run_apply()
        else:
            result, exit_code = run_audit()
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return exit_code
    except Exception as exc:
        mode = "recovery" if args.recover else "apply" if args.apply else "audit"
        print(
            json.dumps(
                {
                    "status": "error",
                    "mode": mode,
                    "error": _safe_error(exc),
                    "secrets_exported": False,
                    "pii_exported": False,
                },
                ensure_ascii=False,
                indent=2,
            ),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
