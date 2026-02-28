import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

export type PhotoStatusFilter = 'all' | 'none' | 'keep' | 'reject'
export type PhotoAiModeFilter = 'top1' | 'any'

export type ListPhotosQuery = {
  libraryId: number
  status: PhotoStatusFilter
  ratingMin: number
  tag: string
  q: string
  aiZh: string
  aiMode: PhotoAiModeFilter
  aiMinScore: number
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
  return db
    .prepare(
      `
      SELECT
        p.id, p.rel_path, p.abs_path, p.mtime_ms, p.size,
        m.rating, m.status, m.color, m.updated_at,
        ap.name_zh as ai_name_zh, ap.name_scientific as ai_name_scientific, ap.score as ai_score
      FROM photos p
      JOIN photo_meta m ON m.photo_id = p.id
      LEFT JOIN photo_ai_predictions ap ON ap.photo_id = p.id AND ap.rank = 1
      ${whereSql}
      ORDER BY p.mtime_ms DESC
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
        p.width, p.height, p.taken_at,
        m.rating, m.status, m.color, m.updated_at
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
}
