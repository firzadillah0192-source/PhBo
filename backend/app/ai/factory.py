"""Provider factory.

Selects a provider adapter purely from configuration. No part of the app
imports a concrete provider except through here, so swapping vendors is a
config change, not a code change.

AI_PROVIDER values:
    none      -> NullProvider, always raises AI_PROVIDER_NOT_CONNECTED
    9router   -> NineRouterProvider (OpenAI-compatible gateway)

If AI_PROVIDER=9router but the API key is missing, we still return the real
adapter with is_available() == False so health checks and jobs surface the
honest AI_PROVIDER_NOT_CONNECTED status instead of pretending to work.
"""

from __future__ import annotations

from app.ai.base import (
    AIProvider,
    GenerationOptions,
    ProviderNotConnectedError,
)
from app.ai.ninerouter import NineRouterProvider
from app.core.config import get_settings
from app.templates_registry import TemplateDefinition


class NullProvider(AIProvider):
    """Explicit 'nothing connected' provider.

    Per spec section 4 this must report AI_PROVIDER_NOT_CONNECTED. It never
    invents an image.
    """

    name = "none"

    def is_available(self) -> bool:
        return False

    def generate(
        self,
        user_image: bytes | None,
        template: TemplateDefinition | None,
        options: GenerationOptions,
    ):
        raise ProviderNotConnectedError(
            "AI_PROVIDER_NOT_CONNECTED: no AI provider is configured. "
            "Set AI_PROVIDER (e.g. '9router') and the matching credentials."
        )


def build_provider() -> AIProvider:
    """Instantiate the configured provider."""
    settings = get_settings()
    name = (settings.ai_provider or "none").strip().lower()

    if name in ("", "none", "null", "disabled"):
        return NullProvider()

    if name == "9router":
        return NineRouterProvider(
            base_url=settings.ninerouter_base_url,
            api_key=settings.ninerouter_api_key,
            model=settings.ninerouter_model,
            timeout_seconds=settings.ninerouter_timeout_seconds,
        )

    raise ValueError(
        f"Unknown AI_PROVIDER '{settings.ai_provider}'. Supported: none, 9router."
    )


_provider: AIProvider | None = None


def get_provider() -> AIProvider:
    global _provider
    if _provider is None:
        _provider = build_provider()
    return _provider


def reset_provider() -> None:
    """Drop the cached provider (used by tests)."""
    global _provider
    _provider = None
