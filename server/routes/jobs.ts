import express, { type Request, type Response } from 'express'
import { cancelJob, getJob } from '../lib/jobs.js'
import { notFound } from '../lib/apiError.js'
import { requiredString } from '../lib/validate.js'

const router = express.Router()

router.get('/:id', (req: Request, res: Response) => {
  const id = requiredString('id', req.params.id)
  const job = getJob(id)
  if (!job) throw notFound('job not found')
  res.json({ success: true, job })
})

router.post('/:id/cancel', (req: Request, res: Response) => {
  void req
  const id = requiredString('id', req.params.id)
  const ok = cancelJob(id)
  if (!ok) throw notFound('job not found')
  res.json({ success: true })
})

export default router
