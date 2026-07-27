import { getDb, nowIso } from '../lib/catalog.js'
import {
  evaluateLibrary,
  getPhotoConfirmation,
  listSpeciesAssets,
  type ConfirmationStatus,
  upsertPhotoConfirmation,
} from '../repos/speciesRepo.js'

export function confirmPhotoSpeciesService(
  photoId: number,
  body: {
    status?: unknown
    subjectType?: unknown
    scene?: unknown
    nameZh?: unknown
    nameScientific?: unknown
    note?: unknown
    sourcePhotoId?: unknown
  },
) {
  const db = getDb()
  const exists = db.prepare('SELECT 1 ok FROM photos WHERE id=?').get(photoId)
  if (!exists) return null
  const status: ConfirmationStatus =
    body.status === 'confirmed' || body.status === 'rejected' || body.status === 'unknown'
      ? body.status
      : 'unknown'
  const subjectType =
    body.subjectType === 'bird' || body.subjectType === 'non_bird' || body.subjectType === 'unknown'
      ? body.subjectType
      : status === 'confirmed'
        ? 'bird'
        : 'unknown'
  const scene =
    body.scene === 'wild' || body.scene === 'captive' || body.scene === 'unknown'
      ? body.scene
      : 'unknown'
  const nameZh = typeof body.nameZh === 'string' && body.nameZh.trim() ? body.nameZh.trim() : null
  const nameScientific =
    typeof body.nameScientific === 'string' && body.nameScientific.trim()
      ? body.nameScientific.trim()
      : null
  if (status === 'confirmed' && (subjectType !== 'bird' || !nameScientific)) {
    throw new Error('confirmed status requires a bird subject and nameScientific')
  }
  if (subjectType === 'non_bird' && (nameZh || nameScientific)) {
    throw new Error('non_bird truth cannot include species names')
  }
  if (subjectType !== 'bird' && scene !== 'unknown') {
    throw new Error('scene is only valid for bird subjects')
  }
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null
  const sourcePhotoId = Number(body.sourcePhotoId)
  return upsertPhotoConfirmation(db, {
    photoId,
    status,
    subjectType,
    scene,
    nameZh: subjectType === 'non_bird' ? null : nameZh,
    nameScientific: subjectType === 'non_bird' ? null : nameScientific,
    note,
    source: Number.isInteger(sourcePhotoId) && sourcePhotoId > 0 ? 'sequence_propagated' : 'human',
    sourcePhotoId: Number.isInteger(sourcePhotoId) && sourcePhotoId > 0 ? sourcePhotoId : null,
    now: nowIso(),
  })
}

export function getPhotoConfirmationService(photoId: number) {
  return getPhotoConfirmation(getDb(), photoId)
}

export function listSpeciesAssetsService(libraryId: number) {
  return listSpeciesAssets(getDb(), libraryId)
}

export function evaluateLibraryService(libraryId: number) {
  return evaluateLibrary(getDb(), libraryId)
}
