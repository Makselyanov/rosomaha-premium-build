from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Mapping


MODULE_PATH = Path(__file__).with_name("yandex-direct-rosomaha-rus-measurement.py")
SPEC = importlib.util.spec_from_file_location("yandex_direct_rosomaha_rus_measurement", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
operator = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = operator
SPEC.loader.exec_module(operator)


def canonical_campaign(
    *,
    status: str = "DRAFT",
    state: str = "OFF",
    campaign_type: str = "UNIFIED_CAMPAIGN",
    counter_ids: list[int] | None = None,
    goals: list[dict[str, Any]] | None = None,
    package: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "Id": operator.TARGET_CAMPAIGN_ID,
        "Name": "S | RF | rosomaha-rus.ru",
        "Status": status,
        "State": state,
        "Type": campaign_type,
        "StartDate": "2026-08-24",
        "EndDate": None,
        "StatusPayment": "ALLOWED",
        "StatusClarification": None,
        "ClientInfo": operator.EXPECTED_LOGIN,
        "SourceId": None,
        "Currency": "RUB",
        "DailyBudget": None,
        "NegativeKeywords": {"Items": ["бесплатно"]},
        "BlockedIps": None,
        "ExcludedSites": None,
        "Notification": None,
        "TimeTargeting": {"Schedule": {"Items": ["1,100"]}},
        "TimeZone": "Asia/Yekaterinburg",
        "RepresentedBy": {"Manager": None, "Agency": None},
        "UnifiedCampaign": {
            "CounterIds": None if counter_ids is None else {"Items": list(counter_ids)},
            "PriorityGoals": None if goals is None else {"Items": copy.deepcopy(goals)},
            "BiddingStrategy": {"Search": {"BiddingStrategyType": "WB_MAXIMUM_CLICKS"}},
            "PackageBiddingStrategy": copy.deepcopy(package),
            "AttributionModel": "AUTO",
            "TrackingParams": None,
            "Settings": [],
        },
    }


def legacy_campaign(source: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "Id": source["Id"],
        "Name": source["Name"],
        "Status": source["Status"],
        "State": source["State"],
        "Type": "TEXT_CAMPAIGN",
        "StartDate": source["StartDate"],
        "EndDate": source["EndDate"],
        "StatusPayment": source["StatusPayment"],
        "StatusClarification": source["StatusClarification"],
        "ClientInfo": source["ClientInfo"],
        "TextCampaign": copy.deepcopy(source["UnifiedCampaign"]),
    }


def protected_campaign(campaign_id: int) -> dict[str, Any]:
    return {
        "Id": campaign_id,
        "Name": f"protected-{campaign_id}",
        "Status": "ACCEPTED",
        "State": "OFF",
        "Type": "UNIFIED_CAMPAIGN",
        "StartDate": "2026-01-01",
        "EndDate": None,
        "StatusPayment": "ALLOWED",
        "StatusClarification": None,
        "ClientInfo": operator.EXPECTED_LOGIN,
        "UnifiedCampaign": {
            "CounterIds": {"Items": [107139619]},
            "PriorityGoals": None,
            "BiddingStrategy": {"Search": {"BiddingStrategyType": "WB_MAXIMUM_CLICKS"}},
            "PackageBiddingStrategy": None,
            "AttributionModel": "AUTO",
            "TrackingParams": None,
            "Settings": [],
        },
    }


def five_ads(*, duplicate: bool = False) -> list[dict[str, Any]]:
    first = 9_007_199_254_740_993
    ids = [first + index for index in range(operator.EXPECTED_AD_COUNT)]
    if duplicate:
        ids[-1] = ids[0]
    return [
        {
            "Id": ad_id,
            "CampaignId": operator.TARGET_CAMPAIGN_ID,
            "AdGroupId": 8_000_000_000_000_000 + index,
            "Status": "DRAFT",
            "State": "OFF",
            "StatusClarification": None,
            "Type": "TEXT_AD",
            "Subtype": "RESPONSIVE_AD",
            "ResponsiveAd": {
                "Titles": [{"Title": f"Росомаха {index + 1}", "Status": "DRAFT"}],
                "Texts": [{"Text": "Вездеход от производителя", "Status": "DRAFT"}],
                "Mobile": "NO",
                "Href": f"https://rosomaha-rus.ru/product/model-{index + 1}/?utm_source=yandex",
                "DisplayDomain": "rosomaha-rus.ru",
                "DisplayUrlPath": f"model-{index + 1}",
                "AdImages": {
                    "Items": [{"ImageHash": f"image-hash-{index + 1}", "Status": "DRAFT"}]
                },
                "SitelinkSetId": 7_000_000_000_000_000 + index,
                "AdExtensions": [],
                "BusinessId": None,
            },
        }
        for index, ad_id in enumerate(ids)
    ]


def adgroups_from_ads(ads: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "Id": ad["AdGroupId"],
            "Name": f"group-{index + 1}",
            "CampaignId": operator.TARGET_CAMPAIGN_ID,
            "Status": "ACCEPTED",
            "ServingStatus": "ELIGIBLE",
            "Type": "TEXT_AD_GROUP",
            "NegativeKeywords": {"Items": []},
        }
        for index, ad in enumerate(ads)
    ]


