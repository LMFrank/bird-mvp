CREATE TABLE IF NOT EXISTS photos_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id INTEGER NOT NULL,
  abs_path TEXT NOT NULL,
  rel_path TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  taken_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO photos_new(
  id, library_id, abs_path, rel_path, fingerprint, size, mtime_ms, width, height, taken_at, created_at, updated_at
)
SELECT
  id, library_id, abs_path, rel_path, fingerprint, size, mtime_ms, width, height, taken_at, created_at, updated_at
FROM photos;

DROP TABLE photos;
ALTER TABLE photos_new RENAME TO photos;

CREATE INDEX IF NOT EXISTS idx_photos_library_id ON photos(library_id);
CREATE INDEX IF NOT EXISTS idx_photos_mtime ON photos(mtime_ms);
CREATE INDEX IF NOT EXISTS idx_photos_rel_path ON photos(rel_path);
CREATE UNIQUE INDEX IF NOT EXISTS idx_photos_library_fingerprint ON photos(library_id, fingerprint);
