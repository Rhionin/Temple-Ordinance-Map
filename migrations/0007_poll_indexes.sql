-- Narrow index scans for group-scoped reads and incremental timestamps.
CREATE INDEX IF NOT EXISTS lights_group_created ON lights (group_id, created);
CREATE INDEX IF NOT EXISTS lights_group_updated ON lights (group_id, updated);
CREATE INDEX IF NOT EXISTS jobs_group_status ON jobs (group_id, status);
CREATE INDEX IF NOT EXISTS sharers_group ON sharers (group_id);
