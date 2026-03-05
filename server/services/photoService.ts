import fs from 'node:fs/promises'
import { getDb, nowIso } from '../lib/catalog.js'
import { getPhotoAi, identifyWithAi, identifyWithLlmFallback, mergeAiResults, shouldTriggerLlmFallback, upsertPhotoAi } from '../lib/ai.js'
import { buildIdentifyJpegsFromPathCached, getIdentifyInputOptionsFromEnv } from '../lib/identifyInput.js'
import { ensureThumb, type ThumbSize } from '../lib/thumbs.js'
import { computeAestheticScoreFromPath } from '../lib/aesthetic.js'
import { getRuntimeSetting } from '../lib/settings.js'
import { readExifSummary, type ExifSummary } from '../lib/exif.js'
import {
  countListPhotos,
  deletePhotoAi,
  getPhotoAbsPath,
  getPhotoAestheticMtimeMs,
  getPhotoDetail,
  getPhotoExifCache,
  listPhotoTags,
  listPhotos,
  replacePhotoTags,
  type ListPhotosQuery,
  updatePhotoAestheticScore,
  updatePhotoExifBasics,
  updatePhotoExifCache,
  updatePhotoMeta,
  updatePhotosMeta,
} from '../repos/photoRepo.js'

function clamp01(v: number) {
  if (!Number.isFinite(v)) return 0
  if (v <= 0) return 0
  if (v >= 1) return 1
  return v
}

function getAestheticCalibration(libraryId: number) {
  const p10 = Number(getRuntimeSetting(`AESTHETIC_P10_LIBRARY_${libraryId}`) ?? '')
  const p90 = Number(getRuntimeSetting(`AESTHETIC_P90_LIBRARY_${libraryId}`) ?? '')
  const n = Number(getRuntimeSetting(`AESTHETIC_CAL_COUNT_LIBRARY_${libraryId}`) ?? '')
  if (!Number.isFinite(p10) || !Number.isFinite(p90) || p90 <= p10) return null
  if (!Number.isFinite(n) || n < 25) return null
  return { p10, p90 }
}

function calibrateAesthetic(score: unknown, cal: { p10: number; p90: number } | null) {
  const s = typeof score === 'number' && Number.isFinite(score) ? score : null
  if (s === null) return null
  if (!cal) return Math.round(s * 10) / 10
  const t = clamp01((s - cal.p10) / (cal.p90 - cal.p10))
  return Math.round(t * 1000) / 10
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object') return null
  return v as Record<string, unknown>
}

