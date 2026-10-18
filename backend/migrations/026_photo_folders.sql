-- Prepared only. Manual application requires owner approval and verified backup.
-- Requires existing accounts/generation_jobs/results and subscription v2 (024).
BEGIN;
CREATE TABLE IF NOT EXISTS photo_folders (
 id varchar(32) PRIMARY KEY,
 account_id varchar(32) NOT NULL REFERENCES accounts(id),
 name varchar(80) NOT NULL,
 name_key varchar(240) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz,
 UNIQUE(id,account_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS photo_folders_active_name ON photo_folders(account_id,name_key) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS photo_folder_preferences (
 account_id varchar(32) PRIMARY KEY REFERENCES accounts(id),
 default_folder_id varchar(32),
 FOREIGN KEY(default_folder_id,account_id) REFERENCES photo_folders(id,account_id)
);
CREATE TABLE IF NOT EXISTS generation_folder_destinations (
 job_id varchar(32) PRIMARY KEY REFERENCES generation_jobs(id),
 account_id varchar(32) NOT NULL REFERENCES accounts(id),
 folder_id varchar(32),
 FOREIGN KEY(folder_id,account_id) REFERENCES photo_folders(id,account_id)
);
CREATE INDEX IF NOT EXISTS generation_folder_destinations_folder ON generation_folder_destinations(folder_id);
CREATE TABLE IF NOT EXISTS photo_folder_results (
 result_id varchar(32) PRIMARY KEY REFERENCES results(id),
 account_id varchar(32) NOT NULL REFERENCES accounts(id),
 folder_id varchar(32),
 FOREIGN KEY(folder_id,account_id) REFERENCES photo_folders(id,account_id)
);
CREATE INDEX IF NOT EXISTS photo_folder_results_folder ON photo_folder_results(account_id,folder_id);
CREATE TABLE IF NOT EXISTS photo_folder_shares (
 id varchar(32) PRIMARY KEY,
 account_id varchar(32) NOT NULL REFERENCES accounts(id),
 folder_id varchar(32) NOT NULL,
 token_hash varchar(64) NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(folder_id,account_id) REFERENCES photo_folders(id,account_id),
 CHECK(expires_at>created_at)
);
CREATE INDEX IF NOT EXISTS photo_folder_shares_folder ON photo_folder_shares(account_id,folder_id);
COMMIT;
