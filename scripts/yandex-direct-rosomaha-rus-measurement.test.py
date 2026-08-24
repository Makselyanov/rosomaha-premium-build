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


def five_ads_with_one_text_ad() -> list[dict[str, Any]]:
    ads = five_ads()
    responsive = ads[0].pop("ResponsiveAd")
    ads[0]["Type"] = "TEXT_AD"
    ads[0]["Subtype"] = "TEXT_AD"
    ads[0]["TextAd"] = {
        "AdImageHash": responsive["AdImages"]["Items"][0]["ImageHash"],
        "DisplayDomain": responsive["DisplayDomain"],
        "FinalUrl": None,
        "Href": responsive["Href"],
        "SitelinkSetId": responsive["SitelinkSetId"],
        "Text": responsive["Texts"][0]["Text"],
        "Title": responsive["Titles"][0]["Title"],
        "Title2": "От производителя",
        "Mobile": "NO",
        "VCardId": None,
        "DisplayUrlPath": responsive["DisplayUrlPath"],
        "AdExtensions": [],
        "VideoExtension": None,
        "TurboPageId": None,
        "BusinessId": None,
        "PreferVCardOverBusiness": "NO",
        "ErirAdDescription": None,
        "AutogeneratedErirAdDescription": None,
    }
    return ads


