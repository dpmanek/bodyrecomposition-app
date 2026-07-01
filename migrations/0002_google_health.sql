CREATE TABLE IF NOT EXISTS google_health_connections (
  profile_id TEXT PRIMARY KEY,
  encrypted_refresh_token TEXT NOT NULL,
  granted_scopes TEXT NOT NULL,
  connected_at TEXT NOT NULL,
  last_synced_at TEXT
);

CREATE TABLE IF NOT EXISTS google_health_oauth_states (
  state_hash TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS google_health_oauth_states_expires_idx
  ON google_health_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS google_health_daily_summaries (
  profile_id TEXT NOT NULL,
  day TEXT NOT NULL,
  steps INTEGER,
  active_zone_minutes INTEGER,
  total_calories_kcal REAL,
  sleep_minutes INTEGER,
  resting_heart_rate_bpm INTEGER,
  hrv_ms REAL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, day)
);

CREATE INDEX IF NOT EXISTS google_health_daily_profile_day_idx
  ON google_health_daily_summaries(profile_id, day DESC);
