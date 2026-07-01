CREATE TABLE IF NOT EXISTS sync_records (
  kind TEXT NOT NULL CHECK (kind IN ('entry', 'profile')),
  id TEXT NOT NULL,
  payload TEXT,
  version TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  PRIMARY KEY (kind, id)
);

CREATE INDEX IF NOT EXISTS sync_records_version_idx ON sync_records(version);
