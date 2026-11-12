CREATE TABLE IF NOT EXISTS file_blobs (key TEXT PRIMARY KEY, data BLOB NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
