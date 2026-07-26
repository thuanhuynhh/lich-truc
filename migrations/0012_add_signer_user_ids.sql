ALTER TABLE duty_reports ADD COLUMN signature_bs_user_id INTEGER REFERENCES users(id);
ALTER TABLE duty_reports ADD COLUMN signature_ktv_user_id INTEGER REFERENCES users(id);
ALTER TABLE duty_reports ADD COLUMN signature_lanhdao_user_id INTEGER REFERENCES users(id);
