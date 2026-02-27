import express, { type Request, type Response } from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import { collectImages } from '../lib/scan.js'
import { computeFingerprint } from '../lib/fingerprint.js'
import { ensurePhotoMeta, getDb, nowIso } from '../lib/catalog.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { createIdentifyLibraryJob } from '../lib/jobs.js'

const router = express.Router()

router.get('/', (req: Request, res: Response) => {
  const db = getDb()
  const rows = db
    .prepare('SELECT id, root_path, created_at FROM libraries ORDER BY id DESC')
    .all()
  res.json({ success: true, libraries: rows })
})

router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const raw = String(req.body?.rootPath ?? '').trim()
  if (!raw) {
    res.status(400).json({ success: false, error: 'rootPath is required' })
    return
  }

  const rootPath = path.resolve(raw)
  try {
    const st = await fs.stat(rootPath)
    if (!st.isDirectory()) {
      res.status(400).json({ success: false, error: 'rootPath is not a directory' })
      return
    }
  } catch {
    res.status(400).json({ success: false, error: 'rootPath not found' })
    return
  }

  const db = getDb()
  const createdAt = nowIso()
  const info = db
    .prepare('INSERT OR IGNORE INTO libraries(root_path, created_at) VALUES (?, ?)')
    .run(rootPath, createdAt)

  const row = db
    .prepare('SELECT id, root_path, created_at FROM libraries WHERE root_path = ?')
    .get(rootPath)

  res.json({ success: true, library: row, inserted: info.changes > 0 })
}))

router.post('/:id/scan', asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: 'invalid id' })
    return
  }

  const db = getDb()
  const lib = db
    .prepare('SELECT id, root_path FROM libraries WHERE id = ?')
    .get(id) as { id: number; root_path: string } | undefined

  if (!lib) {
    res.status(404).json({ success: false, error: 'library not found' })
    return
  }

  if (/^[A-Za-z]:\\/.test(lib.root_path) && process.platform === 'linux') {
    res.status(400).json({
      success: false,
      error: '容器内无法访问 Windows 路径，请改用挂载到容器内的路径（例如 /photos）',
    })
    return
  }

  try {
    const st = await fs.stat(lib.root_path)
    if (!st.isDirectory()) {
      res.status(400).json({ success: false, error: 'rootPath is not a directory' })
      return
    }
  } catch {
    res.status(400).json({ success: false, error: 'rootPath not found' })
    return
  }

  const images = await collectImages(lib.root_path)
  let created = 0
  let updated = 0
  let skipped = 0
  const startedAt = Date.now()

  const upsert = db.prepare(`
    INSERT INTO photos(
      library_id, abs_path, rel_path, fingerprint, size, mtime_ms, width, height, taken_at, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?
    )
    ON CONFLICT(fingerprint) DO UPDATE SET
      abs_path = excluded.abs_path,
      rel_path = excluded.rel_path,
      library_id = excluded.library_id,
      size = excluded.size,
      mtime_ms = excluded.mtime_ms,
      updated_at = excluded.updated_at
  `)

  const selectId = db.prepare('SELECT id FROM photos WHERE fingerprint = ?')
  const now = nowIso()

  for (const img of images) {
    try {
      const st = await fs.stat(img.absPath)
      const fingerprint = await computeFingerprint({ absPath: img.absPath, size: st.size })
      const before = selectId.get(fingerprint) as { id: number } | undefined
      upsert.run(
        lib.id,
        img.absPath,
        img.relPath,
        fingerprint,
        st.size,
        st.mtimeMs,
        now,
        now,
      )
      const after = selectId.get(fingerprint) as { id: number } | undefined
      if (!before && after) created += 1
      else updated += 1
      if (after) ensurePhotoMeta(after.id)
    } catch {
      skipped += 1
    }
  }

  const elapsedMs = Date.now() - startedAt
  res.json({
    success: true,
    libraryId: lib.id,
    rootPath: lib.root_path,
    total: images.length,
    created,
    updated,
    skipped,
    elapsedMs,
  })
}))

router.post('/:id/identify', (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: 'invalid id' })
    return
  }

  const overwrite = Boolean(req.body?.overwrite)
  const limit = Number(req.body?.limit ?? 0)
  const job = createIdentifyLibraryJob({
    libraryId: id,
    overwrite,
    limit: Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : undefined,
  })
  res.json({ success: true, job })
})

export default router
