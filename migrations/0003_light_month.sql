-- Earliest past-year ordinance month for each person (YYYY-MM).
-- Null when every date for that person failed to parse.
ALTER TABLE lights ADD COLUMN month TEXT;
ALTER TABLE jobs ADD COLUMN month TEXT;
