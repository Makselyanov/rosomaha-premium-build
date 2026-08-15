from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import stat
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest import mock


SCRIPT_PATH = Path(__file__).with_name("bitrix-sitemap-url.py")
PHP_PATH = Path(__file__).with_name("bitrix-sitemap-url.php")
spec = importlib.util.spec_from_file_location("bitrix_sitemap_url", SCRIPT_PATH)
assert spec is not None and spec.loader is not None
operator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operator)


def xml(urls: list[str], *, newline: bytes = b"\n") -> bytes:
    lines = [
        b'<?xml version="1.0" encoding="UTF-8"?>',
        b'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    lines.extend(f"  <url><loc>{url}</loc></url>".encode("ascii") for url in urls)
    lines.append(b"</urlset>")
    return newline.join(lines) + newline


def state(name: str) -> dict[str, object]:
    if name == "baseline":
        return {
            "state": "baseline",
            "bytes": operator.BASELINE_BYTES,
            "sha256": operator.BASELINE_SHA256,
            "url_count": operator.BASELINE_URL_COUNT,
            "unique_url_count": operator.BASELINE_URL_COUNT,
            "target_count": 0,
        }
    return {
        "state": "candidate",
        "bytes": operator.CANDIDATE_BYTES,
        "sha256": operator.CANDIDATE_SHA256,
        "url_count": operator.CANDIDATE_URL_COUNT,
        "unique_url_count": operator.CANDIDATE_URL_COUNT,
        "target_count": 1,
    }


def remote(mode: str, *, before: str = "baseline", after: str | None = None) -> dict[str, object]:
    after = after or before
    payload: dict[str, object] = {
        "schema": 1,
        "mode": mode,
        "operation_id": operator.OPERATION_ID,
        "domain": operator.DOMAIN,
        "site_root_identity": "pinned_rosomaha_rus_docroot",
        "generator_used": False,
        "database_used": False,
        "robots_changed": False,
        "active_backing": {
            "alias": "root_sitemap",
            "exact_public_byte_match": True,
            "regular_non_symlink": True,
            "write_authorized": True,
        },
        "before": state(before),
        "after": state(after),
        "filesystem_mutations": 0,
        "diff": {"added": [], "removed": []},
        "remote_exit_status": 0,
    }
    if mode == "dry-run":
        payload.update(
            status="ready",
            after=state("candidate"),
            diff={"added": [operator.TARGET_URL], "removed": []},
        )
    elif mode == "apply":
        payload.update(
            status="applied",
            after=state("candidate"),
            filesystem_mutations=1,
            diff={"added": [operator.TARGET_URL], "removed": []},
            backup={
                "bytes": operator.BASELINE_BYTES,
                "sha256": operator.BASELINE_SHA256,
                "immutable_mode": "0400",
            },
            public_readback={
                "bytes": operator.CANDIDATE_BYTES,
                "sha256": operator.CANDIDATE_SHA256,
                "exact_candidate": True,
            },
        )
    elif mode == "recover":
        payload.update(status="not_started", classification="not_started")
    else:
        payload.update(status="ok")
    return payload


class FixedIdentityTests(unittest.TestCase):
    def test_target_and_operation_are_exact(self):
        self.assertEqual(
            operator.TARGET_URL,
            "https://rosomaha-rus.ru/product/dopolnitelnaya-knopka-vklyucheniya-ventilyatora/",
        )
        self.assertRegex(operator.OPERATION_ID, r"^bitrix-sitemap-[a-f0-9]{24}$")
        self.assertEqual(len(operator.MODEL_URLS), 12)

    def test_pinned_baseline_and_lf_candidate_constants(self):
        self.assertEqual(operator.BASELINE_BYTES, 13008)
        self.assertEqual(
            operator.BASELINE_SHA256,
            "1f191bb1dcc7bfe850b3b0ec64b63a1950d0c7ef865845ce427c08b4faf3f305",
        )
        self.assertEqual(operator.CANDIDATE_BYTES, 13113)
        self.assertEqual(
            operator.CANDIDATE_SHA256,
            "11cff13b618473be3ce6e695a8f3654ea9be99983cf7c55f6116fba507b04498",
        )
        self.assertNotIn(b"\r", operator.TARGET_LINE)

    def test_only_fixed_public_urls_are_allowed(self):
        self.assertEqual(len(operator.PUBLIC_ALLOWLIST), 15)
        self.assertNotIn("http://rosomaha-rus.ru/sitemap.xml", operator.PUBLIC_ALLOWLIST)
        with self.assertRaises(ValueError):
            operator.fetch_fixed("https://evil.example/sitemap.xml")


class ByteEditTests(unittest.TestCase):
    def test_insert_is_exactly_one_lf_line_after_anchor(self):
        before = b"prefix\n" + operator.ANCHOR_LINE + b"suffix\n"
        after = operator.insert_target_line(before)
        self.assertEqual(after, b"prefix\n" + operator.ANCHOR_LINE + operator.TARGET_LINE + b"suffix\n")
        self.assertEqual(len(after) - len(before), len(operator.TARGET_LINE))
        self.assertNotIn(b"\r", after)

    def test_insert_rejects_missing_or_duplicate_anchor(self):
        with self.assertRaises(operator.SitemapOperatorError):
            operator.insert_target_line(b"no anchor\n")
        with self.assertRaises(operator.SitemapOperatorError):
            operator.insert_target_line(operator.ANCHOR_LINE * 2)

    def test_insert_rejects_existing_target(self):
        with self.assertRaises(operator.SitemapOperatorError):
            operator.insert_target_line(operator.ANCHOR_LINE + operator.TARGET_LINE)

    def test_insert_rejects_crlf_or_mixed_newlines(self):
        with self.assertRaises(operator.SitemapOperatorError):
            operator.insert_target_line(operator.ANCHOR_LINE.replace(b"\n", b"\r\n"))

    def test_saved_baseline_regression_when_fixture_is_present(self):
        fixture = operator.PROJECT_ROOT / ".codex_tmp/daily-http-20260815/bitrix-sitemap.xml"
        if not fixture.is_file():
            self.skipTest("ignored evidence fixture is not present")
        baseline = fixture.read_bytes()
        self.assertEqual(len(baseline), operator.BASELINE_BYTES)
        self.assertEqual(hashlib.sha256(baseline).hexdigest(), operator.BASELINE_SHA256)
        candidate = operator.build_candidate(baseline)
        self.assertEqual(len(candidate), operator.CANDIDATE_BYTES)
        self.assertEqual(hashlib.sha256(candidate).hexdigest(), operator.CANDIDATE_SHA256)
        old = set(operator.parse_sitemap(baseline))
        new = set(operator.parse_sitemap(candidate))
        self.assertEqual(new - old, {operator.TARGET_URL})
        self.assertEqual(old - new, set())


class XmlAdversarialTests(unittest.TestCase):
    def test_valid_minimal_sitemap(self):
        body = xml(["https://rosomaha-rus.ru/", operator.TARGET_URL])
        self.assertEqual(operator.parse_sitemap(body)[1], operator.TARGET_URL)

    def test_rejects_duplicate_loc(self):
        body = xml(["https://rosomaha-rus.ru/", "https://rosomaha-rus.ru/"])
        with self.assertRaises(operator.SitemapOperatorError):
            operator.parse_sitemap(body)

    def test_rejects_foreign_host_query_and_http(self):
        for url in (
            "https://evil.example/",
            "https://rosomaha-rus.ru/?x=1",
            "http://rosomaha-rus.ru/",
        ):
            with self.subTest(url=url), self.assertRaises(operator.SitemapOperatorError):
                operator.parse_sitemap(xml([url]))

    def test_rejects_doctype_entity_bom_and_crlf(self):
        bad = [
            b'<!DOCTYPE urlset>' + xml(["https://rosomaha-rus.ru/"]),
            b'<!ENTITY x "y">' + xml(["https://rosomaha-rus.ru/"]),
            b"\xef\xbb\xbf" + xml(["https://rosomaha-rus.ru/"]),
            xml(["https://rosomaha-rus.ru/"], newline=b"\r\n"),
        ]
        for body in bad:
            with self.subTest(prefix=body[:20]), self.assertRaises(operator.SitemapOperatorError):
                operator.parse_sitemap(body)

    def test_robots_group_and_longest_allow_rule(self):
        blocked = "User-agent: *\nUser-agent: Googlebot\nDisallow: /product/\n"
        allowed = (
            "User-agent: *\nDisallow: /product/\n"
            f"Allow: {operator.TARGET_PATH}\n"
        )
        self.assertFalse(operator._robots_allows_target(blocked))
        self.assertTrue(operator._robots_allows_target(allowed))

    def test_rejects_wrong_namespace_and_non_url_child(self):
        wrong_ns = b'<?xml version="1.0"?><urlset><url><loc>https://rosomaha-rus.ru/</loc></url></urlset>\n'
        extra = b'<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><foo/></urlset>\n'
        for body in (wrong_ns, extra):
            with self.assertRaises(operator.SitemapOperatorError):
                operator.parse_sitemap(body)


class CredentialTests(unittest.TestCase):
    def test_exact_environment_identity(self):
        self.assertEqual(
            operator.load_credentials(
                environ={"BEGET_LOGIN": operator.EXPECTED_LOGIN, "BEGET_PASSWORD": "x"}
            ),
            (operator.EXPECTED_LOGIN, "x"),
        )
        with self.assertRaises(operator.CredentialError):
            operator.load_credentials(environ={"BEGET_LOGIN": "another", "BEGET_PASSWORD": "x"})

    def test_partial_or_ambiguous_credentials_are_rejected(self):
        with self.assertRaises(operator.CredentialError):
            operator.load_credentials(environ={"BEGET_LOGIN": operator.EXPECTED_LOGIN})
        with self.assertRaises(operator.CredentialError):
            operator.credentials_from_text(
                "BEGET_LOGIN=berkutm4\nBEGET_LOGIN=berkutm4\nBEGET_PASSWORD=x\n"
            )


class RemoteContractTests(unittest.TestCase):
    def test_read_only_modes_cannot_report_mutations(self):
        for mode in ("audit", "dry-run", "recover"):
            payload = remote(mode)
            payload["filesystem_mutations"] = 1
            with self.subTest(mode=mode), self.assertRaises(operator.SitemapOperatorError):
                operator.validate_remote_payload(payload, expected_mode=mode)

    def test_dry_run_requires_exact_plus_one_minus_zero(self):
        payload = remote("dry-run")
        self.assertEqual(operator.validate_remote_payload(payload, expected_mode="dry-run")["status"], "ready")
        payload["diff"] = {"added": [], "removed": []}
        with self.assertRaises(operator.SitemapOperatorError):
            operator.validate_remote_payload(payload, expected_mode="dry-run")

    def test_apply_requires_backup_atomic_state_and_public_readback(self):
        payload = remote("apply")
        self.assertEqual(operator.validate_remote_payload(payload, expected_mode="apply")["status"], "applied")
        payload["public_readback"] = {"exact_candidate": False}
        with self.assertRaises(operator.SitemapOperatorError):
            operator.validate_remote_payload(payload, expected_mode="apply")

    def test_active_backing_is_exact_allowlist_only(self):
        payload = remote("audit")
        payload["active_backing"]["alias"] = "arbitrary_path"
        with self.assertRaises(operator.SitemapOperatorError):
            operator.validate_remote_payload(payload, expected_mode="audit")

    def test_recover_is_classification_only(self):
        payload = remote("recover")
        self.assertEqual(operator.validate_remote_payload(payload, expected_mode="recover")["classification"], "not_started")
        payload["classification"] = "auto_rollback"
        with self.assertRaises(operator.SitemapOperatorError):
            operator.validate_remote_payload(payload, expected_mode="recover")

    def test_frame_integrity_and_duplicate_noise_rejected(self):
        payload = {"schema": 1}
        raw = json.dumps(payload, separators=(",", ":")).encode()
        frame = (
            f"__ROSOMAHA_SITEMAP_JSON_BYTES__={len(raw)}\n"
            f"__ROSOMAHA_SITEMAP_JSON_SHA256__={hashlib.sha256(raw).hexdigest()}\n"
            f"__ROSOMAHA_SITEMAP_JSON_BASE64__={operator.base64.b64encode(raw).decode()}\n"
        ).encode()
        parsed = operator.parse_remote_frame(frame, 0)
        self.assertEqual(parsed["schema"], 1)
        with self.assertRaises(operator.SitemapOperatorError):
            operator.parse_remote_frame(b"noise\n" + frame, 0)


class SourceSafetyTests(unittest.TestCase):
    def test_php_lints_identity_and_has_no_generator_or_db_surface(self):
        digest = operator.validate_php_source(PHP_PATH.read_bytes())
        self.assertRegex(digest, r"^[a-f0-9]{64}$")
        source = PHP_PATH.read_text(encoding="utf-8")
        self.assertNotIn("glob(", source)
        self.assertNotRegex(source, r"\b(?:PDO|mysqli|CIBlock|CSiteMap)\b")

    def test_php_has_exact_two_discovery_paths_but_root_only_write_gate(self):
        source = PHP_PATH.read_text(encoding="utf-8")
        self.assertEqual(source.count("/public_html/sitemap.xml'"), 1)
        self.assertEqual(source.count("aspro_regions/sitemap/sitemap_rosomaha-rus.ru.xml'"), 1)
        self.assertIn("$active['alias'] !== 'root_sitemap'", source)
        self.assertNotIn("glob(", source)

    def test_php_has_backup_fsync_atomic_replace_restore_and_public_readback(self):
        source = PHP_PATH.read_text(encoding="utf-8")
        for needle in (
            "function rosomahaSitemapAtomicReplace",
            "function rosomahaSitemapRestore",
            "function rosomahaSitemapPublicReadback",
            "fopen($path, 'x+b')",
            "fsync(",
            "rename(",
            "automatic_restore_ok",
        ):
            self.assertIn(needle, source)

    def test_python_transport_contains_one_exec_dispatch_and_no_retry_loop(self):
        source = SCRIPT_PATH.read_text(encoding="utf-8")
        body = source[source.index("def execute_remote") : source.index("def validate_remote_payload")]
        self.assertEqual(body.count("client.exec_command("), 1)
        self.assertNotIn("for attempt", body)

    def test_cli_requires_one_fixed_mode_and_rejects_extra_args(self):
        self.assertTrue(operator.parse_args(["--audit"]).audit)
        with redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                operator.parse_args([])
            with self.assertRaises(SystemExit):
                operator.parse_args(["--audit", "https://evil.example/"])

    def test_receipt_is_exclusive_read_only_and_rejects_secret_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.object(operator, "REPORT_ROOT", Path(directory)):
                path = operator.write_receipt("audit", {"status": "ok"})
                self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["status"], "ok")
                self.assertFalse(path.stat().st_mode & stat.S_IWUSR)
                base = operator._receipt_base("audit")
                base_path = operator.write_receipt("audit", base)
                self.assertFalse(base_path.stat().st_mode & stat.S_IWUSR)
                with self.assertRaises(operator.SitemapOperatorError):
                    operator.write_receipt("audit", {"password": "not-written"})


if __name__ == "__main__":
    unittest.main()
