import express, { type Request, type Response } from 'express'
import path from 'node:path'
import { normalizeThumbSize } from '../lib/thumbs.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { ApiError, notFound } from '../lib/apiError.js'
import { asInt, asNumber, asString, oneOf, requiredInt } from '../lib/validate.js'
import {
  deletePhotoAiService,
  getPhotoService,
  getPhotoThumbPathService,
  identifyPhotoService,
  listPhotosService,
  patchPhotoService,
} from '../services/photoService.js'
import type { ListPhotosQuery } from '../repos/photoRepo.js'

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
    const ai = await identifyPhotoService(id)
    if (!ai) throw notFound('photo not found')
    res.json({ success: true, ai })
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

router.patch('/:id', (req: Request, res: Response) => {
  const id = requiredInt('id', req.params.id)
  const updated = patchPhotoService(id, req.body)
  if (!updated) throw notFound('photo not found')
  res.json({ success: true, photo: updated })
})

export default router
