from __future__ import annotations

import copy
import hashlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import time
import types
import unittest
from contextlib import redirect_stderr
from datetime import datetime, timedelta, timezone
from pathlib import Path, PurePosixPath
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
HELPER_PATH = ROOT / "scripts/rosomaha-staging-dist-sync.py"
OPERATOR_PATH = ROOT / "scripts/rosomaha-staging-dist-sync-operator.sh"


def load_helper():
    spec = importlib.util.spec_from_file_location("rosomaha_staging_dist_sync", HELPER_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def operator_python_source() -> str:
    source = OPERATOR_PATH.read_text(encoding="utf-8")
    marker = "<<'PY'\n"
    start = source.index(marker) + len(marker)
    end = source.rindex("\nPY\n")
    return source[start:end]


def operator_namespace() -> dict:
    fake_fcntl = types.ModuleType("fcntl")
    fake_fcntl.LOCK_EX = 2
    fake_fcntl.LOCK_NB = 4
    fake_fcntl.flock = lambda *_args, **_kwargs: None
    fake_pwd = types.ModuleType("pwd")
    fake_pwd.getpwuid = lambda _uid: types.SimpleNamespace(pw_name="root")
    namespace = {"__name__": "operator_test"}
    with mock.patch.dict(sys.modules, {"fcntl": fake_fcntl, "pwd": fake_pwd}), mock.patch.object(
        sys, "argv", [str(OPERATOR_PATH), "audit", "", ""]
    ):
        exec(compile(operator_python_source(), str(OPERATOR_PATH), "exec"), namespace)
    return namespace


def manifest(label: str, *, root_info: dict | None = None) -> dict:
    entry = {"path": "index.html", "bytes": len(label), "sha256": (label[0] * 64)[:64]}
    digest = hashlib.sha256(
        json.dumps([entry], ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return {
        "root": f"/{label}", "valid": True, "files": [entry], "file_count": 1,
        "directory_count": 0, "digest": digest,
        "root_info": root_info or {
            "path": f"/{label}", "realpath": f"/{label}", "exists": True,
            "directory": True, "symlink": False, "uid": 0, "gid": 0,
            "mode": "0o755", "dev": 7, "valid": True,
        },
    }


def snapshot_fixture(helper, *, exact: bool = False) -> dict:
    current = manifest("a-current")
    staging = copy.deepcopy(current) if exact else manifest("b-staging")
    article = {
        "sha256": "c" * 64, "bytes": 12, "count": 1, "unique_count": 1,
        "duplicates": [], "slug_digest": "d" * 64, "valid": True,
    }
    current_link = {
        "path": helper.CURRENT_LINK, "exists": True, "symlink": True,
        "uid": 0, "gid": 0, "mode": "0o777",
        "link_target": f"{helper.RELEASES_DIR}/20260817-000000-live",
        "realpath": f"{helper.RELEASES_DIR}/20260817-000000-live", "valid": True,
    }
    roots = {
        "filesystem_root": {"path": "/", "dev": 7, "valid": True},
        "var": {"path": "/var", "dev": 7, "valid": True},
        "var_www": {"path": "/var/www", "dev": 7, "valid": True},
        "app_root": {"path": helper.APP_ROOT, "dev": 7, "valid": True},
        "releases": {"path": helper.RELEASES_DIR, "dev": 7, "valid": True},
        "dist": {
            "path": helper.DIST_DIR, "realpath": helper.DIST_DIR, "exists": True,
            "directory": True, "symlink": False, "uid": 0, "gid": 33,
            "mode": "0o775", "dev": 7, "valid": True,
        },
    }
    cz_files = [{"name": "index.ts", "bytes": 1, "sha256": "e" * 64}]
    cz_digest = hashlib.sha256(
        json.dumps(cz_files, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    payload = {
        "schema": helper.SCHEMA, "host": helper.HOST, "mode": "audit",
        "account": helper.AUDIT_LOGIN, "roles": helper.ROLES,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "current_release": current_link["realpath"], "current_link": current_link,
        "topology": {
            "roots": roots, "current_link": current_link, "same_filesystem": True,
            "devices": {"app_root": 7, "releases": 7, "dist": 7}, "valid": True,
        },
        "current_trust": {"root": current_link["realpath"], "valid": True, "file_count": 1},
        "current_tree": current, "staging_dist": staging,
        "manifest_diff": {
            "missing_from_staging": [], "extra_in_staging": [],
            "changed": [] if exact else ["index.html"],
            "missing_count": 0, "extra_count": 0,
            "changed_count": 0 if exact else 1, "exact": exact,
        },
        "articles": {"canonical": article, "current": article, "live": article},
        "article_parity": True,
        "articles_cz": {
            "valid": True, "count": 1,
            "files": cz_files, "digest": cz_digest,
        },
        "release_scripts": {
            "server-release.sh": {
                "path": f"{helper.APP_ROOT}/scripts/server-release.sh",
                "sha256": helper.RELEASE_SCRIPT_SHA256,
                "expected_sha256": helper.RELEASE_SCRIPT_SHA256, "valid": True,
            },
            "server-rollback.sh": {
                "path": f"{helper.APP_ROOT}/scripts/server-rollback.sh",
                "sha256": helper.ROLLBACK_SCRIPT_SHA256,
                "expected_sha256": helper.ROLLBACK_SCRIPT_SHA256, "valid": True,
            },
        },
        "lock": {
            "path": helper.LOCK_PATH, "nlink": 1, "uid": 0, "gid": 0,
            "mode": "0o600", "dev": 7, "ino": 7001, "valid": True,
        },
        "blockers": [], "status": "already_synced" if exact else "ready",
    }
    payload["audit_epoch"] = int(datetime.now(timezone.utc).timestamp())
    payload["baseline_token"] = helper.receipt_bound_token(payload, payload["audit_epoch"])
    return payload


def baseline_wrapper(helper, remote: dict, *, captured: datetime | None = None) -> dict:
    captured = captured or datetime.now(timezone.utc)
    payload = {
        "schema": helper.SCHEMA, "status": remote["status"], "mode": "baseline",
        "captured_at": captured.isoformat(), "expires_at": (captured + helper.AUDIT_TTL).isoformat(),
        "host": helper.HOST, "roles": helper.ROLES, "account": helper.AUDIT_LOGIN,
        "operator_sha256": helper.sha256_bytes(helper.operator_bytes()),
        "audit_identity": {"login": helper.AUDIT_LOGIN, "role_verified": True},
        "baseline_token": remote["baseline_token"], "audit_epoch": remote["audit_epoch"], "server": remote,
    }
    payload["receipt_token"] = helper.sha256_bytes(helper.canonical_json(helper.receipt_material(payload)))
    return payload


class StagingDistSyncTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.helper = load_helper()
        cls.operator = operator_namespace()

    def setUp(self):
        self.operator["AUDIT_EPOCH_RAW"] = ""
        app = PurePosixPath(self.helper.APP_ROOT)
        self.operator["APP_ROOT"] = app
        self.operator["DIST_DIR"] = app / "dist"
        self.operator["RELEASES_DIR"] = app / "_releases"
        self.operator["CURRENT_LINK"] = app / "current"
        self.operator["CANONICAL_ARTICLES"] = app / "public/api/articles.json"
        self.operator["ARTICLES_CZ_DIR"] = app / "src/data/articles-cz"
        self.operator["RELEASE_SCRIPT"] = app / "scripts/server-release.sh"
        self.operator["ROLLBACK_SCRIPT"] = app / "scripts/server-rollback.sh"
        self.operator["LOCK_PATH"] = app / ".rosomaha-main-price-release.lock"

    def test_operator_embedded_python_compiles_and_shell_is_fixed(self):
        compile(operator_python_source(), str(OPERATOR_PATH), "exec")
        source = OPERATOR_PATH.read_text(encoding="utf-8")
        self.assertIn('APP_ROOT = Path("/var/www/rosomaha")', source)
        self.assertIn('LOCK_PATH = APP_ROOT / ".rosomaha-main-price-release.lock"', source)
        self.assertIn(self.helper.RELEASE_SCRIPT_SHA256, source)
        self.assertIn(self.helper.ROLLBACK_SCRIPT_SHA256, source)
        self.assertNotIn("subprocess", source)
        self.assertNotIn("os.system", source)
        self.assertNotIn("sudo", source)
        observed = hashlib.sha256(OPERATOR_PATH.read_bytes()).hexdigest()
        self.assertEqual(observed, self.helper.PINNED_OPERATOR_SHA256)
        self.assertEqual(self.helper.sha256_bytes(self.helper.operator_bytes()), observed)

    def test_only_dist_candidate_backup_are_atomic_replace_targets(self):
        source = operator_python_source()
        self.assertNotIn("os.replace(CURRENT_LINK", source)
        self.assertNotIn("os.replace(RELEASE", source)
        self.assertNotIn("os.replace(CANONICAL", source)
        self.assertNotIn("os.replace(ARTICLES_CZ", source)
        self.assertLess(source.index("fcntl.flock"), source.index("os.replace(DIST_DIR, paths[\"backup\"])") )
        self.assertLess(
            source.index("os.replace(DIST_DIR, paths[\"backup\"])") ,
            source.index("os.replace(paths[\"candidate\"], DIST_DIR)"),
        )

    def test_manifest_diff_is_exact_and_directional(self):
        current = {
            "valid": True,
            "files": [
                {"path": "a", "bytes": 1, "sha256": "a" * 64},
                {"path": "b", "bytes": 2, "sha256": "b" * 64},
            ],
        }
        staging = {
            "valid": True,
            "files": [
                {"path": "b", "bytes": 3, "sha256": "c" * 64},
                {"path": "c", "bytes": 4, "sha256": "d" * 64},
            ],
        }
        observed = self.operator["manifest_diff"](current, staging)
        self.assertEqual(observed["missing_from_staging"], ["a"])
        self.assertEqual(observed["extra_in_staging"], ["c"])
        self.assertEqual(observed["changed"], ["b"])
        self.assertFalse(observed["exact"])

    def test_manifest_rejects_hardlinks_and_symlinks(self):
        with tempfile.TemporaryDirectory() as raw:
            app = Path(raw).resolve()
            tree = app / "tree"
            tree.mkdir()
            os.chmod(app, 0o700)
            os.chmod(tree, 0o755)
            original = tree / "a.txt"
            original.write_text("safe", encoding="utf-8")
            os.chmod(original, 0o644)
            self.operator["APP_ROOT"] = app
            original_safe_root = self.operator["safe_mutable_root"]
            self.operator["safe_mutable_root"] = lambda path: {
                "path": str(path), "realpath": str(path), "uid": 0, "gid": 0,
                "mode": "0o755", "dev": os.lstat(path).st_dev, "valid": True,
            }
            try:
                first = self.operator["tree_manifest"](tree)
                self.assertTrue(first["valid"], first)
                linked = tree / "b.txt"
                os.link(original, linked)
                hardlinked = self.operator["tree_manifest"](tree)
                self.assertFalse(hardlinked["valid"])
                linked.unlink()
                try:
                    os.symlink(original, linked)
                except OSError:
                    return
                symlinked = self.operator["tree_manifest"](tree)
                self.assertFalse(symlinked["valid"])
            finally:
                self.operator["safe_mutable_root"] = original_safe_root

    def test_article_parser_rejects_duplicate_slugs(self):
        raw = json.dumps([{"slug": "one"}, {"slug": "one"}], ensure_ascii=False).encode()
        info = self.operator["article_info"](raw, "test")
        self.assertFalse(info["valid"])
        self.assertEqual(info["duplicates"], ["one"])

    def test_recovery_classifier_accepts_only_known_states(self):
        old = manifest("o-old")
        current = manifest("n-new")
        baseline = {"staging_dist": old, "current_tree": current}
        classify = self.operator["recovery_classification"]
        self.assertEqual(classify(baseline, current, old, None), "synced_with_backup")
        self.assertEqual(classify(baseline, old, None, None), "baseline_restored")
        self.assertEqual(classify(baseline, old, None, current), "baseline_with_candidate")
        self.assertEqual(classify(baseline, None, old, current), "dist_missing_recoverable")
        self.assertEqual(classify(baseline, manifest("x-drift"), old, current), "unknown")

    def test_reconstructed_recovery_material_matches_original_baseline(self):
        helper = self.helper
        baseline = snapshot_fixture(helper)
        old_root = baseline["topology"]["roots"]["dist"]
        baseline["staging_dist"]["root_info"] = copy.deepcopy(old_root)
        observed = copy.deepcopy(baseline)
        observed["staging_dist"] = copy.deepcopy(observed["current_tree"])
        observed["topology"]["roots"]["dist"] = copy.deepcopy(observed["current_tree"]["root_info"])
        observed["topology"]["roots"]["dist"]["path"] = helper.DIST_DIR
        observed["topology"]["roots"]["dist"]["realpath"] = helper.DIST_DIR
        backup_old = copy.deepcopy(baseline["staging_dist"])
        backup_old["root_info"]["path"] = f"{helper.APP_ROOT}/.staging-dist-sync-state-token/backup"
        backup_old["root_info"]["realpath"] = backup_old["root_info"]["path"]
        reconstructed = self.operator["reconstructed_baseline_material"](observed, backup_old)
        expected = self.operator["state_material"](baseline)
        self.assertEqual(self.operator["canonical_json"](reconstructed), self.operator["canonical_json"](expected))

    def test_local_and_remote_state_material_contracts_match(self):
        payload = snapshot_fixture(self.helper)
        local = self.helper.remote_state_material(payload)
        remote = self.operator["state_material"](payload)
        self.assertEqual(self.helper.canonical_json(local), self.operator["canonical_json"](remote))

    def test_postread_rejects_shared_lock_inode_drift(self):
        baseline = snapshot_fixture(self.helper)
        observed = copy.deepcopy(baseline)
        observed["lock"]["ino"] += 1
        with self.assertRaises(self.operator["SyncError"]):
            self.operator["invariant_after"](observed, baseline, expect_dist_current=False)

    def test_remote_audit_token_tamper_is_rejected(self):
        payload = snapshot_fixture(self.helper)
        self.helper.validate_remote_audit(payload)
        payload["staging_dist"]["digest"] = "0" * 64
        with self.assertRaises(self.helper.HelperError):
            self.helper.validate_remote_audit(payload)

    def test_baseline_is_content_bound_and_fresh_for_apply(self):
        remote = snapshot_fixture(self.helper)
        with tempfile.TemporaryDirectory() as raw:
            report_root = Path(raw).resolve()
            payload = baseline_wrapper(self.helper, remote)
            path = report_root / "20260817T000000Z-test-rosomaha-staging-dist-baseline.json"
            path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            with mock.patch.object(self.helper, "REPORT_ROOT", report_root), mock.patch.object(
                self.helper, "safe_directory", side_effect=lambda path, _root: Path(path).resolve()
            ):
                loaded, resolved, _ = self.helper.load_baseline(path, require_fresh=True)
                self.assertEqual(loaded["baseline_token"], remote["baseline_token"])
                self.assertEqual(resolved, path)
                tampered = copy.deepcopy(payload)
                tampered["server"]["current_release"] += "-tampered"
                path.write_text(json.dumps(tampered, ensure_ascii=False), encoding="utf-8")
                with self.assertRaises(self.helper.HelperError):
                    self.helper.load_baseline(path, require_fresh=True)

    def test_read_exact_regular_tolerates_handle_timestamp_drift_when_path_is_stable(self):
        helper = self.helper
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw).resolve()
            target = root / "receipt.json"
            target.write_text('{"status":"ready"}', encoding="utf-8")
            original_fstat = helper.os.fstat
            calls = {"count": 0}

            def fake_fstat(fd):
                stat_result = original_fstat(fd)
                calls["count"] += 1
                if calls["count"] != 2:
                    return stat_result
                values = list(stat_result)
                values[8] = values[8] + 1
                values[9] = values[9] + 1
                return os.stat_result(values)

            with mock.patch.object(helper.os, "fstat", side_effect=fake_fstat):
                observed = helper.read_exact_regular(target, root, max_bytes=helper.MAX_RECEIPT_BYTES)
            self.assertEqual(observed, target.read_bytes())

    def test_load_baseline_retries_transient_changed_during_read(self):
        remote = snapshot_fixture(self.helper)
        payload = baseline_wrapper(self.helper, remote)
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        with tempfile.TemporaryDirectory() as raw_dir:
            report_root = Path(raw_dir).resolve()
            path = report_root / "20260817T000000Z-test-rosomaha-staging-dist-baseline.json"
            path.write_bytes(raw)
            calls = {"count": 0}

            def flaky_read(*_args, **_kwargs):
                calls["count"] += 1
                if calls["count"] == 1:
                    raise self.helper.HelperError(
                        f"bounded regular file changed during read: {path}"
                    )
                return raw

            with mock.patch.object(self.helper, "REPORT_ROOT", report_root), mock.patch.object(
                self.helper, "safe_directory", side_effect=lambda path, _root: Path(path).resolve()
            ), mock.patch.object(self.helper, "read_exact_regular", side_effect=flaky_read), mock.patch.object(
                self.helper.time, "sleep", return_value=None
            ):
                loaded, resolved, _ = self.helper.load_baseline(path, require_fresh=True)
            self.assertEqual(calls["count"], 2)
            self.assertEqual(loaded["baseline_token"], remote["baseline_token"])
            self.assertEqual(resolved, path)

    def test_expired_receipt_blocks_apply_but_remains_recoverable(self):
        remote = snapshot_fixture(self.helper)
        captured = datetime.now(timezone.utc) - timedelta(hours=2)
        remote["audit_epoch"] = int(captured.timestamp())
        remote["baseline_token"] = self.helper.receipt_bound_token(remote, remote["audit_epoch"])
        with self.assertRaises(self.helper.HelperError):
            self.helper.validate_remote_audit(remote)
        self.helper.validate_remote_audit(remote, require_fresh_epoch=False)
        payload = baseline_wrapper(self.helper, remote, captured=captured)
        with tempfile.TemporaryDirectory() as raw:
            report_root = Path(raw).resolve()
            path = report_root / "20260817T000000Z-test-rosomaha-staging-dist-baseline.json"
            path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            with mock.patch.object(self.helper, "REPORT_ROOT", report_root), mock.patch.object(
                self.helper, "safe_directory", side_effect=lambda path, _root: Path(path).resolve()
            ):
                with self.assertRaises(self.helper.HelperError):
                    self.helper.load_baseline(path, require_fresh=True)
                loaded, _, _ = self.helper.load_baseline(path, require_fresh=False)
                self.assertEqual(loaded["baseline_token"], remote["baseline_token"])

    def test_remote_operator_also_rejects_expired_apply_epoch(self):
        self.operator["AUDIT_EPOCH_RAW"] = str(int(time.time()) - self.operator["AUDIT_TTL_SECONDS"] - 1)
        with self.assertRaises(self.operator["SyncError"]):
            self.operator["parsed_audit_epoch"](require_fresh=True)
        observed = self.operator["parsed_audit_epoch"](require_fresh=False)
        self.assertIsInstance(observed, int)

    def test_path_escape_and_wrong_filename_are_rejected(self):
        with tempfile.TemporaryDirectory() as raw:
            report_root = Path(raw).resolve()
            outside = report_root.parent / "outside-baseline.json"
            outside.write_text("{}", encoding="utf-8")
            wrong = report_root / "wrong.json"
            wrong.write_text("{}", encoding="utf-8")
            try:
                with mock.patch.object(self.helper, "REPORT_ROOT", report_root), mock.patch.object(
                    self.helper, "safe_directory", side_effect=lambda path, _root: Path(path).resolve()
                ):
                    with self.assertRaises(self.helper.HelperError):
                        self.helper.safe_baseline_path(outside)
                    with self.assertRaises(self.helper.HelperError):
                        self.helper.safe_baseline_path(wrong)
            finally:
                outside.unlink(missing_ok=True)

    def test_cli_defaults_to_audit_and_binds_baseline_to_mutations(self):
        parser = self.helper.argument_parser()
        default = parser.parse_args([])
        self.assertFalse(default.apply)
        self.assertFalse(default.recover)
        self.assertIsNone(default.baseline)
        apply = parser.parse_args(["--apply", "--baseline", "receipt.json"])
        self.assertTrue(apply.apply)
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            parser.parse_args(["--apply", "--recover"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
