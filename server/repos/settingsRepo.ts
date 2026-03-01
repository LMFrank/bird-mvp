import type { DatabaseSync } from 'node:sqlite'

export function hasSettingsTable(db: DatabaseSync): boolean {
  const row = db
    .prepare(`SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = 'app_settings' LIMIT 1`)
    .get() as { ok: 1 } | undefined
  return Boolean(row?.ok)
}

export function getSetting(db: DatabaseSync, key: string): string | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined
  return typeof row?.value === 'string' ? row.value : null
}

export function setSetting(db: DatabaseSync, key: string, value: string, now: string) {
  db.prepare(
    `
    INSERT INTO app_settings(key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
    `,
  ).run(key, value, now)
}

export function deleteSetting(db: DatabaseSync, key: string) {
  db.prepare('DELETE FROM app_settings WHERE key = ?').run(key)
}
