ALTER TABLE photo_species_confirmations
ADD COLUMN subject_type TEXT NOT NULL DEFAULT 'unknown'
CHECK(subject_type IN ('bird', 'non_bird', 'unknown'));

ALTER TABLE photo_species_confirmations
ADD COLUMN scene TEXT NOT NULL DEFAULT 'unknown'
CHECK(scene IN ('wild', 'captive', 'unknown'));

ALTER TABLE photo_species_confirmations
ADD COLUMN source_photo_id INTEGER;

UPDATE photo_species_confirmations
SET subject_type='bird'
WHERE status='confirmed';

CREATE TABLE IF NOT EXISTS photo_sequence_embeddings (
  photo_id INTEGER PRIMARY KEY,
  model TEXT NOT NULL,
  embedding_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(photo_id) REFERENCES photos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS photo_sequences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id INTEGER NOT NULL,
  representative_photo_id INTEGER,
  pipeline_fingerprint TEXT NOT NULL,
  fused_result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(library_id) REFERENCES libraries(id) ON DELETE CASCADE,
  FOREIGN KEY(representative_photo_id) REFERENCES photos(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS photo_sequence_members (
  sequence_id INTEGER NOT NULL,
  photo_id INTEGER NOT NULL UNIQUE,
  subject_weight REAL NOT NULL DEFAULT 1,
  PRIMARY KEY(sequence_id, photo_id),
  FOREIGN KEY(sequence_id) REFERENCES photo_sequences(id) ON DELETE CASCADE,
  FOREIGN KEY(photo_id) REFERENCES photos(id) ON DELETE CASCADE
);
