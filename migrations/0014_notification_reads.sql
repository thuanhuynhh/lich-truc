CREATE TABLE IF NOT EXISTS notification_reads (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_id TEXT NOT NULL,
  read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, notification_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_reads_user
ON notification_reads(user_id, read_at);