def keywords_from_ads(ads: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for index, ad in enumerate(ads):
        for offset, phrase in enumerate(
            (f"+росомаха +модель {index + 1}", "---autotargeting")
        ):
            result.append(
                {
                    "Id": 6_000_000_000_000_000 + index * 2 + offset,
                    "Keyword": phrase,
                    "AdGroupId": ad["AdGroupId"],
                    "CampaignId": operator.TARGET_CAMPAIGN_ID,
                    "State": "ON",
                    "Status": "ACCEPTED",
                    "ServingStatus": "ELIGIBLE",
                    "AutotargetingCategories": (
                        {"Items": ["EXACT"]} if phrase == "---autotargeting" else None
                    ),
                    "AutotargetingBrandOptions": (
                        {"Items": ["EXACT"]} if phrase == "---autotargeting" else None
                    ),
                }
            )
    return result


def sitelinks_from_ads(ads: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "Id": (ad.get("ResponsiveAd") or ad.get("TextAd"))["SitelinkSetId"],
            "Sitelinks": [
                {
                    "Title": f"Ссылка {index + 1}",
                    "Href": f"https://rosomaha-rus.ru/product/model-{index + 1}/",
                    "Description": None,
                    "TurboPageId": None,
                }
            ],
        }
        for index, ad in enumerate(ads)
    ]


class FakeLockPolicy:
    def __init__(self) -> None:
        self.hold_count = 0

    @contextmanager
    def hold(self):
        self.hold_count += 1
        evidence = {
            "path": "fake-mutation.lock",
            "atomic_create": True,
            "browser_locks_checked": ["client-rosomaha.lock", "rosomaha-yandex.lock"],
            "released": False,
        }
        try:
            yield evidence
        finally:
            evidence["released"] = True


