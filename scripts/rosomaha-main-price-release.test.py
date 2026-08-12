from __future__ import annotations

import importlib.util
import ast
import json
import os
import tempfile
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


class MainPriceReleaseV2Test(unittest.TestCase):
    def test_fixed_identity_and_commit_are_pinned(self) -> None:
        self.assertEqual(helper.EXPECTED_LOGIN, "deploy")
        self.assertEqual(helper.TARGET_COMMIT, "10d9dc666bccbe9fb250ab29a69ae09710537e77")
        self.assertEqual(helper.EXPECTED_PUBLIC_KEY_FINGERPRINT, "SHA256:Bvnk8M0TiB4Ovg17j/WvixBPxsjeWuiN6zcfFWa40Uo")
        self.assertEqual(helper.IDENTITY_FILE.name, "id_ed25519")
        self.assertEqual(len(helper.ARTICLES_CZ_ALLOWLIST), 14)
        self.assertIn("avgustovskiy-marshrut-na-rosomahe-chek-list-osmotra-pered-vyezdom.ts", helper.ARTICLES_CZ_ALLOWLIST)
        self.assertIn("rosomaha-zastryala-v-bolote-spokoynyy-poryadok-deystviy-bez-lishney-suety.ts", helper.ARTICLES_CZ_ALLOWLIST)

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

    def test_parse_operator_json_accepts_banner_and_exact_json_line(self) -> None:
        payload = helper.parse_operator_json({
            "exit_code": 0,
            "stdout": "Welcome to fixed host\nnotice {not json}\n{\"status\":\"ok\",\"mode\":\"audit\"}\ntrailing banner\n",
            "stderr": "",
        })
        self.assertEqual(payload["mode"], "audit")

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

    def test_operator_has_no_privileged_or_server_build_path(self) -> None:
        text = OPERATOR_PATH.read_text(encoding="utf-8")
        self.assertNotIn("ROOT_OPERATOR", text)
        self.assertNotIn("sudo", text)
        self.assertNotIn("npm run build", text)
        self.assertNotIn("src/data/products.ts", text)
        self.assertNotIn("src/data/models.ts", text)
        self.assertIn('EXPECTED_LOGIN = "deploy"', text)
        self.assertIn("os.geteuid() == 0", text)

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

    def test_articles_cz_index_and_static_union_are_exact(self) -> None:
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
                (cz / name).write_text(f"export default {{ slug: '{slug}' }};\n", encoding="utf-8")
                imports.append(f"import item{index} from './{Path(name).stem}';")
            (cz / "index.ts").write_text("\n".join(imports), encoding="utf-8")
            (worktree / "src/data/articles.ts").write_text("export const x = { slug: 'manual' };", encoding="utf-8")
            (worktree / "src/data/tyumen-exhibition.ts").write_text("export const x = { slug: 'tyumen' };", encoding="utf-8")
            result = helper.validate_articles_cz(snapshot, worktree, ["manual", "tyumen", *slugs])
            self.assertTrue(result["valid"])
            self.assertEqual(result["union_count"], len(slugs) + 2)

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
                (cz / name).write_text(f"export default {{ slug: '{slug}' }};\n", encoding="utf-8")
            (cz / "index.ts").write_text("", encoding="utf-8")
            (worktree / "src/data/articles.ts").write_text("export const x = { slug: 'manual' };", encoding="utf-8")
            (worktree / "src/data/tyumen-exhibition.ts").write_text("export const x = { slug: 'tyumen' };", encoding="utf-8")
            with self.assertRaises(helper.HelperError):
                helper.validate_articles_cz(snapshot, worktree, ["manual", "tyumen", *slugs])

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
        self.assertEqual(helper.remote_bundle_path(token), "/tmp/rosomaha-main-price-release-10d9dc6-aaaaaaaaaaaaaaaa")
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

        def audit(current: str, tree: str) -> dict:
            return {
                "schema": helper.SCHEMA, "host": helper.HOST, "account": helper.EXPECTED_LOGIN,
                "target_commit": helper.TARGET_COMMIT, "topology": {"valid": True},
                "current_release": current, "current_tree": {"valid": True, "digest": tree},
                "staging_dist": {"valid": True, "digest": "staging"},
                "articles_cz": {"valid": True, "digest": "cz", "files": [{"name": "index.ts"}]},
                "release_scripts": baseline["release_scripts"],
                "articles": {name: {"valid": True, "sha256": "article"} for name in ("canonical", "current", "live")},
            }

        new_release = "/var/www/rosomaha/_releases/20260812-120000-prices-10d9dc6"
        receipt = {"new_release": new_release}
        self.assertEqual(helper.classify_recovery_state(audit(new_release, "new-tree"), baseline, receipt), "released_candidate")
        self.assertEqual(helper.classify_recovery_state(audit(baseline["current_release"], "old-tree"), baseline, None), "original")
        broken = audit(new_release, "wrong")
        self.assertEqual(helper.classify_recovery_state(broken, baseline, receipt), "unexpected")

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
