import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).with_name("yandex-direct-creative-713802902.py")
SPEC = importlib.util.spec_from_file_location("direct_creative_713802902", SCRIPT)
assert SPEC and SPEC.loader
op = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = op
SPEC.loader.exec_module(op)


class CreativeSafetyContractTests(unittest.TestCase):
    def _payload(self):
        def creative(path, image_hash, titles):
            separator = "&" if "?" in path else "?"
            return {
                "Titles": titles,
                "Texts": ["Комплектации и опции на сайте. Заявка производителю."],
                "Href": (
                    f"https://rosomaha-rus.ru{path}{separator}utm_source=yandex"
                    "&utm_medium=cpc&utm_campaign=rosomaha_rus_search_models"
                    "&utm_content={campaign_id}.{gbid}.{ad_id}.{phrase_id}.{source_type}.{device_type}"
                    "&utm_term={keyword}"
                ),
                "AdImageHashes": {"Items": [image_hash]},
            }

        creatives = {
            "brand": creative("/", "brand-image", ["Вездеходы Росомаха от завода"]),
            "category": creative(
                "/product/kvadrotsikly/", "catalog-image", ["Каталог вездеходов Росомаха"]
            ),
            "extrimeUaz": creative(
                "/product/extrime-s-1-5l-dvs-1nz-fe/?oid=812",
                "extrime-uaz-image",
                ["Росомаха Экстрим с мостами УАЗ"],
            ),
            "extrimeToyota": creative(
                "/product/extrime-1-5-litra-mosty-toyota/?oid=824",
                "extrime-toyota-image",
                ["Росомаха Экстрим с мостами Toyota"],
            ),
            "hunter": creative(
                "/product/hunter-s-1-5l-dvs-1nz-fe/?oid=800",
                "hunter-image",
                ["Росомаха Хантер с мостами Toyota"],
            ),
        }
        return {
            "creatives": creatives,
            "publicLandingEvidence": {"allStatus200": True, "exactHost": op.EXPECTED_DOMAIN},
            "imageEvidence": {
                "perCreative": {
                    key: {
                        "hash": value["AdImageHashes"]["Items"][0],
                        "sourceUrl": f"https://rosomaha-rus.ru/images/{key}.jpg",
                        "providerAccepted": True,
                        "modelSpecific": key in op.CREATIVE_MODEL_OIDS,
                    }
                    for key, value in creatives.items()
                }
            },
        }

    def test_safe_creative_contract_accepts_exact_intent_utm_oid_and_images(self):
        payload = self._payload()
        op._validate_creative_contract(payload)
        op._validate_mutation_image_contract(payload)

    def test_category_snow_intent_cannot_target_kvadrotsikly_path(self):
        payload = self._payload()
        payload["creatives"]["category"]["Titles"] = ["Снегоболотоходы Росомаха"]
        with self.assertRaisesRegex(op.OperatorError, "снегоболотоходы ведут"):
            op._validate_creative_contract(payload)

    def test_missing_utm_oid_and_unverified_claims_fail_closed(self):
        cases = []
        missing_utm = self._payload()
        missing_utm["creatives"]["brand"]["Href"] = missing_utm["creatives"]["brand"]["Href"].replace(
            "utm_medium=cpc", "utm_medium=organic"
        )
        cases.append(missing_utm)
        missing_oid = self._payload()
        missing_oid["creatives"]["hunter"]["Href"] = missing_oid["creatives"]["hunter"]["Href"].replace(
            "oid=800&", ""
        )
        cases.append(missing_oid)
        unsupported = self._payload()
        unsupported["creatives"]["brand"]["Texts"] = ["Гарантия и цена от 1 000 000 руб."]
        cases.append(unsupported)
        for payload in cases:
            with self.subTest(payload=payload):
                with self.assertRaises(op.OperatorError):
                    op._validate_creative_contract(payload)

    def test_model_image_substitution_fails_closed(self):
        payload = self._payload()
        payload["creatives"]["hunter"]["AdImageHashes"]["Items"] = [
            op.BASELINE_GENERIC_IMAGE_HASH
        ]
        payload["imageEvidence"]["perCreative"]["hunter"]["hash"] = op.BASELINE_GENERIC_IMAGE_HASH
        with self.assertRaisesRegex(op.OperatorError, "model image подменено"):
            op._validate_mutation_image_contract(payload)

    def test_legacy_generic_image_is_auditable_but_cannot_authorize_mutation(self):
        payload = self._payload()
        for creative in payload["creatives"].values():
            creative["AdImageHashes"]["Items"] = [op.BASELINE_GENERIC_IMAGE_HASH]
        payload["imageEvidence"] = {
            "hash": op.BASELINE_GENERIC_IMAGE_HASH,
            "sourceUrl": "https://rosomaha-rus.ru/images/generic.jpg",
            "providerReceipt": "marketing-audits/yandex-direct/provider.json",
        }
        op._validate_creative_contract(payload)
        with self.assertRaisesRegex(op.OperatorError, "Mutation blocked"):
            op._validate_mutation_image_contract(payload)


class CreativeOperatorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.payload, cls.metadata = op.build_current_payload()

    def test_current_source_plan_is_valid_and_source_bound(self):
        self.assertEqual(self.payload["campaignId"], 713802902)
        self.assertEqual(self.payload["exactLogin"], "rosomaha-rus999")
        self.assertRegex(self.metadata["plan_sha256"], r"^[a-f0-9]{64}$")
        self.assertEqual(
            self.metadata["prep_source"],
            "scripts\\yandex-direct-prepare-713802902-v2.mjs",
        )
        self.assertEqual(len(self.payload["keywords"]["add"]), 5)
        self.assertEqual(
            self.payload["semanticEvidence"]["yesEvidencePhraseCount"], 23
        )
        self.assertEqual(
            self.payload["semanticEvidence"]["materializedUniqueKeywordCount"], 21
        )
        safety = self.payload["keywords"]["parkedAutotargetingSafety"]
        self.assertEqual(safety["id"], op.PARKED_AUTOTARGET_ID)
        self.assertTrue(safety["remainsOn"])
        self.assertNotIn(
            op.PARKED_AUTOTARGET_ID, self.payload["keywords"]["suspendIds"]
        )

    def test_stable_plan_hash_ignores_only_generator_timestamps(self):
        changed = op.copy.deepcopy(self.payload)
        changed["generatedAt"] = "2099-01-01T00:00:00Z"
        changed["publicLandingEvidence"]["checkedAt"] = "2099-01-01T00:00:00Z"
        self.assertEqual(
            op.sha256_json(op._stable_plan_view(changed)),
            op.sha256_json(op._stable_plan_view(self.payload)),
        )
        changed["creatives"]["brand"]["Texts"][0] += " Изменено."
        self.assertNotEqual(
            op.sha256_json(op._stable_plan_view(changed)),
            op.sha256_json(op._stable_plan_view(self.payload)),
        )

    def test_exact_64_bit_ad_ids_are_not_rounded(self):
        expected = {
            1919379464991658812,
            1919379464991658813,
            1919379464991658814,
            1919379464991658815,
            1919379464991658816,
        }
        self.assertEqual(set(op.EXISTING_AD_IDS.values()), expected)
        self.assertTrue(all(item > 2**53 for item in expected))

    def _requests(self):
        return op.build_materialized_requests(
            self.payload,
            image_hash=op.BASELINE_GENERIC_IMAGE_HASH,
            sitelink_ids={
                "generic": 9900000001,
                "extrimeUaz": 9900000002,
                "extrimeToyota": 9900000003,
                "hunter": 9900000004,
            },
        )

    def _partial_snapshot(self):
        campaign = {
            "Id": op.TARGET_CAMPAIGN_ID,
            "Type": "UNIFIED_CAMPAIGN",
            "Status": "ACCEPTED",
            "State": "SUSPENDED",
            "UnifiedCampaign": {
                "PackageBiddingStrategy": None,
                "CounterIds": {"Items": [op.EXPECTED_COUNTER_ID]},
                "PriorityGoals": None,
            },
        }
        desired_groups = op._current_stage_params(
            self.payload, "adgroups", "update"
        )["AdGroups"]
        ads = []
        for ad_id, expected in op.BASELINE_ADS.items():
            images = expected["images"]
            ads.append(
                {
                    "Id": ad_id,
                    "AdGroupId": expected["group"],
                    "Status": "ACCEPTED",
                    "State": "OFF",
                    "ResponsiveAd": {
                        "Titles": [{"Title": item} for item in expected["titles"]],
                        "Texts": [{"Text": item} for item in expected["texts"]],
                        "Href": expected["href"],
                        "DisplayUrlPath": expected["display"],
                        "SitelinkSetId": expected["sitelink"],
                        "AdImages": None
                        if not images
                        else {"Items": [{"ImageHash": item} for item in images]},
                    },
                }
            )
        desired_updates = {
            item["Id"]: item["Keyword"] for item in self.payload["keywords"]["update"]
        }
        keywords = [
            {
                "Id": item_id,
                "AdGroupId": group_id,
                "Keyword": desired_updates.get(item_id, phrase),
                "State": "ON",
            }
            for item_id, (group_id, phrase) in op.BASELINE_EXPLICIT_KEYWORDS.items()
        ]
        keywords.extend(
            {
                "Id": item_id,
                "AdGroupId": group_id,
                "Keyword": "---autotargeting",
                "State": "ON",
            }
            for item_id, group_id in op.AUTOTARGETING_IDS.items()
        )
        keywords.extend(
            {
                "Id": item_id,
                "AdGroupId": group_id,
                "Keyword": phrase,
                "State": "ON",
            }
            for item_id, (group_id, phrase) in op.PARTIAL_NEW_KEYWORDS.items()
        )
        desired_sitelinks = [
            {"Id": op.PARTIAL_SITELINK_IDS[key], "Sitelinks": links}
            for key, links in self.payload["sitelinkSets"].items()
        ]
        old_sitelink = {
            "Id": op.BASELINE_SITELINK_SET_ID,
            "Sitelinks": [
                {
                    "Title": "Старый набор",
                    "Href": "https://rosomaha-rus.ru/",
                    "Description": "До recovery",
                }
            ],
        }
        return {
            "raw": {
                "campaign": campaign,
                "adgroups": op.copy.deepcopy(desired_groups),
                "ads": ads,
                "keywords": keywords,
                "sitelinks": [old_sitelink],
                "all_sitelinks": [old_sitelink, *desired_sitelinks],
            },
            "sha256": "a" * 64,
            "counts": {
                "adgroups": 5,
                "ads": 5,
                "keywords": 31,
                "sitelinks": 1,
                "account_sitelinks": 5,
            },
        }

    def _second_partial_snapshot(self):
        snapshot = self._partial_snapshot()
        for item in snapshot["raw"]["keywords"]:
            if item["Id"] in op.KEYWORD_SUSPEND_IDS:
                item["State"] = "SUSPENDED"
        snapshot["sha256"] = "d" * 64
        return snapshot

    def _third_partial_snapshot(self):
        snapshot = self._second_partial_snapshot()
        snapshot["sha256"] = op.THIRD_PARTIAL_PREIMAGE_CAS_SHA256
        return snapshot

    def _post_snapshot(self, new_ad_id=1919379464991658999):
        snapshot = self._second_partial_snapshot()
        requests = op.build_materialized_requests(
            self.payload,
            image_hash=op.BASELINE_GENERIC_IMAGE_HASH,
            sitelink_ids=op.PARTIAL_SITELINK_IDS,
        )

        def readback_creative(value):
            hashes = value["AdImageHashes"]
            if isinstance(hashes, dict):
                hashes = hashes["Items"]
            return {
                "Titles": [{"Title": item} for item in value["Titles"]],
                "Texts": [{"Text": item} for item in value["Texts"]],
                "Href": value["Href"],
                "DisplayUrlPath": value["DisplayUrlPath"],
                "SitelinkSetId": value["SitelinkSetId"],
                "AdImages": {"Items": [{"ImageHash": item} for item in hashes]},
            }

        by_id = {item["Id"]: item for item in snapshot["raw"]["ads"]}
        for row in requests["ads_update"]["params"]["Ads"]:
            by_id[row["Id"]]["ResponsiveAd"] = readback_creative(
                row["ResponsiveAd"]
            )
        by_id[op.PARKED_AD_ID]["State"] = "SUSPENDED"
        added = requests["ads_add"]["params"]["Ads"][0]
        by_id[new_ad_id] = {
            "Id": new_ad_id,
            "AdGroupId": added["AdGroupId"],
            "Status": "DRAFT",
            "State": "OFF",
            "ResponsiveAd": readback_creative(added["ResponsiveAd"]),
        }
        snapshot["raw"]["ads"] = list(by_id.values())
        snapshot["raw"]["sitelinks"] = [
            {"Id": op.PARTIAL_SITELINK_IDS[key], "Sitelinks": links}
            for key, links in self.payload["sitelinkSets"].items()
        ]
        return snapshot, requests, new_ad_id

    def test_materialized_ads_update_all_exact_ids_and_add_array_hash(self):
        requests = self._requests()
        self.assertEqual(
            {
                requests[kind]["version"]
                for kind in ("ads_update", "ads_add", "ads_suspend")
            },
            {"v501"},
        )
        update_ids = {row["Id"] for row in requests["ads_update"]["params"]["Ads"]}
        self.assertEqual(update_ids, set(op.EXISTING_AD_IDS.values()))
        for row in requests["ads_update"]["params"]["Ads"]:
            hashes = row["ResponsiveAd"]["AdImageHashes"]
            self.assertEqual(set(hashes), {"Items"})
            self.assertIsInstance(hashes["Items"], list)
        added = requests["ads_add"]["params"]["Ads"]
        self.assertEqual(len(added), 1)
        self.assertEqual(added[0]["AdGroupId"], op.GROUP_IDS["extrime_family"])
        self.assertIsInstance(added[0]["ResponsiveAd"]["AdImageHashes"], list)

    def test_current_source_declares_all_epk_ad_mutations_v501(self):
        ad_stages = [
            item for item in self.payload["stagedRequests"] if item["service"] == "ads"
        ]
        self.assertEqual(
            [(item["request"]["method"], item["version"]) for item in ad_stages],
            [("update", "v501"), ("add", "v501"), ("suspend", "v501")],
        )

    def test_current_adgroup_stage_is_found_by_service_not_index(self):
        params = op._current_stage_params(self.payload, "adgroups", "update")
        brand = next(row for row in params["AdGroups"] if row["Id"] == op.GROUP_IDS["brand"])
        self.assertIn("экстрим", brand["NegativeKeywords"]["Items"])
        self.assertIn("хантер", brand["NegativeKeywords"]["Items"])

    def test_semantic_plan_excludes_proven_waste_and_unsafe_intent_mixing(self):
        params = op._current_stage_params(self.payload, "adgroups", "update")
        groups = {row["Id"]: row for row in params["AdGroups"]}
        for group in groups.values():
            negatives = set(group["NegativeKeywords"]["Items"])
            self.assertTrue(
                {"пистолет", "пневматика", "травмат", "охолощенный", "яхта"}
                <= negatives
            )

        active = {
            item["Keyword"].lower()
            for item in [
                *self.payload["keywords"]["update"],
                *self.payload["keywords"]["add"],
            ]
        }
        self.assertFalse(any("официальный сайт" in keyword for keyword in active))

        category_group_id = op.GROUP_IDS["category"]
        category_keywords = {
            item["Keyword"].lower()
            for item in [
                *self.payload["keywords"]["update"],
                *self.payload["keywords"]["add"],
            ]
            if item.get("AdGroupId") == category_group_id
            or op.BASELINE_EXPLICIT_KEYWORDS.get(item.get("Id"), (None,))[0]
            == category_group_id
        }
        self.assertFalse(any("снегоболотоход" in keyword for keyword in category_keywords))
        category = self.payload["creatives"]["category"]
        self.assertNotIn("снегоболотоход", " ".join(category["Titles"] + category["Texts"]).lower())
        self.assertIn("kvadrotsikly", category["Href"])

        gate = self.payload["sourceUncertaintyGate"]
        self.assertEqual(gate["wordstatStatus"], "source_unavailable")
        self.assertFalse(gate["mutationAllowed"])
        self.assertEqual(
            self.payload["intentArchitecture"]["navigation"]["status"],
            "excluded_from_paid_plan",
        )

    def test_sitelink_reuse_prevents_duplicates_after_partial_run(self):
        desired = self.payload["sitelinkSets"]
        existing = [
            {"Id": 7000 + index, "Sitelinks": links}
            for index, links in enumerate(desired.values())
        ]
        plan = op.plan_sitelink_reuse(existing, desired)
        self.assertEqual(plan["add_keys"], [])
        self.assertEqual(plan["reused_count"], 4)
        resolved = op.resolve_sitelink_ids(plan, [])
        self.assertEqual(set(resolved), set(desired))
        self.assertEqual(len(set(resolved.values())), 4)

    def test_exact_partial_state_classifies_without_replaying_adds(self):
        classification = op.validate_partial_state(
            self._partial_snapshot(), self.payload
        )
        self.assertEqual(
            classification["classification"],
            "partial_after_keyword_normalization_warning",
        )
        self.assertEqual(classification["keyword_count"], 31)
        self.assertEqual(classification["current_on_explicit_keyword_count"], 26)
        self.assertEqual(
            classification["desired_post_active_explicit_keyword_count"], 21
        )
        self.assertEqual(classification["semantic_yes_phrase_count"], 23)
        self.assertEqual(classification["sitelink_ids"], op.PARTIAL_SITELINK_IDS)
        self.assertNotIn("keywords_add", classification["remaining_stages"])
        self.assertNotIn("sitelinks_add", classification["remaining_stages"])
        self.assertEqual(
            classification["remaining_explicit_suspend_ids"],
            sorted(op.KEYWORD_SUSPEND_IDS),
        )

    def test_second_partial_state_proves_provider_partial_action_and_no_retry(self):
        classification = op.validate_partial_state(
            self._second_partial_snapshot(),
            self.payload,
            after_autotarget_error=True,
        )
        self.assertEqual(
            classification["classification"], "partial_after_autotarget_8305"
        )
        self.assertEqual(classification["current_on_explicit_keyword_count"], 21)
        self.assertEqual(
            classification["already_suspended_explicit_ids"],
            sorted(op.KEYWORD_SUSPEND_IDS),
        )
        self.assertEqual(classification["remaining_explicit_suspend_ids"], [])
        self.assertEqual(
            classification["remaining_stages"],
            ["ads_update", "ads_add", "ads_suspend"],
        )
        self.assertEqual(
            classification["parked_autotarget"]["id"], op.PARKED_AUTOTARGET_ID
        )
        self.assertEqual(classification["parked_autotarget"]["state"], "ON")
        self.assertEqual(
            classification["second_partial_receipt"]["provider_error_code"],
            8305,
        )

    def test_third_partial_state_pins_3500_and_exact_unchanged_ads(self):
        classification = op.validate_partial_state(
            self._third_partial_snapshot(),
            self.payload,
            after_autotarget_error=True,
            after_epk_v5_error=True,
        )
        self.assertEqual(
            classification["classification"],
            "partial_after_epk_ads_v5_error_3500",
        )
        self.assertTrue(classification["ads_post_error_exact_preimage_unchanged"])
        self.assertEqual(
            classification["third_partial_receipt"]["provider_error_code"], 3500
        )
        self.assertEqual(
            classification["third_partial_receipt"]["completed_ad_stages"], []
        )
        self.assertEqual(
            classification["remaining_stages"],
            ["ads_update", "ads_add", "ads_suspend"],
        )

        drift = self._third_partial_snapshot()
        drift["raw"]["ads"][0]["ResponsiveAd"]["Href"] += "&drift=1"
        with self.assertRaisesRegex(op.OperatorError, "ad preimage drift"):
            op.validate_partial_state(
                drift,
                self.payload,
                after_autotarget_error=True,
                after_epk_v5_error=True,
            )

    def test_post_readback_allows_on_autotarget_only_with_sole_suspended_ad(self):
        snapshot, requests, new_ad_id = self._post_snapshot()
        result = op.verify_post_readback(
            snapshot,
            self.payload,
            requests,
            new_keyword_ids=list(op.PARTIAL_NEW_KEYWORDS),
            new_ad_id=new_ad_id,
            sitelink_ids=op.PARTIAL_SITELINK_IDS,
        )
        self.assertEqual(
            result["parked_autotarget_safety"]["non_suspended_ads_in_group"], 0
        )
        self.assertEqual(
            result["parked_autotarget_safety"]["sole_ad_state"], "SUSPENDED"
        )

        unsafe = op.copy.deepcopy(snapshot)
        unsafe["raw"]["ads"].append(
            {
                "Id": 1919379464991658998,
                "AdGroupId": op.GROUP_IDS["parked_extrime_toyota"],
                "Status": "DRAFT",
                "State": "OFF",
                "ResponsiveAd": op.copy.deepcopy(
                    unsafe["raw"]["ads"][0]["ResponsiveAd"]
                ),
            }
        )
        with self.assertRaises(op.OperatorError):
            op.verify_post_readback(
                unsafe,
                self.payload,
                requests,
                new_keyword_ids=list(op.PARTIAL_NEW_KEYWORDS),
                new_ad_id=new_ad_id,
                sitelink_ids=op.PARTIAL_SITELINK_IDS,
            )

    def test_partial_state_rejects_unknown_keyword_id(self):
        snapshot = self._partial_snapshot()
        snapshot["raw"]["keywords"].append(
            {
                "Id": 99999999999,
                "AdGroupId": op.GROUP_IDS["brand"],
                "Keyword": "unknown",
                "State": "ON",
            }
        )
        with self.assertRaises(op.OperatorError):
            op.validate_partial_state(snapshot, self.payload)

    def test_account_wide_sitelink_read_omits_selection_criteria(self):
        class FakeApi:
            def __init__(self):
                self.params = None

            def call(self, version, service, method, params, *, use_client_login):
                self.params = params
                return {"SitelinksSets": []}

        api = FakeApi()
        self.assertEqual(op.read_all_sitelinks(api), [])
        self.assertNotIn("SelectionCriteria", api.params)

    def test_desired_duplicate_sitelink_set_is_aliased_not_added(self):
        generic = self.payload["sitelinkSets"]["generic"]
        desired = {"generic": generic, "duplicate": op.copy.deepcopy(generic)}
        plan = op.plan_sitelink_reuse([], desired)
        self.assertEqual(plan["add_keys"], ["generic"])
        self.assertEqual(plan["alias_of"], {"duplicate": "generic"})

    def test_sitelinks_add_contract_rejects_duplicate_rows(self):
        links = self.payload["sitelinkSets"]["generic"]
        params = {"SitelinksSets": [{"Sitelinks": links}, {"Sitelinks": links}]}
        with self.assertRaises(op.OperatorError):
            op.assert_mutation_contract("v501", "sitelinks", "add", params, "sitelinks_add")

    def test_public_probe_url_strips_tracking_but_preserves_oid(self):
        value = (
            "https://rosomaha-rus.ru/product/x/?oid=824&utm_source=yandex"
            "&utm_content={campaign_id}#price"
        )
        self.assertEqual(
            op._public_probe_url(value),
            "https://rosomaha-rus.ru/product/x/?oid=824",
        )
        with self.assertRaises(op.OperatorError):
            op._public_probe_url("https://rosomaha.site/")

    def test_protected_campaign_id_and_campaign_fields_are_rejected(self):
        request = self._requests()["ads_suspend"]
        bad = op.copy.deepcopy(request["params"])
        bad["SelectionCriteria"]["Ids"] = [op.PROTECTED_CAMPAIGN_IDS[0]]
        with self.assertRaises(op.OperatorError):
            op.assert_mutation_contract("v501", "ads", "suspend", bad, "ads_suspend")
        bad = op.copy.deepcopy(request["params"])
        bad["CampaignId"] = op.TARGET_CAMPAIGN_ID
        with self.assertRaises(op.OperatorError):
            op.assert_mutation_contract("v501", "ads", "suspend", bad, "ads_suspend")

    def test_epk_ad_mutations_through_v5_are_rejected_before_http(self):
        api = op.CreativeDirectApi("unit-test-token")
        api.mutation_allowlist_override = frozenset(
            {"ads_update", "ads_add", "ads_suspend"}
        )
        for kind in ("ads_update", "ads_add", "ads_suspend"):
            request = self._requests()[kind]
            with self.assertRaisesRegex(op.OperatorError, "endpoint.*allowlist"):
                api.call(
                    "v5",
                    request["service"],
                    request["method"],
                    request["params"],
                    use_client_login=True,
                    mutation_kind=kind,
                )
        self.assertEqual(api.mutation_requests, 0)

    def test_provider_warnings_stop_the_stage(self):
        result = {
            "AddResults": [{"Id": 101, "Warnings": [{"Code": 1, "Message": "warn"}]}]
        }
        with self.assertRaises(op.OperatorError) as caught:
            op.strict_action_rows(result, "AddResults", expected_count=1, id_field="Id")
        self.assertIn("provider_warnings", caught.exception.partial)

    def test_apply_requires_both_cas_values_and_exact_unlock(self):
        self.assertEqual(op.parse_args([]).mode, "dry-run")
        with self.assertRaises(SystemExit):
            op.parse_args(["--apply", "--expected-cas-sha256", "a" * 64])
        args = op.parse_args(
            [
                "--apply",
                "--expected-cas-sha256",
                "a" * 64,
                "--expected-plan-sha256",
                "b" * 64,
            ]
        )
        self.assertEqual(args.mode, "apply")
        with self.assertRaises(op.OperatorError):
            op.verify_apply_unlock({})
        op.verify_apply_unlock({op.APPLY_GUARD_ENV: op.APPLY_GUARD_VALUE})

        recovery = op.parse_args(
            [
                "--recover-partial",
                "--expected-cas-sha256",
                "a" * 64,
                "--expected-plan-sha256",
                "b" * 64,
            ]
        )
        self.assertEqual(recovery.mode, "recover-partial")
        with self.assertRaises(op.OperatorError):
            op.verify_recovery_unlock({})
        op.verify_recovery_unlock(
            {op.RECOVERY_GUARD_ENV: op.RECOVERY_GUARD_VALUE}
        )

    def test_apply_with_legacy_generic_image_fails_before_any_api_request(self):
        class FakeApi:
            mutation_requests = 0
            request_log = []

        api = FakeApi()
        with self.assertRaisesRegex(op.OperatorError, "Mutation blocked"):
            op.run_apply(
                api,
                self.payload,
                expected_cas_sha256="a" * 64,
                expected_plan_sha256=self.metadata["plan_sha256"],
                environ={op.APPLY_GUARD_ENV: op.APPLY_GUARD_VALUE},
                payload_metadata=self.metadata,
            )
        self.assertEqual(api.mutation_requests, 0)
        self.assertEqual(api.request_log, [])

    def test_recovery_executes_only_remaining_stages_and_stays_suspended(self):
        snapshot = self._third_partial_snapshot()
        post = {
            "raw": {"campaign": op.copy.deepcopy(snapshot["raw"]["campaign"])},
            "sha256": "c" * 64,
        }

        class FakeApi:
            mutation_requests = 0
            request_log = []

        class FakeLock:
            def hold(self):
                class Held:
                    def __enter__(self_inner):
                        return {"path": "test.lock", "released": False}

                    def __exit__(self_inner, exc_type, exc, tb):
                        return False

                return Held()

        api = FakeApi()
        called = []

        def fake_stage(api_arg, kind, item, **kwargs):
            called.append(kind)
            api_arg.mutation_requests += 1
            if kind == "ads_update":
                ids = sorted(op.EXISTING_AD_IDS.values())
                key = "UpdateResults"
            elif kind == "ads_add":
                ids = [1919379464991658999]
                key = "AddResults"
            else:
                ids = [op.PARKED_AD_ID]
                key = "SuspendResults"
            return {"result": {key: [{"Id": item_id} for item_id in ids]}}

        protected = {
            "campaigns": {},
            "canonical_sha256": "p",
            "canonical_bytes": 1,
            "semantic_sha256": "p",
        }
        with (
            mock.patch.object(op, "_validate_mutation_image_contract", return_value=None),
            mock.patch.object(
                op,
                "public_http_preflight",
                return_value={"all_http_200": True},
            ),
            mock.patch.object(
                op.guard,
                "prove_identity",
                return_value={"login": op.EXPECTED_LOGIN},
            ),
            mock.patch.object(
                op.guard, "read_protected_snapshot", return_value=protected
            ),
            mock.patch.object(
                op.guard, "assert_protected_equal", return_value=None
            ),
            mock.patch.object(
                op, "read_target_snapshot", side_effect=[snapshot, post]
            ),
            mock.patch.object(
                op,
                "validate_reused_image",
                return_value=(
                    op.BASELINE_GENERIC_IMAGE_HASH,
                    {"readback_verified": True},
                ),
            ),
            mock.patch.object(op, "_mutate_stage", side_effect=fake_stage),
            mock.patch.object(
                op,
                "verify_post_readback",
                return_value={
                    "campaign_state": "SUSPENDED",
                    "ad_count_total": 6,
                    "ad_count_non_suspended": 5,
                },
            ),
        ):
            receipt = op.run_partial_recovery(
                api,
                self.payload,
                expected_cas_sha256=op.THIRD_PARTIAL_PREIMAGE_CAS_SHA256,
                expected_plan_sha256="b" * 64,
                environ={op.RECOVERY_GUARD_ENV: op.RECOVERY_GUARD_VALUE},
                payload_metadata={"plan_sha256": "b" * 64},
                lock_policy=FakeLock(),
            )
        self.assertEqual(
            called,
            ["ads_update", "ads_add", "ads_suspend"],
        )
        self.assertEqual(
            [item["version"] for item in receipt["exact_remaining_requests"]],
            ["v501", "v501", "v501"],
        )
        self.assertNotIn("keywords_add", called)
        self.assertNotIn("sitelinks_add", called)
        self.assertEqual(receipt["status"], "recovered_verified_suspended")
        self.assertEqual(receipt["final_campaign_state"], "SUSPENDED")
        self.assertEqual(receipt["mutation_requests"], 3)
        self.assertTrue(receipt["protected_unchanged"])
        self.assertEqual(
            api.mutation_allowlist_override,
            frozenset({"ads_update", "ads_add", "ads_suspend"}),
        )

    def test_recovery_wrong_snapshot_cas_makes_zero_mutations(self):
        snapshot = self._third_partial_snapshot()

        class FakeApi:
            mutation_requests = 0
            request_log = []

        class FakeLock:
            def hold(self):
                class Held:
                    def __enter__(self_inner):
                        return {"path": "test.lock"}

                    def __exit__(self_inner, exc_type, exc, tb):
                        return False

                return Held()

        protected = {
            "campaigns": {},
            "canonical_sha256": "p",
            "canonical_bytes": 1,
            "semantic_sha256": "p",
        }
        api = FakeApi()
        with (
            mock.patch.object(op, "_validate_mutation_image_contract", return_value=None),
            mock.patch.object(
                op,
                "public_http_preflight",
                return_value={"all_http_200": True},
            ),
            mock.patch.object(
                op.guard,
                "prove_identity",
                return_value={"login": op.EXPECTED_LOGIN},
            ),
            mock.patch.object(
                op.guard, "read_protected_snapshot", return_value=protected
            ),
            mock.patch.object(
                op.guard, "assert_protected_equal", return_value=None
            ),
            mock.patch.object(op, "read_target_snapshot", return_value=snapshot),
            mock.patch.object(
                op,
                "_campaign_safety",
                return_value={"state": "SUSPENDED"},
            ),
        ):
            receipt = op.run_partial_recovery(
                api,
                self.payload,
                expected_cas_sha256="f" * 64,
                expected_plan_sha256="b" * 64,
                environ={op.RECOVERY_GUARD_ENV: op.RECOVERY_GUARD_VALUE},
                payload_metadata={"plan_sha256": "b" * 64},
                lock_policy=FakeLock(),
            )
        self.assertEqual(
            receipt["status"], "manual_inspection_required_suspended"
        )
        self.assertEqual(receipt["mutation_requests"], 0)

    def test_recovery_api_override_physically_blocks_completed_stage(self):
        api = op.CreativeDirectApi("unit-test-token")
        api.mutation_allowlist_override = frozenset(
            {"ads_update", "ads_add", "ads_suspend"}
        )
        request = self._requests()["keywords_add"]
        with self.assertRaisesRegex(op.OperatorError, "forbids mutation stage"):
            api.call(
                request["version"],
                request["service"],
                request["method"],
                request["params"],
                use_client_login=True,
                mutation_kind="keywords_add",
            )
        self.assertEqual(api.mutation_requests, 0)

        suspend_request = self._requests()["keywords_suspend"]
        with self.assertRaisesRegex(op.OperatorError, "forbids mutation stage"):
            api.call(
                suspend_request["version"],
                suspend_request["service"],
                suspend_request["method"],
                suspend_request["params"],
                use_client_login=True,
                mutation_kind="keywords_suspend",
            )
        self.assertNotIn(
            op.PARKED_AUTOTARGET_ID,
            suspend_request["params"]["SelectionCriteria"]["Ids"],
        )

    def test_existing_global_lock_blocks_without_deleting_it(self):
        with tempfile.TemporaryDirectory() as temp:
            lock = Path(temp) / "global.lock"
            lock.write_text("other owner", encoding="utf-8")
            policy = op.MutationLockPolicy(browser_locks=(), mutation_lock=lock)
            with self.assertRaises(op.OperatorError):
                with policy.hold():
                    self.fail("lock must not be acquired")
            self.assertEqual(lock.read_text(encoding="utf-8"), "other owner")

    def test_payload_identity_drift_is_rejected(self):
        bad = op.copy.deepcopy(self.payload)
        bad["exactLogin"] = "foreign-login"
        with self.assertRaises(op.OperatorError):
            op.validate_payload(bad)


if __name__ == "__main__":
    unittest.main(verbosity=2)
