import type { DatabaseSync } from 'node:sqlite'
import { nowIso } from './catalog.js'

export type AiPrediction = {
  nameZh?: string
  nameScientific?: string
  score: number
}

export type AiResult = {
  provider: string
  model: string
  labelsCount?: number
  promptCount?: number
  predictions: AiPrediction[]
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

export async function identifyWithAi(imageJpeg: Buffer): Promise<AiResult> {
  const base = String(process.env.BIRD_AI_URL ?? '').trim()
  if (!base) {
    throw new Error('BIRD_AI_URL is not set')
  }

  const form = new FormData()
  form.set('image', new Blob([imageJpeg], { type: 'image/jpeg' }), 'image.jpg')

  const res = await fetch(`${base.replace(/\/$/, '')}/identify`, {
    method: 'POST',
    body: form,
  })

  const data = (await res.json()) as unknown
  const ok = isRecord(data) && data.success === true
  if (!res.ok || !ok) {
    const msg =
      isRecord(data) && typeof data.error === 'string' ? data.error : `HTTP ${res.status}`
    throw new Error(msg)
  }

  const predictionsRaw = Array.isArray(data.predictions) ? data.predictions : []
  const predictions: AiPrediction[] = predictionsRaw
    .filter(isRecord)
    .map((p) => ({
      nameZh: typeof p.nameZh === 'string' ? p.nameZh : undefined,
      nameScientific: typeof p.nameScientific === 'string' ? p.nameScientific : undefined,
      score: Number(p.score ?? 0),
    }))

  return {
    provider: typeof data.provider === 'string' ? data.provider : 'unknown',
    model: typeof data.model === 'string' ? data.model : 'unknown',
    labelsCount: typeof data.labelsCount === 'number' ? data.labelsCount : undefined,
    promptCount: typeof data.promptCount === 'number' ? data.promptCount : undefined,
    predictions,
  }
}

export function upsertPhotoAi(db: DatabaseSync, photoId: number, ai: AiResult) {
  const now = nowIso()
  db.prepare(
    `
    INSERT INTO photo_ai(photo_id, provider, model, result_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(photo_id) DO UPDATE SET
      provider = excluded.provider,
      model = excluded.model,
      result_json = excluded.result_json,
      updated_at = excluded.updated_at
    `,
  ).run(photoId, ai.provider, ai.model, JSON.stringify(ai), now)

  db.prepare('DELETE FROM photo_ai_predictions WHERE photo_id = ?').run(photoId)
  const ins = db.prepare(
    `
    INSERT INTO photo_ai_predictions(photo_id, rank, name_zh, name_scientific, score, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    `,
  )
  const preds = Array.isArray(ai.predictions) ? ai.predictions : []
  for (let i = 0; i < preds.length; i += 1) {
    const p = preds[i]!
    const rank = i + 1
    ins.run(
      photoId,
      rank,
      typeof p.nameZh === 'string' ? p.nameZh : null,
      typeof p.nameScientific === 'string' ? p.nameScientific : null,
      Number(p.score ?? 0),
      now,
    )
  }
}

export function getPhotoAi(db: DatabaseSync, photoId: number): AiResult | null {
  const row = db
    .prepare('SELECT result_json FROM photo_ai WHERE photo_id = ?')
    .get(photoId) as { result_json: string } | undefined
  if (!row) return null
  try {
    const parsed = JSON.parse(row.result_json) as AiResult
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

