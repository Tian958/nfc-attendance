CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  position TEXT DEFAULT '',
  tag TEXT NOT NULL UNIQUE,
  photo TEXT DEFAULT '',
  salary_type TEXT NOT NULL DEFAULT 'daily' CHECK (salary_type IN ('daily','weekly')),
  salary_rate REAL NOT NULL DEFAULT 0,
  work_days REAL NOT NULL DEFAULT 6,
  hours_day REAL NOT NULL DEFAULT 8,
  ot_rate REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position TEXT DEFAULT '',
  tag TEXT NOT NULL,
  time TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('IN','OUT')),
  photo TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attendance_person_time ON attendance(person_id, time);
CREATE INDEX IF NOT EXISTS idx_attendance_time ON attendance(time);
