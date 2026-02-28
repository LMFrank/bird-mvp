import fs from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

function nowIso() {
  return new Date().toISOString()
}

export function runMigrations(db: DatabaseSync, migrationsDir: string) {
  if (!fs.existsSync(migrationsDir)) throw new Error(`Migrations dir not found: ${migrationsDir}`)

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `)

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))

  const has = db.prepare('SELECT 1 as ok FROM schema_migrations WHERE id = ? LIMIT 1')
  const insert = db.prepare('INSERT INTO schema_migrations(id, applied_at) VALUES (?, ?)')

  for (const f of files) {
    const applied = has.get(f) as { ok: 1 } | undefined
    if (applied) continue

    const sqlPath = path.join(migrationsDir, f)
    const sql = fs.readFileSync(sqlPath, 'utf-8')
    if (!sql.trim()) {
      db.exec('BEGIN;')
      try {
        insert.run(f, nowIso())
        db.exec('COMMIT;')
      } catch (e) {
        db.exec('ROLLBACK;')
        throw e
      }
      continue
    }

    db.exec('BEGIN;')
    try {
      db.exec(sql)
      insert.run(f, nowIso())
      db.exec('COMMIT;')
    } catch (e) {
      db.exec('ROLLBACK;')
      throw e
    }
  }
}
