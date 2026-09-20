"""Application settings.

Every secret comes from the environment. Nothing is hardcoded here.
See /home/mahez/photoboothai/.env.example for safe placeholder values.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Photobooth AI"
    environment: str = "development"

    # --- Database (PostgreSQL) -------------------------------------------
    database_url: str = Field(
        default="postgresql+psycopg://photobooth:photobooth@photobooth-postgres:5432/photobooth"
    )

    # --- Queue / job state (Redis) ---------------------------------------
    redis_url: str = Field(default="redis://photobooth-redis:6379/0")
    queue_name: str = "photobooth:generation-queue"

    # --- Filesystem -------------------------------------------------------
    # On the VPS these point at /srv/photobooth/* (see docs/DEPLOYMENT.md).
    # In this dev checkout they default to the repo-local ./runtime tree so
    # the project stays isolated and needs no root access.
    runtime_dir: Path = Field(default=Path("/srv/photobooth"))
    templates_dir: Path = Field(default=Path("/srv/photobooth/templates"))

    upload_max_bytes: int = 12 * 1024 * 1024
    upload_min_dimension: int = 256
    upload_max_dimension: int = 8000
    allowed_upload_content_types: tuple[str, ...] = (
        "image/jpeg",
        "image/png",
        "image/webp",
    )

    # --- AI provider ------------------------------------------------------
    # Provider is selected by name so the app is never hard-wired to a vendor.
    ai_provider: str = Field(default="none")

    # 9router is an OpenAI-compatible gateway. Base URL must be reachable from
    # inside the container: host.docker.internal is mapped via extra_hosts in
    # docker-compose.yml.
    ninerouter_base_url: str = Field(default="http://host.docker.internal:20128/v1")
    ninerouter_api_key: str = Field(default="")
    ninerouter_model: str = Field(default="ag/nano-banana-pro")
    ninerouter_timeout_seconds: float = 300.0

    # --- CORS -------------------------------------------------------------
    cors_origins: tuple[str, ...] = (
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
    )

    @property
    def uploads_dir(self) -> Path:
        return self.runtime_dir / "uploads"

    @property
    def results_dir(self) -> Path:
        return self.runtime_dir / "results"

    @property
    def tmp_dir(self) -> Path:
        return self.runtime_dir / "tmp"

    @property
    def cache_dir(self) -> Path:
        return self.runtime_dir / "cache"

    @property
    def backups_dir(self) -> Path:
        return self.runtime_dir / "backups"

    def ensure_runtime_dirs(self) -> None:
        """Create the runtime tree. Mirrors the /srv/photobooth layout."""
        for path in (
            self.runtime_dir,
            self.uploads_dir,
            self.results_dir,
            self.tmp_dir,
            self.cache_dir,
            self.backups_dir,
            self.templates_dir,
        ):
            path.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    return Settings()
