"""AIProvider abstraction.

The application must never be hard-wired to one vendor. Every provider
implements `generate(user_image, template, options) -> AIResult` and lives
behind this interface. Selection happens in `factory.py` from configuration.

Per spec section 4: if no real provider is connected we raise
ProviderNotConnectedError so the job reports AI_PROVIDER_NOT_CONNECTED.
We never fabricate an image and claim generation succeeded.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


class AIProviderError(Exception):
    """Base error for provider failures."""

    code = "AI_PROVIDER_ERROR"

    def __init__(self, message: str, *, detail: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.detail = detail


class ProviderNotConnectedError(AIProviderError):
    """No real provider is configured/available."""

    code = "AI_PROVIDER_NOT_CONNECTED"


class ProviderEmptyResultError(AIProviderError):
    """Provider returned a success response but no image bytes."""

    code = "AI_EMPTY_RESULT"


@dataclass(frozen=True)
class GenerationOptions:
    """Options passed through to the provider.

    Deliberately small: only what the MVP vertical slice actually uses.
    """

    width: int = 1024
    height: int = 1024
    seed: int | None = None
    extra: dict = field(default_factory=dict)


@dataclass(frozen=True)
class AIResult:
    """A real generated image, plus provenance for auditability."""

    image_bytes: bytes
    content_type: str
    provider: str
    model: str
    prompt_used: str
    raw_meta: dict = field(default_factory=dict)


class AIProvider(ABC):
    """Contract every provider adapter must satisfy."""

    name: str = "abstract"

    @abstractmethod
    def generate(
        self,
        user_image: bytes,
        template: "TemplateDefinition",  # noqa: F821 - avoids import cycle
        options: GenerationOptions,
    ) -> AIResult:
        """Turn a user photo + template into a real result image."""
        raise NotImplementedError

    def is_available(self) -> bool:
        """Cheap readiness check used by /api/health and job enqueue."""
        return True
