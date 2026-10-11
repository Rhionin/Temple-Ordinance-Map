-- Lights and geocode queue. person_id is the FamilySearch id used only to
-- dedupe. Names are never stored.
CREATE TABLE IF NOT EXISTS lights (
  person_id TEXT PRIMARY KEY,
  place TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  ordinance TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS lights_created ON lights (created);

-- lat/lon NULL is a cached miss. A row means Nominatim was asked.
CREATE TABLE IF NOT EXISTS geocache (
  query TEXT PRIMARY KEY,
  lat REAL,
  lon REAL,
  cached_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  person_id TEXT PRIMARY KEY,
  place TEXT NOT NULL,
  ordinance TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  cursor_idx INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS jobs_pending ON jobs (status, created);
