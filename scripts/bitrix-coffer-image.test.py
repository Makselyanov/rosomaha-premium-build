#!/usr/bin/env python3
"""Adversarial tests for the fixed Bitrix coffer image operator."""

from __future__ import annotations

import copy
import importlib.util
import inspect
import io
import json
import os
import re
import stat
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock


SCRIPT_PATH = Path(__file__).with_name("bitrix-coffer-image.py")
PHP_PATH = Path(__file__).with_name("bitrix-coffer-image.php")
SPEC = importlib.util.spec_from_file_location("bitrix_coffer_image", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


DETAIL_SHA = "1" * 64
PHOTO_SHAS = [f"{index + 2:x}" * 64 for index in range(8)]


def sample_file(file_id: int, index: int, sha: str) -> dict[str, object]:
    return {
        "id": file_id,
        "relative_path": f"/upload/iblock/{index:03d}/image-{index}.jpg",
        "sha256": sha,
        "bytes": 1000 + index,
        "width": 1200,
        "height": 900,
        "mime": "image/jpeg",
    }


def sample_state() -> dict[str, object]:
    photos = [
        {
            "property_value_id": 5000 + index,
            "description": f"photo-{index}",
            "file": sample_file(6000 + index, index + 1, PHOTO_SHAS[index]),
        }
        for index in range(8)
    ]
    invariants = {
        "fields": {
            "id": MODULE.ELEMENT_ID,
            "iblock_id": MODULE.IBLOCK_ID,
            "primary_section_id": MODULE.PRIMARY_SECTION_ID,
            "code": MODULE.ELEMENT_CODE,
            "xml_id": "952",
            "name": MODULE.ELEMENT_NAME,
            "active": True,
            "sort": MODULE.TARGET_SORT,
            "detail_page_url": f"/product/{MODULE.ELEMENT_CODE}/",
        },
        "preview_picture": sample_file(MODULE.PREVIEW_PICTURE_ID, 20, "a" * 64),
        "sections": [MODULE.PRIMARY_SECTION_ID],
        "non_photo_properties": {"row_count": 60, "sha256": "b" * 64},
        "metadata_templates": {"keys": [], "sha256": "c" * 64},
        "models": [
            {
                "id": model_id,
                "code": model_code,
                "target_position": 26 if index < 2 else 25,
                "link_count": 28 if index < 2 else 27,
                "links_sha256": f"{index + 4:x}" * 64,
            }
            for index, (model_id, model_code) in enumerate(
                zip(MODULE.MODEL_IDS, MODULE.MODEL_CODES, strict=True)
            )
        ],
    }
    state = {
        "element_id": MODULE.ELEMENT_ID,
        "code": MODULE.ELEMENT_CODE,
        "detail_picture": sample_file(
            MODULE.BASELINE_DETAIL_PICTURE_ID,
            0,
            DETAIL_SHA,
        ),
        "photos": photos,
        "invariants": invariants,
        "invariant_sha256": MODULE.evidence_sha256(invariants),
        "gallery_sha256": [DETAIL_SHA, *PHOTO_SHAS],
    }
    state["state_sha256"] = MODULE.evidence_sha256(state)
    return state


def source_evidence() -> dict[str, object]:
    return {
        "path": "public/media/options/extreme-three-section-coffer-dimensions.jpg",
        "bytes": MODULE.SOURCE_BYTES,
        "sha256": MODULE.SOURCE_SHA256,
        "width": MODULE.SOURCE_WIDTH,
        "height": MODULE.SOURCE_HEIGHT,
        "mime": "image/jpeg",
        "original_source_sha256": MODULE.ORIGINAL_SOURCE_SHA256,
    }


def remote_audit(state: dict[str, object] | None = None) -> dict[str, object]:
    return {
        "status": "ok",
        "mode": "audit",
        "phase": "fixed_coffer_image_audit",
        "read_only": True,
        "database_mutations": 0,
        "apply_supported": False,
        "ready_for_apply": False,
        "apply_blocker": "photos_append_clone_proof_missing",
        "state": state or sample_state(),
    }


def applied_state(before: dict[str, object] | None = None) -> dict[str, object]:
    before = copy.deepcopy(before or sample_state())
    before["detail_picture"] = sample_file(7000, 30, MODULE.SOURCE_SHA256)
    before["detail_picture"].update(
        {
            "relative_path": "/upload/iblock/new/source.jpg",
            "bytes": MODULE.SOURCE_BYTES,
            "width": MODULE.SOURCE_WIDTH,
            "height": MODULE.SOURCE_HEIGHT,
        }
    )
    old_copy = {
        "property_value_id": 7001,
        "description": "",
        "file": sample_file(7002, 31, DETAIL_SHA),
    }
    old_copy["file"]["relative_path"] = "/upload/iblock/new/old-detail-copy.jpg"
    before["photos"].append(old_copy)
    before["gallery_sha256"] = [MODULE.SOURCE_SHA256, *PHOTO_SHAS, DETAIL_SHA]
    before.pop("state_sha256")
    before["state_sha256"] = MODULE.evidence_sha256(before)
    return before


def semantic_rollback_state(
    before: dict[str, object] | None = None,
) -> dict[str, object]:
    state = copy.deepcopy(before or sample_state())
    state["detail_picture"]["id"] = 7100
    state["detail_picture"]["relative_path"] = "/upload/iblock/new/restored-detail.jpg"
    state.pop("state_sha256")
    state["state_sha256"] = MODULE.evidence_sha256(state)
    return state


def remote_operation(
    mode: str,
    payload: dict[str, object],
    state: dict[str, object],
    classification: str,
    *,
    status: str = "ok",
    verified: bool = True,
    mutations: int = 0,
) -> dict[str, object]:
    return {
        "status": status,
        "mode": mode,
        "phase": "fixed_coffer_image_operation",
        "operation_id": payload["operation_id"],
        "database_mutations": mutations,
        "classification": classification,
        "before_state_sha256": payload["before"]["state_sha256"],
        "after_state_sha256": state["state_sha256"],
        "invariant_sha256": state["invariant_sha256"],
        "gallery_sha256": state["gallery_sha256"],
        "state": state,
        "verified": verified,
        "identifier_restoration": False,
        "error_evidence": None,
    }


def public_baseline(state: dict[str, object] | None = None) -> dict[str, object]:
    state = state or sample_state()
    option = {
        "status": 200,
        "final_url": MODULE.OPTION_URL,
        "canonical": [MODULE.OPTION_URL],
        "robots": [],
        "indexable": True,
        "title": "Купить кофр",
        "h1": MODULE.ELEMENT_NAME,
        "description": ["Описание"],
        "og_image": ["https://rosomaha-rus.ru/upload/preview.jpg"],
        "itemprop_image": [
            MODULE.PUBLIC_ORIGIN + state["detail_picture"]["relative_path"]
        ],
        "visible_text": {"bytes": 128, "sha256": "9" * 64},
        "structured_data": {
            "format": "schema.org-microdata",
            "product_count": 1,
            "offer_count": 1,
            "product_names": [MODULE.ELEMENT_NAME],
            "product_urls": [MODULE.OPTION_URL],
            "product_images": [
                MODULE.PUBLIC_ORIGIN + state["detail_picture"]["relative_path"]
            ],
            "offer_prices": ["75000"],
            "offer_currencies": ["RUB"],
            "masked_sha256": "8" * 64,
        },
    }
    gallery_files = [
        state["detail_picture"],
        *[row["file"] for row in state["photos"]],
    ]
    gallery = [
        {
            "url": MODULE.PUBLIC_ORIGIN + file["relative_path"],
            "bytes": file["bytes"],
            "sha256": file["sha256"],
            "width": file["width"],
            "height": file["height"],
            "content_type": "image/jpeg",
        }
        for file in gallery_files
    ]
    models = [
        {
            "id": model_id,
            "code": code,
            "page": {
                "status": 200,
                "final_url": url,
                "canonical": [url],
                "robots": [],
                "indexable": True,
                "title": f"Model {model_id}",
                "h1": f"Model {model_id}",
                "description": ["desc"],
                "og_image": [f"{MODULE.PUBLIC_ORIGIN}/upload/model-{model_id}.jpg"],
                "itemprop_image": [f"{MODULE.PUBLIC_ORIGIN}/upload/model-{model_id}.jpg"],
                "visible_text": {"bytes": 256, "sha256": f"{model_id % 10}" * 64},
                "structured_data": {
                    "format": "schema.org-microdata",
                    "product_count": 1,
                    "offer_count": 1,
                    "product_names": [f"Model {model_id}"],
                    "product_urls": [url],
                    "product_images": [
                        f"{MODULE.PUBLIC_ORIGIN}/upload/model-{model_id}.jpg"
                    ],
                    "offer_prices": ["1000000"],
                    "offer_currencies": ["RUB"],
                    "masked_sha256": f"{(model_id + 1) % 10}" * 64,
                },
            },
            "control_count": 27,
            "target_position": 5,
            "target": {
                "product_id": str(MODULE.ELEMENT_ID),
                "sum": "75000",
                "name": MODULE.ELEMENT_NAME,
                "row_id": f"bx_3966226736_{MODULE.ELEMENT_ID}",
            },
        }
        for model_id, code, url in zip(
            MODULE.MODEL_IDS,
            MODULE.MODEL_CODES,
            MODULE.MODEL_URLS,
            strict=True,
        )
    ]
    return {
        "generated_at_utc": "2026-08-17T12:00:00Z",
        "option": option,
        "gallery": gallery,
        "first_thumbnail": {
            "url": (
                "https://rosomaha-rus.ru/upload/resize_cache/"
                f"thumb-{state['detail_picture']['id']}.jpg"
            ),
            "bytes": 100000,
            "sha256": MODULE.sha256_bytes(
                f"thumbnail|{state['detail_picture']['sha256']}".encode("ascii")
            ),
            "width": 520,
            "height": 457,
            "content_type": "image/jpeg",
        },
        "models": models,
        "sitemap": {
            "url": MODULE.SITEMAP_URL,
            "status": 200,
            "target_count": 1,
            "location_count": 144,
            "sha256": "e" * 64,
        },
    }


def attach_thumbnail_clone_proof(
    payload: dict[str, object],
    candidate: dict[str, object],
) -> None:
    thumbnail = candidate["first_thumbnail"]
    payload["expected"]["thumbnail_clone_proof"] = {
        "receipt_sha256": "7" * 64,
        "sha256": thumbnail["sha256"],
        "bytes": thumbnail["bytes"],
        "width": thumbnail["width"],
        "height": thumbnail["height"],
    }


class SourceContractTests(unittest.TestCase):
    def test_tracked_source_exact(self) -> None:
        evidence = MODULE.validate_source_image()
        self.assertEqual(evidence["sha256"], MODULE.SOURCE_SHA256)
        self.assertEqual(evidence["bytes"], 837737)
        self.assertEqual((evidence["width"], evidence["height"]), (3000, 2636))
        self.assertEqual(evidence["original_source_sha256"], MODULE.ORIGINAL_SOURCE_SHA256)

    def test_source_path_is_pinned(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            copy_path = Path(directory) / "copy.jpg"
            copy_path.write_bytes(MODULE.SOURCE_IMAGE.read_bytes())
            with self.assertRaises(MODULE.CofferHelperError):
                MODULE.validate_source_image(copy_path)

    def test_changed_byte_is_rejected_before_network(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "source.jpg"
            data = bytearray(MODULE.SOURCE_IMAGE.read_bytes())
            data[-16] ^= 1
            path.write_bytes(data)
            with mock.patch.object(MODULE, "SOURCE_IMAGE", path):
                with self.assertRaisesRegex(MODULE.CofferHelperError, "контрактом"):
                    MODULE.validate_source_image(path)

    def test_hardlinked_source_is_rejected_before_network(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "source.jpg"
            alias = Path(directory) / "alias.jpg"
            path.write_bytes(MODULE.SOURCE_IMAGE.read_bytes())
            try:
                os.link(path, alias)
            except OSError as exc:
                self.skipTest(f"hardlink unavailable: {type(exc).__name__}")
            with mock.patch.object(MODULE, "SOURCE_IMAGE", path):
                with self.assertRaises(MODULE.CofferHelperError):
                    MODULE.validate_source_image(path)

    def test_non_jpeg_and_truncated_jpeg_rejected(self) -> None:
        with self.assertRaises(MODULE.CofferHelperError):
            MODULE.jpeg_dimensions(b"not-an-image")
        with self.assertRaises(MODULE.CofferHelperError):
            MODULE.jpeg_dimensions(b"\xff\xd8\xff\xc0\x00")


class CredentialTests(unittest.TestCase):
    PLACEHOLDER = "synthetic-test-placeholder"

    @staticmethod
    def write_source(directory: str, text: str) -> Path:
        path = Path(directory) / "project-credentials.txt"
        path.write_text(text, encoding="utf-8")
        return path

    def test_exact_legacy_source_passes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = self.write_source(
                directory,
                (
                    "https://cp.beget.com/ логин "
                    f"{MODULE.EXPECTED_LOGIN} пароль {self.PLACEHOLDER}\n"
                ),
            )
            login, password = MODULE.load_credentials(environ={}, env_path=path)
        self.assertEqual(login, MODULE.EXPECTED_LOGIN)
        self.assertEqual(password, self.PLACEHOLDER)

    def test_exact_standard_pair_passes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = self.write_source(
                directory,
                (
                    f"BEGET_LOGIN={MODULE.EXPECTED_LOGIN}\n"
                    f"BEGET_PASSWORD={self.PLACEHOLDER}\n"
                ),
            )
            login, password = MODULE.load_credentials(environ={}, env_path=path)
        self.assertEqual(login, MODULE.EXPECTED_LOGIN)
        self.assertEqual(password, self.PLACEHOLDER)

    def test_mixed_standard_and_legacy_sources_fail(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = self.write_source(
                directory,
                (
                    f"BEGET_LOGIN={MODULE.EXPECTED_LOGIN}\n"
                    f"BEGET_PASSWORD={self.PLACEHOLDER}\n"
                    "https://cp.beget.com/ логин ignored пароль ignored\n"
                ),
            )
            with self.assertRaises(MODULE.CredentialError):
                MODULE.load_credentials(environ={}, env_path=path)

    def test_duplicate_standard_assignment_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = self.write_source(
                directory,
                (
                    f"BEGET_LOGIN={MODULE.EXPECTED_LOGIN}\n"
                    f"BEGET_LOGIN={MODULE.EXPECTED_LOGIN}\n"
                    f"BEGET_PASSWORD={self.PLACEHOLDER}\n"
                ),
            )
            with self.assertRaises(MODULE.CredentialError):
                MODULE.load_credentials(environ={}, env_path=path)

    def test_duplicate_legacy_source_fails(self) -> None:
        legacy = (
            "https://cp.beget.com/ логин "
            f"{MODULE.EXPECTED_LOGIN} пароль {self.PLACEHOLDER}\n"
        )
        with tempfile.TemporaryDirectory() as directory:
            path = self.write_source(directory, legacy + legacy)
            with self.assertRaises(MODULE.CredentialError):
                MODULE.load_credentials(environ={}, env_path=path)

    def test_incomplete_standard_pair_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = self.write_source(
                directory,
                f"BEGET_LOGIN={MODULE.EXPECTED_LOGIN}\n",
            )
            with self.assertRaises(MODULE.CredentialError):
                MODULE.load_credentials(environ={}, env_path=path)

    def test_unexpected_account_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = self.write_source(
                directory,
                (
                    "https://cp.beget.com/ логин unpinned-account "
                    f"пароль {self.PLACEHOLDER}\n"
                ),
            )
            with self.assertRaises(MODULE.CredentialError):
                MODULE.load_credentials(environ={}, env_path=path)


class StaticPhpContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = PHP_PATH.read_text(encoding="utf-8")
        cls.raw = PHP_PATH.read_bytes()

    def test_php_contract_is_valid(self) -> None:
        digest = MODULE.validate_php_source(self.raw)
        self.assertRegex(digest, r"^[a-f0-9]{64}$")

    def test_exact_scope_constants_match(self) -> None:
        for literal in (
            "ROSOMAHA_COFFER_IBLOCK_ID = 86",
            "ROSOMAHA_COFFER_ELEMENT_ID = 952",
            "ROSOMAHA_COFFER_PRIMARY_SECTION_ID = 340",
            "ROSOMAHA_COFFER_PHOTOS_PROPERTY_ID = 1201",
            "ROSOMAHA_COFFER_SORT = 102",
            "ROSOMAHA_COFFER_SOURCE_BYTES = 837737",
            "ROSOMAHA_COFFER_SOURCE_WIDTH = 3000",
            "ROSOMAHA_COFFER_SOURCE_HEIGHT = 2636",
        ):
            self.assertIn(literal, self.source)
        self.assertIn(MODULE.SOURCE_SHA256, self.source)
        self.assertIn(MODULE.ORIGINAL_SOURCE_SHA256, self.source)
        self.assertIn("ROSOMAHA_COFFER_PHOTOS_APPEND_CLONE_PROOF = false", self.source)
        self.assertIn("ROSOMAHA_COFFER_CLONE_PROOF_RECEIPT_SHA256 = null", self.source)
        self.assertIn("'thumbnail_clone_proof'", self.source)

    def test_php_recomputes_nested_preimage_hash(self) -> None:
        payload = self.source.split("function rosomahaCofferPayload", 1)[1].split(
            "function rosomahaCofferStagedFile", 1
        )[0]
        self.assertIn("unset($beforeWithoutHash['state_sha256'])", payload)
        self.assertIn("rosomahaCofferHash($beforeWithoutHash)", payload)
        self.assertIn("rosomahaCofferHash($before['invariants'])", payload)
        self.assertIn("existing_photo_property_value_ids", payload)
        self.assertIn("existing_photo_file_ids", payload)

    def test_db_text_and_public_content_contract_is_present(self) -> None:
        for field in (
            "'PREVIEW_TEXT'", "'PREVIEW_TEXT_TYPE'",
            "'DETAIL_TEXT'", "'DETAIL_TEXT_TYPE'",
            "'preview_text'", "'detail_text'",
        ):
            self.assertIn(field, self.source)
        python_source = SCRIPT_PATH.read_text(encoding="utf-8")
        self.assertIn('"visible_text"', python_source)
        self.assertIn('"structured_data"', python_source)
        self.assertIn("Product microdata contract", python_source)

    def test_only_two_photo_writers_and_one_detail_writer(self) -> None:
        self.assertEqual(self.source.count("CIBlockElement::SetPropertyValuesEx("), 2)
        self.assertEqual(self.source.count("->Update("), 1)
        detail = self.source.split("function rosomahaCofferSetDetail", 1)[1].split(
            "function rosomahaCofferClassification", 1
        )[0]
        self.assertIn("'DETAIL_PICTURE'", detail)
        self.assertNotIn("'PREVIEW_PICTURE'", detail)

    def test_no_sql_add_delete_or_shell_surface(self) -> None:
        for pattern in MODULE.FORBIDDEN_PHP_PATTERNS:
            self.assertIsNone(re.search(pattern, self.source, re.IGNORECASE), pattern)

    def test_append_verified_before_detail_change(self) -> None:
        apply_source = self.source.split("function rosomahaCofferApply", 1)[1].split(
            "function rosomahaCofferRecover", 1
        )[0]
        self.assertLess(
            apply_source.index("rosomahaCofferAppendOldDetail("),
            apply_source.index("rosomahaCofferSetDetail("),
        )
        self.assertIn("photos_prepared", apply_source)
        self.assertIn("rosomahaCofferRemoveAppendedPhoto(", apply_source)

    def test_manual_rollback_requires_exact_applied_state(self) -> None:
        rollback = self.source.split("function rosomahaCofferRollback", 1)[1].split(
            "if (PHP_SAPI", 1
        )[0]
        self.assertIn("!== 'applied_exact'", rollback)
        self.assertIn("'rollback', $payload", rollback)
        self.assertLess(
            rollback.index("rosomahaCofferSetDetail("),
            rollback.index("rosomahaCofferRemoveAppendedPhoto("),
        )

    def test_operation_error_uses_nonzero_frame(self) -> None:
        dispatch = self.source.split("$payload = rosomahaCofferPayload", 1)[1].split(
            "} catch (Throwable $error)", 1
        )[0]
        self.assertIn("$result = match ($mode)", dispatch)
        self.assertIn("=== 'error' ? 1 : 0", dispatch)

    def test_recover_contains_no_writer(self) -> None:
        recover = self.source.split("function rosomahaCofferRecover", 1)[1].split(
            "function rosomahaCofferRollback", 1
        )[0]
        self.assertNotIn("SetPropertyValuesEx", recover)
        self.assertNotIn("->Update(", recover)

    def test_validator_rejects_forbidden_mutation(self) -> None:
        malicious = self.source.replace(
            "function rosomahaCofferSetDetail",
            "CIBlockElement::Delete(952);\nfunction rosomahaCofferSetDetail",
            1,
        ).encode("utf-8")
        with self.assertRaises(MODULE.CofferHelperError):
            MODULE.validate_php_source(malicious)

    def test_validator_rejects_enabling_unproven_apply(self) -> None:
        enabled = self.source.replace(
            "ROSOMAHA_COFFER_PHOTOS_APPEND_CLONE_PROOF = false",
            "ROSOMAHA_COFFER_PHOTOS_APPEND_CLONE_PROOF = true",
            1,
        ).encode("utf-8")
        with self.assertRaises(MODULE.CofferHelperError):
            MODULE.validate_php_source(enabled)


class OperationPayloadTests(unittest.TestCase):
    def test_expected_order_preserves_eight_then_old_detail(self) -> None:
        before = sample_state()
        payload = MODULE.build_operation_payload(before, source_evidence())
        MODULE.validate_operation_payload(payload)
        self.assertEqual(
            payload["expected"]["gallery_sha256"],
            [MODULE.SOURCE_SHA256, *PHOTO_SHAS, DETAIL_SHA],
        )
        self.assertEqual(
            payload["expected"]["existing_photo_property_value_ids"],
            [5000 + index for index in range(8)],
        )
        self.assertEqual(
            payload["expected"]["existing_photo_file_ids"],
            [6000 + index for index in range(8)],
        )
        self.assertEqual(len(payload["backups"]), 9)
        self.assertEqual(payload["source"]["sha256"], MODULE.SOURCE_SHA256)

    def test_operation_id_is_bound_to_preimage(self) -> None:
        first = sample_state()
        second = copy.deepcopy(first)
        second["detail_picture"]["sha256"] = "f" * 64
        second["gallery_sha256"][0] = "f" * 64
        second.pop("state_sha256")
        second["state_sha256"] = MODULE.evidence_sha256(second)
        self.assertNotEqual(MODULE.operation_id(first), MODULE.operation_id(second))

    def test_tampered_expected_order_is_rejected(self) -> None:
        payload = MODULE.build_operation_payload(sample_state(), source_evidence())
        payload["expected"]["gallery_sha256"][2:4] = reversed(
            payload["expected"]["gallery_sha256"][2:4]
        )
        with self.assertRaises(MODULE.CofferHelperError):
            MODULE.validate_operation_payload(payload)

    def test_nested_preimage_and_backup_tampering_is_rejected(self) -> None:
        mutations = {
            "property_value_id": lambda value: value["before"]["photos"][0].__setitem__(
                "property_value_id", 999999
            ),
            "file_id": lambda value: value["before"]["photos"][0]["file"].__setitem__(
                "id", 999999
            ),
            "description": lambda value: value["before"]["photos"][0].__setitem__(
                "description", "tampered"
            ),
            "relative_path": lambda value: value["before"]["photos"][0]["file"].__setitem__(
                "relative_path", "/upload/tampered.jpg"
            ),
            "backup_path": lambda value: value["backups"][0].__setitem__(
                "path", "/tmp/tampered.jpg"
            ),
            "backup_hash": lambda value: value["backups"][0].__setitem__(
                "sha256", "0" * 64
            ),
            "backup_size": lambda value: value["backups"][0].__setitem__(
                "bytes", 1
            ),
        }
        for name, mutate in mutations.items():
            payload = MODULE.build_operation_payload(sample_state(), source_evidence())
            mutate(payload)
            with self.subTest(name=name):
                with self.assertRaises(MODULE.CofferHelperError):
                    MODULE.validate_operation_payload(payload)

    def test_remote_command_has_one_fixed_mode_and_ascii(self) -> None:
        payload = MODULE.build_operation_payload(sample_state(), source_evidence())
        command, digest = MODULE.build_remote_command(
            PHP_PATH.read_bytes(), "apply", payload
        )
        self.assertTrue(command.isascii())
        self.assertLess(len(command.encode("ascii")), MODULE.MAX_REMOTE_COMMAND_BYTES)
        self.assertRegex(digest, r"^[a-f0-9]{64}$")
        self.assertIn("'apply'", command)
        self.assertIn(payload["operation_id"], command)

    def test_audit_command_carries_no_operation_payload(self) -> None:
        command, _ = MODULE.build_remote_command(PHP_PATH.read_bytes(), "audit")
        self.assertIn("-- 'audit'", command)
        self.assertNotIn("bitrix-coffer-", command)


class RemoteAuditValidationTests(unittest.TestCase):
    def test_normal_remote_audit(self) -> None:
        normalized = MODULE.validate_remote_audit(remote_audit())
        self.assertEqual(normalized["detail_picture"]["id"], 3883)
        self.assertEqual(len(normalized["photos"]), 8)

    def test_wrong_detail_id_rejected(self) -> None:
        state = sample_state()
        state["detail_picture"]["id"] = 9999
        state.pop("state_sha256")
        state["state_sha256"] = MODULE.evidence_sha256(state)
        with self.assertRaises(MODULE.RemoteError):
            MODULE.validate_remote_audit(remote_audit(state))

    def test_duplicate_file_id_rejected(self) -> None:
        state = sample_state()
        state["photos"][1]["file"]["id"] = state["photos"][0]["file"]["id"]
        state.pop("state_sha256")
        state["state_sha256"] = MODULE.evidence_sha256(state)
        with self.assertRaises(MODULE.RemoteError):
            MODULE.validate_remote_audit(remote_audit(state))

    def test_state_hash_tamper_rejected(self) -> None:
        state = sample_state()
        state["state_sha256"] = "0" * 64
        with self.assertRaises(MODULE.RemoteError):
            MODULE.validate_remote_audit(remote_audit(state))

    def test_not_ready_is_rejected(self) -> None:
        remote = remote_audit()
        remote["ready_for_apply"] = True
        with self.assertRaises(MODULE.RemoteError):
            MODULE.validate_remote_audit(remote)

    def test_production_apply_is_fail_closed_without_clone_proof(self) -> None:
        self.assertFalse(MODULE.PHOTOS_APPEND_CLONE_PROOF_VERIFIED)
        with self.assertRaisesRegex(MODULE.CofferHelperError, "NO-GO"):
            MODULE.require_photos_append_clone_proof()

    def test_clone_proof_receipt_binds_exact_thumbnail(self) -> None:
        thumbnail = {
            "sha256": "6" * 64,
            "bytes": 123456,
            "width": 520,
            "height": 457,
        }
        receipt = {
            "schema_version": 1,
            "isolated_bitrix_copy": True,
            "source_sha256": MODULE.SOURCE_SHA256,
            "photos_append_success": {
                "existing_eight_rows_exact": True,
                "old_detail_appended": True,
            },
            "photos_append_injected_failure": {
                "baseline_exact": True,
                "existing_eight_rows_exact": True,
            },
            "thumbnail": thumbnail,
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "proof.json"
            raw = json.dumps(receipt, sort_keys=True).encode("utf-8")
            path.write_bytes(raw)
            descriptor = {
                "receipt_sha256": MODULE.sha256_bytes(raw),
                **thumbnail,
            }
            with mock.patch.object(MODULE, "CLONE_PROOF_RECEIPT", path):
                self.assertTrue(MODULE.validate_clone_proof_receipt(descriptor))
                descriptor["sha256"] = "0" * 64
                self.assertFalse(MODULE.validate_clone_proof_receipt(descriptor))

    def test_operation_rejects_existing_photo_description_drift(self) -> None:
        before = sample_state()
        payload = MODULE.build_operation_payload(before, source_evidence())
        state = applied_state(before)
        state["photos"][0]["description"] = "drift"
        state.pop("state_sha256")
        state["state_sha256"] = MODULE.evidence_sha256(state)
        remote = remote_operation(
            "recover", payload, state, "applied_exact", verified=True
        )
        with self.assertRaises(MODULE.RemoteError):
            MODULE.validate_remote_operation_state(remote, payload)


class PublicContractTests(unittest.TestCase):
    def test_html_parser_extracts_head_gallery_and_control(self) -> None:
        html = f"""
        <html><head><title> Опция </title>
        <link rel="canonical" href="{MODULE.OPTION_URL}">
        <meta name="description" content="Описание">
        <meta property="og:image" content="/upload/preview.jpg">
        </head><body><div itemscope itemtype="http://schema.org/Product">
        <h1>{MODULE.ELEMENT_NAME}</h1>
        <div itemprop="offers" itemscope itemtype="http://schema.org/Offer">
          <meta itemprop="price" content="75000">
          <meta itemprop="priceCurrency" content="RUB">
        </div>
        <meta itemprop="name" content="{MODULE.ELEMENT_NAME}">
        <link itemprop="url" href="{MODULE.OPTION_URL}">
        <link href="/upload/first.jpg" itemprop="image">
        <a href="/upload/first.jpg" data-fancybox="gallery"><img src="/upload/thumb.jpg"></a>
        <span onclick="priceCalculator.toggleOption(this)" data-product-id="952"
          data-sum="75000" data-name="{MODULE.ELEMENT_NAME}" data-row-id="row"></span>
        </div></body></html>
        """
        parser = MODULE.ProductPageParser()
        parser.feed(html)
        parser.close()
        self.assertEqual(parser.canonical, [MODULE.OPTION_URL])
        self.assertEqual(parser.gallery, ["/upload/first.jpg"])
        self.assertEqual(parser.gallery_thumbnails, ["/upload/thumb.jpg"])
        self.assertEqual(parser.controls[0]["data-product-id"], "952")
        self.assertEqual(parser.h1, MODULE.ELEMENT_NAME)
        self.assertIn(MODULE.ELEMENT_NAME, parser.visible_text)
        structured = MODULE.structured_data_snapshot(
            parser, base_url=MODULE.OPTION_URL
        )
        self.assertEqual(structured["product_images"], [f"{MODULE.PUBLIC_ORIGIN}/upload/first.jpg"])
        self.assertEqual(structured["product_names"], [MODULE.ELEMENT_NAME])
        self.assertEqual(structured["offer_prices"], ["75000"])

    def test_microdata_masks_only_product_image(self) -> None:
        def snapshot(image: str, price: str) -> dict[str, object]:
            parser = MODULE.ProductPageParser()
            parser.feed(f"""
              <div itemscope itemtype="http://schema.org/Product">
                <div itemprop="offers" itemscope itemtype="http://schema.org/Offer">
                  <meta itemprop="price" content="{price}">
                  <meta itemprop="priceCurrency" content="RUB">
                </div>
                <meta itemprop="name" content="{MODULE.ELEMENT_NAME}">
                <link itemprop="url" href="{MODULE.OPTION_URL}">
                <link itemprop="image" href="{image}">
              </div>
            """)
            parser.close()
            return MODULE.structured_data_snapshot(parser, base_url=MODULE.OPTION_URL)

        first = snapshot("/upload/a.jpg", "75000")
        second = snapshot("/upload/b.jpg", "75000")
        commercial_drift = snapshot("/upload/b.jpg", "76000")
        self.assertEqual(first["masked_sha256"], second["masked_sha256"])
        self.assertNotEqual(second["masked_sha256"], commercial_drift["masked_sha256"])

    def test_microdata_rejects_missing_or_duplicate_product_offer(self) -> None:
        cases = (
            "<div></div>",
            """
              <div itemscope itemtype="http://schema.org/Product">
                <meta itemprop="name" content="x"><link itemprop="url" href="/x/">
                <link itemprop="image" href="/x.jpg">
              </div>
            """,
            """
              <div itemscope itemtype="http://schema.org/Product">
                <div itemprop="offers" itemscope itemtype="http://schema.org/Offer">
                  <meta itemprop="price" content="1"><meta itemprop="priceCurrency" content="RUB">
                </div>
                <div itemprop="offers" itemscope itemtype="http://schema.org/Offer"></div>
                <meta itemprop="name" content="x"><link itemprop="url" href="/x/">
                <link itemprop="image" href="/x.jpg">
              </div>
            """,
        )
        for html in cases:
            parser = MODULE.ProductPageParser()
            parser.feed(html)
            parser.close()
            with self.subTest(html=html[:40]):
                with self.assertRaises(MODULE.PublicGateError):
                    MODULE.structured_data_snapshot(parser, base_url=MODULE.OPTION_URL)

    def test_database_public_parity_normal(self) -> None:
        state = sample_state()
        MODULE.validate_database_public_parity(state, public_baseline(state))

    def test_database_public_parity_rejects_reorder(self) -> None:
        state = sample_state()
        public = public_baseline(state)
        public["gallery"][1], public["gallery"][2] = (
            public["gallery"][2],
            public["gallery"][1],
        )
        with self.assertRaises(MODULE.PublicGateError):
            MODULE.validate_database_public_parity(state, public)

    def test_candidate_public_contract(self) -> None:
        before = sample_state()
        baseline = public_baseline(before)
        payload = MODULE.build_operation_payload(before, source_evidence())
        after = public_baseline(applied_state(before))
        attach_thumbnail_clone_proof(payload, after)
        result = MODULE.verify_public_after(baseline, after, payload)
        self.assertTrue(result["verified"])
        self.assertTrue(result["existing_eight_urls_and_ids_preserved"])

    def test_candidate_rejects_existing_photo_url_change(self) -> None:
        before = sample_state()
        baseline = public_baseline(before)
        payload = MODULE.build_operation_payload(before, source_evidence())
        after = public_baseline(applied_state(before))
        attach_thumbnail_clone_proof(payload, after)
        after["gallery"][3]["url"] = f"{MODULE.PUBLIC_ORIGIN}/upload/changed.jpg"
        with self.assertRaises(MODULE.PublicGateError):
            MODULE.verify_public_after(baseline, after, payload)

    def test_candidate_rejects_head_model_or_sitemap_drift(self) -> None:
        before = sample_state()
        baseline = public_baseline(before)
        payload = MODULE.build_operation_payload(before, source_evidence())
        for mutation in ("title", "model", "sitemap"):
            after = public_baseline(applied_state(before))
            attach_thumbnail_clone_proof(payload, after)
            if mutation == "title":
                after["option"]["title"] = "drift"
            elif mutation == "model":
                after["models"][0]["target_position"] = 0
            else:
                after["sitemap"]["sha256"] = "0" * 64
            with self.subTest(mutation=mutation):
                with self.assertRaises(MODULE.PublicGateError):
                    MODULE.verify_public_after(baseline, after, payload)

    def test_candidate_rejects_visible_content_or_microdata_drift(self) -> None:
        before = sample_state()
        baseline = public_baseline(before)
        payload = MODULE.build_operation_payload(before, source_evidence())
        for mutation in ("visible", "microdata"):
            after = public_baseline(applied_state(before))
            attach_thumbnail_clone_proof(payload, after)
            if mutation == "visible":
                after["option"]["visible_text"]["sha256"] = "0" * 64
            else:
                after["option"]["structured_data"]["masked_sha256"] = "0" * 64
            with self.subTest(mutation=mutation):
                with self.assertRaises(MODULE.PublicGateError):
                    MODULE.verify_public_after(baseline, after, payload)

    def test_candidate_rejects_extra_product_image_or_stale_thumbnail(self) -> None:
        before = sample_state()
        baseline = public_baseline(before)
        payload = MODULE.build_operation_payload(before, source_evidence())
        for mutation in (
            "extra_product_image", "stale_thumbnail", "wrong_thumbnail_aspect",
            "wrong_thumbnail_content",
        ):
            after = public_baseline(applied_state(before))
            attach_thumbnail_clone_proof(payload, after)
            if mutation == "extra_product_image":
                after["option"]["structured_data"]["product_images"].append(
                    f"{MODULE.PUBLIC_ORIGIN}/upload/unexpected.jpg"
                )
            else:
                if mutation == "stale_thumbnail":
                    after["first_thumbnail"] = copy.deepcopy(
                        baseline["first_thumbnail"]
                    )
                else:
                    if mutation == "wrong_thumbnail_aspect":
                        after["first_thumbnail"]["width"] = 520
                        after["first_thumbnail"]["height"] = 300
                    else:
                        after["first_thumbnail"]["url"] = (
                            f"{MODULE.PUBLIC_ORIGIN}/upload/unrelated.jpg"
                        )
                        after["first_thumbnail"]["sha256"] = "0" * 64
            with self.subTest(mutation=mutation):
                with self.assertRaises(MODULE.PublicGateError):
                    MODULE.verify_public_after(baseline, after, payload)

    def test_semantic_rollback_does_not_claim_exact_seo(self) -> None:
        before = sample_state()
        baseline = public_baseline(before)
        after = public_baseline(semantic_rollback_state(before))
        result = MODULE.verify_public_rollback(baseline, after)
        self.assertFalse(result["verified"])
        self.assertFalse(result["identifier_restoration"])
        self.assertFalse(result["seo_contract_unchanged"])
        self.assertEqual(
            result["seo_contract_status"], "unknown_due_detail_url_change"
        )


class ReceiptAndDispatchTests(unittest.TestCase):
    def test_receipt_write_is_immutable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "receipt.json"
            MODULE.write_immutable_json(path, {"ok": True})
            with self.assertRaises(FileExistsError):
                MODULE.write_immutable_json(path, {"ok": False})
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), {"ok": True})

    def test_apply_source_has_one_write_dispatch_and_no_retry_loop(self) -> None:
        source = inspect.getsource(MODULE.run_apply)
        self.assertEqual(source.count('execute_remote("apply"'), 1)
        self.assertNotIn("while ", source)
        self.assertNotIn("for attempt", source)
        self.assertIn("automatic_retry", source)

    def test_recover_dispatches_read_only_mode(self) -> None:
        source = inspect.getsource(MODULE.run_existing)
        self.assertIn('execute_remote(mode, payload)', source)
        php = PHP_PATH.read_text(encoding="utf-8")
        recover = php.split("function rosomahaCofferRecover", 1)[1].split(
            "function rosomahaCofferRollback", 1
        )[0]
        self.assertNotIn("SetPropertyValuesEx", recover)

    def test_safe_error_redacts_pinned_paths(self) -> None:
        error = RuntimeError(
            f"password=visible {MODULE.SITE_ROOT} {MODULE.EXPECTED_LOGIN}"
        )
        text = MODULE.safe_error(error)
        self.assertNotIn("visible", text)
        self.assertNotIn(MODULE.SITE_ROOT, text)
        self.assertNotIn(MODULE.EXPECTED_LOGIN, text)

    def test_apply_public_failure_still_writes_indeterminate_receipt(self) -> None:
        before = sample_state()
        baseline = public_baseline(before)
        payload = MODULE.build_operation_payload(before, source_evidence())
        remote_after = remote_operation(
            "apply", payload, applied_state(before), "applied_exact",
            mutations=2,
        )
        client = mock.Mock()
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            MODULE, "REPORT_ROOT", Path(directory)
        ), mock.patch.object(
            MODULE, "require_committed_helpers", return_value="a" * 40
        ), mock.patch.object(
            MODULE, "require_photos_append_clone_proof", return_value=None
        ), mock.patch.object(
            MODULE, "execute_remote", side_effect=[remote_audit(before), remote_after]
        ), mock.patch.object(
            MODULE,
            "public_audit",
            side_effect=[baseline, MODULE.PublicGateError("public drift")],
        ), mock.patch.object(
            MODULE, "connect", return_value=client
        ), mock.patch.object(
            MODULE,
            "stage_operation_files",
            return_value={"verified": True, "backup_count": 9},
        ):
            receipt, path = MODULE.run_apply()
            receipt_exists = path.is_file()
        self.assertEqual(receipt["status"], "indeterminate")
        self.assertEqual(receipt["verification"]["reason"], "public_verification_failed")
        self.assertTrue(receipt_exists)
        client.close.assert_called_once()

    def test_rollback_dispatch_failure_still_writes_receipt(self) -> None:
        before = sample_state()
        payload = MODULE.build_operation_payload(before, source_evidence())
        pending = MODULE.base_receipt("apply_pending", source_evidence())
        pending.update(
            {
                "status": "pending",
                "operation_id": payload["operation_id"],
                "operation_payload": payload,
                "public_before": public_baseline(before),
            }
        )
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            MODULE, "REPORT_ROOT", Path(directory)
        ), mock.patch.object(
            MODULE, "require_committed_helpers", return_value="a" * 40
        ), mock.patch.object(
            MODULE, "execute_remote", side_effect=MODULE.RemoteError("lost")
        ):
            MODULE.write_immutable_json(
                MODULE.pending_path(payload["operation_id"]), pending
            )
            receipt, path = MODULE.run_existing("rollback", payload["operation_id"])
            receipt_exists = path.is_file()
        self.assertEqual(receipt["status"], "indeterminate")
        self.assertEqual(receipt["verification"]["reason"], "remote_dispatch_failed")
        self.assertEqual(receipt["database_mutations"], "unknown")
        self.assertTrue(receipt_exists)

    def test_recover_applied_state_requires_matching_public_candidate(self) -> None:
        before = sample_state()
        payload = MODULE.build_operation_payload(before, source_evidence())
        pending = MODULE.base_receipt("apply_pending", source_evidence())
        pending.update(
            {
                "status": "pending",
                "operation_id": payload["operation_id"],
                "operation_payload": payload,
                "public_before": public_baseline(before),
            }
        )
        state = applied_state(before)
        remote = remote_operation(
            "recover", payload, state, "applied_exact", verified=True
        )
        candidate = public_baseline(state)
        attach_thumbnail_clone_proof(payload, candidate)
        candidate["option"]["canonical"] = ["https://rosomaha-rus.ru/wrong/"]
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            MODULE, "REPORT_ROOT", Path(directory)
        ), mock.patch.object(
            MODULE, "execute_remote", return_value=remote
        ), mock.patch.object(
            MODULE, "public_audit", return_value=candidate
        ):
            MODULE.write_immutable_json(
                MODULE.pending_path(payload["operation_id"]), pending
            )
            receipt, _ = MODULE.run_existing("recover", payload["operation_id"])
        self.assertEqual(receipt["status"], "blocked")
        self.assertFalse(receipt["verification"]["verified"])

    def test_recover_applied_state_verifies_database_and_public(self) -> None:
        before = sample_state()
        payload = MODULE.build_operation_payload(before, source_evidence())
        pending = MODULE.base_receipt("apply_pending", source_evidence())
        pending.update(
            {
                "status": "pending",
                "operation_id": payload["operation_id"],
                "operation_payload": payload,
                "public_before": public_baseline(before),
            }
        )
        state = applied_state(before)
        remote = remote_operation(
            "recover", payload, state, "applied_exact", verified=True
        )
        candidate = public_baseline(state)
        attach_thumbnail_clone_proof(payload, candidate)
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            MODULE, "REPORT_ROOT", Path(directory)
        ), mock.patch.object(
            MODULE, "execute_remote", return_value=remote
        ), mock.patch.object(
            MODULE, "public_audit", return_value=candidate
        ):
            MODULE.write_immutable_json(
                MODULE.pending_path(payload["operation_id"]), pending
            )
            receipt, _ = MODULE.run_existing("recover", payload["operation_id"])
        self.assertEqual(receipt["status"], "ok")
        self.assertTrue(receipt["verification"]["verified"])


