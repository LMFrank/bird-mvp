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

const router = express.Router()

router.get('/', (req: Request, res: Response) => {
  void req
  res.json({ success: true, libraries: listLibrariesService() })
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
  const limit = asInt(req.body?.limit, { default: 0, min: 0 })
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
