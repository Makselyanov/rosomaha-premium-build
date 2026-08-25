#!/usr/bin/env python3
"""Fail-closed creative/semantic operator for Direct campaign 713802902.

The default and only automatically exercised mode is a live API read-only
dry-run.  A real mutation additionally requires ``--apply``, exact snapshot
and source-bound plan CAS hashes from a fresh dry-run, and a one-purpose
environment unlock.  The operator can only edit the bundle built from the
current audited preparation source.  It
cannot moderate, resume, update a campaign, change money, or change goals.

Python arbitrary-precision integers are intentional: responsive-ad IDs in this
campaign are larger than JavaScript's exact integer range.
"""

from __future__ import annotations

import argparse
import base64
import copy
import hashlib
import importlib.util
import io
import json
import os
import re
import stat
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from PIL import Image


PROJECT_ROOT = Path(__file__).resolve().parents[1]
GUARD_PATH = PROJECT_ROOT / "scripts" / "yandex-direct-rosomaha-rus-measurement.py"


def _load_measurement_guard() -> Any:
    spec = importlib.util.spec_from_file_location("_rosomaha_direct_measurement_guard", GUARD_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("Не удалось загрузить общий Direct safety guard")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


guard = _load_measurement_guard()

REPORT_ROOT = PROJECT_ROOT / "marketing-audits" / "yandex-direct"
PREP_SCRIPT_PATH = PROJECT_ROOT / "scripts" / "yandex-direct-prepare-713802902-v2.mjs"
PAYLOAD_NAME_RE = re.compile(
    r"^YANDEX_DIRECT_CREATIVE_SEMANTIC_DRY_RUN_713802902_[0-9T-]+Z\.json$"
)

TARGET_CAMPAIGN_ID = 713_802_902
EXPECTED_LOGIN = "rosomaha-rus999"
EXPECTED_DOMAIN = "rosomaha-rus.ru"
EXPECTED_COUNTER_ID = 111_905_412
PROTECTED_CAMPAIGN_IDS = (708_505_950, 705_770_573, 710_087_376)

GROUP_IDS = {
    "brand": 5_791_834_449,
    "category": 5_791_834_450,
    "extrime_family": 5_791_834_451,
    "parked_extrime_toyota": 5_791_834_452,
    "hunter": 5_791_834_453,
}
EXISTING_AD_IDS = {
    "brand": 1_919_379_464_991_658_812,
    "category": 1_919_379_464_991_658_813,
    "extrime_uaz": 1_919_379_464_991_658_814,
    "parked_extrime_toyota": 1_919_379_464_991_658_815,
    "hunter": 1_919_379_464_991_658_816,
}
PARKED_AD_ID = EXISTING_AD_IDS["parked_extrime_toyota"]

BASELINE_EXPLICIT_KEYWORDS = {
    57_915_373_903: (GROUP_IDS["brand"], "росомаха вездеход -купить"),
    57_915_373_904: (GROUP_IDS["brand"], "снегоболотоход росомаха"),
    57_915_373_905: (GROUP_IDS["brand"], "квадроцикл росомаха"),
    57_915_373_906: (GROUP_IDS["brand"], "вездеход росомаха купить"),
    57_915_373_907: (GROUP_IDS["brand"], "завод росомаха"),
    57_915_373_908: (GROUP_IDS["category"], "снегоболотоход купить"),
    57_915_373_909: (GROUP_IDS["category"], "болотоход купить"),
    57_915_373_910: (GROUP_IDS["category"], "снегоболотоход от производителя"),
    57_915_373_911: (GROUP_IDS["category"], "вездеход низкого давления купить"),
    57_915_373_912: (GROUP_IDS["extrime_family"], "росомаха экстрим уаз"),
    57_915_373_913: (GROUP_IDS["extrime_family"], "росомаха экстрим 1 5 уаз купить"),
    57_915_373_914: (GROUP_IDS["extrime_family"], "вездеход экстрим уаз"),
    57_915_373_915: (GROUP_IDS["extrime_family"], "росомаха экстрим 1nz fe уаз"),
    57_915_373_916: (GROUP_IDS["parked_extrime_toyota"], "росомаха экстрим toyota"),
    57_915_373_917: (GROUP_IDS["parked_extrime_toyota"], "росомаха экстрим 1 5 toyota купить"),
    57_915_373_918: (GROUP_IDS["parked_extrime_toyota"], "вездеход экстрим тойота"),
    57_915_373_919: (GROUP_IDS["parked_extrime_toyota"], "росомаха экстрим 1nz fe toyota"),
    57_915_373_920: (GROUP_IDS["hunter"], "росомаха хантер -toyota -вездеход -снегоболотоход"),
    57_915_373_921: (GROUP_IDS["hunter"], "вездеход росомаха хантер"),
    57_915_373_922: (GROUP_IDS["hunter"], "снегоболотоход росомаха хантер"),
    57_915_373_923: (GROUP_IDS["hunter"], "росомаха хантер toyota"),
}
AUTOTARGETING_IDS = {
    205_791_834_449: GROUP_IDS["brand"],
    205_791_834_450: GROUP_IDS["category"],
    205_791_834_451: GROUP_IDS["extrime_family"],
    205_791_834_452: GROUP_IDS["parked_extrime_toyota"],
    205_791_834_453: GROUP_IDS["hunter"],
}
BASELINE_KEYWORD_IDS = frozenset((*BASELINE_EXPLICIT_KEYWORDS, *AUTOTARGETING_IDS))

KEYWORD_UPDATE_IDS = frozenset(
    {
        57_915_373_903,
        57_915_373_904,
        57_915_373_905,
        57_915_373_906,
        57_915_373_907,
        57_915_373_908,
        57_915_373_909,
        57_915_373_910,
        57_915_373_911,
        57_915_373_912,
        57_915_373_913,
        57_915_373_914,
        57_915_373_915,
        57_915_373_920,
        57_915_373_921,
        57_915_373_922,
    }
)
KEYWORD_SUSPEND_IDS = frozenset(
    {
        57_915_373_916,
        57_915_373_917,
        57_915_373_918,
        57_915_373_919,
        57_915_373_923,
    }
)
PARKED_AUTOTARGET_ID = 205_791_834_452
KEYWORD_ADD_COUNT = 5
SEMANTIC_EVIDENCE_PHRASE_COUNT = 23
PARTIAL_NEW_KEYWORDS = {
    57_919_713_695: (GROUP_IDS["brand"], "росомаха завод вездеходов"),
    57_919_713_696: (GROUP_IDS["category"], "вездеход купить от производителя"),
    57_919_713_697: (GROUP_IDS["category"], "квадроцикл вездеход купить"),
    57_919_713_698: (GROUP_IDS["category"], "болотоход купить"),
    57_919_713_699: (GROUP_IDS["extrime_family"], "квадроцикл росомаха экстрим"),
}
PARTIAL_SITELINK_IDS = {
    "generic": 1_504_918_757,
    "extrimeUaz": 1_504_918_758,
    "extrimeToyota": 1_504_918_759,
    "hunter": 1_504_918_760,
}
PARTIAL_APPLY_RECEIPT = (
    REPORT_ROOT
    / "ROSOMAHA_RUS_DIRECT_CREATIVE_apply_713802902_2026-08-24T22-04-55-192385+00-00.json"
)
PARTIAL_APPLY_RECEIPT_SHA256 = (
    "053ecb56022aac437b1f67da8ab205702a9a3223d51c4ed9b5364859cffe2616"
)
SECOND_PARTIAL_RECEIPT = (
    REPORT_ROOT
    / "ROSOMAHA_RUS_DIRECT_CREATIVE_recover-partial_713802902_2026-08-24T22-26-13-167909+00-00.json"
)
SECOND_PARTIAL_RECEIPT_SHA256 = (
    "c71a74adb23438d906e21496a72a4a5cfdf8f80dfb3d6fc348ab896290301bf3"
)
THIRD_PARTIAL_RECEIPT = (
    REPORT_ROOT
    / "ROSOMAHA_RUS_DIRECT_CREATIVE_recover-partial_713802902_2026-08-24T22-39-32-456403+00-00.json"
)
THIRD_PARTIAL_RECEIPT_SHA256 = (
    "e7ca56f6aacb63574be030f2362ccab1eadbc705be16357b1c96c6fc631453d4"
)
THIRD_PARTIAL_PREIMAGE_CAS_SHA256 = (
    "5a1c073e523f5ecb9166e68f7bbbc08d9ab107326e5764d79cf0b29cbbe2c807"
)
THIRD_PARTIAL_PLAN_SHA256 = (
    "0881ecb51551c21fb682e5813afcb2a2f869f85b6ffe2583a2aee75b710b3872"
)

CORRECTIVE_PREIMAGE_RECEIPT = (
    REPORT_ROOT
    / "ROSOMAHA_RUS_DIRECT_CREATIVE_recover-partial_713802902_2026-08-24T22-50-05-520551+00-00.json"
)
CORRECTIVE_PREIMAGE_RECEIPT_SHA256 = (
    "20c823d5f9fa05c7ded69a4047928cd6494f755521dd5ceddeb6e2d79b391db5"
)
CORRECTIVE_PREIMAGE_PAYLOAD = (
    REPORT_ROOT
    / "YANDEX_DIRECT_CREATIVE_SEMANTIC_DRY_RUN_713802902_2026-08-24T22-50-05-470Z.json"
)
CORRECTIVE_PREIMAGE_PAYLOAD_SHA256 = (
    "445028f2cf9752756731eba01563054faf02653c7ea591886808ca60b2613bc6"
)
CORRECTIVE_PREIMAGE_NEW_AD_ID = 1_919_433_640_640_318_428
LIVE_PREFLIGHT_REPORT = (
    REPORT_ROOT
    / "ROSOMAHA_RUS_DIRECT_LIVE_PREFLIGHT_713802902_2026-08-25T16-38Z.md"
)
LIVE_PREFLIGHT_REPORT_SHA256 = (
    "927e9a86af196a311bb3f890e531cfa7732e453139b3db583cd6d19c0bb835a1"
)

MODEL_IMAGE_REPORT = REPORT_ROOT / "ROSOMAHA_RUS_MODEL_IMAGE_EVIDENCE_713802902_2026-08-25T16-45Z.md"
MODEL_IMAGE_REPORT_SHA256 = "8131c115c19e22ee4d3f78ff91477f83d7b0211047a44099c6dbf8482b4471f2"
MODEL_IMAGE_SOURCES = {
    "extrimeUaz": {
        "url": "https://rosomaha-rus.ru/upload/iblock/f3c/tpkvg0p4gau48fo3i5f2cel6ap444019.png",
        "sha256": "db2a178542248d7c22e5e76ee6816489e9d29ca1f2cfdf5158282d9ad2be843b",
        "bytes": 338_201,
    },
    "extrimeToyota": {
        "url": "https://rosomaha-rus.ru/upload/iblock/fae/aysdl7kptcorpz8hhyn7b1g2hgkek031.jpg",
        "sha256": "e39e47bb3bcd6a55eff84a4ed0cea1964e5414e7ad3f1332c4fb1224cae2e43f",
        "bytes": 760_518,
    },
    "hunter": {
        "url": "https://rosomaha-rus.ru/upload/iblock/8ea/81yyzpp02rryrfaixm675bbffco3259u.jpg",
        "sha256": "9985da35d4d079658f2634093ab764fb5217b265b9355a456bd1eca16f904c55",
        "bytes": 271_814,
    },
}
IMAGE_UPLOAD_GUARD_ENV = "ROSOMAHA_DIRECT_MODEL_IMAGE_UPLOAD"
IMAGE_UPLOAD_GUARD_VALUE = "UPLOAD_EXACT_3_MODEL_IMAGES_713802902_V1"
IMAGE_UPLOAD_ONE_GUARD_ENV = "ROSOMAHA_DIRECT_MODEL_IMAGE_UPLOAD_ONE"
IMAGE_UPLOAD_ONE_GUARD_VALUES = {
    "extrimeUaz": "UPLOAD_ONE_EXTRIME_UAZ_713802902_V1",
    "extrimeToyota": "UPLOAD_ONE_EXTRIME_TOYOTA_713802902_V1",
    "hunter": "UPLOAD_ONE_HUNTER_713802902_V1",
}
MODEL_IMAGE_PROVIDER_RECEIPTS = {
    "extrimeUaz": {
        "path": "marketing-audits/yandex-direct/ROSOMAHA_RUS_DIRECT_CREATIVE_image-upload-one-apply_713802902_2026-08-25T17-27-52-058511+00-00.json",
        "receipt_sha256": "d524b0276e173b530ff49fbd7ae523654ffcd2cdec9a00d51185241ac62a23fc",
        "provider_hash": "4e4EASCdH4-68IKrBvn0og",
        "prepared_sha256": "ef9bb28609d4e1182ea739e834dd7e12f77135fc991be4bcd22d05a558d53f53",
    },
    "extrimeToyota": {
        "path": "marketing-audits/yandex-direct/ROSOMAHA_RUS_DIRECT_CREATIVE_image-upload-one-apply_713802902_2026-08-25T17-29-10-095487+00-00.json",
        "receipt_sha256": "ef2ca982c02b30e8f7f36ee2e006717014177995cc78bb2dad31956a0b81903d",
        "provider_hash": "GFg5M_5dT4q6L-949itRBA",
        "prepared_sha256": "59848fa8a9f1b345bb0c0a7772d306cc5b8270039c303e287ecc2cc52f4bb674",
    },
    "hunter": {
        "path": "marketing-audits/yandex-direct/ROSOMAHA_RUS_DIRECT_CREATIVE_image-upload-one-apply_713802902_2026-08-25T17-30-21-402835+00-00.json",
        "receipt_sha256": "d23e230c60d4dc05c560d465f9025cd37a1cb3a270c5776d9d418c6975be55b0",
        "provider_hash": "-e9I7NzC9ED4-I0ib73QcQ",
        "prepared_sha256": "c7d44d24ff51c8db7d986ad339215f72e201bfbf563a6fc5af6a97bc32492786",
    },
}

BASELINE_GROUP_NAMES = {
    GROUP_IDS["brand"]: "Brand Rosomaha",
    GROUP_IDS["category"]: "Commercial category",
    GROUP_IDS["extrime_family"]: "Extrime UAZ",
    GROUP_IDS["parked_extrime_toyota"]: "Extrime Toyota",
    GROUP_IDS["hunter"]: "Hunter Toyota",
}
BASELINE_NEGATIVES = sorted(
    [
        "!своими руками",
        "ozon",
        "wildberries",
        "авито",
        "аренда",
        "бу",
        "вакансия",
        "детский",
        "дром",
        "запчасти",
        "игрушка",
        "инструкция",
        "озон",
        "прокат",
        "работа",
        "радиоуправляемый",
        "ремонт",
        "самоделка",
        "самодельный",
        "скачать",
        "схема",
        "чертеж",
    ]
)
BASELINE_SITELINK_SET_ID = 1_504_788_500
BASELINE_GENERIC_IMAGE_HASH = "s1UdPIWzqoERf75fEOE7hw"

CREATIVE_MODEL_OIDS = {
    "extrimeUaz": "812",
    "extrimeToyota": "824",
    "hunter": "800",
}
UNSUPPORTED_CLAIM_RE = re.compile(
    r"(?i)(?:\b(?:скидк\w*|рассрочк\w*|гаранти\w*|в наличии|лучший|№\s*1)\b"
    r"|\b(?:от\s*)?\d[\d\s]*(?:₽|руб(?:\.|ля|лей)?)\b)"
)

BASELINE_ADS = {
    EXISTING_AD_IDS["brand"]: {
        "group": GROUP_IDS["brand"],
        "titles": ["Вездеходы Росомаха от завода"],
        "texts": ["Подбор модели и комплектации. Доставка по России. Связь с производителем."],
        "href": "https://rosomaha-rus.ru/?utm_source=yandex&utm_medium=cpc&utm_campaign=rosomaha_rus_search_models&utm_content={campaign_id}.{gbid}.{ad_id}.{phrase_id}.{source_type}.{device_type}&utm_term={keyword}",
        "display": "models",
        "sitelink": BASELINE_SITELINK_SET_ID,
        "images": [BASELINE_GENERIC_IMAGE_HASH],
    },
    EXISTING_AD_IDS["category"]: {
        "group": GROUP_IDS["category"],
        "titles": ["Снегоболотоходы Росомаха от завода"],
        "texts": ["Модели для охоты, рыбалки и хозяйства. Подбор комплектации и доставка."],
        "href": "https://rosomaha-rus.ru/product/kvadrotsikly/?utm_source=yandex&utm_medium=cpc&utm_campaign=rosomaha_rus_search_models&utm_content={campaign_id}.{gbid}.{ad_id}.{phrase_id}.{source_type}.{device_type}&utm_term={keyword}",
        "display": "catalog",
        "sitelink": BASELINE_SITELINK_SET_ID,
        "images": [BASELINE_GENERIC_IMAGE_HASH],
    },
    EXISTING_AD_IDS["extrime_uaz"]: {
        "group": GROUP_IDS["extrime_family"],
        "titles": ["Экстрим 1.5 с мостами УАЗ"],
        "texts": ["Двигатель 1NZ-FE. Комплектации и опции на сайте. Заявка производителю."],
        "href": "https://rosomaha-rus.ru/product/extrime-s-1-5l-dvs-1nz-fe/?oid=812&utm_source=yandex&utm_medium=cpc&utm_campaign=rosomaha_rus_search_models&utm_content={campaign_id}.{gbid}.{ad_id}.{phrase_id}.{source_type}.{device_type}&utm_term={keyword}",
        "display": "extrime-uaz",
        "sitelink": BASELINE_SITELINK_SET_ID,
        "images": [],
    },
    EXISTING_AD_IDS["parked_extrime_toyota"]: {
        "group": GROUP_IDS["parked_extrime_toyota"],
        "titles": ["Экстрим 1.5 с мостами Toyota"],
        "texts": ["Двигатель 1NZ-FE. Комплектации и опции на сайте. Заявка производителю."],
        "href": "https://rosomaha-rus.ru/product/extrime-1-5-litra-mosty-toyota/?oid=824&utm_source=yandex&utm_medium=cpc&utm_campaign=rosomaha_rus_search_models&utm_content={campaign_id}.{gbid}.{ad_id}.{phrase_id}.{source_type}.{device_type}&utm_term={keyword}",
        "display": "extrime-toyota",
        "sitelink": BASELINE_SITELINK_SET_ID,
        "images": [],
    },
    EXISTING_AD_IDS["hunter"]: {
        "group": GROUP_IDS["hunter"],
        "titles": ["Хантер 1.5 с мостами Toyota"],
        "texts": ["Двигатель 1NZ-FE. Комплектации и опции на сайте. Заявка производителю."],
        "href": "https://rosomaha-rus.ru/product/hunter-s-1-5l-dvs-1nz-fe/?oid=800&utm_source=yandex&utm_medium=cpc&utm_campaign=rosomaha_rus_search_models&utm_content={campaign_id}.{gbid}.{ad_id}.{phrase_id}.{source_type}.{device_type}&utm_term={keyword}",
        "display": "hunter-toyota",
        "sitelink": BASELINE_SITELINK_SET_ID,
        "images": [],
    },
}

APPLY_GUARD_ENV = "ROSOMAHA_DIRECT_CREATIVE_APPLY"
APPLY_GUARD_VALUE = "APPLY_713802902_CREATIVE_SEMANTIC_V3_SOURCE_BOUND"
RECOVERY_GUARD_ENV = "ROSOMAHA_DIRECT_CREATIVE_RECOVERY"
RECOVERY_GUARD_VALUE = "RECOVER_713802902_EPK_ADS_V501_V3"
CORRECTIVE_GUARD_ENV = "ROSOMAHA_DIRECT_CREATIVE_CORRECTIVE"
CORRECTIVE_GUARD_VALUE = "CORRECT_EXISTING_6_ADS_713802902_V1"
MUTATION_LOCK_PATH = guard.MUTATION_LOCK_PATH
BROWSER_LOCK_PATHS = guard.BROWSER_LOCK_PATHS
MAX_RESPONSE_BYTES = 4_000_000


class OperatorError(RuntimeError):
    def __init__(self, message: str, *, partial: Mapping[str, Any] | None = None) -> None:
        super().__init__(message)
        self.partial = dict(partial or {})


class ProviderError(OperatorError):
    pass


class RejectRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        raise ProviderError("Direct API unexpectedly redirected")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def sha256_json(value: Any) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def _normalise_negative_items(value: Any, label: str = "NegativeKeywords") -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise OperatorError(f"{label}: Items должны быть списком строк")
    return sorted(set(value))


def _content_cas_view(value: Any) -> Any:
    """Canonical provider view: exact content/state, no moderation lifecycle noise."""
    if isinstance(value, list):
        return [_content_cas_view(item) for item in value]
    if isinstance(value, Mapping):
        result: dict[str, Any] = {}
        for key, child in value.items():
            if key in {"Status", "StatusClarification", "ServingStatus"} or "Moderation" in key:
                continue
            if key == "NegativeKeywords" and isinstance(child, Mapping):
                normalised = dict(child)
                normalised["Items"] = _normalise_negative_items(child.get("Items"))
                result[key] = _content_cas_view(normalised)
            else:
                result[key] = _content_cas_view(child)
        return result
    return value


def _content_cas_sha256(value: Any) -> str:
    return sha256_json(_content_cas_view(value))


def exact_int(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise OperatorError(f"{label}: требуется точное положительное целое число")
    return value


def safe_text(value: Any, secrets: Sequence[str] = ()) -> str:
    text = str(value or type(value).__name__)
    for secret in secrets:
        if secret:
            text = text.replace(secret, "[REDACTED]")
    text = re.sub(r"(?i)Bearer\s+[^\s\"',}]+", "Bearer [REDACTED]", text)
    return text[:1000]


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_payload_artifact(path: Path) -> dict[str, Any]:
    report_root = REPORT_ROOT.resolve()
    try:
        resolved = path.resolve(strict=True)
    except OSError:
        raise OperatorError("Creative/semantic payload недоступен") from None
    if (
        resolved.parent != report_root
        or not PAYLOAD_NAME_RE.fullmatch(resolved.name)
        or not resolved.is_file()
        or path.is_symlink()
    ):
        raise OperatorError("Creative/semantic payload вышел за разрешённый report scope")
    if path.stat().st_size > 2_000_000:
        raise OperatorError("Creative/semantic payload превышает безопасный размер")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise OperatorError("Creative/semantic payload содержит невалидный JSON") from None
    validate_payload(payload)
    return payload


def _stable_plan_view(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Remove only generator timestamps; every effective field remains CAS-bound."""
    stable = copy.deepcopy(dict(payload))
    stable.pop("generatedAt", None)
    landing = stable.get("publicLandingEvidence")
    if isinstance(landing, dict):
        landing.pop("checkedAt", None)
    return stable


def build_current_payload() -> tuple[dict[str, Any], dict[str, Any]]:
    """Build the plan from the current audited JS source, never from a stale receipt."""
    if not PREP_SCRIPT_PATH.is_file() or PREP_SCRIPT_PATH.is_symlink():
        raise OperatorError("Current creative/semantic source отсутствует или является symlink")
    source_before = _sha256_file(PREP_SCRIPT_PATH)
    try:
        completed = subprocess.run(
            ["node", str(PREP_SCRIPT_PATH)],
            cwd=PROJECT_ROOT,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=45,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise OperatorError(f"Не удалось построить current plan: {safe_text(exc)}") from None
    if completed.returncode != 0:
        raise OperatorError(
            "Current plan generator failed: "
            + safe_text(completed.stderr or completed.stdout)
        )
    if _sha256_file(PREP_SCRIPT_PATH) != source_before:
        raise OperatorError("Creative/semantic source изменился во время построения plan")
    try:
        generator_receipt = json.loads(completed.stdout)
    except json.JSONDecodeError:
        raise OperatorError("Current plan generator вернул невалидный JSON") from None
    if not isinstance(generator_receipt, Mapping) or generator_receipt.get("ok") is not True:
        raise OperatorError("Current plan generator не подтвердил validation.ok")
    relative = generator_receipt.get("output")
    if not isinstance(relative, str):
        raise OperatorError("Current plan generator не вернул output path")
    path = PROJECT_ROOT / relative
    payload = load_payload_artifact(path)

    semantic_relative = payload.get("semanticEvidence", {}).get("receipt")
    if not isinstance(semantic_relative, str):
        raise OperatorError("Current plan не содержит semantic evidence receipt")
    semantic_path = (PROJECT_ROOT / semantic_relative).resolve(strict=True)
    if semantic_path.parent != REPORT_ROOT.resolve() or not semantic_path.is_file():
        raise OperatorError("Semantic evidence вышел за разрешённый report scope")
    semantic_sha256 = _sha256_file(semantic_path)
    plan_sha256 = sha256_json(
        {
            "prep_source_sha256": source_before,
            "semantic_evidence_sha256": semantic_sha256,
            "payload": _stable_plan_view(payload),
        }
    )
    metadata = {
        "path": str(path.relative_to(PROJECT_ROOT)),
        "artifact_sha256": _sha256_file(path),
        "plan_sha256": plan_sha256,
        "prep_source": str(PREP_SCRIPT_PATH.relative_to(PROJECT_ROOT)),
        "prep_source_sha256": source_before,
        "semantic_evidence": semantic_relative,
        "semantic_evidence_sha256": semantic_sha256,
    }
    return payload, metadata


def _walk(value: Any):
    if isinstance(value, Mapping):
        for key, child in value.items():
            yield key, child
            yield from _walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk(child)


def _assert_domain_urls(value: Any) -> None:
    for key, child in _walk(value):
        if key not in {"Href", "href", "sourceUrl"} or not isinstance(child, str):
            continue
        parsed = urlsplit(child)
        if parsed.scheme != "https" or parsed.hostname != EXPECTED_DOMAIN:
            raise OperatorError(f"URL вышел за разрешённый домен: {safe_text(child)}")


def _validate_creative_contract(payload: Mapping[str, Any]) -> None:
    """Validate source-bound copy and evidence without authorizing mutation."""
    creatives = payload.get("creatives")
    landing = payload.get("publicLandingEvidence")
    images = payload.get("imageEvidence")
    if not isinstance(creatives, Mapping) or not isinstance(landing, Mapping):
        raise OperatorError("Creative public landing evidence отсутствует")
    if landing.get("allStatus200") is not True or landing.get("exactHost") != EXPECTED_DOMAIN:
        raise OperatorError("Creative public landing evidence не подтверждено")
    if not isinstance(images, Mapping):
        raise OperatorError("Creative image evidence отсутствует")
    for key, creative in creatives.items():
        if not isinstance(creative, Mapping):
            raise OperatorError(f"Creative {key} имеет неверный формат")
        href = creative.get("Href")
        if not isinstance(href, str):
            raise OperatorError(f"Creative {key} не содержит Href")
        parsed = urlsplit(href)
        params = dict(parse_qsl(parsed.query, keep_blank_values=True))
        expected_utm = {
            "utm_source": "yandex",
            "utm_medium": "cpc",
            "utm_campaign": "rosomaha_rus_search_models",
            "utm_content": "{campaign_id}.{gbid}.{ad_id}.{phrase_id}.{source_type}.{device_type}",
            "utm_term": "{keyword}",
        }
        if any(params.get(name) != value for name, value in expected_utm.items()):
            raise OperatorError(f"Creative {key} потерял обязательные UTM/macros")
        expected_oid = CREATIVE_MODEL_OIDS.get(key)
        if expected_oid is not None and params.get("oid") != expected_oid:
            raise OperatorError(f"Creative {key} потерял обязательный oid={expected_oid}")

        copy_values = [*(creative.get("Titles") or []), *(creative.get("Texts") or [])]
        if not copy_values or any(not isinstance(value, str) for value in copy_values):
            raise OperatorError(f"Creative {key} не содержит проверяемый текст")
        if any(UNSUPPORTED_CLAIM_RE.search(value) for value in copy_values):
            raise OperatorError(f"Creative {key} содержит неподтверждённую цену/обещание")
        if (
            key == "category"
            and parsed.path.rstrip("/") == "/product/kvadrotsikly"
            and any("снегоболотоход" in value.casefold() for value in creative.get("Titles") or [])
        ):
            raise OperatorError("Category creative: снегоболотоходы ведут на /product/kvadrotsikly/")

        hashes = creative.get("AdImageHashes", {}).get("Items")
        if not isinstance(hashes, list) or len(hashes) != 1:
            raise OperatorError(f"Creative {key}: image hash отсутствует")

    # A legacy provider-accepted generic image is valid audit evidence only.
    # It never satisfies the separate mutation gate below.
    per_creative_images = images.get("perCreative")
    if per_creative_images is None:
        source_url = images.get("sourceUrl")
        if not isinstance(source_url, str) or urlsplit(source_url).hostname != EXPECTED_DOMAIN:
            raise OperatorError("Creative image source вышел за домен")
        if images.get("hash") != BASELINE_GENERIC_IMAGE_HASH or not isinstance(
            images.get("providerReceipt"), str
        ):
            raise OperatorError("Legacy creative image evidence не подтверждено")
        if any(
            creative["AdImageHashes"]["Items"] != [BASELINE_GENERIC_IMAGE_HASH]
            for creative in creatives.values()
        ):
            raise OperatorError("Legacy image evidence не совпало с creatives")
    elif not isinstance(per_creative_images, Mapping) or set(per_creative_images) != set(creatives):
        raise OperatorError("Per-creative image evidence scope не совпал")
    else:
        for key, evidence in per_creative_images.items():
            source_url = evidence.get("sourceUrl") if isinstance(evidence, Mapping) else None
            if (
                not isinstance(source_url, str)
                or urlsplit(source_url).hostname != EXPECTED_DOMAIN
                or evidence.get("hash") != creatives[key]["AdImageHashes"]["Items"][0]
            ):
                raise OperatorError(f"Creative {key}: per-creative image evidence не совпало")


def _validate_mutation_image_contract(payload: Mapping[str, Any]) -> None:
    """Require provider-accepted model images immediately before mutation."""
    creatives = payload.get("creatives")
    images = payload.get("imageEvidence")
    per_creative = images.get("perCreative") if isinstance(images, Mapping) else None
    if not isinstance(creatives, Mapping) or not isinstance(per_creative, Mapping):
        raise OperatorError("Mutation blocked: per-creative image evidence отсутствует")
    if set(per_creative) != set(creatives):
        raise OperatorError("Mutation blocked: per-creative image evidence scope не совпал")
    seen_model_hashes: set[str] = set()
    for key, creative in creatives.items():
        hashes = creative.get("AdImageHashes", {}).get("Items")
        evidence = per_creative.get(key)
        if not isinstance(hashes, list) or len(hashes) != 1 or not isinstance(evidence, Mapping):
            raise OperatorError(f"Mutation blocked: creative {key} image evidence отсутствует")
        if evidence.get("hash") != hashes[0] or evidence.get("providerAccepted") is not True:
            raise OperatorError(f"Mutation blocked: creative {key} image не подтверждено провайдером")
        source_url = evidence.get("sourceUrl")
        if not isinstance(source_url, str) or urlsplit(source_url).hostname != EXPECTED_DOMAIN:
            raise OperatorError(f"Mutation blocked: creative {key} image source вышел за домен")
        if key in CREATIVE_MODEL_OIDS:
            if evidence.get("modelSpecific") is not True or hashes[0] == BASELINE_GENERIC_IMAGE_HASH:
                raise OperatorError(f"Mutation blocked: creative {key} model image подменено")
            if hashes[0] in seen_model_hashes:
                raise OperatorError("Mutation blocked: разные модели используют одну image")
            seen_model_hashes.add(hashes[0])
            _validate_model_image_provider_receipt(key, evidence)


def _validate_model_image_provider_receipt(
    key: str, evidence: Mapping[str, Any]
) -> dict[str, Any]:
    pinned = MODEL_IMAGE_PROVIDER_RECEIPTS.get(key)
    if pinned is None:
        raise OperatorError(f"Model image receipt key {key} не закреплён")
    if (
        evidence.get("providerReceipt") != pinned["path"]
        or evidence.get("providerReceiptSha256") != pinned["receipt_sha256"]
        or evidence.get("preparedSha256") != pinned["prepared_sha256"]
        or evidence.get("hash") != pinned["provider_hash"]
    ):
        raise OperatorError(f"Model image {key}: source-bound receipt fields не совпали")
    path = (PROJECT_ROOT / pinned["path"]).resolve(strict=True)
    if path.parent != REPORT_ROOT.resolve() or path.is_symlink() or not path.is_file():
        raise OperatorError(f"Model image {key}: provider receipt вышел за report scope")
    if _sha256_file(path) != pinned["receipt_sha256"]:
        raise OperatorError(f"Model image {key}: provider receipt SHA-256 drift")
    try:
        receipt = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise OperatorError(f"Model image {key}: provider receipt невалиден") from None
    plan = receipt.get("image_plan")
    rows = plan.get("images") if isinstance(plan, Mapping) else None
    expected_source = MODEL_IMAGE_SOURCES[key]
    if (
        receipt.get("mode") != "image-upload-one-apply"
        or receipt.get("status") != "uploaded_one_verified_suspended"
        or receipt.get("selected_key") != key
        or receipt.get("provider_hash") != pinned["provider_hash"]
        or receipt.get("mutation_requests") != 1
        or receipt.get("target", {}).get("campaign_id") != TARGET_CAMPAIGN_ID
        or receipt.get("target", {}).get("state") != "SUSPENDED"
        or receipt.get("protected_unchanged") is not True
        or receipt.get("creative_apply_authorized") is not False
        or any(
            receipt.get(field) is not False
            for field in ("moderation_called", "resume_called", "budget_changed", "goal_changed")
        )
        or not isinstance(plan, Mapping)
        or plan.get("exact_login") != EXPECTED_LOGIN
        or plan.get("campaign_id") != TARGET_CAMPAIGN_ID
        or plan.get("selected_keys") != [key]
        or plan.get("upload_count") != 1
        or plan.get("campaign_remains_suspended") is not True
        or not isinstance(rows, list)
        or len(rows) != 1
        or rows[0].get("key") != key
        or rows[0].get("source_url") != expected_source["url"]
        or rows[0].get("source_sha256") != expected_source["sha256"]
        or rows[0].get("source_bytes") != expected_source["bytes"]
        or rows[0].get("prepared_sha256") != pinned["prepared_sha256"]
    ):
        raise OperatorError(f"Model image {key}: provider receipt provenance не совпал")
    return receipt


def validate_payload(payload: Any) -> None:
    if not isinstance(payload, Mapping):
        raise OperatorError("Payload должен быть JSON object")
    if payload.get("mode") != "dry-run" or payload.get("exactLogin") != EXPECTED_LOGIN:
        raise OperatorError("Payload identity/mode не совпали")
    if exact_int(payload.get("campaignId"), "Payload CampaignId") != TARGET_CAMPAIGN_ID:
        raise OperatorError("Payload содержит другую кампанию")
    if payload.get("protectedCampaignIds") != list(PROTECTED_CAMPAIGN_IDS):
        raise OperatorError("Payload protected campaign guard не совпал")
    authorization = payload.get("authorizationBoundary")
    if not isinstance(authorization, Mapping) or authorization.get("externalMutationCount") != 0:
        raise OperatorError("Payload не является подтверждённым zero-mutation dry-run")
    if authorization.get("campaignRemainsSuspended") is not True:
        raise OperatorError("Payload не гарантирует SUSPENDED")
    for key in ("moderationCalled", "resumeCalled", "budgetChanged", "priorityGoalChanged"):
        if authorization.get(key) is not False:
            raise OperatorError(f"Payload safety boundary {key} не совпал")
    validation = payload.get("validation")
    if not isinstance(validation, Mapping) or validation.get("ok") is not True:
        raise OperatorError("Payload не прошёл собственную валидацию")
    if set(payload.get("creatives", {})) != {
        "brand",
        "category",
        "extrimeUaz",
        "extrimeToyota",
        "hunter",
    }:
        raise OperatorError("Payload creative keys не совпали")
    if list(payload.get("sitelinkSets", {})) != [
        "generic",
        "extrimeUaz",
        "extrimeToyota",
        "hunter",
    ]:
        raise OperatorError("Payload sitelink order не совпал")
    keywords = payload.get("keywords")
    if not isinstance(keywords, Mapping):
        raise OperatorError("Payload keywords отсутствует")
    update_ids = {exact_int(item.get("Id"), "Keyword update Id") for item in keywords.get("update", [])}
    if update_ids != KEYWORD_UPDATE_IDS:
        raise OperatorError("Payload Keyword.update ID scope не совпал")
    suspend_ids = {exact_int(item, "Keyword suspend Id") for item in keywords.get("suspendIds", [])}
    if suspend_ids != KEYWORD_SUSPEND_IDS:
        raise OperatorError("Payload Keyword.suspend ID scope не совпал")
    autotarget_safety = keywords.get("parkedAutotargetingSafety")
    if autotarget_safety != {
        "id": PARKED_AUTOTARGET_ID,
        "adGroupId": GROUP_IDS["parked_extrime_toyota"],
        "remainsOn": True,
        "soleAdId": str(PARKED_AD_ID),
        "soleAdMustBeSuspended": True,
    }:
        raise OperatorError("Payload parked autotargeting safety proof не совпал")
    if len(keywords.get("add", [])) != KEYWORD_ADD_COUNT:
        raise OperatorError("Payload должен добавлять ровно пять уникальных ключей")
    aliases = keywords.get("providerNormalizedAliases")
    expected_aliases = {
        (
            "купить вездеход росомаха",
            57_915_373_903,
            "росомаха вездеход купить",
            10140,
        ),
        (
            "росомаха квадроцикл купить",
            57_915_373_905,
            "квадроцикл росомаха купить",
            10140,
        ),
    }
    actual_aliases = {
        (
            item.get("evidenceKeyword"),
            exact_int(item.get("canonicalKeywordId"), "Alias canonical KeywordId"),
            item.get("canonicalKeyword"),
            item.get("providerCode"),
        )
        for item in aliases or []
        if isinstance(item, Mapping)
    }
    if actual_aliases != expected_aliases:
        raise OperatorError("Payload provider-normalized semantic aliases не совпали")
    semantic = payload.get("semanticEvidence")
    if (
        not isinstance(semantic, Mapping)
        or semantic.get("yesEvidencePhraseCount") != SEMANTIC_EVIDENCE_PHRASE_COUNT
        or semantic.get("materializedUniqueKeywordCount") != 21
        or semantic.get("providerNormalizedAliasCount") != 2
    ):
        raise OperatorError("Payload не доказал 23 YES phrases -> 21 unique keywords")
    _validate_creative_contract(payload)
    _assert_domain_urls(payload)
    forbidden_keys = {
        "Campaigns",
        "PriorityGoals",
        "DailyBudget",
        "BiddingStrategy",
        "PackageBiddingStrategy",
        "CounterIds",
    }
    found = {key for key, _ in _walk(payload) if key in forbidden_keys}
    if found:
        raise OperatorError(f"Payload содержит запрещённые campaign/money поля: {sorted(found)}")


def _public_probe_url(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme != "https" or parsed.hostname != EXPECTED_DOMAIN:
        raise OperatorError(f"Public preflight URL вышел за exact host: {safe_text(value)}")
    clean_query = [
        (key, item)
        for key, item in parse_qsl(parsed.query, keep_blank_values=True)
        if not key.lower().startswith("utm_") and "{" not in key + item and "}" not in key + item
    ]
    return urlunsplit(
        ("https", EXPECTED_DOMAIN, parsed.path or "/", urlencode(clean_query), "")
    )


def _probe_public_url(url: str, *, timeout: float = 12.0) -> dict[str, Any]:
    opener = build_opener(RejectRedirects())
    request = Request(
        url,
        headers={
            "User-Agent": "Rosomaha-Direct-Safety-Preflight/1.0",
            "Accept": "text/html,image/*;q=0.8,*/*;q=0.1",
        },
        method="GET",
    )
    try:
        with opener.open(request, timeout=timeout) as response:
            status = int(getattr(response, "status", response.getcode()))
            final = urlsplit(response.geturl())
            response.read(1)
            content_type = response.headers.get("Content-Type")
    except HTTPError as exc:
        raise OperatorError(f"Public preflight HTTP {exc.code}: {url}") from None
    except (URLError, TimeoutError, OSError, ProviderError) as exc:
        raise OperatorError(f"Public preflight transport: {url}: {safe_text(exc)}") from None
    if status != 200:
        raise OperatorError(f"Public preflight требует HTTP 200, получен {status}: {url}")
    if final.scheme != "https" or final.hostname != EXPECTED_DOMAIN:
        raise OperatorError(f"Public preflight final host drift: {url}")
    return {"url": url, "status": status, "content_type": content_type}


def public_http_preflight(payload: Mapping[str, Any]) -> dict[str, Any]:
    source_urls = [
        child
        for key, child in _walk(payload)
        if key in {"Href", "href", "sourceUrl"} and isinstance(child, str)
    ]
    probe_urls = sorted({_public_probe_url(item) for item in source_urls})
    if not probe_urls:
        raise OperatorError("Public preflight не нашёл ни одного URL")
    with ThreadPoolExecutor(max_workers=min(4, len(probe_urls))) as pool:
        results = list(pool.map(_probe_public_url, probe_urls))
    if any(item.get("status") != 200 for item in results):
        raise OperatorError("Public preflight не подтвердил HTTP 200 для всех URL")
    return {
        "exact_host": EXPECTED_DOMAIN,
        "source_url_count": len(source_urls),
        "unique_probe_count": len(results),
        "all_http_200": True,
        "results": results,
    }


class MutationLockPolicy:
    def __init__(
        self,
        *,
        browser_locks: Sequence[Path] = BROWSER_LOCK_PATHS,
        mutation_lock: Path = MUTATION_LOCK_PATH,
    ) -> None:
        self.browser_locks = tuple(Path(item) for item in browser_locks)
        self.mutation_lock = Path(mutation_lock)

    def inspect(self) -> dict[str, Any]:
        browser = [str(path) for path in self.browser_locks if path.exists() or path.is_symlink()]
        mutation = self.mutation_lock.exists() or self.mutation_lock.is_symlink()
        return {
            "browser_locks": browser,
            "mutation_lock_present": mutation,
            "available": not browser and not mutation,
        }

    def _assert_free(self) -> None:
        state = self.inspect()
        if not state["available"]:
            raise OperatorError(f"Глобальная Yandex lock занята: {state}")

    @contextmanager
    def hold(self):
        self._assert_free()
        self.mutation_lock.parent.mkdir(parents=True, exist_ok=True)
        content = canonical_bytes(
            {
                "schema": 1,
                "owner": "yandex-direct-creative-713802902",
                "campaign_id": TARGET_CAMPAIGN_ID,
                "pid": os.getpid(),
                "created_at": utc_now(),
            }
        ) + b"\n"
        try:
            descriptor = os.open(self.mutation_lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            raise OperatorError("Глобальная Yandex mutation lock занята") from None
        try:
            os.write(descriptor, content)
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        acquired = self.mutation_lock.stat()
        evidence = {"path": str(self.mutation_lock), "atomic_create": True, "released": False}
        try:
            occupied = [str(path) for path in self.browser_locks if path.exists() or path.is_symlink()]
            if occupied:
                raise OperatorError("Browser owner lock появился после захвата mutation lock")
            yield evidence
        finally:
            try:
                current = self.mutation_lock.lstat()
                if (
                    stat.S_ISREG(current.st_mode)
                    and not self.mutation_lock.is_symlink()
                    and current.st_dev == acquired.st_dev
                    and current.st_ino == acquired.st_ino
                ):
                    self.mutation_lock.unlink()
                    evidence["released"] = True
                else:
                    evidence["release_error"] = "mutation lock identity changed"
            except FileNotFoundError:
                evidence["release_error"] = "mutation lock disappeared"


def endpoint(version: str, service: str) -> str:
    allowed = {
        ("v501", "sitelinks"),
        ("v501", "adgroups"),
        ("v501", "ads"),
        ("v5", "keywords"),
        ("v5", "adimages"),
    }
    if (version, service) not in allowed:
        raise OperatorError("Creative mutation endpoint не входит в allowlist")
    return f"https://api.direct.yandex.com/json/{version}/{service}"


def _all_ints(value: Any) -> set[int]:
    found: set[int] = set()
    if isinstance(value, bool):
        return found
    if isinstance(value, int):
        found.add(value)
    elif isinstance(value, Mapping):
        for child in value.values():
            found.update(_all_ints(child))
    elif isinstance(value, list):
        for child in value:
            found.update(_all_ints(child))
    return found


def assert_mutation_contract(
    version: str,
    service: str,
    method: str,
    params: Mapping[str, Any],
    mutation_kind: str,
) -> None:
    endpoint(version, service)
    allowed = {
        "sitelinks_add": ("v501", "sitelinks", "add"),
        "adgroups_update": ("v501", "adgroups", "update"),
        "keywords_update": ("v5", "keywords", "update"),
        "keywords_add": ("v5", "keywords", "add"),
        "keywords_suspend": ("v5", "keywords", "suspend"),
        "ads_update": ("v501", "ads", "update"),
        "corrective_adgroups_update": ("v501", "adgroups", "update"),
        "corrective_keywords_update": ("v5", "keywords", "update"),
        "corrective_ads_update": ("v501", "ads", "update"),
        "ads_add": ("v501", "ads", "add"),
        "ads_suspend": ("v501", "ads", "suspend"),
        "model_images_add": ("v5", "adimages", "add"),
        "model_image_add_one": ("v5", "adimages", "add"),
    }
    if allowed.get(mutation_kind) != (version, service, method):
        raise OperatorError("Mutation kind/service/method не совпали с allowlist")
    serialized_keys = {key for key, _ in _walk(params)}
    forbidden = {
        "Campaigns",
        "CampaignId",
        "PriorityGoals",
        "DailyBudget",
        "BiddingStrategy",
        "PackageBiddingStrategy",
        "CounterIds",
        "Budget",
    }
    if serialized_keys & forbidden:
        raise OperatorError("Creative mutation содержит campaign/money/goal поле")
    if _all_ints(params) & set(PROTECTED_CAMPAIGN_IDS):
        raise OperatorError("Creative mutation содержит защищённый campaign ID")
    _assert_domain_urls(params)

    if mutation_kind == "sitelinks_add":
        rows = params.get("SitelinksSets") if set(params) == {"SitelinksSets"} else None
        if not isinstance(rows, list) or not 1 <= len(rows) <= 4:
            raise OperatorError("Sitelinks.add требует от одного до четырёх новых наборов")
        signatures = [sha256_json(_normalise_sitelinks(row.get("Sitelinks"))) for row in rows]
        if len(signatures) != len(set(signatures)):
            raise OperatorError("Sitelinks.add содержит дубли вместо reuse")
    elif mutation_kind in {"adgroups_update", "corrective_adgroups_update"}:
        rows = params.get("AdGroups") if set(params) == {"AdGroups"} else None
        if not isinstance(rows, list) or {exact_int(row.get("Id"), "AdGroup Id") for row in rows} != set(GROUP_IDS.values()):
            raise OperatorError("AdGroups.update должен содержать ровно пять целевых групп")
    elif mutation_kind in {"keywords_update", "corrective_keywords_update"}:
        rows = params.get("Keywords") if set(params) == {"Keywords"} else None
        if not isinstance(rows, list) or {exact_int(row.get("Id"), "Keyword Id") for row in rows} != KEYWORD_UPDATE_IDS:
            raise OperatorError("Keywords.update scope не совпал")
    elif mutation_kind == "keywords_add":
        rows = params.get("Keywords") if set(params) == {"Keywords"} else None
        if not isinstance(rows, list) or len(rows) != KEYWORD_ADD_COUNT:
            raise OperatorError("Keywords.add требует ровно пять уникальных фраз")
        if any(exact_int(row.get("AdGroupId"), "Keyword AdGroupId") not in set(GROUP_IDS.values()) for row in rows):
            raise OperatorError("Keywords.add содержит чужую группу")
    elif mutation_kind == "keywords_suspend":
        ids = params.get("SelectionCriteria", {}).get("Ids")
        requested = (
            {exact_int(item, "Keyword suspend Id") for item in ids}
            if isinstance(ids, list)
            else set()
        )
        if not requested or not requested <= KEYWORD_SUSPEND_IDS:
            raise OperatorError("Keywords.suspend scope не совпал")
    elif mutation_kind == "ads_update":
        rows = params.get("Ads") if set(params) == {"Ads"} else None
        if not isinstance(rows, list) or {exact_int(row.get("Id"), "Ad Id") for row in rows} != set(EXISTING_AD_IDS.values()):
            raise OperatorError("Ads.update требует все пять exact 64-bit IDs")
        if any(set(row) != {"Id", "ResponsiveAd"} for row in rows):
            raise OperatorError("Ads.update item содержит лишние поля")
    elif mutation_kind == "corrective_ads_update":
        rows = params.get("Ads") if set(params) == {"Ads"} else None
        exact_ids = set(EXISTING_AD_IDS.values()) | {CORRECTIVE_PREIMAGE_NEW_AD_ID}
        if (
            not isinstance(rows, list)
            or {exact_int(row.get("Id"), "Corrective Ad Id") for row in rows}
            != exact_ids
            or any(set(row) != {"Id", "ResponsiveAd"} for row in rows)
        ):
            raise OperatorError("Corrective Ads.update требует exact шесть существующих IDs")
    elif mutation_kind == "ads_add":
        rows = params.get("Ads") if set(params) == {"Ads"} else None
        if not isinstance(rows, list) or len(rows) != 1:
            raise OperatorError("Ads.add требует одно объявление")
        row = rows[0]
        if set(row) != {"AdGroupId", "ResponsiveAd"} or exact_int(row.get("AdGroupId"), "Ads.add AdGroupId") != GROUP_IDS["extrime_family"]:
            raise OperatorError("Ads.add разрешён только в семейной группе Extrime")
        hashes = row.get("ResponsiveAd", {}).get("AdImageHashes")
        if not isinstance(hashes, list) or len(hashes) != 1 or not isinstance(hashes[0], str):
            raise OperatorError("Ads.add ResponsiveAd.AdImageHashes обязан быть массивом")
    elif mutation_kind == "ads_suspend":
        ids = params.get("SelectionCriteria", {}).get("Ids")
        if ids != [PARKED_AD_ID]:
            raise OperatorError("Ads.suspend разрешён только для parked ad exact ID")
    elif mutation_kind == "model_images_add":
        rows = params.get("AdImages") if set(params) == {"AdImages"} else None
        if not isinstance(rows, list) or len(rows) != len(MODEL_IMAGE_SOURCES):
            raise OperatorError("AdImages.add требует ровно три model image")
        names = []
        for row in rows:
            if not isinstance(row, Mapping) or set(row) != {"ImageData", "Name"}:
                raise OperatorError("AdImages.add row содержит лишние поля")
            if not isinstance(row.get("ImageData"), str) or not row["ImageData"]:
                raise OperatorError("AdImages.add ImageData отсутствует")
            names.append(row.get("Name"))
        if names != [f"rosomaha-713802902-{key}" for key in MODEL_IMAGE_SOURCES]:
            raise OperatorError("AdImages.add Name/order вышли за exact plan")
    elif mutation_kind == "model_image_add_one":
        rows = params.get("AdImages") if set(params) == {"AdImages"} else None
        if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], Mapping):
            raise OperatorError("Single AdImages.add требует ровно одну row")
        row = rows[0]
        allowed_names = {f"rosomaha-713802902-{key}" for key in MODEL_IMAGE_SOURCES}
        if (
            set(row) != {"ImageData", "Name"}
            or row.get("Name") not in allowed_names
            or not isinstance(row.get("ImageData"), str)
            or not row["ImageData"]
        ):
            raise OperatorError("Single AdImages.add row вышла за exact allowlist")


class CreativeDirectApi(guard.DirectApi):
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
        if mutation_kind is None:
            return super().call(
                version,
                service,
                method,
                params,
                use_client_login=use_client_login,
            )
        override = getattr(self, "mutation_allowlist_override", None)
        if override is not None and mutation_kind not in override:
            raise OperatorError(
                f"Current operator mode forbids mutation stage {mutation_kind}"
            )
        if not use_client_login:
            raise OperatorError("Creative mutation обязана использовать exact Client-Login")
        assert_mutation_contract(version, service, method, params, mutation_kind)
        self.request_log.append(
            {
                "version": version,
                "service": service,
                "method": method,
                "client_login": EXPECTED_LOGIN,
                "mutation_kind": mutation_kind,
            }
        )
        self.mutation_requests += 1
        headers = {
            "Authorization": f"Bearer {self._token}",
            "Accept-Language": "ru",
            "Client-Login": EXPECTED_LOGIN,
            "Content-Type": "application/json; charset=utf-8",
        }
        request = Request(
            endpoint(version, service),
            data=canonical_bytes({"method": method, "params": dict(params)}),
            headers=headers,
            method="POST",
        )
        try:
            with self._opener.open(request, timeout=self.timeout) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
                if len(raw) > MAX_RESPONSE_BYTES:
                    raise ProviderError("Direct API response превысил безопасный предел")
                units_login = response.headers.get("Units-Used-Login")
        except HTTPError as exc:
            raw = exc.read(MAX_RESPONSE_BYTES + 1)
            detail = safe_text(raw.decode("utf-8", errors="replace"), (self._token,))
            raise ProviderError(f"Direct API HTTP {exc.code}: {detail}") from None
        except (URLError, TimeoutError, OSError) as exc:
            raise ProviderError(f"Direct API transport: {safe_text(exc, (self._token,))}") from None
        if units_login and str(units_login).strip() != EXPECTED_LOGIN:
            raise OperatorError("Direct API mutation ответил единицами другого логина")
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ProviderError("Direct API mutation вернул невалидный JSON") from None
        if not isinstance(payload, Mapping):
            raise ProviderError("Direct API mutation вернул JSON неожиданного типа")
        if payload.get("error"):
            error = payload["error"] if isinstance(payload["error"], Mapping) else {}
            raise ProviderError(
                f"Direct API error_code={error.get('error_code')}: "
                + safe_text(error.get("error_string") or error.get("error_detail"), (self._token,))
            )
        result = payload.get("result")
        if not isinstance(result, Mapping):
            raise ProviderError("Direct API mutation response не содержит result object")
        return dict(result)


def _notifications(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise OperatorError("Provider notification list имеет неверную структуру")
    return [
        {
            "Code": item.get("Code"),
            "Message": safe_text(item.get("Message")),
            "Details": safe_text(item.get("Details")) if item.get("Details") else None,
        }
        for item in value
        if isinstance(item, Mapping)
    ]


def strict_action_rows(
    result: Mapping[str, Any],
    key: str,
    *,
    expected_count: int,
    id_field: str,
    expected_ids: Sequence[int] | None = None,
) -> list[Any]:
    rows = result.get(key)
    if not isinstance(rows, list) or len(rows) != expected_count:
        raise OperatorError(f"Direct mutation не вернула точный {key}")
    warnings = _notifications(result.get("Warnings"))
    values: list[Any] = []
    for row_index, row in enumerate(rows):
        if not isinstance(row, Mapping):
            raise OperatorError(f"{key} row имеет неверный тип")
        errors = _notifications(row.get("Errors"))
        warnings.extend(_notifications(row.get("Warnings")))
        if errors:
            raise OperatorError(
                "Direct mutation вернула Errors",
                partial={"provider_error_row_index": row_index, "provider_errors": errors},
            )
        value = row.get(id_field)
        if id_field == "AdImageHash":
            if not isinstance(value, str) or not value:
                raise OperatorError("Direct mutation не вернула AdImageHash")
        else:
            value = exact_int(value, f"{key} {id_field}")
        values.append(value)
    if warnings:
        raise OperatorError(
            "Direct mutation вернула Warnings; дальнейшие стадии остановлены",
            partial={"provider_warnings": warnings, "provider_values": values},
        )
    if expected_ids is not None and sorted(values) != sorted(expected_ids):
        raise OperatorError(f"{key} вернул другие IDs")
    if len(set(values)) != len(values):
        raise OperatorError(f"{key} вернул дублирующиеся значения")
    return values


def _responsive_values(ad: Mapping[str, Any]) -> dict[str, Any]:
    creative = ad.get("ResponsiveAd")
    if not isinstance(creative, Mapping):
        raise OperatorError(f"Ad {ad.get('Id')} не является полным ResponsiveAd")
    titles = creative.get("Titles")
    texts = creative.get("Texts")
    if not isinstance(titles, list) or not isinstance(texts, list):
        raise OperatorError("ResponsiveAd titles/texts readback отсутствует")
    image_container = creative.get("AdImages")
    image_items = [] if image_container is None else image_container.get("Items")
    if not isinstance(image_items, list):
        raise OperatorError("ResponsiveAd AdImages readback некорректен")
    return {
        "titles": [item.get("Title") for item in titles if isinstance(item, Mapping)],
        "texts": [item.get("Text") for item in texts if isinstance(item, Mapping)],
        "href": creative.get("Href"),
        "display": creative.get("DisplayUrlPath"),
        "sitelink": creative.get("SitelinkSetId"),
        "images": [item.get("ImageHash") for item in image_items if isinstance(item, Mapping)],
    }


def read_all_sitelinks(api: Any) -> list[dict[str, Any]]:
    """Read account-wide sets so a retry reuses sets created by a partial run."""
    result = api.call(
        guard.CANONICAL_API_VERSION,
        "sitelinks",
        "get",
        {
            "FieldNames": ["Id"],
            "SitelinkFieldNames": ["Title", "Href", "Description", "TurboPageId"],
            "Page": {"Limit": 10000, "Offset": 0},
        },
        use_client_login=True,
    )
    rows = result.get("SitelinksSets")
    if not isinstance(rows, list):
        raise OperatorError("Account-wide sitelinks.get не вернул SitelinksSets")
    if len(rows) >= 10000 or result.get("LimitedBy") is not None:
        raise OperatorError("Account-wide sitelinks.get достиг page limit; reuse не доказан")
    ids = [exact_int(item.get("Id"), "SitelinksSet Id") for item in rows]
    if len(ids) != len(set(ids)):
        raise OperatorError("Account-wide sitelinks.get вернул duplicate IDs")
    return sorted((dict(item) for item in rows), key=lambda item: item["Id"])


def read_target_snapshot(api: Any, *, require_baseline_ads: bool = True) -> dict[str, Any]:
    campaign = guard.read_campaign(api, guard.CANONICAL_API_VERSION)
    guard.validate_canonical_campaign(
        campaign,
        require_draft=False,
        allowed_states=("SUSPENDED",),
    )
    ads = guard.read_ads(api, include_creatives=True)
    if require_baseline_ads:
        guard.validate_creative_cas(ads)
    groups = guard.read_adgroups(api)
    keywords = guard.read_keywords(api)
    sitelink_ids = guard._sitelink_ids(ads)
    sitelinks = guard.read_sitelinks(api, sitelink_ids)
    all_sitelinks = read_all_sitelinks(api)
    raw = {
        "campaign": campaign,
        "adgroups": groups,
        "ads": ads,
        "keywords": keywords,
        "sitelinks": sitelinks,
        "all_sitelinks": all_sitelinks,
    }
    return {
        "raw": raw,
        "sha256": _content_cas_sha256(raw),
        # Kept only to verify the already-issued pinned partial receipt. New
        # dry-runs and all new CAS handoffs use the canonical content hash.
        "legacy_raw_sha256": sha256_json(raw),
        "counts": {
            "adgroups": len(groups),
            "ads": len(ads),
            "keywords": len(keywords),
            "sitelinks": len(sitelinks),
            "account_sitelinks": len(all_sitelinks),
        },
    }


def validate_baseline(snapshot: Mapping[str, Any]) -> None:
    raw = snapshot.get("raw")
    if not isinstance(raw, Mapping):
        raise OperatorError("Target snapshot raw отсутствует")
    campaign = raw.get("campaign")
    if not isinstance(campaign, Mapping):
        raise OperatorError("Target campaign отсутствует")
    if exact_int(campaign.get("Id"), "Campaign Id") != TARGET_CAMPAIGN_ID:
        raise OperatorError("Target snapshot содержит другую кампанию")
    if campaign.get("Type") != "UNIFIED_CAMPAIGN" or campaign.get("Status") != "ACCEPTED" or campaign.get("State") != "SUSPENDED":
        raise OperatorError("Creative baseline требует UNIFIED/ACCEPTED/SUSPENDED")
    unified = guard.validate_canonical_campaign(
        campaign,
        require_draft=False,
        allowed_states=("SUSPENDED",),
    )
    if unified.get("PackageBiddingStrategy") is not None:
        raise OperatorError("Пакетная стратегия блокирует creative apply")
    measurement = guard.measurement(campaign, allowed_states=("SUSPENDED",))
    if measurement != {"CounterIds": [EXPECTED_COUNTER_ID], "PriorityGoals": None}:
        raise OperatorError("Measurement baseline изменился; creative apply заблокирован")

    groups = raw.get("adgroups")
    if not isinstance(groups, list) or {item.get("Id") for item in groups} != set(GROUP_IDS.values()):
        raise OperatorError("Baseline должен содержать ровно пять exact groups")
    for item in groups:
        group_id = exact_int(item.get("Id"), "AdGroup Id")
        negatives = _normalise_negative_items(
            item.get("NegativeKeywords", {}).get("Items"), f"AdGroup {group_id} negatives"
        )
        if item.get("Name") != BASELINE_GROUP_NAMES[group_id] or negatives != sorted(set(BASELINE_NEGATIVES)):
            raise OperatorError(f"AdGroup {group_id} baseline drift")

    ads = raw.get("ads")
    if not isinstance(ads, list) or {item.get("Id") for item in ads} != set(EXISTING_AD_IDS.values()):
        raise OperatorError("Baseline должен содержать пять exact 64-bit ads")
    for ad in ads:
        ad_id = exact_int(ad.get("Id"), "Ad Id")
        expected = BASELINE_ADS[ad_id]
        if exact_int(ad.get("AdGroupId"), "AdGroup Id") != expected["group"]:
            raise OperatorError(f"Ad {ad_id} group drift")
        if ad.get("Status") != "ACCEPTED" or ad.get("State") != "OFF":
            raise OperatorError(f"Ad {ad_id} lifecycle baseline drift")
        if _responsive_values(ad) != {key: expected[key] for key in ("titles", "texts", "href", "display", "sitelink", "images")}:
            raise OperatorError(f"Ad {ad_id} creative baseline drift")

    keywords = raw.get("keywords")
    if not isinstance(keywords, list) or {item.get("Id") for item in keywords} != BASELINE_KEYWORD_IDS:
        raise OperatorError("Baseline keyword IDs drift")
    by_id = {exact_int(item.get("Id"), "Keyword Id"): item for item in keywords}
    for keyword_id, (group_id, phrase) in BASELINE_EXPLICIT_KEYWORDS.items():
        item = by_id[keyword_id]
        if item.get("Keyword") != phrase or item.get("AdGroupId") != group_id or item.get("State") != "ON":
            raise OperatorError(f"Keyword {keyword_id} baseline drift")
    for keyword_id, group_id in AUTOTARGETING_IDS.items():
        item = by_id[keyword_id]
        if item.get("Keyword") != "---autotargeting" or item.get("AdGroupId") != group_id or item.get("State") != "ON":
            raise OperatorError(f"Autotargeting {keyword_id} baseline drift")

    sitelinks = raw.get("sitelinks")
    if not isinstance(sitelinks, list) or [item.get("Id") for item in sitelinks] != [BASELINE_SITELINK_SET_ID]:
        raise OperatorError("Baseline sitelink set drift")


def validate_partial_apply_receipt() -> dict[str, Any]:
    if (
        not PARTIAL_APPLY_RECEIPT.is_file()
        or PARTIAL_APPLY_RECEIPT.is_symlink()
        or _sha256_file(PARTIAL_APPLY_RECEIPT) != PARTIAL_APPLY_RECEIPT_SHA256
    ):
        raise OperatorError("Pinned partial apply receipt отсутствует или SHA drift")
    try:
        receipt = json.loads(PARTIAL_APPLY_RECEIPT.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise OperatorError("Pinned partial apply receipt невалиден") from None
    stages = receipt.get("stage_receipts")
    if (
        receipt.get("status") != "manual_inspection_required_suspended"
        or receipt.get("final_campaign_state") != "SUSPENDED"
        or receipt.get("protected_unchanged") is not True
        or receipt.get("mutation_requests") != 4
        or [item.get("kind") for item in stages or []]
        != ["sitelinks_add", "adgroups_update", "keywords_update"]
        or receipt.get("provider_values")
        != [
            57_915_373_903,
            57_915_373_905,
            *PARTIAL_NEW_KEYWORDS.keys(),
        ]
        or [item.get("Code") for item in receipt.get("provider_warnings", [])]
        != [10140, 10140]
    ):
        raise OperatorError("Pinned partial apply receipt не соответствует recovery boundary")
    resolved = stages[0].get("resolved_ids")
    if resolved != PARTIAL_SITELINK_IDS:
        raise OperatorError("Pinned partial receipt sitelink IDs drift")
    return {
        "path": str(PARTIAL_APPLY_RECEIPT.relative_to(PROJECT_ROOT)),
        "sha256": PARTIAL_APPLY_RECEIPT_SHA256,
        "completed_stages": [
            "sitelinks_add",
            "adgroups_update",
            "keywords_update",
            "keywords_add_partial_provider_success",
        ],
        "provider_warning_codes": [10140, 10140],
        "existing_alias_ids": [57_915_373_903, 57_915_373_905],
        "new_keyword_ids": list(PARTIAL_NEW_KEYWORDS),
    }


def validate_second_partial_receipt() -> dict[str, Any]:
    if (
        not SECOND_PARTIAL_RECEIPT.is_file()
        or SECOND_PARTIAL_RECEIPT.is_symlink()
        or _sha256_file(SECOND_PARTIAL_RECEIPT)
        != SECOND_PARTIAL_RECEIPT_SHA256
    ):
        raise OperatorError("Pinned second partial receipt отсутствует или SHA drift")
    try:
        receipt = json.loads(SECOND_PARTIAL_RECEIPT.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise OperatorError("Pinned second partial receipt невалиден") from None
    errors = receipt.get("provider_errors")
    mutation_kinds = [
        item.get("mutation_kind")
        for item in receipt.get("request_log", [])
        if item.get("mutation_kind") is not None
    ]
    if (
        receipt.get("status") != "manual_inspection_required_suspended"
        or receipt.get("final_campaign_state") != "SUSPENDED"
        or receipt.get("protected_unchanged") is not True
        or receipt.get("mutation_requests") != 1
        or receipt.get("preimage_cas_sha256")
        != "3b7498bc55626c3dc0d8baaa6f17ab3e2207011b1f09ff14aba7c57666e26285"
        or receipt.get("stage_receipts") != []
        or mutation_kinds != ["keywords_suspend"]
        or not isinstance(errors, list)
        or len(errors) != 1
        or errors[0].get("Code") != 8305
        or errors[0].get("Details")
        != "Автотаргетинг не может быть остановлен"
    ):
        raise OperatorError("Pinned second partial receipt не совпал с error 8305 boundary")
    return {
        "path": str(SECOND_PARTIAL_RECEIPT.relative_to(PROJECT_ROOT)),
        "sha256": SECOND_PARTIAL_RECEIPT_SHA256,
        "provider_error_code": 8305,
        "provider_error_details": "Автотаргетинг не может быть остановлен",
        "attempted_autotarget_id": PARKED_AUTOTARGET_ID,
        "campaign_state": "SUSPENDED",
        "protected_unchanged": True,
    }


def validate_third_partial_receipt() -> dict[str, Any]:
    """Pin the v5 EPK rejection before permitting a v501-only recovery."""
    if (
        not THIRD_PARTIAL_RECEIPT.is_file()
        or THIRD_PARTIAL_RECEIPT.is_symlink()
        or _sha256_file(THIRD_PARTIAL_RECEIPT)
        != THIRD_PARTIAL_RECEIPT_SHA256
    ):
        raise OperatorError("Pinned third partial receipt отсутствует или SHA drift")
    try:
        receipt = json.loads(THIRD_PARTIAL_RECEIPT.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise OperatorError("Pinned third partial receipt невалиден") from None
    errors = receipt.get("provider_errors")
    mutation_rows = [
        {
            "version": item.get("version"),
            "service": item.get("service"),
            "method": item.get("method"),
            "mutation_kind": item.get("mutation_kind"),
        }
        for item in receipt.get("request_log", [])
        if item.get("mutation_kind") is not None
    ]
    if (
        receipt.get("mode") != "recover-partial"
        or receipt.get("status") != "manual_inspection_required_suspended"
        or receipt.get("final_campaign_state") != "SUSPENDED"
        or receipt.get("campaign_unchanged") is not True
        or receipt.get("protected_unchanged") is not True
        or receipt.get("mutation_requests") != 1
        or receipt.get("preimage_cas_sha256")
        != THIRD_PARTIAL_PREIMAGE_CAS_SHA256
        or receipt.get("payload", {}).get("plan_sha256")
        != THIRD_PARTIAL_PLAN_SHA256
        or receipt.get("stage_receipts") != []
        or mutation_rows
        != [
            {
                "version": "v5",
                "service": "ads",
                "method": "update",
                "mutation_kind": "ads_update",
            }
        ]
        or not isinstance(errors, list)
        or len(errors) != 1
        or errors[0].get("Code") != 3500
        or errors[0].get("Details")
        != "Объявление данного типа не поддерживается в v5, используйте v501"
    ):
        raise OperatorError("Pinned third partial receipt не совпал с error 3500 boundary")
    return {
        "path": str(THIRD_PARTIAL_RECEIPT.relative_to(PROJECT_ROOT)),
        "sha256": THIRD_PARTIAL_RECEIPT_SHA256,
        "provider_error_code": 3500,
        "provider_error_details": (
            "Объявление данного типа не поддерживается в v5, используйте v501"
        ),
        "rejected_request": mutation_rows[0],
        "preimage_cas_sha256": THIRD_PARTIAL_PREIMAGE_CAS_SHA256,
        "campaign_state": "SUSPENDED",
        "campaign_unchanged": True,
        "protected_unchanged": True,
        "completed_ad_stages": [],
    }


def validate_partial_state(
    snapshot: Mapping[str, Any],
    payload: Mapping[str, Any],
    *,
    after_autotarget_error: bool = False,
    after_epk_v5_error: bool = False,
) -> dict[str, Any]:
    if after_epk_v5_error and not after_autotarget_error:
        raise OperatorError("EPK v5 boundary требует подтверждённый 8305 boundary")
    evidence = validate_partial_apply_receipt()
    second_evidence = (
        validate_second_partial_receipt() if after_autotarget_error else None
    )
    third_evidence = (
        validate_third_partial_receipt() if after_epk_v5_error else None
    )
    if (
        after_epk_v5_error
        and snapshot.get("legacy_raw_sha256", snapshot.get("sha256"))
        != THIRD_PARTIAL_PREIMAGE_CAS_SHA256
    ):
        raise OperatorError(
            "Fresh post-3500 snapshot не совпал с exact preimage CAS third receipt"
        )
    raw = snapshot.get("raw")
    if not isinstance(raw, Mapping):
        raise OperatorError("Partial snapshot raw отсутствует")
    campaign = raw.get("campaign")
    if not isinstance(campaign, Mapping):
        raise OperatorError("Partial campaign отсутствует")
    if (
        exact_int(campaign.get("Id"), "Campaign Id") != TARGET_CAMPAIGN_ID
        or campaign.get("Type") != "UNIFIED_CAMPAIGN"
        or campaign.get("Status") != "ACCEPTED"
        or campaign.get("State") != "SUSPENDED"
    ):
        raise OperatorError("Partial recovery требует exact ACCEPTED/SUSPENDED campaign")
    unified = guard.validate_canonical_campaign(
        campaign, require_draft=False, allowed_states=("SUSPENDED",)
    )
    if unified.get("PackageBiddingStrategy") is not None:
        raise OperatorError("Partial recovery запрещён при package bidding")
    if guard.measurement(campaign, allowed_states=("SUSPENDED",)) != {
        "CounterIds": [EXPECTED_COUNTER_ID],
        "PriorityGoals": None,
    }:
        raise OperatorError("Partial recovery measurement drift")

    desired_groups = {
        exact_int(item.get("Id"), "Desired AdGroup Id"): item
        for item in _current_stage_params(payload, "adgroups", "update")["AdGroups"]
    }
    groups = {
        exact_int(item.get("Id"), "AdGroup Id"): item for item in raw.get("adgroups", [])
    }
    if set(groups) != set(GROUP_IDS.values()) or set(desired_groups) != set(groups):
        raise OperatorError("Partial recovery group ID set drift")
    group_diffs: list[dict[str, Any]] = []
    for group_id, desired in desired_groups.items():
        actual = groups[group_id]
        if (
            actual.get("Name") != desired.get("Name")
            or _normalise_negative_items(actual.get("NegativeKeywords", {}).get("Items"))
            != _normalise_negative_items(desired.get("NegativeKeywords", {}).get("Items"))
        ):
            actual_negatives = set(actual.get("NegativeKeywords", {}).get("Items") or [])
            desired_negatives = set(desired.get("NegativeKeywords", {}).get("Items") or [])
            group_diffs.append(
                {
                    "group_id": group_id,
                    "actual_name": actual.get("Name"),
                    "desired_name": desired.get("Name"),
                    "missing_negatives": sorted(desired_negatives - actual_negatives),
                    "extra_negatives": sorted(actual_negatives - desired_negatives),
                }
            )
    if group_diffs:
        raise OperatorError(
            "Partial recovery groups have provider-normalized drift",
            partial={"group_diffs": group_diffs},
        )

    ads = raw.get("ads")
    if not isinstance(ads, list) or {item.get("Id") for item in ads} != set(
        EXISTING_AD_IDS.values()
    ):
        raise OperatorError("Partial recovery requires exact five unchanged ads")
    for ad in ads:
        ad_id = exact_int(ad.get("Id"), "Ad Id")
        expected = BASELINE_ADS[ad_id]
        if (
            ad.get("AdGroupId") != expected["group"]
            or ad.get("Status") != "ACCEPTED"
            or ad.get("State") != "OFF"
            or _responsive_values(ad)
            != {
                key: expected[key]
                for key in ("titles", "texts", "href", "display", "sitelink", "images")
            }
        ):
            raise OperatorError(f"Partial recovery ad preimage drift {ad_id}")
    parked_group_ads = [
        ad
        for ad in ads
        if ad.get("AdGroupId") == GROUP_IDS["parked_extrime_toyota"]
    ]
    if (
        len(parked_group_ads) != 1
        or parked_group_ads[0].get("Id") != PARKED_AD_ID
        or parked_group_ads[0].get("State") != "OFF"
    ):
        raise OperatorError("Parked group must have exact sole pre-recovery ad ...8815")

    desired_updates = {
        exact_int(item.get("Id"), "Desired Keyword Id"): item.get("Keyword")
        for item in payload["keywords"]["update"]
    }
    keyword_rows = raw.get("keywords")
    expected_ids = BASELINE_KEYWORD_IDS | set(PARTIAL_NEW_KEYWORDS)
    if not isinstance(keyword_rows, list) or {item.get("Id") for item in keyword_rows} != expected_ids:
        raise OperatorError("Partial recovery keyword ID set is not exact baseline+five")
    keywords = {exact_int(item.get("Id"), "Keyword Id"): item for item in keyword_rows}
    already_suspended_explicit: list[int] = []
    remaining_explicit_suspend: list[int] = []
    for keyword_id, (group_id, baseline_phrase) in BASELINE_EXPLICIT_KEYWORDS.items():
        item = keywords[keyword_id]
        expected_phrase = desired_updates.get(keyword_id, baseline_phrase)
        state = item.get("State")
        if keyword_id in KEYWORD_SUSPEND_IDS and after_autotarget_error:
            if state == "SUSPENDED":
                already_suspended_explicit.append(keyword_id)
            elif state == "ON":
                remaining_explicit_suspend.append(keyword_id)
            else:
                raise OperatorError(
                    f"Second partial explicit keyword state drift {keyword_id}"
                )
        elif state != "ON":
            raise OperatorError(f"Partial recovery keyword state drift {keyword_id}")
        elif keyword_id in KEYWORD_SUSPEND_IDS:
            remaining_explicit_suspend.append(keyword_id)
        if (
            item.get("AdGroupId") != group_id
            or item.get("Keyword") != expected_phrase
        ):
            raise OperatorError(f"Partial recovery keyword drift {keyword_id}")
    if after_autotarget_error and not already_suspended_explicit:
        raise OperatorError("Second partial receipt did not produce any explicit suspend")
    for keyword_id, group_id in AUTOTARGETING_IDS.items():
        item = keywords[keyword_id]
        if (
            item.get("AdGroupId") != group_id
            or item.get("Keyword") != "---autotargeting"
            or item.get("State") != "ON"
        ):
            raise OperatorError(f"Partial recovery autotargeting drift {keyword_id}")
    for keyword_id, (group_id, phrase) in PARTIAL_NEW_KEYWORDS.items():
        item = keywords[keyword_id]
        if (
            item.get("AdGroupId") != group_id
            or item.get("Keyword") != phrase
            or item.get("State") != "ON"
        ):
            raise OperatorError(f"Partial recovery added keyword drift {keyword_id}")
    desired_add = [
        (item.get("AdGroupId"), item.get("Keyword"))
        for item in payload["keywords"]["add"]
    ]
    if desired_add != list(PARTIAL_NEW_KEYWORDS.values()):
        raise OperatorError("Current source add rows do not match partial provider IDs")

    reuse = plan_sitelink_reuse(raw.get("all_sitelinks", []), payload["sitelinkSets"])
    resolved = resolve_sitelink_ids(reuse, []) if not reuse["add_keys"] else None
    if reuse["add_keys"] or resolved != PARTIAL_SITELINK_IDS:
        raise OperatorError("Partial recovery must reuse exact four completed sitelink sets")
    if [item.get("Id") for item in raw.get("sitelinks", [])] != [BASELINE_SITELINK_SET_ID]:
        raise OperatorError("Partial recovery ads already reference unexpected sitelinks")
    remaining_stages = [
        *(["keywords_suspend"] if remaining_explicit_suspend else []),
        "ads_update",
        "ads_add",
        "ads_suspend",
    ]
    if after_epk_v5_error:
        classification_name = "partial_after_epk_ads_v5_error_3500"
    elif after_autotarget_error:
        classification_name = "partial_after_autotarget_8305"
    else:
        classification_name = "partial_after_keyword_normalization_warning"
    return {
        "classification": classification_name,
        "campaign_state": "SUSPENDED",
        "completed_stages": [
            *evidence["completed_stages"],
            *(["keywords_suspend_provider_partial_action"] if after_autotarget_error else []),
        ],
        "remaining_stages": remaining_stages,
        "keyword_count": len(keywords),
        "current_on_explicit_keyword_count": sum(
            1
            for item_id in BASELINE_EXPLICIT_KEYWORDS | PARTIAL_NEW_KEYWORDS
            if keywords[item_id].get("State") == "ON"
        ),
        "desired_post_active_explicit_keyword_count": 21,
        "semantic_yes_phrase_count": SEMANTIC_EVIDENCE_PHRASE_COUNT,
        "already_suspended_explicit_ids": sorted(already_suspended_explicit),
        "remaining_explicit_suspend_ids": sorted(remaining_explicit_suspend),
        "parked_autotarget": {
            "id": PARKED_AUTOTARGET_ID,
            "state": "ON",
            "cannot_suspend_provider_error": 8305 if after_autotarget_error else None,
            "ad_group_id": GROUP_IDS["parked_extrime_toyota"],
            "sole_ad_id": PARKED_AD_ID,
            "sole_ad_current_state": "OFF",
            "sole_ad_required_post_state": "SUSPENDED",
        },
        "sitelink_ids": resolved,
        "partial_receipt": evidence,
        "second_partial_receipt": second_evidence,
        "third_partial_receipt": third_evidence,
        "ads_post_error_exact_preimage_unchanged": after_epk_v5_error,
    }


def validate_corrective_preimage(
    snapshot: Mapping[str, Any], payload: Mapping[str, Any]
) -> dict[str, Any]:
    """Recognise the exact suspended state produced by the pinned recovery.

    The historical payload is the content preimage for the corrective bundle.
    Provider ordering/duplicate normalisation of negatives and moderation-only
    fields are deliberately outside content CAS; entity IDs, mutable content,
    URLs/images and every serving State remain exact.
    """
    if (
        not CORRECTIVE_PREIMAGE_RECEIPT.is_file()
        or _sha256_file(CORRECTIVE_PREIMAGE_RECEIPT)
        != CORRECTIVE_PREIMAGE_RECEIPT_SHA256
        or not CORRECTIVE_PREIMAGE_PAYLOAD.is_file()
        or _sha256_file(CORRECTIVE_PREIMAGE_PAYLOAD)
        != CORRECTIVE_PREIMAGE_PAYLOAD_SHA256
        or not LIVE_PREFLIGHT_REPORT.is_file()
        or _sha256_file(LIVE_PREFLIGHT_REPORT) != LIVE_PREFLIGHT_REPORT_SHA256
    ):
        raise OperatorError("Corrective preimage evidence missing or changed")
    try:
        receipt = json.loads(CORRECTIVE_PREIMAGE_RECEIPT.read_text(encoding="utf-8"))
        old_payload = json.loads(CORRECTIVE_PREIMAGE_PAYLOAD.read_text(encoding="utf-8"))
        preflight = LIVE_PREFLIGHT_REPORT.read_text(encoding="utf-8")
    except (OSError, json.JSONDecodeError) as error:
        raise OperatorError("Corrective preimage evidence unreadable") from error
    if (
        receipt.get("status") != "recovered_verified_suspended"
        or receipt.get("scope", {}).get("login") != EXPECTED_LOGIN
        or receipt.get("scope", {}).get("campaign_id") != TARGET_CAMPAIGN_ID
        or receipt.get("readback", {}).get("new_ad_id")
        != CORRECTIVE_PREIMAGE_NEW_AD_ID
        or receipt.get("final_campaign_state") != "SUSPENDED"
        or receipt.get("payload", {}).get("artifact_sha256")
        != CORRECTIVE_PREIMAGE_PAYLOAD_SHA256
        or receipt.get("mutation_requests") != 3
        or receipt.get("readback", {}).get("moderation_called") is not False
        or "safe_suspended_provider_normalization_drift" not in preflight
        or str(CORRECTIVE_PREIMAGE_NEW_AD_ID) not in preflight
    ):
        raise OperatorError("Corrective preimage receipt/preflight contract drift")

    raw = snapshot.get("raw")
    if not isinstance(raw, Mapping):
        raise OperatorError("Corrective preimage raw отсутствует")
    campaign = raw.get("campaign")
    if not isinstance(campaign, Mapping):
        raise OperatorError("Corrective preimage campaign отсутствует")
    if (
        exact_int(campaign.get("Id"), "Campaign Id") != TARGET_CAMPAIGN_ID
        or campaign.get("Type") != "UNIFIED_CAMPAIGN"
        or campaign.get("State") != "SUSPENDED"
    ):
        raise OperatorError("Corrective preimage campaign ID/type/State drift")
    unified = guard.validate_canonical_campaign(
        campaign, require_draft=False, allowed_states=("SUSPENDED",)
    )
    if unified.get("PackageBiddingStrategy") is not None:
        raise OperatorError("Corrective preimage запрещён при package bidding")
    if guard.measurement(campaign, allowed_states=("SUSPENDED",)) != {
        "CounterIds": [EXPECTED_COUNTER_ID],
        "PriorityGoals": None,
    }:
        raise OperatorError("Corrective preimage measurement drift")

    old_requests = build_materialized_requests(
        old_payload,
        image_hash=BASELINE_GENERIC_IMAGE_HASH,
        sitelink_ids=PARTIAL_SITELINK_IDS,
    )
    verified = verify_post_readback(
        snapshot,
        old_payload,
        old_requests,
        new_keyword_ids=sorted(PARTIAL_NEW_KEYWORDS),
        new_ad_id=CORRECTIVE_PREIMAGE_NEW_AD_ID,
        sitelink_ids=PARTIAL_SITELINK_IDS,
    )

    ads = {exact_int(item.get("Id"), "Ad Id"): item for item in raw.get("ads", [])}
    for ad_id, item in ads.items():
        expected_state = "SUSPENDED" if ad_id == PARKED_AD_ID else "OFF"
        if item.get("State") != expected_state:
            raise OperatorError(f"Corrective preimage ad State drift {ad_id}")
    keywords = {
        exact_int(item.get("Id"), "Keyword Id"): item
        for item in raw.get("keywords", [])
    }
    for keyword_id, item in keywords.items():
        expected_state = "SUSPENDED" if keyword_id in KEYWORD_SUSPEND_IDS else "ON"
        if item.get("State") != expected_state:
            raise OperatorError(f"Corrective preimage keyword State drift {keyword_id}")

    return {
        "classification": "safe_corrective_preimage",
        "campaign_state": "SUSPENDED",
        "completed_stages": [],
        "remaining_stages": [
            "adgroups_update",
            "keywords_update",
            "ads_update",
            "ads_add",
        ],
        "historical_preimage_receipt": str(
            CORRECTIVE_PREIMAGE_RECEIPT.relative_to(PROJECT_ROOT)
        ),
        "historical_preimage_receipt_sha256": CORRECTIVE_PREIMAGE_RECEIPT_SHA256,
        "live_preflight_sha256": LIVE_PREFLIGHT_REPORT_SHA256,
        "provider_normalization_ignored": [
            "NegativeKeywords.Items order/duplicates",
            "moderation lifecycle fields",
        ],
        "strict_fields": ["Ids", "State", "content", "UTM", "images"],
        "readback": verified,
        "target_plan_sha256": sha256_json(_stable_plan_view(payload)),
    }


def build_corrective_requests(
    payload: Mapping[str, Any], image_hashes: Mapping[str, str]
) -> dict[str, dict[str, Any]]:
    materialized = build_materialized_requests(
        payload,
        image_hash=image_hashes,
        sitelink_ids=PARTIAL_SITELINK_IDS,
    )
    added = copy.deepcopy(materialized["ads_add"]["params"]["Ads"][0]["ResponsiveAd"])
    added_hashes = added.get("AdImageHashes")
    if not isinstance(added_hashes, list) or len(added_hashes) != 1:
        raise OperatorError("Corrective recovered ad image contract drift")
    added["AdImageHashes"] = {"Items": added_hashes}
    ad_rows = copy.deepcopy(materialized["ads_update"]["params"]["Ads"])
    ad_rows.append({"Id": CORRECTIVE_PREIMAGE_NEW_AD_ID, "ResponsiveAd": added})
    requests = {
        "corrective_adgroups_update": {
            **materialized["adgroups_update"],
            "mutation_kind": "corrective_adgroups_update",
        },
        "corrective_keywords_update": {
            **materialized["keywords_update"],
            "mutation_kind": "corrective_keywords_update",
        },
        "corrective_ads_update": {
            "version": "v501",
            "service": "ads",
            "method": "update",
            "mutation_kind": "corrective_ads_update",
            "params": {"Ads": ad_rows},
        },
    }
    for request in requests.values():
        assert_mutation_contract(
            request["version"],
            request["service"],
            request["method"],
            request["params"],
            request["mutation_kind"],
        )
    return requests


def validate_corrective_target(
    snapshot: Mapping[str, Any],
    payload: Mapping[str, Any],
    image_hashes: Mapping[str, str],
) -> dict[str, Any]:
    corrective = build_corrective_requests(payload, image_hashes)
    regular = build_materialized_requests(
        payload,
        image_hash=image_hashes,
        sitelink_ids=PARTIAL_SITELINK_IDS,
    )
    raw = snapshot.get("raw")
    if not isinstance(raw, Mapping):
        raise OperatorError("Corrective target raw отсутствует")
    campaign = raw.get("campaign")
    if not isinstance(campaign, Mapping):
        raise OperatorError("Corrective target campaign отсутствует")
    if (
        exact_int(campaign.get("Id"), "Campaign Id") != TARGET_CAMPAIGN_ID
        or campaign.get("Type") != "UNIFIED_CAMPAIGN"
        or campaign.get("State") != "SUSPENDED"
    ):
        raise OperatorError("Corrective target campaign ID/type/State drift")
    unified = guard.validate_canonical_campaign(
        campaign, require_draft=False, allowed_states=("SUSPENDED",)
    )
    if unified.get("PackageBiddingStrategy") is not None:
        raise OperatorError("Corrective target запрещён при package bidding")
    if guard.measurement(campaign, allowed_states=("SUSPENDED",)) != {
        "CounterIds": [EXPECTED_COUNTER_ID],
        "PriorityGoals": None,
    }:
        raise OperatorError("Corrective target measurement drift")
    verified = verify_post_readback(
        snapshot,
        payload,
        regular,
        new_keyword_ids=sorted(PARTIAL_NEW_KEYWORDS),
        new_ad_id=CORRECTIVE_PREIMAGE_NEW_AD_ID,
        sitelink_ids=PARTIAL_SITELINK_IDS,
    )
    ads = {exact_int(item.get("Id"), "Ad Id"): item for item in raw.get("ads", [])}
    for ad_id, item in ads.items():
        expected_state = "SUSPENDED" if ad_id == PARKED_AD_ID else "OFF"
        if item.get("State") != expected_state:
            raise OperatorError(f"Corrective target ad State drift {ad_id}")
    keywords = {
        exact_int(item.get("Id"), "Keyword Id"): item
        for item in raw.get("keywords", [])
    }
    for keyword_id, item in keywords.items():
        expected_state = "SUSPENDED" if keyword_id in KEYWORD_SUSPEND_IDS else "ON"
        if item.get("State") != expected_state:
            raise OperatorError(f"Corrective target keyword State drift {keyword_id}")
    return {
        "classification": "corrective_target_exact",
        "campaign_state": "SUSPENDED",
        "mutation_requests_required": 0,
        "request_contract_sha256": sha256_json(corrective),
        "readback": verified,
    }


def classify_target_state(
    snapshot: Mapping[str, Any], payload: Mapping[str, Any]
) -> dict[str, Any]:
    try:
        validate_baseline(snapshot)
        return {"classification": "baseline", "campaign_state": "SUSPENDED"}
    except OperatorError as baseline_error:
        try:
            return validate_corrective_preimage(snapshot, payload)
        except OperatorError as corrective_error:
            try:
                return validate_partial_state(
                    snapshot,
                    payload,
                    after_autotarget_error=True,
                    after_epk_v5_error=True,
                )
            except OperatorError as third_partial_error:
                try:
                    return validate_partial_state(snapshot, payload)
                except OperatorError as partial_error:
                    try:
                        return validate_partial_state(
                            snapshot, payload, after_autotarget_error=True
                        )
                    except OperatorError as second_partial_error:
                        raise OperatorError(
                            "Target state is not baseline/corrective-preimage/partial-v1/partial-v2/partial-v3: "
                            f"baseline={safe_text(baseline_error)}; "
                            f"corrective={safe_text(corrective_error)}; "
                            f"partial_v1={safe_text(partial_error)}; "
                            f"partial_v2={safe_text(second_partial_error)}; "
                            f"partial_v3={safe_text(third_partial_error)}",
                            partial={
                                "partial_state_diagnostic": third_partial_error.partial
                            },
                        ) from None


def assert_exact_cas(actual: str, expected: str | None) -> None:
    if not expected or not re.fullmatch(r"[a-f0-9]{64}", expected):
        raise OperatorError("Apply требует exact --expected-cas-sha256 из свежего dry-run")
    if actual != expected:
        raise OperatorError("Target creative/semantic CAS snapshot изменился")


def verify_apply_unlock(environ: Mapping[str, str]) -> None:
    if environ.get(APPLY_GUARD_ENV) != APPLY_GUARD_VALUE:
        raise OperatorError("Creative apply заблокирован: exact environment unlock отсутствует")


def verify_recovery_unlock(environ: Mapping[str, str]) -> None:
    if environ.get(RECOVERY_GUARD_ENV) != RECOVERY_GUARD_VALUE:
        raise OperatorError("Partial recovery заблокирован: exact recovery unlock отсутствует")


def verify_corrective_unlock(environ: Mapping[str, str]) -> None:
    if environ.get(CORRECTIVE_GUARD_ENV) != CORRECTIVE_GUARD_VALUE:
        raise OperatorError("Corrective apply заблокирован: distinct exact unlock отсутствует")


def verify_image_upload_unlock(environ: Mapping[str, str]) -> None:
    if environ.get(IMAGE_UPLOAD_GUARD_ENV) != IMAGE_UPLOAD_GUARD_VALUE:
        raise OperatorError("Model image upload заблокирован: exact environment unlock отсутствует")


def _download_model_image(url: str, *, timeout: float = 20.0) -> bytes:
    _assert_domain_urls({"sourceUrl": url})
    request = Request(
        url,
        headers={"User-Agent": "Rosomaha-Direct-Model-Image/1.0", "Accept": "image/*"},
        method="GET",
    )
    try:
        with build_opener(RejectRedirects()).open(request, timeout=timeout) as response:
            if int(getattr(response, "status", response.getcode())) != 200:
                raise OperatorError("Model image download требует HTTP 200")
            data = response.read(1_500_001)
    except HTTPError as exc:
        raise OperatorError(f"Model image download HTTP {exc.code}") from None
    except (URLError, TimeoutError, OSError, ProviderError) as exc:
        raise OperatorError(f"Model image download transport: {safe_text(exc)}") from None
    if not data or len(data) > 1_500_000:
        raise OperatorError("Model image download имеет небезопасный размер")
    return data


def _prepare_wide_model_image(key: str, source: bytes) -> tuple[bytes, dict[str, Any]]:
    """Center-crop to the largest exact 16:9 frame; never upscale or synthesize."""
    try:
        with Image.open(io.BytesIO(source)) as image:
            image.load()
            source_format = image.format
            width, height = image.size
            factor = min(width // 16, height // 9)
            target = (factor * 16, factor * 9)
            if factor <= 0 or target[0] < 1080 or target[1] < 607:
                raise OperatorError(f"Model image {key} нельзя source-preserving привести к WIDE")
            left = (width - target[0]) // 2
            top = (height - target[1]) // 2
            crop_box = (left, top, left + target[0], top + target[1])
            cropped = image.crop(crop_box)
            output = io.BytesIO()
            if source_format == "PNG":
                cropped.save(output, format="PNG", optimize=False)
                output_format = "PNG"
            elif source_format in {"JPEG", "JPG"}:
                if cropped.mode not in {"RGB", "L"}:
                    cropped = cropped.convert("RGB")
                cropped.save(
                    output,
                    format="JPEG",
                    quality=95,
                    optimize=False,
                    progressive=False,
                    subsampling=2,
                )
                output_format = "JPEG"
            else:
                raise OperatorError(f"Model image {key} имеет неподдерживаемый source format")
    except OperatorError:
        raise
    except (OSError, ValueError) as exc:
        raise OperatorError(f"Model image {key} decode/crop failed: {safe_text(exc)}") from None
    prepared = output.getvalue()
    if not prepared or len(prepared) > 10_000_000:
        raise OperatorError(f"Model image {key} prepared file size вышел за API limit")
    return prepared, {
        "source_dimensions": [width, height],
        "prepared_dimensions": list(target),
        "crop_box": list(crop_box),
        "format": output_format,
        "transform": "center-crop-largest-exact-16x9-no-upscale",
        "prepared_bytes": len(prepared),
        "prepared_sha256": hashlib.sha256(prepared).hexdigest(),
    }


def build_model_image_upload_plan(
    *,
    keys: Sequence[str] | None = None,
    download: Any = _download_model_image,
) -> tuple[dict[str, Any], dict[str, bytes]]:
    if (
        not MODEL_IMAGE_REPORT.is_file()
        or MODEL_IMAGE_REPORT.is_symlink()
        or _sha256_file(MODEL_IMAGE_REPORT) != MODEL_IMAGE_REPORT_SHA256
    ):
        raise OperatorError("Model image evidence report SHA-256 не совпал")
    selected = list(MODEL_IMAGE_SOURCES) if keys is None else list(keys)
    if not selected or len(selected) != len(set(selected)) or any(
        key not in MODEL_IMAGE_SOURCES for key in selected
    ):
        raise OperatorError("Model image selection вышел за exact allowlist")
    blobs: dict[str, bytes] = {}
    rows: list[dict[str, Any]] = []
    for key in selected:
        expected = MODEL_IMAGE_SOURCES[key]
        data = download(expected["url"])
        actual_sha256 = hashlib.sha256(data).hexdigest()
        if len(data) != expected["bytes"] or actual_sha256 != expected["sha256"]:
            raise OperatorError(f"Model image {key} bytes/SHA-256 не совпали")
        prepared, transform = _prepare_wide_model_image(key, data)
        blobs[key] = prepared
        rows.append(
            {
                "key": key,
                "source_url": expected["url"],
                "source_sha256": actual_sha256,
                "source_bytes": len(data),
                "provider_name": f"rosomaha-713802902-{key}",
                **transform,
            }
        )
    plan = {
        "schema": "rosomaha-direct-model-images-v1",
        "campaign_id": TARGET_CAMPAIGN_ID,
        "exact_login": EXPECTED_LOGIN,
        "evidence_report": str(MODEL_IMAGE_REPORT.relative_to(PROJECT_ROOT)),
        "evidence_report_sha256": MODEL_IMAGE_REPORT_SHA256,
        "images": rows,
        "upload_count": len(selected),
        "selected_keys": selected,
        "campaign_remains_suspended": True,
        "moderation_called": False,
        "resume_called": False,
        "budget_changed": False,
        "goal_changed": False,
    }
    plan["plan_sha256"] = sha256_json(plan)
    return plan, blobs


def _model_image_add_request(blobs: Mapping[str, bytes]) -> dict[str, Any]:
    if set(blobs) != set(MODEL_IMAGE_SOURCES):
        raise OperatorError("Model image blob scope не совпал")
    params = {
        "AdImages": [
            {
                "ImageData": base64.b64encode(blobs[key]).decode("ascii"),
                "Name": f"rosomaha-713802902-{key}",
            }
            for key in MODEL_IMAGE_SOURCES
        ]
    }
    assert_mutation_contract("v5", "adimages", "add", params, "model_images_add")
    return params


def _single_model_image_add_request(key: str, blob: bytes) -> dict[str, Any]:
    if key not in MODEL_IMAGE_SOURCES or not blob:
        raise OperatorError("Single model image selection/blob вышел за allowlist")
    params = {
        "AdImages": [
            {
                "ImageData": base64.b64encode(blob).decode("ascii"),
                "Name": f"rosomaha-713802902-{key}",
            }
        ]
    }
    assert_mutation_contract("v5", "adimages", "add", params, "model_image_add_one")
    return params


def run_model_image_upload_dry_run(api: Any) -> dict[str, Any]:
    identity = guard.prove_identity(api)
    snapshot = read_target_snapshot(api, require_baseline_ads=False)
    campaign = snapshot["raw"]["campaign"]
    if exact_int(campaign.get("Id"), "Campaign Id") != TARGET_CAMPAIGN_ID or campaign.get("State") != "SUSPENDED":
        raise OperatorError("Model image dry-run требует exact SUSPENDED campaign")
    plan, blobs = build_model_image_upload_plan()
    _model_image_add_request(blobs)
    return {
        "mode": "image-upload-dry-run",
        "generated_at": utc_now(),
        "status": "ready",
        "account": identity,
        "target": {"campaign_id": TARGET_CAMPAIGN_ID, "state": "SUSPENDED", "cas_sha256": snapshot["sha256"]},
        "image_plan": plan,
        "mutation_requests": 0,
        "moderation_called": False,
        "resume_called": False,
        "budget_changed": False,
        "goal_changed": False,
    }


def run_model_image_upload_apply(
    api: Any,
    *,
    expected_cas_sha256: str,
    expected_image_plan_sha256: str,
    environ: Mapping[str, str],
    lock_policy: MutationLockPolicy | None = None,
) -> dict[str, Any]:
    verify_image_upload_unlock(environ)
    policy = lock_policy or MutationLockPolicy()
    with policy.hold() as lock_evidence:
        identity = guard.prove_identity(api)
        protected_before = guard.read_protected_snapshot(api)
        snapshot = read_target_snapshot(api, require_baseline_ads=False)
        campaign = snapshot["raw"]["campaign"]
        if exact_int(campaign.get("Id"), "Campaign Id") != TARGET_CAMPAIGN_ID or campaign.get("State") != "SUSPENDED":
            raise OperatorError("Model image upload требует exact SUSPENDED campaign")
        assert_exact_cas(snapshot["sha256"], expected_cas_sha256)
        plan, blobs = build_model_image_upload_plan()
        assert_exact_cas(plan["plan_sha256"], expected_image_plan_sha256)
        params = _model_image_add_request(blobs)
        result = api.call(
            "v5",
            "adimages",
            "add",
            params,
            use_client_login=True,
            mutation_kind="model_images_add",
        )
        hashes = strict_action_rows(
            result,
            "AddResults",
            expected_count=3,
            id_field="AdImageHash",
        )
        if len(set(hashes)) != 3:
            raise OperatorError("Provider вернул duplicate model image hashes")
        safety = _campaign_safety(api, campaign)
        protected_after = guard.read_protected_snapshot(api)
        guard.assert_protected_equal(protected_before, protected_after)
        return {
            "mode": "image-upload-apply",
            "generated_at": utc_now(),
            "status": "uploaded_verified_suspended",
            "account": identity,
            "global_lock": lock_evidence,
            "target": {"campaign_id": TARGET_CAMPAIGN_ID, "state": safety["state"], "cas_sha256": snapshot["sha256"]},
            "image_plan": plan,
            "provider_hashes": dict(zip(MODEL_IMAGE_SOURCES, hashes, strict=True)),
            "mutation_requests": int(getattr(api, "mutation_requests", 0)),
            "protected_unchanged": True,
            "moderation_called": False,
            "resume_called": False,
            "budget_changed": False,
            "goal_changed": False,
            "creative_apply_authorized": False,
        }


def verify_single_image_upload_unlock(key: str, environ: Mapping[str, str]) -> None:
    expected = IMAGE_UPLOAD_ONE_GUARD_VALUES.get(key)
    if expected is None or environ.get(IMAGE_UPLOAD_ONE_GUARD_ENV) != expected:
        raise OperatorError("Single model image upload: exact key-bound unlock отсутствует")


def run_single_model_image_upload_dry_run(api: Any, *, key: str) -> dict[str, Any]:
    if key not in MODEL_IMAGE_SOURCES:
        raise OperatorError("Single model image key вышел за allowlist")
    identity = guard.prove_identity(api)
    snapshot = read_target_snapshot(api, require_baseline_ads=False)
    campaign = snapshot["raw"]["campaign"]
    if exact_int(campaign.get("Id"), "Campaign Id") != TARGET_CAMPAIGN_ID or campaign.get("State") != "SUSPENDED":
        raise OperatorError("Single image dry-run требует exact SUSPENDED campaign")
    plan, blobs = build_model_image_upload_plan(keys=[key])
    _single_model_image_add_request(key, blobs[key])
    return {
        "mode": "image-upload-one-dry-run",
        "generated_at": utc_now(),
        "status": "ready",
        "selected_key": key,
        "account": identity,
        "target": {"campaign_id": TARGET_CAMPAIGN_ID, "state": "SUSPENDED", "cas_sha256": snapshot["sha256"]},
        "image_plan": plan,
        "mutation_requests": 0,
        "moderation_called": False,
        "resume_called": False,
        "budget_changed": False,
        "goal_changed": False,
    }


def run_single_model_image_upload_apply(
    api: Any,
    *,
    key: str,
    expected_cas_sha256: str,
    expected_image_plan_sha256: str,
    environ: Mapping[str, str],
    lock_policy: MutationLockPolicy | None = None,
) -> dict[str, Any]:
    verify_single_image_upload_unlock(key, environ)
    policy = lock_policy or MutationLockPolicy()
    with policy.hold() as lock_evidence:
        identity = guard.prove_identity(api)
        protected_before = guard.read_protected_snapshot(api)
        snapshot = read_target_snapshot(api, require_baseline_ads=False)
        campaign = snapshot["raw"]["campaign"]
        if exact_int(campaign.get("Id"), "Campaign Id") != TARGET_CAMPAIGN_ID or campaign.get("State") != "SUSPENDED":
            raise OperatorError("Single image upload требует exact SUSPENDED campaign")
        assert_exact_cas(snapshot["sha256"], expected_cas_sha256)
        plan, blobs = build_model_image_upload_plan(keys=[key])
        assert_exact_cas(plan["plan_sha256"], expected_image_plan_sha256)
        result = api.call(
            "v5",
            "adimages",
            "add",
            _single_model_image_add_request(key, blobs[key]),
            use_client_login=True,
            mutation_kind="model_image_add_one",
        )
        provider_hash = strict_action_rows(
            result, "AddResults", expected_count=1, id_field="AdImageHash"
        )[0]
        safety = _campaign_safety(api, campaign)
        protected_after = guard.read_protected_snapshot(api)
        guard.assert_protected_equal(protected_before, protected_after)
        return {
            "mode": "image-upload-one-apply",
            "generated_at": utc_now(),
            "status": "uploaded_one_verified_suspended",
            "selected_key": key,
            "account": identity,
            "global_lock": lock_evidence,
            "target": {"campaign_id": TARGET_CAMPAIGN_ID, "state": safety["state"], "cas_sha256": snapshot["sha256"]},
            "image_plan": plan,
            "provider_hash": provider_hash,
            "mutation_requests": int(getattr(api, "mutation_requests", 0)),
            "protected_unchanged": True,
            "moderation_called": False,
            "resume_called": False,
            "budget_changed": False,
            "goal_changed": False,
            "creative_apply_authorized": False,
        }


def validate_reused_image(
    payload: Mapping[str, Any],
) -> tuple[str | dict[str, str], dict[str, Any]]:
    item = payload.get("imageEvidence")
    if not isinstance(item, Mapping):
        raise OperatorError("Payload image evidence отсутствует")
    image_hash = item.get("hash")
    if image_hash != BASELINE_GENERIC_IMAGE_HASH:
        raise OperatorError("Current plan пытается использовать неподтверждённый image hash")
    _assert_domain_urls({"sourceUrl": item.get("sourceUrl")})
    provider_relative = item.get("providerReceipt")
    if not isinstance(provider_relative, str):
        raise OperatorError("Image provider receipt отсутствует")
    provider_path = (PROJECT_ROOT / provider_relative).resolve(strict=True)
    if provider_path.parent != REPORT_ROOT.resolve() or not provider_path.is_file():
        raise OperatorError("Image provider receipt вышел за разрешённый report scope")
    try:
        provider = json.loads(provider_path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise OperatorError("Image provider receipt невалиден") from None
    if (
        provider.get("login") != EXPECTED_LOGIN
        or exact_int(provider.get("campaignId"), "Image receipt CampaignId")
        != TARGET_CAMPAIGN_ID
        or provider.get("readbackVerified") is not True
        or provider.get("moderationCalled") is not False
        or provider.get("resumeCalled") is not False
        or provider.get("budgetChanged") is not False
        or provider.get("selectedHashes", {}).get("generic") != image_hash
    ):
        raise OperatorError("Image provider receipt identity/readback guard не совпал")
    uploads = provider.get("uploads")
    accepted = [
        row
        for row in uploads or []
        if isinstance(row, Mapping)
        and row.get("status") == "uploaded"
        and row.get("hash") == image_hash
    ]
    if len(accepted) != 1 or accepted[0].get("expected", {}).get("sha256") != item.get("sha256"):
        raise OperatorError("Image provider receipt SHA/hash proof не совпал")
    legacy_evidence = {
        "hash": image_hash,
        "source_url": item.get("sourceUrl"),
        "sha256": item.get("sha256"),
        "provider_receipt": provider_relative,
        "provider_receipt_sha256": _sha256_file(provider_path),
        "readback_verified": True,
        "upload_skipped_reuse": True,
    }
    per_creative = item.get("perCreative")
    if per_creative is None:
        return image_hash, legacy_evidence
    _validate_mutation_image_contract(payload)
    resolved = {
        key: evidence.get("hash")
        for key, evidence in per_creative.items()
        if isinstance(evidence, Mapping)
    }
    if set(resolved) != set(payload.get("creatives", {})) or any(
        not isinstance(value, str) or not value for value in resolved.values()
    ):
        raise OperatorError("Per-creative provider hash resolution не совпало")
    return resolved, {
        **legacy_evidence,
        "per_creative": {
            key: {
                "hash": resolved[key],
                "provider_receipt": per_creative[key].get("providerReceipt"),
                "provider_receipt_sha256": per_creative[key].get(
                    "providerReceiptSha256"
                ),
            }
            for key in resolved
        },
    }


def _normalise_sitelinks(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not value:
        raise OperatorError("Sitelink set пуст или имеет неверный тип")
    normalised: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, Mapping):
            raise OperatorError("Sitelink item имеет неверный тип")
        normalised.append(
            {
                "Title": item.get("Title"),
                "Href": item.get("Href"),
                "Description": item.get("Description"),
            }
        )
    return normalised


def plan_sitelink_reuse(
    existing_sets: Sequence[Mapping[str, Any]],
    desired_sets: Mapping[str, Any],
) -> dict[str, Any]:
    existing_by_signature: dict[str, int] = {}
    for row in existing_sets:
        item_id = exact_int(row.get("Id"), "Existing SitelinkSet Id")
        signature = sha256_json(_normalise_sitelinks(row.get("Sitelinks")))
        existing_by_signature.setdefault(signature, item_id)

    resolved: dict[str, int] = {}
    add_keys: list[str] = []
    alias_of: dict[str, str] = {}
    first_desired: dict[str, str] = {}
    for key, links in desired_sets.items():
        signature = sha256_json(_normalise_sitelinks(links))
        if signature in existing_by_signature:
            resolved[key] = existing_by_signature[signature]
        elif signature in first_desired:
            alias_of[key] = first_desired[signature]
        else:
            first_desired[signature] = key
            add_keys.append(key)
    return {
        "resolved_ids": resolved,
        "add_keys": add_keys,
        "alias_of": alias_of,
        "reused_count": len(resolved),
        "new_unique_count": len(add_keys),
    }


def build_sitelinks_add_request(
    payload: Mapping[str, Any], add_keys: Sequence[str]
) -> dict[str, Any]:
    if not add_keys:
        raise OperatorError("Sitelinks.add нельзя вызывать с пустым списком")
    desired = payload.get("sitelinkSets")
    if not isinstance(desired, Mapping) or any(key not in desired for key in add_keys):
        raise OperatorError("Sitelinks.add keys вышли за current plan")
    item = {
        "version": "v501",
        "service": "sitelinks",
        "method": "add",
        "params": {
            "SitelinksSets": [
                {"Sitelinks": copy.deepcopy(desired[key])} for key in add_keys
            ]
        },
    }
    assert_mutation_contract(
        item["version"], item["service"], item["method"], item["params"], "sitelinks_add"
    )
    return item


def resolve_sitelink_ids(
    reuse_plan: Mapping[str, Any], new_values: Sequence[int]
) -> dict[str, int]:
    add_keys = list(reuse_plan.get("add_keys", []))
    if len(add_keys) != len(new_values):
        raise OperatorError("Sitelink provider ID count не совпал с add plan")
    resolved = {
        key: exact_int(value, "Reused SitelinkSet Id")
        for key, value in dict(reuse_plan.get("resolved_ids", {})).items()
    }
    for key, value in zip(add_keys, new_values, strict=True):
        resolved[key] = exact_int(value, "New SitelinkSet Id")
    for key, source in dict(reuse_plan.get("alias_of", {})).items():
        if source not in resolved:
            raise OperatorError("Sitelink desired dedup alias не удалось разрешить")
        resolved[key] = resolved[source]
    if set(resolved) != {"generic", "extrimeUaz", "extrimeToyota", "hunter"}:
        raise OperatorError("Sitelink resolution не покрывает current plan")
    return resolved


def _replace_creative_tokens(
    creative: Mapping[str, Any],
    *,
    creative_key: str,
    image_hashes: Mapping[str, str],
    sitelink_ids: Mapping[str, int],
) -> dict[str, Any]:
    value = copy.deepcopy(dict(creative))
    image_items = value.get("AdImageHashes", {}).get("Items")
    if not isinstance(image_items, list) or len(image_items) != 1:
        raise OperatorError("Creative AdImageHashes placeholder некорректен")
    token = image_items[0]
    expected_hash = image_hashes.get(creative_key)
    if not isinstance(expected_hash, str) or not expected_hash:
        raise OperatorError(f"Creative {creative_key}: resolved image hash отсутствует")
    allowed_tokens = {
        expected_hash,
        f"{{{{AD_IMAGE_HASH:{creative_key}}}}}",
        BASELINE_GENERIC_IMAGE_HASH
        if creative_key in {"brand", "category"}
        else f"{{{{AD_IMAGE_HASH:{'extrime' if creative_key.startswith('extrime') else 'hunter'}}}}}",
    }
    if token not in allowed_tokens:
        raise OperatorError("Creative image placeholder неизвестен")
    value["AdImageHashes"] = {"Items": [expected_hash]}
    sitelink_token = value.get("SitelinkSetId")
    sitelink_map = {
        "{{SITELINK_SET_ID:generic}}": sitelink_ids["generic"],
        "{{SITELINK_SET_ID:extrimeUaz}}": sitelink_ids["extrimeUaz"],
        "{{SITELINK_SET_ID:extrimeToyota}}": sitelink_ids["extrimeToyota"],
        "{{SITELINK_SET_ID:hunter}}": sitelink_ids["hunter"],
    }
    if sitelink_token not in sitelink_map:
        raise OperatorError("Creative sitelink placeholder неизвестен")
    value["SitelinkSetId"] = sitelink_map[sitelink_token]
    _assert_domain_urls(value)
    return value


def _current_stage_params(
    payload: Mapping[str, Any], service: str, method: str
) -> dict[str, Any]:
    matches = [
        item.get("request", {}).get("params")
        for item in payload.get("stagedRequests", [])
        if item.get("service") == service
        and item.get("request", {}).get("method") == method
    ]
    if len(matches) != 1 or not isinstance(matches[0], Mapping):
        raise OperatorError(f"Current plan stage {service}.{method} не найден однозначно")
    return copy.deepcopy(dict(matches[0]))


def build_materialized_requests(
    payload: Mapping[str, Any],
    *,
    image_hash: str | Mapping[str, str],
    sitelink_ids: Mapping[str, int],
) -> dict[str, dict[str, Any]]:
    if isinstance(image_hash, str):
        if image_hash != BASELINE_GENERIC_IMAGE_HASH:
            raise OperatorError("Materialization image hash не подтверждён")
        resolved_hashes = {key: image_hash for key in payload["creatives"]}
    elif isinstance(image_hash, Mapping):
        resolved_hashes = dict(image_hash)
        if set(resolved_hashes) != set(payload["creatives"]):
            raise OperatorError("Materialization image hash scope не совпал")
        if resolved_hashes.get("brand") != BASELINE_GENERIC_IMAGE_HASH or resolved_hashes.get("category") != BASELINE_GENERIC_IMAGE_HASH:
            raise OperatorError("Brand/category generic image guard не совпал")
        for key, pinned in MODEL_IMAGE_PROVIDER_RECEIPTS.items():
            if resolved_hashes.get(key) != pinned["provider_hash"]:
                raise OperatorError(f"Materialization {key} provider hash drift")
    else:
        raise OperatorError("Materialization image hash contract не совпал")
    creatives = payload["creatives"]
    resolved = {
        key: _replace_creative_tokens(
            value,
            creative_key=key,
            image_hashes=resolved_hashes,
            sitelink_ids=sitelink_ids,
        )
        for key, value in creatives.items()
    }
    existing_mapping = {
        EXISTING_AD_IDS["brand"]: resolved["brand"],
        EXISTING_AD_IDS["category"]: resolved["category"],
        EXISTING_AD_IDS["extrime_uaz"]: resolved["extrimeUaz"],
        # Update exact ...8815 before parking it, so every existing ad has a
        # verified same-model sitelink/image preimage and no rounded ID.
        EXISTING_AD_IDS["parked_extrime_toyota"]: resolved["extrimeToyota"],
        EXISTING_AD_IDS["hunter"]: resolved["hunter"],
    }
    add_creative = copy.deepcopy(resolved["extrimeToyota"])
    add_creative["AdImageHashes"] = list(add_creative["AdImageHashes"]["Items"])

    requests = {
        "sitelinks_add": {
            **build_sitelinks_add_request(payload, list(payload["sitelinkSets"])),
        },
        "adgroups_update": {
            "version": "v501",
            "service": "adgroups",
            "method": "update",
            "params": _current_stage_params(payload, "adgroups", "update"),
        },
        "keywords_update": {
            "version": "v5",
            "service": "keywords",
            "method": "update",
            "params": {"Keywords": copy.deepcopy(payload["keywords"]["update"])},
        },
        "keywords_add": {
            "version": "v5",
            "service": "keywords",
            "method": "add",
            "params": {"Keywords": copy.deepcopy(payload["keywords"]["add"])},
        },
        "keywords_suspend": {
            "version": "v5",
            "service": "keywords",
            "method": "suspend",
            "params": {"SelectionCriteria": {"Ids": sorted(KEYWORD_SUSPEND_IDS)}},
        },
        "ads_update": {
            "version": "v501",
            "service": "ads",
            "method": "update",
            "params": {
                "Ads": [
                    {"Id": ad_id, "ResponsiveAd": creative}
                    for ad_id, creative in existing_mapping.items()
                ]
            },
        },
        "ads_add": {
            "version": "v501",
            "service": "ads",
            "method": "add",
            "params": {
                "Ads": [
                    {
                        "AdGroupId": GROUP_IDS["extrime_family"],
                        "ResponsiveAd": add_creative,
                    }
                ]
            },
        },
        "ads_suspend": {
            "version": "v501",
            "service": "ads",
            "method": "suspend",
            "params": {"SelectionCriteria": {"Ids": [PARKED_AD_ID]}},
        },
    }
    for kind, item in requests.items():
        assert_mutation_contract(
            item["version"], item["service"], item["method"], item["params"], kind
        )
    return requests


def _request_summary(requests: Mapping[str, Mapping[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "stage": index,
            "mutation_kind": kind,
            "version": item["version"],
            "service": item["service"],
            "method": item["method"],
        }
        for index, (kind, item) in enumerate(requests.items(), 1)
    ]


def _campaign_safety(api: Any, baseline_campaign: Mapping[str, Any]) -> dict[str, Any]:
    current = guard.read_campaign(api, guard.CANONICAL_API_VERSION)
    guard.validate_canonical_campaign(current, require_draft=False, allowed_states=("SUSPENDED",))
    if _content_cas_sha256(current) != _content_cas_sha256(baseline_campaign):
        raise OperatorError("Campaign CAS изменился во время creative stages")
    return {
        "state": current.get("State"),
        "status": current.get("Status"),
        "sha256": _content_cas_sha256(current),
    }


def _mutate_stage(
    api: Any,
    kind: str,
    item: Mapping[str, Any],
    *,
    baseline_campaign: Mapping[str, Any],
    protected_before: Mapping[str, Any],
) -> dict[str, Any]:
    before = _campaign_safety(api, baseline_campaign)
    result = api.call(
        item["version"],
        item["service"],
        item["method"],
        item["params"],
        use_client_login=True,
        mutation_kind=kind,
    )
    after = _campaign_safety(api, baseline_campaign)
    protected_after = guard.read_protected_snapshot(api)
    guard.assert_protected_equal(protected_before, protected_after)
    return {"result": result, "campaign_before": before, "campaign_after": after}


def _creative_expected(value: Mapping[str, Any]) -> dict[str, Any]:
    hashes = value.get("AdImageHashes", {}).get("Items")
    return {
        "titles": list(value.get("Titles", [])),
        "texts": list(value.get("Texts", [])),
        "href": value.get("Href"),
        "display": value.get("DisplayUrlPath"),
        "sitelink": value.get("SitelinkSetId"),
        "images": list(hashes or []),
    }


def verify_post_readback(
    snapshot: Mapping[str, Any],
    payload: Mapping[str, Any],
    requests: Mapping[str, Mapping[str, Any]],
    *,
    new_keyword_ids: Sequence[int],
    new_ad_id: int,
    sitelink_ids: Mapping[str, int],
) -> dict[str, Any]:
    raw = snapshot["raw"]
    campaign = raw["campaign"]
    if campaign.get("State") != "SUSPENDED":
        raise OperatorError("Post-readback campaign is not SUSPENDED")

    groups = {exact_int(item.get("Id"), "AdGroup Id"): item for item in raw["adgroups"]}
    desired_groups = requests["adgroups_update"]["params"]["AdGroups"]
    if set(groups) != set(GROUP_IDS.values()):
        raise OperatorError("Post-readback group ID set drift")
    for desired in desired_groups:
        actual = groups[desired["Id"]]
        if actual.get("Name") != desired.get("Name"):
            raise OperatorError(f"Post-readback group name mismatch {desired['Id']}")
        if _normalise_negative_items(
            actual.get("NegativeKeywords", {}).get("Items")
        ) != _normalise_negative_items(desired["NegativeKeywords"]["Items"]):
            raise OperatorError(f"Post-readback negatives mismatch {desired['Id']}")

    ads = {exact_int(item.get("Id"), "Ad Id"): item for item in raw["ads"]}
    if set(ads) != set(EXISTING_AD_IDS.values()) | {new_ad_id}:
        raise OperatorError("Post-readback ad ID set is not exact baseline+one")
    desired_ads = {
        item["Id"]: item["ResponsiveAd"]
        for item in requests["ads_update"]["params"]["Ads"]
    }
    for ad_id, desired in desired_ads.items():
        if _responsive_values(ads[ad_id]) != _creative_expected(desired):
            raise OperatorError(f"Post-readback creative mismatch {ad_id}")
    add_desired = copy.deepcopy(requests["ads_add"]["params"]["Ads"][0]["ResponsiveAd"])
    add_desired["AdImageHashes"] = {"Items": add_desired["AdImageHashes"]}
    if ads[new_ad_id].get("AdGroupId") != GROUP_IDS["extrime_family"] or _responsive_values(ads[new_ad_id]) != _creative_expected(add_desired):
        raise OperatorError("Post-readback new Extrime Toyota ad mismatch")
    if ads[PARKED_AD_ID].get("State") != "SUSPENDED":
        raise OperatorError("Parked existing ad is not SUSPENDED")
    parked_group_ads = [
        item
        for item in ads.values()
        if item.get("AdGroupId") == GROUP_IDS["parked_extrime_toyota"]
    ]
    if (
        len(parked_group_ads) != 1
        or parked_group_ads[0].get("Id") != PARKED_AD_ID
        or parked_group_ads[0].get("State") != "SUSPENDED"
    ):
        raise OperatorError(
            "Parked group can retain autotargeting only with exact sole suspended ad"
        )
    active_ad_ids = [
        item_id for item_id, item in ads.items() if item.get("State") != "SUSPENDED"
    ]
    if len(active_ad_ids) != 5:
        raise OperatorError("Post-readback требует ровно 6 ads total / 5 non-suspended")

    keywords = {exact_int(item.get("Id"), "Keyword Id"): item for item in raw["keywords"]}
    expected_keyword_ids = BASELINE_KEYWORD_IDS | set(new_keyword_ids)
    if set(keywords) != expected_keyword_ids:
        raise OperatorError("Post-readback keyword ID set is not exact baseline+five")
    for desired in requests["keywords_update"]["params"]["Keywords"]:
        if keywords[desired["Id"]].get("Keyword") != desired["Keyword"]:
            raise OperatorError(f"Post-readback keyword mismatch {desired['Id']}")
    add_rows = requests["keywords_add"]["params"]["Keywords"]
    actual_added = sorted(
        (keywords[item_id].get("AdGroupId"), keywords[item_id].get("Keyword"))
        for item_id in new_keyword_ids
    )
    desired_added = sorted((item["AdGroupId"], item["Keyword"]) for item in add_rows)
    if actual_added != desired_added:
        raise OperatorError("Post-readback added keyword content mismatch")
    if any(keywords[item_id].get("State") != "ON" for item_id in new_keyword_ids):
        raise OperatorError("Post-readback added keyword is not ON")
    for item_id in KEYWORD_SUSPEND_IDS:
        if keywords[item_id].get("State") != "SUSPENDED":
            raise OperatorError(f"Post-readback keyword not suspended {item_id}")
    parked_auto = keywords[PARKED_AUTOTARGET_ID]
    if (
        parked_auto.get("AdGroupId") != GROUP_IDS["parked_extrime_toyota"]
        or parked_auto.get("Keyword") != "---autotargeting"
        or parked_auto.get("State") != "ON"
    ):
        raise OperatorError("Parked autotargeting post-readback must remain exact ON")

    sitelinks = {exact_int(item.get("Id"), "Sitelink Id"): item for item in raw["sitelinks"]}
    if set(sitelinks) != set(sitelink_ids.values()):
        raise OperatorError("Post-readback sitelink IDs do not equal four new sets")
    desired_sets = list(payload["sitelinkSets"].values())
    for index, key in enumerate(payload["sitelinkSets"]):
        actual = sitelinks[sitelink_ids[key]].get("Sitelinks")
        if _normalise_sitelinks(actual) != _normalise_sitelinks(desired_sets[index]):
            raise OperatorError(f"Post-readback sitelink content mismatch {key}")
    return {
        "campaign_state": "SUSPENDED",
        "group_count": len(groups),
        "ad_count_total": len(ads),
        "ad_count_non_suspended": len(active_ad_ids),
        "moderation_called": False,
        "keyword_count": len(keywords),
        "sitelink_count": len(sitelinks),
        "new_ad_id": new_ad_id,
        "new_keyword_ids": list(new_keyword_ids),
        "parked_autotarget_safety": {
            "id": PARKED_AUTOTARGET_ID,
            "state": "ON",
            "sole_ad_id": PARKED_AD_ID,
            "sole_ad_state": "SUSPENDED",
            "non_suspended_ads_in_group": 0,
        },
    }


ROLLBACK_SAFETY_PLAN = [
    "Никогда не вызывать Campaigns.resume, Ads.moderate или изменение бюджета/целей.",
    "При любой частичной стадии оставить campaign 713802902 в SUSPENDED.",
    "Сохранить exact preimage CAS SHA-256, provider request log и все возвращённые IDs.",
    "Перед восстановлением выполнить новый read-only snapshot и классифицировать каждую строку как baseline/candidate/unknown.",
    "Восстанавливать только candidate-строки по exact preimage; unknown не менять и передать на ручную инспекцию.",
    "Новые ad/keywords/sitelinks/images удалять только после доказанного отвязывания и отдельного mutation unlock.",
]


def _base_receipt(
    mode: str, payload_metadata: Mapping[str, Any] | None = None
) -> dict[str, Any]:
    receipt = {
        "schema": 1,
        "operator": "yandex-direct-creative-713802902-v1",
        "generated_at": utc_now(),
        "mode": mode,
        "status": "in_progress",
        "scope": {
            "login": EXPECTED_LOGIN,
            "campaign_id": TARGET_CAMPAIGN_ID,
            "domain": EXPECTED_DOMAIN,
            "protected_campaign_ids": list(PROTECTED_CAMPAIGN_IDS),
            "campaign_mutation_allowed": False,
            "moderate_allowed": False,
            "resume_allowed": False,
            "budget_or_goal_change_allowed": False,
        },
        "rollback_safety_plan": list(ROLLBACK_SAFETY_PLAN),
    }
    if payload_metadata is not None:
        receipt["payload"] = dict(payload_metadata)
    return receipt


def run_dry_run(
    api: Any,
    payload: Mapping[str, Any],
    *,
    payload_metadata: Mapping[str, Any] | None = None,
    lock_policy: MutationLockPolicy | None = None,
) -> dict[str, Any]:
    receipt = _base_receipt("dry-run", payload_metadata)
    mutations_before = int(getattr(api, "mutation_requests", 0))
    public_preflight = public_http_preflight(payload)
    identity = guard.prove_identity(api)
    protected = guard.read_protected_snapshot(api)
    snapshot = read_target_snapshot(api)
    classification = classify_target_state(snapshot, payload)
    image_hash, image_evidence = validate_reused_image(payload)
    sitelink_reuse = plan_sitelink_reuse(
        snapshot["raw"]["all_sitelinks"], payload["sitelinkSets"]
    )
    dry_sitelink_ids = resolve_sitelink_ids(
        sitelink_reuse,
        [9_900_000_001 + index for index in range(len(sitelink_reuse["add_keys"]))],
    )
    # Synthetic provider IDs validate the entire materialized contract without
    # making any write request.  No synthetic data is sent to Direct or CRM.
    requests = build_materialized_requests(
        payload,
        image_hash=image_hash,
        sitelink_ids=dry_sitelink_ids,
    )
    if sitelink_reuse["add_keys"]:
        requests["sitelinks_add"] = build_sitelinks_add_request(
            payload, sitelink_reuse["add_keys"]
        )
    else:
        requests.pop("sitelinks_add")
    if int(getattr(api, "mutation_requests", 0)) != mutations_before:
        raise OperatorError("Dry-run выполнил mutation request")
    lock_state = (lock_policy or MutationLockPolicy()).inspect()
    is_recovery = classification["classification"].startswith("partial_")
    if is_recovery:
        remaining = set(classification["remaining_stages"])
        requests = {key: value for key, value in requests.items() if key in remaining}
    base_status = "ready_recovery" if is_recovery else "ready"
    receipt.update(
        status=base_status if lock_state["available"] else "blocked_by_lock",
        account=identity,
        protected={key: value for key, value in protected.items() if key != "campaigns"},
        target={
            "cas_sha256": snapshot["sha256"],
            "state": snapshot["raw"]["campaign"].get("State"),
            "counts": snapshot["counts"],
            "classification": classification,
        },
        public_http_preflight=public_preflight,
        image_evidence=image_evidence,
        sitelink_reuse=sitelink_reuse,
        planned_requests=_request_summary(requests),
        exact_existing_ad_ids=sorted(EXISTING_AD_IDS.values()),
        new_ads_planned=1,
        expected_post_counts={
            "adgroups": 5,
            "ads_total": 6,
            "ads_non_suspended": 5,
            "keywords": 31,
            "sitelinks_unique": len(set(dry_sitelink_ids.values())),
        },
        moderation_called=False,
        global_lock=lock_state,
        mutation_requests=0,
        ready_for_apply=lock_state["available"] and not is_recovery,
        ready_for_recovery=lock_state["available"] and is_recovery,
    )
    return receipt


def run_apply(
    api: Any,
    payload: Mapping[str, Any],
    *,
    expected_cas_sha256: str,
    expected_plan_sha256: str,
    environ: Mapping[str, str],
    payload_metadata: Mapping[str, Any] | None = None,
    lock_policy: MutationLockPolicy | None = None,
) -> dict[str, Any]:
    verify_apply_unlock(environ)
    _validate_mutation_image_contract(payload)
    actual_plan_sha256 = (payload_metadata or {}).get("plan_sha256")
    assert_exact_cas(str(actual_plan_sha256 or ""), expected_plan_sha256)
    receipt = _base_receipt("apply", payload_metadata)
    receipt["public_http_preflight"] = public_http_preflight(payload)
    policy = lock_policy or MutationLockPolicy()
    stage_receipts: list[dict[str, Any]] = []
    protected_before: dict[str, Any] | None = None
    baseline: dict[str, Any] | None = None
    with policy.hold() as lock_evidence:
        receipt["global_lock"] = lock_evidence
        try:
            identity = guard.prove_identity(api)
            protected_before = guard.read_protected_snapshot(api)
            baseline = read_target_snapshot(api)
            validate_baseline(baseline)
            assert_exact_cas(baseline["sha256"], expected_cas_sha256)
            baseline_campaign = baseline["raw"]["campaign"]
            image_hash, image_evidence = validate_reused_image(payload)
            sitelink_reuse = plan_sitelink_reuse(
                baseline["raw"]["all_sitelinks"], payload["sitelinkSets"]
            )
            receipt.update(
                account=identity,
                preimage_cas_sha256=baseline["sha256"],
                protected_before={key: value for key, value in protected_before.items() if key != "campaigns"},
                image_evidence=image_evidence,
                sitelink_reuse=sitelink_reuse,
            )

            add_keys = list(sitelink_reuse["add_keys"])
            if add_keys:
                sitelinks_request = build_sitelinks_add_request(payload, add_keys)
                stage = _mutate_stage(
                    api,
                    "sitelinks_add",
                    sitelinks_request,
                    baseline_campaign=baseline_campaign,
                    protected_before=protected_before,
                )
                sitelink_values = strict_action_rows(
                    stage["result"],
                    "AddResults",
                    expected_count=len(add_keys),
                    id_field="Id",
                )
                stage_receipts.append(
                    {
                        "stage": 1,
                        "kind": "sitelinks_add",
                        "added_keys": add_keys,
                        "provider_ids": sitelink_values,
                    }
                )
            else:
                sitelink_values = []
                stage_receipts.append(
                    {"stage": 1, "kind": "sitelinks_reuse", "added_keys": []}
                )
            sitelink_ids = resolve_sitelink_ids(sitelink_reuse, sitelink_values)
            stage_receipts[-1]["resolved_ids"] = sitelink_ids

            requests = build_materialized_requests(
                payload,
                image_hash=image_hash,
                sitelink_ids=sitelink_ids,
            )
            fixed_stages = [
                ("adgroups_update", "UpdateResults", sorted(GROUP_IDS.values())),
                ("keywords_update", "UpdateResults", sorted(KEYWORD_UPDATE_IDS)),
                ("keywords_add", "AddResults", None),
                ("keywords_suspend", "SuspendResults", sorted(KEYWORD_SUSPEND_IDS)),
                ("ads_update", "UpdateResults", sorted(EXISTING_AD_IDS.values())),
                ("ads_add", "AddResults", None),
                ("ads_suspend", "SuspendResults", [PARKED_AD_ID]),
            ]
            new_keyword_ids: list[int] = []
            new_ad_id: int | None = None
            for offset, (kind, result_key, expected_ids) in enumerate(fixed_stages, 2):
                stage = _mutate_stage(
                    api,
                    kind,
                    requests[kind],
                    baseline_campaign=baseline_campaign,
                    protected_before=protected_before,
                )
                if kind == "keywords_add":
                    values = strict_action_rows(
                        stage["result"],
                        result_key,
                        expected_count=KEYWORD_ADD_COUNT,
                        id_field="Id",
                    )
                    new_keyword_ids = [exact_int(item, "New Keyword Id") for item in values]
                    detail = {"new_keyword_ids": new_keyword_ids}
                elif kind == "ads_add":
                    values = strict_action_rows(
                        stage["result"], result_key, expected_count=1, id_field="Id"
                    )
                    new_ad_id = exact_int(values[0], "New Ad Id")
                    detail = {"new_ad_id": new_ad_id}
                else:
                    values = strict_action_rows(
                        stage["result"],
                        result_key,
                        expected_count=len(expected_ids or []),
                        id_field="Id",
                        expected_ids=expected_ids,
                    )
                    detail = {"verified_ids": values}
                stage_receipts.append({"stage": offset, "kind": kind, **detail})

            if new_ad_id is None or len(new_keyword_ids) != KEYWORD_ADD_COUNT:
                raise OperatorError("Provider IDs не были полностью разрешены")
            post = read_target_snapshot(api, require_baseline_ads=False)
            if _content_cas_sha256(post["raw"]["campaign"]) != _content_cas_sha256(baseline_campaign):
                raise OperatorError("Campaign changed despite creative-only scope")
            readback = verify_post_readback(
                post,
                payload,
                requests,
                new_keyword_ids=new_keyword_ids,
                new_ad_id=new_ad_id,
                sitelink_ids=sitelink_ids,
            )
            protected_after = guard.read_protected_snapshot(api)
            guard.assert_protected_equal(protected_before, protected_after)
            receipt.update(
                status="applied_verified_suspended",
                stage_receipts=stage_receipts,
                postimage_cas_sha256=post["sha256"],
                readback=readback,
                protected_unchanged=True,
                final_campaign_state="SUSPENDED",
                mutation_requests=int(getattr(api, "mutation_requests", 0)),
            )
        except Exception as exc:
            receipt.update(
                status="manual_inspection_required_suspended",
                error=safe_text(exc),
                stage_receipts=stage_receipts,
                mutation_requests=int(getattr(api, "mutation_requests", 0)),
            )
            if isinstance(exc, OperatorError) and exc.partial:
                receipt.update(exc.partial)
            try:
                if baseline is not None:
                    safety = _campaign_safety(api, baseline["raw"]["campaign"])
                    receipt["final_campaign_state"] = safety["state"]
                    receipt["campaign_unchanged"] = True
            except Exception as safety_exc:
                receipt["campaign_safety_error"] = safe_text(safety_exc)
            try:
                if protected_before is not None:
                    protected_after = guard.read_protected_snapshot(api)
                    guard.assert_protected_equal(protected_before, protected_after)
                    receipt["protected_unchanged"] = True
            except Exception as protected_exc:
                receipt["protected_unchanged"] = False
                receipt["protected_error"] = safe_text(protected_exc)
    return receipt


def run_corrective_dry_run(
    api: Any,
    payload: Mapping[str, Any],
    *,
    payload_metadata: Mapping[str, Any] | None = None,
    lock_policy: MutationLockPolicy | None = None,
) -> dict[str, Any]:
    receipt = _base_receipt("corrective-dry-run", payload_metadata)
    mutations_before = int(getattr(api, "mutation_requests", 0))
    public_preflight = public_http_preflight(payload)
    identity = guard.prove_identity(api)
    protected = guard.read_protected_snapshot(api)
    snapshot = read_target_snapshot(api)
    image_hashes, image_evidence = validate_reused_image(payload)
    requests = build_corrective_requests(payload, image_hashes)
    try:
        target = validate_corrective_target(snapshot, payload, image_hashes)
        classification = target
        status = "corrective_already_applied_noop"
        planned: dict[str, Mapping[str, Any]] = {}
    except OperatorError:
        classification = validate_corrective_preimage(snapshot, payload)
        status = "ready_corrective"
        planned = requests
    if int(getattr(api, "mutation_requests", 0)) != mutations_before:
        raise OperatorError("Corrective dry-run выполнил mutation request")
    lock_state = (lock_policy or MutationLockPolicy()).inspect()
    if not lock_state["available"] and status == "ready_corrective":
        status = "blocked_by_lock"
    receipt.update(
        status=status,
        account=identity,
        protected={key: value for key, value in protected.items() if key != "campaigns"},
        target={
            "cas_sha256": snapshot["sha256"],
            "state": snapshot["raw"]["campaign"].get("State"),
            "counts": snapshot["counts"],
            "classification": classification,
        },
        public_http_preflight=public_preflight,
        image_evidence=image_evidence,
        planned_requests=_request_summary(planned),
        forbidden_mutations=[
            "sitelinks.add",
            "keywords.add",
            "ads.add",
            "ads.suspend",
            "Ads.moderate",
            "Campaigns.resume",
            "campaign/budget/goal changes",
        ],
        global_lock=lock_state,
        mutation_requests=0,
        ready_for_corrective_apply=status == "ready_corrective",
        idempotent_noop=status == "corrective_already_applied_noop",
    )
    return receipt


def run_corrective_apply(
    api: Any,
    payload: Mapping[str, Any],
    *,
    expected_cas_sha256: str,
    expected_plan_sha256: str,
    environ: Mapping[str, str],
    payload_metadata: Mapping[str, Any] | None = None,
    lock_policy: MutationLockPolicy | None = None,
) -> dict[str, Any]:
    verify_corrective_unlock(environ)
    _validate_mutation_image_contract(payload)
    actual_plan_sha256 = (payload_metadata or {}).get("plan_sha256")
    assert_exact_cas(str(actual_plan_sha256 or ""), expected_plan_sha256)
    receipt = _base_receipt("corrective-apply", payload_metadata)
    receipt["public_http_preflight"] = public_http_preflight(payload)
    allowed_kinds = frozenset(
        {
            "corrective_adgroups_update",
            "corrective_keywords_update",
            "corrective_ads_update",
        }
    )
    setattr(api, "mutation_allowlist_override", allowed_kinds)
    policy = lock_policy or MutationLockPolicy()
    stage_receipts: list[dict[str, Any]] = []
    protected_before: dict[str, Any] | None = None
    preimage: dict[str, Any] | None = None
    with policy.hold() as lock_evidence:
        receipt["global_lock"] = lock_evidence
        try:
            identity = guard.prove_identity(api)
            protected_before = guard.read_protected_snapshot(api)
            preimage = read_target_snapshot(api)
            assert_exact_cas(preimage["sha256"], expected_cas_sha256)
            image_hashes, image_evidence = validate_reused_image(payload)
            requests = build_corrective_requests(payload, image_hashes)
            receipt.update(
                account=identity,
                preimage_cas_sha256=preimage["sha256"],
                protected_before={
                    key: value
                    for key, value in protected_before.items()
                    if key != "campaigns"
                },
                image_evidence=image_evidence,
                exact_requests=_request_summary(requests),
            )
            try:
                target = validate_corrective_target(preimage, payload, image_hashes)
            except OperatorError:
                target = None
            if target is not None:
                protected_after = guard.read_protected_snapshot(api)
                guard.assert_protected_equal(protected_before, protected_after)
                receipt.update(
                    status="corrective_already_applied_noop",
                    classification=target,
                    stage_receipts=[],
                    postimage_cas_sha256=preimage["sha256"],
                    protected_unchanged=True,
                    final_campaign_state="SUSPENDED",
                    mutation_requests=0,
                    idempotent_noop=True,
                )
                return receipt
            classification = validate_corrective_preimage(preimage, payload)
            baseline_campaign = preimage["raw"]["campaign"]
            contracts = (
                (
                    "corrective_adgroups_update",
                    "UpdateResults",
                    sorted(GROUP_IDS.values()),
                ),
                (
                    "corrective_keywords_update",
                    "UpdateResults",
                    sorted(KEYWORD_UPDATE_IDS),
                ),
                (
                    "corrective_ads_update",
                    "UpdateResults",
                    sorted(set(EXISTING_AD_IDS.values()) | {CORRECTIVE_PREIMAGE_NEW_AD_ID}),
                ),
            )
            for index, (kind, result_key, expected_ids) in enumerate(contracts, 1):
                stage = _mutate_stage(
                    api,
                    kind,
                    requests[kind],
                    baseline_campaign=baseline_campaign,
                    protected_before=protected_before,
                )
                values = strict_action_rows(
                    stage["result"],
                    result_key,
                    expected_count=len(expected_ids),
                    id_field="Id",
                    expected_ids=expected_ids,
                )
                stage_receipts.append(
                    {"stage": index, "kind": kind, "verified_ids": values}
                )
            post = read_target_snapshot(api, require_baseline_ads=False)
            if _content_cas_sha256(post["raw"]["campaign"]) != _content_cas_sha256(
                baseline_campaign
            ):
                raise OperatorError("Campaign changed during corrective apply")
            readback = validate_corrective_target(post, payload, image_hashes)
            protected_after = guard.read_protected_snapshot(api)
            guard.assert_protected_equal(protected_before, protected_after)
            receipt.update(
                status="corrective_applied_verified_suspended",
                classification=classification,
                stage_receipts=stage_receipts,
                postimage_cas_sha256=post["sha256"],
                readback=readback,
                protected_unchanged=True,
                final_campaign_state="SUSPENDED",
                mutation_requests=int(getattr(api, "mutation_requests", 0)),
                idempotent_noop=False,
            )
        except Exception as exc:
            receipt.update(
                status="manual_inspection_required_suspended",
                error=safe_text(exc),
                stage_receipts=stage_receipts,
                mutation_requests=int(getattr(api, "mutation_requests", 0)),
            )
            try:
                if preimage is not None:
                    safety = _campaign_safety(api, preimage["raw"]["campaign"])
                    receipt["final_campaign_state"] = safety["state"]
                    receipt["campaign_unchanged"] = True
            except Exception as safety_exc:
                receipt["campaign_safety_error"] = safe_text(safety_exc)
            try:
                if protected_before is not None:
                    protected_after = guard.read_protected_snapshot(api)
                    guard.assert_protected_equal(protected_before, protected_after)
                    receipt["protected_unchanged"] = True
            except Exception as protected_exc:
                receipt["protected_unchanged"] = False
                receipt["protected_error"] = safe_text(protected_exc)
    return receipt


def run_partial_recovery(
    api: Any,
    payload: Mapping[str, Any],
    *,
    expected_cas_sha256: str,
    expected_plan_sha256: str,
    environ: Mapping[str, str],
    payload_metadata: Mapping[str, Any] | None = None,
    lock_policy: MutationLockPolicy | None = None,
) -> dict[str, Any]:
    """Continue only the v501 ad stages left after provider errors 8305/3500."""
    verify_recovery_unlock(environ)
    _validate_mutation_image_contract(payload)
    recovery_kinds = frozenset({"ads_update", "ads_add", "ads_suspend"})
    # Defense in depth: even an accidental future call to a completed stage is
    # rejected inside CreativeDirectApi before any HTTP request is constructed.
    setattr(api, "mutation_allowlist_override", recovery_kinds)
    actual_plan_sha256 = (payload_metadata or {}).get("plan_sha256")
    assert_exact_cas(str(actual_plan_sha256 or ""), expected_plan_sha256)
    receipt = _base_receipt("recover-partial", payload_metadata)
    receipt["public_http_preflight"] = public_http_preflight(payload)
    policy = lock_policy or MutationLockPolicy()
    stage_receipts: list[dict[str, Any]] = []
    protected_before: dict[str, Any] | None = None
    partial_snapshot: dict[str, Any] | None = None
    with policy.hold() as lock_evidence:
        receipt["global_lock"] = lock_evidence
        try:
            identity = guard.prove_identity(api)
            protected_before = guard.read_protected_snapshot(api)
            partial_snapshot = read_target_snapshot(api)
            classification = validate_partial_state(
                partial_snapshot,
                payload,
                after_autotarget_error=True,
                after_epk_v5_error=True,
            )
            if (
                classification.get("classification")
                != "partial_after_epk_ads_v5_error_3500"
                or classification.get("remaining_explicit_suspend_ids") != []
                or classification.get("remaining_stages")
                != ["ads_update", "ads_add", "ads_suspend"]
                or classification.get("ads_post_error_exact_preimage_unchanged")
                is not True
            ):
                raise OperatorError("Recovery-v3 requires exact post-3500 state")
            recovery_cas = (
                partial_snapshot.get("legacy_raw_sha256") or partial_snapshot["sha256"]
                if expected_cas_sha256 == THIRD_PARTIAL_PREIMAGE_CAS_SHA256
                else partial_snapshot["sha256"]
            )
            assert_exact_cas(str(recovery_cas or ""), expected_cas_sha256)
            baseline_campaign = partial_snapshot["raw"]["campaign"]
            image_hash, image_evidence = validate_reused_image(payload)
            sitelink_ids = classification["sitelink_ids"]
            if sitelink_ids != PARTIAL_SITELINK_IDS:
                raise OperatorError("Recovery sitelink resolution drift")
            requests = build_materialized_requests(
                payload,
                image_hash=image_hash,
                sitelink_ids=sitelink_ids,
            )
            allowed_remaining = (
                "ads_update",
                "ads_add",
                "ads_suspend",
            )
            if set(allowed_remaining) - set(requests):
                raise OperatorError("Recovery remaining request set incomplete")
            if set(allowed_remaining) != set(recovery_kinds):
                raise OperatorError("Recovery API allowlist drift")
            if any(requests[key].get("version") != "v501" for key in allowed_remaining):
                raise OperatorError("Recovery-v3 permits only v501 EPK ad mutations")
            receipt.update(
                account=identity,
                preimage_cas_sha256=recovery_cas,
                canonical_content_cas_sha256=partial_snapshot["sha256"],
                partial_classification=classification,
                protected_before={
                    key: value
                    for key, value in protected_before.items()
                    if key != "campaigns"
                },
                image_evidence=image_evidence,
                exact_remaining_requests=_request_summary(
                    {key: requests[key] for key in allowed_remaining}
                ),
                forbidden_replay_stages=[
                    "sitelinks_add",
                    "adgroups_update",
                    "keywords_update",
                    "keywords_add",
                    "keywords_suspend",
                ],
            )

            new_ad_id: int | None = None
            stage_contracts = [
                ("ads_update", "UpdateResults", sorted(EXISTING_AD_IDS.values())),
                ("ads_add", "AddResults", None),
                ("ads_suspend", "SuspendResults", [PARKED_AD_ID]),
            ]
            for index, (kind, result_key, expected_ids) in enumerate(
                stage_contracts, 1
            ):
                stage = _mutate_stage(
                    api,
                    kind,
                    requests[kind],
                    baseline_campaign=baseline_campaign,
                    protected_before=protected_before,
                )
                if kind == "ads_add":
                    values = strict_action_rows(
                        stage["result"],
                        result_key,
                        expected_count=1,
                        id_field="Id",
                    )
                    new_ad_id = exact_int(values[0], "Recovery new Ad Id")
                    detail = {"new_ad_id": new_ad_id}
                else:
                    values = strict_action_rows(
                        stage["result"],
                        result_key,
                        expected_count=len(expected_ids or []),
                        id_field="Id",
                        expected_ids=expected_ids,
                    )
                    detail = {"verified_ids": values}
                stage_receipts.append(
                    {"stage": index, "kind": kind, **detail}
                )

            if new_ad_id is None:
                raise OperatorError("Recovery provider did not resolve new ad ID")
            post = read_target_snapshot(api, require_baseline_ads=False)
            if _content_cas_sha256(post["raw"]["campaign"]) != _content_cas_sha256(
                baseline_campaign
            ):
                raise OperatorError("Campaign changed during partial recovery")
            readback = verify_post_readback(
                post,
                payload,
                requests,
                new_keyword_ids=list(PARTIAL_NEW_KEYWORDS),
                new_ad_id=new_ad_id,
                sitelink_ids=sitelink_ids,
            )
            protected_after = guard.read_protected_snapshot(api)
            guard.assert_protected_equal(protected_before, protected_after)
            receipt.update(
                status="recovered_verified_suspended",
                stage_receipts=stage_receipts,
                postimage_cas_sha256=post["sha256"],
                readback=readback,
                protected_unchanged=True,
                final_campaign_state="SUSPENDED",
                mutation_requests=int(getattr(api, "mutation_requests", 0)),
            )
        except Exception as exc:
            receipt.update(
                status="manual_inspection_required_suspended",
                error=safe_text(exc),
                stage_receipts=stage_receipts,
                mutation_requests=int(getattr(api, "mutation_requests", 0)),
            )
            if isinstance(exc, OperatorError) and exc.partial:
                receipt.update(exc.partial)
            try:
                if partial_snapshot is not None:
                    safety = _campaign_safety(
                        api, partial_snapshot["raw"]["campaign"]
                    )
                    receipt["final_campaign_state"] = safety["state"]
                    receipt["campaign_unchanged"] = True
            except Exception as safety_exc:
                receipt["campaign_safety_error"] = safe_text(safety_exc)
            try:
                if protected_before is not None:
                    protected_after = guard.read_protected_snapshot(api)
                    guard.assert_protected_equal(protected_before, protected_after)
                    receipt["protected_unchanged"] = True
            except Exception as protected_exc:
                receipt["protected_unchanged"] = False
                receipt["protected_error"] = safe_text(protected_exc)
    return receipt


def _receipt_path(receipt: Mapping[str, Any]) -> Path:
    stamp = str(receipt.get("generated_at", utc_now())).replace(":", "-").replace(".", "-")
    mode = re.sub(r"[^a-z-]", "", str(receipt.get("mode", "unknown"))) or "unknown"
    return REPORT_ROOT / f"ROSOMAHA_RUS_DIRECT_CREATIVE_{mode}_713802902_{stamp}.json"


def save_receipt(receipt: Mapping[str, Any], *, token: str = "") -> Path:
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(receipt, ensure_ascii=False, indent=2)
    if token:
        raw = raw.replace(token, "[REDACTED]")
    raw = re.sub(r"(?i)Bearer\s+[^\s\"',}]+", "Bearer [REDACTED]", raw)
    if len(raw.encode("utf-8")) > 2_000_000:
        raise OperatorError("Receipt превысил безопасный размер")
    path = _receipt_path(receipt)
    path.write_text(raw + "\n", encoding="utf-8")
    return path


def receipt_is_safe(receipt: Mapping[str, Any]) -> bool:
    mode = receipt.get("mode")
    if mode == "image-upload-one-dry-run":
        return (
            receipt.get("status") == "ready"
            and receipt.get("selected_key") in MODEL_IMAGE_SOURCES
            and receipt.get("mutation_requests") == 0
            and receipt.get("target", {}).get("state") == "SUSPENDED"
            and receipt.get("image_plan", {}).get("selected_keys")
            == [receipt.get("selected_key")]
            and receipt.get("image_plan", {}).get("upload_count") == 1
        )
    if mode == "image-upload-one-apply":
        return (
            receipt.get("status") == "uploaded_one_verified_suspended"
            and receipt.get("selected_key") in MODEL_IMAGE_SOURCES
            and receipt.get("target", {}).get("state") == "SUSPENDED"
            and receipt.get("mutation_requests") == 1
            and isinstance(receipt.get("provider_hash"), str)
            and receipt.get("protected_unchanged") is True
            and receipt.get("creative_apply_authorized") is False
        )
    if mode == "image-upload-dry-run":
        return (
            receipt.get("status") == "ready"
            and receipt.get("mutation_requests") == 0
            and receipt.get("target", {}).get("campaign_id") == TARGET_CAMPAIGN_ID
            and receipt.get("target", {}).get("state") == "SUSPENDED"
            and bool(receipt.get("target", {}).get("cas_sha256"))
            and receipt.get("image_plan", {}).get("upload_count") == 3
            and bool(receipt.get("image_plan", {}).get("plan_sha256"))
        )
    if mode == "image-upload-apply":
        return (
            receipt.get("status") == "uploaded_verified_suspended"
            and receipt.get("target", {}).get("state") == "SUSPENDED"
            and receipt.get("mutation_requests") == 1
            and receipt.get("protected_unchanged") is True
            and set(receipt.get("provider_hashes", {})) == set(MODEL_IMAGE_SOURCES)
            and receipt.get("creative_apply_authorized") is False
        )
    if mode == "dry-run":
        return (
            receipt.get("status")
            in {"ready", "ready_recovery", "blocked_by_lock"}
            and receipt.get("mutation_requests") == 0
            and receipt.get("target", {}).get("cas_sha256")
            and receipt.get("target", {}).get("state") == "SUSPENDED"
            and receipt.get("payload", {}).get("plan_sha256")
            and receipt.get("public_http_preflight", {}).get("all_http_200") is True
            and receipt.get("scope", {}).get("campaign_id") == TARGET_CAMPAIGN_ID
        )
    if mode == "apply":
        return (
            receipt.get("status") == "applied_verified_suspended"
            and receipt.get("final_campaign_state") == "SUSPENDED"
            and receipt.get("protected_unchanged") is True
        )
    if mode == "recover-partial":
        return (
            receipt.get("status") == "recovered_verified_suspended"
            and receipt.get("final_campaign_state") == "SUSPENDED"
            and receipt.get("protected_unchanged") is True
            and receipt.get("mutation_requests") == 3
        )
    if mode == "corrective-dry-run":
        return (
            receipt.get("status")
            in {"ready_corrective", "corrective_already_applied_noop", "blocked_by_lock"}
            and receipt.get("mutation_requests") == 0
            and receipt.get("target", {}).get("state") == "SUSPENDED"
            and bool(receipt.get("target", {}).get("cas_sha256"))
            and bool(receipt.get("payload", {}).get("plan_sha256"))
        )
    if mode == "corrective-apply":
        return (
            receipt.get("status")
            in {
                "corrective_applied_verified_suspended",
                "corrective_already_applied_noop",
            }
            and receipt.get("final_campaign_state") == "SUSPENDED"
            and receipt.get("protected_unchanged") is True
            and receipt.get("mutation_requests") in {0, 3}
        )
    return False


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fail-closed API-only creative operator for Direct 713802902"
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="read-only mode (default)")
    mode.add_argument("--apply", action="store_true", help="apply current source-bound bundle")
    mode.add_argument(
        "--recover-partial",
        action="store_true",
        help="continue only the exact classified partial state",
    )
    mode.add_argument(
        "--corrective-dry-run",
        action="store_true",
        help="read-only exact plan for the existing six-ad corrective bundle",
    )
    mode.add_argument(
        "--corrective-apply",
        action="store_true",
        help="update only exact existing groups/keywords/six ads",
    )
    mode.add_argument(
        "--image-upload-dry-run",
        action="store_true",
        help="read-only exact three-model image upload plan",
    )
    mode.add_argument(
        "--image-upload-apply",
        action="store_true",
        help="upload exact three model images; never changes ads or campaign",
    )
    mode.add_argument(
        "--image-upload-one-dry-run",
        choices=tuple(MODEL_IMAGE_SOURCES),
        metavar="MODEL_KEY",
        help="read-only plan for one exact model image",
    )
    mode.add_argument(
        "--image-upload-one-apply",
        choices=tuple(MODEL_IMAGE_SOURCES),
        metavar="MODEL_KEY",
        help="upload one exact model image for per-row diagnosis",
    )
    parser.add_argument("--expected-cas-sha256", help="exact CAS SHA-256 from fresh dry-run")
    parser.add_argument(
        "--expected-plan-sha256",
        help="exact source-bound plan SHA-256 from the same fresh dry-run",
    )
    parser.add_argument(
        "--expected-image-plan-sha256",
        help="exact model image plan SHA-256 from image upload dry-run",
    )
    args = parser.parse_args(argv)
    args.mode = (
        "image-upload-one-apply"
        if args.image_upload_one_apply
        else "image-upload-one-dry-run"
        if args.image_upload_one_dry_run
        else "image-upload-apply"
        if args.image_upload_apply
        else "image-upload-dry-run"
        if args.image_upload_dry_run
        else "corrective-apply"
        if args.corrective_apply
        else "corrective-dry-run"
        if args.corrective_dry_run
        else "recover-partial"
        if args.recover_partial
        else "apply"
        if args.apply
        else "dry-run"
    )
    if args.mode in {
        "dry-run",
        "corrective-dry-run",
        "image-upload-dry-run",
        "image-upload-one-dry-run",
    } and (
        args.expected_cas_sha256
        or args.expected_plan_sha256
        or args.expected_image_plan_sha256
    ):
        parser.error("expected CAS/plan SHA-256 разрешены только с --apply")
    if args.mode in {"apply", "recover-partial", "corrective-apply"} and (
        not args.expected_cas_sha256 or not args.expected_plan_sha256
    ):
        parser.error(
            "mutation mode требует exact --expected-cas-sha256 и --expected-plan-sha256"
        )
    if args.mode in {"image-upload-apply", "image-upload-one-apply"} and (
        not args.expected_cas_sha256 or not args.expected_image_plan_sha256
    ):
        parser.error("image upload apply требует exact CAS и image plan SHA-256")
    if args.mode in {"image-upload-apply", "image-upload-one-apply"} and args.expected_plan_sha256:
        parser.error("image upload apply не принимает creative plan SHA-256")
    return args


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    token = ""
    api: CreativeDirectApi | None = None
    payload_metadata: dict[str, Any] | None = None
    try:
        route = guard.resolve_route()
        payload, payload_metadata = build_current_payload()
        token = guard.load_project_token()
        api = CreativeDirectApi(token)
        if args.mode == "image-upload-one-apply":
            receipt = run_single_model_image_upload_apply(
                api,
                key=args.image_upload_one_apply,
                expected_cas_sha256=args.expected_cas_sha256,
                expected_image_plan_sha256=args.expected_image_plan_sha256,
                environ=os.environ,
            )
        elif args.mode == "image-upload-one-dry-run":
            receipt = run_single_model_image_upload_dry_run(
                api, key=args.image_upload_one_dry_run
            )
        elif args.mode == "image-upload-apply":
            receipt = run_model_image_upload_apply(
                api,
                expected_cas_sha256=args.expected_cas_sha256,
                expected_image_plan_sha256=args.expected_image_plan_sha256,
                environ=os.environ,
            )
        elif args.mode == "image-upload-dry-run":
            receipt = run_model_image_upload_dry_run(api)
        elif args.mode == "apply":
            receipt = run_apply(
                api,
                payload,
                expected_cas_sha256=args.expected_cas_sha256,
                expected_plan_sha256=args.expected_plan_sha256,
                environ=os.environ,
                payload_metadata=payload_metadata,
            )
        elif args.mode == "recover-partial":
            receipt = run_partial_recovery(
                api,
                payload,
                expected_cas_sha256=args.expected_cas_sha256,
                expected_plan_sha256=args.expected_plan_sha256,
                environ=os.environ,
                payload_metadata=payload_metadata,
            )
        elif args.mode == "corrective-apply":
            receipt = run_corrective_apply(
                api,
                payload,
                expected_cas_sha256=args.expected_cas_sha256,
                expected_plan_sha256=args.expected_plan_sha256,
                environ=os.environ,
                payload_metadata=payload_metadata,
            )
        elif args.mode == "corrective-dry-run":
            receipt = run_corrective_dry_run(
                api, payload, payload_metadata=payload_metadata
            )
        else:
            receipt = run_dry_run(
                api, payload, payload_metadata=payload_metadata
            )
        receipt["routing"] = route
        receipt["request_log"] = api.request_log
    except Exception as exc:
        receipt = _base_receipt(args.mode, payload_metadata)
        receipt.update(status="blocked", error=safe_text(exc, (token,)))
        if isinstance(exc, OperatorError) and exc.partial:
            receipt.update(exc.partial)
        receipt["mutation_requests"] = int(getattr(api, "mutation_requests", 0)) if api else 0
        receipt["request_log"] = list(getattr(api, "request_log", [])) if api else []
    path = save_receipt(receipt, token=token)
    print(
        json.dumps(
            {
                "status": receipt.get("status"),
                "mode": receipt.get("mode"),
                "campaign_id": TARGET_CAMPAIGN_ID,
                "final_campaign_state": receipt.get("final_campaign_state")
                or receipt.get("target", {}).get("state"),
                "mutation_requests": receipt.get("mutation_requests", 0),
                "cas_sha256": receipt.get("target", {}).get("cas_sha256"),
                "plan_sha256": receipt.get("payload", {}).get("plan_sha256"),
                "image_plan_sha256": receipt.get("image_plan", {}).get("plan_sha256"),
                "classification": receipt.get("target", {})
                .get("classification", {})
                .get("classification"),
                "receipt": str(path.relative_to(PROJECT_ROOT)),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0 if receipt_is_safe(receipt) else 1


if __name__ == "__main__":
    raise SystemExit(main())
