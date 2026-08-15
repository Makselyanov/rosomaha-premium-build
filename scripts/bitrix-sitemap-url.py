#!/usr/bin/env python3
"""Fixed, fail-closed operator for one rosomaha-rus.ru sitemap URL.

The command has no URL, path, host, or account arguments.  It can only audit,
preview, apply, or classify recovery for the single URL pinned below.  The
remote PHP program performs the only write and restores the exact preimage
before returning whenever its local or public sitemap postflight fails.
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
import stat
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Mapping, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

import paramiko


logging.getLogger("paramiko").setLevel(logging.CRITICAL)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = PROJECT_ROOT / ".env"
PHP_SCRIPT = PROJECT_ROOT / "scripts" / "bitrix-sitemap-url.php"
REPORT_ROOT = PROJECT_ROOT / "marketing-audits" / "bitrix-sitemap"

HOST = "ocelot.beget.com"
PORT = 22
EXPECTED_LOGIN = "berkutm4"
EXPECTED_HOST_KEY_SHA256 = "9NXXK7D+NukzmR6c/Ov2rAZElXlr2s1oP0QAAmUWs+c"
SITE_ROOT = "/home/b/berkutm4/rosomaha-rus.ru/public_html"
DOMAIN = "rosomaha-rus.ru"
PUBLIC_ORIGIN = "https://rosomaha-rus.ru"
SITEMAP_URL = f"{PUBLIC_ORIGIN}/sitemap.xml"
ROBOTS_URL = f"{PUBLIC_ORIGIN}/robots.txt"
TARGET_URL = (
    f"{PUBLIC_ORIGIN}/product/"
    "dopolnitelnaya-knopka-vklyucheniya-ventilyatora/"
)
TARGET_PATH = urlparse(TARGET_URL).path
ANCHOR_URL = f"{PUBLIC_ORIGIN}/product/dop-okhlazhdenie-gur/"
ANCHOR_LINE = f"  <url><loc>{ANCHOR_URL}</loc></url>\n".encode("ascii")
TARGET_LINE = f"  <url><loc>{TARGET_URL}</loc></url>\n".encode("ascii")

BASELINE_BYTES = 13_008
BASELINE_SHA256 = "1f191bb1dcc7bfe850b3b0ec64b63a1950d0c7ef865845ce427c08b4faf3f305"
BASELINE_URL_COUNT = 143
CANDIDATE_BYTES = 13_113
CANDIDATE_SHA256 = "11cff13b618473be3ce6e695a8f3654ea9be99983cf7c55f6116fba507b04498"
CANDIDATE_URL_COUNT = 144
OPERATION_ID = "bitrix-sitemap-d415e75c421e2e3c805b0a05"

# The regional path is discovery-only until the exact public byte comparison
# proves it is the backing file.  Both paths are fixed; there are no globs.
BACKING_ALIASES = frozenset({"root_sitemap", "aspro_region_sitemap"})

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
MODEL_URLS = tuple(f"{PUBLIC_ORIGIN}/product/{code}/" for code in MODEL_CODES)
PUBLIC_ALLOWLIST = frozenset((SITEMAP_URL, ROBOTS_URL, TARGET_URL, *MODEL_URLS))

EXPECTED_PHP_SERIES = "8.2"
PHP_CANDIDATES = (
    "/usr/local/php/cgi/8.2/bin/php",
    "/usr/local/php/8.2/bin/php",
    "/usr/local/php82/bin/php",
    "/opt/php/8.2/bin/php",
    "/usr/bin/php8.2",
    "/usr/local/bin/php8.2",
)

MAX_PUBLIC_BODY = 2_000_000
MAX_SITEMAP_BODY = 256_000
MAX_REMOTE_STDOUT = 64_000
MAX_REMOTE_STDERR = 16_000
MAX_REMOTE_SECONDS = 90
MAX_RECEIPT_BYTES = 2_000_000
USER_AGENT = "RosomahaFixedSitemapUrl/1.0"
XML_NAMESPACE = "http://www.sitemaps.org/schemas/sitemap/0.9"
OWNED_FILES = (
    "scripts/bitrix-sitemap-url.py",
    "scripts/bitrix-sitemap-url.php",
    "scripts/bitrix-sitemap-url.test.py",
    "package.json",
)


class SitemapOperatorError(RuntimeError):
    """A bounded, non-secret operator error."""


class CredentialError(SitemapOperatorError):
    """Pinned Beget credentials are missing or ambiguous."""


class PublicReadError(SitemapOperatorError):
    """A fixed public endpoint did not satisfy the read contract."""


class RemoteReportedError(SitemapOperatorError):
    """The fixed remote operator returned a bounded error receipt."""

    def __init__(self, code: str, payload: Mapping[str, Any]) -> None:
        super().__init__(f"Remote operator error_code={code}; run read-only recover")
        self.payload = json.loads(json.dumps(dict(payload), ensure_ascii=False))


class RejectRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        raise PublicReadError("A fixed public endpoint redirected")


class SeoHeadParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.canonicals: list[str] = []
        self.robots: list[str] = []
        self.links: list[str] = []
        self.nodes = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.nodes += 1
        if self.nodes > 60_000:
            raise ValueError("HTML node bound exceeded")
        values = {name.lower(): value or "" for name, value in attrs}
        lower_tag = tag.lower()
        if lower_tag == "link" and "canonical" in values.get("rel", "").lower().split():
            self.canonicals.append(values.get("href", ""))
        elif lower_tag == "meta" and values.get("name", "").lower() in {
            "robots", "googlebot", "yandex",
        }:
            self.robots.append(values.get("content", ""))
        elif lower_tag == "a" and values.get("href"):
            self.links.append(values["href"])


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_error(exc: BaseException) -> str:
    text = str(exc) or type(exc).__name__
    for sensitive in (EXPECTED_LOGIN, SITE_ROOT, str(ENV_PATH)):
        text = text.replace(sensitive, "[pinned]")
    text = re.sub(r"(?i)(password|token|secret)\s*[=:]\s*\S+", r"\1=[redacted]", text)
    return f"{type(exc).__name__}: {text}"[:500]


def _parse_env_value(raw: str) -> str:
    value = raw.strip()
    if not value:
        raise CredentialError("Pinned credential value is empty")
    if value[0] in {'\"', "'"}:
        if len(value) < 2 or value[-1] != value[0]:
            raise CredentialError("Pinned credential quoting is malformed")
        value = value[1:-1]
    elif value[-1:] in {'\"', "'"}:
        raise CredentialError("Pinned credential quoting is malformed")
    if not value or "\r" in value or "\n" in value:
        raise CredentialError("Pinned credential value is invalid")
    return value


def credentials_from_text(text: str) -> tuple[str, str]:
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
        if hostname != HOST:
            raise paramiko.SSHException("Unexpected SSH host")
        fingerprint = base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode(
            "ascii"
        ).rstrip("=")
        if fingerprint != EXPECTED_HOST_KEY_SHA256:
            raise paramiko.SSHException("Beget SSH host key mismatch")
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
            raise SitemapOperatorError("SSH transport is unavailable")
        fingerprint = base64.b64encode(
            hashlib.sha256(transport.get_remote_server_key().asbytes()).digest()
        ).decode("ascii").rstrip("=")
        if fingerprint != EXPECTED_HOST_KEY_SHA256:
            raise SitemapOperatorError("Beget SSH host key mismatch")
        return client
    except Exception:
        client.close()
        raise


def _read_bounded(stream, limit: int) -> bytes:  # noqa: ANN001
    data = stream.read(limit + 1)
    if len(data) > limit:
        raise SitemapOperatorError("Bounded stream exceeded its limit")
    return data


def fetch_fixed(url: str, *, max_bytes: int = MAX_PUBLIC_BODY) -> dict[str, Any]:
    if url not in PUBLIC_ALLOWLIST:
        raise ValueError("Public URL is outside the fixed allowlist")
    parsed = urlparse(url)
    if (
        parsed.scheme != "https"
        or parsed.netloc != DOMAIN
        or parsed.query
        or parsed.fragment
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port is not None
    ):
        raise ValueError("Public URL identity is invalid")
    request = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/xml,text/xml,text/html,text/plain;q=0.8",
            "Cache-Control": "no-cache",
        },
    )
    opener = build_opener(RejectRedirects())
    try:
        with opener.open(request, timeout=30) as response:
            body = _read_bounded(response, max_bytes)
            status = int(response.status)
            final_url = response.geturl()
            headers = {name.lower(): value for name, value in response.headers.items()}
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        raise PublicReadError(f"Fixed public read failed: {type(exc).__name__}") from exc
    if status != 200 or final_url != url or not body:
        raise PublicReadError("Fixed public endpoint identity/status is invalid")
    return {"url": url, "status": status, "body": body, "headers": headers}


def parse_sitemap(body: bytes) -> list[str]:
    if not body or len(body) > MAX_SITEMAP_BODY:
        raise SitemapOperatorError("Sitemap byte size is invalid")
    if body.startswith(b"\xef\xbb\xbf") or b"\r" in body:
        raise SitemapOperatorError("Sitemap must preserve the pinned LF-only UTF-8 form")
    lowered = body.lower()
    if b"<!doctype" in lowered or b"<!entity" in lowered:
        raise SitemapOperatorError("Sitemap declarations are not allowed")
    try:
        root = ET.fromstring(body)
    except ET.ParseError as exc:
        raise SitemapOperatorError("Sitemap XML is malformed") from exc
    if root.tag != f"{{{XML_NAMESPACE}}}urlset":
        raise SitemapOperatorError("Sitemap root/namespace is invalid")
    urls: list[str] = []
    for child in root:
        if child.tag != f"{{{XML_NAMESPACE}}}url":
            raise SitemapOperatorError("Sitemap contains a non-url child")
        locs = [item for item in child if item.tag == f"{{{XML_NAMESPACE}}}loc"]
        if len(locs) != 1 or locs[0].text is None:
            raise SitemapOperatorError("Sitemap URL lacks one exact loc")
        value = locs[0].text
        parsed = urlparse(value)
        if (
            value != value.strip()
            or parsed.scheme != "https"
            or parsed.netloc != DOMAIN
            or parsed.username is not None
            or parsed.password is not None
            or parsed.port is not None
            or parsed.query
            or parsed.fragment
        ):
            raise SitemapOperatorError("Sitemap loc is outside the canonical host contract")
        urls.append(value)
    if len(urls) != len(set(urls)):
        raise SitemapOperatorError("Sitemap contains duplicate loc values")
    return urls


def classify_sitemap(body: bytes) -> dict[str, Any]:
    digest = sha256_bytes(body)
    urls = parse_sitemap(body)
    target_count = urls.count(TARGET_URL)
    if (
        len(body) == BASELINE_BYTES
        and digest == BASELINE_SHA256
        and len(urls) == BASELINE_URL_COUNT
        and target_count == 0
    ):
        state = "baseline"
    elif (
        len(body) == CANDIDATE_BYTES
        and digest == CANDIDATE_SHA256
        and len(urls) == CANDIDATE_URL_COUNT
        and target_count == 1
    ):
        state = "candidate"
    else:
        raise SitemapOperatorError("Public sitemap differs from both pinned safe states")
    return {
        "state": state,
        "bytes": len(body),
        "sha256": digest,
        "url_count": len(urls),
        "unique_url_count": len(set(urls)),
        "target_count": target_count,
        "urls": urls,
    }


def insert_target_line(baseline: bytes) -> bytes:
    """Perform the only permitted byte edit, preserving the LF-only preimage."""
    if b"\r" in baseline:
        raise SitemapOperatorError("Candidate construction refuses mixed/CRLF newlines")
    if baseline.count(ANCHOR_LINE) != 1 or baseline.count(TARGET_LINE) != 0:
        raise SitemapOperatorError("Pinned insertion anchor/target line contract failed")
    return baseline.replace(ANCHOR_LINE, ANCHOR_LINE + TARGET_LINE, 1)


def build_candidate(baseline: bytes) -> bytes:
    before = classify_sitemap(baseline)
    if before["state"] != "baseline":
        raise SitemapOperatorError("Candidate construction requires the pinned baseline")
    candidate = insert_target_line(baseline)
    after = classify_sitemap(candidate)
    if after["state"] != "candidate":
        raise SitemapOperatorError("Candidate bytes differ from the pinned canonical candidate")
    old_urls = set(before["urls"])
    new_urls = set(after["urls"])
    if new_urls - old_urls != {TARGET_URL} or old_urls - new_urls:
        raise SitemapOperatorError("Candidate URL-set diff is not exactly +1/-0")
    return candidate


def _parse_html(body: bytes) -> SeoHeadParser:
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise SitemapOperatorError("Public HTML is not UTF-8") from exc
    parser = SeoHeadParser()
    try:
        parser.feed(text)
        parser.close()
    except (ValueError, AssertionError) as exc:
        raise SitemapOperatorError("Public HTML parser bound failed") from exc
    return parser


def audit_target_page() -> dict[str, Any]:
    result = fetch_fixed(TARGET_URL)
    parser = _parse_html(result["body"])
    canonicals = [urljoin(TARGET_URL, html.unescape(item)) for item in parser.canonicals]
    directives = {
        token.strip().lower()
        for value in parser.robots
        for token in value.split(",")
        if token.strip()
    }
    x_robots = result["headers"].get("x-robots-tag", "").lower()
    ok = canonicals == [TARGET_URL] and "noindex" not in directives and "noindex" not in x_robots
    return {
        "status": result["status"],
        "canonical": canonicals[0] if len(canonicals) == 1 else None,
        "canonical_count": len(canonicals),
        "indexable": "noindex" not in directives and "noindex" not in x_robots,
        "ok": ok,
    }


def _robots_allows_target(text: str) -> bool:
    groups: list[tuple[list[str], list[tuple[str, str]]]] = []
    agents: list[str] = []
    rules: list[tuple[str, str]] = []
    saw_rule = False

    def flush() -> None:
        nonlocal agents, rules, saw_rule
        if agents:
            groups.append((agents, rules))
        agents, rules, saw_rule = [], [], False

    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            if saw_rule:
                flush()
            continue
        if ":" not in line:
            continue
        name, value = (part.strip() for part in line.split(":", 1))
        lower_name = name.lower()
        if lower_name == "user-agent":
            if saw_rule:
                flush()
            agents.append(value.lower())
        elif agents and lower_name in {"allow", "disallow"}:
            saw_rule = True
            if value:
                rules.append((lower_name, value))
    flush()

    matches: list[tuple[int, bool]] = []
    for group_agents, group_rules in groups:
        if "*" not in group_agents:
            continue
        for kind, pattern in group_rules:
            escaped = re.escape(pattern).replace(r"\*", ".*")
            if pattern.endswith("$"):
                escaped = escaped[:-2] + "$"
            if re.match(escaped, TARGET_PATH):
                matches.append((len(pattern), kind == "allow"))
    if matches:
        longest = max(length for length, _ in matches)
        return any(allowed for length, allowed in matches if length == longest)
    return True


def audit_robots() -> dict[str, Any]:
    result = fetch_fixed(ROBOTS_URL, max_bytes=256_000)
    try:
        text = result["body"].decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise SitemapOperatorError("robots.txt is not UTF-8") from exc
    sitemap_lines = [
        line.strip()
        for line in text.splitlines()
        if line.strip().lower().startswith("sitemap:")
    ]
    expected = f"Sitemap: {SITEMAP_URL}"
    return {
        "status": result["status"],
        "sitemap_declared": expected in sitemap_lines,
        "target_allowed": _robots_allows_target(text),
        "ok": expected in sitemap_lines and _robots_allows_target(text),
    }


def _model_link_check(url: str) -> dict[str, Any]:
    result = fetch_fixed(url)
    parser = _parse_html(result["body"])
    exact = [urljoin(url, html.unescape(item)) for item in parser.links].count(TARGET_URL)
    return {"url": url, "status": result["status"], "target_link_count": exact, "ok": exact >= 1}


def audit_model_links() -> dict[str, Any]:
    pages: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(_model_link_check, url): url for url in MODEL_URLS}
        for future in as_completed(futures):
            pages.append(future.result())
    pages.sort(key=lambda item: MODEL_URLS.index(item["url"]))
    ok = len(pages) == 12 and all(item["ok"] for item in pages)
    return {"expected_pages": 12, "verified_pages": len(pages), "pages": pages, "ok": ok}


def public_audit(*, expected_state: str | None = None) -> tuple[dict[str, Any], bytes]:
    sitemap_response = fetch_fixed(SITEMAP_URL, max_bytes=MAX_SITEMAP_BODY)
    sitemap = classify_sitemap(sitemap_response["body"])
    sitemap.pop("urls")
    if expected_state is not None and sitemap["state"] != expected_state:
        raise SitemapOperatorError("Public sitemap is not in the expected fixed state")
    target = audit_target_page()
    robots = audit_robots()
    models = audit_model_links()
    if not target["ok"] or not robots["ok"] or not models["ok"]:
        raise SitemapOperatorError("Public SEO pre/postflight failed")
    return {
        "sitemap": sitemap,
        "target_page": target,
        "robots": robots,
        "model_links": models,
        "ok": True,
    }, sitemap_response["body"]


def validate_php_source(data: bytes) -> str:
    if not data or len(data) > 128_000:
        raise SitemapOperatorError("Pinned PHP operator size is invalid")
    try:
        source = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise SitemapOperatorError("Pinned PHP operator is not UTF-8") from exc
    required = (
        "ROSOMAHA_SITEMAP_BASELINE_SHA256",
        BASELINE_SHA256,
        CANDIDATE_SHA256,
        TARGET_URL,
        "aspro_regions/sitemap/sitemap_rosomaha-rus.ru.xml",
        "function rosomahaSitemapAtomicReplace",
        "function rosomahaSitemapRestore",
        "function rosomahaSitemapPublicReadback",
        "rename(",
        "fsync(",
        "flock(",
    )
    if not source.startswith("<?php") or any(item not in source for item in required):
        raise SitemapOperatorError("Pinned PHP operator identity is incomplete")
    forbidden = (
        r"\b(?:exec|system|shell_exec|passthru|proc_open|popen)\s*\(",
        r"\b(?:mysqli|PDO|CIBlock|CSiteMap)\b",
        r"glob\s*\(",
    )
    if any(re.search(pattern, source, flags=re.IGNORECASE) for pattern in forbidden):
        raise SitemapOperatorError("Pinned PHP operator contains a forbidden surface")
    return sha256_bytes(data)


def _canonical_json(value: Mapping[str, Any]) -> bytes:
    data = json.dumps(dict(value), ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    if not data or len(data) > 64_000:
        raise SitemapOperatorError("Remote request size is invalid")
    return data


def build_remote_command(mode: str, public_body: bytes, php_bytes: bytes) -> str:
    if mode not in {"audit", "dry-run", "apply", "recover"}:
        raise ValueError("Remote mode is outside the fixed allowlist")
    public_state = classify_sitemap(public_body)["state"]
    if mode in {"dry-run", "apply"} and public_state != "baseline":
        raise SitemapOperatorError("Mutation preparation requires the exact baseline")
    candidate = build_candidate(public_body) if public_state == "baseline" else b""
    request_payload = {
        "schema": 1,
        "mode": mode,
        "operation_id": OPERATION_ID,
        "public_body_b64": base64.b64encode(public_body).decode("ascii"),
        "public_bytes": len(public_body),
        "public_sha256": sha256_bytes(public_body),
        "candidate_sha256": CANDIDATE_SHA256 if candidate else CANDIDATE_SHA256,
    }
    request = _canonical_json(request_payload)
    request_b64 = base64.b64encode(request).decode("ascii")
    request_sha = sha256_bytes(request)
    php_sha = validate_php_source(php_bytes)
    php_b64 = base64.b64encode(php_bytes).decode("ascii")
    candidates = " ".join(f"'{item}'" for item in PHP_CANDIDATES)
    command = f"""
