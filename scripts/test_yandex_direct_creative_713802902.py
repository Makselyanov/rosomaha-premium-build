"""Discoverable wrapper for the fail-closed Direct creative operator tests."""

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path


SOURCE = Path(__file__).with_name("yandex-direct-creative-713802902.test.py")
SPEC = spec_from_file_location("yandex_direct_creative_713802902_tests", SOURCE)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Unable to load test module: {SOURCE}")

MODULE = module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

CreativeOperatorTests = MODULE.CreativeOperatorTests
