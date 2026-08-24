#!/usr/bin/env python3
"""Offline contract and integration tests for bitrix-canonical-cleanup.py."""

from __future__ import annotations

import hashlib
import html
import importlib.util
import json
import os
import stat
import subprocess
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock
from urllib.parse import parse_qsl, urlparse


SCRIPT = Path(__file__).with_name("bitrix-canonical-cleanup.py")
SPEC = importlib.util.spec_from_file_location("bitrix_canonical_cleanup", SCRIPT)
assert SPEC and SPEC.loader
operator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(operator)


class FakeHandle:
    def __init__(self, sftp, path: str, mode: str) -> None:
        self.sftp = sftp
        self.path = path
        self.mode = mode
        self.buffer = bytearray()
        if mode == "rb":
            self.buffer[:] = sftp.files[path]["data"]

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type is None and self.mode == "wx":
            self.sftp.files[self.path] = {
                "data": bytes(self.buffer),
                "mode": stat.S_IFREG | 0o600,
                "uid": operator.EXPECTED_UID,
                "gid": operator.EXPECTED_GID,
            }
        return False

    def read(self, size: int = -1) -> bytes:
        return bytes(self.buffer if size < 0 else self.buffer[:size])

    def write(self, data: bytes) -> int:
        self.buffer.extend(data)
        return len(data)

    def flush(self) -> None:
        pass


class FakeSFTP:
    def __init__(self, active: bytes, *, mode: int = 0o600) -> None:
        self.files = {
            operator.TARGET_PATH: {
                "data": active,
                "mode": stat.S_IFREG | mode,
                "uid": operator.EXPECTED_UID,
                "gid": operator.EXPECTED_GID,
            }
        }
        self.dirs = {
            operator.OPERATION_PARENT: {
                "mode": stat.S_IFDIR | 0o700,
                "uid": operator.EXPECTED_UID,
                "gid": operator.EXPECTED_GID,
            },
            operator.OPERATION_ROOT: {
                "mode": stat.S_IFDIR | 0o700,
                "uid": operator.EXPECTED_UID,
                "gid": operator.EXPECTED_GID,
            },
        }
        self.calls: list[tuple] = []
        self.closed = False

    def lstat(self, path: str):
        value = self.files.get(path) or self.dirs.get(path)
        if value is None:
            raise FileNotFoundError(2, "missing", path)
        size = len(value.get("data", b""))
        return types.SimpleNamespace(
            st_size=size,
            st_mode=value["mode"],
            st_uid=value["uid"],
            st_gid=value["gid"],
        )

    def open(self, path: str, mode: str):
        self.calls.append(("open", path, mode))
        if "x" in mode and (path in self.files or path in self.dirs):
            raise FileExistsError(17, "exists", path)
        if mode == "rb" and path not in self.files:
            raise FileNotFoundError(2, "missing", path)
        return FakeHandle(self, path, mode)

    def mkdir(self, path: str, mode: int = 0o777) -> None:
        self.calls.append(("mkdir", path, mode))
        if path in self.files or path in self.dirs:
            raise FileExistsError(17, "exists", path)
        self.dirs[path] = {
            "mode": stat.S_IFDIR | mode,
            "uid": operator.EXPECTED_UID,
            "gid": operator.EXPECTED_GID,
        }

    def chmod(self, path: str, mode: int) -> None:
        self.calls.append(("chmod", path, mode))
        value = self.files.get(path) or self.dirs.get(path)
        type_bits = stat.S_IFREG if path in self.files else stat.S_IFDIR
        value["mode"] = type_bits | mode

    def chown(self, path: str, uid: int, gid: int) -> None:
        self.calls.append(("chown", path, uid, gid))
        value = self.files.get(path) or self.dirs.get(path)
        value["uid"] = uid
        value["gid"] = gid

    def posix_rename(self, source: str, destination: str) -> None:
        self.calls.append(("posix_rename", source, destination))
        if source not in self.files:
            raise FileNotFoundError(2, "missing", source)
        self.files[destination] = self.files.pop(source)

    def remove(self, path: str) -> None:
        self.calls.append(("remove", path))
        del self.files[path]

    def close(self) -> None:
        self.closed = True


