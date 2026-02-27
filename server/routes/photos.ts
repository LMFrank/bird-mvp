import express, { type Request, type Response } from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { SQLInputValue } from 'node:sqlite'
import { getDb, nowIso } from '../lib/catalog.js'
import { getPhotoAi, identifyWithAi, upsertPhotoAi } from '../lib/ai.js'
import { ensureThumb, normalizeThumbSize } from '../lib/thumbs.js'
import { asyncHandler } from '../lib/asyncHandler.js'

const router = express.Router()

router.get('/', (req: Request, res: Response) => {
  const db = getDb()
  const libraryId = Number(req.query.libraryId)
  if (!Number.isFinite(libraryId)) {
    res.status(400).json({ success: false, error: 'libraryId is required' })
    return
  }

  const status = String(req.query.status ?? 'all')
  const ratingMin = Number(req.query.ratingMin ?? 0)
  const tag = String(req.query.tag ?? '').trim()
  const q = String(req.query.q ?? '').trim()
  const aiZh = String(req.query.aiZh ?? '').trim()
  const aiMode = String(req.query.aiMode ?? 'top1').trim()
  const aiMinScore = Number(req.query.aiMinScore ?? 0)
  const offset = Math.max(0, Number(req.query.offset ?? 0))
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 60)))

  const where: string[] = ['p.library_id = ?']
  const params: SQLInputValue[] = [libraryId]

  if (status === 'keep' || status === 'reject' || status === 'none') {
    where.push('m.status = ?')
    params.push(status)
  }
  if (Number.isFinite(ratingMin) && ratingMin > 0) {
    where.push('m.rating >= ?')
    params.push(ratingMin)
  }
  if (q) {
    where.push('(p.rel_path LIKE ? OR p.abs_path LIKE ?)')
    params.push(`%${q}%`, `%${q}%`)
  }
  if (tag) {
    where.push('EXISTS (SELECT 1 FROM photo_tags t WHERE t.photo_id = p.id AND t.tag = ?)')
    params.push(tag)
  }
  if (aiZh) {
    const min = Number.isFinite(aiMinScore) ? aiMinScore : 0
    if (aiMode === 'any') {
      where.push(
        'EXISTS (SELECT 1 FROM photo_ai_predictions ap WHERE ap.photo_id = p.id AND ap.name_zh = ? AND ap.score >= ?)',
      )
      params.push(aiZh, min)
    } else {
      where.push(
        'EXISTS (SELECT 1 FROM photo_ai_predictions ap WHERE ap.photo_id = p.id AND ap.rank = 1 AND ap.name_zh = ? AND ap.score >= ?)',
      )
      params.push(aiZh, min)
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const countRow = db
    .prepare(
      `SELECT COUNT(1) as c FROM photos p JOIN photo_meta m ON m.photo_id = p.id ${whereSql}`,
    )
    .get(...params) as { c: number }

  const rows = db
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
    .all(...params, limit, offset)

  res.json({ success: true, total: countRow.c, offset, limit, photos: rows })
})

router.get('/:id', (req: Request, res: Response) => {
  const db = getDb()
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: 'invalid id' })
    return
  }

  const photo = db
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

  if (!photo) {
    res.status(404).json({ success: false, error: 'photo not found' })
    return
  }

  const tags = db
    .prepare('SELECT tag FROM photo_tags WHERE photo_id = ? ORDER BY tag ASC')
    .all(id)
    .map((r) => (r as { tag: string }).tag)

  const ai = getPhotoAi(db, id)

  res.json({ success: true, photo: { ...photo, tags, ai } })
})

router.get('/:id/thumb', asyncHandler(async (req: Request, res: Response) => {
  const db = getDb()
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: 'invalid id' })
    return
  }

  const size = normalizeThumbSize(req.query.size)
  const row = db
    .prepare('SELECT abs_path FROM photos WHERE id = ?')
    .get(id) as { abs_path: string } | undefined
  if (!row) {
    res.status(404).json({ success: false, error: 'photo not found' })
    return
  }

  const cacheDir = String(
    req.app.locals.cacheDir ?? path.join(process.cwd(), 'data', 'cache'),
  )
  const p = await ensureThumb(cacheDir, id, row.abs_path, size)
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  res.sendFile(p)
}))

