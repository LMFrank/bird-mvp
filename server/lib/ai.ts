import type { DatabaseSync } from 'node:sqlite'
import { nowIso } from './catalog.js'

export type AiPrediction = {
  nameZh?: string
  nameScientific?: string
  score: number
}

export type AiFallback = {
  provider: string
  model: string
  chosen?: AiPrediction
  confidence?: number
  needHumanReview?: boolean
  reason?: string
}

export type AiResult = {
  provider: string
  model: string
  labelsCount?: number
  promptCount?: number
  predictions: AiPrediction[]
  fallback?: AiFallback
}

export function mergeAiResults(results: AiResult[]): AiResult {
  const base = results.find((r) => Array.isArray(r.predictions) && r.predictions.length > 0) ?? results[0]
  if (!base) {
    return {
      provider: 'unknown',
      model: 'unknown',
      predictions: [],
    } satisfies AiResult
  }

  const topk = Math.max(1, ...results.map((r) => (Array.isArray(r.predictions) ? r.predictions.length : 0)))
  const best = new Map<string, AiPrediction>()

  for (const r of results) {
    const preds = Array.isArray(r.predictions) ? r.predictions : []
    for (const p of preds) {
      const key = String(p.nameScientific || p.nameZh || '').trim()
      if (!key) continue
      const prev = best.get(key)
      if (!prev || Number(p.score ?? 0) > Number(prev.score ?? 0)) {
        best.set(key, {
          nameZh: typeof p.nameZh === 'string' ? p.nameZh : prev?.nameZh,
          nameScientific: typeof p.nameScientific === 'string' ? p.nameScientific : prev?.nameScientific,
          score: Number(p.score ?? 0),
        })
      }
    }
  }

  const merged = Array.from(best.values())
    .filter((p) => Number.isFinite(p.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, topk)

  return {
    provider: base.provider,
    model: base.model,
    labelsCount: base.labelsCount,
    promptCount: base.promptCount,
    predictions: merged,
  } satisfies AiResult
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function clampInt(v: unknown, fallback: number, min: number, max: number) {
  const n = Math.trunc(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function clampFloat(v: unknown, fallback: number, min: number, max: number) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function asBool(v: unknown, fallback: boolean) {
  if (typeof v === 'boolean') return v
  if (typeof v !== 'string') return fallback
  const s = v.trim().toLowerCase()
  if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false
  return fallback
}

export function shouldTriggerLlmFallback(ai: AiResult) {
  const p1 = ai.predictions?.[0]
  if (!p1) return false
  const p2 = ai.predictions?.[1]
  const margin = p2 ? p1.score - p2.score : p1.score
  const minScore = clampFloat(process.env.LLM_FALLBACK_TRIGGER_SCORE, 0.6, 0, 1)
  const minMargin = clampFloat(process.env.LLM_FALLBACK_TRIGGER_MARGIN, 0.1, 0, 1)
  return p1.score < minScore || margin < minMargin
}

function tryParseJsonObject(text: string): unknown {
  const s = String(text ?? '').trim()
  if (!s) return null
  try {
    return JSON.parse(s)
  } catch {
    const i = s.indexOf('{')
    const j = s.lastIndexOf('}')
    if (i >= 0 && j > i) {
      try {
        return JSON.parse(s.slice(i, j + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

export async function identifyWithLlmFallback(imageJpeg: Buffer, ai: AiResult): Promise<AiFallback | null> {
  const qwenApiKey = String(process.env.QWEN_API_KEY ?? '').trim()
  const qwenBaseUrl = String(process.env.QWEN_BASE_URL ?? '').trim()
  const qwenModelName = String(process.env.QWEN_MODEL_NAME ?? '').trim()

  const enabled = asBool(process.env.LLM_FALLBACK_ENABLED, Boolean(qwenApiKey))
  if (!enabled) return null

  const apiKey = String(process.env.LLM_FALLBACK_API_KEY ?? qwenApiKey ?? '').trim()
  if (!apiKey) return null

  const explicitUrl = String(process.env.LLM_FALLBACK_URL ?? '').trim()
  const url =
    explicitUrl ||
    (qwenBaseUrl ? `${qwenBaseUrl.replace(/\/$/, '')}/chat/completions` : 'https://api.openai.com/v1/chat/completions')

  const model = String(process.env.LLM_FALLBACK_MODEL ?? '').trim() || qwenModelName || 'gpt-4o-mini'
  const topk = clampInt(process.env.LLM_FALLBACK_CANDIDATES, 5, 2, 10)

  const candidates = (Array.isArray(ai.predictions) ? ai.predictions : []).slice(0, topk).map((p) => ({
    nameZh: typeof p.nameZh === 'string' ? p.nameZh : '',
    nameScientific: typeof p.nameScientific === 'string' ? p.nameScientific : '',
    score: Number(p.score ?? 0),
  }))
  if (!candidates.length) return null

  const b64 = imageJpeg.toString('base64')
  const candidateLines = candidates
    .map((c, i) => `${i + 1}. ${[c.nameZh, c.nameScientific].filter(Boolean).join(' / ')} (${(c.score * 100).toFixed(1)}%)`)
    .join('\n')

  const schemaHint =
    '{"chosenScientific":string|null,"chosenZh":string|null,"confidence":number,"needHumanReview":boolean,"reason":string}'

  const body = {
    model,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          '你是鸟类物种鉴定助手。你必须严格输出 JSON（不要 markdown，不要额外文本）。如果无法确定，请 chosenScientific/chosenZh 为 null，needHumanReview 为 true。',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              `请根据图片在下面候选物种中选择最可能的一个；必须来自候选列表，且名字要与候选一致。\n` +
              `候选列表（离线模型 Top${candidates.length}）：\n${candidateLines}\n\n` +
              `输出格式：${schemaHint}\n` +
              `confidence 范围 0~1；reason 用一句话描述关键外观依据。`,
          },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
        ],
      },
    ],
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const data = (await res.json()) as unknown
  if (!res.ok) {
    const msg =
      isRecord(data) && isRecord(data.error) && typeof data.error.message === 'string'
        ? data.error.message
        : `HTTP ${res.status}`
    throw new Error(msg)
  }

  let content = ''
  if (isRecord(data) && Array.isArray(data.choices) && isRecord(data.choices[0])) {
    const msg = (data.choices[0] as Record<string, unknown>).message
    if (isRecord(msg) && typeof msg.content === 'string') content = msg.content
  }

  const parsed = tryParseJsonObject(content)
  if (!isRecord(parsed)) return null

  const chosenScientific = typeof parsed.chosenScientific === 'string' ? parsed.chosenScientific.trim() : null
  const chosenZh = typeof parsed.chosenZh === 'string' ? parsed.chosenZh.trim() : null
  const confidence = clampFloat(parsed.confidence, NaN, 0, 1)
  const needHumanReview = typeof parsed.needHumanReview === 'boolean' ? parsed.needHumanReview : undefined
  const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : undefined

  const matched =
    chosenScientific || chosenZh
      ? candidates.find((c) => (chosenScientific && c.nameScientific === chosenScientific) || (chosenZh && c.nameZh === chosenZh))
      : undefined

  let provider = 'llm'
  try {
    provider = new URL(url).hostname
  } catch {
    provider = 'llm'
  }

  return {
    provider,
    model,
    chosen: matched
      ? {
          nameZh: matched.nameZh || undefined,
          nameScientific: matched.nameScientific || undefined,
          score: Number.isFinite(confidence) ? confidence : matched.score,
        }
      : undefined,
    confidence: Number.isFinite(confidence) ? confidence : undefined,
    needHumanReview,
    reason,
  }
}

export async function identifyWithAi(imageJpeg: Buffer): Promise<AiResult> {
  const base = String(process.env.BIRD_AI_URL ?? '').trim()
  if (!base) {
    throw new Error('BIRD_AI_URL is not set')
  }

  const url = `${base.replace(/\/$/, '')}/identify`
  let res: Response
  const delaysMs = [0, 1000, 2000, 5000, 10000, 20000, 30000]
  let lastErr: unknown = null
  for (const d of delaysMs) {
    if (d > 0) await new Promise((r) => setTimeout(r, d))
    try {
      const form = new FormData()
      form.set('image', new Blob([imageJpeg], { type: 'image/jpeg' }), 'image.jpg')
      res = await fetch(url, {
        method: 'POST',
        body: form,
      })
      lastErr = null
      if (res.status === 503) {
        lastErr = new Error('AI service not ready')
        continue
      }
      break
    } catch (e: unknown) {
      lastErr = e
    }
  }
  if (lastErr) {
    if (lastErr instanceof Error && lastErr.message === 'AI service not ready') {
      throw new Error(`AI 服务正在加载模型，请稍后再试：${url}`)
    }
    const inDockerHint =
      process.platform !== 'linux' && /^https?:\/\/ai(?::|\/|$)/.test(base)
        ? '（看起来你在宿主机运行但 BIRD_AI_URL 仍是 http://ai:8000；宿主机请用 http://localhost:8000，或改用 docker compose 启动）'
        : ''
    const msg = lastErr instanceof Error && lastErr.message ? lastErr.message : 'fetch failed'
    throw new Error(`无法连接 AI 服务：${url}（${msg}）${inDockerHint}`.trim())
  }

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