set -eu
php_payload='{php_b64}'
request_payload='{request_b64}'
php_sha="$(printf '%s' "$php_payload" | /usr/bin/base64 -d | /usr/bin/sha256sum | /usr/bin/awk '{{print $1}}')"
request_sha="$(printf '%s' "$request_payload" | /usr/bin/base64 -d | /usr/bin/sha256sum | /usr/bin/awk '{{print $1}}')"
test "$php_sha" = '{php_sha}'
test "$request_sha" = '{request_sha}'
test "$(/usr/bin/realpath -- '{SITE_ROOT}')" = '{SITE_ROOT}'
php_binary=''
for candidate in {candidates}; do
  if [ -x "$candidate" ]; then
    version="$("$candidate" -r 'echo PHP_VERSION;' 2>/dev/null || true)"
    case "$version" in
      {EXPECTED_PHP_SERIES}.*) php_binary="$candidate"; break ;;
    esac
  fi
done
test -n "$php_binary"
printf '%s' "$php_payload" | /usr/bin/base64 -d | /usr/bin/timeout {MAX_REMOTE_SECONDS}s "$php_binary" \
  -d display_errors=stderr -d log_errors=0 -- '{mode}' "$request_payload" '{request_sha}'
""".strip()
    if len(command.encode("utf-8")) > 120_000:
        raise SitemapOperatorError("Remote command exceeds the fixed bound")
    return command


def _bounded_channel_result(channel, timeout_seconds: int) -> tuple[int, bytes, bytes]:  # noqa: ANN001
    stdout = bytearray()
    stderr = bytearray()
    deadline = time.monotonic() + timeout_seconds
    while True:
        while channel.recv_ready():
            stdout.extend(channel.recv(16_384))
            if len(stdout) > MAX_REMOTE_STDOUT:
                channel.close()
                raise SitemapOperatorError("Remote stdout exceeded its bound")
        while channel.recv_stderr_ready():
            stderr.extend(channel.recv_stderr(8_192))
            if len(stderr) > MAX_REMOTE_STDERR:
                channel.close()
                raise SitemapOperatorError("Remote stderr exceeded its bound")
        if channel.exit_status_ready():
            while channel.recv_ready():
                stdout.extend(channel.recv(16_384))
            while channel.recv_stderr_ready():
                stderr.extend(channel.recv_stderr(8_192))
            if len(stdout) > MAX_REMOTE_STDOUT or len(stderr) > MAX_REMOTE_STDERR:
                raise SitemapOperatorError("Remote output exceeded its bound")
            return channel.recv_exit_status(), bytes(stdout), bytes(stderr)
        if time.monotonic() >= deadline:
            channel.close()
            raise SitemapOperatorError("Remote command timed out; run read-only recover")
        time.sleep(0.1)


def parse_remote_frame(stdout: bytes, status: int) -> dict[str, Any]:
    try:
        text = stdout.decode("ascii")
    except UnicodeDecodeError as exc:
        raise SitemapOperatorError("Remote frame is not ASCII") from exc
    lines = [line for line in text.splitlines() if line]
    prefixes = (
        "__ROSOMAHA_SITEMAP_JSON_BYTES__=",
        "__ROSOMAHA_SITEMAP_JSON_SHA256__=",
        "__ROSOMAHA_SITEMAP_JSON_BASE64__=",
    )
    if len(lines) != 3 or any(not line.startswith(prefix) for line, prefix in zip(lines, prefixes)):
        raise SitemapOperatorError("Remote response frame is invalid")
    try:
        declared_bytes = int(lines[0][len(prefixes[0]):])
        declared_sha = lines[1][len(prefixes[1]):]
        raw = base64.b64decode(lines[2][len(prefixes[2]):], validate=True)
    except (ValueError, TypeError) as exc:
        raise SitemapOperatorError("Remote response frame could not be decoded") from exc
    if len(raw) != declared_bytes or sha256_bytes(raw) != declared_sha:
        raise SitemapOperatorError("Remote response frame integrity failed")
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SitemapOperatorError("Remote response JSON is malformed") from exc
    if not isinstance(payload, dict) or "remote_exit_status" in payload:
        raise SitemapOperatorError("Remote response object is invalid")
    payload["remote_exit_status"] = status
    return payload


def execute_remote(mode: str, public_body: bytes) -> dict[str, Any]:
    php_bytes = PHP_SCRIPT.read_bytes()
    command = build_remote_command(mode, public_body, php_bytes)
    client = connect()
    try:
        # Exactly one exec request.  There is deliberately no retry loop.
        _, stdout, _ = client.exec_command(command, timeout=20)
        status, output, error = _bounded_channel_result(stdout.channel, MAX_REMOTE_SECONDS + 15)
    finally:
        client.close()
    return interpret_remote_response(mode, output, status, error)


def interpret_remote_response(
    mode: str, output: bytes, status: int, error: bytes
) -> dict[str, Any]:
    """Couple the framed result, exit status, and redacted stderr evidence."""
    payload = parse_remote_frame(output, status)
    payload["remote_exit_status"] = status
    if error:
        payload["stderr_sha256"] = sha256_bytes(error)
        payload["stderr_bytes"] = len(error)
    else:
        payload["stderr_sha256"] = None
        payload["stderr_bytes"] = 0
    if payload.get("status") == "error":
        code = payload.get("error_code")
        if (
            payload.get("schema") != 1
            or payload.get("mode") != mode
            or payload.get("operation_id") != OPERATION_ID
            or status != 1
            or not isinstance(code, str)
            or re.fullmatch(r"[a-z0-9_]{3,64}", code) is None
        ):
            raise SitemapOperatorError("Remote error frame identity is invalid")
        raise RemoteReportedError(code, payload)
    if status != 0 or error:
        raise SitemapOperatorError("Remote success/status/stderr coupling is invalid")
    return validate_remote_payload(payload, expected_mode=mode)


def validate_remote_payload(payload: Mapping[str, Any], *, expected_mode: str) -> dict[str, Any]:
    root = dict(payload)
    if (
        root.get("schema") != 1
        or root.get("mode") != expected_mode
        or root.get("operation_id") != OPERATION_ID
        or root.get("domain") != DOMAIN
        or root.get("site_root_identity") != "pinned_rosomaha_rus_docroot"
        or root.get("generator_used") is not False
        or root.get("database_used") is not False
        or root.get("robots_changed") is not False
        or root.get("remote_exit_status") != 0
        or root.get("stderr_bytes") != 0
        or root.get("stderr_sha256") is not None
    ):
        raise SitemapOperatorError("Remote identity/scope contract failed")
    active = root.get("active_backing")
    if not isinstance(active, dict) or active.get("alias") not in BACKING_ALIASES:
        raise SitemapOperatorError("Remote active backing is outside the fixed allowlist")
    if active.get("exact_public_byte_match") is not True or active.get("regular_non_symlink") is not True:
        raise SitemapOperatorError("Remote backing proof is incomplete")
    before = root.get("before")
    after = root.get("after")
    if not isinstance(before, dict) or not isinstance(after, dict):
        raise SitemapOperatorError("Remote state evidence is incomplete")
    valid_states = {
        (BASELINE_SHA256, BASELINE_BYTES, BASELINE_URL_COUNT, 0),
        (CANDIDATE_SHA256, CANDIDATE_BYTES, CANDIDATE_URL_COUNT, 1),
    }
    for item in (before, after):
        observed = (item.get("sha256"), item.get("bytes"), item.get("url_count"), item.get("target_count"))
        if observed not in valid_states or item.get("unique_url_count") != item.get("url_count"):
            raise SitemapOperatorError("Remote sitemap state is outside the fixed states")
    mutations = root.get("filesystem_mutations")
    if type(mutations) is not int or mutations < 0 or mutations > 2:
        raise SitemapOperatorError("Remote mutation count is invalid")
    if expected_mode in {"audit", "dry-run", "recover"} and mutations != 0:
        raise SitemapOperatorError("Read-only remote mode reported a mutation")
    if expected_mode == "dry-run" and (
        root.get("status") != "ready"
        or active.get("alias") != "root_sitemap"
        or active.get("write_authorized") is not True
        or root.get("diff") != {"added": [TARGET_URL], "removed": []}
    ):
        raise SitemapOperatorError("Remote dry-run diff is not exactly +1/-0")
    if expected_mode == "apply":
        if (
            root.get("status") != "applied"
            or mutations != 1
            or active.get("alias") != "root_sitemap"
            or active.get("write_authorized") is not True
            or root.get("diff") != {"added": [TARGET_URL], "removed": []}
        ):
            raise SitemapOperatorError("Remote apply did not prove one atomic replacement")
        if before.get("sha256") != BASELINE_SHA256 or after.get("sha256") != CANDIDATE_SHA256:
            raise SitemapOperatorError("Remote apply before/after is invalid")
        backup = root.get("backup")
        if not isinstance(backup, dict) or backup.get("sha256") != BASELINE_SHA256 or backup.get("bytes") != BASELINE_BYTES:
            raise SitemapOperatorError("Remote exact backup proof is incomplete")
        if root.get("public_readback") != {
            "bytes": CANDIDATE_BYTES,
            "sha256": CANDIDATE_SHA256,
            "exact_candidate": True,
        }:
            raise SitemapOperatorError("Remote public sitemap readback is invalid")
    if expected_mode == "recover" and root.get("classification") not in {
        "not_started", "backup_only_not_started", "active_complete",
        "rolled_back", "indeterminate",
    }:
        raise SitemapOperatorError("Remote recovery classification is invalid")
    return json.loads(json.dumps(root, ensure_ascii=False))


def _contains_forbidden_key(value: Any) -> bool:
    if isinstance(value, dict):
        for key, item in value.items():
            if re.search(r"(?i)password|token|secret|credential", str(key)):
                return True
            if _contains_forbidden_key(item):
                return True
    elif isinstance(value, list):
        return any(_contains_forbidden_key(item) for item in value)
    return False


def write_receipt(kind: str, payload: Mapping[str, Any]) -> Path:
    if not re.fullmatch(r"[a-z-]{3,24}", kind) or _contains_forbidden_key(payload):
        raise SitemapOperatorError("Receipt payload is unsafe")
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%fZ")
    path = REPORT_ROOT / f"ROSOMAHA_BITRIX_SITEMAP_{stamp}_{kind.upper()}.json"
    body = json.dumps(dict(payload), ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
    if len(body) > MAX_RECEIPT_BYTES:
        raise SitemapOperatorError("Receipt exceeds its fixed bound")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    fd = os.open(path, flags, 0o600)
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
        ["git", "rev-parse", "HEAD"], cwd=PROJECT_ROOT, check=True,
        capture_output=True, text=True, encoding="utf-8"
    )
    head = result.stdout.strip()
    if re.fullmatch(r"[a-f0-9]{40}", head) is None:
        raise SitemapOperatorError("Git HEAD is invalid")
    return head


def require_committed_operator() -> str:
    subprocess.run(
        ["git", "diff", "--quiet", "HEAD", "--", *OWNED_FILES],
        cwd=PROJECT_ROOT, check=True,
    )
    for name in OWNED_FILES:
        subprocess.run(
            ["git", "ls-files", "--error-unmatch", "--", name],
            cwd=PROJECT_ROOT, check=True, capture_output=True,
        )
    return git_head()


def _receipt_base(mode: str) -> dict[str, Any]:
    return {
        "schema": 1,
        "mode": mode,
        "operation_id": OPERATION_ID,
        "created_at_utc": utc_now(),
        "domain": DOMAIN,
        "target_url": TARGET_URL,
        "baseline": {"bytes": BASELINE_BYTES, "sha256": BASELINE_SHA256, "url_count": BASELINE_URL_COUNT},
        "candidate": {"bytes": CANDIDATE_BYTES, "sha256": CANDIDATE_SHA256, "url_count": CANDIDATE_URL_COUNT},
        "sensitive_values_exported": False,
        "generator_used": False,
    }


def run_audit() -> tuple[dict[str, Any], Path]:
    public, body = public_audit()
    remote = execute_remote("audit", body)
    payload = _receipt_base("audit") | {"status": "ok", "public": public, "remote": remote}
    return payload, write_receipt("audit", payload)


def run_dry_run() -> tuple[dict[str, Any], Path]:
    public, body = public_audit(expected_state="baseline")
    candidate = build_candidate(body)
    remote = execute_remote("dry-run", body)
    payload = _receipt_base("dry-run") | {
        "status": "ready",
        "public": public,
        "remote": remote,
        "candidate_recomputed": {"bytes": len(candidate), "sha256": sha256_bytes(candidate)},
        "diff": {"added": [TARGET_URL], "removed": []},
    }
    return payload, write_receipt("dry-run", payload)


def run_apply() -> tuple[dict[str, Any], Path]:
    head = require_committed_operator()
    public_before, body = public_audit(expected_state="baseline")
    candidate = build_candidate(body)
    pending = _receipt_base("apply") | {
        "status": "pending",
        "git_head": head,
        "php_sha256": validate_php_source(PHP_SCRIPT.read_bytes()),
        "public_before": public_before,
        "candidate_recomputed": {"bytes": len(candidate), "sha256": sha256_bytes(candidate)},
        "dispatch_limit": 1,
    }
    pending_path = write_receipt("pending", pending)
    remote = execute_remote("apply", body)
    public_after, after_body = public_audit(expected_state="candidate")
    if after_body != candidate:
        raise SitemapOperatorError("Independent public candidate bytes differ after apply")
    payload = _receipt_base("apply") | {
        "status": "applied",
        "git_head": head,
        "pending_receipt": pending_path.name,
        "remote": remote,
        "public_before": public_before,
        "public_after": public_after,
        "apply_dispatches": 1,
    }
    return payload, write_receipt("apply", payload)


def run_recover() -> tuple[dict[str, Any], Path]:
    public, body = public_audit()
    remote = execute_remote("recover", body)
    payload = _receipt_base("recover") | {
        "status": remote["classification"],
        "read_only": True,
        "public": public,
        "remote": remote,
    }
    return payload, write_receipt("recover", payload)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fixed one-URL Bitrix sitemap operator")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--audit", action="store_true")
    group.add_argument("--dry-run", action="store_true")
    group.add_argument("--apply", action="store_true")
    group.add_argument("--recover", action="store_true")
    return parser.parse_args(list(sys.argv[1:] if argv is None else argv))


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.audit:
            payload, receipt = run_audit()
        elif args.dry_run:
            payload, receipt = run_dry_run()
        elif args.apply:
            payload, receipt = run_apply()
        else:
            payload, receipt = run_recover()
        print(json.dumps({"status": payload["status"], "receipt": str(receipt)}, ensure_ascii=False))
        return 0
    except Exception as exc:  # bounded CLI boundary
        error = _receipt_base("error") | {"status": "error", "error": safe_error(exc)}
        if isinstance(exc, RemoteReportedError):
            error["remote_error"] = exc.payload
        try:
            receipt = write_receipt("error", error)
            suffix = f"; receipt={receipt}"
        except Exception:
            suffix = ""
        print(f"Ошибка фиксированной операции sitemap: {safe_error(exc)}{suffix}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
