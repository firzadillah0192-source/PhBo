"""Tunable Basic identity profiles.

Production remains the default. Candidate profiles are opt-in so visual
regressions can be reviewed before any stronger identity setting is deployed.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Mapping


PRODUCTION_MORPHOLOGY = MappingProxyType({
    "eyes": 0.45,
    "eyebrows": 0.40,
    "nose": 0.40,
    "mouth": 0.45,
    "cheeks": 0.35,
    "jaw": 0.30,
    "chin": 0.25,
    "inner_boundary": 0.0,
    "hard_template_boundary": 0.0,
    "temple_boundary": 0.0,
    "upper_cheek_boundary": 0.0,
    "cheek_boundary": 0.0,
    "lower_cheek_boundary": 0.0,
    "jaw_angle_boundary": 0.0,
    "jaw_boundary": 0.0,
    "chin_boundary": 0.0,
})

STRONGER_MORPHOLOGY = MappingProxyType({
    "eyes": 0.55,
    "eyebrows": 0.50,
    "nose": 0.50,
    "mouth": 0.55,
    "cheeks": 0.50,
    "jaw": 0.45,
    "chin": 0.40,
    "inner_boundary": 0.0,
    "hard_template_boundary": 0.0,
    "temple_boundary": 0.0,
    "upper_cheek_boundary": 0.0,
    "cheek_boundary": 0.0,
    "lower_cheek_boundary": 0.0,
    "jaw_angle_boundary": 0.0,
    "jaw_boundary": 0.0,
    "chin_boundary": 0.0,
})

SOFT_CONTOUR_MORPHOLOGY = MappingProxyType({
    "eyes": 0.60,
    "eyebrows": 0.55,
    "nose": 0.60,
    "mouth": 0.60,
    "cheeks": 0.60,
    "jaw": 0.55,
    "chin": 0.50,
    "inner_boundary": 0.0,
    "hard_template_boundary": 0.0,
    "temple_boundary": 0.35,
    "upper_cheek_boundary": 0.60,
    "cheek_boundary": 0.60,
    "lower_cheek_boundary": 0.60,
    "jaw_angle_boundary": 0.55,
    "jaw_boundary": 0.55,
    "chin_boundary": 0.50,
})

SOFT_CONTOUR_LIMITS = MappingProxyType({
    "temple_boundary": 0.05,
    "upper_cheek_boundary": 0.08,
    "cheek_boundary": 0.10,
    "lower_cheek_boundary": 0.10,
    "jaw_angle_boundary": 0.12,
    "jaw_boundary": 0.12,
    "chin_boundary": 0.10,
})

PRODUCTION_IDENTITY_TEXTURE = MappingProxyType({
    "eyes": 0.42,
    "eyebrows": 0.34,
    "nose": 0.34,
    "mouth": 0.40,
    "cheeks": 0.22,
})

# Selective, bounded increases. No global texture alpha is used, and regions
# outside these inner-face groups remain zero.
STRONGER_IDENTITY_TEXTURE = MappingProxyType({
    "eyes": 0.54,
    "eyebrows": 0.48,
    "nose": 0.50,
    "mouth": 0.54,
    "cheeks": 0.36,
})

USER_DOMINANT_IDENTITY_TEXTURE = MappingProxyType({
    "eyes": 0.70,
    "eyebrows": 0.65,
    "nose": 0.65,
    "mouth": 0.70,
    "cheeks": 0.45,
})

FREQUENCY_IDENTITY_TEXTURE = MappingProxyType({
    "eyes": 0.70,
    "eyebrows": 0.65,
    "nose": 0.65,
    "mouth": 0.70,
    "cheeks": 0.45,
})

FREQUENCY_CONTRAST_IDENTITY_TEXTURE = MappingProxyType({
    "eyes": 0.66,
    "eyebrows": 0.62,
    "nose": 0.62,
    "mouth": 0.66,
    "cheeks": 0.40,
})


@dataclass(frozen=True)
class BasicIdentityProfile:
    name: str
    morphology_strength: Mapping[str, float]
    identity_texture_strength: Mapping[str, float]
    mesh_profile: str
    use_template_landmarks: bool = False
    semantic_boundary_alignment: bool = False
    contour_movement_limits: Mapping[str, float] = field(
        default_factory=lambda: MappingProxyType({})
    )
    enable_soft_contour_mask: bool = False
    warp_user_texture: bool = False
    texture_pipeline: str = "regional_alpha"
    local_contrast_strength: float = 0.0


IDENTITY_PROFILES = MappingProxyType({
    "production": BasicIdentityProfile(
        name="production",
        morphology_strength=PRODUCTION_MORPHOLOGY,
        identity_texture_strength=PRODUCTION_IDENTITY_TEXTURE,
        mesh_profile="semantic_72",
    ),
    "stronger_morphology": BasicIdentityProfile(
        name="stronger_morphology",
        morphology_strength=STRONGER_MORPHOLOGY,
        identity_texture_strength=PRODUCTION_IDENTITY_TEXTURE,
        mesh_profile="semantic_72",
    ),
    "stronger_identity": BasicIdentityProfile(
        name="stronger_identity",
        morphology_strength=STRONGER_MORPHOLOGY,
        identity_texture_strength=STRONGER_IDENTITY_TEXTURE,
        mesh_profile="semantic_166",
        use_template_landmarks=True,
    ),
    "soft_contour": BasicIdentityProfile(
        name="soft_contour",
        morphology_strength=SOFT_CONTOUR_MORPHOLOGY,
        identity_texture_strength=STRONGER_IDENTITY_TEXTURE,
        mesh_profile="semantic_166_soft",
        use_template_landmarks=True,
        semantic_boundary_alignment=True,
        contour_movement_limits=SOFT_CONTOUR_LIMITS,
        enable_soft_contour_mask=True,
    ),
    "soft_contour_identity": BasicIdentityProfile(
        name="soft_contour_identity",
        morphology_strength=SOFT_CONTOUR_MORPHOLOGY,
        identity_texture_strength=USER_DOMINANT_IDENTITY_TEXTURE,
        mesh_profile="semantic_166_soft",
        use_template_landmarks=True,
        semantic_boundary_alignment=True,
        contour_movement_limits=SOFT_CONTOUR_LIMITS,
        enable_soft_contour_mask=True,
        warp_user_texture=True,
        texture_pipeline="multiband_local_illumination",
    ),
    # Photometric-only experiments: geometry inputs intentionally match F.
    "frequency_identity": BasicIdentityProfile(
        name="frequency_identity",
        morphology_strength=SOFT_CONTOUR_MORPHOLOGY,
        identity_texture_strength=FREQUENCY_IDENTITY_TEXTURE,
        mesh_profile="semantic_166_soft",
        use_template_landmarks=True,
        semantic_boundary_alignment=True,
        contour_movement_limits=SOFT_CONTOUR_LIMITS,
        enable_soft_contour_mask=True,
        warp_user_texture=True,
        texture_pipeline="frequency_authority",
    ),
    "frequency_identity_contrast": BasicIdentityProfile(
        name="frequency_identity_contrast",
        morphology_strength=SOFT_CONTOUR_MORPHOLOGY,
        identity_texture_strength=FREQUENCY_CONTRAST_IDENTITY_TEXTURE,
        mesh_profile="semantic_166_soft",
        use_template_landmarks=True,
        semantic_boundary_alignment=True,
        contour_movement_limits=SOFT_CONTOUR_LIMITS,
        enable_soft_contour_mask=True,
        warp_user_texture=True,
        texture_pipeline="frequency_authority",
        local_contrast_strength=0.14,
    ),
})


def get_identity_profile(name: str) -> BasicIdentityProfile:
    try:
        return IDENTITY_PROFILES[name]
    except KeyError as exc:
        supported = ", ".join(IDENTITY_PROFILES)
        raise ValueError(f"unsupported Basic identity profile '{name}'; expected {supported}") from exc
