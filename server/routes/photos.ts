import express, { type Request, type Response } from 'express'
import path from 'node:path'
import { normalizeThumbSize } from '../lib/thumbs.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { ApiError, notFound } from '../lib/apiError.js'
import { asInt, asNumber, asString, oneOf, requiredInt } from '../lib/validate.js'
import {
  backfillAestheticForPhotosService,
  backfillExifForPhotosService,
  batchPatchPhotosService,
  deletePhotoAiService,
  getPhotoService,
  getPhotoThumbPathService,
  identifyPhotoService,
  listPhotosService,
  patchPhotoService,
} from '../services/photoService.js'
import type { ListPhotosQuery } from '../repos/photoRepo.js'
import { confirmPhotoSpeciesService } from '../services/speciesService.js'

const router = express.Router()

router.get('/', (req: Request, res: Response) => {
  const libraryId = requiredInt('libraryId', req.query.libraryId)

  const status = oneOf(asString(req.query.status, { default: 'all' }), ['all', 'keep', 'reject', 'none'] as const, 'all')
  const ratingMin = asNumber(req.query.ratingMin, { default: 0, min: 0, max: 5 })
  const tag = asString(req.query.tag, { default: '', maxLen: 32 })
  const q = asString(req.query.q, { default: '' })
  const aiZh = asString(req.query.aiZh, { default: '' })
  const aiMode = oneOf(asString(req.query.aiMode, { default: 'top1' }), ['top1', 'any'] as const, 'top1')
  const aiMinScore = asNumber(req.query.aiMinScore, { default: 0, min: 0 })
  const sort = oneOf(asString(req.query.sort, { default: 'time' }), ['time', 'recommend'] as const, 'time')
  const offset = Math.max(0, asInt(req.query.offset, { default: 0, min: 0 }))
  const limit = Math.min(200, Math.max(1, asInt(req.query.limit, { default: 60, min: 1, max: 200 })))

  const query: ListPhotosQuery = {
    libraryId,
    status: status === 'keep' || status === 'reject' || status === 'none' ? status : 'all',
    ratingMin,
    tag,
    q,
    aiZh,
    aiMode: aiMode === 'any' ? 'any' : 'top1',
    aiMinScore,
    sort,
    offset,
    limit,
  }

  res.json({ success: true, ...listPhotosService(query) })
})

router.get('/:id', (req: Request, res: Response) => {
  const id = requiredInt('id', req.params.id)
  const photo = getPhotoService(id)
  if (!photo) throw notFound('photo not found')
  res.json({ success: true, photo })
})

router.get('/:id/thumb', asyncHandler(async (req: Request, res: Response) => {
  const id = requiredInt('id', req.params.id)

  const size = normalizeThumbSize(req.query.size)

  const cacheDir = String(
    req.app.locals.cacheDir ?? path.join(process.cwd(), 'data', 'cache'),
  )
  const p = await getPhotoThumbPathService({ photoId: id, cacheDir, size })
  if (!p) throw notFound('photo not found')
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  res.sendFile(p)
}))

router.post('/:id/identify', asyncHandler(async (req: Request, res: Response) => {
  const id = requiredInt('id', req.params.id)

  try {
    const r = await identifyPhotoService(id)
    if (!r) throw notFound('photo not found')
    res.json({ success: true, ...r })
  } catch (e: unknown) {
    if (e instanceof ApiError) throw e
    const msg = e instanceof Error && e.message ? e.message : 'identify failed'
    throw new ApiError({ status: 500, code: 'IDENTIFY_FAILED', message: msg })
  }
}))

router.delete('/:id/ai', (req: Request, res: Response) => {
  const id = requiredInt('id', req.params.id)
  deletePhotoAiService(id)
  res.json({ success: true })
})

router.put('/:id/confirmation', (req: Request, res: Response) => {
  const id = requiredInt('id', req.params.id)
  try {
    const confirmation = confirmPhotoSpeciesService(id, req.body ?? {})
    if (!confirmation) throw notFound('photo not found')
    res.json({ success: true, confirmation })
  } catch (error: unknown) {
    if (error instanceof ApiError) throw error
    throw new ApiError({
      status: 400,
      code: 'INVALID_CONFIRMATION',
      message: error instanceof Error ? error.message : 'invalid confirmation',
    })
  }
})

router.patch('/batch', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { ids?: unknown; rating?: unknown; status?: unknown }
  if (!Array.isArray(body.ids)) {
     throw new ApiError({ status: 400, code: 'INVALID_IDS', message: 'ids must be an array' })
  }
  const count = batchPatchPhotosService(body.ids, body)
  res.json({ success: true, count })
})

router.patch('/:id', (req: Request, res: Response) => {
  const id = requiredInt('id', req.params.id)
  const updated = patchPhotoService(id, req.body)
  if (!updated) throw notFound('photo not found')
  res.json({ success: true, photo: updated })
})

router.post(
  '/aesthetic/backfill',
  asyncHandler(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { libraryId?: unknown; photoIds?: unknown }
    const libraryId = requiredInt('libraryId', body.libraryId)
    const ids = Array.isArray(body.photoIds) ? body.photoIds : []
    const photoIds = ids.map((v) => Math.trunc(Number(v))).filter((n) => Number.isFinite(n) && n > 0)
    try {
      const r = await backfillAestheticForPhotosService({ libraryId, photoIds })
      res.json({ success: true, ...r })
    } catch (e: unknown) {
      const msg = e instanceof Error && e.message ? e.message : 'backfill failed'
      throw new ApiError({ status: 500, code: 'AESTHETIC_BACKFILL_FAILED', message: msg })
    }
  }),
)

router.post(
  '/exif/backfill',
  asyncHandler(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { libraryId?: unknown; photoIds?: unknown }
    const libraryId = requiredInt('libraryId', body.libraryId)
    const ids = Array.isArray(body.photoIds) ? body.photoIds : []
    const photoIds = ids.map((v) => Math.trunc(Number(v))).filter((n) => Number.isFinite(n) && n > 0)
    try {
      const r = await backfillExifForPhotosService({ libraryId, photoIds })
      res.json({ success: true, ...r })
    } catch (e: unknown) {
      const msg = e instanceof Error && e.message ? e.message : 'backfill failed'
      throw new ApiError({ status: 500, code: 'EXIF_BACKFILL_FAILED', message: msg })
    }
  }),
)

export default router
