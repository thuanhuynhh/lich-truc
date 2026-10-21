ALTER TABLE staff ADD COLUMN leave_balance INTEGER CHECK (leave_balance >= 0);
ALTER TABLE staff ADD COLUMN leave_balance_from TEXT;
