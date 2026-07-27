import express, { type Request, type Response } from 'express'
import { asyncHandler } from '../lib/asyncHandler.js'
import { requiredInt, requiredString, asBool, asInt } from '../lib/validate.js'
import {
  createIdentifyLibraryJobService,
  createLibraryService,
  deleteLibraryAiService,
  listLibrariesService,
  scanLibraryService,
} from '../services/libraryService.js'
import { evaluateLibraryService, listSpeciesAssetsService } from '../services/speciesService.js'
import { getDb } from '../lib/catalog.js'
import {
  confirmSequenceService,
  listSequencesService,
  rebuildSequencesService,
} from '../services/sequenceService.js'

const router = express.Router()

router.get('/', (req: Request, res: Response) => {
  void req
  res.json({ success: true, libraries: listLibrariesService() })
})

router.get('/:id/assets', (req: Request, res: Response) => {
  const id = requiredInt('id', req.params.id)
  res.json({ success: true, assets: listSpeciesAssetsService(id) })
})

router.get('/:id/evaluation', (req: Request, res: Response) => {
  const id = requiredInt('id', req.params.id)
  res.json({ success: true, metrics: evaluateLibraryService(id) })
})

router.get('/:id/sequences', (req: Request, res: Response) => {
  const id = requiredInt('id', req.params.id)
  res.json({ success: true, sequences: listSequencesService(id) })
})

router.post('/:id/sequences/rebuild', (req: Request, res: Response) => {
  const id = requiredInt('id', req.params.id)
  const maxGapMs = asInt(req.body?.maxGapMs, { default: 10_000, min: 1_000, max: 300_000 })
  const minSimilarity = Number(req.body?.minSimilarity ?? 0.9)
  res.json({
    success: true,
    sequences: rebuildSequencesService(id, { maxGapMs, minSimilarity }),
  })
})

router.put('/:id/sequences/:sequenceId/confirmation', (req: Request, res: Response) => {
  const id = requiredInt('id', req.params.id)
  const sequenceId = requiredInt('sequenceId', req.params.sequenceId)
  try {
    const result = confirmSequenceService(id, sequenceId, req.body ?? {})
    if (!result) return void res.status(404).json({ success: false, error: 'sequence not found' })
    res.json({ success: true, ...result })
  } catch (error: unknown) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'invalid sequence confirmation',
    })
  }
})

router.patch('/:id', (req: Request, res: Response) => {
  const id = requiredInt('id', req.params.id)
  const regionCode = requiredString('regionCode', req.body?.regionCode).toUpperCase().slice(0, 32)
  const result = getDb().prepare('UPDATE libraries SET region_code=? WHERE id=?').run(regionCode, id)
  if (!result.changes) return void res.status(404).json({ success: false, error: 'library not found' })
  res.json({ success: true, regionCode })
})

router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const rootPath = requiredString('rootPath', req.body?.rootPath)
  const out = await createLibraryService(rootPath)
  if (!out.ok) return void res.status(out.status).json({ success: false, error: out.error })
  res.json({ success: true, library: out.library, inserted: out.inserted })
}))

router.post('/:id/scan', asyncHandler(async (req: Request, res: Response) => {
  const id = requiredInt('id', req.params.id)
  const out = await scanLibraryService(id)
  if (!out.ok) return void res.status(out.status).json({ success: false, error: out.error })
  const { ok, ...payload } = out
  void ok
  res.json({ success: true, ...payload })
}))

router.post('/:id/identify', (req: Request, res: Response) => {
  const id = requiredInt('id', req.params.id)
  const overwrite = asBool(req.body?.overwrite, { default: false })
  const limit = asInt(req.body?.limit, { default: 0, min: 0, max: 5000 })
  const job = createIdentifyLibraryJobService({
    libraryId: id,
    overwrite,
    limit: limit > 0 ? limit : undefined,
  })
  res.json({ success: true, job })
})

router.delete('/:id/ai', (req: Request, res: Response) => {
  const id = requiredInt('id', req.params.id)
  deleteLibraryAiService(id)
  res.json({ success: true })
})

export default router
