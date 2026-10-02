"""Unit tests for the AIProvider abstraction (spec section 4).

These assert the provider selection and honest-failure behaviour WITHOUT any
live generative model. They verify that:
  - the factory never hard-wires a vendor,
  - 'none' raises AI_PROVIDER_NOT_CONNECTED and never fabricates an image,
  - 9router without credentials reports AI_PROVIDER_NOT_CONNECTED,
  - the 9router adapter parses the real OpenAI-compatible response shape,
  - non-200 / empty responses surface as explicit errors.

Note: get_settings() is lru_cached, so every test that changes provider env
vars must clear the cache before and after.
"""

from __future__ import annotations

import base64

import httpx
import pytest

from app.ai.base import (
    AIProviderError,
    AIResult,
    GenerationOptions,
    ProviderEmptyResultError,
    ProviderNotConnectedError,
)
from app.ai.factory import NullProvider, build_provider
from app.ai.ninerouter import NineRouterProvider
from app.core.config import get_settings
from app.experiences import get_experience
from app.templates_registry import get_registry
from conftest import make_jpeg, make_png


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    """Keep cached settings from leaking between provider-selection tests."""
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


# ---------------------------------------------------------------------------
# Factory / selection
# ---------------------------------------------------------------------------
def test_default_provider_is_none(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "none")
    provider = build_provider()
    assert isinstance(provider, NullProvider)
    assert provider.is_available() is False


def test_null_provider_raises_not_connected_and_makes_no_image():
    provider = NullProvider()
    template = get_registry().get("sci-fi-space-commander-001")
    with pytest.raises(ProviderNotConnectedError) as excinfo:
        provider.generate(make_jpeg(), template, GenerationOptions())
    assert excinfo.value.code == "AI_PROVIDER_NOT_CONNECTED"


def test_factory_selects_9router(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "9router")
    monkeypatch.setenv("NINEROUTER_API_KEY", "test-key")
    monkeypatch.setenv("NINEROUTER_BASE_URL", "http://localhost:1/v1")
    monkeypatch.setenv("NINEROUTER_MODEL", "ag/nano-banana-pro")

    provider = build_provider()
    assert isinstance(provider, NineRouterProvider)
    assert provider.name == "9router"
    assert provider.is_available() is True


def test_9router_without_key_is_not_available(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "9router")
    monkeypatch.setenv("NINEROUTER_API_KEY", "")

    provider = build_provider()
    assert isinstance(provider, NineRouterProvider)
    assert provider.is_available() is False

    template = get_registry().get("sci-fi-space-commander-001")
    with pytest.raises(ProviderNotConnectedError):
        provider.generate(make_jpeg(), template, GenerationOptions())


def test_unknown_provider_rejected(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "some-vendor-that-does-not-exist")
    with pytest.raises(ValueError, match="Unknown AI_PROVIDER"):
        build_provider()


# ---------------------------------------------------------------------------
# 9router adapter response parsing (stubbed transport, no live model)
# ---------------------------------------------------------------------------
def _provider(**overrides) -> NineRouterProvider:
    kwargs = dict(
        base_url="http://test-router.local/v1",
        api_key="test-key",
        model="ag/nano-banana-pro",
        timeout_seconds=5.0,
    )
    kwargs.update(overrides)
    return NineRouterProvider(**kwargs)


