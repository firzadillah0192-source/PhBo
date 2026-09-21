"""Boundary for the future deterministic Python face-fitting engine.

Basic is intentionally unavailable until a real fitting/compositing engine
exists. Copying the uploaded face onto a template is not an acceptable result.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

from app.templates_registry import TemplateDefinition


class BasicEngineNotConnectedError(Exception):
    code = "BASIC_ENGINE_NOT_CONNECTED"


@dataclass(frozen=True)
class BasicResult:
    image_bytes: bytes
    content_type: str
    engine_name: str


class BasicEngine(ABC):
    @abstractmethod
    def generate(self, user_image: bytes, template: TemplateDefinition) -> BasicResult:
        """Produce a real deterministic composite."""


class UnavailableBasicEngine(BasicEngine):
    def generate(self, user_image: bytes, template: TemplateDefinition) -> BasicResult:
        raise BasicEngineNotConnectedError(
            "Basic local processing is in development; no image was generated."
        )


def get_basic_engine() -> BasicEngine:
    return UnavailableBasicEngine()
