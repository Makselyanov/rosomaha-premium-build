#!/usr/bin/env python3
"""Safely audit or update the three Vitaliy-approved Bitrix products."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

import paramiko


PROJECT_ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = PROJECT_ROOT / ".env"
PHP_SCRIPT = PROJECT_ROOT / "scripts" / "bitrix-bagira-base-equipment.php"
REPORT_ROOT = PROJECT_ROOT / "marketing-audits" / "bitrix"

HOST = "ocelot.beget.com"
PORT = 22
EXPECTED_LOGIN = "berkutm4"
EXPECTED_HOST_KEY_SHA256 = "9NXXK7D+NukzmR6c/Ov2rAZElXlr2s1oP0QAAmUWs+c"
REMOTE_WORK_ROOT = "/home/b/berkutm4/migration/rosomaha-rus/ops/bitrix-bagira"
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

AUTOROS_ROW = "<li>Заводские колёса Авторос 1200х600</li>"
BAGIRA_ROW = "<li>Заводские колёса Багира 1200х600</li>"
PRODUCT_URLS = [
    "https://rosomaha-rus.ru/product/extrime-s-1-5l-dvs-1nz-fe/?oid=812",
    "https://rosomaha-rus.ru/product/extrime-1-5-litra-mosty-toyota/?oid=824",
    "https://rosomaha-rus.ru/product/hunter-s-1-5l-dvs-1nz-fe/?oid=800",
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

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(PinnedHostKeyPolicy())
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
    peer_key = client.get_transport().get_remote_server_key()
    peer_fingerprint = base64.b64encode(
        hashlib.sha256(peer_key.asbytes()).digest()
    ).decode("ascii").rstrip("=")
    if peer_fingerprint != EXPECTED_HOST_KEY_SHA256:
        client.close()
        raise RuntimeError("Beget SSH host key mismatch")
    return client


def run_remote_command(
    client: paramiko.SSHClient,
    command: str,
    timeout_seconds: int,
) -> tuple[int, str, str]:
    _, stdout, _ = client.exec_command(command, timeout=20)
    channel = stdout.channel
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
            status = channel.recv_exit_status()
            return (
                status,
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

    discovered: list[tuple[str, str]] = []
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
        raise RuntimeError("Pinned Bitrix operation script is missing")

    client = connect()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    remote_script = f"{REMOTE_WORK_ROOT}/bitrix-bagira-{stamp}-{os.getpid()}.php"

    try:
        command = (
            "set -eu; "
            f"test \"$(realpath -- /home/b/berkutm4/rosomaha-rus.ru/public_html)\" "
            "= /home/b/berkutm4/rosomaha-rus.ru/public_html; "
            "test -f /home/b/berkutm4/rosomaha-rus.ru/public_html/bitrix/header.php; "
            f"install -d -m 0700 -- {REMOTE_WORK_ROOT}"
        )
        status, _, error = run_remote_command(client, command, 30)
        if status != 0:
            raise RuntimeError(f"Pinned Bitrix root check failed: {error[:300]}")

        php_binary, php_version = discover_php_binary(client)

        sftp = client.open_sftp()
        try:
            sftp.put(str(PHP_SCRIPT), remote_script)
            sftp.chmod(remote_script, 0o700)
        finally:
            sftp.close()

        status, preflight_output, preflight_error = run_remote_command(
            client,
            (
                f"timeout 15s {php_binary} -r 'echo PHP_VERSION;' && "
                f"timeout 15s {php_binary} -l -- {remote_script}"
            ),
            40,
        )
        if status != 0:
            raise RuntimeError(
                f"Remote PHP preflight failed: {(preflight_error or preflight_output)[-500:]}"
            )

        status, output, error = run_remote_command(
            client,
            (
                f"timeout 75s {php_binary} -d display_errors=stderr -d log_errors=0 "
                f"-f {remote_script} -- {mode}"
            ),
            90,
        )
        if not output:
            raise RuntimeError(f"Bitrix helper returned no JSON: {error[-500:]}")

        try:
            payload = json.loads(output.splitlines()[-1])
        except json.JSONDecodeError as exc:
            raise RuntimeError("Bitrix helper returned malformed JSON") from exc

        if status != 0 or payload.get("status") != "ok":
            message = str(payload.get("error") or error or "unknown Bitrix error")
            raise RuntimeError(message[:500])
        payload["runtime"] = {
            "php_version": php_version,
            "php_series_matches_live": php_version.startswith(EXPECTED_PHP_SERIES + "."),
        }
        return payload
    finally:
        try:
            if remote_script.startswith(REMOTE_WORK_ROOT + "/"):
                sftp = client.open_sftp()
                try:
                    sftp.remove(remote_script)
                except (FileNotFoundError, OSError):
                    pass
                finally:
                    sftp.close()
        finally:
            client.close()


def verify_public(expect_bagira: bool) -> list[dict[str, object]]:
    expected_sequence = AUTOROS_ROW + "\n" + BAGIRA_ROW
    results: list[dict[str, object]] = []

    for url in PRODUCT_URLS:
        request = Request(url, headers={"User-Agent": "RosomahaBitrixAudit/1.0"})
        with urlopen(request, timeout=30) as response:
            html = response.read().decode("utf-8", errors="replace")
            status = response.status
            final_url = response.geturl()

        autoros_count = html.count(AUTOROS_ROW)
        bagira_count = html.count(BAGIRA_ROW)
        sequence_count = html.count(expected_sequence)
        ok = status == 200 and autoros_count == 1
        if expect_bagira:
            ok = ok and bagira_count == 1 and sequence_count == 1
        else:
            ok = ok and bagira_count == 0

        results.append(
            {
                "url": url,
                "final_url": final_url,
                "http_status": status,
                "autoros_row_count": autoros_count,
                "bagira_row_count": bagira_count,
                "visual_sequence_count": sequence_count,
                "ok": ok,
            }
        )

    return results


def write_receipt(mode: str, remote: dict[str, object], public: list[dict[str, object]]) -> Path:
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    path = REPORT_ROOT / f"ROSOMAHA_BITRIX_BAGIRA_{stamp}_{mode.upper()}.json"
    receipt = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "domain": "rosomaha-rus.ru",
        "mode": mode,
        "expected_account": EXPECTED_LOGIN,
        "target_field": "iblock:86/PREVIEW_TEXT",
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
        description="Audit or safely add the Bagira base-equipment row in Bitrix."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Perform the guarded Bitrix update. Without this flag the command is read-only.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    mode = "apply" if args.apply else "audit"

    try:
        remote = execute_remote(mode)
        expect_bagira = args.apply or any(
            isinstance(item, dict) and int(item.get("bagira_count", 0)) == 1
            for item in remote.get("products", [])
        )
        public: list[dict[str, object]] = []
        for attempt in range(5):
            public = verify_public(expect_bagira=expect_bagira)
            if all(item["ok"] for item in public):
                break
            if expect_bagira and attempt < 4:
                time.sleep(2)

        receipt = write_receipt(mode, remote, public)
        result = {
            "status": "ok" if all(item["ok"] for item in public) else "verification_failed",
            "mode": mode,
            "database_mutations": remote.get("database_mutations", 0),
            "updated_ids": remote.get("updated_ids", []),
            "backup_path": remote.get("backup_path"),
            "public_verification": public,
            "receipt": str(receipt),
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
