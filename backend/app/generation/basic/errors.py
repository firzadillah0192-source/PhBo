"""Errors raised by the deterministic Basic Local engine."""


class BasicGenerationError(Exception):
    code = "BASIC_ENGINE_ERROR"

    def __init__(self, message: str, *, code: str | None = None):
        super().__init__(message)
        if code:
            self.code = code
        self.message = message


class BasicFaceNotFoundError(BasicGenerationError):
    code = "BASIC_FACE_NOT_FOUND"


class BasicMultipleFacesError(BasicGenerationError):
    code = "BASIC_MULTIPLE_FACES"


class BasicLandmarksUnavailableError(BasicGenerationError):
    code = "BASIC_LANDMARKS_UNAVAILABLE"


class BasicTemplateMetadataMissingError(BasicGenerationError):
    code = "BASIC_TEMPLATE_METADATA_MISSING"

class BasicGeometryError(BasicGenerationError):
    code = "BASIC_GEOMETRY_INVALID"
