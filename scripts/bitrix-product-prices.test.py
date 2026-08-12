#!/usr/bin/env python3
"""Regression tests for public Bitrix SKU binding verification."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


SCRIPT_PATH = Path(__file__).with_name("bitrix-product-prices.py")
SPEC = importlib.util.spec_from_file_location("bitrix_product_prices", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


PUBLIC_SKU_FIXTURE = """
<div class="sku-props sku-props--detail"></div>
<div
    class="sku-props sku-props--detail"
    data-site-id="s1"
    data-item-id="755"
    data-iblockid="86"
    data-offer-id="764"
    data-offer-iblockid="64"
>
  <div class="sku-props__item"></div>
</div>
"""


class VerifySkuBindingTests(unittest.TestCase):
    def test_accepts_actual_public_class_list_and_multiline_attributes(self) -> None:
        self.assertTrue(MODULE.verify_sku_binding(PUBLIC_SKU_FIXTURE, 755, 764))

    def test_accepts_attribute_reordering_without_relaxing_values(self) -> None:
        page = """
        <div data-offer-iblockid='64' data-offer-id='764'
             data-iblockid='86' data-item-id='755'
             class='sku-props--detail sku-props'></div>
        """
        self.assertTrue(MODULE.verify_sku_binding(page, 755, 764))

    def test_rejects_wrong_product_binding(self) -> None:
        page = PUBLIC_SKU_FIXTURE.replace('data-item-id="755"', 'data-item-id="756"')
        self.assertFalse(MODULE.verify_sku_binding(page, 755, 764))

    def test_rejects_wrong_product_iblock(self) -> None:
        page = PUBLIC_SKU_FIXTURE.replace('data-iblockid="86"', 'data-iblockid="85"')
        self.assertFalse(MODULE.verify_sku_binding(page, 755, 764))

    def test_rejects_wrong_offer_iblock(self) -> None:
        page = PUBLIC_SKU_FIXTURE.replace(
            'data-offer-iblockid="64"', 'data-offer-iblockid="63"'
        )
        self.assertFalse(MODULE.verify_sku_binding(page, 755, 764))

    def test_rejects_missing_selected_offer(self) -> None:
        page = PUBLIC_SKU_FIXTURE.replace('data-offer-id="764"', 'data-offer-id="765"')
        self.assertFalse(MODULE.verify_sku_binding(page, 755, 764))

    def test_rejects_conflicting_duplicate_for_selected_offer(self) -> None:
        conflict = PUBLIC_SKU_FIXTURE.replace(
            'data-offer-iblockid="64"', 'data-offer-iblockid="63"'
        )
        self.assertFalse(
            MODULE.verify_sku_binding(PUBLIC_SKU_FIXTURE + conflict, 755, 764)
        )


def remote_state(classification: str, status: str = "ok") -> dict[str, object]:
    return {
        "status": status,
        "mode": "audit",
        "classification": classification,
        "database_mutations": 0,
        "database_readback": [],
    }


class RecoverySafetyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.original_report_root = MODULE.REPORT_ROOT
        MODULE.REPORT_ROOT = Path(self.temporary.name)
        self.operation_id = MODULE.deterministic_operation_id()

    def tearDown(self) -> None:
        MODULE.REPORT_ROOT = self.original_report_root
        self.temporary.cleanup()

    def create_ambiguous_pending(self, not_before: float = 0) -> None:
        MODULE.update_pending(
            self.operation_id,
            "ambiguous_apply",
            remote_command_dispatched=True,
            recovery_not_before_epoch=not_before,
            no_apply_retry=True,
        )

    def test_operation_id_and_backup_path_are_stable_and_pinned(self) -> None:
        first = MODULE.deterministic_operation_id()
        second = MODULE.deterministic_operation_id()
        self.assertEqual(first, second)
        self.assertRegex(first, r"^bitrix-prices-[a-f0-9]{24}$")
        self.assertEqual(
            MODULE.expected_backup_path(first),
            f"{MODULE.REMOTE_BACKUP_ROOT}/{first}-prices.json",
        )

    def test_receipt_sanitizer_drops_names_and_modified_user(self) -> None:
        safe = MODULE.sanitize_remote(
            {
                "status": "ok",
                "classification": "all_old",
                "database_readback": [
                    {
                        "product_id": 755,
                        "offer_id": 764,
                        "slug": "standart-plus-1-5-litra",
                        "state": "all_old",
                        "effective_price": 1_300_000,
                        "product": {"name": "private", "modified_by": 99},
                    }
                ],
            }
        )
        encoded = json.dumps(safe)
        self.assertNotIn("private", encoded)
        self.assertNotIn("modified_by", encoded)
        self.assertIn("standart-plus-1-5-litra", encoded)

    def test_backup_marker_is_reduced_to_non_secret_evidence(self) -> None:
        digest = "a" * 64
        evidence = MODULE.backup_marker_evidence(
            f"STAGE:bootstrap\nSTAGE:backup-written:{self.operation_id}:{digest}\n",
            self.operation_id,
        )
        self.assertTrue(evidence["backup_marker_observed"])
        self.assertEqual(evidence["backup_sha256_observed"], digest)
        self.assertEqual(
            evidence["expected_backup_path"],
            MODULE.expected_backup_path(self.operation_id),
        )

    def test_recovery_mapping_is_fail_closed(self) -> None:
        public_ok = {"ok": True}
        public_bad = {"ok": False}
        self.assertEqual(
            MODULE.recovery_outcome(remote_state("all_old"), public_ok),
            "recovered_noop",
        )
        self.assertEqual(
            MODULE.recovery_outcome(remote_state("all_new"), public_ok),
            "recovered_success",
        )
        self.assertEqual(
            MODULE.recovery_outcome(remote_state("transition_mixed"), public_ok),
            "needs_rollback",
        )
        self.assertEqual(
            MODULE.recovery_outcome(remote_state("drift"), public_ok),
            "blocked",
        )
        self.assertEqual(
            MODULE.recovery_outcome(remote_state("all_new"), public_bad),
            "indeterminate",
        )

    def test_all_old_and_public_old_is_recovered_noop_non_success(self) -> None:
        self.create_ambiguous_pending()
        execute = Mock(return_value=remote_state("all_old"))
        verify = Mock(return_value={"ok": True, "proof": "old"})
        result, exit_code = MODULE.recover_operation(
            self.operation_id,
            time_fn=lambda: 1000,
            sleep_fn=Mock(),
            execute_fn=execute,
            verify_fn=verify,
        )
        self.assertEqual(result["status"], "recovered_noop")
        self.assertEqual(exit_code, 1)
        execute.assert_called_once_with("audit")
        verify.assert_called_once()

    def test_all_new_and_public_new_is_recovered_success(self) -> None:
        self.create_ambiguous_pending()
        execute = Mock(return_value=remote_state("all_new"))
        result, exit_code = MODULE.recover_operation(
            self.operation_id,
            time_fn=lambda: 1000,
            sleep_fn=Mock(),
            execute_fn=execute,
            verify_fn=Mock(return_value={"ok": True, "proof": "new"}),
        )
        self.assertEqual(result["status"], "recovered_success")
        self.assertEqual(exit_code, 0)
        execute.assert_called_once_with("audit")

    def test_mixed_needs_rollback_without_automatic_rollback(self) -> None:
        self.create_ambiguous_pending()
        execute = Mock(return_value=remote_state("transition_mixed"))
        verify = Mock()
        result, exit_code = MODULE.recover_operation(
            self.operation_id,
            time_fn=lambda: 1000,
            sleep_fn=Mock(),
            execute_fn=execute,
            verify_fn=verify,
        )
        self.assertEqual(result["status"], "needs_rollback")
        self.assertEqual(exit_code, 1)
        self.assertFalse(result["automatic_rollback"])
        verify.assert_not_called()

    def test_drift_is_blocked(self) -> None:
        self.create_ambiguous_pending()
        result, exit_code = MODULE.recover_operation(
            self.operation_id,
            time_fn=lambda: 1000,
            sleep_fn=Mock(),
            execute_fn=Mock(return_value=remote_state("drift")),
            verify_fn=Mock(),
        )
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(exit_code, 1)

    def test_public_mismatch_uses_at_most_three_read_only_audits(self) -> None:
        self.create_ambiguous_pending()
        execute = Mock(return_value=remote_state("all_new"))
        sleeper = Mock()
        result, exit_code = MODULE.recover_operation(
            self.operation_id,
            time_fn=lambda: 1000,
            sleep_fn=sleeper,
            execute_fn=execute,
            verify_fn=Mock(return_value={"ok": False}),
        )
        self.assertEqual(result["status"], "indeterminate")
        self.assertEqual(exit_code, 1)
        self.assertEqual(execute.call_count, 3)
        self.assertTrue(all(call.args == ("audit",) for call in execute.call_args_list))
        self.assertEqual(sleeper.call_count, 2)

    def test_recovery_before_settle_does_not_contact_remote(self) -> None:
        self.create_ambiguous_pending(not_before=1165)
        execute = Mock()
        result, exit_code = MODULE.recover_operation(
            self.operation_id,
            time_fn=lambda: 1000,
            sleep_fn=Mock(),
            execute_fn=execute,
            verify_fn=Mock(),
        )
        self.assertEqual(result["status"], "settling")
        self.assertEqual(result["retry_after_seconds"], 165)
        self.assertEqual(exit_code, 1)
        execute.assert_not_called()

    def test_ambiguous_apply_creates_pending_and_never_retries_apply(self) -> None:
        def execute(mode: str, **kwargs: object) -> dict[str, object]:
            self.assertEqual(mode, "apply")
            callback = kwargs["on_dispatched"]
            assert callable(callback)
            callback()
            raise MODULE.RemoteOperationFailure(
                "connection lost",
                mode="apply",
                operation_id=self.operation_id,
                stderr="STAGE:backup-written",
                command_dispatched=True,
            )

        result, exit_code = MODULE.run_apply(
            time_fn=lambda: 1000,
            execute_fn=execute,
            verify_fn=Mock(),
        )
        self.assertEqual(result["status"], "ambiguous_apply")
        self.assertEqual(exit_code, 1)
        pending = MODULE.read_pending(self.operation_id)
        assert pending is not None
        self.assertEqual(pending["state"], "ambiguous_apply")
        self.assertTrue(pending["no_apply_retry"])

    def test_elapsed_ambiguous_apply_recovers_only_with_audit(self) -> None:
        calls: list[str] = []
        clock = iter([1000.0, 1000.0, 1200.0, 1200.0])

        def execute(mode: str, **kwargs: object) -> dict[str, object]:
            calls.append(mode)
            if mode == "apply":
                callback = kwargs["on_dispatched"]
                assert callable(callback)
                callback()
                raise MODULE.RemoteOperationFailure(
                    "late channel loss",
                    mode="apply",
                    operation_id=self.operation_id,
                    command_dispatched=True,
                )
            return remote_state("all_new")

        result, exit_code = MODULE.run_apply(
            time_fn=lambda: next(clock),
            execute_fn=execute,
            verify_fn=Mock(return_value={"ok": True}),
        )
        self.assertEqual(result["status"], "recovered_success")
        self.assertEqual(exit_code, 0)
        self.assertEqual(calls, ["apply", "audit"])

    def test_unresolved_pending_blocks_a_second_apply(self) -> None:
        self.create_ambiguous_pending()
        execute = Mock()
        result, exit_code = MODULE.run_apply(execute_fn=execute)
        self.assertEqual(result["status"], "blocked_pending_recovery")
        self.assertEqual(exit_code, 1)
        execute.assert_not_called()


class TransportEvidenceTests(unittest.TestCase):
    def test_exec_request_exception_is_conservatively_ambiguous(self) -> None:
        client = Mock()
        client.exec_command.side_effect = EOFError("lost during exec request")
        with self.assertRaises(MODULE.RemoteCommandFailure) as caught:
            MODULE.run_remote_command(client, "safe", 1)
        self.assertTrue(caught.exception.command_dispatched)

    def test_partial_output_survives_transport_exception(self) -> None:
        class Channel:
            def __init__(self) -> None:
                self.read = False

            def recv_ready(self) -> bool:
                return not self.read

            def recv(self, _size: int) -> bytes:
                self.read = True
                return b'{"status":"ok","classification":"all_new"}\n'

            def recv_stderr_ready(self) -> bool:
                return False

            def exit_status_ready(self) -> bool:
                raise EOFError("lost")

        channel = Channel()
        stdout = Mock(channel=channel)
        client = Mock()
        client.exec_command.return_value = (Mock(), stdout, Mock())
        with self.assertRaises(MODULE.RemoteCommandFailure) as caught:
            MODULE.run_remote_command(client, "safe", 1)
        self.assertTrue(caught.exception.command_dispatched)
        self.assertIn('"classification":"all_new"', caught.exception.stdout)

    def test_execute_remote_preserves_partial_json_payload(self) -> None:
        partial = '{"status":"ok","classification":"all_new"}'
        client = Mock()
        with patch.object(MODULE, "connect", return_value=client), patch.object(
            MODULE,
            "run_remote_command",
            side_effect=MODULE.RemoteCommandFailure(
                "lost",
                stdout=partial,
                stderr="STAGE:backup-written",
                command_dispatched=True,
            ),
        ):
            with self.assertRaises(MODULE.RemoteOperationFailure) as caught:
                MODULE.execute_remote(
                    "apply", operation_id=MODULE.deterministic_operation_id()
                )
        self.assertEqual(
            caught.exception.partial_payload,
            {"status": "ok", "classification": "all_new"},
        )
        self.assertTrue(caught.exception.ambiguous_apply)


class PhpContractTests(unittest.TestCase):
    def test_php_contract_has_four_states_and_preflight_before_backup(self) -> None:
        source = Path(__file__).with_name("bitrix-product-prices.php").read_text(
            encoding="utf-8"
        )
        for state in ("all_old", "all_new", "transition_mixed", "drift"):
            self.assertIn(f"'{state}'", source)
        preflight = source.index("if ($classification !== 'all_old')")
        backup = source.index("rosomahaPricesWriteBackup((string) $operationId")
        first_mutation = source.index("rosomahaPricesSetElement(", backup)
        self.assertLess(preflight, backup)
        self.assertLess(backup, first_mutation)
        self.assertIn("$operationId . '-prices.json'", source)


if __name__ == "__main__":
    unittest.main()
