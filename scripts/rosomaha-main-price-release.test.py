from __future__ import annotations

import importlib.util
import ast
import json
import os
import sys
import tempfile
import types
import unittest
import urllib.error
from pathlib import Path
from unittest import mock


PROJECT_ROOT = Path(__file__).resolve().parents[1]
HELPER_PATH = PROJECT_ROOT / "scripts/rosomaha-main-price-release.py"
OPERATOR_PATH = PROJECT_ROOT / "scripts/rosomaha-main-price-release-operator.sh"

spec = importlib.util.spec_from_file_location("rosomaha_main_price_release", HELPER_PATH)
assert spec and spec.loader
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


def operator_source() -> str:
    raw = OPERATOR_PATH.read_text(encoding="utf-8")
    return raw[raw.index("<<'PY'\n") + len("<<'PY'\n") : raw.rindex("\nPY")]


def operator_namespace() -> dict:
    source = operator_source().rsplit("raise SystemExit(main())", 1)[0]
    fake_fcntl = types.ModuleType("fcntl")
    fake_pwd = types.ModuleType("pwd")
    with mock.patch.dict(sys.modules, {"fcntl": fake_fcntl, "pwd": fake_pwd}), mock.patch.object(
        sys, "argv", ["operator", "audit", ""],
    ):
        namespace = {"__name__": "rosomaha_operator_test"}
        exec(compile(source, str(OPERATOR_PATH), "exec"), namespace)
    return namespace


def page_html(path: str, price: int | str | float | None = None, *, title: str = "Модель Росомаха", description: str = "Описание") -> bytes:
    url = helper.BASE_URL + ("/" if path == "/" else path)
    visible = ""
    structured = ""
    if price is not None:
        visible = f"<main>Цена {helper.formatted_price(int(price))}</main>"
        structured = (
            '<script type="application/ld+json">'
            + json.dumps({"@context": "https://schema.org", "@type": "Product", "url": url, "offers": {"@type": "Offer", "price": price}}, ensure_ascii=False)
            + "</script>"
        )
    return (
        "<!doctype html><html><head>"
        f"<title>{title}</title>"
        f'<meta name="description" content="{description}">'
        f'<meta property="og:url" content="{url}">'
        '<meta name="robots" content="index, follow">'
        f'<link rel="canonical" href="{url}">'
        f"{structured}</head><body>{visible}</body></html>"
    ).encode("utf-8")


class FakeResponse:
    def __init__(self, raw: bytes, url: str, status: int = 200) -> None:
        self.raw = raw
        self.url = url
        self.status = status
        self.headers = {"Content-Type": "text/html"}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _limit: int) -> bytes:
        return self.raw

    def geturl(self) -> str:
        return self.url


