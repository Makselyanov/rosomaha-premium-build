#!/usr/bin/env python3
"""Safety and schema tests for the phase-1 Bitrix fan-option audit."""

from __future__ import annotations

import base64
import hashlib
import importlib.util
import json
import os
import re
import stat
import subprocess
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
GIT_BASH_PATH = Path(r"C:\Program Files\Git\bin\bash.exe")


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


def normalized_value(value: object) -> dict[str, object]:
    return {
        "value": value,
        "enum_value": None,
        "enum_xml_id": None,
        "description": None,
    }


def element(element_id: int, code: str, property_ids: tuple[int, ...]) -> dict[str, object]:
    shapes = {
        MODULE.LINK_GOODS_PROPERTY_ID: ("LINK_GOODS", "E", True, MODULE.IBLOCK_ID),
        1171: ("PRICE", "N", True, 0),
        1177: ("FILTER_PRICE", "N", True, 0),
    }
    return {
        "id": element_id,
        "code": code,
        "fields": {
            "iblock_id": MODULE.IBLOCK_ID,
            "primary_section_id": MODULE.OPTIONS_SECTION_ID,
            "name": code,
            "xml_id": "",
            "active": True,
            "sort": 500,
            "active_from": "",
            "active_to": "",
            "preview_text_type": "text",
            "preview_text": {"empty": True, "bytes": 0, "sha256": None},
            "detail_text_type": "text",
            "detail_text": {"empty": True, "bytes": 0, "sha256": None},
            "preview_picture_id": 0,
            "detail_picture_id": 0,
            "detail_page_url": f"/product/{code}/",
            "created_at": "",
            "changed_at": "",
        },
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


def set_property_values(
    item: dict[str, object], prop_id: int, values: list[object]
) -> None:
    prop = next(entry for entry in item["properties"] if entry["id"] == prop_id)
    prop["values"] = [normalized_value(value) for value in values]


def property_shapes(item: dict[str, object]) -> list[dict[str, object]]:
    return [
        {
            "id": prop["id"],
            "code": prop["code"],
            "type": prop["type"],
            "multiple": prop["multiple"],
            "link_iblock_id": prop["link_iblock_id"],
            "value_count": len(prop["values"]),
            "values_sha256": MODULE._evidence_sha256(prop["values"]),
        }
        for prop in item["properties"]
    ]


def linked_render_item(item: dict[str, object]) -> dict[str, object]:
    values = next(
        prop["values"] for prop in item["properties"] if prop["id"] == 1177
    )
    return {
        "id": item["id"],
        "code": item["code"],
        "name": item["fields"]["name"],
        "active": item["fields"]["active"],
        "sort": item["fields"]["sort"],
        "filter_price_values": values,
        "selectable_contract": MODULE._filter_price_contract(
            values, active=item["fields"]["active"]
        ),
    }


def add_phase1b(payload: dict[str, object]) -> None:
    models = payload["elements"]["models"]
    pinned_ids = list(MODULE.EXPECTED_LINKED_OPTION_IDS)
    arrays = [
        pinned_ids[
            (len(pinned_ids) * index) // len(MODULE.MODEL_CODES):
            (len(pinned_ids) * (index + 1)) // len(MODULE.MODEL_CODES)
        ]
        for index in range(len(MODULE.MODEL_CODES))
    ]
    for values in arrays:
        if MODULE.ANCHOR_ID in values:
            values.remove(MODULE.ANCHOR_ID)
    for index in range(8):
        values = arrays[index]
        values.insert(min(2, len(values)), MODULE.ANCHOR_ID)
    for model, values in zip(models, arrays):
        set_property_values(model, MODULE.LINK_GOODS_PROPERTY_ID, values)

    linked_full: dict[int, dict[str, object]] = {}
    for index, linked_id in enumerate(MODULE.EXPECTED_LINKED_OPTION_IDS):
        item = element(
            linked_id,
            f"option-{linked_id}",
            (MODULE.LINK_GOODS_PROPERTY_ID, 1171, 1177),
        )
        item["fields"]["sort"] = 100 + (index // 5) * 10
        item["fields"]["active"] = linked_id != 859
        item["sections"] = [
            {
                "id": MODULE.OPTIONS_SECTION_ID,
                "parent_id": 0,
                "name": "Options",
                "code": "options",
                "sort": 100,
                "active": True,
                "depth": 1,
            }
        ]
        set_property_values(item, 1171, [linked_id * 10])
        if linked_id == 894:
            filter_price_values = ["60000 "]
        elif linked_id == 895:
            filter_price_values = ["150000 "]
        else:
            filter_price_values = [linked_id * 10]
        set_property_values(item, 1177, filter_price_values)
        linked_full[linked_id] = item

    linked_summaries = [
        {
            "id": item["id"],
            "code": item["code"],
            "fields": item["fields"],
            "sections": item["sections"],
            "property_shapes": property_shapes(item),
            "price_values": next(
                prop["values"] for prop in item["properties"] if prop["id"] == 1171
            ),
            "filter_price_values": next(
                prop["values"] for prop in item["properties"] if prop["id"] == 1177
            ),
            "full_snapshot_sha256": MODULE._evidence_sha256(item),
        }
        for item in linked_full.values()
    ]
    model_links = []
    render_models = []
    for model, ordered_ids in zip(models, arrays):
        positions = [
            index for index, linked_id in enumerate(ordered_ids)
            if linked_id == MODULE.ANCHOR_ID
        ]
        model_links.append(
            {
                "model_id": model["id"],
                "model_code": model["code"],
                "ordered_ids": ordered_ids,
                "ordered_ids_sha256": MODULE._evidence_sha256(ordered_ids),
                "count": len(ordered_ids),
                "gur_positions_zero_based": positions,
            }
        )
        relation_items = [linked_render_item(linked_full[item]) for item in ordered_ids]
        selectable = [
            item for item in relation_items
            if item["selectable_contract"]["eligible"] is True
        ]
        asc = sorted(selectable, key=lambda item: (item["sort"], item["id"]))
        desc = sorted(selectable, key=lambda item: (item["sort"], -item["id"]))
        below = [item for item in desc if item["sort"] < MODULE.TARGET_SORT]
        equal = [item for item in desc if item["sort"] == MODULE.TARGET_SORT]
        above = [item for item in desc if item["sort"] > MODULE.TARGET_SORT]
        render_models.append(
            {
                "model_id": model["id"],
                "model_code": model["code"],
                "hypotheses": {
                    "link_goods_order": [item["id"] for item in selectable],
                    "element_sort_then_id_asc": [item["id"] for item in asc],
                    "element_sort_then_id_desc": [item["id"] for item in desc],
                },
                "relation_items": relation_items,
                "expected_selectable_count": len(selectable),
                "expected_selectable_ids_as_set": sorted(item["id"] for item in selectable),
                "target_hypothesis": {
                    "target_sort": MODULE.TARGET_SORT,
                    "link_goods_append_position_zero_based": len(relation_items),
                    "sort_neighbor_before": below[-1] if below else None,
                    "same_sort_items": equal,
                    "sort_neighbor_after": above[0] if above else None,
                    "tie_break_is_unprovable_before_target_id_exists": bool(equal),
                },
            }
        )

    peer_elements = [linked_full[item] for item in MODULE.TEMPLATE_PEER_IDS]
    no_content_item = element(
        1200,
        "empty-option-baseline",
        (MODULE.LINK_GOODS_PROPERTY_ID, 1171, 1177),
    )
    no_content_item["fields"]["sort"] = 900
    no_content_item["sections"] = [
        {
            "id": MODULE.OPTIONS_SECTION_ID,
            "parent_id": 0,
            "name": "Options",
            "code": "options",
            "sort": 100,
            "active": True,
            "depth": 1,
        }
    ]
    union_ids = list(MODULE.EXPECTED_LINKED_OPTION_IDS)
    payload["phase1b_evidence"] = {
        "linked_option_union": {
            "ids": union_ids,
            "count": len(union_ids),
            "sha256": MODULE._evidence_sha256(union_ids),
            "expected_ids_from_pinned_audit": union_ids,
            "matches_pinned_audit": True,
        },
        "model_link_goods": model_links,
        "gur_model_count": 8,
        "linked_options": linked_summaries,
        "template_peers": {
            "peer_ids": list(MODULE.TEMPLATE_PEER_IDS),
            "elements": peer_elements,
            "full_snapshot_sha256": MODULE._evidence_sha256(peer_elements),
        },
        "render_order": {
            "candidate_sources": [
                "link_goods_order",
                "element_sort_then_id_asc",
                "element_sort_then_id_desc",
            ],
            "selectable_db_rule": "active_and_exactly_one_positive_filter_price",
            "target_sort_from_section_gap": MODULE.TARGET_SORT,
            "existing_union_items_at_target_sort": [],
            "target_sort_is_unique_in_linked_union": True,
            "models": render_models,
            "render_order_source": None,
            "requires_public_model_page_evidence": True,
        },
        "active_no_picture_no_text_options": {
            "section_id": MODULE.OPTIONS_SECTION_ID,
            "active_direct_section_elements_scanned": 62,
            "eligible_count": 1,
            "samples": [
                {
                    "id": no_content_item["id"],
                    "code": no_content_item["code"],
                    "fields": no_content_item["fields"],
                    "sections": no_content_item["sections"],
                    "property_shapes": property_shapes(no_content_item),
                    "full_snapshot_sha256": MODULE._evidence_sha256(no_content_item),
                    "public_url": (
                        f"{MODULE.PUBLIC_ORIGIN}/product/{no_content_item['code']}/"
                    ),
                }
            ],
            "samples_truncated": False,
        },
        "metadata_templates": {
            "iblock_page_url_templates": {
                "LIST_PAGE_URL": "/products/",
                "SECTION_PAGE_URL": "/products/#SECTION_CODE#/",
                "DETAIL_PAGE_URL": "/product/#ELEMENT_CODE#/",
            },
            "iblock_inherited_templates": {
                "available": False,
                "templates": None,
                "reason": "api_unavailable",
            },
            "section_inherited_templates": {
                "available": False,
                "templates": None,
                "reason": "api_unavailable",
            },
        },
        "public_verification_contract": {
            "model_urls": list(MODULE.PUBLIC_MODEL_URLS),
            "required_model_page_fields": [
                "http_status",
                "final_url",
                "self_canonical",
                "robots",
                "body_sha256",
                "ordered_selectable_option_ids",
                "ordered_selectable_option_sums",
            ],
            "render_order_source_rule": (
                "exactly_one_database_hypothesis_must_match_all_12_public_pages"
            ),
            "control_selector_contract": {
                "tag": "span",
                "required_classes": ["btn", "bg-theme-target"],
                "required_attributes": [
                    "data-product-id",
                    "data-sum",
                    "data-name",
                    "data-row-id",
                    "onclick",
                ],
                "onclick": "priceCalculator.toggleOption(this)",
            },
            "selectable_db_rule": "active_and_exactly_one_positive_filter_price",
            "no_content_policy_baseline_required": True,
        },
        "blockers": ["public_render_order_source_not_verified"],
        "phase1b_evidence_ready": False,
        "database_mutations": 0,
    }


def valid_payload(*, strong_count: int = 1, ready: bool = True) -> dict[str, object]:
    definitions = [
        property_definition(MODULE.LINK_GOODS_PROPERTY_ID, "LINK_GOODS"),
        property_definition(1171, "PRICE", "N"),
        property_definition(1177, "FILTER_PRICE", "N"),
    ]
    property_ids = (MODULE.LINK_GOODS_PROPERTY_ID, 1171, 1177)
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
    blockers = [] if strong_count == 1 else ["relation_property_or_direction_is_ambiguous"]
    payload = {
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
            "anchor_sort": 505,
            "sections": [
                {
                    "section": {"id": 10},
                    "sibling_count": 2,
                    "anchor_position_zero_based": 0,
                    "previous": None,
                    "anchor": {"id": MODULE.ANCHOR_ID, "sort": 505},
                    "next": {"id": 878, "sort": 510},
                    "sort_gap_after_anchor": 5,
                    "siblings": [
                        {"id": MODULE.ANCHOR_ID, "sort": 505},
                        {"id": 878, "sort": 510},
                    ],
                }
            ],
            "global_sort_plan": {
                "candidate_sort": MODULE.TARGET_SORT,
                "unambiguous": True,
                "requires_sibling_resort": False,
            },
        },
        "target_duplicates": {
            "by_exact_name": [],
            "by_exact_code": [],
            "union": [],
        },
        "base_audit_gates_passed": blockers == [],
        "ready_for_apply": False,
        "blockers": blockers,
    }
    add_phase1b(payload)
    return payload


def public_html(
    url: str,
    controls: list[tuple[int, int | float, str]],
    *,
    base_product_id: int,
    duplicate_first: bool = False,
    canonical: str | None = None,
    robots: str = "index, follow",
    image_state: str = "none",
    extra_near_html: str = "",
) -> bytes:
    rendered_controls = list(controls)
    if duplicate_first and rendered_controls:
        rendered_controls.insert(1, rendered_controls[0])
    control_html = "".join(
        (
            '<span class="btn option-control bg-theme-target" '
            f'data-product-id="{product_id}" data-sum="{price_sum}" '
            f'data-name="{name}" data-row-id="bx_3966226736_{product_id}" '
            'onclick="priceCalculator.toggleOption(this)"></span>'
        )
        for product_id, price_sum, name in rendered_controls
    )
    if image_state == "placeholder":
        image_html = (
            '<div class="product gallery"><img src="/upload/no-photo.png" '
            'alt="no photo"></div>'
        )
    elif image_state == "nonplaceholder":
        image_html = (
            '<div class="product gallery"><img src="/upload/real-option.jpg" '
            'alt="option"></div>'
        )
    elif image_state == "mixed":
        image_html = (
            '<div class="product gallery"><img src="/upload/no-photo.png" '
            'alt="no photo"><img src="/upload/real-option.jpg" alt="option"></div>'
        )
    elif image_state == "none":
        image_html = ""
    else:
        raise AssertionError("unknown fixture image state")
    return (
        "<!doctype html><html><head>"
        f'<title>Fixture</title><link rel="canonical" href="{canonical or url}">'
        f'<meta name="robots" content="{robots}">'
        "</head><body>"
        f'<div class="main-product" data-product-id="{base_product_id}"></div>'
        f'{extra_near_html}<section class="additional-options">{control_html}</section>{image_html}'
        "</body></html>"
    ).encode("utf-8")


def public_fetcher(
    remote: dict[str, object],
    *,
    source: str = "element_sort_then_id_desc",
    duplicate_code: str | None = None,
    canonical_mismatch_code: str | None = None,
    robots_noindex_code: str | None = None,
    wrong_sum_code: str | None = None,
    wrong_name_code: str | None = None,
    extra_near_code: str | None = None,
    extra_near_html: str = "",
    baseline_image_state: str = "placeholder",
):
    phase = remote["phase1b_evidence"]
    render_models = phase["render_order"]["models"]
    bodies: dict[str, bytes] = {}
    for code, url, render_model in zip(
        MODULE.MODEL_CODES, MODULE.PUBLIC_MODEL_URLS, render_models
    ):
        relation_by_id = {item["id"]: item for item in render_model["relation_items"]}
        controls = [
            (
                product_id,
                relation_by_id[product_id]["selectable_contract"]["positive_filter_price"],
                relation_by_id[product_id]["name"],
            )
            for product_id in render_model["hypotheses"][source]
        ]
        if controls and code == wrong_sum_code:
            product_id, price_sum, name = controls[0]
            controls[0] = (product_id, price_sum + 1, name)
        if controls and code == wrong_name_code:
            product_id, price_sum, name = controls[0]
            controls[0] = (product_id, price_sum, name + " drift")
        bodies[url] = public_html(
            url,
            controls,
            base_product_id=render_model["model_id"],
            duplicate_first=code == duplicate_code,
            canonical=("https://rosomaha-rus.ru/product/wrong/" if code == canonical_mismatch_code else None),
            robots="noindex, follow" if code == robots_noindex_code else "index, follow",
            extra_near_html=extra_near_html if code == extra_near_code else "",
        )
    sample = phase["active_no_picture_no_text_options"]["samples"][0]
    bodies[sample["public_url"]] = public_html(
        sample["public_url"], [], base_product_id=sample["id"], image_state=baseline_image_state
    )

    def fetch(url: str, allowed_urls: frozenset[str]) -> dict[str, object]:
        if url not in allowed_urls or url not in bodies:
            raise AssertionError("test fetch escaped exact allowlist")
        return {
            "http_status": 200,
            "final_url": url,
            "content_type": "text/html; charset=UTF-8",
            "body": bodies[url],
        }

    return fetch


def remote_stdout_frame(
    payload: object,
    *,
    script_sha256: str = "a" * 64,
    php_version: str = "8.2.29",
) -> str:
    raw = json.dumps(
        payload, ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8")
    return "\n".join(
        [
            f"__ROSOMAHA_FAN_PHP_VERSION__={php_version}",
            f"__ROSOMAHA_FAN_PHP_SHA256__={script_sha256}",
            "__ROSOMAHA_FAN_PHP_LINT__=ok",
            f"__ROSOMAHA_FAN_JSON_BYTES__={len(raw)}",
            f"__ROSOMAHA_FAN_JSON_SHA256__={hashlib.sha256(raw).hexdigest()}",
            "__ROSOMAHA_FAN_JSON_BASE64__="
            + base64.b64encode(raw).decode("ascii"),
            "",
        ]
    )


def remote_preflight_error_frame(
    error_code: str,
    *,
    script_sha256: str = "a" * 64,
) -> str:
    return (
        f"{MODULE.PREFLIGHT_ERROR_PREFIX}{error_code}\n"
        f"{MODULE.PREFLIGHT_SHA_PREFIX}{script_sha256}\n"
    )


def remote_error_payload(
    *,
    error_code: str = "helper_contract_violation",
    error_class: str = "RuntimeException",
    audit_stage: str = "linked_options_read",
    origin_is_helper: bool = True,
    helper_line: int | None = 826,
) -> dict[str, object]:
    message = b"fixture diagnostic message"
    return {
        "status": "error",
        "mode": "audit",
        "phase": "schema_and_relation_discovery",
        "apply_supported": False,
        "database_mutations": 0,
        "ready_for_apply": False,
        "error_code": error_code,
        "error_class": error_class,
        "audit_stage": audit_stage,
        "origin_is_helper": origin_is_helper,
        "helper_line": helper_line,
        "message_bytes": len(message),
        "message_truncated": False,
        "message_sha256": hashlib.sha256(message).hexdigest(),
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
        self.assertIn("ROSOMAHA_FAN_LINK_GOODS_PROPERTY_ID = 1219", source)
        self.assertIn("ROSOMAHA_FAN_EXPECTED_LINKED_OPTION_IDS", source)
        self.assertIn("active_and_exactly_one_positive_filter_price", source)
        self.assertIn("element_sort_then_id_desc", source)
        self.assertIn("'ready_for_apply' => false", source)
        self.assertIn("__ROSOMAHA_FAN_JSON_BYTES__=", source)
        self.assertIn("__ROSOMAHA_FAN_JSON_SHA256__=", source)
        self.assertIn("__ROSOMAHA_FAN_JSON_BASE64__=", source)
        self.assertIn("base64_encode($json)", source)
        self.assertIn("rosomahaFanErrorEvidence($error, $auditStage)", source)
        self.assertNotIn("rosomahaFanSafeError", source)
        self.assertNotIn("'error' =>", source)
        for error_code in (
            "template_peer_outside_link_goods_union",
            "link_goods_non_element_value",
            "link_goods_duplicate_element_id",
            "render_evidence_missing_linked_option",
        ):
            self.assertIn("'" + error_code + "'", source)
            self.assertIn(error_code, MODULE.REMOTE_KNOWN_HELPER_ERROR_CODES)

    def test_apply_and_recover_are_blocked_before_dispatch(self) -> None:
        execute = Mock()
        with patch.object(MODULE, "run_audit", execute):
            self.assertEqual(MODULE.main(["--apply"]), 2)
            self.assertEqual(MODULE.main(["--recover=anything"]), 2)
            self.assertEqual(MODULE.main(["--rollback=anything"]), 2)
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
        self.assertIn(f"[ \"$payload_sha256\" != '{digest}' ]", command)
        self.assertIn(f"realpath -- '{MODULE.SITE_ROOT}'", command)
        self.assertIn(
            f"[ ! -f '{MODULE.SITE_ROOT}/bitrix/modules/main/include/prolog_before.php' ]",
            command,
        )
        self.assertIn("$php_binary\" -l", command)
        self.assertIn("-- 'audit'", command)
        self.assertNotIn("-- 'apply'", command)
        self.assertNotIn("-- 'recover'", command)
        self.assertTrue(all(candidate.startswith("/") for candidate in MODULE.PHP_CANDIDATES))
        for binary in ("base64", "sha256sum", "awk", "realpath", "timeout"):
            self.assertIn(f"/usr/bin/{binary}", command)
        self.assertNotIn("command -v", command)
        self.assertNotIn("test \"$payload_sha256\"", command)
        self.assertNotIn("test -f", command)
        self.assertNotIn("Decoded helper marker is missing", command)
        self.assertNotIn("Pinned PHP series was not found", command)
        self.assertIn("trap 'rosomaha_fan_on_preflight_exit' EXIT", command)
        self.assertIn("trap - EXIT", command)
        self.assertIn("*[!0-9]*", command)
        for error_code in MODULE.PREFLIGHT_ERROR_CODES:
            self.assertIn(error_code, command)
        self.assertTrue(command.isascii())
        self.assertLessEqual(
            len(command.encode("ascii")), MODULE.MAX_REMOTE_COMMAND_BYTES
        )
        self.assertNotIn("script_payload", command)
        self.assertNotIn("decoded_script", command)
        self.assertNotIn("decoded_with_marker", command)
        self.assertNotIn("<<", command)
        self.assertNotIn("mktemp", command)
        self.assertNotIn("/tmp/", command)
        self.assertEqual(command.count("rosomaha_fan_payload 2>/dev/null"), 3)
        literal = re.search(
            r"printf '%s' '([A-Za-z0-9+/]+={0,2})' \| /usr/bin/base64 -d",
            command,
        )
        self.assertIsNotNone(literal)
        assert literal is not None
        self.assertEqual(
            base64.b64decode(literal.group(1), validate=True), script_bytes
        )

    def test_payload_function_is_repeatable_and_preserves_exact_unicode_bytes(self) -> None:
        self.assertTrue(GIT_BASH_PATH.is_file())
        payload = (
            "<?php\n"
            "$value = \"before\u2028middle\u2029after\";\n"
        ).encode("utf-8")
        self.assertTrue(payload.endswith(b"\n"))
        self.assertIn("\u2028".encode("utf-8"), payload)
        payload_function = MODULE.build_payload_function(payload)
        shell = payload_function + "\n" + "\n".join(
            "rosomaha_fan_payload" for _ in range(3)
        ) + "\n"
        result = subprocess.run(
            [str(GIT_BASH_PATH)],
            input=shell.encode("ascii"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=10,
            check=False,
        )
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stderr, b"")
        self.assertEqual(result.stdout, payload * 3)
        expected_sha256 = hashlib.sha256(payload).hexdigest()
        for index in range(3):
            chunk = result.stdout[index * len(payload):(index + 1) * len(payload)]
            self.assertEqual(hashlib.sha256(chunk).hexdigest(), expected_sha256)

    def test_tampered_streaming_payload_emits_exact_payload_sha_preflight(self) -> None:
        self.assertTrue(GIT_BASH_PATH.is_file())
        script_bytes = PHP_PATH.read_bytes()
        command, digest = MODULE.build_remote_command(script_bytes)
        encoded = base64.b64encode(script_bytes).decode("ascii")
        replacement = ("A" if encoded[0] != "A" else "B") + encoded[1:]
        tampered = command.replace(encoded, replacement, 1)
        self.assertNotEqual(tampered, command)
        result = subprocess.run(
            [str(GIT_BASH_PATH)],
            input=tampered.encode("ascii"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=15,
            check=False,
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stderr, b"")
        error_code = MODULE.parse_remote_preflight_error_frame(
            result.stdout.decode("ascii", errors="strict"),
            expected_script_sha256=digest,
        )
        self.assertEqual(error_code, "payload_sha")

    def test_remote_command_size_cap_blocks_before_connection(self) -> None:
        with patch.object(
            MODULE, "validate_php_source", return_value="a" * 64
        ):
            with self.assertRaises(RuntimeError):
                MODULE.build_remote_command(b"x" * 90_000)

    def test_nonempty_remote_stderr_fails_closed(self) -> None:
        client = Mock()
        script_sha256 = hashlib.sha256(PHP_PATH.read_bytes()).hexdigest()
        with patch.object(
            MODULE,
            "run_remote_command",
            return_value=(
                0,
                remote_stdout_frame(
                    valid_payload(), script_sha256=script_sha256
                ),
                "unexpected warning",
            ),
        ):
            with self.assertRaises(MODULE.RemoteAuditError):
                MODULE.execute_remote("audit", connect_fn=Mock(return_value=client))
        client.close.assert_called_once_with()


class RemoteFrameProtocolTests(unittest.TestCase):
    def test_unicode_line_separators_survive_ascii_frame_without_splitlines(self) -> None:
        payload = {
            "status": "ok",
            "value": "before\u2028middle\u2029after\u0085tail",
        }
        stdout = remote_stdout_frame(payload)
        # This is the exact old failure mode: str.splitlines sees separators
        # inside raw Unicode JSON.  The new transport contains ASCII only.
        self.assertTrue(stdout.isascii())
        parsed, version = MODULE.parse_remote_stdout_frame(
            stdout, expected_script_sha256="a" * 64
        )
        self.assertEqual(parsed, payload)
        self.assertEqual(version, "8.2.29")

    def test_missing_duplicate_corrupt_or_contaminated_frame_fails_closed(self) -> None:
        valid = remote_stdout_frame({"status": "ok"})
        lines = valid.split("\n")
        cases = {
            "missing_payload": "\n".join(lines[:-2] + [""]),
            "duplicate_frame": "\n".join(lines[:-1] + [lines[-2], ""]),
            "unexpected_stdout": "unexpected output\n" + valid,
            "missing_final_newline": valid.rstrip("\n"),
            "contaminated_version_value": valid.replace(
                "__ROSOMAHA_FAN_PHP_VERSION__=8.2.29",
                "__ROSOMAHA_FAN_PHP_VERSION__=8.2.29 unexpected",
                1,
            ),
            "wrong_sha": valid.replace(
                "__ROSOMAHA_FAN_JSON_SHA256__=",
                "__ROSOMAHA_FAN_JSON_SHA256__=" + "0" * 64 + "#",
                1,
            ),
            "corrupt_base64": valid.replace(
                "__ROSOMAHA_FAN_JSON_BASE64__=e",
                "__ROSOMAHA_FAN_JSON_BASE64__=!",
                1,
            ),
        }
        for label, stdout in cases.items():
            with self.subTest(case=label):
                with self.assertRaises(MODULE.RemoteAuditError):
                    MODULE.parse_remote_stdout_frame(
                        stdout, expected_script_sha256="a" * 64
                    )

    def test_remote_channel_waits_for_full_eof_after_exit_status(self) -> None:
        complete = remote_stdout_frame({"status": "ok"})
        split_at = complete.index("__ROSOMAHA_FAN_JSON_BASE64__=") + 35
        chunks = [complete[:split_at].encode("ascii"), complete[split_at:].encode("ascii")]

        class LateTailChannel:
            def __init__(self) -> None:
                self.calls = 0
                self.index = 0
                self.eof_received = False
                self.closed = False

            def recv_ready(self) -> bool:
                self.calls += 1
                if self.index == 0:
                    return self.calls == 1
                if self.index == 1:
                    return self.calls >= 4
                self.eof_received = True
                return False

            def recv(self, _size: int) -> bytes:
                chunk = chunks[self.index]
                self.index += 1
                return chunk

            def recv_stderr_ready(self) -> bool:
                return False

            def exit_status_ready(self) -> bool:
                return True

            def recv_exit_status(self) -> int:
                return 0

            def close(self) -> None:
                self.closed = True

        class FakeStdout:
            def __init__(self, channel) -> None:
                self.channel = channel

        channel = LateTailChannel()
        client = Mock()
        client.exec_command.return_value = (None, FakeStdout(channel), None)
        status, stdout, stderr = MODULE.run_remote_command(
            client, "fixed-audit", timeout_seconds=1
        )
        self.assertEqual(status, 0)
        self.assertEqual(stdout, complete)
        self.assertEqual(stderr, "")
        self.assertTrue(channel.eof_received)
        self.assertTrue(channel.closed)
        parsed, _ = MODULE.parse_remote_stdout_frame(
            stdout, expected_script_sha256="a" * 64
        )
        self.assertEqual(parsed, {"status": "ok"})

    def test_each_boundary_failure_writes_hash_only_immutable_frame_receipt(self) -> None:
        script_sha256 = hashlib.sha256(PHP_PATH.read_bytes()).hexdigest()
        valid = remote_stdout_frame(
            {"status": "ok"}, script_sha256=script_sha256
        )
        cgi_crlf = (
            "Content-type: text/html; charset=UTF-8\r\n\r\n"
            + valid.replace("\n", "\r\n")
        )
        cases = {
            "empty": "",
            "missing_final_lf": valid.rstrip("\n"),
            "cgi_crlf_contamination": cgi_crlf,
            "over_limit": "X" * (MODULE.MAX_STDOUT_BYTES + 1),
        }
        expected_edge_classes = {
            "empty": ("empty", "empty"),
            "missing_final_lf": ("ascii_printable", "ascii_printable"),
            "cgi_crlf_contamination": ("ascii_printable", "lf"),
            "over_limit": ("ascii_printable", "ascii_printable"),
        }
        with tempfile.TemporaryDirectory() as directory:
            for label, stdout in cases.items():
                with self.subTest(case=label):
                    path = Path(directory) / f"{label}.json"

                    def write_frame(
                        raw_stdout: str,
                        **metadata: object,
                    ) -> Path:
                        self.assertEqual(raw_stdout, stdout)
                        return MODULE.write_frame_error_receipt(
                            raw_stdout, path=path, **metadata
                        )

                    client = Mock()
                    with patch.object(
                        MODULE,
                        "run_remote_command",
                        return_value=(1, stdout, ""),
                    ):
                        with self.assertRaises(
                            MODULE.RemoteFrameReportedError
                        ) as raised:
                            MODULE.execute_remote(
                                "audit",
                                connect_fn=Mock(return_value=client),
                                frame_error_receipt_fn=write_frame,
                            )
                    self.assertEqual(
                        raised.exception.error_code, "frame_boundaries_invalid"
                    )
                    receipt_text = path.read_text(encoding="utf-8")
                    receipt = json.loads(receipt_text)
                    frame = receipt["frame"]
                    raw_bytes = stdout.encode("utf-8")
                    self.assertEqual(receipt["error_type"], "FRAME_ERROR")
                    self.assertEqual(receipt["database_mutations"], 0)
                    self.assertFalse(receipt["apply_supported"])
                    self.assertEqual(
                        receipt["parser_error_code"], "frame_boundaries_invalid"
                    )
                    self.assertTrue(
                        receipt["transport"]["eof_or_closed_drain_gate_passed"]
                    )
                    self.assertEqual(frame["total_bytes"], len(raw_bytes))
                    self.assertEqual(
                        frame["sha256"], hashlib.sha256(raw_bytes).hexdigest()
                    )
                    self.assertEqual(frame["ascii_only"], raw_bytes.isascii())
                    self.assertEqual(frame["ends_with_lf"], stdout.endswith("\n"))
                    self.assertEqual(frame["contains_cr"], "\r" in stdout)
                    self.assertEqual(
                        (
                            frame["first_byte_class"],
                            frame["last_byte_class"],
                        ),
                        expected_edge_classes[label],
                    )
                    self.assertEqual(
                        frame["split_lf_line_count"], len(stdout.split("\n"))
                    )
                    if frame["line_diagnostics_complete"]:
                        self.assertEqual(
                            len(frame["line_diagnostics"]),
                            frame["split_lf_line_count"],
                        )
                        for line in frame["line_diagnostics"]:
                            self.assertEqual(
                                set(line),
                                {
                                    "index",
                                    "byte_length",
                                    "sha256",
                                    "marker_class",
                                    "ends_with_cr",
                                },
                            )
                    else:
                        self.assertEqual(frame["line_diagnostics"], [])
                    if label == "cgi_crlf_contamination":
                        self.assertTrue(
                            any(
                                line["ends_with_cr"]
                                for line in frame["line_diagnostics"]
                            )
                        )
                        self.assertEqual(
                            [
                                line["marker_class"]
                                for line in frame["line_diagnostics"]
                            ],
                            [
                                "unknown",
                                "unknown",
                                "php_version",
                                "php_script_sha256",
                                "php_lint",
                                "json_bytes",
                                "json_sha256",
                                "json_base64",
                                "unknown",
                            ],
                        )
                    if label == "missing_final_lf":
                        self.assertEqual(
                            [
                                line["marker_class"]
                                for line in frame["line_diagnostics"]
                            ],
                            [
                                "php_version",
                                "php_script_sha256",
                                "php_lint",
                                "json_bytes",
                                "json_sha256",
                                "json_base64",
                            ],
                        )
                    if stdout:
                        self.assertNotIn(stdout, receipt_text)
                    self.assertFalse(bool(path.stat().st_mode & stat.S_IWUSR))
                    os.chmod(path, stat.S_IWUSR | stat.S_IRUSR)

    def test_unknown_frame_line_is_classified_and_hashed_without_raw_leak(self) -> None:
        script_sha256 = hashlib.sha256(PHP_PATH.read_bytes()).hexdigest()
        sentinel = "HOSTILE_FRAME_SENTINEL_MUST_NOT_ECHO"
        stdout = sentinel + "\n"
        client = Mock()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "frame-error.json"

            def write_frame(raw_stdout: str, **metadata: object) -> Path:
                return MODULE.write_frame_error_receipt(
                    raw_stdout, path=path, **metadata
                )

            with patch.object(
                MODULE,
                "run_remote_command",
                return_value=(1, stdout, ""),
            ):
                with self.assertRaises(MODULE.RemoteFrameReportedError) as raised:
                    MODULE.execute_remote(
                        "audit",
                        connect_fn=Mock(return_value=client),
                        frame_error_receipt_fn=write_frame,
                    )
            receipt_text = path.read_text(encoding="utf-8")
            receipt = json.loads(receipt_text)
            self.assertEqual(
                raised.exception.error_code, "frame_line_count_invalid"
            )
            self.assertNotIn(sentinel, receipt_text)
            self.assertEqual(
                receipt["frame"]["line_diagnostics"][0]["marker_class"],
                "unknown",
            )
            self.assertEqual(
                receipt["frame"]["line_diagnostics"][0]["byte_length"],
                len(sentinel.encode("ascii")),
            )
            self.assertEqual(
                receipt["frame"]["line_diagnostics"][0]["sha256"],
                hashlib.sha256(sentinel.encode("ascii")).hexdigest(),
            )
            os.chmod(path, stat.S_IWUSR | stat.S_IRUSR)

        many_lines = "x\n" * MODULE.MAX_FRAME_DIAGNOSTIC_LINES
        bounded = MODULE.build_stdout_frame_diagnostics(many_lines)
        self.assertEqual(
            bounded["split_lf_line_count"],
            MODULE.MAX_FRAME_DIAGNOSTIC_LINES + 1,
        )
        self.assertFalse(bounded["line_diagnostics_complete"])
        self.assertEqual(bounded["line_diagnostics"], [])

    def test_status_one_authenticated_error_writes_exact_receipt_before_raising(self) -> None:
        script_sha256 = hashlib.sha256(PHP_PATH.read_bytes()).hexdigest()
        payload = remote_error_payload()
        client = Mock()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "authenticated-error.json"

            def write_error(
                remote_error: dict[str, object], *, runtime: dict[str, object]
            ) -> Path:
                return MODULE.write_error_receipt(
                    remote_error, runtime=runtime, path=path
                )

            with patch.object(
                MODULE,
                "run_remote_command",
                return_value=(
                    1,
                    remote_stdout_frame(payload, script_sha256=script_sha256),
                    "",
                ),
            ):
                with self.assertRaises(MODULE.RemoteHelperReportedError) as raised:
                    MODULE.execute_remote(
                        "audit",
                        connect_fn=Mock(return_value=client),
                        error_receipt_fn=write_error,
                    )

            self.assertTrue(path.is_file())
            self.assertFalse(bool(path.stat().st_mode & stat.S_IWUSR))
            receipt = json.loads(path.read_text(encoding="utf-8"))
            encoded_receipt = path.read_text(encoding="utf-8")
            self.assertEqual(receipt["status"], "error")
            self.assertEqual(receipt["database_mutations"], 0)
            self.assertFalse(receipt["apply_supported"])
            self.assertFalse(receipt["ready_for_apply"])
            self.assertEqual(receipt["runtime"]["remote_exit_status"], 1)
            self.assertEqual(receipt["remote_error"]["error_code"], payload["error_code"])
            self.assertEqual(
                receipt["remote_error"]["safe_summary"],
                MODULE.REMOTE_ERROR_SAFE_SUMMARIES[str(payload["error_code"])],
            )
            self.assertEqual(
                set(receipt["remote_error"]), set(payload) | {"safe_summary"}
            )
            self.assertNotIn("fixture diagnostic message", encoded_receipt)
            self.assertEqual(raised.exception.receipt_path, path)
            self.assertIn("helper_line=826", str(raised.exception))
            os.chmod(path, stat.S_IWUSR | stat.S_IRUSR)
        client.close.assert_called_once_with()

    def test_status_one_hostile_payload_never_writes_any_error_receipt(self) -> None:
        script_sha256 = hashlib.sha256(PHP_PATH.read_bytes()).hexdigest()
        client = Mock()
        writer = Mock()
        hostile_marker = "HOSTILE_SENTINEL_MUST_NOT_ECHO"
        hostile = remote_error_payload()
        hostile["raw_detail"] = hostile_marker
        bool_mutation_counter = remote_error_payload()
        bool_mutation_counter["database_mutations"] = False
        cases = {
            "hostile_extra_field": remote_stdout_frame(
                hostile, script_sha256=script_sha256
            ),
            "boolean_mutation_counter": remote_stdout_frame(
                bool_mutation_counter, script_sha256=script_sha256
            ),
        }
        for label, stdout in cases.items():
            with self.subTest(case=label):
                with patch.object(
                    MODULE,
                    "run_remote_command",
                    return_value=(1, stdout, ""),
                ):
                    with self.assertRaises(MODULE.RemoteAuditError) as raised:
                        MODULE.execute_remote(
                            "audit",
                            connect_fn=Mock(return_value=client),
                            error_receipt_fn=writer,
                            frame_error_receipt_fn=writer,
                        )
                self.assertNotIn(hostile_marker, str(raised.exception))
        writer.assert_not_called()

    def test_exit_status_and_payload_status_must_match_exactly(self) -> None:
        script_sha256 = hashlib.sha256(PHP_PATH.read_bytes()).hexdigest()
        writer = Mock()
        cases = {
            "status_one_success_payload": (
                1,
                remote_stdout_frame(valid_payload(), script_sha256=script_sha256),
            ),
            "status_zero_error_payload": (
                0,
                remote_stdout_frame(
                    remote_error_payload(), script_sha256=script_sha256
                ),
            ),
        }
        for label, (status, stdout) in cases.items():
            with self.subTest(case=label):
                client = Mock()
                with patch.object(
                    MODULE,
                    "run_remote_command",
                    return_value=(status, stdout, ""),
                ):
                    with self.assertRaises(MODULE.RemoteAuditError):
                        MODULE.execute_remote(
                            "audit",
                            connect_fn=Mock(return_value=client),
                            error_receipt_fn=writer,
                        )
                client.close.assert_called_once_with()
        writer.assert_not_called()


class RemotePreflightProtocolTests(unittest.TestCase):
    def test_every_preflight_enum_writes_exact_immutable_receipt(self) -> None:
        script_sha256 = hashlib.sha256(PHP_PATH.read_bytes()).hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            for error_code in sorted(MODULE.PREFLIGHT_ERROR_CODES):
                with self.subTest(error_code=error_code):
                    path = Path(directory) / f"{error_code}.json"

                    def write_preflight(
                        reported_code: str,
                        **metadata: object,
                    ) -> Path:
                        self.assertEqual(reported_code, error_code)
                        return MODULE.write_preflight_error_receipt(
                            reported_code, path=path, **metadata
                        )

                    client = Mock()
                    frame_writer = Mock()
                    helper_writer = Mock()
                    with patch.object(
                        MODULE,
                        "run_remote_command",
                        return_value=(
                            1,
                            remote_preflight_error_frame(
                                error_code, script_sha256=script_sha256
                            ),
                            "",
                        ),
                    ):
                        with self.assertRaises(
                            MODULE.RemotePreflightReportedError
                        ) as raised:
                            MODULE.execute_remote(
                                "audit",
                                connect_fn=Mock(return_value=client),
                                error_receipt_fn=helper_writer,
                                frame_error_receipt_fn=frame_writer,
                                preflight_error_receipt_fn=write_preflight,
                            )
                    receipt = json.loads(path.read_text(encoding="utf-8"))
                    self.assertEqual(raised.exception.error_code, error_code)
                    self.assertEqual(receipt["error_type"], "PREFLIGHT_ERROR")
                    self.assertEqual(receipt["preflight_error_code"], error_code)
                    self.assertEqual(receipt["remote_exit_status"], 1)
                    self.assertEqual(
                        receipt["expected_php_script_sha256"], script_sha256
                    )
                    self.assertEqual(receipt["database_mutations"], 0)
                    self.assertFalse(receipt["apply_supported"])
                    self.assertFalse(receipt["ready_for_apply"])
                    self.assertFalse(bool(path.stat().st_mode & stat.S_IWUSR))
                    frame_writer.assert_not_called()
                    helper_writer.assert_not_called()
                    client.close.assert_called_once_with()
                    os.chmod(path, stat.S_IWUSR | stat.S_IRUSR)

    def test_preflight_corruption_or_contamination_falls_back_to_frame_receipt(self) -> None:
        script_sha256 = hashlib.sha256(PHP_PATH.read_bytes()).hexdigest()
        sentinel = "HOSTILE_PREFLIGHT_SENTINEL_MUST_NOT_ECHO"
        valid = remote_preflight_error_frame(
            "prolog_missing", script_sha256=script_sha256
        )
        cases = {
            "unknown_enum": remote_preflight_error_frame(
                sentinel, script_sha256=script_sha256
            ),
            "wrong_sha": remote_preflight_error_frame(
                "prolog_missing", script_sha256="0" * 64
            ),
            "extra_line": valid + sentinel + "\n",
            "crlf": valid.replace("\n", "\r\n"),
            "missing_lf": valid.rstrip("\n"),
            "leading_contamination": sentinel + "\n" + valid,
        }
        for label, stdout in cases.items():
            with self.subTest(case=label):
                client = Mock()
                frame_writer = Mock(return_value=Path("frame-error.json"))
                preflight_writer = Mock()
                with patch.object(
                    MODULE,
                    "run_remote_command",
                    return_value=(1, stdout, ""),
                ):
                    with self.assertRaises(
                        MODULE.RemoteFrameReportedError
                    ) as raised:
                        MODULE.execute_remote(
                            "audit",
                            connect_fn=Mock(return_value=client),
                            frame_error_receipt_fn=frame_writer,
                            preflight_error_receipt_fn=preflight_writer,
                        )
                self.assertNotIn(sentinel, str(raised.exception))
                preflight_writer.assert_not_called()
                frame_writer.assert_called_once()

    def test_preflight_exit_status_or_stderr_mismatch_is_rejected(self) -> None:
        script_sha256 = hashlib.sha256(PHP_PATH.read_bytes()).hexdigest()
        stdout = remote_preflight_error_frame(
            "prolog_missing", script_sha256=script_sha256
        )
        frame_writer = Mock(return_value=Path("frame-error.json"))
        preflight_writer = Mock()
        with patch.object(
            MODULE,
            "run_remote_command",
            return_value=(0, stdout, ""),
        ):
            with self.assertRaises(MODULE.RemoteFrameReportedError):
                MODULE.execute_remote(
                    "audit",
                    connect_fn=Mock(return_value=Mock()),
                    frame_error_receipt_fn=frame_writer,
                    preflight_error_receipt_fn=preflight_writer,
                )
        frame_writer.assert_called_once()
        preflight_writer.assert_not_called()

        frame_writer.reset_mock()
        with patch.object(
            MODULE,
            "run_remote_command",
            return_value=(1, stdout, "unexpected stderr"),
        ):
            with self.assertRaises(MODULE.RemoteAuditError) as raised:
                MODULE.execute_remote(
                    "audit",
                    connect_fn=Mock(return_value=Mock()),
                    frame_error_receipt_fn=frame_writer,
                    preflight_error_receipt_fn=preflight_writer,
                )
        self.assertNotIn("unexpected stderr", str(raised.exception))
        frame_writer.assert_not_called()
        preflight_writer.assert_not_called()


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
        payload["base_audit_gates_passed"] = False
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


class Phase1bPayloadTests(unittest.TestCase):
    def test_exact_union_ordered_arrays_peers_and_target_sort_are_accepted(self) -> None:
        normalized = MODULE.normalize_remote_payload(valid_payload())
        phase = normalized["phase1b_evidence"]
        self.assertEqual(phase["linked_option_union"]["count"], 62)
        self.assertEqual(phase["gur_model_count"], 8)
        self.assertEqual(
            phase["template_peers"]["peer_ids"], list(MODULE.TEMPLATE_PEER_IDS)
        )
        self.assertTrue(phase["render_order"]["target_sort_is_unique_in_linked_union"])
        self.assertFalse(phase["phase1b_evidence_ready"])

    def test_ordered_link_hash_and_union_drift_fail_closed(self) -> None:
        payload = valid_payload()
        payload["phase1b_evidence"]["model_link_goods"][0]["ordered_ids"].reverse()
        with self.assertRaises(MODULE.RemoteAuditError):
            MODULE.normalize_remote_payload(payload)

        payload = valid_payload()
        payload["phase1b_evidence"]["linked_option_union"]["ids"].pop()
        with self.assertRaises(MODULE.RemoteAuditError):
            MODULE.normalize_remote_payload(payload)

    def test_selectable_contract_and_render_hypotheses_cannot_drift(self) -> None:
        payload = valid_payload()
        linked = payload["phase1b_evidence"]["linked_options"][0]
        linked["filter_price_values"] = []
        with self.assertRaises(MODULE.RemoteAuditError):
            MODULE.normalize_remote_payload(payload)

        payload = valid_payload()
        payload["phase1b_evidence"]["render_order"]["models"][0]["hypotheses"][
            "element_sort_then_id_desc"
        ].reverse()
        with self.assertRaises(MODULE.RemoteAuditError):
            MODULE.normalize_remote_payload(payload)

        payload = valid_payload()
        contract = payload["phase1b_evidence"]["render_order"]["models"][0][
            "relation_items"
        ][0]["selectable_contract"]
        contract["normalization_evidence"][0]["raw_utf8_bytes"] = 999
        with self.assertRaises(MODULE.RemoteAuditError):
            MODULE.normalize_remote_payload(payload)

    def test_filter_price_strips_only_surrounding_ascii_whitespace_once(self) -> None:
        contract = MODULE._filter_price_contract(
            [normalized_value(" \t60000\r\n")], active=True
        )
        self.assertTrue(contract["eligible"])
        self.assertEqual(contract["positive_filter_price"], 60000)
        self.assertEqual(
            contract["normalization_rule"],
            "strip_ascii_surrounding_whitespace_once",
        )
        evidence = contract["normalization_evidence"]
        self.assertEqual(len(evidence), 1)
        self.assertEqual(evidence[0]["input_kind"], "string")
        self.assertTrue(evidence[0]["ascii_surrounding_whitespace_stripped"])
        self.assertEqual(evidence[0]["raw_utf8_bytes"], len(" \t60000\r\n"))
        self.assertEqual(evidence[0]["normalized_utf8_bytes"], 5)
        self.assertRegex(evidence[0]["raw_sha256"], r"^[a-f0-9]{64}$")
        self.assertRegex(evidence[0]["normalized_sha256"], r"^[a-f0-9]{64}$")
        self.assertNotIn("raw_value", evidence[0])
        self.assertNotIn("normalized_value", evidence[0])

        invalid_values = (
            "\u00a060000\u00a0",
            "60 000",
            "+60000",
            "60000,0",
            "60000\u2028",
        )
        for value in invalid_values:
            with self.subTest(value=repr(value)):
                invalid = MODULE._filter_price_contract(
                    [normalized_value(value)], active=True
                )
                self.assertFalse(invalid["eligible"])
                self.assertIsNone(invalid["positive_filter_price"])

        multiple = MODULE._filter_price_contract(
            [normalized_value("60000 "), normalized_value("7000")], active=True
        )
        self.assertFalse(multiple["eligible"])
        self.assertEqual(len(multiple["normalization_evidence"]), 2)

        with self.assertRaises(MODULE.RemoteAuditError):
            MODULE._filter_price_contract(
                [normalized_value("7" * 513)], active=True
            )

    def test_php_and_python_filter_price_normalization_contract_is_symmetric(self) -> None:
        source = PHP_PATH.read_text(encoding="utf-8")
        self.assertIn('trim($value, " \\t\\n\\r\\v\\f")', source)
        self.assertEqual(
            source.count("'normalization_rule' => "
                         "'strip_ascii_surrounding_whitespace_once'"),
            1,
        )
        for key in (
            "normalization_evidence",
            "raw_utf8_bytes",
            "raw_sha256",
            "normalized_utf8_bytes",
            "normalized_sha256",
            "ascii_surrounding_whitespace_stripped",
        ):
            self.assertIn("'" + key + "'", source)

    def test_metadata_and_public_contract_are_exact_and_bounded(self) -> None:
        payload = valid_payload()
        payload["phase1b_evidence"]["metadata_templates"]["unexpected"] = {}
        with self.assertRaises(MODULE.RemoteAuditError):
            MODULE.normalize_remote_payload(payload)

        payload = valid_payload()
        payload["phase1b_evidence"]["public_verification_contract"][
            "selectable_db_rule"
        ] = "active_only"
        with self.assertRaises(MODULE.RemoteAuditError):
            MODULE.normalize_remote_payload(payload)


class PublicEvidenceTests(unittest.TestCase):
    def test_exact_controls_prove_global_sort_while_content_gate_stays_blocked(self) -> None:
        remote = MODULE.normalize_remote_payload(valid_payload())
        public = MODULE.collect_public_evidence(
            remote, fetch_fn=public_fetcher(remote)
        )
        self.assertFalse(public["phase1b_evidence_ready"])
        self.assertEqual(public["status"], "blocked")
        self.assertEqual(public["render_order_source"], "element_sort_then_id_desc")
        self.assertEqual(public["matching_sources_across_all_12"], [
            "element_sort_then_id_desc"
        ])
        self.assertTrue(public["all_12_model_pages_contract_ok"])
        self.assertTrue(public["primary_sort_proven_on_all_12"])
        self.assertEqual(public["tie_rule_classification"], "id_desc")
        self.assertTrue(
            public["no_content_policy_baseline"]["policy_baseline_ok"]
        )
        self.assertFalse(public["content_publish_gate"])
        self.assertFalse(
            public["no_content_policy_baseline"]["fallback_image_counts_as_owned_content"]
        )
        self.assertEqual(
            public["no_content_policy_baseline"]["content_publish_blockers"],
            [
                "target_unique_server_rendered_copy_is_not_proven",
                "target_element_level_metadata_is_not_proven",
            ],
        )
        self.assertNotIn(
            "target_owned_product_image_is_not_proven",
            public["no_content_policy_baseline"]["content_publish_blockers"],
        )
        self.assertIn("content_publish_gate_is_blocked", public["blockers"])
        self.assertEqual(
            public["no_content_policy_baseline"]["image_placeholder_structural_state"],
            "placeholder_only_product_image_markup",
        )
        for page in public["model_pages"]:
            self.assertTrue(page["exact_selectable_set"])
            self.assertEqual(page["near_control_count"], 0)
            self.assertTrue(page["near_control_contract_ok"])
            self.assertEqual(page["near_controls"], [])
            self.assertNotIn("html", page)

    def test_duplicate_or_hidden_rendering_never_becomes_order_evidence(self) -> None:
        remote = MODULE.normalize_remote_payload(valid_payload())
        public = MODULE.collect_public_evidence(
            remote,
            fetch_fn=public_fetcher(remote, duplicate_code=MODULE.MODEL_CODES[0]),
        )
        self.assertFalse(public["phase1b_evidence_ready"])
        self.assertIsNone(public["render_order_source"])
        first = public["model_pages"][0]
        self.assertIn(
            "strict_selectable_control_ids_are_duplicated", first["page_blockers"]
        )

    def test_db_name_is_html_unescaped_exactly_once_before_comparison(self) -> None:
        url = MODULE.PUBLIC_MODEL_URLS[0]
        cases = (
            ('Опция &quot;А&quot;', 'Опция "А"'),
            ('Опция &amp;quot;А&amp;quot;', 'Опция &quot;А&quot;'),
        )
        for raw_db_name, parsed_public_name in cases:
            with self.subTest(raw_db_name=raw_db_name):
                price_values = [normalized_value("7000")]
                render_model = {
                    "model_id": 2000,
                    "relation_items": [
                        {
                            "id": 841,
                            "code": "option-841",
                            "name": raw_db_name,
                            "active": True,
                            "sort": 100,
                            "filter_price_values": price_values,
                            "selectable_contract": MODULE._filter_price_contract(
                                price_values, active=True
                            ),
                        }
                    ],
                    "expected_selectable_count": 1,
                    "expected_selectable_ids_as_set": [841],
                    "hypotheses": {
                        "link_goods_order": [841],
                        "element_sort_then_id_asc": [841],
                        "element_sort_then_id_desc": [841],
                    },
                }
                body = public_html(
                    url,
                    [(841, 7000, raw_db_name)],
                    base_product_id=2000,
                )
                page = MODULE._analyze_public_model_page(
                    MODULE.MODEL_CODES[0],
                    url,
                    {
                        "http_status": 200,
                        "final_url": url,
                        "content_type": "text/html; charset=UTF-8",
                        "body": body,
                    },
                    render_model,
                )
                self.assertEqual(
                    page["strict_controls"][0]["data_name"], parsed_public_name
                )
                self.assertEqual(page["name_mismatches"], [])
                self.assertNotIn(
                    "public_selectable_names_differ_from_db_contract",
                    page["page_blockers"],
                )

    def test_global_source_requires_unique_intersection_not_each_page_unique(self) -> None:
        remote = MODULE.normalize_remote_payload(valid_payload())
        # Some pages naturally cannot distinguish asc/desc.  The global
        # intersection is still uniquely desc because other pages contain ties.
        first_hypotheses = remote["phase1b_evidence"]["render_order"]["models"][0][
            "hypotheses"
        ]
        first_hypotheses["element_sort_then_id_asc"] = list(
            first_hypotheses["element_sort_then_id_desc"]
        )
        public = MODULE.collect_public_evidence(remote, fetch_fn=public_fetcher(remote))
        self.assertTrue(
            any(len(page["matching_hypotheses"]) > 1 for page in public["model_pages"])
        )
        self.assertEqual(public["matching_sources_across_all_12"], [
            "element_sort_then_id_desc"
        ])

        for render_model in remote["phase1b_evidence"]["render_order"]["models"]:
            desc = list(render_model["hypotheses"]["element_sort_then_id_desc"])
            render_model["hypotheses"]["link_goods_order"] = desc
            render_model["hypotheses"]["element_sort_then_id_asc"] = desc
        public = MODULE.collect_public_evidence(remote, fetch_fn=public_fetcher(remote))
        self.assertIsNone(public["render_order_source"])
        self.assertIn("public_render_order_source_is_not_unique", public["blockers"])

    def test_canonical_mismatch_blocks_even_when_control_order_matches(self) -> None:
        remote = MODULE.normalize_remote_payload(valid_payload())
        public = MODULE.collect_public_evidence(
            remote,
            fetch_fn=public_fetcher(
                remote, canonical_mismatch_code=MODULE.MODEL_CODES[-1]
            ),
        )
        self.assertFalse(public["phase1b_evidence_ready"])
        self.assertFalse(public["model_pages"][-1]["self_canonical"])
        self.assertIsNone(public["render_order_source"])

    def test_hidden_mobile_or_option_like_near_control_fails_closed(self) -> None:
        remote = MODULE.normalize_remote_payload(valid_payload())
        code = MODULE.MODEL_CODES[0]
        option_id = remote["phase1b_evidence"]["render_order"]["models"][0][
            "expected_selectable_ids_as_set"
        ][0]
        extra = (
            '<span class="btn bg-theme-target mobile hidden" '
            f'data-product-id="{option_id}" data-sum="100"></span>'
        )
        public = MODULE.collect_public_evidence(
            remote,
            fetch_fn=public_fetcher(
                remote,
                extra_near_code=code,
                extra_near_html=extra,
            ),
        )
        page = public["model_pages"][0]
        self.assertFalse(page["near_control_contract_ok"])
        self.assertIn("near_control_count_is_not_zero", page["near_control_blockers"])
        self.assertIn("near_control_contains_expected_option_id", page["near_control_blockers"])
        self.assertIn("near_control_is_hidden_or_disabled", page["near_control_blockers"])
        self.assertIn("near_control_is_option_like", page["near_control_blockers"])
        self.assertFalse(public["phase1b_evidence_ready"])

        model_id = remote["phase1b_evidence"]["render_order"]["models"][0]["model_id"]
        duplicate_base = (
            f'<div class="main-product" data-product-id="{model_id}" '
            'data-sum="1"></div>'
        )
        duplicated = MODULE.collect_public_evidence(
            remote,
            fetch_fn=public_fetcher(
                remote,
                extra_near_code=code,
                extra_near_html=duplicate_base + duplicate_base,
            ),
        )
        duplicate_page = duplicated["model_pages"][0]
        self.assertIn(
            "near_control_product_id_is_duplicated",
            duplicate_page["near_control_blockers"],
        )
        self.assertFalse(duplicate_page["near_control_contract_ok"])

    def test_any_single_paired_non_option_control_is_still_a_near_control_blocker(self) -> None:
        remote = MODULE.normalize_remote_payload(valid_payload())
        code = MODULE.MODEL_CODES[0]
        model_id = remote["phase1b_evidence"]["render_order"]["models"][0][
            "model_id"
        ]
        public = MODULE.collect_public_evidence(
            remote,
            fetch_fn=public_fetcher(
                remote,
                extra_near_code=code,
                extra_near_html=(
                    f'<div class="main-product" data-product-id="{model_id}" '
                    'data-sum="1"></div>'
                ),
            ),
        )
        page = public["model_pages"][0]
        self.assertEqual(page["near_control_count"], 1)
        self.assertIn("near_control_count_is_not_zero", page["near_control_blockers"])
        self.assertFalse(page["near_control_contract_ok"])

    def test_no_content_baseline_requires_exact_placeholder_only_state(self) -> None:
        remote = MODULE.normalize_remote_payload(valid_payload())
        expected_states = {
            "none": "no_semantic_product_image_markup",
            "nonplaceholder": "nonplaceholder_product_image_markup",
            "mixed": "mixed_placeholder_and_nonplaceholder_product_image_markup",
        }
        for fixture_state, observed_state in expected_states.items():
            with self.subTest(state=fixture_state):
                public = MODULE.collect_public_evidence(
                    remote,
                    fetch_fn=public_fetcher(
                        remote, baseline_image_state=fixture_state
                    ),
                )
                baseline = public["no_content_policy_baseline"]
                self.assertEqual(
                    baseline["image_placeholder_structural_state"], observed_state
                )
                self.assertFalse(baseline["policy_baseline_ok"])
                self.assertIn(
                    "image_placeholder_structural_state_is_not_exact_safe_baseline",
                    baseline["blockers"],
                )
                self.assertFalse(public["phase1b_evidence_ready"])

        placeholder = MODULE.collect_public_evidence(
            remote, fetch_fn=public_fetcher(remote, baseline_image_state="placeholder")
        )
        self.assertTrue(
            placeholder["no_content_policy_baseline"]["policy_baseline_ok"]
        )
        self.assertFalse(placeholder["content_publish_gate"])
        self.assertIn("content_publish_gate_is_blocked", placeholder["blockers"])

    def test_robots_wrong_sum_and_wrong_name_each_block_public_contract(self) -> None:
        remote = MODULE.normalize_remote_payload(valid_payload())
        code = MODULE.MODEL_CODES[0]
        cases = {
            "robots": {"robots_noindex_code": code},
            "sum": {"wrong_sum_code": code},
            "name": {"wrong_name_code": code},
        }
        expected = {
            "robots": "robots_noindex_present",
            "sum": "public_selectable_sums_differ_from_db_contract",
            "name": "public_selectable_names_differ_from_db_contract",
        }
        for label, kwargs in cases.items():
            with self.subTest(case=label):
                public = MODULE.collect_public_evidence(
                    remote, fetch_fn=public_fetcher(remote, **kwargs)
                )
                page = public["model_pages"][0]
                self.assertIn(expected[label], page["page_blockers"])
                self.assertFalse(page["public_contract_ok"])
                self.assertFalse(public["phase1b_evidence_ready"])

    def test_public_url_allowlist_blocks_before_network_dispatch(self) -> None:
        opener = Mock()
        with patch.object(MODULE, "build_opener", opener):
            with self.assertRaises(MODULE.RemoteAuditError):
                MODULE.fetch_public_html(
                    "https://evil.example/product/x/",
                    frozenset(MODULE.PUBLIC_MODEL_URLS),
                )
        opener.assert_not_called()

    def test_run_audit_stays_read_only_and_receipt_binds_public_evidence(self) -> None:
        remote = MODULE.normalize_remote_payload(valid_payload())
        receipt = Mock(return_value=Path("receipt.json"))
        result, exit_code = MODULE.run_audit(
            execute_fn=Mock(return_value=remote),
            public_fn=lambda value: MODULE.collect_public_evidence(
                value, fetch_fn=public_fetcher(value)
            ),
            receipt_fn=receipt,
        )
        self.assertEqual(exit_code, 3)
        self.assertEqual(result["status"], "blocked")
        self.assertFalse(result["phase1b_evidence_ready"])
        self.assertFalse(result["content_publish_gate"])
        self.assertFalse(result["ready_for_apply"])
        receipt.assert_called_once()
        self.assertIn("public_evidence", receipt.call_args.kwargs)

    def test_completed_but_blocked_audit_writes_receipt_and_exits_three(self) -> None:
        remote = MODULE.normalize_remote_payload(valid_payload())
        blocked_public = MODULE.collect_public_evidence(
            remote,
            fetch_fn=public_fetcher(
                remote, robots_noindex_code=MODULE.MODEL_CODES[0]
            ),
        )
        receipt = Mock(return_value=Path("blocked-receipt.json"))
        result, exit_code = MODULE.run_audit(
            execute_fn=Mock(return_value=remote),
            public_fn=Mock(return_value=blocked_public),
            receipt_fn=receipt,
        )
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(exit_code, 3)
        self.assertFalse(result["phase1b_evidence_ready"])
        receipt.assert_called_once()

        error_public = dict(blocked_public)
        error_public["status"] = "error"
        error_receipt = Mock(return_value=Path("error-receipt.json"))
        error_result, error_exit = MODULE.run_audit(
            execute_fn=Mock(return_value=remote),
            public_fn=Mock(return_value=error_public),
            receipt_fn=error_receipt,
        )
        self.assertEqual(error_result["status"], "error")
        self.assertEqual(error_exit, 1)
        error_receipt.assert_called_once()


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

    def test_remote_public_and_receipt_byte_limits_are_enforced(self) -> None:
        remote = MODULE.normalize_remote_payload(valid_payload())
        compact_remote = json.dumps(
            remote, ensure_ascii=False, separators=(",", ":")
        ).encode("utf-8")
        self.assertLess(len(compact_remote), MODULE.MAX_JSON_BYTES)
        public = MODULE.collect_public_evidence(
            remote, fetch_fn=public_fetcher(remote)
        )
        self.assertNotIn("<!doctype", json.dumps(public, ensure_ascii=False))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "too-large.json"
            with self.assertRaises(RuntimeError):
                MODULE._atomic_immutable_json(
                    path, {"payload": "x" * MODULE.MAX_RECEIPT_BYTES}
                )
            self.assertFalse(path.exists())

    def test_default_receipt_directory_is_git_ignored(self) -> None:
        gitignore = (SCRIPT_PATH.parents[1] / ".gitignore").read_text(encoding="utf-8")
        self.assertIn("marketing-audits/", gitignore)
        self.assertTrue(MODULE.REPORT_ROOT.is_relative_to(SCRIPT_PATH.parents[1] / "marketing-audits"))


if __name__ == "__main__":
    unittest.main()
