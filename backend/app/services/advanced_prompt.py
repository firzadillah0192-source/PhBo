"""Server-owned Advanced prompt composition and editable preset seeds."""

from __future__ import annotations

import json

from app.models import AdvancedFrameStyle, AdvancedOrnament, ManagedExperience

STYLE_PRINCIPLE = (
    "Adapt this frame design language to the visual world of the selected experience "
    "so that the frame and generated scene appear intentionally art-directed together."
)
COMPOSITION_RULES = (
    "Create one coherent 2:3 vertical print composition. Keep the subject readable, "
    "with essential face and body details inside safe margins. Integrate the frame into "
    "the scene rather than adding a fixed border. No stretching."
)
BRANDING_RULES = (
    "The required footer lettering below is an explicit exception to any earlier "
    "instruction forbidding text or watermarks. "
    'Fill the branding box or footer within the lower part of the frame with the exact '
    'text "NXBooth" and a smaller line underneath reading "Powered by GenNexByte". '
    "Integrate both lines into that frame area with clear, legible lettering and materials "
    "appropriate to the selected experience. Keep all branding inside the frame's footer, "
    "without covering the subject. Do not leave the branding box empty, add a separate "
    "black panel, duplicate the branding, or add any other text."
)

FRAME_STYLE_SEEDS = (
    ("natural", "Natural", "Subtle organic photographic framing.", "Create a subtle organic photobooth framing treatment integrated naturally with the selected experience. Use restrained organic shapes, photographic edge treatment, soft natural textures and gentle depth. Keep the main subject dominant."),
    ("modern", "Modern", "Clean contemporary framing.", "Create a sophisticated contemporary photobooth framing treatment. Use clean geometry, premium spacing, restrained architectural shapes, dimensional elements and modern editorial visual language. Adapt all materials and motifs to the selected experience."),
    ("minimal", "Minimal", "Quiet, elegant framing.", "Create a refined minimal photobooth composition. Use restrained edge treatment, strong negative space, elegant proportions and only small intentional decorative details."),
    ("luxury", "Luxury", "Refined materials and premium accents.", "Create a premium luxury photobooth treatment. Use elegant dimensional detailing, refined materials, sophisticated finishing and restrained premium accents appropriate to the selected experience."),
    ("retro", "Retro", "Analog print and nostalgic details.", "Create a tasteful retro photobooth composition. Use analog print cues, vintage photographic proportions, nostalgic graphic language and period-appropriate details adapted to the selected experience."),
    ("film", "Film", "Cinematic photographic details.", "Create a premium photographic film-inspired framing treatment. Use restrained film-strip, negative, contact-sheet and cinematic photographic language without covering the subject."),
    ("cute", "Cute", "Playful dimensional accents.", "Create a polished playful photobooth framing treatment. Use rounded shapes, charming decorative accents and friendly dimensional elements adapted to the selected experience. Keep it premium rather than cheap."),
    ("editorial", "Editorial", "Fashion magazine composition.", "Create a high-end editorial / magazine-style photobooth composition. Use sophisticated layout hierarchy, strong photographic composition, intentional spacing and fashion/editorial visual language. Do not generate random magazine text."),
    ("futuristic", "Futuristic", "Advanced materials and luminous geometry.", "Create a premium futuristic photobooth treatment. Use advanced materials, restrained luminous geometry, dimensional interface elements and technology-inspired details appropriate to the selected experience. Avoid generic gaming HUD or Twitch overlay appearance."),
    ("artistic", "Artistic", "Expressive crafted edges.", "Create an expressive art-directed photobooth framing treatment. Use creative edge forms, crafted textures and artistic composition while maintaining subject readability."),
)
ORNAMENT_SEEDS = (
    ("sparkles", "Sparkles", "Subtle decorative sparkles.", "Add a few tasteful sparkles appropriate to the experience world."),
    ("hearts", "Hearts", "Small playful heart accents.", "Add a few polished heart accents in the experience visual language."),
    ("glasses", "Glasses", "Theme compatible eyewear.", "Add eyewear compatible with the selected experience, without obscuring identity."),
)


class AdvancedSelectionError(ValueError):
    pass


def _allowed_ids(raw: str | None) -> set[str] | None:
    if raw is None:
        return None
    value = json.loads(raw)
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise AdvancedSelectionError("Invalid compatibility configuration")
    return set(value)


def validate_advanced_selection(experience: ManagedExperience, frame: AdvancedFrameStyle | None, ornaments: list[AdvancedOrnament], requested_ids: list[str]) -> None:
    if frame is None or not frame.enabled:
        raise AdvancedSelectionError("Frame style is unavailable")
    allowed_frames = _allowed_ids(experience.compatible_frame_style_ids_json)
    if allowed_frames is not None and frame.id not in allowed_frames:
        raise AdvancedSelectionError("Frame style is incompatible with this experience")
    if len(requested_ids) != len(set(requested_ids)) or len(requested_ids) > experience.max_ornaments:
        raise AdvancedSelectionError("Too many or duplicate ornaments")
    if {item.id for item in ornaments} != set(requested_ids) or any(not item.enabled for item in ornaments):
        raise AdvancedSelectionError("Ornament is unavailable")
    allowed_ornaments = _allowed_ids(experience.compatible_ornament_ids_json)
    if allowed_ornaments is not None and any(item.id not in allowed_ornaments for item in ornaments):
        raise AdvancedSelectionError("Ornament is incompatible with this experience")


def compose_advanced_prompt(experience_prompt: str, frame_style_prompt: str) -> str:
    """Compose AI art direction; camera ornaments must never enter this prompt."""
    if not experience_prompt.strip() or not frame_style_prompt.strip():
        raise AdvancedSelectionError("Experience and frame prompts are required")
    sections = [
        "EXPERIENCE — PRIMARY VISUAL AUTHORITY\n" + experience_prompt.strip(),
        "FRAME STYLE\n" + frame_style_prompt.strip() + "\n" + STYLE_PRINCIPLE,
    ]
    sections.extend(("PRINT AND COMPOSITION\n" + COMPOSITION_RULES, "FRAME FOOTER BRANDING\n" + BRANDING_RULES))
    return "\n\n".join(sections)