def test_9router_parses_b64_response(monkeypatch):
    """The adapter must decode the real {data:[{b64_json}]} shape."""
    fake_png = make_png(64, 64)
    payload = {
        "created": 1700000000,
        "data": [{"b64_json": base64.b64encode(fake_png).decode("ascii")}],
    }

    captured: dict = {}

    def fake_post(url, *, json, headers, timeout):
        captured["url"] = url
        captured["json"] = json
        captured["headers"] = headers
        return httpx.Response(200, json=payload, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", fake_post)

    template = get_registry().get("sci-fi-space-commander-001")
    result = _provider().generate(
        make_jpeg(300, 200), template, GenerationOptions(width=1024, height=1024)
    )

    assert isinstance(result, AIResult)
    assert result.image_bytes == fake_png
    assert result.content_type == "image/png"
    assert result.provider == "9router"
    assert result.model == "ag/nano-banana-pro"

    # The request the adapter sent must match the documented contract.
    assert captured["url"].endswith("/images/generations")
    assert captured["headers"]["Authorization"] == "Bearer test-key"
    assert captured["json"]["model"] == "ag/nano-banana-pro"
    assert captured["json"]["size"] == "1024x1024"
    assert captured["json"]["response_format"] == "b64_json"
    assert captured["json"]["n"] == 1
    assert captured["json"]["prompt"].startswith("TEMPLATE-DOMINANT RENDER")
    assert captured["json"]["image"].startswith("data:image/jpeg;base64,")


def test_9router_non_200_raises_provider_error(monkeypatch):
    def fake_post(url, *, json, headers, timeout):
        return httpx.Response(
            502,
            text='{"error":{"message":"[antigravity/x] [502]: Internal error"}}',
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(httpx, "post", fake_post)
    template = get_registry().get("sci-fi-space-commander-001")
    with pytest.raises(AIProviderError) as excinfo:
        _provider().generate(make_jpeg(), template, GenerationOptions())
    assert excinfo.value.code == "AI_PROVIDER_ERROR"
    assert "502" in excinfo.value.message


def test_9router_empty_result_raises(monkeypatch):
    """A 200 with no image bytes must NOT become a fake success."""

    def fake_post(url, *, json, headers, timeout):
        return httpx.Response(
            200, json={"created": 1, "data": []}, request=httpx.Request("POST", url)
        )

    monkeypatch.setattr(httpx, "post", fake_post)
    template = get_registry().get("sci-fi-space-commander-001")
    with pytest.raises(ProviderEmptyResultError) as excinfo:
        _provider().generate(make_jpeg(), template, GenerationOptions())
    assert excinfo.value.code == "AI_EMPTY_RESULT"


def test_9router_timeout_raises(monkeypatch):
    def fake_post(url, *, json, headers, timeout):
        raise httpx.TimeoutException("boom")

    monkeypatch.setattr(httpx, "post", fake_post)
    template = get_registry().get("sci-fi-space-commander-001")
    with pytest.raises(AIProviderError, match="timed out"):
        _provider().generate(make_jpeg(), template, GenerationOptions())


def test_9router_connection_error_raises(monkeypatch):
    def fake_post(url, *, json, headers, timeout):
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(httpx, "post", fake_post)
    template = get_registry().get("sci-fi-space-commander-001")
    with pytest.raises(AIProviderError, match="Could not reach"):
        _provider().generate(make_jpeg(), template, GenerationOptions())


def test_9router_url_result_downloaded(monkeypatch):
    """If the gateway returns a URL instead of b64, the adapter fetches it."""
    fake_png = make_png(32, 32)

    def fake_post(url, *, json, headers, timeout):
        return httpx.Response(
            200,
            json={"data": [{"url": "http://cdn.local/result.png"}]},
            request=httpx.Request("POST", url),
        )

    def fake_get(url, **kwargs):
        return httpx.Response(200, content=fake_png, request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "post", fake_post)
    monkeypatch.setattr(httpx, "get", fake_get)

    template = get_registry().get("sci-fi-space-commander-001")
    result = _provider().generate(make_jpeg(), template, GenerationOptions())
    assert result.image_bytes == fake_png
    assert result.raw_meta.get("source") == "url"


def test_9router_invalid_base64_raises(monkeypatch):
    def fake_post(url, *, json, headers, timeout):
        return httpx.Response(
            200,
            json={"data": [{"b64_json": "!!!not-base64!!!"}]},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(httpx, "post", fake_post)
    template = get_registry().get("sci-fi-space-commander-001")
    with pytest.raises(AIProviderError, match="invalid base64"):
        _provider().generate(make_jpeg(), template, GenerationOptions())


def test_9router_non_json_200_raises(monkeypatch):
    def fake_post(url, *, json, headers, timeout):
        return httpx.Response(
            200, text="<html>gateway error page</html>", request=httpx.Request("POST", url)
        )

    monkeypatch.setattr(httpx, "post", fake_post)
    template = get_registry().get("sci-fi-space-commander-001")
    with pytest.raises(AIProviderError, match="non-JSON"):
        _provider().generate(make_jpeg(), template, GenerationOptions())


def test_mini_me_uses_single_image_preset_and_decodes_png(monkeypatch):
    fake_png = make_png(64, 64)
    captured = {}

    def fake_post(url, *, json, headers, timeout):
        captured["json"] = json
        return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(fake_png).decode("ascii")}]}, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", fake_post)
    experience = get_experience("mini-me")
    result = _provider(model="ignored-by-preset").generate(
        make_jpeg(), None, GenerationOptions(extra={"experience": experience})
    )
    assert result.image_bytes.startswith(b"\x89PNG")
    assert result.content_type == "image/png"
    assert captured["json"]["model"] == "cx/gpt-image-2.5"
    assert captured["json"]["prompt"] == experience.prompt
    assert "image" in captured["json"]
    assert "images" not in captured["json"]
    assert "template" not in captured["json"]
    assert captured["json"]["image"].startswith("data:image/jpeg;base64,")


