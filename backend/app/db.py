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
    """Create tables and add the single mode column to existing installations."""
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    # create_all does not alter an existing table. The default preserves all
    # jobs created before mode selection; they always used the AI path.
    if engine.dialect.name == "postgresql":
        with engine.begin() as conn:
            conn.execute(text(
                "ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS "
                "mode VARCHAR(16) NOT NULL DEFAULT 'ADVANCED'"
            ))
    elif engine.dialect.name == "sqlite":
        if "mode" not in {column["name"] for column in inspect(engine).get_columns("generation_jobs")}:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE generation_jobs ADD COLUMN mode VARCHAR(16) "
                    "NOT NULL DEFAULT 'ADVANCED'"
                ))