function getNumberProp(v: unknown, k: string): number | null {
  const o = asRecord(v)
  if (!o) return null
  const n = o[k]
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

export function listPhotosService(q: ListPhotosQuery) {
  const db = getDb()
  const total = countListPhotos(db, q)
  const rows = listPhotos(db, q)
  const cal = getAestheticCalibration(q.libraryId)
  const photos = (rows as Array<Record<string, unknown>>).map((r) => ({
    ...r,
    aesthetic_score_cal: calibrateAesthetic(r.aesthetic_score, cal),
  }))
  return { total, offset: q.offset, limit: q.limit, photos }
}

export function getPhotoService(id: number) {
  const db = getDb()
  const photo = getPhotoDetail(db, id)
  if (!photo) return null
  const tags = listPhotoTags(db, id)
  const ai = getPhotoAi(db, id)
  const libraryId = getNumberProp(photo, 'library_id') ?? 0
  const cal = getAestheticCalibration(libraryId)
  const aesthetic_score_cal = calibrateAesthetic((photo as Record<string, unknown>).aesthetic_score, cal)
  let exif: ExifSummary | null = null
  try {
    const cache = getPhotoExifCache(db, id)
    if (cache.exifJson) exif = JSON.parse(cache.exifJson) as ExifSummary
  } catch {
    exif = null
  }
  return { ...photo, aesthetic_score_cal, exif, tags, ai }
}

export async function backfillAestheticForPhotosService(opts: { libraryId: number; photoIds: number[] }) {
  const ids = Array.from(new Set(opts.photoIds.map((n) => Math.trunc(Number(n))).filter((n) => Number.isFinite(n) && n > 0))).slice(0, 24)
  if (!ids.length) return { updated: [] as Array<{ id: number; aesthetic_score: number; aesthetic_score_cal: number | null; aesthetic_updated_at: string }> }

  const db = getDb()
  const rows = db
    .prepare(
      `
      SELECT p.id, p.abs_path, p.mtime_ms, p.library_id,
             m.aesthetic_score, m.aesthetic_mtime_ms
      FROM photos p
      JOIN photo_meta m ON m.photo_id = p.id
      WHERE p.library_id = ?
        AND p.id IN (${ids.map(() => '?').join(',')})
      `,
    )
    .all(opts.libraryId, ...ids) as Array<{
    id: number
    abs_path: string
    mtime_ms: number
    library_id: number
    aesthetic_score: number | null
    aesthetic_mtime_ms: number | null
  }>

  const cal = getAestheticCalibration(opts.libraryId)
  const updated: Array<{ id: number; aesthetic_score: number; aesthetic_score_cal: number | null; aesthetic_updated_at: string }> = []

  for (const r of rows) {
    const stale =
      typeof r.aesthetic_mtime_ms === 'number' && Number.isFinite(r.aesthetic_mtime_ms)
        ? Math.trunc(r.aesthetic_mtime_ms) !== Math.trunc(r.mtime_ms)
        : true
    const has = typeof r.aesthetic_score === 'number' && Number.isFinite(r.aesthetic_score)
    if (has && !stale) continue

    const st = await fs.stat(r.abs_path)
    const mtimeMs = Math.trunc(st.mtimeMs)
    const score = await computeAestheticScoreFromPath(r.abs_path)
    const now = nowIso()
    updatePhotoAestheticScore(db, r.id, { score, mtimeMs, now })
    updated.push({ id: r.id, aesthetic_score: score, aesthetic_score_cal: calibrateAesthetic(score, cal), aesthetic_updated_at: now })
  }

  return { updated }
}

export async function backfillExifForPhotosService(opts: { libraryId: number; photoIds: number[] }) {
  const ids = Array.from(new Set(opts.photoIds.map((n) => Math.trunc(Number(n))).filter((n) => Number.isFinite(n) && n > 0))).slice(0, 12)
  if (!ids.length) {
    return {
      updated: [] as Array<{ id: number; exif: ExifSummary; taken_at: string | null; width: number | null; height: number | null }>,
      failed: [] as Array<{ id: number; error: string }>,
    }
  }

  const db = getDb()
  type ExifRowBase = {
    id: number
    abs_path: string
    mtime_ms: number
    width: number | null
    height: number | null
    taken_at: string | null
  }
  type ExifRowWithMeta = ExifRowBase & { exif_mtime_ms: number | null }

  let rows: Array<ExifRowBase | ExifRowWithMeta>
  try {
    rows = db
      .prepare(
        `
        SELECT p.id, p.abs_path, p.mtime_ms, p.width, p.height, p.taken_at,
               m.exif_mtime_ms
        FROM photos p
        JOIN photo_meta m ON m.photo_id = p.id
        WHERE p.library_id = ?
          AND p.id IN (${ids.map(() => '?').join(',')})
        `,
      )
      .all(opts.libraryId, ...ids) as ExifRowWithMeta[]
  } catch {
    rows = db
      .prepare(
        `
        SELECT p.id, p.abs_path, p.mtime_ms, p.width, p.height, p.taken_at
        FROM photos p
        WHERE p.library_id = ?
          AND p.id IN (${ids.map(() => '?').join(',')})
        `,
      )
      .all(opts.libraryId, ...ids) as ExifRowBase[]
  }

  const updated: Array<{ id: number; exif: ExifSummary; taken_at: string | null; width: number | null; height: number | null }> = []
  const failed: Array<{ id: number; error: string }> = []
  for (const r of rows) {
    const exifMtime =
      'exif_mtime_ms' in r && typeof r.exif_mtime_ms === 'number' && Number.isFinite(r.exif_mtime_ms)
        ? Math.trunc(r.exif_mtime_ms)
        : null
    const stale =
      exifMtime !== null
        ? exifMtime !== Math.trunc(r.mtime_ms)
        : true
    if (!stale) continue

    try {
      const st = await fs.stat(r.abs_path)
      const mtimeMs = Math.trunc(st.mtimeMs)
      const exif = await readExifSummary(r.abs_path)
      const now = nowIso()
      updatePhotoExifBasics(db, r.id, {
        width: typeof exif.width === 'number' ? exif.width : null,
        height: typeof exif.height === 'number' ? exif.height : null,
        takenAt: typeof exif.takenAt === 'string' ? exif.takenAt : null,
      })
      updatePhotoExifCache(db, r.id, { exifJson: JSON.stringify(exif), mtimeMs, now })
      updated.push({
        id: r.id,
        exif,
        taken_at: typeof exif.takenAt === 'string' ? exif.takenAt : r.taken_at ?? null,
        width: typeof exif.width === 'number' ? exif.width : r.width ?? null,
        height: typeof exif.height === 'number' ? exif.height : r.height ?? null,
      })
    } catch (e: unknown) {
      const msg = e instanceof Error && e.message ? e.message : 'unknown error'
      failed.push({ id: r.id, error: msg })
    }
  }

  return { updated, failed }
}

export async function getPhotoThumbPathService(opts: { photoId: number; cacheDir: string; size: ThumbSize }) {
  const db = getDb()
  const absPath = getPhotoAbsPath(db, opts.photoId)
  if (!absPath) return null
  return await ensureThumb(opts.cacheDir, opts.photoId, absPath, opts.size)
}

export async function identifyPhotoService(id: number) {
  const db = getDb()
  const absPath = getPhotoAbsPath(db, id)
  if (!absPath) return null
  const st = await fs.stat(absPath)
  const mtimeMs = Math.trunc(st.mtimeMs)

  const opts = getIdentifyInputOptionsFromEnv()
  const inputs = await buildIdentifyJpegsFromPathCached(id, absPath, {
    maxSize: opts.maxSize,
    quality: opts.quality,
    crops: opts.cropsSingle,
    cropScales: opts.cropScalesSingle,
  })

  const results = []
  let lastErr: unknown = null
  for (const jpg of inputs) {
    try {
      results.push(await identifyWithAi(jpg))
      lastErr = null
    } catch (e: unknown) {
      lastErr = e
    }
  }
  if (!results.length) throw lastErr

  let ai = mergeAiResults(results)
  if (shouldTriggerLlmFallback(ai)) {
    try {
      const fb = await identifyWithLlmFallback(inputs[0]!, ai)
      ai = { ...ai, fallback: fb }
    } catch (e: unknown) {
      const msg = e instanceof Error && e.message ? e.message : 'unknown error'
      ai = {
        ...ai,
        fallback: {
          provider: 'llm',
          model: 'unknown',
          needHumanReview: true,
          reason: `兜底失败：${msg}`,
        },
      }
    }
  }
  upsertPhotoAi(db, id, ai)
  const prev = getPhotoAestheticMtimeMs(db, id)
  if (prev === null || prev !== mtimeMs) {
    try {
      const score = await computeAestheticScoreFromPath(absPath)
      updatePhotoAestheticScore(db, id, { score, mtimeMs, now: nowIso() })
    } catch {
      void 0
    }
  } else {
    // Force re-calculate aesthetic score if it's missing (e.g. after clearIdentify)
    // even if mtimeMs matches (because we might have cleared it but kept mtimeMs in photo table)
    const currentMeta = getPhotoDetail(db, id) as { aesthetic_score?: number | null } | undefined
    if (currentMeta && (currentMeta.aesthetic_score === null || currentMeta.aesthetic_score === undefined)) {
       try {
        const score = await computeAestheticScoreFromPath(absPath)
        updatePhotoAestheticScore(db, id, { score, mtimeMs, now: nowIso() })
      } catch {
        void 0
      }
    }
  }
  const after = getPhotoDetail(db, id) as
    | { aesthetic_score?: number | null; aesthetic_mtime_ms?: number | null; aesthetic_updated_at?: string | null }
    | null
  return { ai, aesthetic: after ? { score: after.aesthetic_score ?? null, updatedAt: after.aesthetic_updated_at ?? null } : null }
}

export function deletePhotoAiService(id: number) {
  const db = getDb()
  deletePhotoAi(db, id)
}

export function patchPhotoService(id: number, body: unknown) {
  const db = getDb()
  const now = nowIso()

  const b = (body ?? {}) as {
    rating?: unknown
    status?: unknown
    color?: unknown
    tags?: unknown
  }

  const ok = updatePhotoMeta(
    db,
    id,
    {
      rating: typeof b.rating === 'number' ? b.rating : undefined,
      status: b.status === 'none' || b.status === 'keep' || b.status === 'reject' ? b.status : undefined,
      color: typeof b.color === 'string' ? b.color : undefined,
    },
    now,
  )
  if (!ok) return null

  if (Array.isArray(b.tags)) {
    const normalized = Array.from(
      new Set(
        b.tags
          .map((t: unknown) => String(t).trim())
          .filter((t: string) => t && t.length <= 32),
      ),
    ).sort()
    replacePhotoTags(db, id, normalized, now)
  }

  return getPhotoService(id)
}

export function batchPatchPhotosService(ids: unknown[], body: unknown) {
  const db = getDb()
  const now = nowIso()

  const validIds = ids
    .map((id) => Number(id))
    .filter((n) => Number.isFinite(n) && n > 0)
  
  if (!validIds.length) return 0

  const b = (body ?? {}) as {
    rating?: unknown
    status?: unknown
  }

  const patch = {
    rating: typeof b.rating === 'number' ? b.rating : undefined,
    status: b.status === 'none' || b.status === 'keep' || b.status === 'reject' ? b.status : undefined,
  } as { rating?: number; status?: 'none' | 'keep' | 'reject'; color?: string }

  return updatePhotosMeta(db, validIds, patch, now)
}
