"""Provider boundary for Basic face-identity transfer.

V1 remains the only configured implementation. Experimental providers must
return an identity layer in template coordinates; the Basic engine still owns
the final inner-face mask and template compositor. A remote implementation
must crop the user and template face locally before transport and must never
send the full template scene.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Protocol

import numpy as np

from .blending import piecewise_affine_warp, transform_points, warp_face
from .errors import BasicIdentityProviderNotConfiguredError


class BasicIdentityProvider(Protocol):
    """Transfer user identity into the target face coordinate system."""

    name: str

    def transfer_identity(
        self,
        user_image: np.ndarray,
        template_face: np.ndarray,
        template_landmarks: Mapping[str, np.ndarray],
        user_landmarks: Mapping[str, np.ndarray],
        options: Mapping[str, object],
    ) -> np.ndarray:
        """Return an identity image layer; do not composite or alter the scene."""


class V1WarpIdentityProvider:
    """Adapter around the existing deterministic V1 image-warp stage."""

    name = "v1"

    def transfer_identity(
        self,
        user_image: np.ndarray,
        template_face: np.ndarray,
        template_landmarks: Mapping[str, np.ndarray],
        user_landmarks: Mapping[str, np.ndarray],
        options: Mapping[str, object],
    ) -> np.ndarray:
        output_size = (template_face.shape[1], template_face.shape[0])
        registration_matrix = np.asarray(options["registration_matrix"], dtype=np.float32)
        aligned_user = warp_face(user_image, registration_matrix, output_size)
        if not bool(options.get("warp_user_texture", False)):
            return aligned_user

        labels = tuple(str(label) for label in options["control_labels"])
        source_control = transform_points(
            np.asarray([user_landmarks[label] for label in labels], dtype=np.float32),
            registration_matrix,
        )
        target_control = np.asarray(
            [template_landmarks[label] for label in labels], dtype=np.float32
        )
        warped_user, _ = piecewise_affine_warp(
            aligned_user, source_control, target_control, output_size
        )
        return warped_user


_PROVIDER_FACTORIES: dict[str, Callable[[], BasicIdentityProvider]] = {
    "v1": V1WarpIdentityProvider,
}


def register_basic_identity_provider(
    backend: str,
    factory: Callable[[], BasicIdentityProvider],
) -> None:
    """Register an opt-in provider without coupling the engine to a model."""
    normalized = backend.strip().lower()
    if not normalized or normalized == "v1":
        raise ValueError("provider registration requires a non-empty, non-v1 name")
    _PROVIDER_FACTORIES[normalized] = factory


def get_basic_identity_provider(backend: str) -> BasicIdentityProvider:
    normalized = backend.strip().lower()
    factory = _PROVIDER_FACTORIES.get(normalized)
    if factory is None:
        raise BasicIdentityProviderNotConfiguredError(
            "BASIC_IDENTITY_PROVIDER_NOT_CONFIGURED: "
            f"backend '{normalized or '<empty>'}' has no configured provider; "
            "no fallback was attempted"
        )
    return factory()
