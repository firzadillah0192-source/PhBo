-- Event configuration, Classic layout metadata, and server-owned Kiosk runs.
-- Apply after the existing application migrations (including 009 when QR is enabled).

CREATE TABLE IF NOT EXISTS classic_layouts (
    id VARCHAR(32) PRIMARY KEY,
    slug VARCHAR(128) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    canvas_width INTEGER NOT NULL,
    canvas_height INTEGER NOT NULL,
    shot_count INTEGER NOT NULL,
    layout_config_json TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_classic_layouts_dimensions CHECK (canvas_width > 0 AND canvas_height > 0),
    CONSTRAINT ck_classic_layouts_shot_count CHECK (shot_count > 0)
);

INSERT INTO classic_layouts
    (id, slug, name, canvas_width, canvas_height, shot_count, layout_config_json, active)
VALUES
    ('strip-4-vertical', 'strip-4-vertical', '4 Photo Vertical Strip', 600, 1800, 4,
     '{"fit":"cover","background":"#ffffff","slots":[{"x":40,"y":40,"width":520,"height":400},{"x":40,"y":480,"width":520,"height":400},{"x":40,"y":920,"width":520,"height":400},{"x":40,"y":1360,"width":520,"height":400}]}', TRUE)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS events (
    id VARCHAR(32) PRIMARY KEY,
    slug VARCHAR(128) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(16) NOT NULL DEFAULT 'draft',
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    logo_path VARCHAR(512),
    theme_config_json TEXT,
    classic_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    basic_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    advanced_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    classic_layout_id VARCHAR(32) REFERENCES classic_layouts(id) ON DELETE RESTRICT,
    classic_frame_path VARCHAR(512),
    classic_shot_count INTEGER NOT NULL DEFAULT 4,
    qr_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    print_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    result_timeout_seconds INTEGER NOT NULL DEFAULT 90,
    claim_ttl_hours INTEGER NOT NULL DEFAULT 24,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_events_classic_shot_count CHECK (classic_shot_count > 0),
    CONSTRAINT ck_events_timeout CHECK (result_timeout_seconds BETWEEN 15 AND 3600),
    CONSTRAINT ck_events_claim_ttl CHECK (claim_ttl_hours BETWEEN 1 AND 168)
);
CREATE INDEX IF NOT EXISTS ix_events_status ON events(status);

CREATE TABLE IF NOT EXISTS event_basic_templates (
    event_id VARCHAR(32) NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    template_id VARCHAR(128) NOT NULL REFERENCES admin_templates(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (event_id, template_id)
);
CREATE INDEX IF NOT EXISTS ix_event_basic_templates_order
    ON event_basic_templates(event_id, enabled, sort_order);

CREATE TABLE IF NOT EXISTS event_advanced_experiences (
    event_id VARCHAR(32) NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    experience_id VARCHAR(128) NOT NULL REFERENCES admin_experiences(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (event_id, experience_id)
);
CREATE INDEX IF NOT EXISTS ix_event_advanced_experiences_order
    ON event_advanced_experiences(event_id, enabled, sort_order);

CREATE TABLE IF NOT EXISTS kiosk_sessions (
    id VARCHAR(64) PRIMARY KEY,
    event_id VARCHAR(32) NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
    mode VARCHAR(16),
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_kiosk_sessions_event_status
    ON kiosk_sessions(event_id, status, last_activity_at);

ALTER TABLE uploads
    ADD COLUMN IF NOT EXISTS kiosk_session_id VARCHAR(64)
    REFERENCES kiosk_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_uploads_kiosk_session_id ON uploads(kiosk_session_id);

ALTER TABLE generation_jobs
    ADD COLUMN IF NOT EXISTS event_id VARCHAR(32) REFERENCES events(id) ON DELETE SET NULL;
ALTER TABLE generation_jobs
    ADD COLUMN IF NOT EXISTS kiosk_session_id VARCHAR(64)
    REFERENCES kiosk_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_generation_jobs_event_id ON generation_jobs(event_id);
CREATE INDEX IF NOT EXISTS ix_generation_jobs_kiosk_session_id ON generation_jobs(kiosk_session_id);