router.post('/:id/identify', asyncHandler(async (req: Request, res: Response) => {
  const db = getDb()
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: 'invalid id' })
    return
  }

  const row = db
    .prepare('SELECT abs_path FROM photos WHERE id = ?')
    .get(id) as { abs_path: string } | undefined
  if (!row) {
    res.status(404).json({ success: false, error: 'photo not found' })
    return
  }

  try {
    const cacheDir = String(
      req.app.locals.cacheDir ?? path.join(process.cwd(), 'data', 'cache'),
    )
    const thumbPath = await ensureThumb(cacheDir, id, row.abs_path, 2048)
    const jpg = await fs.readFile(thumbPath)
    const ai = await identifyWithAi(jpg)
    upsertPhotoAi(db, id, ai)
    res.json({ success: true, ai })
  } catch (e: unknown) {
    const msg = e instanceof Error && e.message ? e.message : 'identify failed'
    res.status(500).json({ success: false, error: msg })
  }
}))

router.delete('/:id/ai', (req: Request, res: Response) => {
  const db = getDb()
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: 'invalid id' })
    return
  }

  db.prepare('DELETE FROM photo_ai WHERE photo_id = ?').run(id)
  db.prepare('DELETE FROM photo_ai_predictions WHERE photo_id = ?').run(id)
  res.json({ success: true })
})

router.patch('/:id', (req: Request, res: Response) => {
  const db = getDb()
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: 'invalid id' })
    return
  }

  const now = nowIso()
  const rating = req.body?.rating
  const status = req.body?.status
  const color = req.body?.color
  const tags = req.body?.tags

  const meta = db
    .prepare('SELECT photo_id FROM photo_meta WHERE photo_id = ?')
    .get(id) as { photo_id: number } | undefined
  if (!meta) {
    res.status(404).json({ success: false, error: 'photo not found' })
    return
  }

  const fields: string[] = []
  const params: SQLInputValue[] = []

  if (typeof rating === 'number' && Number.isFinite(rating) && rating >= 0 && rating <= 5) {
    fields.push('rating = ?')
    params.push(Math.trunc(rating))
  }
  if (status === 'none' || status === 'keep' || status === 'reject') {
    fields.push('status = ?')
    params.push(status)
  }
  if (typeof color === 'string' && color.length <= 32) {
    fields.push('color = ?')
    params.push(color)
  }

  if (fields.length) {
    fields.push('updated_at = ?')
    params.push(now)
    params.push(id)
    db.prepare(`UPDATE photo_meta SET ${fields.join(', ')} WHERE photo_id = ?`).run(...params)
  }

  if (Array.isArray(tags)) {
    const normalized = Array.from(
      new Set(
        tags
          .map((t: unknown) => String(t).trim())
          .filter((t: string) => t && t.length <= 32),
      ),
    ).sort()

    const del = db.prepare('DELETE FROM photo_tags WHERE photo_id = ?')
    del.run(id)
    const ins = db.prepare(
      'INSERT OR IGNORE INTO photo_tags(photo_id, tag, created_at) VALUES (?, ?, ?)',
    )
    for (const t of normalized) {
      ins.run(id, t, now)
    }
  }

  const updated = db
    .prepare(
      `
      SELECT
        p.id, p.rel_path, p.abs_path, p.mtime_ms, p.size,
        m.rating, m.status, m.color, m.updated_at
      FROM photos p
      JOIN photo_meta m ON m.photo_id = p.id
      WHERE p.id = ?
      `,
    )
    .get(id)
  const newTags = db
    .prepare('SELECT tag FROM photo_tags WHERE photo_id = ? ORDER BY tag ASC')
    .all(id)
    .map((r) => (r as { tag: string }).tag)

  res.json({ success: true, photo: { ...updated, tags: newTags } })
})

export default router
