-- Switch from username/password to Google sign-in with an allow list.
-- Safe to run only while no one has signed up yet (the old users table is empty).
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  picture TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member',
  added_by INTEGER,
  last_login TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
