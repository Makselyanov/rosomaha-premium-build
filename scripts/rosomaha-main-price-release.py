#!/usr/bin/env python3
"""Fixed evidence-first release helper for the main Rosomaha price change.

Default mode is a read-only audit which captures the production article export,
builds the exact committed candidate in an isolated worktree, and emits a
baseline receipt.  Apply is possible only with that receipt and the exact
pinned commit.  The remote operator never builds source code and never runs as
root.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import html
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from typing import Any, Iterable

import paramiko


PROJECT_ROOT = Path(__file__).resolve().parents[1]
OPERATOR_PATH = PROJECT_ROOT / "scripts/rosomaha-main-price-release-operator.sh"
REPORT_ROOT = PROJECT_ROOT / "marketing-audits/releases"
TEMP_ROOT = PROJECT_ROOT / ".codex_tmp/main-price-release"

SCHEMA = "rosomaha-main-price-release/v2"
HOST = "90.156.168.115"
PORT = 22
EXPECTED_LOGIN = "deploy"
EXPECTED_HOST_KEY_SHA256 = "0bcM0FC+ETPaXuICxp+1dvG5US4DAdSrrLl5H8py3BY"
EXPECTED_PUBLIC_KEY_FINGERPRINT = "SHA256:Bvnk8M0TiB4Ovg17j/WvixBPxsjeWuiN6zcfFWa40Uo"
IDENTITY_FILE = Path.home() / ".ssh/id_ed25519"
APP_ROOT = "/var/www/rosomaha"
REMOTE_CANONICAL_ARTICLES = f"{APP_ROOT}/public/api/articles.json"
REMOTE_ARTICLES_CZ = f"{APP_ROOT}/src/data/articles-cz"
TARGET_COMMIT = "10d9dc666bccbe9fb250ab29a69ae09710537e77"
RELEASE_LABEL = "prices-10d9dc6"
BASE_URL = "https://xn--80aa8ahaki9a.site"

EXPECTED_ARTICLE_COUNT = 61
EXPECTED_PRERENDER_ROUTE_COUNT = 96
MAX_HTTP_BYTES = 25 * 1024 * 1024
MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
MAX_CANDIDATE_FILES = 20_000

ARTICLES_CZ_ALLOWLIST = (
    "avgustovskiy-marshrut-na-rosomahe-chek-list-osmotra-pered-vyezdom.ts",
    "bolotohod-ili-smert-pochemu-aprel-ubivaet-tehniku-silnee-chem-yanvar.ts",
    "chto-esli-vash-bolotohod-zastryal-nochyu-v-glushi-realnaya-istoriya-spaseniya-i-vyvody.ts",
    "dve-nedeli-na-kolesah-dnevnik-motoputeshestviya-po-yuzhnomu-uralu-vesnoy.ts",
    "esli-rosomaha-zaglohla-v-vode-bezopasnyy-poryadok-deystviy-na-marshrute.ts",
    "gryazevoy-turizm-2026-gayd-po-luchshim-marshrutam-tsentralnoy-rossii-i-ne-tolko-dlya-kvadrotsiklov-i-bolotohodov.ts",
    "index.ts",
    "kak-podderzhat-ohlazhdenie-rosomahi-v-letnyuyu-zharu-prakticheskiy-poryadok.ts",
    "marshrut-na-bolotohode-v-zharu-chek-list-spokoynoy-poezdki-na-rosomahe.ts",
    "maslo-filtry-rezina-chto-realno-nuzhno-menyat-kazhduyu-vesnu-a-chto-marketing.ts",
    "posle-silnogo-dozhdya-kogda-menyat-marshrut-na-rosomahe.ts",
    "rosomaha-zastryala-v-bolote-spokoynyy-poryadok-deystviy-bez-lishney-suety.ts",
    "top-5-neochevidnyh-problem-s-kotorymi-stalkivayutsya-vladeltsy-kvadrotsiklov-vesnoy-i-kak-ih-izbezhat.ts",
    "vesenniy-tyuning-7-byudzhetnyh-apgreydov-kotorye-preobrazyat-vash-kvadrotsikl-k-letu.ts",
)

MODEL_PRICES = {
    "/catalog/rosomaha-standart-plus": 1_350_000,
    "/catalog/rosomaha-standart-plus-uaz": 1_450_000,
    "/catalog/rosomaha-extrime-uaz": 1_850_000,
    "/catalog/rosomaha-extrime-toyota": 2_100_000,
    "/catalog/rosomaha-extrime-plus": 2_200_000,
    "/catalog/rosomaha-hunter": 2_230_000,
    "/catalog/rosomaha-pickup-uaz-timken": 1_850_000,
    "/catalog/rosomaha-pickup-uaz-18": 2_300_000,
    "/catalog/rosomaha-pickup-toyota": 2_500_000,
}
OLD_MODEL_PRICES = {
    "/catalog/rosomaha-standart-plus": 1_300_000,
    "/catalog/rosomaha-standart-plus-uaz": 1_400_000,
    "/catalog/rosomaha-extrime-uaz": 1_800_000,
    "/catalog/rosomaha-extrime-toyota": 2_050_000,
    "/catalog/rosomaha-extrime-plus": 2_150_000,
    "/catalog/rosomaha-hunter": 2_180_000,
    "/catalog/rosomaha-pickup-uaz-timken": 1_800_000,
    "/catalog/rosomaha-pickup-uaz-18": 2_250_000,
    "/catalog/rosomaha-pickup-toyota": 2_450_000,
}
CORE_PATHS = ("/", "/catalog", "/articles")
SEO_SNAPSHOT_PATHS = (*CORE_PATHS, *MODEL_PRICES)


class HelperError(RuntimeError):
    pass


class PinnedHostKeyPolicy(paramiko.MissingHostKeyPolicy):
    def missing_host_key(self, client: paramiko.SSHClient, hostname: str, key: paramiko.PKey) -> None:
        observed = base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode("ascii").rstrip("=")
        if hostname != HOST or observed != EXPECTED_HOST_KEY_SHA256:
            raise paramiko.SSHException("pinned SSH host-key mismatch")
        client.get_host_keys().add(hostname, key.get_name(), key)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        return None


class SeoHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title_parts: list[str] = []
        self.visible_parts: list[str] = []
        self.json_ld_parts: list[str] = []
        self.meta: list[dict[str, str]] = []
        self.links: list[dict[str, str]] = []
        self._title = False
        self._hidden_depth = 0
        self._json_ld = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {name.lower(): (value or "") for name, value in attrs}
        lowered = tag.lower()
        if lowered == "title":
            self._title = True
        if lowered in {"script", "style", "noscript", "template", "svg"}:
            self._hidden_depth += 1
        if lowered == "script" and values.get("type", "").lower() == "application/ld+json":
            self._json_ld = True
        if lowered == "meta":
            self.meta.append(values)
        if lowered == "link":
            self.links.append(values)

    def handle_endtag(self, tag: str) -> None:
        lowered = tag.lower()
        if lowered == "title":
            self._title = False
        if lowered == "script" and self._json_ld:
            self._json_ld = False
        if lowered in {"script", "style", "noscript", "template", "svg"} and self._hidden_depth:
            self._hidden_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._title:
            self.title_parts.append(data)
        if self._json_ld:
            self.json_ld_parts.append(data)
        if not self._hidden_depth:
            self.visible_parts.append(data)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_within(root: Path, path: Path, *, require_exists: bool = True) -> Path:
    resolved_root = root.resolve(strict=True)
    resolved_path = path.resolve(strict=require_exists)
    try:
        resolved_path.relative_to(resolved_root)
    except ValueError as exc:
        raise HelperError(f"path escapes fixed root: {path}") from exc
    return resolved_path


def safe_regular_file(path: Path, root: Path) -> os.stat_result:
    resolved = ensure_within(root, path)
    details = os.lstat(path)
    if not stat.S_ISREG(details.st_mode) or stat.S_ISLNK(details.st_mode) or details.st_nlink != 1:
        raise HelperError(f"unsafe regular file topology: {path}")
    if resolved != path.resolve(strict=True):
        raise HelperError(f"unexpected file realpath: {path}")
    return details


def safe_directory(path: Path, root: Path) -> os.stat_result:
    ensure_within(root, path)
    details = os.lstat(path)
    if not stat.S_ISDIR(details.st_mode) or stat.S_ISLNK(details.st_mode):
        raise HelperError(f"unsafe directory topology: {path}")
    return details


def atomic_json_receipt(prefix: str, payload: dict[str, Any]) -> Path:
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = REPORT_ROOT / f"{stamp}-{prefix}.json"
    temporary = target.with_suffix(".json.tmp")
    temporary.write_bytes(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8") + b"\n")
    os.replace(temporary, target)
    return target


WINDOWS_SDDL_TRUSTEES = {
    "BA": "S-1-5-32-544",  # Builtin Administrators
    "SY": "S-1-5-18",      # Local System
}


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
    descriptor_lines = [
        line.strip() for line in saved_acl.splitlines()
        if re.match(r"^D:[A-Z]*(?:\(|$)", line.strip())
    ]
    if len(descriptor_lines) != 1:
        raise HelperError("saved identity ACL has no unique DACL descriptor")
    descriptor = descriptor_lines[0]
    match = re.fullmatch(r"D:([A-Z]*)(.*)", descriptor)
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
    if len(observed) != len(set(observed)):
        raise HelperError("pinned identity ACL contains duplicate principal entries")
    if current_sid not in observed:
        raise HelperError("pinned identity ACL does not grant the current user")
    return {
        "checked": True,
        "platform": "windows",
        "dacl_protected": True,
        "inherited_entries": 0,
        "allowed_principal_count": len(observed),
        "current_user_present": True,
    }


def windows_identity_acl(path: Path) -> dict[str, Any]:
    TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="identity-acl-", dir=TEMP_ROOT) as raw_directory:
        directory = Path(raw_directory)
        safe_directory(directory, TEMP_ROOT)
        saved_path = directory / "identity.acl"
        completed = subprocess.run(
            ["icacls.exe", str(path), "/save", str(saved_path), "/q"],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=15, check=False,
        )
        if completed.returncode != 0:
            raise HelperError("cannot prove pinned identity ACL")
        safe_regular_file(saved_path, directory)
        raw = saved_path.read_bytes()
        if len(raw) < 4 or len(raw) > 1024 * 1024:
            raise HelperError("saved identity ACL has an invalid size")
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
    parent = IDENTITY_FILE.parent
    parent_details = os.lstat(parent)
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


def connect() -> tuple[paramiko.SSHClient, dict[str, Any]]:
    key, identity_evidence = pinned_identity()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(PinnedHostKeyPolicy())
    try:
        client.connect(
            hostname=HOST, port=PORT, username=EXPECTED_LOGIN, pkey=key,
            look_for_keys=False, allow_agent=False, timeout=20,
            banner_timeout=20, auth_timeout=20,
        )
        transport = client.get_transport()
        if transport is None or not transport.is_active() or transport.get_username() != EXPECTED_LOGIN:
            raise HelperError("pinned deploy SSH identity is not active")
        return client, identity_evidence
    except Exception:
        client.close()
        raise


def operator_bytes() -> bytes:
    safe_regular_file(OPERATOR_PATH, PROJECT_ROOT)
    raw = OPERATOR_PATH.read_bytes()
    if b"EXPECTED_LOGIN = \"deploy\"" not in raw or b"SCHEMA = \"rosomaha-main-price-release/v2\"" not in raw:
        raise HelperError("fixed operator identity marker is missing")
    if b"sudo" in raw or b"ROOT_OPERATOR" in raw or b"npm run build" in raw:
        raise HelperError("fixed operator contains a forbidden privileged/build path")
    return raw


def run_remote(client: paramiko.SSHClient, command: str, stdin_bytes: bytes, timeout: int) -> dict[str, Any]:
    transport = client.get_transport()
    if transport is None or not transport.is_active():
        raise HelperError("SSH transport is unavailable")
    channel = transport.open_session(timeout=20)
    channel.settimeout(timeout)
    channel.exec_command(command)
    channel.sendall(stdin_bytes)
    channel.shutdown_write()
    stdout = bytearray()
    stderr = bytearray()
    deadline = time.monotonic() + timeout
    while not channel.exit_status_ready():
        while channel.recv_ready():
            stdout.extend(channel.recv(65536))
        while channel.recv_stderr_ready():
            stderr.extend(channel.recv_stderr(65536))
        if time.monotonic() >= deadline:
            channel.close()
            raise HelperError("fixed remote operator timed out")
        time.sleep(0.05)
    while channel.recv_ready():
        stdout.extend(channel.recv(65536))
    while channel.recv_stderr_ready():
        stderr.extend(channel.recv_stderr(65536))
    return {
        "exit_code": channel.recv_exit_status(),
        "stdout": bytes(stdout).decode("utf-8", errors="replace"),
        "stderr": bytes(stderr).decode("utf-8", errors="replace"),
    }


def parse_operator_json(result: dict[str, Any]) -> dict[str, Any]:
    lines = [line for line in result["stdout"].splitlines() if line.strip()]
    if not lines:
        raise HelperError("fixed operator returned no JSON receipt")
    try:
        payload = json.loads(lines[-1])
    except json.JSONDecodeError as exc:
        raise HelperError("fixed operator returned invalid JSON") from exc
    if result["exit_code"] != 0 or payload.get("status") in {"error", "blocked"}:
        raise HelperError(f"fixed operator failed: {payload.get('error') or payload.get('blockers')}")
    return payload


def remote_audit(client: paramiko.SSHClient) -> dict[str, Any]:
    payload = parse_operator_json(run_remote(client, "bash -s -- audit", operator_bytes(), 180))
    if payload.get("schema") != SCHEMA or payload.get("host") != HOST or payload.get("account") != EXPECTED_LOGIN:
        raise HelperError("remote audit identity mismatch")
    if payload.get("target_commit") != TARGET_COMMIT or payload.get("status") != "ok":
        raise HelperError("remote audit is not ready for the pinned release")
    if not payload.get("article_parity"):
        raise HelperError("canonical/current/live article raw parity is not proved")
    hashes = {payload.get("articles", {}).get(name, {}).get("sha256") for name in ("canonical", "current", "live")}
    if None in hashes or len(hashes) != 1:
        raise HelperError("remote article raw SHA-256 differs")
    return payload


def read_http(url: str, *, accept: str = "text/html", attempts: int = 3) -> dict[str, Any]:
    opener = urllib.request.build_opener(NoRedirect())
    last_error: Exception | None = None
    for attempt in range(attempts):
        request = urllib.request.Request(url, headers={"User-Agent": "RosomahaFixedPriceRelease/2.0", "Accept": accept})
        try:
            with opener.open(request, timeout=25) as response:
                raw = response.read(MAX_HTTP_BYTES + 1)
                if len(raw) > MAX_HTTP_BYTES:
                    raise HelperError("public response exceeded fixed size limit")
                return {
                    "url": url, "final_url": response.geturl(), "status": int(response.status),
                    "content_type": response.headers.get("Content-Type", ""), "raw": raw,
                    "attempts": attempt + 1,
                }
        except urllib.error.HTTPError as exc:
            raw = exc.read(MAX_HTTP_BYTES + 1)
            return {"url": url, "final_url": exc.geturl(), "status": int(exc.code), "content_type": exc.headers.get("Content-Type", ""), "raw": raw, "attempts": attempt + 1}
        except Exception as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep((1, 3, 7)[min(attempt, 2)])
    raise HelperError(f"public read failed after {attempts} attempts: {type(last_error).__name__}")


def collapse_text(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(value).replace("\u00a0", " ")).strip()


def seo_fields(parser: SeoHTMLParser) -> dict[str, str | None]:
    def meta_value(attribute: str, name: str) -> str | None:
        for item in parser.meta:
            if item.get(attribute, "").casefold() == name.casefold():
                return collapse_text(item.get("content", ""))
        return None

    canonical = next((item.get("href") for item in parser.links if item.get("rel", "").casefold() == "canonical"), None)
    return {
        "title": collapse_text("".join(parser.title_parts)),
        "description": meta_value("name", "description"),
        "og_url": meta_value("property", "og:url"),
        "canonical": canonical,
        "robots": meta_value("name", "robots"),
    }


def normalized_robots(value: str | None) -> set[str]:
    return {part.strip().casefold() for part in (value or "").split(",") if part.strip()}


def recursive_objects(value: Any) -> Iterable[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from recursive_objects(child)
    elif isinstance(value, list):
        for child in value:
            yield from recursive_objects(child)


def exact_price_value(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and re.fullmatch(r"[0-9]+", value):
        return int(value)
    return None


def scoped_json_ld_prices(parser: SeoHTMLParser, expected_url: str) -> list[int]:
    prices: list[int] = []
    for part in parser.json_ld_parts:
        try:
            payload = json.loads(part)
        except json.JSONDecodeError as exc:
            raise HelperError("invalid JSON-LD on model page") from exc
        for item in recursive_objects(payload):
            types = item.get("@type")
            type_values = types if isinstance(types, list) else [types]
            if "Product" not in type_values:
                continue
            url = item.get("url")
            identifiers = {str(url).rstrip("/")} if isinstance(url, str) else set()
            identifiers.update(str(value).rstrip("/") for value in item.get("sameAs", []) if isinstance(value, str)) if isinstance(item.get("sameAs"), list) else None
            product_scoped = expected_url.rstrip("/") in identifiers
            offers = item.get("offers")
            candidates = offers if isinstance(offers, list) else [offers]
            for offer in candidates:
                if not isinstance(offer, dict):
                    continue
                offer_url = offer.get("url")
                offer_scoped = isinstance(offer_url, str) and offer_url.rstrip("/") == expected_url.rstrip("/")
                if not product_scoped and not offer_scoped:
                    continue
                if "price" not in offer:
                    raise HelperError("scoped Product Offer has no exact price")
                price = exact_price_value(offer["price"])
                if price is None:
                    raise HelperError("scoped Product Offer price is not exact integer digits")
                prices.append(price)
    return prices


def formatted_price(price: int) -> str:
    return f"от {price:,} ₽".replace(",", " ")


def formatted_amount(price: int) -> str:
    return f"{price:,}".replace(",", " ")


def parse_html(raw: bytes) -> SeoHTMLParser:
    parser = SeoHTMLParser()
    parser.feed(raw.decode("utf-8-sig", errors="strict"))
    return parser


def verify_html_page(
    raw: bytes,
    path: str,
    *,
    expected_price: int | None = None,
    absent_price: int | None = None,
    require_visible_price: bool = True,
) -> dict[str, Any]:
    parser = parse_html(raw)
    fields = seo_fields(parser)
    expected_url = BASE_URL + ("/" if path == "/" else path)
    blockers: list[str] = []
    if not fields["title"] or not fields["description"]:
        blockers.append("title/description missing")
    if fields["canonical"] != expected_url or fields["og_url"] != expected_url:
        blockers.append("canonical/og:url mismatch")
    robots = normalized_robots(fields["robots"])
    if "noindex" in robots or "nofollow" in robots:
        blockers.append("blocking robots meta")
    visible = collapse_text(" ".join(parser.visible_parts))
    evidence: dict[str, Any] = {"path": path, "url": expected_url, "seo": fields, "blockers": blockers}
    if expected_price is not None:
        expected_visible = formatted_price(expected_price)
        expected_count = visible.count(expected_visible)
        old_amount = formatted_amount(absent_price) if absent_price is not None else None
        json_prices = scoped_json_ld_prices(parser, expected_url)
        if require_visible_price and expected_count < 1:
            blockers.append("exact formatted visible price missing")
        if old_amount and old_amount in visible:
            blockers.append("old visible price is still present")
        if json_prices.count(expected_price) != 1 or len(json_prices) != 1:
            blockers.append("exact scoped Product Offer price is not present exactly once")
        if absent_price is not None and absent_price in json_prices:
            blockers.append("old JSON-LD price is still present")
        evidence["price"] = {
            "expected": expected_price, "absent": absent_price,
            "visible_required": require_visible_price,
            "visible_exact": expected_visible, "visible_count": expected_count,
            "old_visible_absent": not bool(old_amount and old_amount in visible),
            "json_ld_prices": json_prices,
        }
    evidence["valid"] = not blockers
    return evidence


def normalize_price_fields(fields: dict[str, Any], prices: Iterable[int]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    patterns = sorted({formatted_amount(price) for price in prices}, key=len, reverse=True)
    for key, value in fields.items():
        normalized = value
        if isinstance(normalized, str):
            normalized = collapse_text(normalized)
            for pattern in patterns:
                normalized = normalized.replace(pattern, "<PRICE>")
        result[key] = normalized
    return result


def public_seo_snapshot(*, stage: str) -> dict[str, Any]:
    if stage not in {"old", "new"}:
        raise HelperError("invalid public SEO snapshot stage")
    pages: dict[str, Any] = {}
    for path in SEO_SNAPSHOT_PATHS:
        response = read_http(BASE_URL + ("/" if path == "/" else path))
        if response["status"] != 200 or response["final_url"] != response["url"]:
            raise HelperError(f"public page is not exact HTTP 200: {path}")
        expected = OLD_MODEL_PRICES.get(path) if stage == "old" else MODEL_PRICES.get(path)
        absent = MODEL_PRICES.get(path) if stage == "old" else OLD_MODEL_PRICES.get(path)
        evidence = verify_html_page(
            response["raw"], path, expected_price=expected, absent_price=absent,
            require_visible_price=stage == "new",
        )
        if not evidence["valid"]:
            raise HelperError(f"public SEO/price verification failed for {path}: {evidence['blockers']}")
        evidence["http"] = {key: response[key] for key in ("status", "final_url", "attempts")}
        pages[path] = evidence
    return {"stage": stage, "captured_at": utc_now(), "pages": pages, "valid": True}


def verify_seo_unchanged(baseline: dict[str, Any], observed: dict[str, Any]) -> None:
    for path in SEO_SNAPSHOT_PATHS:
        before = baseline["pages"][path]["seo"]
        after = observed["pages"][path]["seo"]
        prices = (OLD_MODEL_PRICES[path], MODEL_PRICES[path]) if path in MODEL_PRICES else ()
        if normalize_price_fields(before, prices) != normalize_price_fields(after, prices):
            raise HelperError(f"SEO head changed outside the approved price for {path}")


def article_info(raw: bytes, source: str) -> dict[str, Any]:
    result: dict[str, Any] = {"source": source, "sha256": sha256_bytes(raw), "bytes": len(raw), "valid": False}
    try:
        payload = json.loads(raw.decode("utf-8-sig"))
        if not isinstance(payload, list):
            raise ValueError("article export must be a JSON array")
        slugs = []
        for index, item in enumerate(payload):
            if not isinstance(item, dict) or not isinstance(item.get("slug"), str) or not item["slug"].strip():
                raise ValueError(f"article {index} has no slug")
            slugs.append(item["slug"].strip())
        unique = sorted(set(slugs))
        duplicates = sorted({slug for slug in slugs if slugs.count(slug) > 1})
        result.update({
            "count": len(slugs), "unique_count": len(unique), "duplicates": duplicates,
            "slugs": unique, "slug_digest": sha256_bytes(("\n".join(unique) + "\n").encode("utf-8")),
            "valid": not duplicates,
        })
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
    return result


def sftp_regular(attr: paramiko.SFTPAttributes) -> bool:
    return bool(stat.S_ISREG(attr.st_mode) and not stat.S_ISLNK(attr.st_mode) and getattr(attr, "st_nlink", 1) == 1)


def sftp_download_exact(sftp: paramiko.SFTPClient, remote_path: str, local_path: Path, *, max_bytes: int = MAX_HTTP_BYTES) -> dict[str, Any]:
    attr = sftp.lstat(remote_path)
    if not sftp_regular(attr) or attr.st_size < 1 or attr.st_size > max_bytes:
        raise HelperError(f"unsafe remote canonical file: {remote_path}")
    local_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = local_path.with_suffix(local_path.suffix + ".part")
    digest = hashlib.sha256()
    total = 0
    with sftp.open(remote_path, "rb") as source, temporary.open("wb") as target:
        while True:
            chunk = source.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise HelperError(f"remote canonical file exceeded limit: {remote_path}")
            digest.update(chunk)
            target.write(chunk)
    if total != attr.st_size:
        temporary.unlink(missing_ok=True)
        raise HelperError(f"remote canonical file changed during download: {remote_path}")
    after = sftp.lstat(remote_path)
    if not sftp_regular(after) or after.st_size != attr.st_size or getattr(after, "st_mtime", None) != getattr(attr, "st_mtime", None):
        temporary.unlink(missing_ok=True)
        raise HelperError(f"remote canonical file topology changed during download: {remote_path}")
    os.replace(temporary, local_path)
    return {"path": remote_path, "bytes": total, "sha256": digest.hexdigest()}


def capture_canonical_snapshot(client: paramiko.SSHClient, audit: dict[str, Any]) -> tuple[Path, dict[str, Any]]:
    run_id = uuid.uuid4().hex[:16]
    snapshot_root = TEMP_ROOT / run_id / "canonical"
    if snapshot_root.exists():
        raise HelperError("canonical snapshot path already exists; do not overwrite evidence")
    snapshot_root.mkdir(parents=True)
    sftp = client.open_sftp()
    try:
        article_path = snapshot_root / "public/api/articles.json"
        article_manifest = sftp_download_exact(sftp, REMOTE_CANONICAL_ARTICLES, article_path)
        info = article_info(article_path.read_bytes(), "downloaded-canonical")
        remote_info = audit["articles"]["canonical"]
        if not info["valid"] or info["count"] != EXPECTED_ARTICLE_COUNT:
            raise HelperError("downloaded canonical article export is invalid or has unexpected count")
        if info["sha256"] != remote_info["sha256"] or info["slug_digest"] != remote_info["slug_digest"]:
            raise HelperError("SFTP canonical article snapshot differs from remote audit")

        directory_attr = sftp.lstat(REMOTE_ARTICLES_CZ)
        if not stat.S_ISDIR(directory_attr.st_mode) or stat.S_ISLNK(directory_attr.st_mode):
            raise HelperError("unsafe remote articles-cz directory")
        observed_names = sorted(item.filename for item in sftp.listdir_attr(REMOTE_ARTICLES_CZ))
        if observed_names != sorted(ARTICLES_CZ_ALLOWLIST):
            raise HelperError(f"unexpected articles-cz allowlist: {observed_names}")
        cz_entries = []
        for name in ARTICLES_CZ_ALLOWLIST:
            entry = sftp_download_exact(sftp, f"{REMOTE_ARTICLES_CZ}/{name}", snapshot_root / "src/data/articles-cz" / name, max_bytes=8 * 1024 * 1024)
            cz_entries.append({"name": name, "bytes": entry["bytes"], "sha256": entry["sha256"]})
    finally:
        sftp.close()
    cz_manifest = {"files": cz_entries, "digest": sha256_bytes(canonical_json(cz_entries)), "count": len(cz_entries)}
    if not audit.get("articles_cz", {}).get("valid") or cz_manifest != {
        key: audit["articles_cz"].get(key) for key in ("files", "digest", "count")
    }:
        raise HelperError("SFTP articles-cz snapshot differs from remote audit manifest")
    return snapshot_root, {"articles": {**article_manifest, **info}, "articles_cz": cz_manifest}


def extract_ts_slugs(raw: str) -> list[str]:
    return re.findall(r"\bslug\s*:\s*['\"]([^'\"]+)['\"]", raw)


def validate_articles_cz(snapshot_root: Path, worktree: Path, canonical_slugs: list[str]) -> dict[str, Any]:
    cz_root = snapshot_root / "src/data/articles-cz"
    names = sorted(item.name for item in cz_root.iterdir())
    if names != sorted(ARTICLES_CZ_ALLOWLIST):
        raise HelperError("local canonical articles-cz snapshot allowlist mismatch")
    article_names = [name for name in ARTICLES_CZ_ALLOWLIST if name != "index.ts"]
    cz_slugs: list[str] = []
    for name in article_names:
        slugs = extract_ts_slugs((cz_root / name).read_text(encoding="utf-8-sig"))
        if len(slugs) != 1:
            raise HelperError(f"articles-cz file must define exactly one slug: {name}")
        cz_slugs.extend(slugs)
    if len(set(cz_slugs)) != len(cz_slugs) or not set(cz_slugs).issubset(canonical_slugs):
        raise HelperError("articles-cz slugs are duplicated or absent from canonical JSON")
    index_raw = (cz_root / "index.ts").read_text(encoding="utf-8-sig")
    imports = re.findall(r"\bfrom\s+['\"]\./([^'\"]+)['\"]", index_raw)
    expected_stems = sorted(Path(name).stem for name in article_names)
    if sorted(imports) != expected_stems or len(imports) != len(set(imports)):
        raise HelperError("articles-cz index does not import each allowlisted article exactly once")

    source_sets = {
        "manual": extract_ts_slugs((worktree / "src/data/articles.ts").read_text(encoding="utf-8-sig")),
        "tyumen": extract_ts_slugs((worktree / "src/data/tyumen-exhibition.ts").read_text(encoding="utf-8-sig")),
        "cz": cz_slugs,
    }
    union = source_sets["manual"] + source_sets["tyumen"] + source_sets["cz"]
    duplicates = sorted({slug for slug in union if union.count(slug) > 1})
    if duplicates or sorted(union) != sorted(canonical_slugs):
        raise HelperError("static manual+tyumen+CZ slug union does not equal canonical JSON exactly once")
    return {"cz_slugs": sorted(cz_slugs), "source_counts": {key: len(value) for key, value in source_sets.items()}, "union_count": len(union), "valid": True}


def run_git(args: list[str], *, timeout: int = 120) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args], cwd=PROJECT_ROOT, stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        encoding="utf-8", errors="replace", timeout=timeout, check=False,
    )


def prove_target_commit(commit: str) -> None:
    if commit != TARGET_COMMIT or not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise HelperError("only the exact pinned target commit is allowed")
    resolved = run_git(["rev-parse", f"{commit}^{{commit}}"])
    if resolved.returncode != 0 or resolved.stdout.strip() != commit:
        raise HelperError("pinned target commit is unavailable locally")
    status = run_git(["cat-file", "-t", commit])
    if status.returncode != 0 or status.stdout.strip() != "commit":
        raise HelperError("pinned target object is not a commit")


def overlay_canonical(snapshot_root: Path, worktree: Path) -> None:
    safe_directory(snapshot_root, TEMP_ROOT)
    safe_directory(worktree, TEMP_ROOT)
    public_api = worktree / "public/api"
    target_cz = worktree / "src/data/articles-cz"
    safe_directory(public_api, worktree)
    safe_directory(target_cz, worktree)
    observed = sorted(item.name for item in target_cz.iterdir())
    if "index.ts" not in observed or not set(observed).issubset(ARTICLES_CZ_ALLOWLIST):
        raise HelperError("pinned commit articles-cz topology contains unexpected files")
    for name in observed:
        safe_regular_file(target_cz / name, worktree)
    shutil.copyfile(snapshot_root / "public/api/articles.json", public_api / "articles.json")
    for name in ARTICLES_CZ_ALLOWLIST:
        source = snapshot_root / "src/data/articles-cz" / name
        safe_regular_file(source, snapshot_root)
        target = target_cz / name
        if target.exists() or target.is_symlink():
            safe_regular_file(target, worktree)
        shutil.copyfile(source, target)
    articles_source = (worktree / "src/data/articles.ts").read_text(encoding="utf-8-sig")
    if "from './articles-cz/index'" not in articles_source and 'from "./articles-cz/index"' not in articles_source:
        raise HelperError("pinned commit lacks the explicit articles-cz/index import fix")


def isolated_build_environment() -> dict[str, str]:
    modules = PROJECT_ROOT / "node_modules"
    safe_directory(modules, PROJECT_ROOT)
    bin_dir = modules / ".bin"
    safe_directory(bin_dir, PROJECT_ROOT)
    allowed_names = ("SystemRoot", "ComSpec", "PATHEXT", "TEMP", "TMP", "LANG", "LOCALAPPDATA", "APPDATA")
    environment = {name: os.environ[name] for name in allowed_names if name in os.environ}
    existing_path = os.environ.get("PATH", "")
    environment.update({
        "PATH": str(bin_dir) + os.pathsep + existing_path,
        "NODE_PATH": str(modules),
        "CI": "1",
        "NO_COLOR": "1",
    })
    return environment


def local_html_path(dist: Path, route: str) -> Path:
    if route == "/":
        return dist / "index.html"
    return dist / route.lstrip("/") / "index.html"


def xml_locations(raw: bytes) -> set[str]:
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        raise HelperError("invalid candidate sitemap XML") from exc
    return {collapse_text(node.text or "") for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "loc" and node.text}


def verify_candidate_dist(dist: Path, snapshot_root: Path, public_baseline: dict[str, Any]) -> dict[str, Any]:
    safe_directory(dist, dist)
    canonical_raw = (snapshot_root / "public/api/articles.json").read_bytes()
    candidate_public = (dist / "api/articles.json").read_bytes()
    if sha256_bytes(candidate_public) != sha256_bytes(canonical_raw):
        raise HelperError("candidate dist article export is not raw-identical to canonical JSON")
    articles = article_info(candidate_public, "candidate-dist")
    if not articles["valid"] or articles["count"] != EXPECTED_ARTICLE_COUNT:
        raise HelperError("candidate dist article count/uniqueness is invalid")

    pages: dict[str, Any] = {}
    for path in SEO_SNAPSHOT_PATHS:
        html_path = local_html_path(dist, path)
        safe_regular_file(html_path, dist)
        evidence = verify_html_page(
            html_path.read_bytes(), path,
            expected_price=MODEL_PRICES.get(path), absent_price=OLD_MODEL_PRICES.get(path),
        )
        if not evidence["valid"]:
            raise HelperError(f"candidate SEO/price verification failed for {path}: {evidence['blockers']}")
        pages[path] = evidence
    candidate_snapshot = {"stage": "new", "pages": pages, "valid": True}
    verify_seo_unchanged(public_baseline, candidate_snapshot)

    article_urls = {f"{BASE_URL}/articles/{slug}" for slug in articles["slugs"]}
    sitemap_articles_raw = (dist / "sitemap-articles.xml").read_bytes()
    if xml_locations(sitemap_articles_raw) != article_urls:
        raise HelperError("candidate article sitemap is not the exact canonical slug set")
    model_urls = {BASE_URL + path for path in MODEL_PRICES}
    if not model_urls.issubset(xml_locations((dist / "sitemap-models.xml").read_bytes())):
        raise HelperError("candidate model sitemap misses an affected model URL")
    sitemap_index = xml_locations((dist / "sitemap-index.xml").read_bytes())
    if not {f"{BASE_URL}/sitemap-articles.xml", f"{BASE_URL}/sitemap-models.xml"}.issubset(sitemap_index):
        raise HelperError("candidate sitemap index misses required child sitemaps")
    robots = (dist / "robots.txt").read_text(encoding="utf-8-sig")
    if re.search(r"(?im)^\s*Disallow:\s*/\s*$", robots) or f"Sitemap: {BASE_URL}/sitemap-index.xml" not in robots:
        raise HelperError("candidate robots.txt blocks the site or misses the sitemap index")

    article_pages = []
    for slug in articles["slugs"]:
        route = f"/articles/{slug}"
        page = local_html_path(dist, route)
        safe_regular_file(page, dist)
        evidence = verify_html_page(page.read_bytes(), route)
        if not evidence["valid"]:
            raise HelperError(f"candidate article prerender failed: {slug}")
        article_pages.append(route)
    prerender_pages = sorted(dist.rglob("index.html"))
    canonical_routes = 0
    for page in prerender_pages:
        relative_parent = page.parent.relative_to(dist).as_posix()
        route = "/" if relative_parent == "." else "/" + relative_parent
        fields = seo_fields(parse_html(page.read_bytes()))
        expected_url = BASE_URL + ("/" if route == "/" else route)
        if fields["canonical"] == expected_url and "noindex" not in normalized_robots(fields["robots"]):
            canonical_routes += 1
    if canonical_routes != EXPECTED_PRERENDER_ROUTE_COUNT:
        raise HelperError(f"candidate canonical prerender route count is {canonical_routes}, expected {EXPECTED_PRERENDER_ROUTE_COUNT}")
    return {
        "valid": True, "articles": articles, "seo": candidate_snapshot,
        "article_prerenders": len(article_pages), "prerender_routes": len(prerender_pages), "canonical_prerender_routes": canonical_routes,
        "sitemap_article_count": len(article_urls), "model_urls_verified": len(model_urls),
        "canonical_articles_sha256": sha256_bytes(canonical_raw),
        "dist_articles_sha256": sha256_bytes(candidate_public),
    }


def tree_manifest(root: Path) -> dict[str, Any]:
    safe_directory(root, root)
    files: list[dict[str, Any]] = []
    directory_count = 0
    for current, dir_names, file_names in os.walk(root, followlinks=False):
        current_path = Path(current)
        for name in sorted(dir_names):
            path = current_path / name
            details = os.lstat(path)
            if not stat.S_ISDIR(details.st_mode) or stat.S_ISLNK(details.st_mode):
                raise HelperError(f"candidate contains an unsafe directory: {path}")
            ensure_within(root, path)
            directory_count += 1
        for name in sorted(file_names):
            path = current_path / name
            details = safe_regular_file(path, root)
            files.append({"path": path.relative_to(root).as_posix(), "bytes": details.st_size, "sha256": sha256_file(path)})
            if len(files) > MAX_CANDIDATE_FILES:
                raise HelperError("candidate file-count limit exceeded")
    files.sort(key=lambda item: item["path"])
    return {
        "valid": True, "files": files, "file_count": len(files),
        "directory_count": directory_count, "digest": sha256_bytes(canonical_json(files)),
    }


def write_candidate_archive(dist: Path, manifest: dict[str, Any], artifact_root: Path) -> tuple[Path, Path]:
    manifest_path = artifact_root / "candidate-manifest.json"
    manifest_path.write_bytes(canonical_json(manifest) + b"\n")
    archive_path = artifact_root / "candidate.tar.gz"
    with tarfile.open(archive_path, "w:gz", format=tarfile.PAX_FORMAT) as archive:
        for item in manifest["files"]:
            source = dist / PurePosixPath(item["path"])
            safe_regular_file(source, dist)
            tar_info = tarfile.TarInfo(f"dist/{item['path']}")
            tar_info.size = item["bytes"]
            tar_info.mode = 0o644
            tar_info.uid = 0
            tar_info.gid = 0
            tar_info.uname = ""
            tar_info.gname = ""
            tar_info.mtime = 0
            with source.open("rb") as handle:
                archive.addfile(tar_info, handle)
    if archive_path.stat().st_size > MAX_ARCHIVE_BYTES:
        raise HelperError("candidate archive exceeds fixed size limit")
    return archive_path, manifest_path


def build_candidate(commit: str, snapshot_root: Path, public_baseline: dict[str, Any], canonical: dict[str, Any]) -> dict[str, Any]:
    prove_target_commit(commit)
    artifact_root = snapshot_root.parent
    worktree = artifact_root / "worktree"
    if worktree.exists():
        raise HelperError("isolated worktree path already exists")
    artifact_root.mkdir(parents=True, exist_ok=True)
    added = run_git(["worktree", "add", "--detach", str(worktree), commit], timeout=180)
    if added.returncode != 0:
        raise HelperError(f"cannot create isolated pinned worktree: {added.stderr[-1000:]}")
    build_receipt: dict[str, Any]
    try:
        head = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=worktree, stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8",
            errors="replace", timeout=30, check=False,
        )
        if head.returncode != 0 or head.stdout.strip() != commit:
            raise HelperError("isolated worktree HEAD differs from pinned commit")
        overlay_canonical(snapshot_root, worktree)
        canonical_info = article_info((snapshot_root / "public/api/articles.json").read_bytes(), "canonical")
        cz_validation = validate_articles_cz(snapshot_root, worktree, canonical_info["slugs"])
        npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
        if not npm:
            raise HelperError("fixed local npm runtime is unavailable")
        completed = subprocess.run(
            [npm, "run", "build"], cwd=worktree, stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            encoding="utf-8", errors="replace", timeout=900, check=False,
            env=isolated_build_environment(),
        )
        build_receipt = {
            "command": [Path(npm).name, "run", "build"], "exit_code": completed.returncode,
            "stdout_tail": completed.stdout[-8000:], "stderr_tail": completed.stderr[-8000:],
        }
        if completed.returncode != 0:
            raise HelperError(f"isolated candidate build failed: {completed.stderr[-2000:]}")
        dist = worktree / "dist"
        verification = verify_candidate_dist(dist, snapshot_root, public_baseline)
        manifest = tree_manifest(dist)
        archive_path, manifest_path = write_candidate_archive(dist, manifest, artifact_root)
        candidate = {
            "archive_name": archive_path.name, "archive_sha256": sha256_file(archive_path), "archive_bytes": archive_path.stat().st_size,
            "manifest_name": manifest_path.name, "manifest_sha256": sha256_file(manifest_path),
            "tree_digest": manifest["digest"], "file_count": manifest["file_count"],
            "verification": verification, "articles_cz_validation": cz_validation, "build": build_receipt,
        }
    finally:
        removed = run_git(["worktree", "remove", "--force", str(worktree)], timeout=180)
        if removed.returncode != 0 and worktree.exists():
            raise HelperError(f"cannot remove isolated worktree safely: {removed.stderr[-1000:]}")
    return candidate


def baseline_material(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if key != "baseline_token"}


def calculate_baseline_token(payload: dict[str, Any]) -> str:
    return sha256_bytes(canonical_json(baseline_material(payload)))


def audit() -> tuple[dict[str, Any], Path]:
    client, identity = connect()
    try:
        server = remote_audit(client)
        snapshot_root, canonical = capture_canonical_snapshot(client, server)
    finally:
        client.close()
    public_baseline = public_seo_snapshot(stage="old")
    public_articles = read_http(f"{BASE_URL}/api/articles.json", accept="application/json")
    public_info = article_info(public_articles["raw"], "public-wrapper")
    if public_articles["status"] != 200 or public_articles["final_url"] != public_articles["url"]:
        raise HelperError("public canonical article endpoint is not exact HTTP 200")
    if public_info["sha256"] != canonical["articles"]["sha256"]:
        raise HelperError("public article raw SHA differs from the SFTP canonical snapshot")
    candidate = build_candidate(TARGET_COMMIT, snapshot_root, public_baseline, canonical)

    payload = {key: value for key, value in server.items() if key != "captured_at"}
    payload.update({
        "schema": SCHEMA, "mode": "baseline", "status": "ready", "captured_at": utc_now(),
        "target_commit": TARGET_COMMIT, "release_label": RELEASE_LABEL,
        "identity": identity, "operator_sha256": sha256_bytes(operator_bytes()),
        "canonical_snapshot": canonical, "public_articles": public_info,
        "public_seo_baseline": public_baseline, "candidate": candidate,
        "artifacts": {"root_token": snapshot_root.parent.name, "archive": "candidate.tar.gz", "manifest": "candidate-manifest.json"},
    })
    payload["baseline_token"] = calculate_baseline_token(payload)
    receipt = atomic_json_receipt("rosomaha-main-price-baseline", payload)
    return payload, receipt


def safe_baseline_path(path: Path) -> Path:
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    resolved = ensure_within(REPORT_ROOT, path)
    safe_regular_file(resolved, REPORT_ROOT)
    if not resolved.name.endswith("-rosomaha-main-price-baseline.json"):
        raise HelperError("baseline receipt filename is not fixed")
    return resolved


def load_baseline(path: Path) -> tuple[dict[str, Any], Path, Path, Path]:
    resolved = safe_baseline_path(path)
    payload = json.loads(resolved.read_text(encoding="utf-8"))
    if payload.get("schema") != SCHEMA or payload.get("status") != "ready":
        raise HelperError("baseline receipt schema/status mismatch")
    if payload.get("target_commit") != TARGET_COMMIT or payload.get("release_label") != RELEASE_LABEL:
        raise HelperError("baseline receipt is for another release")
    if payload.get("baseline_token") != calculate_baseline_token(payload):
        raise HelperError("baseline receipt token mismatch")
    if payload.get("operator_sha256") != sha256_bytes(operator_bytes()):
        raise HelperError("fixed operator changed after baseline capture")
    root_token = payload.get("artifacts", {}).get("root_token")
    if not isinstance(root_token, str) or not re.fullmatch(r"[0-9a-f]{16}", root_token):
        raise HelperError("baseline artifact root token is invalid")
    artifact_root = TEMP_ROOT / root_token
    archive = artifact_root / "candidate.tar.gz"
    manifest = artifact_root / "candidate-manifest.json"
    safe_regular_file(archive, TEMP_ROOT)
    safe_regular_file(manifest, TEMP_ROOT)
    candidate = payload["candidate"]
    if sha256_file(archive) != candidate["archive_sha256"] or archive.stat().st_size != candidate["archive_bytes"]:
        raise HelperError("local candidate archive differs from baseline")
    if sha256_file(manifest) != candidate["manifest_sha256"]:
        raise HelperError("local candidate manifest differs from baseline")
    return payload, resolved, archive, manifest


def remote_bundle_path(baseline_token: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{64}", baseline_token):
        raise HelperError("invalid baseline token")
    return f"/tmp/rosomaha-main-price-release-{TARGET_COMMIT[:7]}-{baseline_token[:16]}"


def sftp_assert_missing(sftp: paramiko.SFTPClient, path: str) -> None:
    try:
        sftp.lstat(path)
    except FileNotFoundError:
        return
    except OSError as exc:
        if getattr(exc, "errno", None) == 2:
            return
        raise
    raise HelperError(f"remote bundle path already exists: {path}")


def sftp_upload_file(sftp: paramiko.SFTPClient, local: Path, remote_dir: str, name: str, mode: int) -> None:
    safe_regular_file(local, PROJECT_ROOT if str(local).startswith(str(PROJECT_ROOT)) else TEMP_ROOT)
    final = f"{remote_dir}/{name}"
    temporary = final + ".part"
    sftp_assert_missing(sftp, final)
    sftp_assert_missing(sftp, temporary)
    with local.open("rb") as source, sftp.open(temporary, "xb") as target:
        while True:
            chunk = source.read(1024 * 1024)
            if not chunk:
                break
            target.write(chunk)
    sftp.chmod(temporary, mode)
    sftp.posix_rename(temporary, final)
    attr = sftp.lstat(final)
    if not sftp_regular(attr) or stat.S_IMODE(attr.st_mode) != mode or attr.st_size != local.stat().st_size:
        raise HelperError(f"remote uploaded bundle file topology mismatch: {name}")


def upload_bundle(client: paramiko.SSHClient, baseline_path: Path, archive: Path, manifest: Path, baseline: dict[str, Any]) -> str:
    remote_dir = remote_bundle_path(baseline["baseline_token"])
    sftp = client.open_sftp()
    created = False
    try:
        sftp_assert_missing(sftp, remote_dir)
        sftp.mkdir(remote_dir, mode=0o700)
        created = True
        sftp.chmod(remote_dir, 0o700)
        sftp_upload_file(sftp, baseline_path, remote_dir, "baseline.json", 0o600)
        sftp_upload_file(sftp, archive, remote_dir, "candidate.tar.gz", 0o600)
        sftp_upload_file(sftp, manifest, remote_dir, "candidate-manifest.json", 0o600)
        sftp_upload_file(sftp, OPERATOR_PATH, remote_dir, "operator.sh", 0o700)
        observed = sorted(sftp.listdir(remote_dir))
        expected = sorted(("baseline.json", "candidate.tar.gz", "candidate-manifest.json", "operator.sh"))
        if observed != expected:
            raise HelperError("remote bundle file set mismatch")
        return remote_dir
    except Exception:
        if created:
            cleanup_bundle_sftp(sftp, remote_dir, preserve_on_unknown=True)
        raise
    finally:
        sftp.close()


def cleanup_bundle_sftp(sftp: paramiko.SFTPClient, remote_dir: str, *, preserve_on_unknown: bool = True) -> bool:
    if not re.fullmatch(rf"/tmp/rosomaha-main-price-release-{TARGET_COMMIT[:7]}-[0-9a-f]{{16}}", remote_dir):
        raise HelperError("refusing cleanup outside fixed bundle path")
    try:
        names = sorted(sftp.listdir(remote_dir))
    except FileNotFoundError:
        return True
    allowed = {"baseline.json", "candidate.tar.gz", "candidate-manifest.json", "operator.sh", "apply-receipt.json"}
    if not set(names).issubset(allowed):
        if preserve_on_unknown:
            return False
        raise HelperError("remote bundle has unexpected files")
    for name in names:
        attr = sftp.lstat(f"{remote_dir}/{name}")
        if not sftp_regular(attr):
            if preserve_on_unknown:
                return False
            raise HelperError("remote bundle contains unsafe topology")
    for name in names:
        sftp.remove(f"{remote_dir}/{name}")
    sftp.rmdir(remote_dir)
    return True


def cleanup_bundle(client: paramiko.SSHClient, remote_dir: str) -> bool:
    sftp = client.open_sftp()
    try:
        return cleanup_bundle_sftp(sftp, remote_dir)
    finally:
        sftp.close()


def invoke_operator(client: paramiko.SSHClient, mode: str, remote_dir: str) -> dict[str, Any]:
    if mode not in {"apply", "rollback"}:
        raise HelperError("invalid fixed operator invocation")
    expected = remote_bundle_path(remote_dir.rsplit("-", 1)[-1].ljust(64, "0"))
    if not remote_dir.startswith(expected.rsplit("-", 1)[0] + "-") or not re.fullmatch(rf"/tmp/rosomaha-main-price-release-{TARGET_COMMIT[:7]}-[0-9a-f]{{16}}", remote_dir):
        raise HelperError("invalid fixed bundle invocation path")
    result = run_remote(client, f"bash -s -- {mode} {remote_dir}", operator_bytes(), 360)
    return parse_operator_json(result)


def download_apply_receipt(client: paramiko.SSHClient, remote_dir: str) -> dict[str, Any] | None:
    sftp = client.open_sftp()
    try:
        path = f"{remote_dir}/apply-receipt.json"
        try:
            attr = sftp.lstat(path)
        except FileNotFoundError:
            return None
        if not sftp_regular(attr) or stat.S_IMODE(attr.st_mode) != 0o600 or attr.st_size > 1024 * 1024:
            raise HelperError("unsafe remote apply receipt")
        with sftp.open(path, "rb") as handle:
            return json.loads(handle.read().decode("utf-8"))
    finally:
        sftp.close()


def validate_apply_receipt(receipt: dict[str, Any], baseline: dict[str, Any], operator_result: dict[str, Any] | None = None) -> None:
    if receipt.get("schema") != SCHEMA or receipt.get("status") != "released":
        raise HelperError("apply receipt schema/status mismatch")
    if receipt.get("target_commit") != TARGET_COMMIT or receipt.get("baseline_token") != baseline["baseline_token"]:
        raise HelperError("apply receipt identity mismatch")
    if receipt.get("previous_release") != baseline["current_release"]:
        raise HelperError("apply receipt previous release mismatch")
    new_release = receipt.get("new_release")
    if not isinstance(new_release, str) or not re.fullmatch(rf"{re.escape(APP_ROOT)}/_releases/[0-9]{{8}}-[0-9]{{6}}-{re.escape(RELEASE_LABEL)}", new_release):
        raise HelperError("apply receipt new_release is not the exact labelled release")
    if receipt.get("candidate_tree_digest") != baseline["candidate"]["tree_digest"]:
        raise HelperError("apply receipt candidate digest mismatch")
    if operator_result is not None and operator_result.get("new_release") != new_release:
        raise HelperError("operator result and apply receipt disagree")


def public_verify(baseline: dict[str, Any], *, stage: str) -> dict[str, Any]:
    snapshot = public_seo_snapshot(stage=stage)
    verify_seo_unchanged(baseline["public_seo_baseline"], snapshot)
    response = read_http(f"{BASE_URL}/api/articles.json", accept="application/json")
    articles = article_info(response["raw"], f"public-{stage}")
    expected = baseline["canonical_snapshot"]["articles"]
    if response["status"] != 200 or response["final_url"] != response["url"]:
        raise HelperError("public article endpoint is not exact HTTP 200")
    if articles["sha256"] != expected["sha256"] or articles["slug_digest"] != expected["slug_digest"] or articles["count"] != EXPECTED_ARTICLE_COUNT:
        raise HelperError("public article endpoint is not raw-identical to captured canonical export")

    checks: dict[str, Any] = {}
    for route in ("/robots.txt", "/sitemap-index.xml", "/sitemap-models.xml", "/sitemap-articles.xml"):
        item = read_http(BASE_URL + route, accept="text/plain, application/xml")
        if item["status"] != 200 or item["final_url"] != item["url"]:
            raise HelperError(f"public infrastructure URL is not exact HTTP 200: {route}")
        checks[route] = {"status": item["status"], "sha256": sha256_bytes(item["raw"]), "attempts": item["attempts"]}
    robots_raw = read_http(f"{BASE_URL}/robots.txt", accept="text/plain")["raw"].decode("utf-8-sig")
    if re.search(r"(?im)^\s*Disallow:\s*/\s*$", robots_raw) or f"Sitemap: {BASE_URL}/sitemap-index.xml" not in robots_raw:
        raise HelperError("public robots.txt blocks crawling or misses sitemap index")
    sitemap_articles = read_http(f"{BASE_URL}/sitemap-articles.xml", accept="application/xml")["raw"]
    expected_article_urls = {f"{BASE_URL}/articles/{slug}" for slug in articles["slugs"]}
    if xml_locations(sitemap_articles) != expected_article_urls:
        raise HelperError("public article sitemap differs from canonical slug set")

    article_pages: dict[str, Any] = {}
    for slug in articles["slugs"]:
        route = f"/articles/{slug}"
        item = read_http(BASE_URL + route)
        if item["status"] != 200 or item["final_url"] != item["url"]:
            raise HelperError(f"public canonical article page failed: {slug}")
        evidence = verify_html_page(item["raw"], route)
        if not evidence["valid"]:
            raise HelperError(f"public canonical article SEO failed: {slug}")
        article_pages[slug] = {"status": 200, "canonical": evidence["seo"]["canonical"], "attempts": item["attempts"]}
    return {
        "stage": stage, "verified_at": utc_now(), "valid": True,
        "seo": snapshot, "articles": articles, "infrastructure": checks,
        "article_pages": article_pages, "article_page_count": len(article_pages),
    }


def raw_remote_audit(client: paramiko.SSHClient) -> dict[str, Any]:
    result = run_remote(client, "bash -s -- audit", operator_bytes(), 180)
    lines = [line for line in result["stdout"].splitlines() if line.strip()]
    if not lines:
        raise HelperError("recovery audit returned no JSON")
    try:
        return json.loads(lines[-1])
    except json.JSONDecodeError as exc:
        raise HelperError("recovery audit returned invalid JSON") from exc


def bounded_reconnect() -> tuple[paramiko.SSHClient, dict[str, Any], list[dict[str, Any]]]:
    attempts: list[dict[str, Any]] = []
    last_error: Exception | None = None
    for index in range(3):
        try:
            client, identity = connect()
            attempts.append({"attempt": index + 1, "status": "connected"})
            return client, identity, attempts
        except Exception as exc:
            last_error = exc
            attempts.append({"attempt": index + 1, "status": "failed", "error_type": type(exc).__name__})
            if index < 2:
                time.sleep((1, 3)[index])
    raise HelperError(f"bounded recovery connection failed: {type(last_error).__name__}")


def recovery_audit_matches(
    audit_payload: dict[str, Any], baseline: dict[str, Any], *, expected_current: str, expected_tree_digest: str,
) -> bool:
    expected_article_sha = baseline["articles"]["canonical"]["sha256"]
    articles = audit_payload.get("articles", {})
    return bool(
        audit_payload.get("schema") == SCHEMA
        and audit_payload.get("host") == HOST
        and audit_payload.get("account") == EXPECTED_LOGIN
        and audit_payload.get("target_commit") == TARGET_COMMIT
        and audit_payload.get("topology", {}).get("valid")
        and audit_payload.get("current_release") == expected_current
        and audit_payload.get("current_tree", {}).get("valid")
        and audit_payload.get("current_tree", {}).get("digest") == expected_tree_digest
        and audit_payload.get("staging_dist", {}).get("valid")
        and audit_payload.get("staging_dist", {}).get("digest") == baseline["staging_dist"]["digest"]
        and audit_payload.get("articles_cz", {}).get("valid")
        and audit_payload.get("articles_cz", {}).get("digest") == baseline["articles_cz"]["digest"]
        and audit_payload.get("articles_cz", {}).get("files") == baseline["articles_cz"]["files"]
        and audit_payload.get("release_scripts") == baseline["release_scripts"]
        and all(articles.get(name, {}).get("valid") and articles.get(name, {}).get("sha256") == expected_article_sha for name in ("canonical", "current", "live"))
    )


def classify_recovery_state(audit_payload: dict[str, Any], baseline: dict[str, Any], receipt: dict[str, Any] | None) -> str:
    if receipt is not None:
        new_release = receipt.get("new_release")
        if isinstance(new_release, str) and recovery_audit_matches(
            audit_payload, baseline, expected_current=new_release,
            expected_tree_digest=baseline["candidate"]["tree_digest"],
        ):
            return "released_candidate"
        return "unexpected"
    if recovery_audit_matches(
        audit_payload, baseline, expected_current=baseline["current_release"],
        expected_tree_digest=baseline["current_tree"]["digest"],
    ):
        return "original"
    return "unexpected"


def rollback_and_verify(client: paramiko.SSHClient, remote_dir: str, baseline: dict[str, Any]) -> dict[str, Any]:
    rollback = invoke_operator(client, "rollback", remote_dir)
    if rollback.get("status") != "rolled_back" or rollback.get("current_release") != baseline["current_release"]:
        raise HelperError("fixed rollback did not prove exact baseline release")
    rollback_cz = rollback.get("verification", {}).get("articles_cz", {})
    if rollback_cz.get("digest") != baseline.get("articles_cz", {}).get("digest") or rollback_cz.get("files") != baseline.get("articles_cz", {}).get("files"):
        raise HelperError("fixed rollback did not prove the captured articles-cz baseline")
    verification = public_verify(baseline, stage="old")
    return {"operator": rollback, "public": verification, "status": "rolled_back_verified"}


def recover_ambiguous_apply(remote_dir: str, baseline: dict[str, Any], original_error: Exception) -> tuple[dict[str, Any], bool]:
    recovery_attempts: list[dict[str, Any]] = []
    try:
        client, _identity, connection_attempts = bounded_reconnect()
        recovery_attempts.extend(connection_attempts)
    except Exception as exc:
        payload = {
            "schema": SCHEMA, "status": "ambiguous_apply_requires_recovery", "mode": "apply-recovery",
            "baseline_token": baseline["baseline_token"], "remote_bundle": remote_dir,
            "original_error_type": type(original_error).__name__, "recovery_error_type": type(exc).__name__,
            "bundle_preserved": True, "attempts": recovery_attempts,
        }
        return payload, False
    try:
        audit_payload = raw_remote_audit(client)
        receipt = download_apply_receipt(client, remote_dir)
        current = audit_payload.get("current_release")
        classification = classify_recovery_state(audit_payload, baseline, receipt)
        if receipt is not None:
            validate_apply_receipt(receipt, baseline)
            if current != receipt["new_release"]:
                raise HelperError("recovery current release differs from exact apply receipt")
            if classification != "released_candidate":
                raise HelperError("recovery audit does not prove released tree, staging restore, articles and scripts")
            try:
                verified = public_verify(baseline, stage="new")
                payload = {
                    "schema": SCHEMA, "status": "recovered_verified_success", "mode": "apply-recovery",
                    "baseline_token": baseline["baseline_token"], "apply_receipt": receipt,
                    "public_verify": verified, "attempts": recovery_attempts,
                }
                cleanup_bundle(client, remote_dir)
                return payload, True
            except Exception as verify_error:
                rolled_back = rollback_and_verify(client, remote_dir, baseline)
                payload = {
                    "schema": SCHEMA, "status": "recovered_rolled_back", "mode": "apply-recovery",
                    "baseline_token": baseline["baseline_token"], "apply_receipt": receipt,
                    "verification_error_type": type(verify_error).__name__, "rollback": rolled_back,
                    "attempts": recovery_attempts,
                }
                cleanup_bundle(client, remote_dir)
                return payload, False
        if current == baseline["current_release"]:
            if classification != "original":
                raise HelperError("recovery audit does not prove the exact original state")
            original_public = public_verify(baseline, stage="old")
            cleanup_bundle(client, remote_dir)
            return {
                "schema": SCHEMA, "status": "apply_not_switched", "mode": "apply-recovery",
                "baseline_token": baseline["baseline_token"], "bundle_preserved": False,
                "attempts": recovery_attempts, "public_verify": original_public,
            }, False
        return {
            "schema": SCHEMA, "status": "ambiguous_apply_requires_recovery", "mode": "apply-recovery",
            "baseline_token": baseline["baseline_token"], "remote_bundle": remote_dir,
            "observed_current_release": current, "bundle_preserved": True,
            "reason": "current changed but exact apply receipt is unavailable; apply was not retried",
            "attempts": recovery_attempts,
        }, False
    except Exception as exc:
        return {
            "schema": SCHEMA, "status": "ambiguous_apply_requires_recovery", "mode": "apply-recovery",
            "baseline_token": baseline["baseline_token"], "remote_bundle": remote_dir,
            "bundle_preserved": True, "recovery_error_type": type(exc).__name__,
            "reason": "recovery could not prove a safe terminal state; apply was not retried",
            "attempts": recovery_attempts,
        }, False
    finally:
        client.close()


def apply(commit: str, baseline_path: Path) -> tuple[dict[str, Any], Path]:
    prove_target_commit(commit)
    baseline, resolved_baseline, archive, manifest = load_baseline(baseline_path)
    client, identity = connect()
    remote_dir: str | None = None
    apply_invoked = False
    try:
        fresh = remote_audit(client)
        if fresh["server_baseline_token"] != baseline["server_baseline_token"]:
            raise HelperError("server baseline changed after capture; create a fresh audit receipt")
        preflight = public_verify(baseline, stage="old")
        remote_dir = upload_bundle(client, resolved_baseline, archive, manifest, baseline)
        apply_invoked = True
        try:
            operator_result = invoke_operator(client, "apply", remote_dir)
            receipt = download_apply_receipt(client, remote_dir)
            if receipt is None:
                raise HelperError("operator returned without the exact remote apply receipt")
            validate_apply_receipt(receipt, baseline, operator_result)
            try:
                postflight = public_verify(baseline, stage="new")
            except Exception as verify_error:
                rollback = rollback_and_verify(client, remote_dir, baseline)
                payload = {
                    "schema": SCHEMA, "status": "verification_failed_rolled_back", "mode": "apply",
                    "completed_at": utc_now(), "target_commit": TARGET_COMMIT,
                    "baseline_token": baseline["baseline_token"], "identity": identity,
                    "preflight": preflight, "apply_receipt": receipt,
                    "verification_error_type": type(verify_error).__name__, "rollback": rollback,
                }
                cleanup_bundle(client, remote_dir)
                report = atomic_json_receipt("rosomaha-main-price-release", payload)
                return payload, report
            payload = {
                "schema": SCHEMA, "status": "released_verified", "mode": "apply",
                "completed_at": utc_now(), "target_commit": TARGET_COMMIT,
                "baseline_token": baseline["baseline_token"], "identity": identity,
                "preflight": preflight, "apply_receipt": receipt, "operator": operator_result,
                "public_verify": postflight,
            }
            cleanup_bundle(client, remote_dir)
            report = atomic_json_receipt("rosomaha-main-price-release", payload)
            return payload, report
        except Exception as exc:
            if not apply_invoked or remote_dir is None:
                raise
            client.close()
            recovered, success = recover_ambiguous_apply(remote_dir, baseline, exc)
            report = atomic_json_receipt("rosomaha-main-price-release-recovery", recovered)
            if success:
                return recovered, report
            return recovered, report
    finally:
        client.close()
        if remote_dir is not None and not apply_invoked:
            try:
                cleanup_client, _ = connect()
                try:
                    cleanup_bundle(cleanup_client, remote_dir)
                finally:
                    cleanup_client.close()
            except Exception:
                pass


def argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Fixed main Rosomaha price-release helper")
    parser.add_argument("--apply", action="store_true", help="apply only the exact pinned candidate")
    parser.add_argument("--commit", help="exact pinned commit required with --apply")
    parser.add_argument("--baseline", type=Path, help="captured baseline receipt required with --apply")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = argument_parser().parse_args(argv)
    try:
        if args.apply:
            if args.commit != TARGET_COMMIT or args.baseline is None:
                raise HelperError(f"--apply requires --commit {TARGET_COMMIT} and --baseline <fixed receipt>")
            payload, receipt = apply(args.commit, args.baseline)
            print(json.dumps({"status": payload["status"], "receipt": str(receipt)}, ensure_ascii=False))
            return 0 if payload["status"] in {"released_verified", "recovered_verified_success"} else 2
        if args.commit is not None or args.baseline is not None:
            raise HelperError("--commit/--baseline are accepted only with --apply")
        payload, receipt = audit()
        print(json.dumps({"status": payload["status"], "receipt": str(receipt)}, ensure_ascii=False))
        return 0
    except Exception as exc:
        error = {
            "schema": SCHEMA, "status": "error", "error_type": type(exc).__name__,
            "error": str(exc), "target_commit": TARGET_COMMIT,
        }
        receipt = atomic_json_receipt("rosomaha-main-price-error", error)
        print(json.dumps({"status": "error", "error": str(exc), "receipt": str(receipt)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
