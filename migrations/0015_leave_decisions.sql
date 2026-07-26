ALTER TABLE leave_requests ADD COLUMN requested_dates TEXT;
ALTER TABLE leave_requests ADD COLUMN decision TEXT CHECK (decision IN ('approved', 'rejected', 'cancelled'));
ALTER TABLE leave_requests ADD COLUMN decided_at TEXT;
ALTER TABLE leave_requests ADD COLUMN decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

UPDATE leave_requests
SET requested_dates = (
  SELECT GROUP_CONCAT(ld.date, ',')
  FROM leave_days ld
  WHERE ld.request_id = leave_requests.id
)
WHERE requested_dates IS NULL;

UPDATE leave_requests
SET decision = CASE
      WHEN status = 'approved' THEN 'approved'
      WHEN status = 'cancelled' THEN 'cancelled'
      ELSE NULL
    END,
    decided_at = CASE WHEN status <> 'pending' THEN updated_at ELSE NULL END
WHERE decision IS NULL;