class MainPriceReleaseV3Test(unittest.TestCase):
    def test_fixed_identity_and_commit_are_pinned(self) -> None:
        self.assertEqual(helper.SCHEMA, "rosomaha-main-price-release/v3")
        self.assertEqual(helper.AUDIT_LOGIN, "deploy")
        self.assertEqual(helper.APPLY_LOGIN, "root")
        self.assertEqual(helper.ROLES, {"audit": "deploy", "apply": "root"})
        self.assertEqual(helper.TARGET_COMMIT, "64ba304c6c3128493a30e7408273652a326752d3")
        self.assertEqual(helper.EXPECTED_PUBLIC_KEY_FINGERPRINT, "SHA256:Bvnk8M0TiB4Ovg17j/WvixBPxsjeWuiN6zcfFWa40Uo")
        self.assertEqual(helper.IDENTITY_FILE.name, "id_ed25519")
        self.assertEqual(len(helper.ARTICLES_CZ_ALLOWLIST), 33)
        self.assertIn("avgustovskiy-marshrut-na-rosomahe-chek-list-osmotra-pered-vyezdom.ts", helper.ARTICLES_CZ_ALLOWLIST)
        self.assertIn("rosomaha-zastryala-v-bolote-spokoynyy-poryadok-deystviy-bez-lishney-suety.ts", helper.ARTICLES_CZ_ALLOWLIST)
        self.assertIn("bolotohod-ili-smert-pochemu-aprel-ubivaet-tehniku-silnee-chem-yanvar.ts", helper.ARTICLES_CZ_ALLOWLIST)

    def test_exact_33_file_cz_allowlist_is_identical_in_wrapper_and_operator(self) -> None:
        expected_digest = "bcf61fd319d10727dd32956b87c97f80d31e763dc5f20052ad9c25e4be6409f6"
        observed_digest = helper.sha256_bytes(("\n".join(helper.ARTICLES_CZ_ALLOWLIST) + "\n").encode("utf-8"))
        self.assertEqual(observed_digest, expected_digest)
        raw = OPERATOR_PATH.read_text(encoding="utf-8")
        embedded = raw[raw.index("<<'PY'\n") + len("<<'PY'\n") : raw.rindex("\nPY")]
        tree = ast.parse(embedded)
        assignment = next(
            node for node in tree.body
            if isinstance(node, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == "ARTICLES_CZ_ALLOWLIST" for target in node.targets)
        )
        self.assertEqual(ast.literal_eval(assignment.value), helper.ARTICLES_CZ_ALLOWLIST)

    def test_saved_acl_does_not_treat_c_users_path_as_builtin_users(self) -> None:
        current_sid = "S-1-5-21-111-222-333-1001"
        saved = (
            "C:\\Users\\Макс\\.ssh\\id_ed25519\r\n"
            f"D:P(A;;FA;;;BA)(A;;FA;;;SY)(A;;0x1301bf;;;{current_sid})\r\n"
        )
        evidence = helper.validate_saved_windows_acl(saved, current_sid)
        self.assertTrue(evidence["dacl_protected"])
        self.assertEqual(evidence["allowed_principal_count"], 3)

    def test_saved_acl_rejects_builtin_users_broad_principal(self) -> None:
        current_sid = "S-1-5-21-111-222-333-1001"
        # SDDL trustee BU is localization-independent BUILTIN\\Users (S-1-5-32-545).
        saved = f"id_ed25519\r\nD:P(A;;FA;;;BA)(A;;FA;;;SY)(A;;FR;;;BU)(A;;FR;;;{current_sid})\r\n"
        with self.assertRaisesRegex(helper.HelperError, "unknown or broad principal"):
            helper.validate_saved_windows_acl(saved, current_sid)

    def test_saved_acl_rejects_inheritance_and_unknown_sid(self) -> None:
        current_sid = "S-1-5-21-111-222-333-1001"
        inherited = f"id_ed25519\r\nD:PAI(A;ID;FR;;;{current_sid})\r\n"
        with self.assertRaisesRegex(helper.HelperError, "protected from inheritance"):
            helper.validate_saved_windows_acl(inherited, current_sid)
        unknown = f"id_ed25519\r\nD:P(A;;FR;;;{current_sid})(A;;FR;;;S-1-5-21-999-888-777-1002)\r\n"
        with self.assertRaisesRegex(helper.HelperError, "unknown or broad principal"):
            helper.validate_saved_windows_acl(unknown, current_sid)

    def test_operator_embedded_python_compiles(self) -> None:
        raw = OPERATOR_PATH.read_text(encoding="utf-8")
        start = raw.index("<<'PY'\n") + len("<<'PY'\n")
        end = raw.rindex("\nPY")
        compile(raw[start:end], str(OPERATOR_PATH), "exec")

    def test_operator_embedded_python_is_python38_syntax_compatible(self) -> None:
        raw = OPERATOR_PATH.read_text(encoding="utf-8")
        start = raw.index("<<'PY'\n") + len("<<'PY'\n")
        end = raw.rindex("\nPY")
        source = raw[start:end]
        ast.parse(source, str(OPERATOR_PATH), feature_version=(3, 8))
        self.assertNotIn(" | None", source)
        self.assertNotRegex(source, r":\s*(?:dict|list|tuple|set)\[")

    def test_operator_entry_and_all_wrapper_remote_commands_are_absolute(self) -> None:
        operator = OPERATOR_PATH.read_text(encoding="utf-8")
        wrapper = HELPER_PATH.read_text(encoding="utf-8")
        self.assertIn("exec /usr/bin/python3 -I -B -", operator)
        self.assertNotRegex(wrapper, r'run_remote\([^\n]*["\']bash -s')
        self.assertGreaterEqual(wrapper.count("/bin/bash -s --"), 3)

    def test_root_readiness_rejects_python_38_runtime(self) -> None:
        namespace = operator_namespace()
        supported = namespace["python_runtime_supported"]
        self.assertFalse(supported((3, 8, 20)))
        self.assertTrue(supported((3, 9, 0)))

    def test_root_mutation_permission_rules_fail_closed(self) -> None:
        namespace = operator_namespace()
        directory_ok = namespace["trusted_directory_permissions"]
        current_ok = namespace["trusted_current_link_attributes"]
        entry_ok = namespace["trusted_tree_entry_permissions"]
        directory = namespace["stat"].S_IFDIR
        regular = namespace["stat"].S_IFREG
        symlink = namespace["stat"].S_IFLNK
        sticky = namespace["stat"].S_ISVTX

        self.assertTrue(directory_ok(0, directory | 0o2775 | sticky, allow_group_write=True, require_sticky=True))
        self.assertFalse(directory_ok(1000, directory | 0o2775 | sticky, allow_group_write=True, require_sticky=True))
        self.assertFalse(directory_ok(0, directory | 0o2775, allow_group_write=True, require_sticky=True))
        self.assertFalse(directory_ok(0, directory | 0o3777, allow_group_write=True, require_sticky=True))
        self.assertFalse(directory_ok(0, directory | 0o2775, allow_group_write=False, require_sticky=False))
        self.assertTrue(directory_ok(0, directory | 0o2755, allow_group_write=False, require_sticky=False))
        self.assertTrue(current_ok(0, symlink | 0o777))
        self.assertFalse(current_ok(33, symlink | 0o777))
        self.assertFalse(current_ok(0, regular | 0o644))
        self.assertTrue(entry_ok(0, directory | 0o755, is_file=False))
        self.assertFalse(entry_ok(0, directory | 0o775, is_file=False))
        self.assertTrue(entry_ok(0, regular | 0o644, is_file=True, nlink=1))
        self.assertFalse(entry_ok(0, regular | 0o664, is_file=True, nlink=1))
        self.assertFalse(entry_ok(0, regular | 0o644, is_file=True, nlink=2))

    def test_root_mutation_topology_covers_every_parent_and_closed_tree(self) -> None:
        source = operator_source()
        mutation = source[source.index("def root_mutation_topology") : source.index("def root_apply_readiness")]
        for marker in (
            '"root": trusted_root_directory(Path("/"))',
            '"var": trusted_root_directory(Path("/var"))',
            '"var_www": trusted_root_directory(Path("/var/www"))',
            '"app_root": trusted_root_directory(APP_ROOT, allow_group_write=True, require_sticky=True)',
            '"releases": trusted_root_directory(RELEASES_DIR)',
            '"staging_dist": trusted_root_directory(DIST_DIR, allow_group_write=not require_closed_dist)',
            "current_link = trusted_current_link()",
            '"current": trusted_closed_tree(Path(current))',
            '"rollback": trusted_closed_tree(Path(rollback))',
        ):
            self.assertIn(marker, mutation)
        readiness = source[source.index("def root_apply_readiness") : source.index("def audit_state")]
        self.assertIn("and mutation.get(\"valid\")", readiness)

    def test_candidate_is_closed_before_swap_and_rechecked_before_run(self) -> None:
        source = operator_source()
        body = source[source.index("def apply_release") : source.index("def rollback_release")]
        extracted = body.index("candidate = extract_candidate")
        candidate_trust = body.index("trusted_closed_tree(candidate, require_root_mode=0o700)", extracted)
        first_swap = body.index("os.replace(DIST_DIR, staging_backup)")
        second_swap = body.index("os.replace(candidate, DIST_DIR)")
        moved_trust = body.index("trusted_closed_tree(DIST_DIR, require_root_mode=0o700)", second_swap)
        mutation = body.index("mutation_before_run = root_mutation_topology", moved_trust)
        release = body.index('run_fixed(trusted_scripts["server-release.sh"]', mutation)
        self.assertLess(candidate_trust, first_swap)
        self.assertLess(first_swap, second_swap)
        self.assertLess(second_swap, moved_trust)
        self.assertLess(moved_trust, mutation)
        self.assertLess(mutation, release)
        self.assertIn("exact_label_releases() != []", body[first_swap - 500 : release])
        self.assertIn("exact_label_releases() != [new_release]", body[release:])
        self.assertIn("release_trust = trusted_closed_tree(Path(new_release))", body)

    def test_rollback_rechecks_mutation_topology_before_and_after_switch(self) -> None:
        source = operator_source()
        body = source[source.index("def rollback_release") : source.index("def main")]
        before = body.index("mutation_before_rollback = root_mutation_topology")
        run = body.index('run_fixed(\n                trusted_scripts["server-rollback.sh"]')
        after = body.index("mutation_after_rollback = root_mutation_topology")
        self.assertLess(before, run)
        self.assertLess(run, after)
        self.assertIn("exact_label_releases() != [exact_new]", body)

    def test_fixed_binary_validation_accepts_only_intended_root_owned_realpaths(self) -> None:
        source = operator_source()
        body = source[source.index("def safe_system_binary") : source.index("def safe_directory")]
        self.assertIn('{"/bin/bash", "/usr/bin/bash"}', body)
        self.assertIn(r'/usr/bin/python3(?:\.[0-9]+)?', body)
        self.assertIn("link_details.st_uid == 0", body)
        self.assertIn("details.st_uid == 0", body)
        self.assertIn("stat.S_IMODE(details.st_mode) & 0o022", body)
        self.assertIn("ancestor_details.st_uid != 0", body)

    def test_root_never_executes_mutable_app_root_scripts(self) -> None:
        source = operator_source()
        runner = source[source.index("def run_fixed") : source.index("def restore_staging")]
        apply_body = source[source.index("def apply_release") : source.index("def rollback_release")]
        rollback_body = source[source.index("def rollback_release") : source.index("def main")]
        self.assertIn('command = [FIXED_BIN_PATHS["bash"], str(script_path), argument]', runner)
        self.assertIn("trusted script changed before fixed execution", runner)
        self.assertIn('"PATH": FIXED_PATH', runner)
        self.assertNotIn("os.environ", runner)
        self.assertNotIn("str(RELEASE_SCRIPT)", runner)
        self.assertNotIn("str(ROLLBACK_SCRIPT)", runner)
        self.assertNotIn("str(RELEASE_SCRIPT)", apply_body)
        self.assertNotIn("str(ROLLBACK_SCRIPT)", apply_body)
        self.assertNotIn("str(ROLLBACK_SCRIPT)", rollback_body)
        self.assertIn('trusted_scripts["server-release.sh"]', apply_body)
        self.assertIn('trusted_scripts["server-rollback.sh"]', apply_body)
        self.assertIn('trusted_scripts["server-rollback.sh"]', rollback_body)

    def test_fixed_script_runs_with_closed_umask_and_restores_process_state(self) -> None:
        source = operator_source()
        runner = source[source.index("def run_fixed") : source.index("def restore_staging")]
        set_umask = runner.index("previous_umask = os.umask(0o022)")
        run = runner.index("completed = subprocess.run(", set_umask)
        restore = runner.index("os.umask(previous_umask)", run)
        receipt = runner.index("receipt = {", restore)
        self.assertLess(set_umask, run)
        self.assertLess(run, restore)
        self.assertLess(restore, receipt)
        self.assertIn("try:\n        completed = subprocess.run(", runner)
        self.assertIn("finally:\n        os.umask(previous_umask)", runner)

    def test_trusted_script_snapshot_is_exclusive_private_hashed_and_fsynced(self) -> None:
        source = operator_source()
        reader = source[source.index("def read_verified_script") : source.index("def canonical_json")]
        writer = source[source.index("def write_new_regular") : source.index("def extract_candidate")]
        self.assertIn('getattr(os, "O_NOFOLLOW", 0)', reader)
        self.assertIn("os.fstat(fd)", reader)
        self.assertIn("sha256_bytes(raw) != expected_sha", reader)
        self.assertIn("os.O_EXCL", writer)
        self.assertIn("os.mkdir(root, 0o700)", writer)
        self.assertIn("write_new_regular(target, raw, 0o700)", writer)
        self.assertIn("fsync_directory(root)", writer)
        self.assertIn("fsync_directory(bundle)", writer)

    def test_script_source_is_reverified_after_private_copy_and_after_switch(self) -> None:
        source = operator_source()
        body = source[source.index("def apply_release") : source.index("def rollback_release")]
        copied = body.index("materialize_trusted_scripts")
        final_baseline = body.index("final_fresh = verify_fresh_baseline", copied)
        switched = body.index('release_receipt = run_fixed(trusted_scripts["server-release.sh"]', final_baseline)
        post_source = body.index("read_verified_script(RELEASE_SCRIPT", switched)
        self.assertLess(copied, final_baseline)
        self.assertLess(final_baseline, switched)
        self.assertLess(switched, post_source)

    def test_operator_bytes_are_one_inode_stable_snapshot(self) -> None:
        source = HELPER_PATH.read_text(encoding="utf-8")
        snapshot = source[source.index("def operator_bytes") : source.index("def run_remote")]
        self.assertIn('getattr(os, "O_NOFOLLOW", 0)', snapshot)
        self.assertIn("os.fstat(fd)", snapshot)
        self.assertIn("os.lstat(OPERATOR_PATH)", snapshot)
        self.assertIn("before.st_mtime_ns", snapshot)
        self.assertIn("after.st_mtime_ns", snapshot)
        apply_body = source[source.index("def apply(") : source.index("def argument_parser")]
        self.assertEqual(apply_body.count("frozen_operator = operator_bytes()"), 1)
        self.assertNotIn("operator_bytes()", apply_body.replace("frozen_operator = operator_bytes()", ""))
        for expected in (
            'remote_audit(client, "root-audit", APPLY_LOGIN, frozen_operator)',
            "upload_bundle(client, resolved_baseline, archive, manifest, baseline, frozen_operator)",
            'invoke_operator(client, "apply", remote_dir, frozen_operator)',
            "recover_ambiguous_apply(remote_dir, baseline, exc, frozen_operator)",
        ):
            self.assertIn(expected, apply_body)

    def test_operator_upload_uses_frozen_bytes_not_mutable_path(self) -> None:
        source = HELPER_PATH.read_text(encoding="utf-8")
        upload = source[source.index("def sftp_upload_bytes") : source.index("def cleanup_bundle_sftp")]
        self.assertIn("sftp_upload_bytes(sftp, frozen_operator", upload)
        self.assertIn('baseline.get("operator_sha256") != sha256_bytes(frozen_operator)', upload)
        self.assertNotIn("OPERATOR_PATH", upload)

    def test_apply_aborts_if_frozen_operator_hash_differs_from_baseline(self) -> None:
        payload = {
            "schema": helper.SCHEMA, "status": "ready", "account": helper.AUDIT_LOGIN,
            "roles": helper.ROLES, "target_commit": helper.TARGET_COMMIT,
            "release_label": helper.RELEASE_LABEL, "operator_sha256": helper.sha256_bytes(b"old"),
        }
        payload["baseline_token"] = helper.calculate_baseline_token(payload)
        with mock.patch.object(helper, "safe_baseline_path", return_value=Path("baseline.json")), mock.patch.object(
            Path, "read_text", return_value=json.dumps(payload),
        ):
            with self.assertRaisesRegex(helper.HelperError, "fixed operator changed after baseline capture"):
                helper.load_baseline_with_operator(Path("baseline.json"), b"new")

    def test_connect_rejects_unpinned_role_before_loading_key(self) -> None:
        with mock.patch.object(helper, "pinned_identity") as pinned:
            with self.assertRaisesRegex(helper.HelperError, "unsupported pinned SSH role"):
                helper.connect("administrator")
        pinned.assert_not_called()

    def test_wrapper_routes_read_audit_and_release_to_exact_roles(self) -> None:
        source = HELPER_PATH.read_text(encoding="utf-8")
        audit_body = source[source.index("def audit()") : source.index("def safe_baseline_path")]
        apply_body = source[source.index("def apply(") : source.index("def argument_parser")]
        recovery_body = source[source.index("def bounded_reconnect") : source.index("def apply(")]
        self.assertIn("connect(AUDIT_LOGIN)", audit_body)
        self.assertIn("frozen_operator = operator_bytes()", audit_body)
        self.assertIn('remote_audit(client, "audit", AUDIT_LOGIN, frozen_operator)', audit_body)
        self.assertNotIn("APPLY_LOGIN", audit_body)
        self.assertIn("connect(APPLY_LOGIN)", apply_body)
        self.assertIn('remote_audit(client, "root-audit", APPLY_LOGIN, frozen_operator)', apply_body)
        self.assertIn("connect(APPLY_LOGIN)", recovery_body)

    def test_root_preflight_happens_before_any_bundle_upload(self) -> None:
        source = HELPER_PATH.read_text(encoding="utf-8")
        body = source[source.index("def apply(") : source.index("def argument_parser")]
        self.assertLess(body.index('remote_audit(client, "root-audit", APPLY_LOGIN, frozen_operator)'), body.index("upload_bundle("))
        self.assertLess(body.index('root_preflight["server_baseline_token"]'), body.index("upload_bundle("))

    def test_operator_modes_and_identity_gates_are_split(self) -> None:
        text = OPERATOR_PATH.read_text(encoding="utf-8")
        identity = text[text.index("def identity_for_mode") : text.index("def lock_readiness")]
        apply_body = text[text.index("def apply_release") : text.index("def rollback_release")]
        rollback_body = text[text.index("def rollback_release") : text.index("def main")]
        self.assertIn('audit|root-audit', text)
        self.assertIn('mode == "audit"', identity)
        self.assertIn('mode in {"root-audit", "apply", "rollback"}', identity)
        self.assertIn('login == APPLY_LOGIN and uid == 0 and euid == 0', identity)
        self.assertIn('identity_for_mode("apply")["valid"]', apply_body)
        self.assertIn('identity_for_mode("rollback")["valid"]', rollback_body)

    def test_deploy_topology_is_read_only_and_not_write_gated(self) -> None:
        text = OPERATOR_PATH.read_text(encoding="utf-8")
        topology = text[text.index("def topology") : text.index("def identity_for_mode")]
        self.assertNotIn("writable=True", topology)
        self.assertIn('"releases": safe_directory(RELEASES_DIR, root=APP_ROOT)', topology)
        self.assertIn('"dist": safe_directory(DIST_DIR, root=APP_ROOT)', topology)

    def test_root_audit_has_no_mutation_path(self) -> None:
        text = OPERATOR_PATH.read_text(encoding="utf-8")
        audit = text[text.index("def audit_state") : text.index("def stable_topology_material")]
        readiness = text[text.index("def lock_readiness") : text.index("def audit_state")]
        for forbidden in ("write_text", "write_bytes", "os.replace", "shutil.rmtree", "subprocess.run", "os.O_CREAT"):
            self.assertNotIn(forbidden, audit)
            self.assertNotIn(forbidden, readiness)
        self.assertIn('root_apply_readiness(topo, command_paths, lock_already_held)', audit)

    def test_server_baseline_token_is_actor_neutral(self) -> None:
        text = OPERATOR_PATH.read_text(encoding="utf-8")
        stable = text[text.index("def stable_topology_material") : text.index("def full_baseline_token")]
        self.assertNotIn('value["account"]', stable)
        self.assertNotIn('value["identity"]', stable)
        self.assertNotIn('value["root_readiness"]', stable)
        self.assertNotIn('"writable"', stable)
        self.assertNotIn('"readable"', stable)
        self.assertIn('"roles": value["roles"]', stable)

    def test_root_readiness_is_inspection_only_and_complete(self) -> None:
        text = OPERATOR_PATH.read_text(encoding="utf-8")
        body = text[text.index("def root_apply_readiness") : text.index("def audit_state")]
        self.assertIn('safe_directory(path, root=APP_ROOT, writable=True)', body)
        self.assertIn('tmp.get("writable")', body)
        self.assertIn('item.get("verified_sha256")', body)
        self.assertIn('lock.get("valid")', body)
        self.assertIn('all(item.get("valid") for item in command_paths.values())', body)

    def test_bundle_upload_has_no_permission_mutation(self) -> None:
        source = HELPER_PATH.read_text(encoding="utf-8")
        body = source[source.index("def sftp_upload_file") : source.index("def cleanup_bundle_sftp")]
        self.assertNotIn(".chmod(", body)
        self.assertIn("stat.S_IMODE(attr.st_mode) & 0o022", body)
        self.assertIn("mode=0o700", body)

    def test_parse_operator_json_accepts_banner_and_exact_json_line(self) -> None:
        payload = helper.parse_operator_json({
            "exit_code": 0,
            "stdout": "Welcome to fixed host\nnotice {not json}\n{\"status\":\"ok\",\"mode\":\"audit\"}\n",
            "stderr": "",
        })
        self.assertEqual(payload["mode"], "audit")

    def test_parse_operator_json_rejects_trailing_non_json_after_receipt(self) -> None:
        with self.assertRaisesRegex(helper.HelperError, "no valid JSON object line"):
            helper.parse_operator_json({
                "exit_code": 0,
                "stdout": '{"status":"ok","mode":"audit"}\ntruncated trailing output',
                "stderr": "",
            })

    def test_run_remote_drains_large_delayed_output_after_exit_status_ready(self) -> None:
        final_payload = {"status": "ok", "mode": "audit", "proof": "complete"}
        final_line = json.dumps(final_payload, separators=(",", ":")).encode("utf-8") + b"\n"

        class DelayedChannel:
            def __init__(self) -> None:
                self.stdout = bytearray(b"leading-banner-" + (b"A" * 140_000) + b"\n")
                self.stderr = bytearray(b"W" * 70_000)
                self.delay_polls = 3
                self.final_added = False
                self.eof_received = False
                self.closed = False
                self.command = None
                self.stdin = bytearray()

            def settimeout(self, _timeout):
                return None

            def exec_command(self, command):
                self.command = command

            def sendall(self, raw):
                self.stdin.extend(raw)

            def shutdown_write(self):
                return None

            def recv_ready(self):
                if self.stdout:
                    return True
                if not self.final_added:
                    if self.delay_polls:
                        self.delay_polls -= 1
                        return False
                    self.stdout.extend(final_line)
                    self.final_added = True
                    return True
                if not self.stderr:
                    self.eof_received = True
                return False

            def recv(self, size):
                raw = bytes(self.stdout[:size])
                del self.stdout[:size]
                return raw

            def recv_stderr_ready(self):
                return bool(self.stderr)

            def recv_stderr(self, size):
                raw = bytes(self.stderr[:size])
                del self.stderr[:size]
                return raw

            def exit_status_ready(self):
                return True

            def recv_exit_status(self):
                if not self.eof_received:
                    raise AssertionError("recv_exit_status called before full EOF")
                return 0

            def close(self):
                self.closed = True

        class FakeTransport:
            def __init__(self, channel) -> None:
                self.channel = channel

            def is_active(self):
                return True

            def open_session(self, timeout):
                self.open_timeout = timeout
                return self.channel

        class FakeClient:
            def __init__(self, transport) -> None:
                self.transport = transport

            def get_transport(self):
                return self.transport

        channel = DelayedChannel()
        client = FakeClient(FakeTransport(channel))
        with mock.patch.object(helper.time, "sleep"):
            result = helper.run_remote(client, "bash -s -- audit", b"operator", 30)
        self.assertEqual(result["exit_code"], 0)
        self.assertGreater(len(result["stdout"]), 140_000)
        self.assertEqual(len(result["stderr"]), 70_000)
        self.assertTrue(result["stdout"].endswith(final_line.decode("utf-8")))
        self.assertEqual(helper.parse_operator_json(result), final_payload)
        self.assertEqual(channel.command, "bash -s -- audit")
        self.assertEqual(bytes(channel.stdin), b"operator")
        self.assertTrue(channel.closed)

    def test_parse_operator_json_rejects_embedded_json_and_returns_bounded_diagnostics(self) -> None:
        secret = "x" * 80
        result = {
            "exit_code": 127,
            "stdout": "prefix {\"status\":\"ok\"} suffix\n" + ("A" * 700) + f"\ntoken={secret}",
            "stderr": f"password: {secret}\nAuthorization: Bearer {secret}\nSyntaxError: invalid syntax",
        }
        with self.assertRaises(helper.HelperError) as caught:
            helper.parse_operator_json(result)
        message = str(caught.exception)
        self.assertIn("exit_code=127", message)
        self.assertIn("SyntaxError: invalid syntax", message)
        self.assertNotIn(secret, message)
        self.assertIn("[REDACTED]", message)
        diagnostics = helper.operator_diagnostics(result)
        stdout_tail = diagnostics.split("stdout_tail=", 1)[1].split("; stderr_tail=", 1)[0]
        stderr_tail = diagnostics.split("stderr_tail=", 1)[1]
        self.assertLessEqual(len(stdout_tail), 502)
        self.assertLessEqual(len(stderr_tail), 502)

    def test_parse_operator_json_redacts_failed_payload_reason(self) -> None:
        secret = "secret-value-that-must-not-escape"
        result = {
            "exit_code": 1,
            "stdout": json.dumps({"status": "error", "error": f"password={secret}"}),
            "stderr": "",
        }
        with self.assertRaises(helper.HelperError) as caught:
            helper.parse_operator_json(result)
        self.assertNotIn(secret, str(caught.exception))
        self.assertIn("password=[REDACTED]", str(caught.exception))

    def test_blocked_payload_summary_is_safe_deterministic_and_actionable(self) -> None:
        secret = "password-value-that-must-not-escape"
        observed = list(helper.ARTICLES_CZ_ALLOWLIST) + ["unexpected-extra.ts", "second-extra.ts"]
        payload = {
            "status": "blocked",
            "blockers": ["unsafe server path topology", "canonical articles-cz manifest is unsafe"],
            "topology": {
                "valid": False,
                "directories": {
                    "app_root": {"path": "/var/www/rosomaha", "valid": True, "sha256": "do-not-show"},
                    "dist": {
                        "path": "/var/www/rosomaha/dist", "exists": True,
                        "realpath": "/srv/escaped/dist", "directory": True, "symlink": False,
                        "uid": 1001, "gid": 1001, "mode": "0o755", "writable": False,
                        "valid": False, "sha256": "do-not-show",
                    },
                },
                "files": {
                    "server_release": {
                        "path": "/var/www/rosomaha/scripts/server-release.sh", "exists": True,
                        "regular": True, "symlink": False, "nlink": 2, "uid": 0, "gid": 0,
                        "mode": "0o755", "writable": False, "valid": False,
                        "sha256": "another-do-not-show",
                    },
                    "canonical_articles": {"path": "/var/www/rosomaha/public/api/articles.json", "valid": True},
                },
                "current_link": {"path": "/var/www/rosomaha/current", "symlink": True, "valid": True},
                "temporary": {"path": "/tmp", "sticky": True, "valid": True},
            },
            "articles_cz": {"valid": False, "error": f"allowlist mismatch password={secret}", "observed": observed},
            "current_tree": {"files": [{"path": "upload/secret.jpg", "sha256": "tree-secret-hash"}]},
            "staging_dist": {"files": [{"path": "assets/main.js", "sha256": "dist-secret-hash"}]},
            "operator_sha256": "operator-secret-hash",
        }
        first = helper.summarize_blocked_payload(payload)
        second = helper.summarize_blocked_payload(payload)
        self.assertEqual(first, second)
        summary = json.loads(first)
        self.assertEqual(sorted(summary["invalid_topology"]), ["directories.dist", "files.server_release"])
        self.assertEqual(summary["invalid_topology"]["directories.dist"]["realpath"], "/srv/escaped/dist")
        self.assertEqual(summary["invalid_topology"]["files.server_release"]["nlink"], 2)
        self.assertEqual(summary["articles_cz"]["observed"], observed)
        self.assertFalse(summary["articles_cz"]["observed_truncated"])
        self.assertNotIn(secret, first)
        self.assertNotIn("sha256", first)
        self.assertNotIn("upload/secret.jpg", first)
        self.assertNotIn("tree-secret-hash", first)
        self.assertLessEqual(len(first), helper.MAX_BLOCKED_SUMMARY_CHARS)

    def test_parse_blocked_payload_does_not_append_raw_stdout_tail(self) -> None:
        payload = {
            "status": "blocked",
            "blockers": ["unsafe server path topology"],
            "topology": {
                "valid": False,
                "directories": {"dist": {"path": "/var/www/rosomaha/dist", "valid": False, "error": "not writable"}},
                "files": {},
                "current_link": {"valid": True},
                "temporary": {"valid": True},
            },
            "articles_cz": {"valid": True},
            "current_tree": {"files": [{"path": "must-not-leak", "sha256": "must-not-leak"}]},
        }
        raw = json.dumps(payload, ensure_ascii=False)
        with self.assertRaises(helper.HelperError) as caught:
            helper.parse_operator_json({"exit_code": 3, "stdout": raw, "stderr": "password=must-not-leak"})
        message = str(caught.exception)
        self.assertIn("directories.dist", message)
        self.assertIn("not writable", message)
        self.assertIn("exit_code=3", message)
        self.assertNotIn("must-not-leak", message)
        self.assertNotIn("stdout_tail", message)

    def test_blocked_summary_omits_unsafe_observed_filename_data(self) -> None:
        payload = {
            "status": "blocked",
            "blockers": [],
            "topology": {"valid": True, "directories": {}, "files": {}, "current_link": {"valid": True}, "temporary": {"valid": True}},
            "articles_cz": {"valid": False, "error": "mismatch", "observed": ["../../secret.env"]},
        }
        summary = json.loads(helper.summarize_blocked_payload(payload))
        self.assertEqual(summary["articles_cz"]["observed"], "unsafe filename data omitted")

    def test_blocked_summary_preserves_more_than_fourteen_safe_cz_names(self) -> None:
        observed = [f"canonical-article-{index:03d}.ts" for index in range(32)]
        payload = {
            "status": "blocked",
            "blockers": ["canonical articles-cz manifest is unsafe"],
            "topology": {"valid": True, "directories": {}, "files": {}, "current_link": {"valid": True}, "temporary": {"valid": True}},
            "articles_cz": {"valid": False, "error": "articles-cz allowlist mismatch", "observed": observed},
        }
        summary = json.loads(helper.summarize_blocked_payload(payload))
        self.assertEqual(summary["articles_cz"]["observed"], observed)
        self.assertFalse(summary["articles_cz"]["observed_truncated"])

    def test_blocked_summary_truncates_cz_names_only_above_128(self) -> None:
        observed = [f"canonical-article-{index:03d}.ts" for index in range(130)]
        payload = {
            "status": "blocked",
            "blockers": [],
            "topology": {"valid": True, "directories": {}, "files": {}, "current_link": {"valid": True}, "temporary": {"valid": True}},
            "articles_cz": {"valid": False, "error": "mismatch", "observed": observed},
        }
        summary = json.loads(helper.summarize_blocked_payload(payload))
        self.assertEqual(summary["articles_cz"]["observed"], observed[:128])
        self.assertTrue(summary["articles_cz"]["observed_truncated"])

    def test_blocked_summary_explains_root_readiness_without_hashes(self) -> None:
        payload = {
            "status": "blocked",
            "blockers": ["root apply readiness is not proved"],
            "topology": {"valid": True, "directories": {}, "files": {}, "current_link": {"valid": True}, "temporary": {"valid": True}},
            "articles_cz": {"valid": True},
            "root_readiness": {
                "valid": False, "temporary_writable": True, "commands_available": True,
                "writable_directories": {
                    "dist": {"path": "/var/www/rosomaha/dist", "valid": False, "writable": False, "sha256": "hidden"},
                },
                "scripts": {"server_release": {"path": "/var/www/rosomaha/scripts/server-release.sh", "valid": True, "executable": False, "sha256": "hidden"}},
                "lock": {"path": "/var/www/rosomaha/.rosomaha-main-price-release.lock", "valid": False, "available": False},
                "mutation_topology": {"valid": True},
            },
        }
        summary = json.loads(helper.summarize_blocked_payload(payload))
        invalid = summary["root_readiness"]["invalid"]
        self.assertEqual(sorted(invalid), ["lock", "scripts.server_release", "writable_directories.dist"])
        self.assertFalse(invalid["scripts.server_release"]["executable"])
        self.assertNotIn("sha256", json.dumps(summary))

    def test_operator_has_no_privileged_or_server_build_path(self) -> None:
        text = OPERATOR_PATH.read_text(encoding="utf-8")
        self.assertNotIn("ROOT_OPERATOR", text)
        self.assertNotIn("sudo", text)
        self.assertNotIn("npm run build", text)
        self.assertNotIn("src/data/products.ts", text)
        self.assertNotIn("src/data/models.ts", text)
        self.assertNotIn("os.chmod", text)
        self.assertNotIn("os.chown", text)
        self.assertIn('AUDIT_LOGIN = "deploy"', text)
        self.assertIn('APPLY_LOGIN = "root"', text)
        self.assertIn('euid == 0', text)

    def test_operator_rollback_takes_flock_before_state_checks(self) -> None:
        text = OPERATOR_PATH.read_text(encoding="utf-8")
        body = text[text.index("def rollback_release"):text.index("def main")]
        self.assertLess(body.index("fcntl.flock"), body.index("baseline = validate_bundle"))
        self.assertLess(body.index("fcntl.flock"), body.index("receipt_path ="))

    def test_operator_lock_is_opened_nofollow_and_inode_checked(self) -> None:
        text = OPERATOR_PATH.read_text(encoding="utf-8")
        body = text[text.index("def open_lock"):text.index("def validate_bundle")]
        self.assertIn('getattr(os, "O_NOFOLLOW", 0)', body)
        self.assertIn("os.O_CREAT | os.O_EXCL", body)
        self.assertIn("(opened.st_dev, opened.st_ino) != (linked.st_dev, linked.st_ino)", body)

    def test_operator_rollback_rechecks_exact_baseline_tree_and_topology(self) -> None:
        text = OPERATOR_PATH.read_text(encoding="utf-8")
        body = text[text.index("def rollback_release"):text.index("def main")]
        self.assertIn('topo = topology()', body)
        self.assertIn('baseline_tree = tree_manifest(Path(baseline["current_release"]))', body)
        self.assertIn('baseline.get("current_tree", {}).get("digest")', body)
        self.assertIn("verify_exact_baseline_state(baseline, require_staging=True)", body)

    def test_operator_auto_rollback_proves_full_recovery(self) -> None:
        text = OPERATOR_PATH.read_text(encoding="utf-8")
        body = text[text.index("def apply_release"):text.index("def rollback_release")]
        self.assertIn("automatic_rollback", body)
        self.assertIn("verify_exact_baseline_state(baseline, require_staging=False)", body)
        self.assertIn("verify_exact_baseline_state(baseline, require_staging=True)", body)
        self.assertIn("staging dist was not restored after successful release", body)

    def test_operator_rechecks_full_baseline_immediately_before_swap_and_after_release(self) -> None:
        text = OPERATOR_PATH.read_text(encoding="utf-8")
        body = text[text.index("def apply_release") : text.index("def rollback_release")]
        extract_at = body.index("candidate = extract_candidate")
        final_at = body.index("final_fresh = verify_fresh_baseline", extract_at)
        swap_at = body.index("os.replace(DIST_DIR, staging_backup)")
        self.assertLess(extract_at, final_at)
        self.assertLess(final_at, swap_at)
        self.assertIn('canonical_after = article_file(CANONICAL_ARTICLES, "canonical-after-release")', body)
        self.assertIn("cz_after = articles_cz_manifest()", body)
        self.assertIn("canonical articles-cz changed during release", body)

    def test_operator_rollback_proves_articles_cz_baseline(self) -> None:
        text = OPERATOR_PATH.read_text(encoding="utf-8")
        verifier = text[text.index("def verify_exact_baseline_state"):text.index("def extract_candidate")]
        rollback = text[text.index("def rollback_release"):text.index("def main")]
        self.assertIn("cz_manifest = articles_cz_manifest()", verifier)
        self.assertIn('baseline.get("articles_cz", {}).get("digest")', verifier)
        self.assertIn("before_cz = articles_cz_manifest()", rollback)
        self.assertIn("canonical articles-cz baseline changed before rollback", rollback)

    def test_operator_validates_full_baseline_token(self) -> None:
        text = OPERATOR_PATH.read_text(encoding="utf-8")
        self.assertIn("def full_baseline_token", text)
        self.assertIn('baseline["baseline_token"] != full_baseline_token(baseline)', text)

    def test_operator_requires_raw_article_sha_parity(self) -> None:
        text = OPERATOR_PATH.read_text(encoding="utf-8")
        self.assertIn('len({item.get("sha256") for item in articles.values()}) == 1', text)
        self.assertIn('articles["sha256"] != canonical["sha256"]', text)
        self.assertIn('current_articles.get("sha256") != baseline["articles"]["canonical"].get("sha256")', text)

    def test_exact_price_value_rejects_fractional_and_float(self) -> None:
        self.assertEqual(helper.exact_price_value(1350000), 1350000)
        self.assertEqual(helper.exact_price_value("1350000"), 1350000)
        self.assertIsNone(helper.exact_price_value(1350000.0))
        self.assertIsNone(helper.exact_price_value("1350000.00"))
        self.assertIsNone(helper.exact_price_value(True))

    def test_visible_and_jsonld_price_must_be_exact_and_old_absent(self) -> None:
        path = "/catalog/rosomaha-standart-plus"
        evidence = helper.verify_html_page(page_html(path, "1350000"), path, expected_price=1350000, absent_price=1300000)
        self.assertTrue(evidence["valid"])
        self.assertEqual(evidence["price"]["visible_exact"], "от 1 350 000 ₽")
        self.assertEqual(evidence["price"]["json_ld_prices"], [1350000])

    def test_old_visible_price_blocks_candidate(self) -> None:
        path = "/catalog/rosomaha-standart-plus"
        raw = page_html(path, 1350000).replace(b"</main>", " и от 1 300 000 ₽</main>".encode("utf-8"))
        evidence = helper.verify_html_page(raw, path, expected_price=1350000, absent_price=1300000)
        self.assertFalse(evidence["valid"])
        self.assertIn("old visible price is still present", evidence["blockers"])

    def test_old_public_baseline_may_lack_visible_price_but_requires_jsonld(self) -> None:
        path = "/catalog/rosomaha-standart-plus"
        raw = page_html(path, "1300000").replace("<main>Цена от 1 300 000 ₽</main>".encode("utf-8"), b"")
        evidence = helper.verify_html_page(
            raw, path, expected_price=1300000, absent_price=1350000,
            require_visible_price=False,
        )
        self.assertTrue(evidence["valid"])
        self.assertEqual(evidence["price"]["json_ld_prices"], [1300000])

    def test_duplicate_jsonld_offer_price_blocks_candidate(self) -> None:
        path = "/catalog/rosomaha-standart-plus"
        url = helper.BASE_URL + path
        payload = {"@type": "Product", "url": url, "offers": [{"price": "1350000"}, {"price": 1350000}]}
        raw = page_html(path, 1350000).replace(
            b"</head>", ('<script type="application/ld+json">' + json.dumps(payload) + '</script></head>').encode("utf-8"),
        )
        evidence = helper.verify_html_page(raw, path, expected_price=1350000, absent_price=1300000)
        self.assertFalse(evidence["valid"])
        self.assertIn("exact scoped Product Offer price is not present exactly once", evidence["blockers"])

    def test_jsonld_float_blocks_candidate(self) -> None:
        path = "/catalog/rosomaha-standart-plus"
        with self.assertRaises(helper.HelperError):
            helper.verify_html_page(page_html(path, 1350000.0), path, expected_price=1350000, absent_price=1300000)

    def test_seo_fields_capture_title_description_og_canonical_robots(self) -> None:
        path = "/catalog/rosomaha-hunter"
        evidence = helper.verify_html_page(page_html(path, 2230000, title="Точный title", description="Точное описание"), path, expected_price=2230000, absent_price=2180000)
        self.assertEqual(evidence["seo"], {
            "title": "Точный title", "description": "Точное описание",
            "og_url": helper.BASE_URL + path, "canonical": helper.BASE_URL + path,
            "robots": "index, follow",
        })

    def test_seo_comparison_allows_only_price_text_change(self) -> None:
        path = "/catalog/rosomaha-hunter"
        baseline = {"pages": {path: {"seo": {"title": "Цена 2 180 000", "description": "Цена 2 180 000", "og_url": helper.BASE_URL + path, "canonical": helper.BASE_URL + path, "robots": "index, follow"}}}}
        observed = {"pages": {path: {"seo": {"title": "Цена 2 230 000", "description": "Цена 2 230 000", "og_url": helper.BASE_URL + path, "canonical": helper.BASE_URL + path, "robots": "index, follow"}}}}
        with mock.patch.object(helper, "SEO_SNAPSHOT_PATHS", (path,)):
            helper.verify_seo_unchanged(baseline, observed)
            observed["pages"][path]["seo"]["description"] = "Другое описание"
            with self.assertRaises(helper.HelperError):
                helper.verify_seo_unchanged(baseline, observed)

    def test_article_info_preserves_raw_sha_and_rejects_duplicates(self) -> None:
        first = json.dumps([{"slug": "a"}, {"slug": "b"}], separators=(",", ":")).encode()
        spaced = json.dumps([{"slug": "a"}, {"slug": "b"}], indent=2).encode()
        self.assertNotEqual(helper.article_info(first, "a")["sha256"], helper.article_info(spaced, "b")["sha256"])
        duplicate = helper.article_info(b'[{"slug":"a"},{"slug":"a"}]', "dup")
        self.assertFalse(duplicate["valid"])
        self.assertEqual(duplicate["duplicates"], ["a"])

    def test_runtime_article_manifest_and_bundle_prove_canonical_payload(self) -> None:
        with tempfile.TemporaryDirectory(dir=PROJECT_ROOT / ".codex_tmp") as raw_root:
            dist = Path(raw_root) / "dist"
            (dist / "api").mkdir(parents=True)
            (dist / "assets").mkdir(parents=True)
            canonical_raw = b'[{"slug":"article-a"},{"slug":"article-b"}]'
            info = helper.article_info(canonical_raw, "test")
            manifest = {
                "schema": helper.RUNTIME_ARTICLES_SCHEMA,
                "source": "public/api/articles.json",
                "count": info["count"],
                "source_sha256": helper.sha256_bytes(canonical_raw),
                "slug_digest": info["slug_digest"],
            }
            (dist / helper.RUNTIME_ARTICLES_MANIFEST).write_text(
                json.dumps(manifest, separators=(",", ":")), encoding="utf-8",
            )
            (dist / "assets/app.js").write_text(
                'const articles=["article-a","article-b"];', encoding="utf-8",
            )
            evidence = helper.verify_runtime_articles(dist, canonical_raw, info)
            self.assertTrue(evidence["valid"])
            self.assertTrue(evidence["all_canonical_slugs_embedded"])

    def test_runtime_article_bundle_missing_canonical_slug_is_blocked(self) -> None:
        with tempfile.TemporaryDirectory(dir=PROJECT_ROOT / ".codex_tmp") as raw_root:
            dist = Path(raw_root) / "dist"
            (dist / "api").mkdir(parents=True)
            (dist / "assets").mkdir(parents=True)
            canonical_raw = b'[{"slug":"article-a"},{"slug":"article-b"}]'
            info = helper.article_info(canonical_raw, "test")
            manifest = {
                "schema": helper.RUNTIME_ARTICLES_SCHEMA,
                "source": "public/api/articles.json",
                "count": info["count"],
                "source_sha256": helper.sha256_bytes(canonical_raw),
                "slug_digest": info["slug_digest"],
            }
            (dist / helper.RUNTIME_ARTICLES_MANIFEST).write_text(json.dumps(manifest), encoding="utf-8")
            (dist / "assets/app.js").write_text('const article="article-a";', encoding="utf-8")
            with self.assertRaises(helper.HelperError):
                helper.verify_runtime_articles(dist, canonical_raw, info)

    def test_articles_cz_static_sources_may_be_a_canonical_subset(self) -> None:
        with tempfile.TemporaryDirectory(dir=PROJECT_ROOT / ".codex_tmp") as raw_root:
            root = Path(raw_root)
            snapshot = root / "canonical"
            cz = snapshot / "src/data/articles-cz"
            worktree = root / "worktree"
            (worktree / "src/data").mkdir(parents=True)
            cz.mkdir(parents=True)
            slugs = []
            imports = []
            for index, name in enumerate(helper.ARTICLES_CZ_ALLOWLIST):
                if name == "index.ts":
                    continue
                slug = f"cz-{index}"
                slugs.append(slug)
                export_name = f"item{index}Article"
                (cz / name).write_text(
                    f"export const {export_name}: Article = {{ slug: '{slug}' }};\n",
                    encoding="utf-8",
                )
                imports.append(f"import {{ {export_name} }} from './{Path(name).stem}';")
            (cz / "index.ts").write_text("\n".join(imports), encoding="utf-8")
            (worktree / "src/data/articles.ts").write_text("export const x = { slug: 'manual' };", encoding="utf-8")
            (worktree / "src/data/tyumen-exhibition.ts").write_text("export const x = { slug: 'tyumen' };", encoding="utf-8")
            canonical_slugs = ["manual", "tyumen", *slugs, "json-only-article"]
            result = helper.validate_articles_cz(snapshot, worktree, canonical_slugs)
            self.assertTrue(result["valid"])
            self.assertEqual(result["canonical_runtime_count"], len(canonical_slugs))
            self.assertEqual(result["canonical_cz_count"], len(slugs))
            self.assertEqual(result["canonical_non_cz_count"], 3)
            self.assertEqual(result["excluded_files"], [])

    def test_articles_cz_validation_does_not_depend_on_legacy_static_sources(self) -> None:
        with tempfile.TemporaryDirectory(dir=PROJECT_ROOT / ".codex_tmp") as raw_root:
            root = Path(raw_root)
            snapshot = root / "canonical"
            cz = snapshot / "src/data/articles-cz"
            worktree = root / "worktree"
            (worktree / "src/data").mkdir(parents=True)
            cz.mkdir(parents=True)
            imports = []
            canonical_slugs = ["tyumen"]
            for index, name in enumerate(helper.ARTICLES_CZ_ALLOWLIST):
                if name == "index.ts":
                    continue
                slug = f"cz-{index}"
                canonical_slugs.append(slug)
                export_name = f"item{index}Article"
                (cz / name).write_text(
                    f"export const {export_name}: Article = {{ slug: '{slug}' }};\n",
                    encoding="utf-8",
                )
                imports.append(f"import {{ {export_name} }} from './{Path(name).stem}';")
            (cz / "index.ts").write_text("\n".join(imports), encoding="utf-8")
            (worktree / "src/data/articles.ts").write_text("export const x = { slug: 'not-canonical' };", encoding="utf-8")
            (worktree / "src/data/tyumen-exhibition.ts").write_text("export const x = { slug: 'tyumen' };", encoding="utf-8")
            evidence = helper.validate_articles_cz(snapshot, worktree, canonical_slugs)
            self.assertTrue(evidence["valid"])
            self.assertEqual(evidence["canonical_cz_count"], len(canonical_slugs) - 1)

    def test_articles_cz_missing_import_is_blocked(self) -> None:
        with tempfile.TemporaryDirectory(dir=PROJECT_ROOT / ".codex_tmp") as raw_root:
            root = Path(raw_root)
            snapshot = root / "canonical"
            cz = snapshot / "src/data/articles-cz"
            worktree = root / "worktree"
            (worktree / "src/data").mkdir(parents=True)
            cz.mkdir(parents=True)
            slugs = []
            for index, name in enumerate(helper.ARTICLES_CZ_ALLOWLIST):
                if name == "index.ts":
                    continue
                slug = f"cz-{index}"
                slugs.append(slug)
                (cz / name).write_text(
                    f"export const item{index}Article: Article = {{ slug: '{slug}' }};\n",
                    encoding="utf-8",
                )
            (cz / "index.ts").write_text("", encoding="utf-8")
            (worktree / "src/data/articles.ts").write_text("export const x = { slug: 'manual' };", encoding="utf-8")
            (worktree / "src/data/tyumen-exhibition.ts").write_text("export const x = { slug: 'tyumen' };", encoding="utf-8")
            with self.assertRaises(helper.HelperError):
                helper.validate_articles_cz(snapshot, worktree, ["manual", "tyumen", *slugs])

    def test_articles_cz_index_comment_is_not_counted_as_import(self) -> None:
        with tempfile.TemporaryDirectory(dir=PROJECT_ROOT / ".codex_tmp") as raw_root:
            root = Path(raw_root)
            snapshot = root / "canonical"
            cz = snapshot / "src/data/articles-cz"
            worktree = root / "worktree"
            (worktree / "src/data").mkdir(parents=True)
            cz.mkdir(parents=True)
            slugs = []
            imports = [
                "// Автоматически сгенерировано Контент Заводом.",
                "// Подключение в src/data/articles.ts: `import { czArticles } from './articles-cz'; ... ...czArticles`",
                "import type { Article } from '../articles';",
                "",
            ]
            for index, name in enumerate(helper.ARTICLES_CZ_ALLOWLIST):
                if name == "index.ts":
                    continue
                slug = f"cz-{index}"
                slugs.append(slug)
                export_name = f"item{index}Article"
                (cz / name).write_text(
                    f"export const {export_name}: Article = {{ slug: '{slug}' }};\n",
                    encoding="utf-8",
                )
                imports.append(f"import {{ {export_name} }} from './{Path(name).stem}';")
            (cz / "index.ts").write_text("\n".join(imports), encoding="utf-8")
            (worktree / "src/data/articles.ts").write_text("export const x = { slug: 'manual' };", encoding="utf-8")
            (worktree / "src/data/tyumen-exhibition.ts").write_text("export const x = { slug: 'tyumen' };", encoding="utf-8")
            result = helper.validate_articles_cz(snapshot, worktree, ["manual", "tyumen", *slugs])
            self.assertTrue(result["valid"])

    def test_overlay_copies_only_canonical_json_and_does_not_mutate_src(self) -> None:
        helper.TEMP_ROOT.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=helper.TEMP_ROOT) as raw_root:
            root = Path(raw_root)
            snapshot = root / "canonical"
            cz = snapshot / "src/data/articles-cz"
            worktree = root / "worktree"
            target_cz = worktree / "src/data/articles-cz"
            (worktree / "src/data").mkdir(parents=True)
            (worktree / "public/api").mkdir(parents=True)
            (snapshot / "public/api").mkdir(parents=True)
            cz.mkdir(parents=True)
            target_cz.mkdir(parents=True)
            (target_cz / "index.ts").write_text("export const czArticles = [];\n", encoding="utf-8")
            canonical_slugs = ["manual", "tyumen"]
            imports = []
            for index, name in enumerate(helper.ARTICLES_CZ_ALLOWLIST):
                if name == "index.ts":
                    continue
                slug = f"cz-{index}"
                if index == 0:
                    slug = "draft-only-slug"
                else:
                    canonical_slugs.append(slug)
                export_name = f"item{index}Article"
                (cz / name).write_text(
                    f"export const {export_name}: Article = {{ slug: '{slug}' }};\n",
                    encoding="utf-8",
                )
                if slug != "draft-only-slug":
                    imports.append(f"import {{ {export_name} }} from './{Path(name).stem}';")
            (cz / "index.ts").write_text("\n".join(imports), encoding="utf-8")
            (worktree / "src/data/articles.ts").write_text(
                "import { czArticles } from './articles-cz/index';\nexport const x = { slug: 'manual' };",
                encoding="utf-8",
            )
            (worktree / "src/data/canonical-articles.ts").write_text(
                "import payload from 'virtual:canonical-articles';\nexport const canonicalArticles = payload;\n",
                encoding="utf-8",
            )
            (worktree / "vite.config.ts").write_text(
                "const id = 'virtual:canonical-articles';\n",
                encoding="utf-8",
            )
            (worktree / "src/data/tyumen-exhibition.ts").write_text(
                "export const x = { slug: 'tyumen' };",
                encoding="utf-8",
            )
            (snapshot / "public/api/articles.json").write_text(
                json.dumps([{"slug": slug} for slug in canonical_slugs]),
                encoding="utf-8",
            )
            validation = helper.validate_articles_cz(snapshot, worktree, canonical_slugs)
            self.assertEqual(len(validation["excluded_files"]), 1)
            self.assertEqual(validation["excluded_files"][0]["slug"], "draft-only-slug")
            source_before = helper.tree_manifest(worktree / "src")["digest"]
            helper.overlay_canonical(snapshot, worktree, validation)
            self.assertEqual(helper.tree_manifest(worktree / "src")["digest"], source_before)
            self.assertEqual(
                (worktree / "public/api/articles.json").read_bytes(),
                (snapshot / "public/api/articles.json").read_bytes(),
            )

    def test_articles_cz_index_may_still_import_excluded_allowlisted_file(self) -> None:
        helper.TEMP_ROOT.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=helper.TEMP_ROOT) as raw_root:
            root = Path(raw_root)
            snapshot = root / "canonical"
            cz = snapshot / "src/data/articles-cz"
            worktree = root / "worktree"
            (worktree / "src/data").mkdir(parents=True)
            (snapshot / "public/api").mkdir(parents=True)
            cz.mkdir(parents=True)
            canonical_slugs = ["manual", "tyumen"]
            imports = []
            for index, name in enumerate(helper.ARTICLES_CZ_ALLOWLIST):
                if name == "index.ts":
                    continue
                slug = f"cz-{index}"
                if index == 0:
                    slug = "draft-only-slug"
                else:
                    canonical_slugs.append(slug)
                export_name = f"item{index}Article"
                (cz / name).write_text(
                    f"export const {export_name}: Article = {{ slug: '{slug}' }};\n",
                    encoding="utf-8",
                )
                imports.append(f"import {{ {export_name} }} from './{Path(name).stem}';")
            (cz / "index.ts").write_text("\n".join(imports), encoding="utf-8")
            (worktree / "src/data/articles.ts").write_text("export const x = { slug: 'manual' };", encoding="utf-8")
            (worktree / "src/data/tyumen-exhibition.ts").write_text("export const x = { slug: 'tyumen' };", encoding="utf-8")
            (snapshot / "public/api/articles.json").write_text(
                json.dumps([{"slug": slug} for slug in canonical_slugs]),
                encoding="utf-8",
            )
            validation = helper.validate_articles_cz(snapshot, worktree, canonical_slugs)
            self.assertEqual(len(validation["excluded_files"]), 1)
            self.assertEqual(validation["excluded_files"][0]["slug"], "draft-only-slug")

    def test_tree_manifest_rejects_hardlinked_candidate_file(self) -> None:
        with tempfile.TemporaryDirectory(dir=PROJECT_ROOT / ".codex_tmp") as raw_root:
            root = Path(raw_root)
            first = root / "a.txt"
            second = root / "b.txt"
            first.write_text("x", encoding="utf-8")
            try:
                os.link(first, second)
            except OSError:
                self.skipTest("hardlinks unavailable")
            with self.assertRaises(helper.HelperError):
                helper.tree_manifest(root)

    def test_tree_manifest_digest_is_content_sensitive(self) -> None:
        with tempfile.TemporaryDirectory(dir=PROJECT_ROOT / ".codex_tmp") as raw_root:
            root = Path(raw_root)
            item = root / "a.txt"
            item.write_text("one", encoding="utf-8")
            first = helper.tree_manifest(root)["digest"]
            item.write_text("two", encoding="utf-8")
            second = helper.tree_manifest(root)["digest"]
            self.assertNotEqual(first, second)

    def test_operator_tree_manifest_is_order_independent(self) -> None:
        namespace = operator_namespace()
        tree_manifest = namespace["tree_manifest"]
        with tempfile.TemporaryDirectory(dir=PROJECT_ROOT / ".codex_tmp") as raw_root:
            root = Path(raw_root)
            (root / "z-dir").mkdir()
            (root / "a-dir").mkdir()
            (root / "z-dir/z.txt").write_text("z", encoding="utf-8")
            (root / "a-dir/a.txt").write_text("a", encoding="utf-8")
            (root / "middle.txt").write_text("m", encoding="utf-8")
            namespace["APP_ROOT"] = root
            original_walk = namespace["os"].walk
            observed = [
                (current, list(dir_names), list(file_names))
                for current, dir_names, file_names in original_walk(root, followlinks=False)
            ]

            def ordered(reverse: bool):
                rows = list(reversed(observed)) if reverse else list(observed)
                for current, dir_names, file_names in rows:
                    yield current, list(reversed(dir_names)), list(reversed(file_names))

            with mock.patch.object(namespace["os"], "walk", side_effect=lambda *_args, **_kwargs: ordered(False)):
                first = tree_manifest(root)
            with mock.patch.object(namespace["os"], "walk", side_effect=lambda *_args, **_kwargs: ordered(True)):
                second = tree_manifest(root)
            self.assertEqual(first["digest"], second["digest"])
            self.assertEqual(
                [item["path"] for item in first["files"]],
                sorted(item["path"] for item in first["files"]),
            )

    def test_read_http_retries_three_times(self) -> None:
        class FakeOpener:
            def __init__(self) -> None:
                self.calls = 0

            def open(self, request, timeout):  # noqa: ANN001
                self.calls += 1
                if self.calls < 3:
                    raise urllib.error.URLError("temporary")
                return FakeResponse(b"ok", request.full_url)

        opener = FakeOpener()
        with mock.patch.object(helper.urllib.request, "build_opener", return_value=opener), mock.patch.object(helper.time, "sleep"):
            result = helper.read_http("https://example.invalid/")
        self.assertEqual(result["attempts"], 3)
        self.assertEqual(opener.calls, 3)

    def test_baseline_token_detects_any_mutation(self) -> None:
        payload = {"schema": helper.SCHEMA, "candidate": {"tree_digest": "a"}}
        payload["baseline_token"] = helper.calculate_baseline_token(payload)
        self.assertEqual(payload["baseline_token"], helper.calculate_baseline_token(payload))
        payload["candidate"]["tree_digest"] = "b"
        self.assertNotEqual(payload["baseline_token"], helper.calculate_baseline_token(payload))

    def test_remote_bundle_path_is_fixed_to_commit_and_token(self) -> None:
        token = "a" * 64
        self.assertEqual(helper.remote_bundle_path(token), "/tmp/rosomaha-main-price-release-64ba304-aaaaaaaaaaaaaaaa")
        with self.assertRaises(helper.HelperError):
            helper.remote_bundle_path("../bad")

    def test_cli_apply_requires_exact_commit_and_baseline(self) -> None:
        with mock.patch.object(helper, "atomic_json_receipt", return_value=Path("error.json")):
            self.assertEqual(helper.main(["--apply", "--commit", "1af1a1748d818ef662a8068fe8e25c27f44c4d24"]), 1)

    def test_wrapper_never_retries_apply_during_recovery(self) -> None:
        source = HELPER_PATH.read_text(encoding="utf-8")
        body = source[source.index("def recover_ambiguous_apply"):source.index("def apply(")]
        self.assertNotIn('invoke_operator(client, "apply"', body)
        self.assertIn("ambiguous_apply_requires_recovery", body)
        self.assertIn("bundle_preserved", body)
        self.assertIn("raw_remote_audit(client, frozen_operator)", body)

    def test_recovery_classifies_released_original_and_unexpected(self) -> None:
        baseline = {
            "current_release": "/var/www/rosomaha/_releases/original",
            "current_tree": {"digest": "old-tree"},
            "candidate": {"tree_digest": "new-tree"},
            "staging_dist": {"digest": "staging"},
            "articles_cz": {"digest": "cz", "files": [{"name": "index.ts"}]},
            "release_scripts": {"server-release.sh": "r", "server-rollback.sh": "b"},
            "articles": {"canonical": {"sha256": "article"}},
        }

        def audit(current: str, tree: str, labels: list[str] | None = None) -> dict:
            return {
                "schema": helper.SCHEMA, "host": helper.HOST, "account": helper.APPLY_LOGIN,
                "mode": "root-audit", "roles": helper.ROLES,
                "root_readiness": {"valid": True},
                "target_commit": helper.TARGET_COMMIT, "topology": {"valid": True},
                "current_release": current, "current_tree": {"valid": True, "digest": tree},
                "staging_dist": {"valid": True, "digest": "staging"},
                "articles_cz": {"valid": True, "digest": "cz", "files": [{"name": "index.ts"}]},
                "release_scripts": baseline["release_scripts"],
                "existing_label_releases": [] if labels is None else labels,
                "articles": {name: {"valid": True, "sha256": "article"} for name in ("canonical", "current", "live")},
            }

        new_release = "/var/www/rosomaha/_releases/20260812-120000-prices-64ba304"
        receipt = {"new_release": new_release}
        self.assertEqual(helper.classify_recovery_state(audit(new_release, "new-tree", [new_release]), baseline, receipt), "released_candidate")
        self.assertEqual(helper.classify_recovery_state(audit(baseline["current_release"], "old-tree"), baseline, None), "original")
        broken = audit(new_release, "wrong", [new_release])
        self.assertEqual(helper.classify_recovery_state(broken, baseline, receipt), "unexpected")

    def test_recovery_residual_or_extra_release_label_is_ambiguous(self) -> None:
        baseline = {
            "current_release": "/var/www/rosomaha/_releases/original",
            "current_tree": {"digest": "old-tree"}, "candidate": {"tree_digest": "new-tree"},
            "staging_dist": {"digest": "staging"},
            "articles_cz": {"digest": "cz", "files": [{"name": "index.ts"}]},
            "release_scripts": {"server-release.sh": "r", "server-rollback.sh": "b"},
            "articles": {"canonical": {"sha256": "article"}},
        }
        base_audit = {
            "schema": helper.SCHEMA, "host": helper.HOST, "account": helper.APPLY_LOGIN,
            "mode": "root-audit", "roles": helper.ROLES, "root_readiness": {"valid": True},
            "target_commit": helper.TARGET_COMMIT, "topology": {"valid": True},
            "current_release": baseline["current_release"],
            "current_tree": {"valid": True, "digest": "old-tree"},
            "staging_dist": {"valid": True, "digest": "staging"},
            "articles_cz": {"valid": True, "digest": "cz", "files": [{"name": "index.ts"}]},
            "release_scripts": baseline["release_scripts"],
            "articles": {name: {"valid": True, "sha256": "article"} for name in ("canonical", "current", "live")},
        }
        residual = dict(base_audit, existing_label_releases=["/var/www/rosomaha/_releases/partial-prices-64ba304"])
        self.assertEqual(helper.classify_recovery_state(residual, baseline, None), "unexpected")
        new_release = "/var/www/rosomaha/_releases/20260812-120000-prices-64ba304"
        released = dict(
            base_audit, current_release=new_release,
            current_tree={"valid": True, "digest": "new-tree"},
            existing_label_releases=[new_release, "/var/www/rosomaha/_releases/extra-prices-64ba304"],
        )
        self.assertEqual(helper.classify_recovery_state(released, baseline, {"new_release": new_release}), "unexpected")

    def test_candidate_archive_members_are_fixed_under_dist(self) -> None:
        with tempfile.TemporaryDirectory(dir=PROJECT_ROOT / ".codex_tmp") as raw_root:
            root = Path(raw_root)
            dist = root / "dist"
            dist.mkdir()
            (dist / "index.html").write_text("ok", encoding="utf-8")
            manifest = helper.tree_manifest(dist)
            archive, _manifest_path = helper.write_candidate_archive(dist, manifest, root)
            import tarfile
            with tarfile.open(archive, "r:gz") as handle:
                names = handle.getnames()
            self.assertEqual(names, ["dist/index.html"])


if __name__ == "__main__":
    unittest.main()
