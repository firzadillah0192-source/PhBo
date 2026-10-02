"""9router provider adapter.

9router is an OpenAI-compatible gateway running locally. The HTTP contract was
verified empirically against the live service (see docs/AI_PROVIDER.md):

    POST {base_url}/images/generations
    Authorization: Bearer <key>
    Content-Type: application/json

    {
      "model": "<provider-prefixed model id>",
      "prompt": "<template-dominant prompt>",
      "size": "<W>x<H>",
      "n": 1,
      "response_format": "b64_json"
    }

Image input is optional: when it is absent, 9router performs prompt-only
text-to-image generation. This is used for Admin marketing previews so no
third-party or personal reference image is sent.

    -> 200 {"created": int, "data": [{"b64_json": "<base64 png/jpeg>"}]}

All provider-specific detail is confined to this file. The rest of the app
only ever talks to the AIProvider interface.
"""

from __future__ import annotations

import base64
import binascii
import io

from PIL import Image

import httpx

from app.ai.base import (
    AIProvider,
    AIProviderError,
    AIResult,
    GenerationOptions,
    ProviderEmptyResultError,
    ProviderNotConnectedError,
)
from app.services.image_validation import normalize_for_provider
from app.templates_registry import TemplateDefinition
from app.experiences import ExperienceDefinition


class NineRouterProvider(AIProvider):
    """Adapter for the 9router OpenAI-compatible gateway."""

    name = "9router"

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        timeout_seconds: float = 300.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._timeout = timeout_seconds

    def is_available(self) -> bool:
        return bool(self._api_key.strip()) and bool(self._base_url.strip())

    def generate(
        self,
        user_image: bytes | None,
        template: TemplateDefinition | None,
        options: GenerationOptions,
    ) -> AIResult:
        if not self.is_available():
            raise ProviderNotConnectedError(
                "AI_PROVIDER_NOT_CONNECTED: 9router base URL or API key is not configured. "
                "Set NINEROUTER_BASE_URL and NINEROUTER_API_KEY."
            )

        experience: ExperienceDefinition | None = options.extra.get("experience")
        if experience is not None:
            prompt = options.extra.get("prompt_override") or experience.prompt
            model = experience.model
            width = options.width or 1024
            height = options.height or 1024
        else:
            if template is None:
                raise AIProviderError("AI_PROVIDER_ERROR: template or experience preset is required")
            prompt = template.build_prompt()
            model = self._model
            width = options.width or template.width
            height = options.height or template.height

        payload = {
            "model": model,
            "prompt": prompt,
            "size": f"{width}x{height}",
            "n": 1,
            "response_format": "b64_json",
        }
        if user_image:
            jpeg_bytes, _ = normalize_for_provider(user_image)
            payload["image"] = "data:image/jpeg;base64," + base64.b64encode(jpeg_bytes).decode("ascii")

        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

        url = f"{self._base_url}/images/generations"

        try:
            response = httpx.post(url, json=payload, headers=headers, timeout=self._timeout)
        except httpx.TimeoutException as exc:
            raise AIProviderError(
                f"9router request timed out after {self._timeout:.0f}s",
                detail=str(exc),
                operational_meta={"upstream_status": "TIMEOUT", "retry_count": 0},
            ) from exc
        except httpx.HTTPError as exc:
            raise AIProviderError(
                f"Could not reach 9router at {url}",
                detail=str(exc),
                operational_meta={"upstream_status": "CONNECTION_ERROR", "retry_count": 0},
            ) from exc

        if response.status_code != 200:
            error_body = _try_json(response)
            raise AIProviderError(
                f"9router returned HTTP {response.status_code}: {_short(response.text)}",
                detail=response.text[:2000],
                operational_meta={
                    **_response_operational_metadata(response, error_body),
                    "requested_model": model,
                    "http_status": response.status_code,
                    "upstream_status": "FAILED",
                },
            )

        body = _parse_provider_body(response)
        image_bytes, meta = _extract_image(body)
        if not image_bytes:
            raise ProviderEmptyResultError(
                "AI_EMPTY_RESULT: 9router responded successfully but returned no image bytes. "
                f"Raw response keys: {sorted(body.keys()) if isinstance(body, dict) else type(body)}",
                operational_meta={
                    **_response_operational_metadata(response, body),
                    "requested_model": model,
                    "upstream_status": "EMPTY_RESULT",
                },
            )

        image_bytes = _as_png(image_bytes)
        operational_meta = _response_operational_metadata(response, body)
        response_model = operational_meta.get("provider_reported_model")
        return AIResult(
            image_bytes=image_bytes,
            content_type="image/png",
            provider=self.name,
            model=response_model if isinstance(response_model, str) else model,
            prompt_used=prompt,
        raw_meta={
                "size": f"{width}x{height}",
                "created": meta.get("created"),
                "requested_model": model,
                **meta,
                **operational_meta,
            },
        )



_SECRET_KEYS = {"authorization", "api_key", "apikey", "access_token", "refresh_token", "secret", "credential", "password"}


def _try_json(response: httpx.Response) -> object:
    try:
        return response.json()
    except ValueError:
        return {}


def _safe_usage(value: object) -> dict | None:
    if not isinstance(value, dict):
        return None

    def clean(item: object, key: str = "") -> object:
        if key.lower() in _SECRET_KEYS:
            return None
        if isinstance(item, dict):
            return {
                str(child_key): clean(child_value, str(child_key))
                for child_key, child_value in item.items()
                if str(child_key).lower() not in _SECRET_KEYS
            }
        if isinstance(item, list):
            return [clean(child) for child in item[:100]]
        if isinstance(item, (str, int, float, bool)) or item is None:
            return item
        return str(item)[:500]

    return clean(value)


