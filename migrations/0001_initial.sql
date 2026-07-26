PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('BS', 'KTV')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(name, type)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'bs', 'ktv', 'tkyk')),
  staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS schedule_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  section TEXT NOT NULL CHECK (section IN ('I', 'II', 'III')),
  label TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('duty_common', 'duty_bs', 'duty_ktv', 'leave', 'work_bs', 'work_ktv')),
  max_per_day INTEGER,
  sort_order INTEGER NOT NULL,
  computed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS schedule_assignments (
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

CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'cancelled')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS leave_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  staff_type TEXT NOT NULL CHECK (staff_type IN ('BS', 'KTV')),
  UNIQUE(staff_id, date)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  summary TEXT NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_assignments_date ON schedule_assignments(date);
CREATE INDEX IF NOT EXISTS idx_assignments_unit_date ON schedule_assignments(unit_id, date);
CREATE INDEX IF NOT EXISTS idx_leave_days_date_type ON leave_days(date, staff_type);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

INSERT OR IGNORE INTO schedule_units (code, section, label, type, max_per_day, sort_order, computed) VALUES
('duty_common', 'I', 'LỊCH TRỰC CHUNG', 'duty_common', NULL, 10, 1),
('duty_bs', 'I', 'LỊCH TRỰC BÁC SĨ', 'duty_bs', 1, 20, 0),
('duty_ktv', 'I', 'LỊCH TRỰC KỸ THUẬT VIÊN', 'duty_ktv', 2, 30, 0),
('leave', 'I', 'NGHỈ PHÉP', 'leave', NULL, 40, 1),
('xq1', 'II', 'X QUANG 1', 'work_bs', NULL, 110, 0),
('xq2', 'II', 'X QUANG 2', 'work_bs', NULL, 120, 0),
('ct64_128', 'II', 'CT 64+128', 'work_bs', NULL, 130, 0),
('ct512', 'II', 'CT 512', 'work_bs', NULL, 140, 0),
('mri1', 'II', 'MRI 1', 'work_bs', NULL, 150, 0),
('mri2', 'II', 'MRI 2', 'work_bs', NULL, 160, 0),
('xqdv', 'II', 'X QUANG DV', 'work_bs', NULL, 170, 0),
('ktv_mri', 'III', 'PHÒNG MRI 1', 'work_ktv', NULL, 210, 0),
('ktv_tai_giuong', 'III', 'TẠI GIƯỜNG', 'work_ktv', NULL, 220, 0),
('ktv_ct1', 'III', 'PHÒNG CT 1', 'work_ktv', NULL, 230, 0),
('ktv_ct2', 'III', 'PHÒNG CT 2', 'work_ktv', NULL, 240, 0),
('ktv_thay1', 'III', 'THAY RA TRỰC 1', 'work_ktv', NULL, 250, 0),
('ktv_thay2', 'III', 'THAY RA TRỰC 2', 'work_ktv', NULL, 260, 0),
('ktv_rang', 'III', 'RĂNG KTC', 'work_ktv', NULL, 270, 0),
('ktv_phong4', 'III', 'PHÒNG 4', 'work_ktv', NULL, 280, 0),
('ktv_mri2', 'III', 'PHÒNG MRI 2', 'work_ktv', NULL, 290, 0),
('ktv_phong3', 'III', 'PHÒNG 3', 'work_ktv', NULL, 300, 0),
('ktv_lx_nhu_anh_tiep_nhan', 'III', 'PHÒNG LX + X-QUANG NHŨ ẢNH', 'work_ktv', NULL, 310, 0),
('ktv_nhu_anh', 'III', 'X-QUANG NHŨ ẢNH', 'work_ktv', NULL, 320, 0),
('ktv_xqdv', 'III', 'PHÒNG X-QUANG DỊCH VỤ', 'work_ktv', NULL, 330, 0),
('ktv_ct3_nhu_anh', 'III', 'PHÒNG CT 3', 'work_ktv', NULL, 340, 0),
('ktv_dsa_carm', 'III', 'DSA & C-ARM', 'work_ktv', NULL, 350, 0),
('ktv_huong_dan', 'III', 'TIẾP NHẬN & HƯỚNG DẪN BN CHỤP X-QUANG TẠI KHOA', 'work_ktv', NULL, 360, 0),
('ktv_huong_dan_mri_ct', 'III', 'TIẾP NHẬN & HƯỚNG DẪN BN CHỤP MRI & CT', 'work_ktv', NULL, 370, 0);
