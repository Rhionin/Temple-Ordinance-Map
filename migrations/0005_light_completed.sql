-- Completion day (YYYY-MM-DD) for the earliest past-year ordinance.
-- A row saved before this column existed has neither month nor completed.
-- Re-uploading the same CSV fills both. This update only copies a day that
-- is already stored, and it does not change updated, so a second run is a no-op.
ALTER TABLE lights ADD COLUMN completed TEXT;
ALTER TABLE jobs ADD COLUMN completed TEXT;

UPDATE lights
SET month = substr(completed, 1, 7)
WHERE (month IS NULL OR month = '')
  AND completed GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  AND substr(completed, 6, 2) IN ('01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12')
  AND CAST(substr(completed, 9, 2) AS INTEGER) BETWEEN 1 AND 31;

UPDATE jobs
SET month = substr(completed, 1, 7)
WHERE (month IS NULL OR month = '')
  AND completed GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  AND substr(completed, 6, 2) IN ('01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12')
  AND CAST(substr(completed, 9, 2) AS INTEGER) BETWEEN 1 AND 31;
