import express, { type Request, type Response } from 'express'
import type { SQLInputValue } from 'node:sqlite'
import { getDb } from '../lib/catalog.js'

const router = express.Router()

router.get('/species', (req: Request, res: Response) => {
  const db = getDb()
  const libraryId = Number(req.query.libraryId)
  if (!Number.isFinite(libraryId)) {
    res.status(400).json({ success: false, error: 'libraryId is required' })
    return
  }

  const minScore = Number(req.query.minScore ?? 0)
  const q = String(req.query.q ?? '').trim()
  const params: SQLInputValue[] = [libraryId]
  const where: string[] = [
    'p.library_id = ?',
    'ap.rank = 1',
    "IFNULL(ap.name_zh, '') <> ''",
  ]

  if (Number.isFinite(minScore) && minScore > 0) {
    where.push('ap.score >= ?')
    params.push(minScore)
  }
  if (q) {
    where.push('(ap.name_zh LIKE ? OR ap.name_scientific LIKE ?)')
    params.push(`%${q}%`, `%${q}%`)
  }

  const whereSql = `WHERE ${where.join(' AND ')}`
  const rows = db
    .prepare(
      `
      SELECT
        ap.name_zh as nameZh,
        ap.name_scientific as nameScientific,
        COUNT(1) as count,
        AVG(ap.score) as avgScore
      FROM photo_ai_predictions ap
      JOIN photos p ON p.id = ap.photo_id
      ${whereSql}
      GROUP BY ap.name_zh, ap.name_scientific
      ORDER BY count DESC, avgScore DESC
      LIMIT 500
      `,
    )
    .all(...params)

  res.json({ success: true, species: rows })
})

export default router