def test_9router_prompt_only_omits_reference_image(monkeypatch):
    fake_png = make_png(64, 64)
    captured = {}

    def fake_post(url, *, json, headers, timeout):
        captured["json"] = json
        return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(fake_png).decode("ascii")}]}, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", fake_post)
    experience = get_experience("mini-me")
    result = _provider().generate(
        None,
        None,
        GenerationOptions(extra={"experience": experience, "prompt_override": "An original fictional portrait"}),
    )
    assert result.image_bytes.startswith(b"\x89PNG")
    assert captured["json"]["prompt"] == "An original fictional portrait"
    assert "image" not in captured["json"]


def test_9router_parses_sse_data_b64_json(monkeypatch):
    fake_png = make_png(48, 48)
    event = {"data": [{"b64_json": base64.b64encode(fake_png).decode("ascii") }]}
    sse = "data: " + __import__("json").dumps(event) + "\n\n data: [DONE]\n"

    def fake_post(url, *, json, headers, timeout):
        return httpx.Response(200, content=sse.encode(), headers={"content-type": "text/event-stream"}, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", fake_post)
    experience = get_experience("mini-me")
    result = _provider().generate(make_jpeg(), None, GenerationOptions(extra={"experience": experience}))
    assert result.image_bytes.startswith(b"\x89PNG")
    assert result.content_type == "image/png"


def test_9router_captures_explicit_operational_metadata_only(monkeypatch):
    fake_png = make_png(64, 64)

    def fake_post(url, *, json, headers, timeout):
        return httpx.Response(
            200,
            json={
                "data": [{"b64_json": base64.b64encode(fake_png).decode("ascii")}],
            },
            headers={
                "X-9Router-Request-ID": "rtr_test-123",
                "X-9Router-Account-Ref": "acct_004e13ad8adc",
                "X-9Router-Routing-Strategy": "round-robin",
                "X-9Router-Provider": "codex",
                "X-9Router-Model": "gpt-image-2.5",
                "X-9Router-Upstream-Request-ID": "resp_test-123",
                "X-9Router-Attempt-Count": "1",
                "X-9Router-Retry-Count": "0",
                "X-9Router-Failover-Count": "0",
                "X-9Router-Duration-Ms": "1234",
                "X-9Router-Usage-Available": "true",
                "X-9Router-Input-Tokens": "2243",
                "X-9Router-Output-Tokens": "71",
                "X-9Router-Total-Tokens": "2314",
            },
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(httpx, "post", fake_post)
    experience = get_experience("mini-me")
    result = _provider().generate(
        make_jpeg(), None, GenerationOptions(extra={"experience": experience})
    )
    assert result.model == "gpt-image-2.5"
    assert result.raw_meta["router_request_id"] == "rtr_test-123"
    assert result.raw_meta["upstream_request_id"] == "resp_test-123"
    assert result.raw_meta["provider_account_ref"] == "acct_004e13ad8adc"
    assert result.raw_meta["routing_strategy"] == "round-robin"
    assert result.raw_meta["provider_name"] == "codex"
    assert result.raw_meta["provider_reported_model"] == "gpt-image-2.5"
    assert result.raw_meta["attempt_count"] == 1
    assert result.raw_meta["retry_count"] == 0
    assert result.raw_meta["failover_count"] == 0
    assert result.raw_meta["router_duration_ms"] == 1234
    assert result.raw_meta["usage"]["input_tokens"] == 2243
    assert result.raw_meta["usage"]["output_tokens"] == 71
    assert result.raw_meta["usage"]["total_tokens"] == 2314
    assert "api_key" not in result.raw_meta


def test_9router_telemetry_is_nullable_safe_for_missing_or_invalid_headers(monkeypatch):
    fake_png = make_png(32, 32)

    def fake_post(url, *, json, headers, timeout):
        return httpx.Response(
            200,
            json={"data": [{"b64_json": base64.b64encode(fake_png).decode("ascii")}]},
            headers={
                "X-9Router-Request-ID": "rtr_partial",
                "X-9Router-Attempt-Count": "not-a-number",
                "X-9Router-Retry-Count": "-1",
                "X-9Router-Total-Tokens": "2314x",
                "X-9Router-Usage-Available": "false",
            },
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(httpx, "post", fake_post)
    result = _provider().generate(
        make_jpeg(), None, GenerationOptions(extra={"experience": get_experience("mini-me")})
    )
    assert result.raw_meta["router_request_id"] == "rtr_partial"
    assert "attempt_count" not in result.raw_meta
    assert "retry_count" not in result.raw_meta
    assert "total_tokens" not in result.raw_meta
    assert result.raw_meta["usage_available"] == "false"
