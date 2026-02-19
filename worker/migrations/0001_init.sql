CREATE TABLE IF NOT EXISTS analytics_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  payload TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_created_at
ON analytics_snapshots(created_at DESC);
