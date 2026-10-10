from types import SimpleNamespace

import pytest

from app.services.image_pricing import estimate_image_price


def run(**values):
    fields = dict(provider_reported_model="gpt-image-2.5", requested_model=None, provider_model=None,
                  input_tokens=None, output_tokens=None, input_text_tokens=None,
                  input_image_tokens=None, output_image_tokens=None)
    return SimpleNamespace(**(fields | values))


def test_recent_chibi_simulation_discloses_missing_modalities():
    price = estimate_image_price(run(input_tokens=3227, output_tokens=402))
    assert price["low_usd"] == pytest.approx(0.028195)
    assert price["high_usd"] == pytest.approx(0.037876)
    assert price["status"] == "simulation"
    assert "not a bound on your bill" in price["note"]
    assert "alias" in price["note"]


def test_reported_image_breakdown_uses_separate_rates():
    price = estimate_image_price(run(input_text_tokens=100, input_image_tokens=1000, output_image_tokens=2000))
    assert price["status"] == "image_token_estimate"
    assert price["low_usd"] == price["high_usd"] == pytest.approx(0.0685)


@pytest.mark.parametrize("model", ["gpt-image-2.5-sunburst", "cx/gpt-image-2.5-flare-2026-09-08"])
def test_supported_models_and_snapshots_use_verified_rates(model):
    price = estimate_image_price(run(provider_reported_model=model, input_tokens=1000, output_tokens=1000))
    assert price["low_usd"] == pytest.approx(0.035)
    assert price["high_usd"] == pytest.approx(0.038)


def test_missing_usage_is_never_zero_cost():
    price = estimate_image_price(run())
    assert price["status"] == "unavailable" and price["low_usd"] is None


def test_unknown_upstream_model_does_not_use_requested_model_rates():
    price = estimate_image_price(run(provider_reported_model="other-model", requested_model="cx/gpt-image-2.5", input_tokens=1000, output_tokens=1000))
    assert price["low_usd"] is None


def test_zero_usage_can_be_calculated_and_partial_usage_cannot():
    assert estimate_image_price(run(input_tokens=0, output_tokens=0))["low_usd"] == 0
    assert estimate_image_price(run(input_tokens=123))["low_usd"] is None
