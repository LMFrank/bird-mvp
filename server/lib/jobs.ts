import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getDb, nowIso } from './catalog.js'
import { identifyWithAi, upsertPhotoAi } from './ai.js'
import { ensureThumb } from './thumbs.js'

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export type IdentifyLibraryJob = {
  id: string
  type: 'identify_library'
  status: JobStatus
  libraryId: number
  total: number
  processed: number
  succeeded: number
  failed: number
  skipped: number
  startedAt: string | null
  finishedAt: string | null
  currentPhotoId: number | null
  message: string | null
}

type IdentifyLibraryJobInternal = IdentifyLibraryJob & {
  cancelRequested: boolean
}

const jobs = new Map<string, IdentifyLibraryJobInternal>()

function toPublicJob(j: IdentifyLibraryJobInternal): IdentifyLibraryJob {
  return {
    id: j.id,
    type: j.type,
    status: j.status,
    libraryId: j.libraryId,
    total: j.total,
    processed: j.processed,
    succeeded: j.succeeded,
    failed: j.failed,
    skipped: j.skipped,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
    currentPhotoId: j.currentPhotoId,
    message: j.message,
  }
}

export function getJob(id: string): IdentifyLibraryJob | null {
  const j = jobs.get(id)
  if (!j) return null
  return toPublicJob(j)
}

export function cancelJob(id: string): boolean {
  const j = jobs.get(id)
  if (!j) return false
  j.cancelRequested = true
  if (j.status === 'queued') {
    j.status = 'cancelled'
    j.finishedAt = nowIso()
  }
  return true
}

export function createIdentifyLibraryJob(opts: {
  libraryId: number
  overwrite?: boolean
  limit?: number
}): IdentifyLibraryJob {
  const id = randomUUID()
  const j: IdentifyLibraryJobInternal = {
    id,
    type: 'identify_library',
    status: 'queued',
    libraryId: opts.libraryId,
    total: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    startedAt: null,
    finishedAt: null,
    currentPhotoId: null,
    message: null,
    cancelRequested: false,
  }
  jobs.set(id, j)
  void runIdentifyLibraryJob(j, opts)
  return toPublicJob(j)
}

async function runIdentifyLibraryJob(j: IdentifyLibraryJobInternal, opts: { overwrite?: boolean; limit?: number }) {
  j.status = 'running'
  j.startedAt = nowIso()

  try {
    const db = getDb()
    const overwrite = opts.overwrite === true
    const limit = Number.isFinite(opts.limit) ? Math.max(0, Number(opts.limit)) : 0

    const rows = db
      .prepare(
        `
        SELECT p.id, p.abs_path
        FROM photos p
        LEFT JOIN photo_ai ai ON ai.photo_id = p.id
        WHERE p.library_id = ?
          AND (${overwrite ? 1 : 0} = 1 OR ai.photo_id IS NULL)
        ORDER BY p.mtime_ms DESC
        ${limit ? 'LIMIT ' + limit : ''}
        `,
      )
      .all(j.libraryId) as { id: number; abs_path: string }[]

    j.total = rows.length

    const cacheDir =
      String(process.env.CACHE_DIR ?? '').trim() || path.join(process.cwd(), 'data', 'cache')

    for (const r of rows) {
      if (j.cancelRequested) {
        j.status = 'cancelled'
        j.finishedAt = nowIso()
        j.message = 'cancelled'
        return
      }

      j.currentPhotoId = r.id
      try {
        const thumbPath = await ensureThumb(cacheDir, r.id, r.abs_path, 2048)
        const jpg = await fs.readFile(thumbPath)
        const ai = await identifyWithAi(jpg)
        upsertPhotoAi(db, r.id, ai)
        j.succeeded += 1
      } catch (e: unknown) {
        j.failed += 1
        j.message = e instanceof Error && e.message ? e.message : 'identify failed'
      } finally {
        j.processed += 1
      }
    }

    j.status = 'done'
    j.finishedAt = nowIso()
    j.currentPhotoId = null
    j.message = null
  } catch (e: unknown) {
    j.status = 'error'
    j.finishedAt = nowIso()
    j.message = e instanceof Error && e.message ? e.message : 'job failed'
  }
}
