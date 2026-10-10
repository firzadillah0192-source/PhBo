-- Apply only to the Express API target, after the existing kiosk tables.
-- Metadata only. No secret or photo bytes are persisted in this table.
CREATE TABLE IF NOT EXISTS kiosk_transfer_requests (
  scope varchar(64) NOT NULL,
  request_key varchar(128) NOT NULL,
  kind varchar(16) NOT NULL CHECK (kind IN ('SESSION','UPLOAD')),
  request_hash varchar(64) NOT NULL,
  session_id varchar(64) NOT NULL REFERENCES kiosk_sessions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(scope,request_key,kind)
);
CREATE INDEX IF NOT EXISTS ix_kiosk_transfer_session ON kiosk_transfer_requests(session_id);