def adgroups_from_ads(ads: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "Id": ad["AdGroupId"],
            "Name": f"group-{index + 1}",
            "CampaignId": operator.TARGET_CAMPAIGN_ID,
            "Status": "ACCEPTED",
            "ServingStatus": "ELIGIBLE",
            "Type": "TEXT_AD_GROUP",
            "Subtype": "NONE",
            "RegionIds": {"Items": [225]},
            "RestrictedRegionIds": None,
            "NegativeKeywords": {"Items": []},
            "NegativeKeywordSharedSetIds": None,
            "TrackingParams": None,
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
                    "Bid": None,
                    "AutotargetingSearchBidIsAuto": "NO",
                    "ContextBid": None,
                    "StrategyPriority": "NORMAL",
                    "UserParam1": None,
                    "UserParam2": None,
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
        self.sitelinks_get_payloads: list[dict[str, Any]] = []
        self.glitch_next_target_read_after_update = False
        self._glitch_armed = False
        self.raise_after_update_commit = False
        self.raise_after_update_unknown = False
        self.raise_before_update_commit = False
        self.update_warning = False
        self.change_campaign_outside_measurement_after_update = False
        self.raise_after_moderate_commit = False
        self.raise_after_moderate_unknown = False
        self.raise_before_moderate_commit = False
        self.moderate_warning = False

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
            protected = [
                copy.deepcopy(self.protected[campaign_id])
                for campaign_id in reversed(ids)
            ]
            if version == operator.LEGACY_API_VERSION:
                protected = [legacy_campaign(item) for item in protected]
            return {"Campaigns": protected}

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
            if self.change_campaign_outside_measurement_after_update:
                self.change_campaign_outside_measurement_after_update = False
                self.campaign["DailyBudget"] = {
                    "Amount": 999_000_000,
                    "Mode": "STANDARD",
                }
            row: dict[str, Any] = {"Id": operator.TARGET_CAMPAIGN_ID}
            if self.update_warning:
                row["Warnings"] = [{"Code": 999, "Message": "simulated warning"}]
                self.update_warning = False
            return {"UpdateResults": [row]}

        if (service, method) == ("ads", "get"):
            ads = copy.deepcopy(self.ads)
            text_fields = set(params.get("TextAdFieldNames", []))
            responsive_fields = set(params.get("ResponsiveAdFieldNames", []))
            for ad in ads:
                if "TextAd" in ad and text_fields:
                    ad["TextAd"] = {
                        key: value for key, value in ad["TextAd"].items() if key in text_fields
                    }
                if "ResponsiveAd" in ad and responsive_fields:
                    ad["ResponsiveAd"] = {
                        key: value
                        for key, value in ad["ResponsiveAd"].items()
                        if key in responsive_fields
                    }
                if not text_fields:
                    ad.pop("TextAd", None)
                if not responsive_fields:
                    ad.pop("ResponsiveAd", None)
            return {"Ads": ads}

        if (service, method) == ("adgroups", "get"):
            return {"AdGroups": copy.deepcopy(self.adgroups)}

        if (service, method) == ("keywords", "get"):
            return {"Keywords": copy.deepcopy(self.keywords)}

        if (service, method) == ("sitelinks", "get"):
            self.sitelinks_get_payloads.append(copy.deepcopy(dict(params)))
            selected = set(params["SelectionCriteria"]["Ids"])
            return {
                "SitelinksSets": [
                    copy.deepcopy(item) for item in self.sitelinks if item["Id"] in selected
                ]
            }

        if (service, method) == ("ads", "moderate"):
            payload = copy.deepcopy(dict(params))
            self.moderate_payloads.append(payload)
            if self.raise_before_moderate_commit:
                self.raise_before_moderate_commit = False
                raise operator.ProviderError("simulated moderation timeout before commit")
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
            if self.raise_after_moderate_unknown:
                self.raise_after_moderate_unknown = False
                self.ads[0]["ResponsiveAd"]["Href"] = "https://unexpected.example/"
                raise operator.ProviderError("simulated moderation timeout with unknown state")
            if self.raise_after_moderate_commit:
                self.raise_after_moderate_commit = False
                raise operator.ProviderError("simulated moderation lost response after commit")
            rows = [{"Id": ad_id} for ad_id in selected]
            if self.moderate_warning:
                self.moderate_warning = False
                rows[0]["Warnings"] = [{"Code": 998, "Message": "simulated warning"}]
            return {"ModerateResults": rows}

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

    def test_existing_exact_counter_is_idempotent_for_audit_dry_run_and_apply(self):
        api = FakeApi(
            campaign=canonical_campaign(counter_ids=[operator.TARGET_COUNTER_ID])
        )
        first_audit = operator.run_operation(api, "audit")
        second_audit = operator.run_operation(api, "audit")
        self.assertEqual(
            first_audit["canonical_campaign"]["measurement"],
            second_audit["canonical_campaign"]["measurement"],
        )
        for _ in range(2):
            dry = operator.run_operation(
                api,
                "dry-run",
                dry_run_action="apply-counter",
            )
            self.assertEqual(dry["status"], "ready")
        applied = operator.run_operation(
            api,
            "apply-counter",
            expected_campaign_sha256=operator.sha256_json(api.campaign),
            environ={operator.COUNTER_GUARD_ENV: operator.COUNTER_GUARD_VALUE},
            lock_policy=FakeLockPolicy(),
        )
        self.assertEqual(applied["status"], "already_exact")
        self.assertEqual(api.mutation_requests, 0)
        self.assertEqual(api.update_payloads, [])

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

    def test_real_lock_policy_checks_both_browser_locks_and_is_atomic(self):
        lock_root = self.evidence_dir / "locks"
        lock_root.mkdir()
        browser_locks = (
            lock_root / "client-rosomaha.lock",
            lock_root / "rosomaha-yandex.lock",
        )
        mutation_lock = lock_root / "campaign-713802902.mutation.lock"
        policy = operator.MutationLockPolicy(
            browser_locks=browser_locks,
            mutation_lock=mutation_lock,
        )
        self.assertEqual(
            tuple(path.name for path in operator.BROWSER_LOCK_PATHS),
            ("client-rosomaha.lock", "rosomaha-yandex.lock"),
        )
        for browser_lock in browser_locks:
            with self.subTest(browser_lock=browser_lock.name):
                browser_lock.write_text("owned", encoding="utf-8")
                with self.assertRaisesRegex(operator.OperatorError, "owner/browser lock"):
                    with policy.hold():
                        self.fail("browser lock должен блокировать mutation lock")
                browser_lock.unlink()
                self.assertFalse(mutation_lock.exists())

        with policy.hold() as lease:
            self.assertTrue(mutation_lock.exists())
            competitor = operator.MutationLockPolicy(
                browser_locks=browser_locks,
                mutation_lock=mutation_lock,
            )
            with self.assertRaisesRegex(operator.OperatorError, "уже занят"):
                with competitor.hold():
                    self.fail("O_EXCL должен исключить второго владельца")
        self.assertTrue(lease["released"])
        self.assertFalse(mutation_lock.exists())

    def test_audit_and_dry_run_never_acquire_mutation_lock(self):
        lock = FakeLockPolicy()
        api = FakeApi()
        operator.run_operation(api, "audit", lock_policy=lock)
        operator.run_operation(
            api,
            "dry-run",
            dry_run_action="apply-counter",
            lock_policy=lock,
        )
        operator.run_operation(
            api,
            "dry-run",
            dry_run_action="moderate",
            lock_policy=lock,
        )
        self.assertEqual(lock.hold_count, 0)
        self.assertEqual(api.mutation_requests, 0)

    def test_lost_update_response_rolls_back_exact_candidate(self):
        baseline = canonical_campaign(counter_ids=[123])
        api = FakeApi(campaign=baseline)
        api.raise_after_update_commit = True
        with self.assertRaises(operator.OperatorError) as raised:
            operator.run_operation(
                api,
                "apply-counter",
                expected_campaign_sha256=operator.sha256_json(baseline),
                environ={operator.COUNTER_GUARD_ENV: operator.COUNTER_GUARD_VALUE},
                lock_policy=FakeLockPolicy(),
            )
        self.assertTrue(raised.exception.partial["mutation_started"])
        self.assertEqual(raised.exception.partial["rollback"]["status"], "restored")
        self.assertEqual(api.campaign, baseline)
        self.assertEqual(api.mutation_requests, 2)

    def test_timeout_before_commit_reads_baseline_and_does_not_restore(self):
        baseline = canonical_campaign(counter_ids=[123])
        api = FakeApi(campaign=baseline)
        api.raise_before_update_commit = True
        with self.assertRaises(operator.OperatorError) as raised:
            operator.run_operation(
                api,
                "apply-counter",
                expected_campaign_sha256=operator.sha256_json(baseline),
                environ={operator.COUNTER_GUARD_ENV: operator.COUNTER_GUARD_VALUE},
                lock_policy=FakeLockPolicy(),
            )
        self.assertTrue(raised.exception.partial["mutation_started"])
        self.assertEqual(
            raised.exception.partial["rollback"]["status"],
            "baseline_intact",
        )
        self.assertEqual(api.campaign, baseline)
        self.assertEqual(api.mutation_requests, 1)

    def test_ambiguous_unknown_update_state_requires_manual_inspection(self):
        baseline = canonical_campaign(counter_ids=[123])
        api = FakeApi(campaign=baseline)
        api.raise_after_update_unknown = True
        with self.assertRaises(operator.OperatorError) as raised:
            operator.run_operation(
                api,
                "apply-counter",
                expected_campaign_sha256=operator.sha256_json(baseline),
                environ={operator.COUNTER_GUARD_ENV: operator.COUNTER_GUARD_VALUE},
                lock_policy=FakeLockPolicy(),
            )
        self.assertEqual(
            raised.exception.partial["rollback"]["status"],
            "manual_inspection_required",
        )
        self.assertEqual(api.mutation_requests, 1)
        self.assertEqual(
            api.campaign["UnifiedCampaign"]["CounterIds"]["Items"],
            [424242],
        )

    def test_full_campaign_cas_blocks_rollback_on_concurrent_setting_change(self):
        baseline = canonical_campaign(counter_ids=[123])
        api = FakeApi(campaign=baseline)
        api.change_campaign_outside_measurement_after_update = True
        with self.assertRaises(operator.OperatorError) as raised:
            operator.run_operation(
                api,
                "apply-counter",
                expected_campaign_sha256=operator.sha256_json(baseline),
                environ={operator.COUNTER_GUARD_ENV: operator.COUNTER_GUARD_VALUE},
                lock_policy=FakeLockPolicy(),
            )
        self.assertEqual(
            raised.exception.partial["rollback"]["status"],
            "manual_inspection_required",
        )
        self.assertEqual(api.mutation_requests, 1)
        self.assertNotEqual(api.campaign["DailyBudget"], baseline["DailyBudget"])

    def test_measurement_lost_response_restores_full_preimage(self):
        baseline = canonical_campaign(
            counter_ids=[123],
            goals=[{"GoalId": 777, "Value": 10_000_000}],
        )
        api = FakeApi(campaign=baseline)
        api.raise_after_update_commit = True
        proof = self.evidence()
        with self.assertRaises(operator.OperatorError) as raised:
            operator.run_operation(
                api,
                "apply-measurement",
                evidence=proof,
                expected_campaign_sha256=operator.sha256_json(baseline),
                environ=measurement_env(proof),
                lock_policy=FakeLockPolicy(),
            )
        self.assertEqual(raised.exception.partial["rollback"]["status"], "restored")
        expected = copy.deepcopy(baseline)
        expected["UnifiedCampaign"]["PriorityGoals"]["Items"][0][
            "IsMetrikaSourceOfValue"
        ] = "NO"
        self.assertEqual(api.campaign, expected)

    def test_unapproved_manually_constructed_evidence_blocks_even_if_already_exact(self):
        proof = self.evidence()
        bad = operator.GoalValueEvidence(
            proof.value_micros,
            proof.sha256,
            False,
            proof.path,
            proof.source,
            proof.owner,
            proof.currency,
            proof.calculation_sha256,
        )
        desired = operator.desired_measurement(proof.value_micros)
        api = FakeApi(
            campaign=canonical_campaign(
                counter_ids=desired["CounterIds"],
                goals=desired["PriorityGoals"],
            )
        )
        with self.assertRaisesRegex(operator.OperatorError, "approved=true"):
            operator.run_operation(
                api,
                "apply-measurement",
                evidence=bad,
                expected_campaign_sha256=operator.sha256_json(api.campaign),
                environ=measurement_env(bad),
                lock_policy=FakeLockPolicy(),
            )
        self.assertEqual(api.mutation_requests, 0)

    def test_manually_constructed_missing_evidence_file_blocks_core(self):
        proof = self.evidence()
        bad = operator.GoalValueEvidence(
            proof.value_micros,
            proof.sha256,
            True,
            str(self.evidence_dir / "missing.json"),
            proof.source,
            proof.owner,
            proof.currency,
            proof.calculation_sha256,
        )
        api = FakeApi()
        with self.assertRaisesRegex(operator.OperatorError, "file недоступен"):
            operator.run_operation(
                api,
                "apply-measurement",
                evidence=bad,
                expected_campaign_sha256=operator.sha256_json(api.campaign),
                environ=measurement_env(bad),
                lock_policy=FakeLockPolicy(),
            )
        self.assertEqual(api.mutation_requests, 0)

    def test_evidence_file_change_after_cli_load_blocks_before_update(self):
        proof = self.evidence()
        Path(proof.path).write_bytes(Path(proof.path).read_bytes() + b"\n")
        api = FakeApi()
        with self.assertRaisesRegex(operator.OperatorError, "SHA-256"):
            operator.run_operation(
                api,
                "apply-measurement",
                evidence=proof,
                expected_campaign_sha256=operator.sha256_json(api.campaign),
                environ=measurement_env(proof),
                lock_policy=FakeLockPolicy(),
            )
        self.assertEqual(api.mutation_requests, 0)

    def test_campaign_field_enums_are_separate_and_tracking_is_unified_only(self):
        self.assertNotIn("TrackingParams", operator.TEXT_CAMPAIGN_FIELDS)
        self.assertIn("TrackingParams", operator.UNIFIED_CAMPAIGN_FIELDS)
        self.assertNotIn("Mobile", operator.RESPONSIVE_AD_FIELDS)
        self.assertIn("Mobile", operator.TEXT_AD_FIELDS)
        params = operator.campaign_get_params(
            [operator.TARGET_CAMPAIGN_ID],
            version=operator.CANONICAL_API_VERSION,
        )
        self.assertEqual(params["TextCampaignFieldNames"], list(operator.TEXT_CAMPAIGN_FIELDS))
        self.assertEqual(
            params["UnifiedCampaignFieldNames"],
            list(operator.UNIFIED_CAMPAIGN_FIELDS),
        )
        malformed = copy.deepcopy(params)
        malformed["TextCampaignFieldNames"].append("TrackingParams")
        with self.assertRaises(operator.OperatorError):
            operator._assert_campaign_get_contract(
                malformed,
                operator.CANONICAL_API_VERSION,
            )

    def test_campaign_request_contains_full_placement_and_settings_cas(self):
        params = operator.campaign_get_params(
            [operator.TARGET_CAMPAIGN_ID],
            version=operator.CANONICAL_API_VERSION,
        )
        self.assertIn("Settings", params["TextCampaignFieldNames"])
        self.assertIn("Settings", params["UnifiedCampaignFieldNames"])
        self.assertEqual(
            params["TextCampaignSearchStrategyPlacementTypesFieldNames"],
            list(operator.TEXT_SEARCH_PLACEMENT_FIELDS),
        )
        self.assertEqual(
            params["UnifiedCampaignSearchStrategyPlacementTypesFieldNames"],
            list(operator.UNIFIED_SEARCH_PLACEMENT_FIELDS),
        )
        self.assertEqual(
            params["UnifiedCampaignPackageBiddingStrategyPlatformsFieldNames"],
            list(operator.UNIFIED_PACKAGE_PLACEMENT_FIELDS),
        )

    def test_moderation_bundle_hashes_href_images_sitelinks_groups_and_conditions(self):
        mutators = (
            lambda api: api.ads[0]["ResponsiveAd"].__setitem__(
                "Href", "https://rosomaha-rus.ru/product/changed/"
            ),
            lambda api: api.ads[0]["ResponsiveAd"]["AdImages"]["Items"][0].__setitem__(
                "ImageHash", "changed-image"
            ),
            lambda api: api.sitelinks[0]["Sitelinks"][0].__setitem__(
                "Href", "https://rosomaha-rus.ru/changed-sitelink/"
            ),
            lambda api: api.adgroups[0]["RegionIds"].__setitem__("Items", [213]),
            lambda api: api.keywords[0].__setitem__("Keyword", "+changed"),
            lambda api: api.keywords[1]["AutotargetingCategories"].__setitem__(
                "Items", ["ALTERNATIVE"]
            ),
        )
        for index, mutate in enumerate(mutators):
            with self.subTest(index=index):
                api = FakeApi()
                baseline = bundle_hash(api)
                mutate(api)
                self.assertNotEqual(bundle_hash(api), baseline)

        text_api = FakeApi(ads=five_ads_with_one_text_ad())
        baseline = bundle_hash(text_api)
        text_api.ads[0]["TextAd"]["AdImageHash"] = "changed-text-image"
        self.assertNotEqual(bundle_hash(text_api), baseline)

    def test_sitelinks_get_uses_provider_exclusive_field_contract(self):
        api = FakeApi()
        operator.read_moderation_bundle(api)
        self.assertEqual(len(api.sitelinks_get_payloads), 1)
        request = api.sitelinks_get_payloads[0]
        self.assertEqual(request["FieldNames"], ["Id"])
        self.assertEqual(
            request["SitelinkFieldNames"],
            ["Title", "Href", "Description", "TurboPageId"],
        )
        self.assertNotIn("Sitelinks", request["FieldNames"])

    def test_moderation_requires_five_groups_and_a_condition_per_group(self):
        api = FakeApi()
        api.adgroups.pop()
        with self.assertRaisesRegex(operator.OperatorError, "ровно пять групп"):
            operator.read_moderation_bundle(api)

        api2 = FakeApi()
        missing_group_id = api2.adgroups[-1]["Id"]
        api2.keywords = [
            keyword for keyword in api2.keywords if keyword["AdGroupId"] != missing_group_id
        ]
        with self.assertRaisesRegex(operator.OperatorError, "хотя бы одно условие"):
            operator.read_moderation_bundle(api2)

    def test_moderation_ambiguous_response_is_classified_without_second_write(self):
        api = FakeApi()
        expected_campaign = operator.sha256_json(api.campaign)
        expected_bundle = bundle_hash(api)
        api.raise_after_moderate_commit = True
        with self.assertRaises(operator.OperatorError) as raised:
            operator.run_operation(
                api,
                "moderate",
                expected_campaign_sha256=expected_campaign,
                expected_ads_sha256=expected_bundle,
                environ={operator.MODERATE_GUARD_ENV: operator.MODERATE_GUARD_VALUE},
                lock_policy=FakeLockPolicy(),
            )
        self.assertTrue(raised.exception.partial["mutation_started"])
        self.assertEqual(
            raised.exception.partial["recovery"]["status"],
            "candidate_committed_response_lost",
        )
        self.assertEqual(api.mutation_requests, 1)
        self.assertEqual(
            raised.exception.partial["rollback"]["status"],
            "not_supported_for_moderation",
        )

    def test_moderation_unknown_state_requires_manual_inspection(self):
        api = FakeApi()
        expected_campaign = operator.sha256_json(api.campaign)
        expected_bundle = bundle_hash(api)
        api.raise_after_moderate_unknown = True
        with self.assertRaises(operator.OperatorError) as raised:
            operator.run_operation(
                api,
                "moderate",
                expected_campaign_sha256=expected_campaign,
                expected_ads_sha256=expected_bundle,
                environ={operator.MODERATE_GUARD_ENV: operator.MODERATE_GUARD_VALUE},
                lock_policy=FakeLockPolicy(),
            )
        self.assertEqual(
            raised.exception.partial["recovery"]["status"],
            "manual_inspection_required",
        )
        self.assertEqual(api.mutation_requests, 1)

    def test_provider_warning_is_preserved_fail_closed_and_counter_restored(self):
        baseline = canonical_campaign(counter_ids=[123])
        api = FakeApi(campaign=baseline)
        api.update_warning = True
        with self.assertRaises(operator.OperatorError) as raised:
            operator.run_operation(
                api,
                "apply-counter",
                expected_campaign_sha256=operator.sha256_json(baseline),
                environ={operator.COUNTER_GUARD_ENV: operator.COUNTER_GUARD_VALUE},
                lock_policy=FakeLockPolicy(),
            )
        self.assertEqual(raised.exception.partial["provider_warnings"][0]["Code"], 999)
        self.assertEqual(raised.exception.partial["rollback"]["status"], "restored")
        self.assertEqual(api.campaign, baseline)

    def test_moderation_warning_is_preserved_and_never_resubmitted(self):
        api = FakeApi()
        expected_campaign = operator.sha256_json(api.campaign)
        expected_bundle = bundle_hash(api)
        api.moderate_warning = True
        with self.assertRaises(operator.OperatorError) as raised:
            operator.run_operation(
                api,
                "moderate",
                expected_campaign_sha256=expected_campaign,
                expected_ads_sha256=expected_bundle,
                environ={operator.MODERATE_GUARD_ENV: operator.MODERATE_GUARD_VALUE},
                lock_policy=FakeLockPolicy(),
            )
        self.assertEqual(raised.exception.partial["provider_warnings"][0]["Code"], 998)
        self.assertEqual(api.mutation_requests, 1)
        self.assertEqual(len(api.moderate_payloads), 1)

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
