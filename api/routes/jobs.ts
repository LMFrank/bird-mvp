import express, { type Request, type Response } from 'express'
import { cancelJob, getJob } from '../lib/jobs.js'

const router = express.Router()

router.get('/:id', (req: Request, res: Response) => {
  const id = String(req.params.id ?? '')
  const job = getJob(id)
  if (!job) {
    res.status(404).json({ success: false, error: 'job not found' })
    return
  }
  res.json({ success: true, job })
})

router.post('/:id/cancel', (req: Request, res: Response) => {
  void req
  const id = String(req.params.id ?? '')
  const ok = cancelJob(id)
  if (!ok) {
    res.status(404).json({ success: false, error: 'job not found' })
    return
  }
  res.json({ success: true })
})

export default router

