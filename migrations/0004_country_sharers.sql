-- Country code on each light, and on the place cache so a later hit keeps
-- the code Nominatim returned. Sharers stores a hash only.
ALTER TABLE lights ADD COLUMN country TEXT;
ALTER TABLE geocache ADD COLUMN country TEXT;

CREATE TABLE IF NOT EXISTS sharers (
  id_hash TEXT PRIMARY KEY,
  created INTEGER NOT NULL
);
