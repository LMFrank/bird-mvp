/**
 * This is a API server
 */

import fs from 'node:fs'
import express, { type Request, type Response } from 'express'
import cors from 'cors'
import path from 'path'
import dotenv from 'dotenv'
import authRoutes from './routes/auth.js'
import aiRoutes from './routes/ai.js'
import jobsRoutes from './routes/jobs.js'
import libraryRoutes from './routes/library.js'
import photosRoutes from './routes/photos.js'
import settingsRoutes from './routes/settings.js'
import { initCatalog } from './lib/catalog.js'
import { ApiError } from './lib/apiError.js'

// load env
dotenv.config()

const cacheDir =
  String(process.env.CACHE_DIR ?? '').trim() || path.join(process.cwd(), 'data', 'cache')
initCatalog({ cacheDir })

const app: express.Application = express()

app.locals.cacheDir = cacheDir

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

/**
 * API Routes
 */
app.use('/api/auth', authRoutes)
app.use('/api/ai', aiRoutes)
app.use('/api/jobs', jobsRoutes)
app.use('/api/library', libraryRoutes)
app.use('/api/photos', photosRoutes)
app.use('/api/settings', settingsRoutes)

const serveStatic = String(process.env.SERVE_STATIC ?? '') === '1'
const staticDir = String(process.env.STATIC_DIR ?? path.join(process.cwd(), 'dist'))
if (serveStatic && fs.existsSync(staticDir)) {
  app.use(express.static(staticDir))
  app.get('*', (req: Request, res: Response, next: express.NextFunction) => {
    if (req.path.startsWith('/api/')) return next()
    res.sendFile(path.join(staticDir, 'index.html'))
  })
}

/**
 * health
 */
app.use(
  '/api/health',
  (req: Request, res: Response): void => {
    void req
    res.status(200).json({
      success: true,
      message: 'ok',
    })
  },
)

/**
 * error handler middleware
 */
app.use((error: Error, req: Request, res: Response, next: express.NextFunction) => {
  void req
  void next
  if (error instanceof ApiError) {
    res.status(error.status).json({
      success: false,
      error: error.message,
      code: error.code,
      details: error.details ?? null,
    })
    return
  }
  res.status(500).json({
    success: false,
    error: error?.message || 'Server internal error',
  })
})

/**
 * 404 handler
 */
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'API not found',
  })
})

export default app
