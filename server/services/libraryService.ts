import fs from 'node:fs/promises'
import path from 'node:path'
import { collectImages } from '../lib/scan.js'
import { computeFingerprint } from '../lib/fingerprint.js'
import { ensurePhotoMeta, getDb, nowIso } from '../lib/catalog.js'
import { setRuntimeSetting } from '../lib/settings.js'
import { createIdentifyLibraryJob } from '../lib/jobs.js'
import {
  deletePhotosCascade,
  deleteLibraryAi,
  getLibraryById,
  getLibraryByRootPath,
  insertLibraryIgnore,
  listLibraryPhotoPaths,
  listLibraries,
  prepareSelectPhotoIdByFingerprint,
  prepareUpsertPhoto,
} from '../repos/libraryRepo.js'

export function listLibrariesService() {
  const db = getDb()
  return listLibraries(db)
}

export async function createLibraryService(rawRootPath: string) {
  const raw = String(rawRootPath ?? '').trim()
  if (!raw) return { ok: false as const, status: 400, error: 'rootPath is required' }

  if (/^[A-Za-z]:\\/.test(raw) && process.platform === 'linux') {
    return {
      ok: false as const,
      status: 400,
      error: '容器内无法访问 Windows 路径，请改用挂载到容器内的路径（例如 /photos）',
    }
  }

  const rootPath = path.resolve(raw)
  try {
    const st = await fs.stat(rootPath)
    if (!st.isDirectory()) return { ok: false as const, status: 400, error: 'rootPath is not a directory' }
  } catch {
    return { ok: false as const, status: 400, error: 'rootPath not found' }
  }

  const db = getDb()
  const createdAt = nowIso()
  const info = insertLibraryIgnore(db, rootPath, createdAt)
  const row = getLibraryByRootPath(db, rootPath)
  return { ok: true as const, library: row, inserted: info.changes > 0 }
}

