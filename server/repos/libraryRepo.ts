import type { DatabaseSync } from 'node:sqlite'

export function listLibraries(db: DatabaseSync) {
  return db.prepare('SELECT id, root_path, created_at FROM libraries ORDER BY id DESC').all()
}

export function insertLibraryIgnore(db: DatabaseSync, rootPath: string, createdAt: string) {
  return db.prepare('INSERT OR IGNORE INTO libraries(root_path, created_at) VALUES (?, ?)').run(rootPath, createdAt)
}

export function getLibraryByRootPath(db: DatabaseSync, rootPath: string) {
  return db.prepare('SELECT id, root_path, created_at FROM libraries WHERE root_path = ?').get(rootPath)
}

export function getLibraryById(db: DatabaseSync, id: number) {
  return db.prepare('SELECT id, root_path FROM libraries WHERE id = ?').get(id) as
    | { id: number; root_path: string }
    | undefined
}

export function prepareUpsertPhoto(db: DatabaseSync) {
  return db.prepare(`
    INSERT INTO photos(
      library_id, abs_path, rel_path, fingerprint, size, mtime_ms, width, height, taken_at, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?
    )
    ON CONFLICT(fingerprint) DO UPDATE SET
      abs_path = excluded.abs_path,
      rel_path = excluded.rel_path,
      library_id = excluded.library_id,
      size = excluded.size,
      mtime_ms = excluded.mtime_ms,
      updated_at = excluded.updated_at
  `)
}

export function prepareSelectPhotoIdByFingerprint(db: DatabaseSync) {
  return db.prepare('SELECT id FROM photos WHERE fingerprint = ?')
}

export function deleteLibraryAi(db: DatabaseSync, libraryId: number) {
  db.prepare(
    `
    DELETE FROM photo_ai_predictions
    WHERE photo_id IN (SELECT id FROM photos WHERE library_id = ?)
    `,
  ).run(libraryId)
  db.prepare(
    `
    DELETE FROM photo_ai
    WHERE photo_id IN (SELECT id FROM photos WHERE library_id = ?)
    `,
  ).run(libraryId)
}
