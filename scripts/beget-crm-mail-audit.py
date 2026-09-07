#!/usr/bin/env python3
"""Read-only pinned mailbox existence audit; never prints provider responses."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import ssl
import sys
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, HTTPSHandler, ProxyHandler, Request, build_opener


ENDPOINT = "https://api.beget.com/api/mail/getMailboxList"
DOMAIN_ENDPOINT = "https://api.beget.com/api/domain/getList"
DOMAIN = "rosomaha.site"
MAILBOX = "crm"
ENV_PATH = Path("G:/mvp/rosomaha/.env")
MAX_RESPONSE_BYTES = 1024 * 1024


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("redirect_refused")


def audit() -> tuple[dict, int]:
    # Reuse the reviewed account-pinning loader, with no environment overrides.
    loader_path = Path(__file__).resolve().with_name("bitrix-metrika-bridge-deploy.py")
    spec = importlib.util.spec_from_file_location("beget_pinned_credential_loader", loader_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("loader_unavailable")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    login, password = module.load_credentials(environ={}, env_path=ENV_PATH)
    if login != "berkutm4":
        raise RuntimeError("account_mismatch")

    domains = read_result(DOMAIN_ENDPOINT, login, password, {})
    if any(not isinstance(row, dict) or not isinstance(row.get("fqdn"), str) for row in domains):
        raise RuntimeError("unexpected_domain_schema")
    owned = any(row["fqdn"] == DOMAIN for row in domains)
    rows = read_result(ENDPOINT, login, password, {"domain": DOMAIN})
    if any(
        not isinstance(row, dict)
        or row.get("domain") != DOMAIN
        or not isinstance(row.get("mailbox"), str)
        for row in rows
    ):
        raise RuntimeError("unexpected_schema")
    return {
        "status": "ok",
        "owned": owned,
        "target_exists": any(row["mailbox"] == MAILBOX for row in rows),
        "count": len(rows),
    }, 0


def read_result(endpoint: str, login: str, password: str, parameters: dict) -> list:
    if endpoint not in (ENDPOINT, DOMAIN_ENDPOINT):
        raise RuntimeError("endpoint_refused")
    body = urlencode({
        "login": login,
        "passwd": password,
        "input_format": "json",
        "output_format": "json",
        "input_data": json.dumps(parameters),
    }).encode("ascii")
    request = Request(
        endpoint,
        data=body,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
    )
    opener = build_opener(
        ProxyHandler({}), NoRedirect(), HTTPSHandler(context=ssl.create_default_context()),
    )
    with opener.open(request, timeout=20) as response:
        if response.status != 200 or response.geturl() != endpoint:
            raise RuntimeError("unexpected_response")
        raw = response.read(MAX_RESPONSE_BYTES + 1)
    if len(raw) > MAX_RESPONSE_BYTES:
        raise RuntimeError("response_too_large")
    payload = json.loads(raw)
    if not isinstance(payload, dict) or payload.get("status") != "success":
        raise RuntimeError("provider_rejected")
    answer = payload.get("answer")
    if not isinstance(answer, dict) or answer.get("status") != "success":
        raise RuntimeError("provider_rejected")
    rows = answer.get("result")
    if not isinstance(rows, list):
        raise RuntimeError("unexpected_schema")
    return rows


def main() -> int:
    try:
        receipt, exit_code = audit()
    except Exception:
        # Exception strings may contain credentials or private response content.
        receipt, exit_code = {"status": "error", "owned": None, "target_exists": None, "count": None}, 1
    print(json.dumps(receipt, separators=(",", ":")))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
