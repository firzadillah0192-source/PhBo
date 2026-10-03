"""Shared pytest fixtures.

IMPORTANT — test doubles are labelled clearly.

These tests exercise the REAL application code (routers, state machine,
storage, validation). The only substitution is the AI provider, which is
replaced by `StubProvider` so the job pipeline can be verified without a live
generative model. A stub result is NOT a real AI generation and is never
reported as one — `test_api_flow.py` separately asserts that with no provider
configured the job fails with AI_PROVIDER_NOT_CONNECTED.

Environment is configured BEFORE any app import because settings and the
SQLAlchemy engine are built at import time.
"""

from __future__ import annotations

import io
import os
import shutil
import sys
import tempfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# --- test environment (must precede app imports) ---------------------------
_TMP_ROOT = Path(tempfile.mkdtemp(prefix="photobooth-tests-"))
_TEST_TEMPLATES = _TMP_ROOT / "templates"
_TEMPLATE_SOURCE = Path(os.environ.get("PHOTOBOOTH_TEST_TEMPLATES_DIR", BACKEND_DIR.parent / "templates"))
if _TEMPLATE_SOURCE.is_dir():
    shutil.copytree(_TEMPLATE_SOURCE, _TEST_TEMPLATES, dirs_exist_ok=True)

os.environ["ENVIRONMENT"] = "test"
os.environ["COOKIE_SECURE"] = "false"
os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
os.environ["RUNTIME_DIR"] = str(_TMP_ROOT / "runtime")
os.environ["TEMPLATES_DIR"] = str(_TEST_TEMPLATES)
os.environ["AI_PROVIDER"] = "none"
os.environ["NINEROUTER_API_KEY"] = ""
os.environ["ADMIN_TOKEN"] = "test-admin-token"

import pytest  # noqa: E402
from PIL import Image  # noqa: E402

from app.ai.base import AIProvider, AIResult, GenerationOptions  # noqa: E402
from app.db import SessionLocal, init_db  # noqa: E402
from app.main import app as fastapi_app  # noqa: E402
from app.models import ExperienceStatus, ManagedExperience  # noqa: E402


def make_jpeg(width: int = 640, height: int = 480, color=(200, 160, 130)) -> bytes:
    """A real, decodable JPEG used as the 'user photo' in tests."""
    img = Image.new("RGB", (width, height), color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def make_png(width: int = 512, height: int = 512, color=(30, 60, 120)) -> bytes:
    """A real, decodable PNG used as the stub 'AI result' in tests."""
    img = Image.new("RGB", (width, height), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


class StubProvider(AIProvider):
    """TEST DOUBLE — returns a real PNG so the pipeline can be verified.

    This proves the plumbing (queue -> worker -> provider call -> result
    persistence -> download) works. It does NOT prove AI generation works.
    """

    name = "stub-test"

    def __init__(self, *, calls: list | None = None) -> None:
        self.calls = calls if calls is not None else []

    def is_available(self) -> bool:
        return True

    def generate(
        self,
        user_image: bytes | None,
        template,
        options: GenerationOptions,
    ) -> AIResult:
        # Record what the real code handed us, so tests can assert on it.
        experience = options.extra.get("experience")
        prompt = experience.prompt if experience else template.build_prompt()
        self.calls.append(
            {
                "user_image_bytes": len(user_image or b""),
                "user_image_magic": (user_image or b"")[:3],
                "template_id": template.id if template else None,
                "experience_id": experience.id if experience else None,
                "prompt": prompt,
                "width": options.width,
                "height": options.height,
            }
        )
        data = make_png(options.width or 512, options.height or 512)
        return AIResult(
            image_bytes=data,
            content_type="image/png",
            provider=self.name,
            model="stub-model",
            prompt_used=prompt,
            raw_meta={"stub": True},
        )


@pytest.fixture(scope="session")
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture(scope="session", autouse=True)
def _create_schema():
    init_db()
    # Explicit fixture approval keeps legacy generation tests focused on the
    # worker path; production seeding never auto-publishes experiences.
    with SessionLocal() as session:
        mini_me = session.get(ManagedExperience, "mini-me")
        mini_me.status = ExperienceStatus.PUBLISHED
        session.commit()
    yield


@pytest.fixture
def client():
    """TestClient with lifespan disabled (schema already created)."""
    from fastapi.testclient import TestClient

    with TestClient(fastapi_app) as test_client:
        yield test_client


@pytest.fixture
def db_session():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def stub_provider(monkeypatch):
    """Swap the provider used by the generation service with the stub."""
    import app.services.generation as generation_module

    provider = StubProvider()
    monkeypatch.setattr(generation_module, "get_provider", lambda: provider)
    return provider


@pytest.fixture
def captured_queue(monkeypatch):
    """Replace Redis enqueue with an in-memory list.

    Redis is not available in unit tests; the real Redis path is covered by the
    Docker Compose integration run (see docs/TESTING.md).
    """
    import app.routers.generations as generations_router

    enqueued: list[str] = []
    monkeypatch.setattr(generations_router, "enqueue", lambda job_id: enqueued.append(job_id))
    return enqueued


@pytest.fixture
def uploaded_photo(client) -> dict:
    """A validated upload ready to generate from."""
    response = client.post(
        "/api/uploads",
        files={"file": ("portrait.jpg", make_jpeg(), "image/jpeg")},
    )
    assert response.status_code == 201, response.text
    return response.json()
