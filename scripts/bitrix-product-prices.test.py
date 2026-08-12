#!/usr/bin/env python3
"""Regression tests for public Bitrix SKU binding verification."""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


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


if __name__ == "__main__":
    unittest.main()
