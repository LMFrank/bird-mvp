import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

export type PhotoStatusFilter = 'all' | 'none' | 'keep' | 'reject'
export type PhotoAiModeFilter = 'top1' | 'any'
export type PhotoSort = 'time' | 'recommend'

export type ListPhotosQuery = {
  libraryId: number
  status: PhotoStatusFilter
  ratingMin: number
  tag: string
  q: string
  aiZh: string
  aiMode: PhotoAiModeFilter
  aiMinScore: number
  sort: PhotoSort
  offset: number
  limit: number
}

function buildListPhotosWhere(q: ListPhotosQuery): { whereSql: string; params: SQLInputValue[] } {
  const where: string[] = ['p.library_id = ?']
  const params: SQLInputValue[] = [q.libraryId]

  if (q.status === 'keep' || q.status === 'reject' || q.status === 'none') {
    where.push('m.status = ?')
    params.push(q.status)
  }
  if (Number.isFinite(q.ratingMin) && q.ratingMin > 0) {
    where.push('m.rating >= ?')
    params.push(q.ratingMin)
  }
  if (q.q) {
    where.push('(p.rel_path LIKE ? OR p.abs_path LIKE ?)')
    params.push(`%${q.q}%`, `%${q.q}%`)
  }
  if (q.tag) {
    where.push('EXISTS (SELECT 1 FROM photo_tags t WHERE t.photo_id = p.id AND t.tag = ?)')
    params.push(q.tag)
  }
  if (q.aiZh) {
    const min = Number.isFinite(q.aiMinScore) ? q.aiMinScore : 0
    if (q.aiMode === 'any') {
      where.push(
        'EXISTS (SELECT 1 FROM photo_ai_predictions ap WHERE ap.photo_id = p.id AND ap.name_zh = ? AND ap.score >= ?)',
      )
      params.push(q.aiZh, min)
    } else {
      where.push(
        'EXISTS (SELECT 1 FROM photo_ai_predictions ap WHERE ap.photo_id = p.id AND ap.rank = 1 AND ap.name_zh = ? AND ap.score >= ?)',
      )
      params.push(q.aiZh, min)
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  return { whereSql, params }
}

export function countListPhotos(db: DatabaseSync, q: ListPhotosQuery): number {
  const { whereSql, params } = buildListPhotosWhere(q)
  const countRow = db
    .prepare(`SELECT COUNT(1) as c FROM photos p JOIN photo_meta m ON m.photo_id = p.id ${whereSql}`)
    .get(...params) as { c: number }
  return countRow?.c ?? 0
}

export function listPhotos(db: DatabaseSync, q: ListPhotosQuery) {
  const { whereSql, params } = buildListPhotosWhere(q)
  const orderBy =
    q.sort === 'recommend'
      ? 'ORDER BY COALESCE(m.aesthetic_score, 0) DESC, p.mtime_ms DESC'
      : 'ORDER BY p.mtime_ms DESC'
  return db
    .prepare(
      `
      SELECT
        p.id, p.rel_path, p.abs_path, p.mtime_ms, p.size,
        m.rating, m.status, m.color, m.updated_at,
        m.aesthetic_score, m.aesthetic_mtime_ms, m.aesthetic_updated_at,
        ap.name_zh as ai_name_zh, ap.name_scientific as ai_name_scientific, ap.score as ai_score
      FROM photos p
      JOIN photo_meta m ON m.photo_id = p.id
      LEFT JOIN photo_ai_predictions ap ON ap.photo_id = p.id AND ap.rank = 1
      ${whereSql}
      ${orderBy}
      LIMIT ? OFFSET ?
      `,
    )
    .all(...params, q.limit, q.offset)
}

export function getPhotoDetail(db: DatabaseSync, id: number) {
  return db
    .prepare(
      `
      SELECT
        p.id, p.library_id, p.abs_path, p.rel_path, p.fingerprint, p.mtime_ms, p.size,
        p.width, p.height, p.taken_at, p.latitude, p.longitude,
        m.rating, m.status, m.color, m.updated_at,
        m.aesthetic_score, m.aesthetic_mtime_ms, m.aesthetic_updated_at,
        (SELECT sm.sequence_id FROM photo_sequence_members sm WHERE sm.photo_id=p.id) as sequence_id
      FROM photos p
      JOIN photo_meta m ON m.photo_id = p.id
      WHERE p.id = ?
      `,
    )
    .get(id)
}

export function getPhotoAbsPath(db: DatabaseSync, id: number): string | null {
  const row = db.prepare('SELECT abs_path FROM photos WHERE id = ?').get(id) as
    | { abs_path: string }
    | undefined
  return row?.abs_path ?? null
}

export function listPhotoTags(db: DatabaseSync, id: number): string[] {
  return db
    .prepare('SELECT tag FROM photo_tags WHERE photo_id = ? ORDER BY tag ASC')
    .all(id)
    .map((r) => (r as { tag: string }).tag)
}

export function updatePhotoMeta(
  db: DatabaseSync,
  id: number,
  patch: { rating?: number; status?: 'none' | 'keep' | 'reject'; color?: string },
  now: string,
): boolean {
  const meta = db.prepare('SELECT photo_id FROM photo_meta WHERE photo_id = ?').get(id) as
    | { photo_id: number }
    | undefined
  if (!meta) return false

  const fields: string[] = []
  const params: SQLInputValue[] = []

  if (typeof patch.rating === 'number' && Number.isFinite(patch.rating) && patch.rating >= 0 && patch.rating <= 5) {
    fields.push('rating = ?')
    params.push(Math.trunc(patch.rating))
  }
  if (patch.status === 'none' || patch.status === 'keep' || patch.status === 'reject') {
    fields.push('status = ?')
    params.push(patch.status)
  }
  if (typeof patch.color === 'string' && patch.color.length <= 32) {
    fields.push('color = ?')
    params.push(patch.color)
  }

  if (!fields.length) return true

  fields.push('updated_at = ?')
  params.push(now)
  params.push(id)
  db.prepare(`UPDATE photo_meta SET ${fields.join(', ')} WHERE photo_id = ?`).run(...params)
  return true
}

export function updatePhotosMeta(
  db: DatabaseSync,
  ids: number[],
  patch: { rating?: number; status?: 'none' | 'keep' | 'reject'; color?: string },
  now: string,
): number {
  if (!ids.length) return 0

  const fields: string[] = []
  const params: SQLInputValue[] = []

  if (typeof patch.rating === 'number' && Number.isFinite(patch.rating) && patch.rating >= 0 && patch.rating <= 5) {
    fields.push('rating = ?')
    params.push(Math.trunc(patch.rating))
  }
  if (typeof patch.color === 'string' && patch.color.length <= 32) {
    fields.push('color = ?')
    params.push(patch.color)
  }
  if (patch.status === 'none' || patch.status === 'keep' || patch.status === 'reject') {
    fields.push('status = ?')
    params.push(patch.status)
  }

  if (!fields.length) return 0

  fields.push('updated_at = ?')
  params.push(now)

  params.push(...ids)
  const placeholders = ids.map(() => '?').join(', ')
  const result = db.prepare(`UPDATE photo_meta SET ${fields.join(', ')} WHERE photo_id IN (${placeholders})`).run(...params)
  return Number(result.changes ?? 0)
}

export function getPhotoAestheticMtimeMs(db: DatabaseSync, id: number): number | null {
  const row = db
    .prepare('SELECT aesthetic_mtime_ms as m FROM photo_meta WHERE photo_id = ?')
    .get(id) as { m: number | null } | undefined
  return typeof row?.m === 'number' && Number.isFinite(row.m) ? row.m : null
}

export function updatePhotoAestheticScore(
  db: DatabaseSync,
  id: number,
  patch: { score: number; mtimeMs: number; now: string },
) {
  const s = Number(patch.score)
  const m = Math.trunc(patch.mtimeMs)
  const now = String(patch.now)
  db.prepare(
    `
    UPDATE photo_meta
    SET aesthetic_score = ?, aesthetic_mtime_ms = ?, aesthetic_updated_at = ?
    WHERE photo_id = ?
    `,
  ).run(Number.isFinite(s) ? s : null, Number.isFinite(m) ? m : null, now, id)
}

export function getPhotoExifCache(db: DatabaseSync, id: number): { exifJson: string | null; exifMtimeMs: number | null } {
  try {
    const row = db
      .prepare('SELECT exif_json as j, exif_mtime_ms as m FROM photo_meta WHERE photo_id = ?')
      .get(id) as { j: string | null; m: number | null } | undefined
    const exifJson = typeof row?.j === 'string' ? row.j : null
    const exifMtimeMs = typeof row?.m === 'number' && Number.isFinite(row.m) ? row.m : null
    return { exifJson, exifMtimeMs }
  } catch {
    return { exifJson: null, exifMtimeMs: null }
  }
}

export function updatePhotoExifCache(
  db: DatabaseSync,
  id: number,
  patch: { exifJson: string; mtimeMs: number; now: string },
) {
  const m = Math.trunc(patch.mtimeMs)
  const now = String(patch.now)
  try {
    db.prepare(
      `
      UPDATE photo_meta
      SET exif_json = ?, exif_mtime_ms = ?, exif_updated_at = ?
      WHERE photo_id = ?
      `,
    ).run(String(patch.exifJson), Number.isFinite(m) ? m : null, now, id)
  } catch {
    void 0
  }
}

export function updatePhotoExifBasics(
  db: DatabaseSync,
  id: number,
  patch: {
    width?: number | null
    height?: number | null
    takenAt?: string | null
    latitude?: number | null
    longitude?: number | null
  },
) {
  const fields: string[] = []
  const params: SQLInputValue[] = []
  if (typeof patch.width === 'number' && Number.isFinite(patch.width) && patch.width > 0) {
    fields.push('width = ?')
    params.push(Math.trunc(patch.width))
  }
  if (typeof patch.height === 'number' && Number.isFinite(patch.height) && patch.height > 0) {
    fields.push('height = ?')
    params.push(Math.trunc(patch.height))
  }
  if (typeof patch.takenAt === 'string' && patch.takenAt.trim()) {
    fields.push('taken_at = ?')
    params.push(patch.takenAt.trim())
  }
  if (typeof patch.latitude === 'number' && Number.isFinite(patch.latitude) && patch.latitude >= -90 && patch.latitude <= 90) {
    fields.push('latitude = ?')
    params.push(patch.latitude)
  }
  if (typeof patch.longitude === 'number' && Number.isFinite(patch.longitude) && patch.longitude >= -180 && patch.longitude <= 180) {
    fields.push('longitude = ?')
    params.push(patch.longitude)
  }
  if (!fields.length) return
  params.push(id)
  db.prepare(`UPDATE photos SET ${fields.join(', ')} WHERE id = ?`).run(...params)
}

export function replacePhotoTags(db: DatabaseSync, id: number, tags: string[], now: string) {
  const del = db.prepare('DELETE FROM photo_tags WHERE photo_id = ?')
  del.run(id)
  const ins = db.prepare('INSERT OR IGNORE INTO photo_tags(photo_id, tag, created_at) VALUES (?, ?, ?)')
  for (const t of tags) {
    ins.run(id, t, now)
  }
}

export function deletePhotoAi(db: DatabaseSync, id: number) {
  db.prepare('DELETE FROM photo_ai WHERE photo_id = ?').run(id)
  db.prepare('DELETE FROM photo_ai_predictions WHERE photo_id = ?').run(id)
  // Clear aesthetic score as well
  db.prepare('UPDATE photo_meta SET aesthetic_score = NULL, aesthetic_mtime_ms = NULL, aesthetic_updated_at = NULL WHERE photo_id = ?').run(id)
}

export function clearLibraryAi(db: DatabaseSync, libraryId: number) {
  // Clear photo_ai
  db.prepare('DELETE FROM photo_ai WHERE photo_id IN (SELECT id FROM photos WHERE library_id = ?)').run(libraryId)
  // Clear photo_ai_predictions
  db.prepare('DELETE FROM photo_ai_predictions WHERE photo_id IN (SELECT id FROM photos WHERE library_id = ?)').run(libraryId)
  // Clear aesthetic scores in photo_meta
  db.prepare(
    `UPDATE photo_meta 
     SET aesthetic_score = NULL, aesthetic_mtime_ms = NULL, aesthetic_updated_at = NULL 
     WHERE photo_id IN (SELECT id FROM photos WHERE library_id = ?)`
  ).run(libraryId)
}
