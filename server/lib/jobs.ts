import { randomUUID } from 'node:crypto'
import { getDb, nowIso } from './catalog.js'
import { identifyWithAi, mergeAiResults, upsertPhotoAi } from './ai.js'
import { buildIdentifyJpegsFromPath, getIdentifyInputOptionsFromEnv } from './identifyInput.js'
import { getJobRow, insertJob, requestCancel, updateJobRow } from '../repos/jobRepo.js'

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

const maxConcurrency = Math.max(1, Number(process.env.JOB_CONCURRENCY ?? 1))
let active = 0
const waiters: Array<() => void> = []

async function acquire() {
  if (active < maxConcurrency) {
    active += 1
    return
  }
  await new Promise<void>((resolve) => waiters.push(resolve))
  active += 1
}

function release() {
  active = Math.max(0, active - 1)
  const next = waiters.shift()
  if (next) next()
}

async function runLimited<T>(fn: () => Promise<T>) {
  await acquire()
  try {
    return await fn()
  } finally {
    release()
  }
}

const running = new Map<string, IdentifyLibraryJobInternal>()

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
  const db = getDb()
  const row = getJobRow(db, id)
  if (!row) return null
  try {
    const parsed = JSON.parse(row.job_json) as IdentifyLibraryJob
    return parsed
  } catch {
    return null
  }
}

export function cancelJob(id: string): boolean {
  const db = getDb()
  const row = getJobRow(db, id)
  if (!row) return false

  requestCancel(db, id, nowIso())
  const mem = running.get(id)
  if (mem) mem.cancelRequested = true

  if (row.status === 'queued') {
    const job = JSON.parse(row.job_json) as IdentifyLibraryJob
    const updated: IdentifyLibraryJob = {
      ...job,
      status: 'cancelled',
      finishedAt: nowIso(),
      message: 'cancelled',
    }
    updateJobRow(db, id, { status: updated.status, job_json: JSON.stringify(updated), updated_at: nowIso() })
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
  const createdAt = nowIso()
  const db = getDb()
  insertJob(db, {
    id,
    type: j.type,
    status: j.status,
    job_json: JSON.stringify(toPublicJob(j)),
    cancel_requested: 0,
    created_at: createdAt,
  })

  running.set(id, j)
  void runLimited(async () => {
    try {
      await runIdentifyLibraryJob(j, opts)
    } finally {
      running.delete(id)
    }
  })
  return toPublicJob(j)
}

async function runIdentifyLibraryJob(j: IdentifyLibraryJobInternal, opts: { overwrite?: boolean; limit?: number }) {
  j.status = 'running'
  j.startedAt = nowIso()
  persistJob(j)

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
    persistJob(j)

    const optsIdentify = getIdentifyInputOptionsFromEnv()

    for (const r of rows) {
      if (j.cancelRequested || isCancelRequested(j.id)) {
        j.status = 'cancelled'
        j.finishedAt = nowIso()
        j.message = 'cancelled'
        persistJob(j)
        return
      }

      j.currentPhotoId = r.id
      persistJob(j)
      try {
        console.log(`[Job] Identifying Photo #${r.id}: ${r.abs_path}`)
        const inputs = await buildIdentifyJpegsFromPath(r.abs_path, {
          maxSize: optsIdentify.maxSize,
          quality: optsIdentify.quality,
          crops: optsIdentify.cropsBatch,
          cropScale: optsIdentify.cropScale,
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
        console.log(
          `[Job] Result for Photo #${r.id}: ${ai.predictions[0]?.nameZh ?? ai.predictions[0]?.nameScientific} (${ai.predictions[0]?.score})`,
        )
        upsertPhotoAi(db, r.id, ai)
        j.succeeded += 1
      } catch (e: unknown) {
        j.failed += 1
        j.message = e instanceof Error && e.message ? e.message : 'identify failed'
      } finally {
        j.processed += 1
        persistJob(j)
      }
    }

    j.status = 'done'
    j.finishedAt = nowIso()
    j.currentPhotoId = null
    j.message = null
    persistJob(j)
  } catch (e: unknown) {
    j.status = 'error'
    j.finishedAt = nowIso()
    j.message = e instanceof Error && e.message ? e.message : 'job failed'
    persistJob(j)
  }
}

function persistJob(j: IdentifyLibraryJobInternal) {
  const db = getDb()
  updateJobRow(db, j.id, {
    status: j.status,
    job_json: JSON.stringify(toPublicJob(j)),
    updated_at: nowIso(),
  })
}

function isCancelRequested(id: string): boolean {
  const db = getDb()
  const row = getJobRow(db, id)
  return row ? row.cancel_requested === 1 : false
}