class FakeApi:
    def __init__(
        self,
        *,
        campaign: dict[str, Any] | None = None,
        ads: list[dict[str, Any]] | None = None,
        identity_login: str = operator.EXPECTED_LOGIN,
    ) -> None:
        self.campaign = copy.deepcopy(campaign or canonical_campaign())
        self.ads = copy.deepcopy(ads or five_ads())
        self.adgroups = adgroups_from_ads(self.ads)
        self.keywords = keywords_from_ads(self.ads)
        self.sitelinks = sitelinks_from_ads(self.ads)
        self.identity_login = identity_login
        self.protected = {
            campaign_id: protected_campaign(campaign_id)
            for campaign_id in operator.PROTECTED_CAMPAIGN_IDS
        }
        self.request_log: list[dict[str, Any]] = []
        self.mutation_requests = 0
        self.update_payloads: list[dict[str, Any]] = []
        self.moderate_payloads: list[dict[str, Any]] = []
        self.glitch_next_target_read_after_update = False
        self._glitch_armed = False
        self.raise_after_update_commit = False
        self.raise_after_update_unknown = False
        self.raise_before_update_commit = False
        self.update_warning = False

    def call(
        self,
        version: str,
        service: str,
        method: str,
        params: Mapping[str, Any],
        *,
        use_client_login: bool,
        mutation_kind: str | None = None,
    ) -> dict[str, Any]:
        operator._assert_request_contract(
            version,
            service,
            method,
            params,
            use_client_login=use_client_login,
            mutation_kind=mutation_kind,
        )
        self.request_log.append(
            {
                "version": version,
                "service": service,
                "method": method,
                "mutation_kind": mutation_kind,
            }
        )
        if mutation_kind is not None:
            self.mutation_requests += 1

        if (service, method) == ("clients", "get"):
            return {
                "Clients": [
                    {
                        "ClientId": 123456789012345678,
                        "Login": self.identity_login,
                        "Type": "CLIENT",
                        "Archived": "NO",
                        "AvailableCampaignTypes": ["UNIFIED_CAMPAIGN"],
                    }
                ]
            }

        if (service, method) == ("campaigns", "get"):
            ids = params["SelectionCriteria"]["Ids"]
            if ids == [operator.TARGET_CAMPAIGN_ID]:
                source = copy.deepcopy(self.campaign)
                if version == operator.LEGACY_API_VERSION:
                    return {"Campaigns": [legacy_campaign(source)]}
                if self._glitch_armed:
                    self._glitch_armed = False
                    source["UnifiedCampaign"]["CounterIds"] = {"Items": [999999]}
                return {"Campaigns": [source]}
            return {
                "Campaigns": [
                    copy.deepcopy(self.protected[campaign_id])
                    for campaign_id in reversed(ids)
                ]
            }

        if (service, method) == ("campaigns", "update"):
            payload = copy.deepcopy(dict(params))
            self.update_payloads.append(payload)
            if self.raise_before_update_commit:
                self.raise_before_update_commit = False
                raise operator.ProviderError("simulated timeout before commit")
            unified = payload["Campaigns"][0]["UnifiedCampaign"]
            if "CounterIds" in unified:
                counters = unified["CounterIds"]
                self.campaign["UnifiedCampaign"]["CounterIds"] = (
                    None if counters is None else {"Items": list(counters["Items"])}
                )
            if "PriorityGoals" in unified:
                goals = unified["PriorityGoals"]
                if goals is None:
                    self.campaign["UnifiedCampaign"]["PriorityGoals"] = None
                else:
                    self.campaign["UnifiedCampaign"]["PriorityGoals"] = {
                        "Items": [
                            {key: value for key, value in item.items() if key != "Operation"}
                            for item in goals["Items"]
                        ]
                    }
            if self.glitch_next_target_read_after_update and mutation_kind in {
                "apply_counter",
                "apply_measurement",
            }:
                self._glitch_armed = True
                self.glitch_next_target_read_after_update = False
            if self.raise_after_update_unknown:
                self.raise_after_update_unknown = False
                self.campaign["UnifiedCampaign"]["CounterIds"] = {"Items": [424242]}
                raise operator.ProviderError("simulated timeout with unknown state")
            if self.raise_after_update_commit:
                self.raise_after_update_commit = False
                raise operator.ProviderError("simulated lost response after commit")
            row: dict[str, Any] = {"Id": operator.TARGET_CAMPAIGN_ID}
            if self.update_warning:
                row["Warnings"] = [{"Code": 999, "Message": "simulated warning"}]
                self.update_warning = False
            return {"UpdateResults": [row]}

        if (service, method) == ("ads", "get"):
            return {"Ads": copy.deepcopy(self.ads)}

        if (service, method) == ("adgroups", "get"):
            return {"AdGroups": copy.deepcopy(self.adgroups)}

        if (service, method) == ("keywords", "get"):
            return {"Keywords": copy.deepcopy(self.keywords)}

        if (service, method) == ("sitelinks", "get"):
            return {"SitelinksSets": copy.deepcopy(self.sitelinks)}

        if (service, method) == ("ads", "moderate"):
            payload = copy.deepcopy(dict(params))
            self.moderate_payloads.append(payload)
            selected = payload["SelectionCriteria"]["Ids"]
            for ad in self.ads:
                if ad["Id"] in selected:
                    ad["Status"] = "MODERATION"
                    if "ResponsiveAd" in ad:
                        for title in ad["ResponsiveAd"].get("Titles", []):
                            title["Status"] = "MODERATION"
                        for text in ad["ResponsiveAd"].get("Texts", []):
                            text["Status"] = "MODERATION"
                        for image in ad["ResponsiveAd"].get("AdImages", {}).get("Items", []):
                            image["Status"] = "MODERATION"
            self.campaign["Status"] = "MODERATION"
            return {"ModerateResults": [{"Id": ad_id} for ad_id in selected]}

        raise AssertionError((version, service, method))