def _first_value(*values: object) -> str | None:
    for value in values:
        if isinstance(value, (str, int)) and str(value).strip():
            return str(value).strip()[:255]
    return None


def _response_operational_metadata(response: httpx.Response, body: object) -> dict:
    """Return only explicit, non-secret telemetry from the live 9Router contract."""

    def header(name: str) -> str | None:
        value = response.headers.get(name)
        return value.strip()[:255] if isinstance(value, str) and value.strip() else None

    def integer_header(name: str) -> int | None:
        value = header(name)
        if value is None:
            return None
        try:
            number = int(value)
        except ValueError:
            return None
        return number if number >= 0 else None

    def decimal_header(name: str) -> float | None:
        value = header(name)
        if value is None:
            return None
        try:
            number = float(value)
        except ValueError:
            return None
        return number if number >= 0 else None

    # These names are the headers emitted by 9Router's routing telemetry.
    # Header lookup is case-insensitive through httpx.Headers.
    result = {
        "router_request_id": header("x-9router-request-id"),
        "provider_account_ref": header("x-9router-account-ref"),
        "routing_strategy": header("x-9router-routing-strategy"),
        "provider_name": header("x-9router-provider"),
        "provider_reported_model": header("x-9router-model"),
        "upstream_request_id": header("x-9router-upstream-request-id"),
        "attempt_count": integer_header("x-9router-attempt-count"),
        "retry_count": integer_header("x-9router-retry-count"),
        "failover_count": integer_header("x-9router-failover-count"),
        "router_duration_ms": integer_header("x-9router-duration-ms"),
        "usage_available": header("x-9router-usage-available"),
        "input_tokens": integer_header("x-9router-input-tokens"),
        "output_tokens": integer_header("x-9router-output-tokens"),
        "total_tokens": integer_header("x-9router-total-tokens"),
        "input_text_tokens": integer_header("x-9router-input-text-tokens"),
        "input_image_tokens": integer_header("x-9router-input-image-tokens"),
        "output_image_tokens": integer_header("x-9router-output-image-tokens"),
        "billable_units": integer_header("x-9router-billable-units"),
        "provider_reported_cost": decimal_header("x-9router-reported-cost"),
    }

    usage = {}
    usage_names = {
        "input_tokens": "input_tokens",
        "output_tokens": "output_tokens",
        "total_tokens": "total_tokens",
        "input_text_tokens": "input_text_tokens",
        "input_image_tokens": "input_image_tokens",
        "output_image_tokens": "output_image_tokens",
        "billable_units": "billable_units",
    }
    for field, key in usage_names.items():
        if result[field] is not None:
            usage[key] = result[field]
    if usage:
        result["usage"] = usage

    # Keep only explicit values. The body is intentionally not mined for
    # routing metadata because the live contract exposes it through headers.
    return {key: value for key, value in result.items() if value is not None}


def _parse_provider_body(response: httpx.Response) -> object:
    """Parse either JSON or the provider's SSE event stream."""
    content_type = response.headers.get("content-type", "").lower()
    if "text/event-stream" not in content_type:
        try:
            return response.json()
        except ValueError as exc:
            raise AIProviderError(
                "9router returned a non-JSON/non-SSE 200 response", detail=response.text[:2000]
            ) from exc

    events: list[object] = []
    for raw_line in response.text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith(":") or line == "data: [DONE]":
            continue
        if not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        try:
            events.append(__import__("json").loads(payload))
        except ValueError as exc:
            raise AIProviderError(
                "9router returned invalid SSE JSON data", detail=payload[:1000]
            ) from exc

    for event in events:
        if isinstance(event, dict) and isinstance(event.get("data"), list):
            return event
    raise ProviderEmptyResultError("AI_EMPTY_RESULT: 9router SSE contained no image data")

def _extract_image(body: object) -> tuple[bytes, dict]:
    """Pull image bytes out of the OpenAI-compatible response shape."""
    meta: dict = {}
    if not isinstance(body, dict):
        return b"", meta

    data = body.get("data")
    if not isinstance(data, list) or not data:
        return b"", meta
    if isinstance(body.get("created"), (int, float, str)):
        meta["created"] = body.get("created")

    first = data[0]
    if not isinstance(first, dict):
        return b"", meta

    b64 = first.get("b64_json")
    if isinstance(b64, str) and b64.strip():
        try:
            return base64.b64decode(b64, validate=False), meta
        except (binascii.Error, ValueError) as exc:
            raise AIProviderError(
                "9router returned invalid base64 image data", detail=str(exc)
            ) from exc

    # Some gateways return a URL instead of inline base64.
    url = first.get("url")
    if isinstance(url, str) and url.strip():
        try:
            fetched = httpx.get(url, timeout=120.0, follow_redirects=True)
            fetched.raise_for_status()
            return fetched.content, {"source": "url"}
        except httpx.HTTPError as exc:
            raise AIProviderError(
                f"Failed to download result image from {url}", detail=str(exc)
            ) from exc

    return b"", meta


def _guess_content_type(data: bytes) -> str:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return "application/octet-stream"


def _short(text: str, limit: int = 300) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 3] + "..."


def _as_png(data: bytes) -> bytes:
    """Normalize provider b64_json output to the preset's PNG contract."""
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return data
    with Image.open(io.BytesIO(data)) as image:
        output = io.BytesIO()
        image.convert("RGBA").save(output, format="PNG")
        return output.getvalue()
