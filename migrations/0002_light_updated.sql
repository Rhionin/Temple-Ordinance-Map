-- created stays the light's identity. updated moves when another ordinance
-- is merged onto that person, so the TV can refresh the caption once.
ALTER TABLE lights ADD COLUMN updated INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS lights_updated ON lights (updated);
