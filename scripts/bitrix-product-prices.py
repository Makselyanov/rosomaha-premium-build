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
) -> tuple[int, str, str]:
    _, stdout, _ = client.exec_command(command, timeout=20)
    channel = stdout.channel
    if input_data is not None:
        channel.sendall(input_data)
        channel.shutdown_write()
    deadline = time.monotonic() + timeout_seconds
    output = bytearray()
    error = bytearray()

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
            raise TimeoutError(
                f"Remote command exceeded {timeout_seconds} seconds; "
                f"stderr={error.decode('utf-8', errors='replace')[-500:]}"
            )
        time.sleep(0.2)


def discover_php_binary(client: paramiko.SSHClient) -> tuple[str, str]:
    quoted_candidates = " ".join(f"'{item}'" for item in PHP_CANDIDATES)
    command = f"""
set -eu
for candidate in {quoted_candidates}; do
  resolved="$(command -v -- "$candidate" 2>/dev/null || true)"
  if [ -n "$resolved" ] && [ -x "$resolved" ]; then
    version="$($resolved -r 'echo PHP_VERSION;' 2>/dev/null || true)"
    if [ -n "$version" ]; then
      printf '%s\t%s\n' "$resolved" "$version"
    fi
  fi
done
"""
    status, output, error = run_remote_command(client, command, 30)
    if status != 0:
        raise RuntimeError(f"Remote PHP discovery failed: {error[-300:]}")

    discovered = []
    for line in output.splitlines():
        parts = line.split("\t", 1)
        if len(parts) == 2:
            discovered.append((parts[0], parts[1]))
    for binary, version in discovered:
        if version.startswith(EXPECTED_PHP_SERIES + "."):
            return binary, version

    available = ",".join(version for _, version in discovered) or "none"
    raise RuntimeError(
        f"PHP {EXPECTED_PHP_SERIES} CLI was not found; available={available}"
    )


def execute_remote(mode: str) -> dict[str, object]:
    if mode not in {"audit", "apply"}:
        raise ValueError("mode must be audit or apply")
    if not PHP_SCRIPT.is_file():
        raise RuntimeError("Pinned Bitrix price operation script is missing")

    try:
        client = connect()
    except Exception as exc:
        raise RuntimeError(
            f"Beget SSH connection failed: {type(exc).__name__}: {exc}"
        ) from exc
    stage = "root-check"

    try:
        root_check = (
            "set -eu; "
            f"test \"$(realpath -- {SITE_ROOT})\" = {SITE_ROOT}; "
            f"test -f {SITE_ROOT}/bitrix/header.php"
        )
        status, _, error = run_remote_command(client, root_check, 30)
        if status != 0:
            raise RuntimeError(f"Pinned Bitrix root check failed: {error[:300]}")

        stage = "php-discovery"
        php_binary, php_version = discover_php_binary(client)
        script_bytes = PHP_SCRIPT.read_bytes()

        stage = "php-preflight"
        status, preflight_output, preflight_error = run_remote_command(
            client,
            (
                f"timeout 15s {php_binary} -r 'echo PHP_VERSION;' && "
                f"timeout 15s {php_binary} -l"
            ),
            40,
            script_bytes,
        )
        if status != 0:
            raise RuntimeError(
                "Remote PHP preflight failed: "
                + (preflight_error or preflight_output)[-500:]
            )

        stage = "bitrix-operation"
        status, output, error = run_remote_command(
            client,
            (
                f"timeout 150s {php_binary} -d display_errors=stderr -d log_errors=0 "
                f"-- {mode}"
            ),
            170,
            script_bytes,
        )
        if not output:
            raise RuntimeError(f"Bitrix price helper returned no JSON: {error[-500:]}")
        try:
            payload = json.loads(output.splitlines()[-1])
        except json.JSONDecodeError as exc:
            raise RuntimeError("Bitrix price helper returned malformed JSON") from exc
        if status != 0 or payload.get("status") != "ok":
            message = str(payload.get("error") or error or "unknown Bitrix error")
            raise RuntimeError(message[:1000])
        payload["runtime"] = {
            "php_version": php_version,
            "php_series_matches_live": php_version.startswith(EXPECTED_PHP_SERIES + "."),
        }
        return payload
    except Exception as exc:
        raise RuntimeError(
            f"Beget stage {stage} failed: {type(exc).__name__}: {exc}"
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
    sku_props_ok = bool(
        re.search(
            rf'<div\s+class="sku-props"[^>]*data-item-id="{product_id}"[^>]*'
            rf'data-iblockid="86"[^>]*data-offer-id="{offer_id}"[^>]*'
            r'data-offer-iblockid="64"',
            page,
        )
    )
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


def write_receipt(
    mode: str,
    remote: dict[str, object],
    public: dict[str, object],
) -> Path:
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    path = REPORT_ROOT / f"ROSOMAHA_BITRIX_PRODUCT_PRICES_{stamp}_{mode.upper()}.json"
    receipt = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "domain": "rosomaha-rus.ru",
        "mode": mode,
        "expected_account": EXPECTED_LOGIN,
        "target": "iblock:86+64/PRICE+FILTER_PRICE",
        "remote": remote,
        "public_verification": public,
        "secrets_exported": False,
    }
    path.write_text(
        json.dumps(receipt, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Audit or apply the nine pinned Rosomaha Bitrix price changes."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Perform the guarded update. Without this flag the command is read-only.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    mode = "apply" if args.apply else "audit"
    try:
        remote = execute_remote(mode)
        public = verify_public(remote)
        receipt = write_receipt(mode, remote, public)
        result = {
            "status": "ok" if public["ok"] else "verification_failed",
            "mode": mode,
            "database_mutations": remote.get("database_mutations", 0),
            "updated_ids": remote.get("updated_ids", []),
            "backup_path": remote.get("backup_path"),
            "public_verification": public,
            "receipt": str(receipt),
            "secrets_exported": False,
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result["status"] == "ok" else 1
    except Exception as exc:
        print(
            json.dumps(
                {
                    "status": "error",
                    "mode": mode,
                    "error": str(exc) or type(exc).__name__,
                    "secrets_exported": False,
                },
                ensure_ascii=False,
                indent=2,
            ),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
