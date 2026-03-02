import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from './migrations.js'

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
  aesthetic_score?: number | null
  aesthetic_mtime_ms?: number | null
  aesthetic_updated_at?: string | null
}

type InitOptions = {
  cacheDir: string
  migrationsDir?: string
}

let db: DatabaseSync | null = null

export function initCatalog({ cacheDir, migrationsDir }: InitOptions) {
  fs.mkdirSync(cacheDir, { recursive: true })
  const dbPath = path.join(cacheDir, 'catalog.sqlite')
  db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA synchronous = NORMAL;')
  const dir =
    String(migrationsDir ?? '').trim() ||
    String(process.env.MIGRATIONS_DIR ?? '').trim() ||
    path.join(process.cwd(), 'server', 'migrations')
  runMigrations(db, dir)

  const hasJobs = db
    .prepare(`SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = 'jobs' LIMIT 1`)
    .get() as { ok: 1 } | undefined
  if (hasJobs) {
    db.prepare(
      `
      UPDATE jobs
      SET status = 'error', updated_at = ?
      WHERE status IN ('queued', 'running')
      `,
    ).run(nowIso())
  }
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
