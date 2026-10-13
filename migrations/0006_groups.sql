-- Fresh group schema. Live lights, jobs, and sharers are throwaway test rows.
-- This migration drops them and does not copy them.
CREATE TABLE groups (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  subtitle TEXT NOT NULL DEFAULT '',
  months INTEGER NOT NULL DEFAULT 12,
  uploads_open TEXT,
  uploads_close TEXT,
  admin_token_hash TEXT NOT NULL DEFAULT '',
  disabled INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL
);

CREATE TABLE lights_v2 (
  group_id INTEGER NOT NULL,
  person_id TEXT NOT NULL,
  place TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  ordinance TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  updated INTEGER,
  month TEXT,
  country TEXT,
  completed TEXT,
  PRIMARY KEY (group_id, person_id)
);

DROP TABLE lights;
ALTER TABLE lights_v2 RENAME TO lights;
CREATE INDEX lights_created ON lights (created);

CREATE TABLE jobs_v2 (
  group_id INTEGER NOT NULL,
  person_id TEXT NOT NULL,
  place TEXT NOT NULL,
  ordinance TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  cursor_idx INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  month TEXT,
  completed TEXT,
  PRIMARY KEY (group_id, person_id)
);

DROP TABLE jobs;
ALTER TABLE jobs_v2 RENAME TO jobs;
CREATE INDEX jobs_pending ON jobs (status, created);

CREATE TABLE sharers_v2 (
  group_id INTEGER NOT NULL,
  id_hash TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (group_id, id_hash)
);

DROP TABLE sharers;
ALTER TABLE sharers_v2 RENAME TO sharers;
