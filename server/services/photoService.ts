import { getDb, nowIso } from '../lib/catalog.js'
import { getPhotoAi, identifyWithAi, mergeAiResults, upsertPhotoAi } from '../lib/ai.js'
import { buildIdentifyJpegsFromPath, getIdentifyInputOptionsFromEnv } from '../lib/identifyInput.js'
import { ensureThumb, type ThumbSize } from '../lib/thumbs.js'
import {
  countListPhotos,
  deletePhotoAi,
  getPhotoAbsPath,
  getPhotoDetail,
  listPhotoTags,
  listPhotos,
  replacePhotoTags,
  type ListPhotosQuery,
  updatePhotoMeta,
} from '../repos/photoRepo.js'

export async function listPhotosService(q: ListPhotosQuery) {
  const db = getDb()
  const total = countListPhotos(db, q)
  const rows = listPhotos(db, q)
  return { total, offset: q.offset, limit: q.limit, photos: rows }
}

export function getPhotoService(id: number) {
  const db = getDb()
  const photo = getPhotoDetail(db, id)
  if (!photo) return null
  const tags = listPhotoTags(db, id)
  const ai = getPhotoAi(db, id)
  return { ...photo, tags, ai }
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

  const opts = getIdentifyInputOptionsFromEnv()
  const inputs = await buildIdentifyJpegsFromPath(absPath, {
    maxSize: opts.maxSize,
    quality: opts.quality,
    crops: opts.cropsSingle,
    cropScale: opts.cropScale,
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

  const ai = mergeAiResults(results)
  upsertPhotoAi(db, id, ai)
  return ai
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

  const updated = getPhotoDetail(db, id)
  if (!updated) return null
  const tags = listPhotoTags(db, id)
  return { ...updated, tags }
}
