"""9router provider adapter.

9router is an OpenAI-compatible gateway running locally. The HTTP contract was
verified empirically against the live service (see docs/AI_PROVIDER.md):

    POST {base_url}/images/generations
    Authorization: Bearer <key>
    Content-Type: application/json

    {
      "model": "<provider-prefixed model id>",
      "prompt": "<template-dominant prompt>",
      "image": "data:image/jpeg;base64,<user photo>",
      "size": "<W>x<H>",
      "n": 1,
      "response_format": "b64_json"
    }

    -> 200 {"created": int, "data": [{"b64_json": "<base64 png/jpeg>"}]}

All provider-specific detail is confined to this file. The rest of the app
only ever talks to the AIProvider interface.
"""

from __future__ import annotations

import base64
import binascii

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
        user_image: bytes,
        template: TemplateDefinition,
        options: GenerationOptions,
    ) -> AIResult:
        if not self.is_available():
            raise ProviderNotConnectedError(
                "AI_PROVIDER_NOT_CONNECTED: 9router base URL or API key is not configured. "
                "Set NINEROUTER_BASE_URL and NINEROUTER_API_KEY."
            )

        jpeg_bytes, _ = normalize_for_provider(user_image)
        data_uri = "data:image/jpeg;base64," + base64.b64encode(jpeg_bytes).decode("ascii")

        prompt = template.build_prompt()
        width = options.width or template.width
        height = options.height or template.height

        payload = {
            "model": self._model,
            "prompt": prompt,
            "image": data_uri,
            "size": f"{width}x{height}",
            "n": 1,
            "response_format": "b64_json",
        }

        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

        url = f"{self._base_url}/images/generations"

        try:
            response = httpx.post(url, json=payload, headers=headers, timeout=self._timeout)
        except httpx.TimeoutException as exc:
            raise AIProviderError(
                f"9router request timed out after {self._timeout:.0f}s", detail=str(exc)
            ) from exc
        except httpx.HTTPError as exc:
            raise AIProviderError(
                f"Could not reach 9router at {url}", detail=str(exc)
            ) from exc

        if response.status_code != 200:
            raise AIProviderError(
                f"9router returned HTTP {response.status_code}: {_short(response.text)}",
                detail=response.text[:2000],
            )

        try:
            body = response.json()
        except ValueError as exc:
            raise AIProviderError(
                "9router returned a non-JSON 200 response", detail=response.text[:2000]
            ) from exc

        image_bytes, meta = _extract_image(body)
        if not image_bytes:
            raise ProviderEmptyResultError(
                "AI_EMPTY_RESULT: 9router responded successfully but returned no image bytes. "
                f"Raw response keys: {sorted(body.keys()) if isinstance(body, dict) else type(body)}"
            )

        return AIResult(
            image_bytes=image_bytes,
            content_type=_guess_content_type(image_bytes),
            provider=self.name,
            model=self._model,
            prompt_used=prompt,
            raw_meta={
                "size": f"{width}x{height}",
                "created": body.get("created") if isinstance(body, dict) else None,
                **meta,
            },
        )


def _extract_image(body: object) -> tuple[bytes, dict]:
    """Pull image bytes out of the OpenAI-compatible response shape."""
    meta: dict = {}
    if not isinstance(body, dict):
        return b"", meta

    data = body.get("data")
    if not isinstance(data, list) or not data:
        return b"", meta

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