class FakeClient:
    def __init__(self, sftp: FakeSFTP) -> None:
        self.sftp = sftp

    def open_sftp(self) -> FakeSFTP:
        self.sftp.closed = False
        return self.sftp


def public_ok(state: str) -> list[dict[str, str]]:
    return [{"name": "offline", "state": state}]


class CandidateContractTests(unittest.TestCase):
    def test_manifest_candidate_and_reconstructed_export_hashes(self):
        candidate = operator.validate_candidate()
        baseline = operator.reconstruct_baseline(candidate)
        self.assertEqual(len(candidate), operator.CANDIDATE_BYTES)
        self.assertEqual(hashlib.sha256(candidate).hexdigest(), operator.CANDIDATE_SHA256)
        self.assertEqual(len(baseline), operator.BASELINE_BYTES)
        self.assertEqual(hashlib.sha256(baseline).hexdigest(), operator.BASELINE_SHA256)

    def test_only_canonical_generation_differs_from_export(self):
        candidate = operator.validate_candidate()
        baseline = operator.reconstruct_baseline(candidate)
        exported = operator.PROJECT_ROOT / ".local-artifacts" / "bitrix-canonical-20260824" / "header.php"
        if exported.is_file():
            self.assertEqual(baseline, exported.read_bytes())

    def test_variables_are_prefixed_and_no_buffer_handler_was_added(self):
        text = operator.validate_candidate().decode("utf-8")
        self.assertIn("$rosomahaCanonicalTrackingParams", text)
        self.assertIn("$rosomahaCanonicalKillParams", text)
        self.assertIn("htmlspecialcharsbx($rosomahaCanonicalHref)", text)
        self.assertNotIn("OnEndBufferContent", text)
        self.assertEqual(text.count('rel="canonical"'), 1)

    def test_php_lint(self):
        result = subprocess.run(
            ["php", "-d", "short_open_tag=1", "-l", str(operator.CANDIDATE_PATH)],
            capture_output=True,
            text=True,
            check=False,
            timeout=20,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("No syntax errors detected", result.stdout)

    def test_actual_php_block_removes_tracking_case_insensitively(self):
        text = operator.validate_candidate().decode("utf-8")
        start = text.index("$rosomahaCanonicalTrackingParams")
        end = text.index("\n\t\t?>", start)
        block = text[start:end]
        values = {
            "UTM_Source": "direct",
            "yClId": "1",
            "GCLID": "2",
            "FbClId": "3",
            "MSCLKID": "4",
            "_OpenStat": "5",
            "GBRAID": "6",
            "wBrAiD": "7",
            "oid": "812",
            "display": "price",
            "PAGEN_2": "3",
            "dealer": "tyumen",
        }
        harness = f"""<?php
$_GET = json_decode(base64_decode('{json.dumps(values).encode().hex()}'), true);
"""
        # Use hex2bin to keep test data out of PHP string escaping rules.
        harness = harness.replace(
            "json_decode(base64_decode('", "json_decode(hex2bin('"
        )
        harness += """
class CanonicalApplicationMock {
    public $kill = array();
    public function GetCurPageParam($add, $kill) {
        $this->kill = $kill;
        $query = $_GET;
        foreach ($kill as $key) { unset($query[$key]); }
        return '/probe/?' . http_build_query($query);
    }
}
$APPLICATION = new CanonicalApplicationMock();
""" + block + """
echo json_encode(array('href' => $rosomahaCanonicalHref, 'kill' => $rosomahaCanonicalKillParams));
"""
        temp_root = operator.PROJECT_ROOT / ".codex_tmp"
        temp_root.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=temp_root) as directory:
            path = Path(directory) / "canonical-block.php"
            path.write_text(harness, encoding="utf-8")
            result = subprocess.run(
                ["php", "-d", "short_open_tag=1", str(path)],
                capture_output=True,
                text=True,
                check=False,
                timeout=20,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        query = dict(parse_qsl(urlparse(payload["href"]).query))
        self.assertEqual(
            query,
            {"oid": "812", "display": "price", "PAGEN_2": "3", "dealer": "tyumen"},
        )
        self.assertEqual(len(payload["kill"]), 8)


class PublicContractTests(unittest.TestCase):
    @staticmethod
    def body(canonical: str) -> bytes:
        return f'<html><head><link rel="canonical" href="{html.escape(canonical, quote=True)}"></head></html>'.encode()

    def test_candidate_root_category_and_product(self):
        for probe in operator.PUBLIC_PROBES:
            request = str(probe["url"])
            parsed = urlparse(request)
            query = "&".join(f"{key}={value}" for key, value in probe["candidate_query"])
            canonical = f"{operator.PUBLIC_ORIGIN}{parsed.path}" + (f"?{query}" if query else "")
            result = operator.validate_public_html(
                request,
                self.body(canonical),
                expected_state="candidate",
                candidate_query=probe["candidate_query"],
            )
            self.assertEqual(result["canonical"], canonical)

    def test_unknown_business_and_pagination_params_are_preserved(self):
        request = operator.PUBLIC_ORIGIN + "/product/kvadrotsikly/?dealer=x&PAGEN_1=2&utm_source=y"
        canonical = operator.PUBLIC_ORIGIN + "/product/kvadrotsikly/?dealer=x&PAGEN_1=2"
        operator.validate_public_html(
            request,
            self.body(canonical),
            expected_state="candidate",
            candidate_query=(("dealer", "x"), ("PAGEN_1", "2")),
        )

    def test_tracking_or_second_canonical_fails_closed(self):
        request = str(operator.PUBLIC_PROBES[0]["url"])
        bad = operator.PUBLIC_ORIGIN + "/?utm_source=still-here"
        with self.assertRaises(operator.PublicVerificationError):
            operator.validate_public_html(
                request,
                self.body(bad),
                expected_state="candidate",
                candidate_query=(),
            )
        doubled = self.body(operator.PUBLIC_ORIGIN + "/").replace(b"</head>", b'<link rel="canonical" href="/"></head>')
        with self.assertRaises(operator.PublicVerificationError):
            operator.validate_public_html(
                request,
                doubled,
                expected_state="candidate",
                candidate_query=(),
            )


class RemoteLintContractTests(unittest.TestCase):
    def test_operator_revision_changes_id_and_legacy_is_recover_only(self):
        self.assertEqual(operator.OPERATOR_REVISION, "paramiko-exclusive-writable-v2")
        legacy = "bitrix-canonical-93b977ba7521678b12ffbb15"
        self.assertIn(legacy, operator.LEGACY_ABORTED_OPERATION_IDS)
        self.assertNotEqual(operator.OPERATION_ID, legacy)
        with self.assertRaises(operator.CanonicalOperatorError):
            operator._operation_paths(legacy)
        with self.assertRaises(operator.CanonicalOperatorError):
            operator.run_rollback(
                legacy,
                environ={operator.ROLLBACK_GUARD_ENV: operator.ROLLBACK_GUARD_VALUE},
            )
        paths = operator._operation_paths(legacy, allow_legacy_recover=True)
        self.assertTrue(paths["directory"].endswith("/" + legacy))

    def test_atomic_temp_paths_are_exact_same_directory_php_files(self):
        paths = operator._operation_paths(operator.OPERATION_ID)
        expected = {
            "candidate_temp": (
                operator.TARGET_DIRECTORY
                + f"/.header.{operator.OPERATION_ID}.candidate.php"
            ),
            "rollback_temp": (
                operator.TARGET_DIRECTORY
                + f"/.header.{operator.OPERATION_ID}.rollback.php"
            ),
        }
        for key, exact_path in expected.items():
            self.assertEqual(paths[key], exact_path)
            self.assertEqual(paths[key].rsplit("/", 1)[0], operator.TARGET_DIRECTORY)
            self.assertTrue(paths[key].endswith(".php"))
            self.assertNotEqual(paths[key], operator.TARGET_PATH)

    def test_remote_php_lint_is_pinned_and_uses_the_exact_file_argument(self):
        with mock.patch.object(
            operator,
            "_exec_bounded",
            return_value=(0, b"No syntax errors detected", b""),
        ) as execute:
            result = operator.remote_php_lint(
                object(), operator.PHP_CANDIDATES[0], operator.TARGET_PATH
            )
        command = execute.call_args.args[1]
        self.assertIn(" -l ", command)
        self.assertNotIn(" -l -- ", command)
        self.assertIn(operator.TARGET_PATH, command)
        self.assertEqual(result["status"], "pass")
        with self.assertRaises(operator.CanonicalOperatorError):
            operator.remote_php_lint(
                object(), operator.PHP_CANDIDATES[0], "/tmp/other.php"
            )


class RemoteOperationTests(unittest.TestCase):
    def setUp(self):
        self.candidate = operator.validate_candidate()
        self.baseline = operator.reconstruct_baseline(self.candidate)
        self.lint_patch = mock.patch.object(
            operator, "remote_php_lint", return_value={"status": "pass", "php_series": "8.2"}
        )
        self.php_patch = mock.patch.object(operator, "discover_php", return_value=operator.PHP_CANDIDATES[0])
        self.lint_patch.start()
        self.php_patch.start()

    def tearDown(self):
        self.lint_patch.stop()
        self.php_patch.stop()

    def test_apply_is_cas_backup_lint_atomic_and_metadata_preserving(self):
        sftp = FakeSFTP(self.baseline)
        result = operator.apply_remote(FakeClient(sftp), self.candidate, public_verifier=public_ok)
        active, info = operator.read_remote_file(sftp, operator.TARGET_PATH)
        paths = operator._operation_paths(operator.OPERATION_ID)
        self.assertEqual(active, self.candidate)
        self.assertEqual(info["mode"], "0600")
        self.assertEqual(info["uid"], operator.EXPECTED_UID)
        self.assertEqual(sftp.files[paths["backup"]]["data"], self.baseline)
        self.assertFalse(paths["backup"].startswith(operator.SITE_ROOT + "/"))
        self.assertIn(paths["receipt"], sftp.files)
        self.assertTrue(result["atomic_replace"])
        rename = next(i for i, call in enumerate(sftp.calls) if call[0] == "posix_rename")
        backup = next(i for i, call in enumerate(sftp.calls) if call[:3] == ("open", paths["backup"], "wx"))
        self.assertLess(backup, rename)
        write_modes = [call[2] for call in sftp.calls if call[0] == "open" and call[2] != "rb"]
        self.assertTrue(write_modes)
        self.assertEqual(set(write_modes), {"wx"})

    def test_wrong_sha_or_metadata_stops_before_operation_directory(self):
        bad = FakeSFTP(b"changed")
        with self.assertRaises(operator.CanonicalOperatorError):
            operator.apply_remote(FakeClient(bad), self.candidate, public_verifier=public_ok)
        self.assertFalse(any(call[0] == "mkdir" for call in bad.calls))
        wrong_mode = FakeSFTP(self.baseline, mode=0o644)
        with self.assertRaises(operator.CanonicalOperatorError):
            operator.apply_remote(FakeClient(wrong_mode), self.candidate, public_verifier=public_ok)
        self.assertFalse(any(call[0] == "mkdir" for call in wrong_mode.calls))

    def test_lint_failure_keeps_baseline_and_never_renames(self):
        sftp = FakeSFTP(self.baseline)
        with mock.patch.object(operator, "remote_php_lint", side_effect=operator.CanonicalOperatorError("lint")):
            with self.assertRaises(operator.CanonicalOperatorError):
                operator.apply_remote(FakeClient(sftp), self.candidate, public_verifier=public_ok)
        self.assertEqual(sftp.files[operator.TARGET_PATH]["data"], self.baseline)
        self.assertFalse(any(call[0] == "posix_rename" for call in sftp.calls))

    def test_public_postflight_failure_auto_restores_exact_backup(self):
        sftp = FakeSFTP(self.baseline)
        def verifier(state: str):
            if state == "candidate":
                raise operator.PublicVerificationError("postflight")
            return public_ok(state)
        with self.assertRaisesRegex(operator.CanonicalOperatorError, "exact backup restored"):
            operator.apply_remote(FakeClient(sftp), self.candidate, public_verifier=verifier)
        self.assertEqual(sftp.files[operator.TARGET_PATH]["data"], self.baseline)
        renames = [call for call in sftp.calls if call[0] == "posix_rename"]
        self.assertEqual(len(renames), 2)

    def test_recover_and_exact_rollback_by_operation_id(self):
        sftp = FakeSFTP(self.baseline)
        client = FakeClient(sftp)
        operator.apply_remote(client, self.candidate, public_verifier=public_ok)
        recovery = operator.recover_remote(client, operator.OPERATION_ID)
        self.assertEqual(recovery["classification"], "applied")
        self.assertTrue(recovery["read_only"])
        result = operator.rollback_remote(client, operator.OPERATION_ID, public_verifier=public_ok)
        self.assertEqual(result["status"], "rolled_back")
        self.assertEqual(sftp.files[operator.TARGET_PATH]["data"], self.baseline)
        with self.assertRaises(operator.CanonicalOperatorError):
            operator.recover_remote(client, "bitrix-canonical-000000000000000000000000")

    def test_legacy_zero_byte_backup_is_read_only_classified(self):
        legacy = next(iter(operator.LEGACY_ABORTED_OPERATION_IDS))
        sftp = FakeSFTP(self.baseline)
        paths = operator._operation_paths(legacy, allow_legacy_recover=True)
        sftp.dirs[paths["directory"]] = {
            "mode": stat.S_IFDIR | 0o700,
            "uid": operator.EXPECTED_UID,
            "gid": operator.EXPECTED_GID,
        }
        sftp.files[paths["backup"]] = {
            "data": b"",
            "mode": stat.S_IFREG | 0o600,
            "uid": operator.EXPECTED_UID,
            "gid": operator.EXPECTED_GID,
        }
        recovery = operator.recover_remote(FakeClient(sftp), legacy)
        self.assertEqual(recovery["classification"], "baseline_with_invalid_backup")
        self.assertEqual(recovery["backup"]["reason"], "zero_length")
        self.assertTrue(recovery["legacy_operation_read_only"])
        self.assertTrue(recovery["read_only"])
        self.assertFalse(any(call[0] in {"mkdir", "chmod", "chown", "remove", "posix_rename"} for call in sftp.calls))
        self.assertFalse(any(call[0] == "open" and call[2] != "rb" for call in sftp.calls))


class CliAndCredentialTests(unittest.TestCase):
    def test_apply_and_rollback_guards_fail_before_dispatch(self):
        with self.assertRaisesRegex(operator.CanonicalOperatorError, "apply guard"):
            operator.run_apply(environ={})
        with self.assertRaisesRegex(operator.CanonicalOperatorError, "rollback guard"):
            operator.run_rollback(operator.OPERATION_ID, environ={})

    def test_pinned_credentials_reject_partial_or_wrong_account(self):
        with self.assertRaises(operator.CredentialError):
            operator.load_credentials(environ={"BEGET_LOGIN": operator.EXPECTED_LOGIN})
        with self.assertRaises(operator.CredentialError):
            operator.load_credentials(environ={"BEGET_LOGIN": "other", "BEGET_PASSWORD": "x"})
        self.assertEqual(
            operator.load_credentials(
                environ={"BEGET_LOGIN": operator.EXPECTED_LOGIN, "BEGET_PASSWORD": "x"}
            )[0],
            operator.EXPECTED_LOGIN,
        )

    def test_cli_requires_one_fixed_mode_and_operation_id(self):
        self.assertTrue(operator.parse_args(["--audit"]).audit)
        self.assertEqual(operator.parse_args(["--recover", operator.OPERATION_ID]).recover, operator.OPERATION_ID)
        with self.assertRaises(SystemExit):
            operator.parse_args([])
        with self.assertRaises(SystemExit):
            operator.parse_args(["--audit", "--dry-run"])

    def test_receipt_rejects_secret_keys_and_is_read_only(self):
        with tempfile.TemporaryDirectory(dir=operator.PROJECT_ROOT / ".codex_tmp") as directory:
            with mock.patch.object(operator, "REPORT_ROOT", Path(directory)):
                with self.assertRaises(operator.CanonicalOperatorError):
                    operator.write_receipt("audit", {"password": "x"})
                path = operator.write_receipt("audit", {"status": "ok"})
                self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["status"], "ok")
                self.assertFalse(path.stat().st_mode & stat.S_IWUSR)
                os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)


if __name__ == "__main__":
    unittest.main(verbosity=2)
