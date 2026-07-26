PRAGMA foreign_keys = OFF;

ALTER TABLE user_sessions RENAME TO user_sessions_old;
ALTER TABLE schedule_assignments RENAME TO schedule_assignments_old;
ALTER TABLE leave_requests RENAME TO leave_requests_old;
ALTER TABLE leave_days RENAME TO leave_days_old;
ALTER TABLE audit_logs RENAME TO audit_logs_old;
ALTER TABLE unit_rotations RENAME TO unit_rotations_old;

CREATE TABLE user_sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE schedule_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL REFERENCES schedule_units(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL DEFAULT 0,
  confirmed INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(unit_id, date, slot),
  UNIQUE(unit_id, date, staff_id)
);

CREATE TABLE leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'cancelled')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE leave_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  staff_type TEXT NOT NULL CHECK (staff_type IN ('BS', 'KTV')),
  UNIQUE(staff_id, date)
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  summary TEXT NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE unit_rotations (
  unit_id INTEGER PRIMARY KEY REFERENCES schedule_units(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  mode TEXT NOT NULL DEFAULT 'daily' CHECK (mode IN ('daily', 'weekly'))
);

INSERT INTO user_sessions (id, user_id, expires_at, created_at)
SELECT id, user_id, expires_at, created_at FROM user_sessions_old;

INSERT INTO schedule_assignments (id, unit_id, date, staff_id, slot, confirmed, created_by, updated_by, created_at, updated_at)
SELECT id, unit_id, date, staff_id, slot, confirmed, created_by, updated_by, created_at, updated_at
FROM schedule_assignments_old;

INSERT INTO leave_requests (id, staff_id, reason, status, created_by, created_at, updated_at)
SELECT id, staff_id, reason, status, created_by, created_at, updated_at
FROM leave_requests_old;

INSERT INTO leave_days (id, request_id, staff_id, date, staff_type)
SELECT id, request_id, staff_id, date, staff_type
FROM leave_days_old;

INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, summary, payload, created_at)
SELECT id, actor_user_id, action, entity_type, entity_id, summary, payload, created_at
FROM audit_logs_old;

INSERT INTO unit_rotations (unit_id, start_date, enabled, updated_by, updated_at, mode)
SELECT unit_id, start_date, enabled, updated_by, updated_at, mode
FROM unit_rotations_old;

DROP TABLE user_sessions_old;
DROP TABLE schedule_assignments_old;
DROP TABLE leave_requests_old;
DROP TABLE leave_days_old;
DROP TABLE audit_logs_old;
DROP TABLE unit_rotations_old;

CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_assignments_date ON schedule_assignments(date);
CREATE INDEX IF NOT EXISTS idx_assignments_unit_date ON schedule_assignments(unit_id, date);
CREATE INDEX IF NOT EXISTS idx_leave_days_date_type ON leave_days(date, staff_type);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

PRAGMA foreign_keys = ON;
