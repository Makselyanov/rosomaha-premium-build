#!/usr/bin/env python3
"""Offline tests for the pinned rosomaha-rus.ru Bitrix/Metrika operator."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import types
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).with_name("bitrix-metrika-bridge-deploy.py")
SPEC = importlib.util.spec_from_file_location("bitrix_metrika_bridge_deploy", SCRIPT)
assert SPEC and SPEC.loader
operator = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = operator
SPEC.loader.exec_module(operator)

BASELINE_COUNTER_EXPORT = (
    operator.PROJECT_ROOT
    / ".local-artifacts"
    / "bitrix-metrika-20260824"
    / "invis-counter.php"
)


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
    def __init__(self, files: dict[str, bytes]) -> None:
        self.files = {
            path: {
                "data": data,
                "mode": stat.S_IFREG | 0o600,
                "uid": operator.EXPECTED_UID,
                "gid": operator.EXPECTED_GID,
            }
            for path, data in files.items()
        }
        self.dirs = {
            path: {
                "mode": stat.S_IFDIR | mode,
                "uid": operator.EXPECTED_UID,
                "gid": operator.EXPECTED_GID,
            }
            for path, mode in {
                operator.HOME_ROOT: 0o700,
                operator.SITE_ROOT: 0o700,
                operator.PHP_INTERFACE_DIRECTORY: 0o700,
                operator.COUNTER_DIRECTORY: 0o700,
                operator.OPERATION_PARENT: 0o700,
            }.items()
        }
        self.dirs[operator.HOME_ROOT].update(
            mode=stat.S_IFDIR | 0o700,
            uid=0,
            gid=0,
        )
        self.calls: list[tuple] = []
        self.closed = False

    def lstat(self, path: str):
        item = self.files.get(path) or self.dirs.get(path)
        if item is None:
            raise FileNotFoundError(2, "missing", path)
        return types.SimpleNamespace(
            st_size=len(item.get("data", b"")),
            st_mode=item["mode"],
            st_uid=item["uid"],
            st_gid=item["gid"],
        )

    def open(self, path: str, mode: str):
        self.calls.append(("open", path, mode))
        if "x" in mode and (path in self.files or path in self.dirs):
            raise FileExistsError(17, "exists", path)
        if mode == "rb" and path not in self.files:
            raise FileNotFoundError(2, "missing", path)
        return FakeHandle(self, path, mode)

    def listdir_attr(self, path: str):
        prefix = path.rstrip("/") + "/"
        children = []
        for candidate, item in {**self.dirs, **self.files}.items():
            if not candidate.startswith(prefix):
                continue
            name = candidate[len(prefix) :]
            if not name or "/" in name:
                continue
            children.append(
                types.SimpleNamespace(
                    filename=name,
                    st_size=len(item.get("data", b"")),
                    st_mode=item["mode"],
                    st_uid=item["uid"],
                    st_gid=item["gid"],
                )
            )
        return children

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
        item = self.files.get(path) or self.dirs.get(path)
        kind = stat.S_IFREG if path in self.files else stat.S_IFDIR
        item["mode"] = kind | mode

    def chown(self, path: str, uid: int, gid: int) -> None:
        self.calls.append(("chown", path, uid, gid))
        item = self.files.get(path) or self.dirs.get(path)
        item["uid"] = uid
        item["gid"] = gid

    def posix_rename(self, source: str, destination: str) -> None:
        self.calls.append(("posix_rename", source, destination))
        if source.rsplit("/", 1)[0] != destination.rsplit("/", 1)[0]:
            raise AssertionError("rename crossed a directory boundary")
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


FIXTURE_BRIDGE_BASELINE = b"<?php\n// old bridge\n"
FIXTURE_BRIDGE_CANDIDATE = b"<?php\n// new bridge\n"
FIXTURE_INIT = (
    b"<?php\n"
    b"$rosomahaCrmBridge = __DIR__ . '/rosomaha_crm_bridge.php';\n"
    b"if (is_file($rosomahaCrmBridge)) {\n"
    b"    require_once $rosomahaCrmBridge;\n"
    b"}\n"
)
FIXTURE_COUNTER_BASELINE = (
    b'<!-- Yandex.Metrika counter -->\n<script>\n   ym(50606578, "init", {\n'
    b"        clickmap:true\n   });\n</script>\n"
    b'<img src="https://mc.yandex.ru/watch/50606578">\n<script>\n'
    b"    jQuery(function(){\n"
    b"        function getParameterByName(name) { return name; }\n"
    b"        var source = getParameterByName('utm_source'),\n"
    b"        medium = getParameterByName('utm_medium'),\n"
    b"        campaign = getParameterByName('utm_campaign'),\n"
    b"        content = getParameterByName('utm_content'),\n"
    b"        term = getParameterByName('utm_term');\n"
    b"        function getCookie(name) { return name; }\n"
    b"        jQuery('body').on('click', 'button', function(){ return; });\n"
    b"    });\n</script>\n"
)


@contextmanager
def fixture_pins():
    counter_candidate = None
    values = {
        "BRIDGE_BASELINE_BYTES": len(FIXTURE_BRIDGE_BASELINE),
        "BRIDGE_BASELINE_SHA256": hashlib.sha256(FIXTURE_BRIDGE_BASELINE).hexdigest(),
        "INIT_BASELINE_BYTES": len(FIXTURE_INIT),
        "INIT_BASELINE_SHA256": hashlib.sha256(FIXTURE_INIT).hexdigest(),
        "COUNTER_BASELINE_BYTES": len(FIXTURE_COUNTER_BASELINE),
        "COUNTER_BASELINE_SHA256": hashlib.sha256(FIXTURE_COUNTER_BASELINE).hexdigest(),
        "COUNTER_CANDIDATE_BYTES": 0,
        "COUNTER_CANDIDATE_SHA256": "",
    }
    with mock.patch.multiple(operator, **values):
        counter_candidate = operator.build_counter_candidate(
            FIXTURE_COUNTER_BASELINE, operator.TARGET_COUNTER_ID
        )
        with mock.patch.multiple(
            operator,
            COUNTER_CANDIDATE_BYTES=len(counter_candidate),
            COUNTER_CANDIDATE_SHA256=hashlib.sha256(counter_candidate).hexdigest(),
        ):
            yield counter_candidate


def runtime(credential: str = "A" * 48) -> dict[str, object]:
    return {
        "counter_id": operator.TARGET_COUNTER_ID,
        "credential": credential,
        "goal_ids": {"crm_conversion": 7001, "lead_submit": 7002},
    }


def baseline_sftp() -> FakeSFTP:
    return FakeSFTP(
        {
            operator.BRIDGE_PATH: FIXTURE_BRIDGE_BASELINE,
            operator.INIT_PATH: FIXTURE_INIT,
            operator.COUNTER_PATH: FIXTURE_COUNTER_BASELINE,
        }
    )


def option_stub(state: dict[str, str], calls: list[str]):
    def stub(client, mode: str, target_counter_id: int, *, php_binary=None):
        del client, php_binary
        calls.append(mode)
        before = dict(state)
        if mode == "apply":
            if set(state.values()) == {str(operator.OLD_COUNTER_ID)}:
                state.update(site_s1=str(target_counter_id), global_=str(target_counter_id))
                state["global"] = state.pop("global_")
                status = "applied"
                mutations = 2
            elif set(state.values()) == {str(target_counter_id)}:
                status = "already_target"
                mutations = 0
            else:
                raise operator.DeployError("fake option CAS blocked")
        elif mode == "rollback":
            if set(state.values()) == {str(target_counter_id)}:
                state.update(site_s1=str(operator.OLD_COUNTER_ID), global_=str(operator.OLD_COUNTER_ID))
                state["global"] = state.pop("global_")
                status = "rolled_back"
                mutations = 2
            elif set(state.values()) == {str(operator.OLD_COUNTER_ID)}:
                status = "already_target"
                mutations = 0
            else:
                raise operator.DeployError("fake option CAS blocked")
        else:
            status = "audited"
            mutations = 0
        return {"status": status, "before": before, "after": dict(state), "mutations": mutations}

    return stub


class CandidateContractTests(unittest.TestCase):
    def test_tracked_bridge_candidate_is_exactly_pinned(self) -> None:
        data = operator.validate_bridge_candidate()
        self.assertEqual(len(data), operator.BRIDGE_CANDIDATE_BYTES)
        self.assertEqual(hashlib.sha256(data).hexdigest(), operator.BRIDGE_CANDIDATE_SHA256)

    def test_production_counter_export_and_candidate_are_exactly_pinned(self) -> None:
        if not BASELINE_COUNTER_EXPORT.is_file():
            self.skipTest("read-only production export is not present")
        baseline = BASELINE_COUNTER_EXPORT.read_bytes()
        self.assertEqual(len(baseline), operator.COUNTER_BASELINE_BYTES)
        self.assertEqual(hashlib.sha256(baseline).hexdigest(), operator.COUNTER_BASELINE_SHA256)
        candidate = operator.build_counter_candidate(baseline, operator.TARGET_COUNTER_ID)
        self.assertEqual(len(candidate), operator.COUNTER_CANDIDATE_BYTES)
        self.assertEqual(hashlib.sha256(candidate).hexdigest(), operator.COUNTER_CANDIDATE_SHA256)

    def test_init_include_is_idempotent_and_ambiguous_include_blocks(self) -> None:
        self.assertEqual(operator.build_init_candidate(FIXTURE_INIT), FIXTURE_INIT)
        with self.assertRaisesRegex(operator.DeployError, "ambiguous"):
            operator.build_init_candidate(
                FIXTURE_INIT + b"require_once __DIR__ . '/rosomaha_crm_bridge.php';\n"
            )

    def test_init_include_is_added_exactly_once_when_absent(self) -> None:
        baseline = b"<?php\n// existing\n"
        candidate = operator.build_init_candidate(baseline)
        self.assertEqual(candidate.count(operator.INCLUDE_REFERENCE), 1)
        self.assertEqual(operator.build_init_candidate(candidate), candidate)

    def test_attribution_marker_whitelist_and_client_id_are_exact_once(self) -> None:
        with fixture_pins() as candidate:
            self.assertEqual(candidate.count(operator.ATTRIBUTION_MARKER), 1)
            self.assertEqual(candidate.count(b'ym(111905412, "getClientID"'), 1)
            self.assertEqual(candidate.count(b"ym_client_id="), 1)
            self.assertEqual(candidate.count(b"new URLSearchParams(window.location.search)"), 1)
            self.assertEqual(candidate.count(b"encodeURIComponent(value)"), 1)
            self.assertEqual(candidate.count(b"Max-Age=7776000"), 1)
            self.assertEqual(candidate.count(b"SameSite=Lax"), 2)
            for key in operator.ATTRIBUTION_KEYS:
                self.assertEqual(candidate.count(json.dumps(key).encode("ascii")), 1)
            self.assertNotIn(b"function getParameterByName", candidate)
            self.assertNotIn(str(operator.OLD_COUNTER_ID).encode("ascii"), candidate)

    def test_attribution_candidate_is_idempotent(self) -> None:
        with fixture_pins() as candidate:
            self.assertEqual(
                operator.build_counter_candidate(candidate, operator.TARGET_COUNTER_ID),
                candidate,
            )

    def test_wrong_or_absent_candidate_marker_fails_closed(self) -> None:
        with fixture_pins() as candidate:
            missing = candidate.replace(operator.ATTRIBUTION_MARKER, b"BROKEN", 1)
            wrong = candidate.replace(b"ym_client_id=", b"other_client=", 1)
            with self.assertRaises(operator.DeployError):
                operator.build_counter_candidate(missing, operator.TARGET_COUNTER_ID)
            with self.assertRaises(operator.DeployError):
                operator.build_counter_candidate(wrong, operator.TARGET_COUNTER_ID)

    def test_attribution_block_has_no_form_or_crm_side_effect(self) -> None:
        with fixture_pins() as candidate:
            start = candidate.index(operator.ATTRIBUTION_MARKER)
            end = candidate.index(b"/* /rosomaha attribution */", start)
            block = candidate[start:end]
            for forbidden in (
                b"$.ajax",
                b"jQuery.ajax",
                b"fetch(",
                b"XMLHttpRequest",
                b"lead_submission_id",
                b"crm_conversion",
                b"submit",
            ):
                self.assertNotIn(forbidden, block)

    def test_counter_candidate_javascript_parses(self) -> None:
        if not BASELINE_COUNTER_EXPORT.is_file():
            self.skipTest("read-only production export is not present")
        candidate = operator.build_counter_candidate(
            BASELINE_COUNTER_EXPORT.read_bytes(), operator.TARGET_COUNTER_ID
        )
        scripts = re.findall(rb"(?is)<script\b[^>]*>(.*?)</script>", candidate)
        self.assertGreaterEqual(len(scripts), 2)
        temp_root = operator.PROJECT_ROOT / ".codex_tmp"
        temp_root.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=temp_root) as directory:
            path = Path(directory) / "counter-candidate.js"
            path.write_bytes(b"\n".join(scripts))
            result = subprocess.run(
                ["node", "--check", str(path)],
                capture_output=True,
                check=False,
                timeout=20,
            )
        self.assertEqual(result.returncode, 0, result.stderr.decode(errors="replace"))

    def test_runtime_counter_is_fixed_and_remote_config_is_reduced(self) -> None:
        temp_root = operator.PROJECT_ROOT / ".codex_tmp"
        temp_root.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=temp_root) as directory:
            path = Path(directory) / "runtime.json"
            source = {
                "counter_id": operator.TARGET_COUNTER_ID,
                "measurement_token": "B" * 48,
                "goal_ids": {"crm_conversion": 11, "lead_submit": 12},
                "unexpected": {"private": "must-not-deploy"},
            }
            path.write_text(json.dumps(source), encoding="utf-8")
            if os.name != "nt":
                path.chmod(0o600)
            parsed = operator.load_runtime(path)
        config = json.loads(operator.config_candidate(parsed))
        self.assertEqual(set(config), {"counter_id", "measurement_token"})
        self.assertNotIn("unexpected", config)
        self.assertNotIn("goal_ids", config)

    def test_runtime_rejects_any_other_counter(self) -> None:
        temp_root = operator.PROJECT_ROOT / ".codex_tmp"
        temp_root.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=temp_root) as directory:
            path = Path(directory) / "runtime.json"
            path.write_text(
                json.dumps(
                    {
                        "counter_id": operator.TARGET_COUNTER_ID + 1,
                        "measurement_token": "C" * 48,
                        "goal_ids": {"crm_conversion": 1, "lead_submit": 2},
                    }
                ),
                encoding="utf-8",
            )
            if os.name != "nt":
                path.chmod(0o600)
            with self.assertRaises(operator.DeployError):
                operator.load_runtime(path)


class ReceiptAndReadOnlyTests(unittest.TestCase):
    def test_beget_chroot_owner_exception_is_exact_path_only(self) -> None:
        sftp = baseline_sftp()
        home = operator._require_pinned_parent(sftp, operator.HOME_ROOT)
        self.assertEqual((home["uid"], home["gid"], home["mode"]), (0, 0, "0700"))
        site = operator._require_pinned_parent(sftp, operator.SITE_ROOT)
        self.assertEqual(
            (site["uid"], site["gid"], site["mode"]),
            (operator.EXPECTED_UID, operator.EXPECTED_GID, "0700"),
        )
        with self.assertRaisesRegex(operator.DeployError, "outside the pinned policy"):
            operator._require_pinned_parent(sftp, operator.HOME_ROOT + "/other")
        sftp.dirs[operator.SITE_ROOT]["uid"] = 0
        sftp.dirs[operator.SITE_ROOT]["gid"] = 0
        with self.assertRaisesRegex(operator.DeployError, "path-specific identity drifted"):
            operator._require_pinned_parent(sftp, operator.SITE_ROOT)

    def test_all_pinned_parent_policies_match_read_only_fixture(self) -> None:
        observed = operator._audit_pinned_parents(baseline_sftp())
        self.assertEqual(
            [item["path"] for item in observed],
            list(operator.PINNED_PARENT_POLICIES),
        )
        self.assertTrue(all(item["mode"] == "0700" for item in observed))

    def test_receipt_never_serializes_runtime_credential(self) -> None:
        value = "NeverSerializeThisCredential123456"
        payload = operator._base_receipt("dry-run", runtime(value))
        body = operator._receipt_bytes(payload)
        self.assertNotIn(value.encode(), body)
        self.assertNotIn(b"measurement_token", body)
        self.assertNotIn(b'"credential"', body)

    def test_receipt_rejects_sensitive_keys_recursively(self) -> None:
        for key in ("token", "password", "credential", "phone", "email"):
            with self.assertRaises(operator.DeployError):
                operator._receipt_bytes({"safe": {key: "x"}})

    def test_original_cause_is_redacted_before_receipt_serialization(self) -> None:
        value = "NeverSerializeThisCauseValue"
        error = operator.safe_error(
            operator.PublicVerificationError("token=" + value)
        )
        body = operator._receipt_bytes({"status": "error", "error": error})
        self.assertNotIn(value.encode(), body)
        self.assertIn(b"token=[redacted]", body)

    def test_operation_id_is_independent_of_runtime_credential(self) -> None:
        goal_ids = {"crm_conversion": 1, "lead_submit": 2}
        first = operator._operation_id(
            bridge=b"a", init=b"b", counter=b"c",
            counter_id=operator.TARGET_COUNTER_ID, goal_ids=goal_ids,
        )
        # No credential argument exists by design.
        second = operator._operation_id(
            bridge=b"a", init=b"b", counter=b"c",
            counter_id=operator.TARGET_COUNTER_ID, goal_ids=goal_ids,
        )
        self.assertEqual(first, second)

    def test_audit_aspro_helper_contains_no_write_api(self) -> None:
        audit = operator._aspro_php("audit", operator.TARGET_COUNTER_ID)
        apply = operator._aspro_php("apply", operator.TARGET_COUNTER_ID)
        self.assertNotIn("SetOptionString", audit)
        self.assertIn("SetOptionString", apply)
        self.assertIn("GetOptionString", audit)

    def test_dry_run_only_uses_read_only_snapshot(self) -> None:
        fake_runtime = runtime()
        plan = {
            "name": "bridge", "path": operator.BRIDGE_PATH,
            "baseline": b"a", "baseline_size": 1,
            "baseline_sha": hashlib.sha256(b"a").hexdigest(),
            "candidate": b"b", "sensitive": False,
            "state": {"state": "baseline", "bytes": 1, "mode": "0600",
                      "uid": operator.EXPECTED_UID, "gid": operator.EXPECTED_GID,
                      "regular_non_symlink": True, "sha256": hashlib.sha256(b"a").hexdigest()},
        }
        options = {
            "status": "audited",
            "before": {"site_s1": str(operator.OLD_COUNTER_ID), "global": str(operator.OLD_COUNTER_ID)},
            "after": {"site_s1": str(operator.OLD_COUNTER_ID), "global": str(operator.OLD_COUNTER_ID)},
            "mutations": 0,
        }
        with (
            mock.patch.object(operator, "load_runtime", return_value=fake_runtime),
            mock.patch.object(operator, "validate_bridge_candidate", return_value=b"bridge"),
            mock.patch.object(operator, "_candidate_lint_local", return_value={"status": "pass"}),
            mock.patch.object(
                operator,
                "_connect_and_close",
                return_value=(
                    [plan],
                    "bitrix-metrika-" + "a" * 24,
                    options,
                    [
                        {
                            "path": operator.HOME_ROOT,
                            "type": "directory_non_symlink",
                            "uid": 0,
                            "gid": 0,
                            "mode": "0700",
                        }
                    ],
                    {
                        "status": "missing",
                        "path": operator.OPERATION_ROOT
                        + "/bitrix-metrika-"
                        + "a" * 24,
                    },
                ),
            ),
            mock.patch.object(operator, "write_local_receipt", return_value=Path("dry-run.json")),
            mock.patch.object(operator, "apply_remote") as apply_remote,
        ):
            payload, _ = operator.run_dry_run()
        self.assertEqual(payload["status"], "plan_ready")
        self.assertTrue(payload["read_only"])
        self.assertFalse(payload["remote_writes_requested"])
        self.assertEqual(payload["aspro_options"]["mutations"], 0)
        self.assertEqual(payload["parent_directories"][0]["uid"], 0)
        self.assertEqual(payload["operation_directory"]["status"], "missing")
        apply_remote.assert_not_called()


class PublicContractTests(unittest.TestCase):
    @staticmethod
    def html(counter_id: int, *, marker: bool) -> bytes:
        body = (
            f'<script>ym({counter_id}, "init", {{}});'.encode()
            + (
                f'/* ROSOMAHA_ATTRIBUTION_V1 */ ym({counter_id}, "getClientID", function(){{}});'
                'var x="ym_client_id=";new URLSearchParams(window.location.search);'.encode()
                + b"".join(json.dumps(key).encode("ascii") for key in operator.ATTRIBUTION_KEYS)
                if marker else b""
            )
            + f'</script><img src="https://mc.yandex.ru/watch/{counter_id}">'.encode()
        )
        return body

    def test_candidate_live_marker_passes(self) -> None:
        result = operator.verify_public_counter(
            operator.TARGET_COUNTER_ID,
            expected="candidate",
            fetcher=lambda _: self.html(operator.TARGET_COUNTER_ID, marker=True),
        )
        self.assertEqual(result["state"], "candidate")

    def test_candidate_missing_marker_or_dual_counter_fails(self) -> None:
        with self.assertRaises(operator.PublicVerificationError):
            operator.verify_public_counter(
                operator.TARGET_COUNTER_ID,
                expected="candidate",
                fetcher=lambda _: self.html(operator.TARGET_COUNTER_ID, marker=False),
            )
        dual = self.html(operator.TARGET_COUNTER_ID, marker=True) + self.html(
            operator.OLD_COUNTER_ID, marker=False
        )
        with self.assertRaises(operator.PublicVerificationError):
            operator.verify_public_counter(
                operator.TARGET_COUNTER_ID, expected="candidate", fetcher=lambda _: dual
            )

    def test_public_candidate_requires_two_consecutive_cache_bypassed_reads(self) -> None:
        bodies = iter(
            [
                self.html(operator.OLD_COUNTER_ID, marker=False),
                self.html(operator.TARGET_COUNTER_ID, marker=True),
                self.html(operator.TARGET_COUNTER_ID, marker=True),
            ]
        )
        sleeps: list[float] = []
        result = operator.verify_public_counter_converged(
            operator.TARGET_COUNTER_ID,
            expected="candidate",
            fetcher=lambda _: next(bodies),
            sleeper=sleeps.append,
        )
        self.assertEqual(result["attempts"], 3)
        self.assertEqual(result["consecutive_confirmations"], 2)
        self.assertTrue(result["cache_bypassed"])
        self.assertEqual(sleeps, [operator.PUBLIC_VERIFY_DELAY_SECONDS] * 2)

    def test_public_candidate_never_accepts_one_transient_match(self) -> None:
        bodies = iter(
            [
                self.html(operator.TARGET_COUNTER_ID, marker=True),
                self.html(operator.OLD_COUNTER_ID, marker=False),
                self.html(operator.TARGET_COUNTER_ID, marker=True),
                self.html(operator.OLD_COUNTER_ID, marker=False),
            ]
        )
        with self.assertRaisesRegex(
            operator.PublicVerificationError, "did not converge"
        ):
            operator.verify_public_counter_converged(
                operator.TARGET_COUNTER_ID,
                expected="candidate",
                fetcher=lambda _: next(bodies),
                sleeper=lambda _: None,
            )

    def test_public_urls_use_distinct_validated_cache_busters(self) -> None:
        first = operator._public_url(operator.TARGET_COUNTER_ID)
        second = operator._public_url(operator.TARGET_COUNTER_ID)
        self.assertNotEqual(first, second)
        self.assertIn("rosomaha_cache_bust=", first)
        with self.assertRaises(ValueError):
            operator._public_url(operator.TARGET_COUNTER_ID, "not-pinned")


class TransactionTests(unittest.TestCase):
    def patches(self, option_state, option_calls):
        return (
            mock.patch.object(operator, "discover_php", return_value=operator.PHP_CANDIDATES[0]),
            mock.patch.object(
                operator,
                "remote_php_lint",
                return_value={"status": "pass", "php_series": "8.2", "files": 2},
            ),
            mock.patch.object(operator, "aspro_options", side_effect=option_stub(option_state, option_calls)),
        )

    def rolled_back_sftp(self) -> FakeSFTP:
        state = {
            "site_s1": str(operator.OLD_COUNTER_ID),
            "global": str(operator.OLD_COUNTER_ID),
        }
        calls: list[str] = []
        sftp = baseline_sftp()
        client = FakeClient(sftp)
        first, second, third = self.patches(state, calls)
        with first, second, third:
            try:
                operator.apply_remote(
                    client,
                    runtime(),
                    FIXTURE_BRIDGE_CANDIDATE,
                    public_verifier=lambda _: (_ for _ in ()).throw(
                        operator.PublicVerificationError("fixture live gate failed")
                    ),
                )
            except operator.DeployError:
                pass
            else:
                raise AssertionError("Failed-apply fixture did not roll back")
        return sftp

    def test_apply_uses_same_directory_renames_backups_and_exact_option_cas(self) -> None:
        state = {"site_s1": str(operator.OLD_COUNTER_ID), "global": str(operator.OLD_COUNTER_ID)}
        calls: list[str] = []
        with fixture_pins() as counter_candidate:
            sftp = baseline_sftp()
            client = FakeClient(sftp)
            first, second, third = self.patches(state, calls)
            with first, second, third:
                result = operator.apply_remote(
                    client,
                    runtime(),
                    FIXTURE_BRIDGE_CANDIDATE,
                    public_verifier=lambda counter: {"status": 200, "counter_id": counter},
                )
        self.assertEqual(result["status"], "applied")
        self.assertEqual(sftp.files[operator.BRIDGE_PATH]["data"], FIXTURE_BRIDGE_CANDIDATE)
        self.assertEqual(sftp.files[operator.INIT_PATH]["data"], FIXTURE_INIT)
        self.assertEqual(sftp.files[operator.COUNTER_PATH]["data"], counter_candidate)
        self.assertIn(operator.CONFIG_PATH, sftp.files)
        self.assertEqual(stat.S_IMODE(sftp.files[operator.CONFIG_PATH]["mode"]), 0o600)
        self.assertEqual(set(state.values()), {str(operator.TARGET_COUNTER_ID)})
        self.assertEqual(calls, ["audit", "apply"])
        renames = [call for call in sftp.calls if call[0] == "posix_rename"]
        self.assertEqual(len(renames), 3)
        self.assertFalse(any(".init." in call[1] for call in renames))
        self.assertTrue(result["config_outside_docroot"])
        op_dir = operator.OPERATION_ROOT + "/" + result["operation_id"]
        self.assertIn(op_dir + "/bridge.before", sftp.files)
        self.assertIn(op_dir + "/init.before", sftp.files)
        self.assertIn(op_dir + "/counter.before", sftp.files)
        self.assertIn(op_dir + "/runtime_config.before-missing.json", sftp.files)
        receipt = sftp.files[op_dir + "/operation.json"]["data"]
        self.assertNotIn(runtime()["credential"].encode(), receipt)

    def test_baseline_drift_blocks_before_any_write(self) -> None:
        state = {"site_s1": str(operator.OLD_COUNTER_ID), "global": str(operator.OLD_COUNTER_ID)}
        calls: list[str] = []
        with fixture_pins():
            sftp = baseline_sftp()
            sftp.files[operator.BRIDGE_PATH]["data"] += b"drift"
            client = FakeClient(sftp)
            with self.patches(state, calls)[0], self.patches(state, calls)[1], self.patches(state, calls)[2]:
                with self.assertRaises(operator.DeployError):
                    operator.apply_remote(
                        client, runtime(), FIXTURE_BRIDGE_CANDIDATE,
                        public_verifier=lambda _: {"status": 200},
                    )
        self.assertFalse(any(call[0] in {"mkdir", "posix_rename", "remove"} for call in sftp.calls))
        self.assertEqual(calls, [])

    def test_public_failure_restores_all_files_config_and_options(self) -> None:
        state = {"site_s1": str(operator.OLD_COUNTER_ID), "global": str(operator.OLD_COUNTER_ID)}
        calls: list[str] = []
        with fixture_pins():
            sftp = baseline_sftp()
            client = FakeClient(sftp)
            first, second, third = self.patches(state, calls)
            with first, second, third:
                with self.assertRaises(operator.DeployError) as raised:
                    operator.apply_remote(
                        client,
                        runtime(),
                        FIXTURE_BRIDGE_CANDIDATE,
                        public_verifier=lambda _: (_ for _ in ()).throw(
                            operator.PublicVerificationError("offline public failure")
                        ),
                    )
        self.assertIn(
            "redacted original cause: PublicVerificationError: offline public failure",
            str(raised.exception),
        )
        self.assertIn("were restored", str(raised.exception))
        self.assertEqual(sftp.files[operator.BRIDGE_PATH]["data"], FIXTURE_BRIDGE_BASELINE)
        self.assertEqual(sftp.files[operator.INIT_PATH]["data"], FIXTURE_INIT)
        self.assertEqual(sftp.files[operator.COUNTER_PATH]["data"], FIXTURE_COUNTER_BASELINE)
        self.assertNotIn(operator.CONFIG_PATH, sftp.files)
        self.assertEqual(set(state.values()), {str(operator.OLD_COUNTER_ID)})
        self.assertEqual(calls, ["audit", "apply", "rollback"])

    def test_exact_rolled_back_operation_is_reused_without_overwriting_backups(self) -> None:
        state = {"site_s1": str(operator.OLD_COUNTER_ID), "global": str(operator.OLD_COUNTER_ID)}
        calls: list[str] = []
        with fixture_pins():
            sftp = baseline_sftp()
            client = FakeClient(sftp)
            first, second, third = self.patches(state, calls)
            with first, second, third:
                with self.assertRaises(operator.DeployError):
                    operator.apply_remote(
                        client,
                        runtime(),
                        FIXTURE_BRIDGE_CANDIDATE,
                        public_verifier=lambda _: (_ for _ in ()).throw(
                            operator.PublicVerificationError("first live gate failed")
                        ),
                    )
                retried = operator.apply_remote(
                    client,
                    runtime(),
                    FIXTURE_BRIDGE_CANDIDATE,
                    public_verifier=lambda counter: {"status": 200, "counter_id": counter},
                )
        self.assertEqual(retried["status"], "applied")
        self.assertEqual(
            retried["operation_directory"]["status"], "reusable_rolled_back"
        )
        operation = operator.OPERATION_ROOT + "/" + retried["operation_id"]
        for name in ("bridge", "init", "counter"):
            writes = [
                call
                for call in sftp.calls
                if call == ("open", operation + f"/{name}.before", "wx")
            ]
            self.assertEqual(len(writes), 1)

    def test_reusable_operation_rejects_each_backup_type_mode_uid_and_gid_drift(self) -> None:
        mutations = (
            ("type", "mode", stat.S_IFLNK | 0o600),
            ("permissions", "mode", stat.S_IFREG | 0o640),
            ("uid", "uid", operator.EXPECTED_UID + 1),
            ("gid", "gid", operator.EXPECTED_GID + 1),
        )
        for backup_name in ("bridge", "init", "counter"):
            for case, field, value in mutations:
                with self.subTest(backup=backup_name, case=case), fixture_pins():
                    sftp = self.rolled_back_sftp()
                    plans, operation_id = operator._plans_from_remote(
                        sftp, runtime(), FIXTURE_BRIDGE_CANDIDATE
                    )
                    paths = operator._paths(operation_id, plans)
                    backup = paths["items"][backup_name]["backup"]
                    sftp.files[backup][field] = value
                    with self.assertRaisesRegex(
                        operator.DeployError,
                        "type/size is unsafe|mode/ownership identity drifted|metadata drifted",
                    ):
                        operator._validate_reusable_rolled_back_operation(
                            sftp, paths, plans
                        )

    def test_reusable_operation_rejects_marker_type_mode_uid_and_gid_drift(self) -> None:
        mutations = (
            ("type", "mode", stat.S_IFLNK | 0o600),
            ("permissions", "mode", stat.S_IFREG | 0o640),
            ("uid", "uid", operator.EXPECTED_UID + 1),
            ("gid", "gid", operator.EXPECTED_GID + 1),
        )
        for case, field, value in mutations:
            with self.subTest(case=case), fixture_pins():
                sftp = self.rolled_back_sftp()
                plans, operation_id = operator._plans_from_remote(
                    sftp, runtime(), FIXTURE_BRIDGE_CANDIDATE
                )
                paths = operator._paths(operation_id, plans)
                marker = paths["items"]["runtime_config"]["missing_marker"]
                sftp.files[marker][field] = value
                with self.assertRaisesRegex(
                    operator.DeployError,
                    "type/size is unsafe|mode/ownership identity drifted|metadata drifted",
                ):
                    operator._validate_reusable_rolled_back_operation(
                        sftp, paths, plans
                    )

    def test_rolled_back_operation_with_unexpected_artifact_blocks_retry_before_write(self) -> None:
        state = {"site_s1": str(operator.OLD_COUNTER_ID), "global": str(operator.OLD_COUNTER_ID)}
        calls: list[str] = []
        with fixture_pins():
            sftp = baseline_sftp()
            client = FakeClient(sftp)
            first, second, third = self.patches(state, calls)
            with first, second, third:
                with self.assertRaises(operator.DeployError):
                    operator.apply_remote(
                        client,
                        runtime(),
                        FIXTURE_BRIDGE_CANDIDATE,
                        public_verifier=lambda _: (_ for _ in ()).throw(
                            operator.PublicVerificationError("first live gate failed")
                        ),
                    )
                operation_id = operator._operation_id(
                    bridge=FIXTURE_BRIDGE_CANDIDATE,
                    init=FIXTURE_INIT,
                    counter=operator.build_counter_candidate(
                        FIXTURE_COUNTER_BASELINE, operator.TARGET_COUNTER_ID
                    ),
                    counter_id=operator.TARGET_COUNTER_ID,
                    goal_ids=runtime()["goal_ids"],
                )
                operation = operator.OPERATION_ROOT + "/" + operation_id
                sftp.files[operation + "/unexpected"] = {
                    "data": b"x",
                    "mode": stat.S_IFREG | 0o600,
                    "uid": operator.EXPECTED_UID,
                    "gid": operator.EXPECTED_GID,
                }
                writes_before = len(
                    [
                        call
                        for call in sftp.calls
                        if call[0] in {"mkdir", "posix_rename", "remove"}
                        or (call[0] == "open" and call[2] == "wx")
                    ]
                )
                with self.assertRaisesRegex(
                    operator.DeployError, "not an exact rolled-back transaction"
                ):
                    operator.apply_remote(
                        client,
                        runtime(),
                        FIXTURE_BRIDGE_CANDIDATE,
                        public_verifier=lambda counter: {"status": 200, "counter_id": counter},
                    )
                writes_after = len(
                    [
                        call
                        for call in sftp.calls
                        if call[0] in {"mkdir", "posix_rename", "remove"}
                        or (call[0] == "open" and call[2] == "wx")
                    ]
                )
        self.assertEqual(writes_after, writes_before)

    def test_explicit_rollback_restores_exact_baseline(self) -> None:
        state = {"site_s1": str(operator.OLD_COUNTER_ID), "global": str(operator.OLD_COUNTER_ID)}
        calls: list[str] = []
        with fixture_pins():
            sftp = baseline_sftp()
            client = FakeClient(sftp)
            first, second, third = self.patches(state, calls)
            with first, second, third:
                applied = operator.apply_remote(
                    client, runtime(), FIXTURE_BRIDGE_CANDIDATE,
                    public_verifier=lambda counter: {"status": 200, "counter_id": counter},
                )
                rolled = operator.rollback_remote(
                    client, applied["operation_id"], runtime(), FIXTURE_BRIDGE_CANDIDATE,
                    public_verifier=lambda counter: {"status": 200, "counter_id": counter},
                )
                repeated = operator.rollback_remote(
                    client, applied["operation_id"], runtime(), FIXTURE_BRIDGE_CANDIDATE,
                    public_verifier=lambda counter: {"status": 200, "counter_id": counter},
                )
        self.assertEqual(rolled["status"], "rolled_back")
        self.assertEqual(repeated["status"], "rolled_back")
        self.assertEqual(sftp.files[operator.BRIDGE_PATH]["data"], FIXTURE_BRIDGE_BASELINE)
        self.assertEqual(sftp.files[operator.COUNTER_PATH]["data"], FIXTURE_COUNTER_BASELINE)
        self.assertNotIn(operator.CONFIG_PATH, sftp.files)
        self.assertEqual(set(state.values()), {str(operator.OLD_COUNTER_ID)})

    def test_apply_and_rollback_guards_block_before_dispatch(self) -> None:
        with mock.patch.object(operator, "require_committed_operator") as committed:
            with mock.patch.dict(os.environ, {}, clear=True):
                with self.assertRaises(operator.DeployError):
                    operator.run_apply()
                with self.assertRaises(operator.DeployError):
                    operator.run_rollback("bitrix-metrika-" + "a" * 24)
        committed.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)
