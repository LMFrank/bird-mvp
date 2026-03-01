import fs from 'node:fs/promises'
import path from 'node:path'
import { collectImages } from '../lib/scan.js'
import { computeFingerprint } from '../lib/fingerprint.js'
import { ensurePhotoMeta, getDb, nowIso } from '../lib/catalog.js'
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
  const now = nowIso()
  const scanned = new Set<string>()
  const normAbs = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p))

  for (const img of images) {
    scanned.add(normAbs(img.absPath))
    try {
      const st = await fs.stat(img.absPath)
      const fingerprint = await computeFingerprint({ absPath: img.absPath, size: st.size })
      const before = selectId.get(lib.id, fingerprint) as { id: number } | undefined
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
      if (!before && after) created += 1
      else updated += 1
      if (after) ensurePhotoMeta(after.id)
    } catch {
      skipped += 1
    }
  }

  const existing = listLibraryPhotoPaths(db, lib.id)
  const removedIds = existing.filter((r) => !scanned.has(normAbs(r.abs_path))).map((r) => r.id)
  deletePhotosCascade(db, removedIds)

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
}
