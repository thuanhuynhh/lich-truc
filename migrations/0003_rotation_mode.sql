ALTER TABLE unit_rotations ADD COLUMN mode TEXT NOT NULL DEFAULT 'daily' CHECK (mode IN ('daily', 'weekly'));
