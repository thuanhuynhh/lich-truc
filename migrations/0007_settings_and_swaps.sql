PRAGMA foreign_keys = OFF;

-- Recreate leave_requests to allow 'pending' status
ALTER TABLE leave_requests RENAME TO leave_requests_old;

CREATE TABLE leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'cancelled', 'pending')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO leave_requests (id, staff_id, reason, status, created_by, created_at, updated_at)
SELECT id, staff_id, reason, status, created_by, created_at, updated_at
FROM leave_requests_old;

DROP TABLE leave_requests_old;

-- Create system_settings table
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Insert default settings
INSERT OR IGNORE INTO system_settings (key, value) VALUES
('approve_leave_bs', '0'),
('approve_leave_ktv', '0'),
('approve_swap', '0');

-- Create blocked_leave_days table
CREATE TABLE IF NOT EXISTS blocked_leave_days (
  date TEXT PRIMARY KEY
);

-- Create swap_requests table
CREATE TABLE IF NOT EXISTS swap_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  assignment_id_1 INTEGER NOT NULL,
  staff_id_1 INTEGER NOT NULL,
  unit_id_1 INTEGER NOT NULL,
  date_1 TEXT NOT NULL,
  slot_1 INTEGER NOT NULL,
  assignment_id_2 INTEGER NOT NULL,
  staff_id_2 INTEGER NOT NULL,
  unit_id_2 INTEGER NOT NULL,
  date_2 TEXT NOT NULL,
  slot_2 INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

PRAGMA foreign_keys = ON;
