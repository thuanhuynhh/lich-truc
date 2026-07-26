CREATE TABLE IF NOT EXISTS unit_rotations (
  unit_id INTEGER PRIMARY KEY REFERENCES schedule_units(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS unit_rotation_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL REFERENCES schedule_units(id) ON DELETE CASCADE,
  turn_index INTEGER NOT NULL,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  member_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(unit_id, turn_index, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_rotation_members_unit ON unit_rotation_members(unit_id, turn_index, member_order);
