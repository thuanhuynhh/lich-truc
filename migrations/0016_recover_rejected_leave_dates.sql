UPDATE leave_requests AS lr
SET requested_dates = (
  SELECT REPLACE(
    SUBSTR(al.summary, LENGTH('Đăng ký nghỉ phép (chờ duyệt) ') + LENGTH(s.name) + 3),
    ', ',
    ','
  )
  FROM audit_logs al
  JOIN staff s ON s.id = lr.staff_id
  WHERE al.entity_type = 'leave'
    AND al.action = 'create'
    AND al.entity_id = lr.id
    AND al.summary LIKE 'Đăng ký nghỉ phép (chờ duyệt) %'
  ORDER BY al.id ASC
  LIMIT 1
)
WHERE lr.requested_dates IS NULL
  AND EXISTS (
    SELECT 1 FROM audit_logs rejected
    WHERE rejected.entity_type = 'leave'
      AND rejected.action = 'reject'
      AND rejected.entity_id = lr.id
  );

UPDATE leave_requests AS lr
SET decision = 'rejected',
    decided_at = COALESCE((
      SELECT MAX(rejected.created_at)
      FROM audit_logs rejected
      WHERE rejected.entity_type = 'leave'
        AND rejected.action = 'reject'
        AND rejected.entity_id = lr.id
    ), lr.updated_at),
    decided_by = (
      SELECT rejected.actor_user_id
      FROM audit_logs rejected
      WHERE rejected.entity_type = 'leave'
        AND rejected.action = 'reject'
        AND rejected.entity_id = lr.id
      ORDER BY rejected.id DESC
      LIMIT 1
    )
WHERE EXISTS (
  SELECT 1 FROM audit_logs rejected
  WHERE rejected.entity_type = 'leave'
    AND rejected.action = 'reject'
    AND rejected.entity_id = lr.id
);
