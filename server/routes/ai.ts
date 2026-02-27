import express, { type Request, type Response } from 'express'
import type { SQLInputValue } from 'node:sqlite'
import { getDb } from '../lib/catalog.js'

const router = express.Router()

router.get('/health', async (req: Request, res: Response) => {
  void req
  const base = String(process.env.BIRD_AI_URL ?? '').trim()
  if (!base) {
    res.status(400).json({ success: false, error: 'BIRD_AI_URL is not set' })
    return
  }

  const url = `${base.replace(/\/$/, '')}/health`
  try {
    const r = await fetch(url)
    const raw = await r.text()
    let data: unknown
    try {
      data = raw ? (JSON.parse(raw) as unknown) : {}
    } catch {
      data = { success: false, error: raw || `HTTP ${r.status}` }
    }
    if (!r.ok) {
      const msg =
        typeof (data as { error?: unknown } | null)?.error === 'string'
          ? (data as { error?: string }).error
          : `HTTP ${r.status}`
      res.status(502).json({ success: false, error: msg })
      return
    }
    res.json({ success: true, ai: data })
  } catch (e: unknown) {
    const msg = e instanceof Error && e.message ? e.message : 'fetch failed'
    res.status(502).json({ success: false, error: `无法连接 AI 服务：${url}（${msg}）` })
  }
})

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