class _MemoryRemoteFile(io.BytesIO):
    def __init__(self, store: dict[str, bytes], path: str, initial: bytes, writable: bool) -> None:
        super().__init__(initial)
        self.store = store
        self.path = path
        self.writable = writable

    def close(self) -> None:
        if self.writable:
            self.store[self.path] = self.getvalue()
        super().close()

    def flush(self) -> None:
        if self.writable:
            self.store[self.path] = self.getvalue()
        super().flush()


class _FakeSftp:
    def __init__(self, files: dict[str, bytes], directories: set[str]) -> None:
        self.files = files
        self.directories = directories
        self.modes: dict[str, int] = {}

    def lstat(self, path: str) -> types.SimpleNamespace:
        if path in self.directories:
            return types.SimpleNamespace(st_mode=stat.S_IFDIR | self.modes.get(path, 0o700), st_size=0)
        if path in self.files:
            return types.SimpleNamespace(st_mode=stat.S_IFREG | self.modes.get(path, 0o600), st_size=len(self.files[path]))
        raise OSError("missing")

    def mkdir(self, path: str, mode: int = 0o777) -> None:
        if path in self.directories or path in self.files:
            raise OSError("exists")
        self.directories.add(path)
        self.modes[path] = mode

    def chmod(self, path: str, mode: int) -> None:
        self.modes[path] = mode

    def open(self, path: str, mode: str) -> _MemoryRemoteFile:
        writable = "w" in mode
        if not writable and path not in self.files:
            raise OSError("missing")
        return _MemoryRemoteFile(self.files, path, self.files.get(path, b""), writable)

    def close(self) -> None:
        return None


