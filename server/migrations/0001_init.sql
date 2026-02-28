CREATE TABLE IF NOT EXISTS libraries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root_path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id INTEGER NOT NULL,
  abs_path TEXT NOT NULL,
  rel_path TEXT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  taken_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_photos_library_id ON photos(library_id);
CREATE INDEX IF NOT EXISTS idx_photos_mtime ON photos(mtime_ms);
CREATE INDEX IF NOT EXISTS idx_photos_rel_path ON photos(rel_path);

CREATE TABLE IF NOT EXISTS photo_meta (
  photo_id INTEGER PRIMARY KEY,
  rating INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'none',
  color TEXT NOT NULL DEFAULT 'none',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS photo_tags (
  photo_id INTEGER NOT NULL,
  tag TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(photo_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_photo_tags_tag ON photo_tags(tag);

CREATE TABLE IF NOT EXISTS photo_ai (
  photo_id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  result_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS photo_ai_predictions (
  photo_id INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  name_zh TEXT,
  name_scientific TEXT,
  score REAL NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(photo_id, rank)
);

CREATE INDEX IF NOT EXISTS idx_ai_pred_top1_zh ON photo_ai_predictions(rank, name_zh);
CREATE INDEX IF NOT EXISTS idx_ai_pred_top1_sci ON photo_ai_predictions(rank, name_scientific);
CREATE INDEX IF NOT EXISTS idx_ai_pred_photo ON photo_ai_predictions(photo_id);