export async function scanLibraryService(libraryId: number) {
  const db = getDb()
  const lib = getLibraryById(db, libraryId)
  if (!lib) return { ok: false as const, status: 404, error: 'library not found' }

  if (/^[A-Za-z]:\\/.test(lib.root_path) && process.platform === 'linux') {
    return {
      ok: false as const,
      status: 400,
      error: '容器内无法访问 Windows 路径，请改用挂载到容器内的路径（例如 /photos）',
    }
  }

  try {
    const st = await fs.stat(lib.root_path)
    if (!st.isDirectory()) return { ok: false as const, status: 400, error: 'rootPath is not a directory' }
  } catch {
    return { ok: false as const, status: 400, error: 'rootPath not found' }
  }

  const images = await collectImages(lib.root_path)
  let created = 0
  let updated = 0
  let skipped = 0
  const startedAt = Date.now()

  const upsert = prepareUpsertPhoto(db)
  const selectId = prepareSelectPhotoIdByFingerprint(db)
  const selectByAbsPath = db.prepare('SELECT id, fingerprint FROM photos WHERE library_id = ? AND abs_path = ?')
  const updatePhotoById = db.prepare(
    `
    UPDATE photos
    SET abs_path = ?, rel_path = ?, fingerprint = ?, size = ?, mtime_ms = ?, updated_at = ?
    WHERE id = ?
    `,
  )
  const updatePhotoPathById = db.prepare(
    `
    UPDATE photos
    SET abs_path = ?, rel_path = ?, size = ?, mtime_ms = ?, updated_at = ?
    WHERE id = ?
    `,
  )
  const selectAes = db.prepare('SELECT aesthetic_mtime_ms as m, aesthetic_score as s FROM photo_meta WHERE photo_id = ?')
  const now = nowIso()
  const scanned = new Set<string>()
  const normAbs = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p))
  const bins = new Array<number>(101).fill(0)
  const idsToDelete = new Set<number>()

  for (const img of images) {
    scanned.add(normAbs(img.absPath))
    try {
      const st = await fs.stat(img.absPath)
      const fingerprint = await computeFingerprint({ absPath: img.absPath, size: st.size })
      const rowAbs = selectByAbsPath.get(lib.id, img.absPath) as { id: number; fingerprint: string } | undefined
      const rowFp = selectId.get(lib.id, fingerprint) as { id: number } | undefined

      let photoId: number | null = null

      if (rowAbs) {
        if (rowFp && rowFp.id !== rowAbs.id) {
          updatePhotoPathById.run(img.absPath, img.relPath, st.size, st.mtimeMs, now, rowFp.id)
          idsToDelete.add(rowAbs.id)
          photoId = rowFp.id
        } else {
          updatePhotoById.run(img.absPath, img.relPath, fingerprint, st.size, st.mtimeMs, now, rowAbs.id)
          photoId = rowAbs.id
        }
        updated += 1
      } else {
        const before = rowFp
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
        const after = selectId.get(lib.id, fingerprint) as { id: number } | undefined
        photoId = after?.id ?? null
        if (!before && photoId) created += 1
        else updated += 1
      }

      if (photoId) {
        ensurePhotoMeta(photoId)
        const row = selectAes.get(photoId) as { m: number | null; s: number | null } | undefined
        const prev = typeof row?.m === 'number' && Number.isFinite(row.m) ? Math.trunc(row.m) : null
        const curr = Math.trunc(st.mtimeMs)
        const score: number | null =
          prev !== null && prev === curr && typeof row?.s === 'number' && Number.isFinite(row.s) ? row.s : null
        if (score !== null) {
          const b = Math.min(100, Math.max(0, Math.trunc(score)))
          bins[b] += 1
        }
      }
    } catch {
      skipped += 1
    }
  }

  if (idsToDelete.size) {
    deletePhotosCascade(db, Array.from(idsToDelete))
  }

  const existing = listLibraryPhotoPaths(db, lib.id)
  const removedIds = existing.filter((r) => !scanned.has(normAbs(r.abs_path))).map((r) => r.id)
  deletePhotosCascade(db, removedIds)

  const all = db
    .prepare(
      `
      SELECT p.id, p.abs_path, p.updated_at, COALESCE(m.rating, 0) as rating
      FROM photos p
      LEFT JOIN photo_meta m ON m.photo_id = p.id
      WHERE p.library_id = ?
      ORDER BY rating DESC, p.updated_at DESC, p.id DESC
      `,
    )
    .all(lib.id) as Array<{ id: number; abs_path: string; updated_at: string; rating: number }>
  const seenAbs = new Set<string>()
  const dupIds: number[] = []
  for (const r of all) {
    const k = normAbs(r.abs_path)
    if (seenAbs.has(k)) dupIds.push(r.id)
    else seenAbs.add(k)
  }
  if (dupIds.length) {
    deletePhotosCascade(db, dupIds)
  }

  const totalBinned = bins.reduce((a, b) => a + b, 0)
  if (totalBinned > 0) {
    const percentile = (p: number) => {
      const target = totalBinned * p
      let acc = 0
      for (let i = 0; i < bins.length; i += 1) {
        acc += bins[i]!
        if (acc >= target) return i
      }
      return 100
    }
    const p10 = percentile(0.1)
    const p90 = Math.max(p10 + 1, percentile(0.9))
    setRuntimeSetting(`AESTHETIC_P10_LIBRARY_${lib.id}`, String(p10))
    setRuntimeSetting(`AESTHETIC_P90_LIBRARY_${lib.id}`, String(p90))
    setRuntimeSetting(`AESTHETIC_CAL_COUNT_LIBRARY_${lib.id}`, String(totalBinned))
  }

  const elapsedMs = Date.now() - startedAt
  return {
    ok: true as const,
    libraryId: lib.id,
    rootPath: lib.root_path,
    total: images.length,
    created,
    updated,
    skipped,
    elapsedMs,
  }
}

export function createIdentifyLibraryJobService(opts: {
  libraryId: number
  overwrite?: boolean
  limit?: number
}) {
  return createIdentifyLibraryJob(opts)
}

export function deleteLibraryAiService(libraryId: number) {
  const db = getDb()
  deleteLibraryAi(db, libraryId)
  setRuntimeSetting(`AESTHETIC_P10_LIBRARY_${libraryId}`, null)
  setRuntimeSetting(`AESTHETIC_P90_LIBRARY_${libraryId}`, null)
  setRuntimeSetting(`AESTHETIC_CAL_COUNT_LIBRARY_${libraryId}`, null)
}