def write_evidence(directory: Path, value: int = 250_000_000) -> Any:
    payload = {
        "schema": operator.EVIDENCE_SCHEMA,
        "account_login": operator.EXPECTED_LOGIN,
        "campaign_id": operator.TARGET_CAMPAIGN_ID,
        "counter_id": operator.TARGET_COUNTER_ID,
        "goal_id": operator.HARD_GOAL_ID,
        "value_micros": value,
        "approved": True,
        "source": "owner-approved-unit-economics",
        "owner": operator.EVIDENCE_OWNER,
        "currency": "RUB",
        "calculation": {
            "description": "Подтверждённая владельцем денежная ценность CRM-сделки",
            "result_micros": value,
        },
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    path = directory / f"goal-value-{value}.json"
    path.write_bytes(raw)
    digest = hashlib.sha256(raw).hexdigest()
    return operator.load_goal_value_evidence(
        path,
        expected_sha256=digest,
        expected_value_micros=value,
    )


def measurement_env(evidence: Any) -> dict[str, str]:
    return {
        operator.APPLY_GUARD_ENV: operator.APPLY_GUARD_VALUE,
        operator.VALUE_GUARD_ENV: str(evidence.value_micros),
        operator.EVIDENCE_GUARD_ENV: evidence.sha256,
    }


def bundle_hash(api: FakeApi) -> str:
    return operator.sha256_json(operator.read_moderation_bundle(api))


class DirectMeasurementOperatorTests(unittest.TestCase):
    def setUp(self):
        root = operator.PROJECT_ROOT / ".local-artifacts"
        root.mkdir(parents=True, exist_ok=True)
        self._temp = tempfile.TemporaryDirectory(dir=root)
        self.evidence_dir = Path(self._temp.name)

    def tearDown(self):
        self._temp.cleanup()

    def evidence(self, value: int = 250_000_000):
        return write_evidence(self.evidence_dir, value)

    def test_audit_and_both_dry_runs_are_read_only(self):
        api = FakeApi()
        audit = operator.run_operation(api, "audit")
        self.assertEqual(audit["status"], "ok")
        self.assertEqual(audit["canonical_campaign"]["type"], "UNIFIED_CAMPAIGN")
        self.assertEqual(audit["legacy_v5_view"]["type"], "TEXT_CAMPAIGN")
        self.assertEqual(api.mutation_requests, 0)

        dry_counter = operator.run_operation(api, "dry-run", dry_run_action="apply-counter")
        self.assertEqual(dry_counter["status"], "ready")
        dry_measurement = operator.run_operation(
            api,
            "dry-run",
            dry_run_action="apply-measurement",
            evidence=self.evidence(),
        )
        self.assertEqual(dry_measurement["planned_measurement"]["CounterIds"], [111905412])
        dry_moderate = operator.run_operation(api, "dry-run", dry_run_action="moderate")
        self.assertEqual(len(dry_moderate["planned_ad_ids"]), 5)
        self.assertEqual(api.mutation_requests, 0)

    def test_apply_counter_updates_only_counter_and_preserves_goal(self):
        existing_goals = [{"GoalId": 999, "Value": 5_000_000}]
        api = FakeApi(campaign=canonical_campaign(counter_ids=[], goals=existing_goals))
        expected = operator.sha256_json(api.campaign)
        receipt = operator.run_operation(
            api,
            "apply-counter",
            expected_campaign_sha256=expected,
            environ={operator.COUNTER_GUARD_ENV: operator.COUNTER_GUARD_VALUE},
            lock_policy=FakeLockPolicy(),
        )
        self.assertEqual(receipt["status"], "applied")
        self.assertEqual(api.mutation_requests, 1)
        unified = api.update_payloads[0]["Campaigns"][0]["UnifiedCampaign"]
        self.assertEqual(set(unified), {"CounterIds"})
        self.assertEqual(unified["CounterIds"]["Items"], [operator.TARGET_COUNTER_ID])
        self.assertEqual(api.campaign["UnifiedCampaign"]["PriorityGoals"]["Items"], existing_goals)

    def test_apply_measurement_uses_exact_counter_goal_and_explicit_big_value(self):
        value = 9_007_199_254_740_993
        api = FakeApi()
        expected = operator.sha256_json(api.campaign)
        proof = self.evidence(value)
        receipt = operator.run_operation(
            api,
            "apply-measurement",
            evidence=proof,
            expected_campaign_sha256=expected,
            environ=measurement_env(proof),
            lock_policy=FakeLockPolicy(),
        )
        self.assertEqual(receipt["status"], "applied")
        update = api.update_payloads[0]["Campaigns"][0]
        self.assertEqual(set(update), {"Id", "UnifiedCampaign"})
        self.assertNotIn("TextCampaign", update)
        goal = update["UnifiedCampaign"]["PriorityGoals"]["Items"][0]
        self.assertEqual(goal["GoalId"], operator.HARD_GOAL_ID)
        self.assertEqual(goal["Value"], value)
        self.assertIsInstance(goal["Value"], int)

    def test_identity_mismatch_blocks_before_mutation(self):
        api = FakeApi(identity_login="foreign-login")
        with self.assertRaisesRegex(operator.OperatorError, "OAuth identity"):
            operator.run_operation(api, "audit")
        self.assertEqual(api.mutation_requests, 0)

    def test_protected_campaign_id_is_rejected_by_transport_scope(self):
        payload = operator.counter_update()
        payload["Campaigns"][0]["Id"] = operator.PROTECTED_CAMPAIGN_IDS[0]
        with self.assertRaisesRegex(operator.OperatorError, "Защищённая"):
            operator._assert_request_contract(
                operator.CANONICAL_API_VERSION,
                "campaigns",
                "update",
                payload,
                use_client_login=True,
                mutation_kind="apply_counter",
            )

    def test_missing_each_mutation_guard_blocks_without_write(self):
        api = FakeApi()
        with self.assertRaisesRegex(operator.OperatorError, "mutation guard"):
            operator.run_operation(
                api,
                "apply-counter",
                expected_campaign_sha256=operator.sha256_json(api.campaign),
                environ={},
                lock_policy=FakeLockPolicy(),
            )
        self.assertEqual(api.mutation_requests, 0)

        api2 = FakeApi()
        proof = self.evidence()
        with self.assertRaisesRegex(operator.OperatorError, "value guard"):
            operator.run_operation(
                api2,
                "apply-measurement",
                evidence=proof,
                expected_campaign_sha256=operator.sha256_json(api2.campaign),
                environ={
                    operator.APPLY_GUARD_ENV: operator.APPLY_GUARD_VALUE,
                    operator.EVIDENCE_GUARD_ENV: proof.sha256,
                },
                lock_policy=FakeLockPolicy(),
            )
        self.assertEqual(api2.mutation_requests, 0)

        api3 = FakeApi()
        with self.assertRaisesRegex(operator.OperatorError, "mutation guard"):
            operator.run_operation(
                api3,
                "moderate",
                expected_campaign_sha256=operator.sha256_json(api3.campaign),
                expected_ads_sha256=bundle_hash(api3),
                environ={},
                lock_policy=FakeLockPolicy(),
            )
        self.assertEqual(api3.mutation_requests, 0)

    def test_bigint_ads_are_not_rounded_during_moderation(self):
        api = FakeApi()
        expected_campaign = operator.sha256_json(api.campaign)
        expected_ads = bundle_hash(api)
        receipt = operator.run_operation(
            api,
            "moderate",
            expected_campaign_sha256=expected_campaign,
            expected_ads_sha256=expected_ads,
            environ={operator.MODERATE_GUARD_ENV: operator.MODERATE_GUARD_VALUE},
            lock_policy=FakeLockPolicy(),
        )
        sent_ids = api.moderate_payloads[0]["SelectionCriteria"]["Ids"]
        self.assertEqual(sent_ids[0], 9_007_199_254_740_993)
        self.assertEqual(len(set(sent_ids)), 5)
        self.assertEqual(receipt["status"], "submitted")
        self.assertEqual(receipt["post_campaign_state"], "OFF")

    def test_duplicate_ads_block_moderation(self):
        api = FakeApi(ads=five_ads(duplicate=True))
        with self.assertRaisesRegex(operator.OperatorError, "дубли ID"):
            operator.run_operation(api, "dry-run", dry_run_action="moderate")
        self.assertEqual(api.mutation_requests, 0)

    def test_non_draft_or_non_off_campaign_blocks_mutation(self):
        for kwargs in ({"status": "ACCEPTED"}, {"state": "ON"}):
            with self.subTest(kwargs=kwargs):
                api = FakeApi(campaign=canonical_campaign(**kwargs))
                with self.assertRaises(operator.OperatorError):
                    operator.run_operation(
                        api,
                        "apply-counter",
                        expected_campaign_sha256=operator.sha256_json(api.campaign),
                        environ={operator.COUNTER_GUARD_ENV: operator.COUNTER_GUARD_VALUE},
                        lock_policy=FakeLockPolicy(),
                    )
                self.assertEqual(api.mutation_requests, 0)

    def test_v501_type_mismatch_and_package_strategy_block_write(self):
        wrong_type = FakeApi(campaign=canonical_campaign(campaign_type="TEXT_CAMPAIGN"))
        with self.assertRaisesRegex(operator.OperatorError, "UNIFIED_CAMPAIGN"):
            operator.run_operation(wrong_type, "audit")
        packaged = FakeApi(campaign=canonical_campaign(package={"StrategyId": 123}))
        with self.assertRaisesRegex(operator.OperatorError, "пакетной стратегией"):
            operator.run_operation(packaged, "audit")

    def test_measurement_post_readback_failure_restores_exact_preimage(self):
        original_goals = [{"GoalId": 888, "Value": 77_000_000}]
        api = FakeApi(campaign=canonical_campaign(counter_ids=[123], goals=original_goals))
        api.glitch_next_target_read_after_update = True
        expected = operator.sha256_json(api.campaign)
        proof = self.evidence()
        with self.assertRaises(operator.OperatorError) as raised:
            operator.run_operation(
                api,
                "apply-measurement",
                evidence=proof,
                expected_campaign_sha256=expected,
                environ=measurement_env(proof),
                lock_policy=FakeLockPolicy(),
            )
        partial = raised.exception.partial
        self.assertEqual(partial["rollback"]["status"], "restored")
        self.assertEqual(api.mutation_requests, 2)
        self.assertEqual(api.campaign["UnifiedCampaign"]["CounterIds"]["Items"], [123])
        self.assertEqual(
            api.campaign["UnifiedCampaign"]["PriorityGoals"]["Items"],
            [{**original_goals[0], "IsMetrikaSourceOfValue": "NO"}],
        )
        self.assertTrue(partial["protected_unchanged"])

    def test_counter_post_readback_failure_restores_counter_only(self):
        original_goals = [{"GoalId": 888, "Value": 77_000_000}]
        api = FakeApi(campaign=canonical_campaign(counter_ids=[321], goals=original_goals))
        api.glitch_next_target_read_after_update = True
        expected = operator.sha256_json(api.campaign)
        with self.assertRaises(operator.OperatorError) as raised:
            operator.run_operation(
                api,
                "apply-counter",
                expected_campaign_sha256=expected,
                environ={operator.COUNTER_GUARD_ENV: operator.COUNTER_GUARD_VALUE},
                lock_policy=FakeLockPolicy(),
            )
        self.assertEqual(raised.exception.partial["rollback"]["status"], "restored")
        self.assertEqual(api.campaign["UnifiedCampaign"]["CounterIds"]["Items"], [321])
        self.assertEqual(api.campaign["UnifiedCampaign"]["PriorityGoals"]["Items"], original_goals)

    def test_v5_is_never_used_for_mutation(self):
        api = FakeApi()
        operator.run_operation(
            api,
            "apply-counter",
            expected_campaign_sha256=operator.sha256_json(api.campaign),
            environ={operator.COUNTER_GUARD_ENV: operator.COUNTER_GUARD_VALUE},
            lock_policy=FakeLockPolicy(),
        )
        mutations = [item for item in api.request_log if item["mutation_kind"]]
        self.assertEqual(len(mutations), 1)
        self.assertEqual(mutations[0]["version"], "v501")


if __name__ == "__main__":
    unittest.main()
