ALTER TABLE libraries ADD COLUMN region_code TEXT NOT NULL DEFAULT 'CN';

ALTER TABLE photo_ai ADD COLUMN pipeline_fingerprint TEXT;
ALTER TABLE photo_ai ADD COLUMN decision TEXT NOT NULL DEFAULT 'review';

CREATE TABLE IF NOT EXISTS photo_species_confirmations (
  photo_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('confirmed', 'rejected', 'unknown')),
  name_zh TEXT,
  name_scientific TEXT,
  source TEXT NOT NULL DEFAULT 'human',
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_species_confirmations_scientific
ON photo_species_confirmations(status, name_scientific);
