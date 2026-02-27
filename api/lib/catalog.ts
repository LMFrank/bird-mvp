import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type LibraryRow = {
  id: number
  root_path: string
  created_at: string
}

export type PhotoRow = {
  id: number
  library_id: number
  abs_path: string
  rel_path: string
  fingerprint: string
  size: number
  mtime_ms: number
  width: number | null
  height: number | null
  taken_at: string | null
  created_at: string
  updated_at: string
}

export type PhotoMetaRow = {
  photo_id: number
  rating: number
  status: 'none' | 'keep' | 'reject'
  color: string
  updated_at: string
}

type InitOptions = {
  cacheDir: string
}

let db: DatabaseSync | null = null

export function initCatalog({ cacheDir }: InitOptions) {
  fs.mkdirSync(cacheDir, { recursive: true })
  const dbPath = path.join(cacheDir, 'catalog.sqlite')
  db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA synchronous = NORMAL;')
  db.exec(`
    CREATE TABLE IF NOT EXISTS libraries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      root_path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
  `)
  db.exec(`
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
  `)
  db.exec('CREATE INDEX IF NOT EXISTS idx_photos_library_id ON photos(library_id);')
  db.exec('CREATE INDEX IF NOT EXISTS idx_photos_mtime ON photos(mtime_ms);')
  db.exec('CREATE INDEX IF NOT EXISTS idx_photos_rel_path ON photos(rel_path);')

  db.exec(`
    CREATE TABLE IF NOT EXISTS photo_meta (
      photo_id INTEGER PRIMARY KEY,
      rating INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'none',
      color TEXT NOT NULL DEFAULT 'none',
      updated_at TEXT NOT NULL
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS photo_tags (
      photo_id INTEGER NOT NULL,
      tag TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(photo_id, tag)
    );
  `)
  db.exec('CREATE INDEX IF NOT EXISTS idx_photo_tags_tag ON photo_tags(tag);')

  db.exec(`
    CREATE TABLE IF NOT EXISTS photo_ai (
      photo_id INTEGER PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      result_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS photo_ai_predictions (
      photo_id INTEGER NOT NULL,
      rank INTEGER NOT NULL,
      name_zh TEXT,
      name_scientific TEXT,
      score REAL NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(photo_id, rank)
    );
  `)
  db.exec('CREATE INDEX IF NOT EXISTS idx_ai_pred_top1_zh ON photo_ai_predictions(rank, name_zh);')
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_ai_pred_top1_sci ON photo_ai_predictions(rank, name_scientific);',
  )
  db.exec('CREATE INDEX IF NOT EXISTS idx_ai_pred_photo ON photo_ai_predictions(photo_id);')
}

export function getDb() {
  if (!db) throw new Error('Catalog DB not initialized')
  return db
}

export function nowIso() {
  return new Date().toISOString()
}

export function ensurePhotoMeta(photoId: number) {
  const d = getDb()
  const existing = d
    .prepare('SELECT photo_id FROM photo_meta WHERE photo_id = ?')
    .get(photoId) as { photo_id: number } | undefined
  if (existing) return
  d.prepare(
    "INSERT INTO photo_meta(photo_id, rating, status, color, updated_at) VALUES (?, 0, 'none', 'none', ?)",
  ).run(photoId, nowIso())
}
