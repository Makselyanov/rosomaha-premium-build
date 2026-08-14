#!/usr/bin/env python3
"""Safety and schema tests for the phase-1 Bitrix fan-option audit."""

from __future__ import annotations

import importlib.util
import json
import os
import re
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


SCRIPT_PATH = Path(__file__).with_name("bitrix-fan-button-option.py")
PHP_PATH = Path(__file__).with_name("bitrix-fan-button-option.php")
SPEC = importlib.util.spec_from_file_location("bitrix_fan_button_option", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def property_definition(prop_id: int, code: str, prop_type: str = "E") -> dict[str, object]:
    return {
        "id": prop_id,
        "code": code,
        "name": code,
        "type": prop_type,
        "user_type": "",
        "multiple": True,
        "mandatory": False,
        "active": True,
        "sort": 100,
        "link_iblock_id": MODULE.IBLOCK_ID if prop_type == "E" else 0,
        "with_description": False,
        "enums": [],
    }


def element(element_id: int, code: str, property_ids: tuple[int, ...]) -> dict[str, object]:
    shapes = {
        11: ("OPTIONS", "E", True, MODULE.IBLOCK_ID),
        12: ("PRICE", "N", True, 0),
    }
    return {
        "id": element_id,
        "code": code,
        "fields": {"iblock_id": MODULE.IBLOCK_ID, "sort": 500},
        "sections": [],
        "properties": [
            {
                "id": prop_id,
                "code": shapes[prop_id][0],
                "type": shapes[prop_id][1],
                "multiple": shapes[prop_id][2],
                "link_iblock_id": shapes[prop_id][3],
                "values": [],
            }
            for prop_id in property_ids
        ],
    }


def valid_payload(*, strong_count: int = 1, ready: bool = True) -> dict[str, object]:
    definitions = [property_definition(11, "OPTIONS"), property_definition(12, "PRICE", "N")]
    property_ids = (11, 12)
    models = [
        element(2000 + index, code, property_ids)
        for index, code in enumerate(MODULE.MODEL_CODES)
    ]
    candidates = [
        {
            "direction": "option_to_models",
            "property": definitions[0],
            "anchor_model_codes": list(MODULE.MODEL_CODES[:8]),
            "comparator_model_codes": list(MODULE.MODEL_CODES),
            "anchor_foreign_link_ids": [],
            "comparator_foreign_link_ids": [],
            "strong": True,
        }
        for _ in range(strong_count)
    ]
    return {
        "status": "ok",
        "mode": "audit",
        "phase": "schema_and_relation_discovery",
        "apply_supported": False,
        "database_mutations": 0,
        "identity": {
            "domain": MODULE.DOMAIN,
            "site_id": MODULE.SITE_ID,
            "site_root": MODULE.SITE_ROOT,
            "iblock_id": MODULE.IBLOCK_ID,
            "anchor_id": MODULE.ANCHOR_ID,
            "anchor_code": MODULE.ANCHOR_CODE,
            "comparator_id": MODULE.COMPARATOR_ID,
            "comparator_role": MODULE.COMPARATOR_ROLE,
            "target": {
                "name": MODULE.TARGET_NAME,
                "code": MODULE.TARGET_CODE,
                "price": MODULE.TARGET_PRICE,
            },
            "model_codes": list(MODULE.MODEL_CODES),
            "trailer_included": False,
        },
        "schema": {
            "site": {"id": MODULE.SITE_ID, "active": True},
            "iblock": {
                "id": MODULE.IBLOCK_ID,
                "active": True,
                "site_ids": [MODULE.SITE_ID],
            },
            "property_definitions": definitions,
        },
        "elements": {
            "anchor": element(MODULE.ANCHOR_ID, MODULE.ANCHOR_CODE, property_ids),
            "comparator": element(MODULE.COMPARATOR_ID, "bagira", property_ids),
            "models": models,
        },
        "relation_analysis": {
            "desired_scope": {
                "model_codes": list(MODULE.MODEL_CODES),
                "model_count": 12,
                "trailer_included": False,
                "anchor_scope_is_not_target_scope": True,
                "future_new_elements_max": 1,
                "future_existing_element_writes_max": 0,
            },
            "candidate_relations": candidates,
            "strong_candidate_count": strong_count,
            "unambiguous": strong_count == 1,
            "derived_relation": candidates[0] if strong_count == 1 else None,
            "single_element_write_supported": strong_count == 1,
        },
        "price_analysis": {
            "target_price": MODULE.TARGET_PRICE,
            "candidates": [
                {
                    "property": definitions[1],
                    "anchor_numeric_values": [18000],
                    "comparator_numeric_values": [60000],
                    "strong": True,
                }
            ],
            "strong_candidate_count": 1,
            "unambiguous": True,
            "derived_property": definitions[1],
        },
        "section_order": {
            "anchor_sort": 500,
            "sections": [
                {
                    "section": {"id": 10},
                    "sibling_count": 2,
                    "anchor_position_zero_based": 0,
                    "previous": None,
                    "anchor": {"id": MODULE.ANCHOR_ID, "sort": 500},
                    "next": {"id": 878, "sort": 600},
                    "sort_gap_after_anchor": 100,
                    "siblings": [
                        {"id": MODULE.ANCHOR_ID, "sort": 500},
                        {"id": 878, "sort": 600},
                    ],
                }
            ],
            "global_sort_plan": {
                "candidate_sort": 501,
                "unambiguous": True,
                "requires_sibling_resort": False,
            },
        },
        "target_duplicates": {
            "by_exact_name": [],
            "by_exact_code": [],
            "union": [],
        },
        "ready_for_apply": ready,
        "blockers": [] if ready else ["relation_property_or_direction_is_ambiguous"],
    }


class FixedScopeTests(unittest.TestCase):
    def test_exact_identity_and_allowlist_match_repository_constants(self) -> None:
        source = (SCRIPT_PATH.parents[1] / "src" / "data" / "products.ts").read_text(
            encoding="utf-8"
        )
        block = source.split("export const classicVariants", 1)[1].split("];", 1)[0]
        slugs = tuple(re.findall(r"slug:\s*'([^']+)'", block))
        self.assertEqual(slugs, MODULE.MODEL_CODES)
        self.assertEqual(len(MODULE.MODEL_CODES), 12)
        self.assertNotIn("trailer", " ".join(MODULE.MODEL_CODES).lower())
        self.assertEqual(MODULE.HOST, "ocelot.beget.com")
        self.assertEqual(MODULE.EXPECTED_LOGIN, "berkutm4")
        self.assertEqual(MODULE.IBLOCK_ID, 86)
        self.assertEqual(MODULE.ANCHOR_ID, 877)
        self.assertEqual(MODULE.COMPARATOR_ID, 997)
        self.assertEqual(MODULE.TARGET_PRICE, 7000)

    def test_php_has_exact_identity_and_all_twelve_codes(self) -> None:
        source = PHP_PATH.read_text(encoding="utf-8")
        self.assertIn("const ROSOMAHA_FAN_IBLOCK_ID = 86;", source)
        self.assertIn("const ROSOMAHA_FAN_ANCHOR_ID = 877;", source)
        self.assertIn("const ROSOMAHA_FAN_COMPARATOR_ID = 997;", source)
        self.assertIn(MODULE.TARGET_NAME, source)
        self.assertIn(MODULE.TARGET_CODE, source)
        for code in MODULE.MODEL_CODES:
            self.assertEqual(source.count("'" + code + "'"), 1)


class AuditOnlyContractTests(unittest.TestCase):
    def test_php_contains_no_mutator_or_file_write_calls(self) -> None:
        source = PHP_PATH.read_text(encoding="utf-8")
        forbidden = (
            r"CIBlockElement\s*::\s*(?:Add|Update|Delete|SetPropertyValues(?:Ex)?)\s*\(",
            r"->\s*(?:Add|Update|Delete|SetPropertyValues(?:Ex)?)\s*\(",
            r"\b(?:file_put_contents|fopen|fwrite|mkdir|rename|copy|unlink|chmod)\s*\(",
            r"\beval\s*\(",
            r"\b(?:exec|system|shell_exec|passthru|proc_open|popen)\s*\(",
            r"\$DB\s*->",
        )
        for pattern in forbidden:
            self.assertIsNone(re.search(pattern, source, flags=re.IGNORECASE), pattern)
        for reader in (
            "CIBlockElement::GetList",
            "CIBlockElement::GetProperty",
            "CIBlockElement::GetElementGroups",
            "CIBlockProperty::GetList",
            "CIBlockPropertyEnum::GetList",
        ):
            self.assertIn(reader, source)
        self.assertIn("'apply_supported' => false", source)
        self.assertIn("'database_mutations' => 0", source)

    def test_apply_and_recover_are_blocked_before_dispatch(self) -> None:
        execute = Mock()
        with patch.object(MODULE, "run_audit", execute):
            self.assertEqual(MODULE.main(["--apply"]), 2)
            self.assertEqual(MODULE.main(["--recover=anything"]), 2)
        execute.assert_not_called()

    def test_execute_remote_rejects_non_audit_before_connection(self) -> None:
        connector = Mock()
        with self.assertRaises(MODULE.ForbiddenModeError):
            MODULE.execute_remote("apply", connect_fn=connector)
        connector.assert_not_called()

    def test_remote_command_pins_bytes_lint_root_php_and_only_audit_arg(self) -> None:
        script_bytes = PHP_PATH.read_bytes()
        command, digest = MODULE.build_remote_command(script_bytes)
        self.assertEqual(digest, __import__("hashlib").sha256(script_bytes).hexdigest())
        self.assertIn(f"test \"$decoded_sha256\" = '{digest}'", command)
        self.assertIn(f"realpath -- '{MODULE.SITE_ROOT}'", command)
        self.assertIn("$php_binary\" -l", command)
        self.assertIn("-- 'audit'", command)
        self.assertNotIn("-- 'apply'", command)
        self.assertNotIn("-- 'recover'", command)
        self.assertTrue(all(candidate.startswith("/") for candidate in MODULE.PHP_CANDIDATES))
        for binary in ("base64", "sha256sum", "awk", "realpath", "timeout"):
            self.assertIn(f"/usr/bin/{binary}", command)
        self.assertNotIn("command -v", command)

    def test_nonempty_remote_stderr_fails_closed(self) -> None:
        client = Mock()
        with patch.object(
            MODULE,
            "run_remote_command",
            return_value=(0, "ignored", "unexpected warning"),
        ):
            with self.assertRaises(MODULE.RemoteAuditError):
                MODULE.execute_remote("audit", connect_fn=Mock(return_value=client))
        client.close.assert_called_once_with()


class CredentialSafetyTests(unittest.TestCase):
    def test_duplicate_credentials_fail_before_network_client_exists(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            env_path = Path(directory) / ".env"
            env_path.write_text(
                "BEGET_LOGIN=berkutm4\n"
                "BEGET_LOGIN=berkutm4\n"
                "BEGET_PASSWORD=not-a-real-password\n",
                encoding="utf-8",
            )
            with patch.object(MODULE.paramiko, "SSHClient") as client_type:
                with self.assertRaises(MODULE.CredentialError):
                    MODULE.connect(environ={}, env_path=env_path)
            client_type.assert_not_called()

    def test_incomplete_environment_does_not_fall_back_to_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            env_path = Path(directory) / ".env"
            env_path.write_text(
                "BEGET_LOGIN=berkutm4\nBEGET_PASSWORD=file-value\n",
                encoding="utf-8",
            )
            with self.assertRaises(MODULE.CredentialError):
                MODULE.load_credentials(
                    environ={"BEGET_LOGIN": "berkutm4"}, env_path=env_path
                )

    def test_exact_standard_source_parses_without_logging_values(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            env_path = Path(directory) / ".env"
            env_path.write_text(
                "BEGET_LOGIN='berkutm4'\nBEGET_PASSWORD=fixture-only\n",
                encoding="utf-8",
            )
            self.assertEqual(
                MODULE.load_credentials(environ={}, env_path=env_path),
                ("berkutm4", "fixture-only"),
            )


class PayloadSchemaTests(unittest.TestCase):
    def test_full_property_schema_and_normalized_values_are_accepted(self) -> None:
        payload = valid_payload()
        anchor = payload["elements"]["anchor"]
        anchor["properties"][1]["values"] = [
            {
                "value": 18000,
                "enum_value": None,
                "enum_xml_id": None,
                "description": None,
            }
        ]
        normalized = MODULE.normalize_remote_payload(payload)
        self.assertEqual(
            len(normalized["elements"]["anchor"]["properties"]),
            len(normalized["schema"]["property_definitions"]),
        )
        self.assertEqual(
            normalized["elements"]["anchor"]["properties"][1]["values"][0]["value"],
            18000,
        )

    def test_missing_property_definition_on_one_model_is_rejected(self) -> None:
        payload = valid_payload()
        payload["elements"]["models"][0]["properties"].pop()
        with self.assertRaises(MODULE.RemoteAuditError):
            MODULE.normalize_remote_payload(payload)

    def test_model_allowlist_or_trailer_drift_is_rejected(self) -> None:
        payload = valid_payload()
        payload["identity"]["model_codes"][-1] = "trailer"
        with self.assertRaises(MODULE.RemoteAuditError):
            MODULE.normalize_remote_payload(payload)

    def test_nonzero_mutation_counter_is_rejected(self) -> None:
        payload = valid_payload()
        payload["database_mutations"] = 1
        with self.assertRaises(MODULE.RemoteAuditError):
            MODULE.normalize_remote_payload(payload)

    def test_ambiguous_relation_stays_blocked(self) -> None:
        payload = valid_payload(strong_count=2, ready=False)
        normalized = MODULE.normalize_remote_payload(payload)
        self.assertFalse(normalized["relation_analysis"]["unambiguous"])
        self.assertFalse(normalized["ready_for_apply"])
        payload["ready_for_apply"] = True
        with self.assertRaises(MODULE.RemoteAuditError):
            MODULE.normalize_remote_payload(payload)

    def test_models_to_option_is_evidence_but_never_single_element_ready(self) -> None:
        payload = valid_payload(ready=False)
        option_candidate = payload["relation_analysis"]["candidate_relations"][0]
        candidate = {
            "direction": "models_to_option",
            "property": option_candidate["property"],
            "models_referencing_anchor": list(MODULE.MODEL_CODES[:8]),
            "models_referencing_comparator": list(MODULE.MODEL_CODES),
            "strong": True,
        }
        payload["relation_analysis"]["candidate_relations"] = [candidate]
        payload["relation_analysis"]["derived_relation"] = candidate
        payload["relation_analysis"]["single_element_write_supported"] = False
        payload["blockers"] = [
            "relation_is_not_compatible_with_single_new_element_scope"
        ]
        normalized = MODULE.normalize_remote_payload(payload)
        self.assertTrue(normalized["relation_analysis"]["unambiguous"])
        self.assertFalse(
            normalized["relation_analysis"]["single_element_write_supported"]
        )
        self.assertFalse(normalized["ready_for_apply"])
        payload["ready_for_apply"] = True
        with self.assertRaises(MODULE.RemoteAuditError):
            MODULE.normalize_remote_payload(payload)

    def test_desired_scope_and_derived_relation_must_be_exact(self) -> None:
        payload = valid_payload()
        payload["relation_analysis"]["desired_scope"][
            "future_existing_element_writes_max"
        ] = 12
        with self.assertRaises(MODULE.RemoteAuditError):
            MODULE.normalize_remote_payload(payload)

        payload = valid_payload()
        payload["relation_analysis"]["derived_relation"] = None
        with self.assertRaises(MODULE.RemoteAuditError):
            MODULE.normalize_remote_payload(payload)

    def test_price_sort_and_blocker_consistency_are_fail_closed(self) -> None:
        payload = valid_payload()
        payload["price_analysis"]["unambiguous"] = False
        with self.assertRaises(MODULE.RemoteAuditError):
            MODULE.normalize_remote_payload(payload)

        payload = valid_payload()
        payload["section_order"]["global_sort_plan"]["candidate_sort"] = 700
        with self.assertRaises(MODULE.RemoteAuditError):
            MODULE.normalize_remote_payload(payload)

        payload = valid_payload()
        payload["blockers"] = ["invented_blocker"]
        with self.assertRaises(MODULE.RemoteAuditError):
            MODULE.normalize_remote_payload(payload)


class ReceiptTests(unittest.TestCase):
    def test_receipt_is_atomic_immutable_and_never_overwritten(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "receipt.json"
            MODULE.write_receipt(valid_payload(), path=path)
            original = path.read_bytes()
            mode = path.stat().st_mode
            self.assertFalse(bool(mode & stat.S_IWUSR))
            with self.assertRaises(FileExistsError):
                MODULE.write_receipt(valid_payload(), path=path)
            self.assertEqual(path.read_bytes(), original)
            encoded = original.decode("utf-8")
            self.assertNotIn("BEGET_PASSWORD", encoded)
            self.assertNotIn("fixture-only", encoded)
            os.chmod(path, stat.S_IWUSR | stat.S_IRUSR)

    def test_secret_shaped_field_is_refused_without_creating_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "receipt.json"
            with self.assertRaises(RuntimeError):
                MODULE._atomic_immutable_json(path, {"password": "do-not-write"})
            self.assertFalse(path.exists())

    def test_default_receipt_directory_is_git_ignored(self) -> None:
        gitignore = (SCRIPT_PATH.parents[1] / ".gitignore").read_text(encoding="utf-8")
        self.assertIn("marketing-audits/", gitignore)
        self.assertTrue(MODULE.REPORT_ROOT.is_relative_to(SCRIPT_PATH.parents[1] / "marketing-audits"))


if __name__ == "__main__":
    unittest.main()
