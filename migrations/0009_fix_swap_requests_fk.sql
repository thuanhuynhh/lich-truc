PRAGMA foreign_keys = OFF;

CREATE TABLE swap_requests_new (
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

INSERT INTO swap_requests_new (
  id, token, assignment_id_1, staff_id_1, unit_id_1, date_1, slot_1,
  assignment_id_2, staff_id_2, unit_id_2, date_2, slot_2, status,
  created_by, created_at, updated_at
)
SELECT
  id, token, assignment_id_1, staff_id_1, unit_id_1, date_1, slot_1,
  assignment_id_2, staff_id_2, unit_id_2, date_2, slot_2, status,
  created_by, created_at, updated_at
FROM swap_requests;

DROP TABLE swap_requests;

ALTER TABLE swap_requests_new RENAME TO swap_requests;

PRAGMA foreign_keys = ON;
