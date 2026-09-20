"""Template registry.

TEMPLATE-DOMINANT FACIAL RESEMBLANCE (spec section 4).

The template is the visual authority. It controls hairstyle, hairline, head
proportion, expression, facial-hair state, skin treatment, lighting, pose,
body, costume, background and composition. The user photo contributes only
moderate facial resemblance (eyes, nose, lips, cheek and jaw contour).

Templates are data, not code: they live under templates_dir as JSON so the
MVP can grow without a template manager UI (explicitly out of scope).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from app.core.config import get_settings

TEMPLATE_DOMINANT_PREAMBLE = (
    "TEMPLATE-DOMINANT RENDER. The template reference is the visual authority and must be "
    "reproduced faithfully: hairstyle, hairline, head proportion, facial expression, "
    "facial-hair state, skin treatment, lighting, pose, body, costume, background and "
    "composition all come from the template. This is NOT a literal face swap. "
    "From the user photo take only MODERATE facial resemblance: eye characteristics, "
    "nose tendency, lip tendency, cheek contour, jaw contour and overall facial "
    "likeness. Do not copy the user's hair, clothing, pose, lighting or background. "
    "Do not paste the user's face onto the template. Keep the identity subtle and "
    "believable within the template's world."
)


class TemplateNotFound(Exception):
    """Raised when a requested template id does not exist."""

    def __init__(self, template_id: str) -> None:
        super().__init__(f"template not found: {template_id}")
        self.template_id = template_id


@dataclass(frozen=True)
class TemplateDefinition:
    id: str
    name: str
    description: str
    prompt: str
    width: int
    height: int
    preview_filename: str | None = None

    def build_prompt(self) -> str:
        """Full prompt sent to the provider: template rules + template brief."""
        return f"{TEMPLATE_DOMINANT_PREAMBLE}\n\nTEMPLATE BRIEF:\n{self.prompt}".strip()


# ---------------------------------------------------------------------------
# Built-in MVP template. Overlaid by templates_dir/<id>/template.json if present.
# ---------------------------------------------------------------------------
_FALLBACK_TEMPLATES: list[dict] = [
    {
        "id": "sci-fi-space-commander-001",
        "name": "Sci-Fi Space Commander",
        "description": (
            "Cinematic sci-fi portrait of a starship commander on a command deck. "
            "Template controls everything except moderate facial resemblance."
        ),
        "prompt": (
            "Subject: a confident starship commander standing on the bridge of a capital "
            "starship. Costume: dark charcoal high-collared uniform jacket with brushed-metal "
            "rank insignia on the left collar and a subdued mission patch on the left shoulder. "
            "Hairstyle: short, neatly cropped dark hair with a clean, slightly receding hairline; "
            "clean-shaven, no facial hair. Head proportion: strong square jaw, broad cheekbones, "
            "calm authoritative expression with slight closed-mouth confidence. Skin treatment: "
            "realistic skin texture with fine pores, subtle subsurface scattering, no plastic "
            "smoothing, no heavy retouching. Lighting: cool cyan key light from a large viewport "
            "camera-left, warm amber rim from console panels camera-right, soft fill, cinematic "
            "contrast ratio about 4:1. Pose: three-quarter turn to camera, shoulders squared, chin "
            "slightly lifted. Background: out-of-focus command deck with holographic tactical "
            "displays and a starfield through the viewport, shallow depth of field. Composition: "
            "medium close-up, subject on the left third, eye-level camera, 85mm-equivalent lens, "
            "f/2.0, photorealistic, high dynamic range, no text, no watermark, no logo."
        ),
        "width": 1024,
        "height": 1024,
    }
]


class TemplateRegistry:
    """Loads templates from disk (JSON) with a built-in fallback."""

    def __init__(self, templates_dir: Path | None = None) -> None:
        self._dir = templates_dir or get_settings().templates_dir
        self._cache: dict[str, TemplateDefinition] | None = None

    def _load(self) -> dict[str, TemplateDefinition]:
        templates: dict[str, TemplateDefinition] = {}

        # Built-in fallbacks first so the slice works with an empty templates dir.
        for raw in _FALLBACK_TEMPLATES:
            templates[raw["id"]] = TemplateDefinition(
                id=raw["id"],
                name=raw["name"],
                description=raw["description"],
                prompt=raw["prompt"],
                width=int(raw.get("width", 1024)),
                height=int(raw.get("height", 1024)),
                preview_filename=raw.get("preview_filename"),
            )

        # Then overlay any JSON manifests found on disk (disk wins).
        if self._dir.exists():
            for sub in sorted(p for p in self._dir.iterdir() if p.is_dir()):
                manifest = sub / "template.json"
                if not manifest.exists():
                    continue
                try:
                    data = json.loads(manifest.read_text(encoding="utf-8"))
                except (json.JSONDecodeError, OSError) as exc:
                    # A broken manifest must not take the registry down, but it
                    # must not be silently accepted either.
                    print(f"[templates] skipping invalid manifest {manifest}: {exc}", flush=True)
                    continue
                tid = data.get("id") or sub.name
                preview = sub / "preview.png"
                templates[tid] = TemplateDefinition(
                    id=tid,
                    name=data.get("name", tid),
                    description=data.get("description", ""),
                    prompt=data.get("prompt", ""),
                    width=int(data.get("width", 1024)),
                    height=int(data.get("height", 1024)),
                    preview_filename="preview.png" if preview.exists() else None,
                )

        return templates

    @property
    def templates(self) -> dict[str, TemplateDefinition]:
        if self._cache is None:
            self._cache = self._load()
        return self._cache

    def reload(self) -> None:
        self._cache = None

    def list(self) -> list[TemplateDefinition]:
        return sorted(self.templates.values(), key=lambda t: t.id)

    def get(self, template_id: str) -> TemplateDefinition:
        try:
            return self.templates[template_id]
        except KeyError as exc:
            raise TemplateNotFound(template_id) from exc


_registry: TemplateRegistry | None = None


def get_registry() -> TemplateRegistry:
    global _registry
    if _registry is None:
        _registry = TemplateRegistry()
    return _registry