class _FakeClient:
    def __init__(self, sftp: _FakeSftp) -> None:
        self.sftp = sftp

    def open_sftp(self) -> _FakeSftp:
        return self.sftp


class BinaryStagingTests(unittest.TestCase):
    def test_binary_stage_uploads_source_and_nine_verified_backups(self) -> None:
        source_data = MODULE.SOURCE_IMAGE.read_bytes()
        source_width, source_height = MODULE.jpeg_dimensions(source_data)
        before = sample_state()
        all_files = [before["detail_picture"], *[row["file"] for row in before["photos"]]]
        for index, file in enumerate(all_files):
            file.update(
                {
                    "sha256": MODULE.SOURCE_SHA256,
                    "bytes": len(source_data),
                    "width": source_width,
                    "height": source_height,
                }
            )
        before["gallery_sha256"] = [MODULE.SOURCE_SHA256] * 9
        before.pop("state_sha256")
        before["state_sha256"] = MODULE.evidence_sha256(before)
        payload = MODULE.build_operation_payload(before, source_evidence())
        files = {
            MODULE.SITE_ROOT + file["relative_path"]: source_data
            for file in all_files
        }
        sftp = _FakeSftp(files, {MODULE.OPERATION_ROOT})
        result = MODULE.stage_operation_files(_FakeClient(sftp), payload)
        self.assertTrue(result["verified"])
        self.assertEqual(result["backup_count"], 9)
        self.assertEqual(
            sftp.files[payload["source"]["path"]],
            source_data,
        )
        for descriptor in payload["backups"]:
            self.assertEqual(sftp.files[descriptor["path"]], source_data)

    def test_existing_operation_dir_blocks_blind_retry(self) -> None:
        before = sample_state()
        payload = MODULE.build_operation_payload(before, source_evidence())
        op_dir = f"{MODULE.OPERATION_ROOT}/{payload['operation_id']}"
        sftp = _FakeSftp({}, {MODULE.OPERATION_ROOT, op_dir})
        with self.assertRaisesRegex(MODULE.RemoteError, "blind retry"):
            MODULE.stage_operation_files(_FakeClient(sftp), payload)


if __name__ == "__main__":
    unittest.main(verbosity=2)
