import type { DatabaseSync } from 'node:sqlite'
import { evaluatePredictions, type EvaluationCase } from '../lib/evaluation.js'

export type ConfirmationStatus = 'confirmed' | 'rejected' | 'unknown'
export type SubjectType = 'bird' | 'non_bird' | 'unknown'
export type BirdScene = 'wild' | 'captive' | 'unknown'

export function getPhotoConfirmation(db: DatabaseSync, photoId: number) {
  return db.prepare(
    `SELECT photo_id as photoId, status, subject_type as subjectType, scene,
            name_zh as nameZh, name_scientific as nameScientific,
            source, source_photo_id as sourcePhotoId, note,
            created_at as createdAt, updated_at as updatedAt
     FROM photo_species_confirmations WHERE photo_id = ?`,
  ).get(photoId)
}

export function upsertPhotoConfirmation(
  db: DatabaseSync,
  input: {
    photoId: number
    status: ConfirmationStatus
    subjectType: SubjectType
    scene: BirdScene
    nameZh: string | null
    nameScientific: string | null
    note: string | null
    source: 'human' | 'sequence_propagated'
    sourcePhotoId: number | null
    now: string
  },
) {
  db.prepare(
    `INSERT INTO photo_species_confirmations(
       photo_id, status, subject_type, scene, name_zh, name_scientific,
       source, source_photo_id, note, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(photo_id) DO UPDATE SET
       status=excluded.status, subject_type=excluded.subject_type, scene=excluded.scene,
       name_zh=excluded.name_zh, name_scientific=excluded.name_scientific,
       source=excluded.source, source_photo_id=excluded.source_photo_id,
       note=excluded.note, updated_at=excluded.updated_at`,
  ).run(
    input.photoId,
    input.status,
    input.subjectType,
    input.scene,
    input.nameZh,
    input.nameScientific,
    input.source,
    input.sourcePhotoId,
    input.note,
    input.now,
    input.now,
  )
  return getPhotoConfirmation(db, input.photoId)
}

export function listSpeciesAssets(db: DatabaseSync, libraryId: number) {
  return db.prepare(
    `WITH confirmed AS (
       SELECT c.name_scientific, MAX(c.name_zh) name_zh, COUNT(*) confirmed_count,
              MAX(c.photo_id) best_photo_id, MAX(p.taken_at) latest_at
       FROM photo_species_confirmations c
       JOIN photos p ON p.id=c.photo_id
       WHERE p.library_id=? AND c.status='confirmed' AND c.name_scientific IS NOT NULL
       GROUP BY c.name_scientific
     ),
     predicted AS (
       SELECT ap.name_scientific, MAX(ap.name_zh) name_zh, COUNT(*) predicted_count,
              MAX(ap.photo_id) predicted_photo_id
       FROM photo_ai_predictions ap
       JOIN photos p ON p.id=ap.photo_id
       WHERE p.library_id=? AND ap.rank=1 AND ap.name_scientific IS NOT NULL
       GROUP BY ap.name_scientific
     ),
     names AS (
       SELECT name_scientific FROM confirmed UNION SELECT name_scientific FROM predicted
     )
     SELECT names.name_scientific as nameScientific,
            COALESCE(confirmed.name_zh, predicted.name_zh) as nameZh,
            COALESCE(confirmed.confirmed_count, 0) as confirmedCount,
            COALESCE(predicted.predicted_count, 0) as predictedCount,
            COALESCE(confirmed.best_photo_id, predicted.predicted_photo_id) as bestPhotoId,
            confirmed.latest_at as latestAt
     FROM names
     LEFT JOIN confirmed USING(name_scientific)
     LEFT JOIN predicted USING(name_scientific)
     ORDER BY confirmedCount DESC, predictedCount DESC, nameZh ASC`,
  ).all(libraryId, libraryId)
}

export function evaluateLibrary(db: DatabaseSync, libraryId: number) {
  const rows = db.prepare(
    `SELECT c.status, c.subject_type, c.scene, c.name_scientific,
            a.result_json, a.decision,
            sm.sequence_id, s.fused_result_json
     FROM photo_species_confirmations c
     JOIN photos p ON p.id=c.photo_id
     LEFT JOIN photo_ai a ON a.photo_id=p.id
     LEFT JOIN photo_sequence_members sm ON sm.photo_id=p.id
     LEFT JOIN photo_sequences s ON s.id=sm.sequence_id
     WHERE p.library_id=?`,
  ).all(libraryId) as Array<{
    status: ConfirmationStatus
    subject_type: SubjectType
    scene: BirdScene
    name_scientific: string | null
    result_json: string | null
    decision: string | null
    sequence_id: number | null
    fused_result_json: string | null
  }>

  const cases: EvaluationCase[] = rows.map((row) => {
    let parsed: {
      predictions?: Array<{ nameScientific?: string; score: number }>
      decision?: string
      subjectDecision?: string
      elapsedMs?: number
      detectorEnabled?: boolean
      detectorFound?: boolean
    } = {}
    try {
      parsed = row.result_json ? JSON.parse(row.result_json) : {}
    } catch {
      parsed = {}
    }
    const decision = row.decision || parsed.decision
    let sequencePredictions: Array<{ nameScientific?: string; score: number }> = []
    try {
      const fused = row.fused_result_json
        ? JSON.parse(row.fused_result_json) as { predictions?: typeof sequencePredictions }
        : {}
      sequencePredictions = Array.isArray(fused.predictions) ? fused.predictions : []
    } catch {
      sequencePredictions = []
    }
    return {
      truthScientific: row.status === 'confirmed' ? row.name_scientific : null,
      subjectType: row.subject_type,
      scene: row.scene,
      subjectDecision:
        parsed.subjectDecision === 'bird' || parsed.subjectDecision === 'non_bird'
          ? parsed.subjectDecision
          : 'unknown',
      decision: decision === 'accepted' || decision === 'unknown' ? decision : 'review',
      predictions: Array.isArray(parsed.predictions) ? parsed.predictions : [],
      sequenceId: row.sequence_id,
      sequencePredictions,
      elapsedMs: typeof parsed.elapsedMs === 'number' ? parsed.elapsedMs : null,
      detectorEnabled: parsed.detectorEnabled === true,
      detectorFound: parsed.detectorFound === true,
    }
  })
  return evaluatePredictions(cases)
}
