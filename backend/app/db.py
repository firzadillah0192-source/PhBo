"""SQLAlchemy engine/session setup.

Only metadata and file references are stored in PostgreSQL. Image bytes live
on the filesystem under runtime_dir (never in the database).
"""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


_settings = get_settings()

# Pool sizing arguments are PostgreSQL-specific; SQLite rejects them and is
# only used for unit tests. Branch on the dialect so tests can run without a
# live database while production keeps a real connection pool.
_is_sqlite = _settings.database_url.startswith("sqlite")

_engine_kwargs: dict = {"pool_pre_ping": True, "echo": False}
if _is_sqlite:
    # TestClient runs sync endpoints in a worker threadpool, so an in-memory
    # SQLite database must be shared across threads via StaticPool.
    from sqlalchemy.pool import StaticPool

    _engine_kwargs.update(
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
else:
    _engine_kwargs.update(pool_size=5, max_overflow=10)

engine = create_engine(_settings.database_url, **_engine_kwargs)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create tables and apply additive compatibility migrations."""
    get_settings().ensure_runtime_dirs()
    from app import models  # noqa: F401
    from app import auth_models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    # create_all does not alter an existing table. The default preserves all
    # jobs created before mode selection; they always used the AI path.
    if engine.dialect.name == "postgresql":
        with engine.begin() as conn:
            conn.execute(text(
                "ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS "
                "mode VARCHAR(16) NOT NULL DEFAULT 'ADVANCED'"
            ))
            conn.execute(text(
                "ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS "
                "experience_id VARCHAR(128)"
            ))
            # Existing seeded experiences intentionally become drafts on the
            # first rollout. Admin must explicitly publish customer presets.
            conn.execute(text(
                "ALTER TABLE admin_experiences ADD COLUMN IF NOT EXISTS "
                "status VARCHAR(16) NOT NULL DEFAULT 'draft'"
            ))
            conn.execute(text(
                "ALTER TABLE admin_experiences ADD COLUMN IF NOT EXISTS "
                "category VARCHAR(64) NOT NULL DEFAULT 'Design'"
            ))
            conn.execute(text(
                "ALTER TABLE admin_experiences ADD COLUMN IF NOT EXISTS "
                "preview_status VARCHAR(16) NOT NULL DEFAULT 'MISSING'"
            ))
            conn.execute(text(
                "ALTER TABLE admin_experiences ADD COLUMN IF NOT EXISTS preview_error TEXT"
            ))
            conn.execute(text(
                "UPDATE admin_experiences SET preview_status = 'READY' "
                "WHERE thumbnail_path IS NOT NULL AND preview_status = 'MISSING'"
            ))
            conn.execute(text("ALTER TABLE uploads ADD COLUMN IF NOT EXISTS account_id VARCHAR(32)"))
            conn.execute(text("ALTER TABLE uploads ADD COLUMN IF NOT EXISTS guest_id VARCHAR(64)"))
            conn.execute(text("ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS account_id VARCHAR(32)"))
            conn.execute(text("ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS guest_id VARCHAR(64)"))
            conn.execute(text("ALTER TABLE admin_templates ADD COLUMN IF NOT EXISTS marketing_preview_path VARCHAR(512)"))
            for statement in (
                "ALTER TABLE generation_provider_runs ADD COLUMN IF NOT EXISTS requested_model VARCHAR(128)",
                "ALTER TABLE generation_provider_runs ADD COLUMN IF NOT EXISTS provider_reported_model VARCHAR(128)",
                "ALTER TABLE generation_provider_runs ADD COLUMN IF NOT EXISTS router_request_id VARCHAR(255)",
                "ALTER TABLE generation_provider_runs ADD COLUMN IF NOT EXISTS upstream_request_id VARCHAR(255)",
                "ALTER TABLE generation_provider_runs ADD COLUMN IF NOT EXISTS routing_strategy VARCHAR(255)",
                "ALTER TABLE generation_provider_runs ADD COLUMN IF NOT EXISTS usage_available BOOLEAN",
                "ALTER TABLE generation_provider_runs ADD COLUMN IF NOT EXISTS input_tokens INTEGER",
                "ALTER TABLE generation_provider_runs ADD COLUMN IF NOT EXISTS output_tokens INTEGER",
                "ALTER TABLE generation_provider_runs ADD COLUMN IF NOT EXISTS provider_reported_cost DOUBLE PRECISION",
                "ALTER TABLE generation_provider_runs ADD COLUMN IF NOT EXISTS attempt_count INTEGER",
                "ALTER TABLE generation_provider_runs ADD COLUMN IF NOT EXISTS failover_count INTEGER",
                "ALTER TABLE generation_provider_runs ADD COLUMN IF NOT EXISTS router_duration_ms INTEGER",
                "ALTER TABLE generation_provider_runs ADD COLUMN IF NOT EXISTS application_duration_ms INTEGER",
            ):
                conn.execute(text(statement))
    elif engine.dialect.name == "sqlite":
        columns = {column["name"] for column in inspect(engine).get_columns("generation_jobs")}
        with engine.begin() as conn:
            if "mode" not in columns:
                conn.execute(text(
                    "ALTER TABLE generation_jobs ADD COLUMN mode VARCHAR(16) "
                    "NOT NULL DEFAULT 'ADVANCED'"
                ))
            if "experience_id" not in columns:
                conn.execute(text(
                    "ALTER TABLE generation_jobs ADD COLUMN experience_id VARCHAR(128)"
                ))
        columns = {column["name"] for column in inspect(engine).get_columns("admin_experiences")}
        with engine.begin() as conn:
            if "status" not in columns:
                conn.execute(text(
                    "ALTER TABLE admin_experiences ADD COLUMN status VARCHAR(16) "
                    "NOT NULL DEFAULT 'draft'"
                ))
            if "category" not in columns:
                conn.execute(text(
                    "ALTER TABLE admin_experiences ADD COLUMN category VARCHAR(64) "
                    "NOT NULL DEFAULT 'Design'"
                ))
            if "preview_status" not in columns:
                conn.execute(text(
                    "ALTER TABLE admin_experiences ADD COLUMN preview_status VARCHAR(16) "
                    "NOT NULL DEFAULT 'MISSING'"
                ))
            if "preview_error" not in columns:
                conn.execute(text("ALTER TABLE admin_experiences ADD COLUMN preview_error TEXT"))
            conn.execute(text(
                "UPDATE admin_experiences SET preview_status = 'READY' "
                "WHERE thumbnail_path IS NOT NULL AND preview_status = 'MISSING'"
            ))
    # SQLite test databases may predate the ownership columns.
    if engine.dialect.name == "sqlite":
        columns = {column["name"] for column in inspect(engine).get_columns("uploads")}
        with engine.begin() as conn:
            if "account_id" not in columns:
                conn.execute(text("ALTER TABLE uploads ADD COLUMN account_id VARCHAR(32)"))
            if "guest_id" not in columns:
                conn.execute(text("ALTER TABLE uploads ADD COLUMN guest_id VARCHAR(64)"))
        columns = {column["name"] for column in inspect(engine).get_columns("generation_jobs")}
        with engine.begin() as conn:
            if "account_id" not in columns:
                conn.execute(text("ALTER TABLE generation_jobs ADD COLUMN account_id VARCHAR(32)"))
            if "guest_id" not in columns:
                conn.execute(text("ALTER TABLE generation_jobs ADD COLUMN guest_id VARCHAR(64)"))
        provider_columns = {column["name"] for column in inspect(engine).get_columns("generation_provider_runs")}
        provider_additions = {
            "requested_model": "VARCHAR(128)",
            "provider_reported_model": "VARCHAR(128)",
            "router_request_id": "VARCHAR(255)",
            "upstream_request_id": "VARCHAR(255)",
            "routing_strategy": "VARCHAR(255)",
            "usage_available": "BOOLEAN",
            "input_tokens": "INTEGER",
            "output_tokens": "INTEGER",
            "provider_reported_cost": "FLOAT",
            "attempt_count": "INTEGER",
            "failover_count": "INTEGER",
            "router_duration_ms": "INTEGER",
            "application_duration_ms": "INTEGER",
        }
        with engine.begin() as conn:
            for name, column_type in provider_additions.items():
                if name not in provider_columns:
                    conn.execute(text(
                        f"ALTER TABLE generation_provider_runs ADD COLUMN {name} {column_type}"
                    ))
    from app.catalog import seed_catalog
    with SessionLocal() as session:
        seed_catalog(session)
