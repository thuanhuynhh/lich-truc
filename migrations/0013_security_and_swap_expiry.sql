ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;

ALTER TABLE swap_requests ADD COLUMN expires_at TEXT;

UPDATE swap_requests
SET expires_at = datetime(created_at, '+7 days')
WHERE expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_swap_requests_token_status
ON swap_requests(token, status, expires_at);

-- Snapshot legacy template-backed signatures before the Worker stops resolving
-- them dynamically from the mutable users table.
UPDATE duty_reports
SET signature_bs = (SELECT signature FROM users WHERE users.id = duty_reports.signature_bs_user_id)
WHERE signature_bs IS NULL AND signature_bs_user_id IS NOT NULL;

UPDATE duty_reports
SET signature_ktv = (SELECT signature FROM users WHERE users.id = duty_reports.signature_ktv_user_id)
WHERE signature_ktv IS NULL AND signature_ktv_user_id IS NOT NULL;

UPDATE duty_reports
SET signature_lanhdao = (SELECT signature FROM users WHERE users.id = duty_reports.signature_lanhdao_user_id)
WHERE signature_lanhdao IS NULL AND signature_lanhdao_user_id IS NOT NULL;

-- Revoke and disable the original seeded admin only when another admin exists.
-- Randomizing the stored verifier also protects the short interval before the
-- Worker version that understands `disabled` is deployed.
DELETE FROM user_sessions
WHERE user_id IN (
  SELECT seed.id
  FROM users seed
  WHERE lower(seed.username) = 'admin'
    AND seed.password_salt = 'lichtruc-dev-admin'
    AND EXISTS (
      SELECT 1
      FROM users other
      WHERE other.role = 'admin'
        AND other.disabled = 0
        AND other.id <> seed.id
    )
);

UPDATE users
SET disabled = 1,
    password_salt = lower(hex(randomblob(16))),
    password_hash = lower(hex(randomblob(32))),
    updated_at = CURRENT_TIMESTAMP
WHERE lower(username) = 'admin'
  AND password_salt = 'lichtruc-dev-admin'
  AND EXISTS (
    SELECT 1
    FROM users other
    WHERE other.role = 'admin'
      AND other.disabled = 0
      AND other.id <> users.id
  );
