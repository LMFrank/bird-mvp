import { getDb, nowIso } from '../lib/catalog.js'
import { buildPipelineFingerprint } from '../lib/pipeline.js'
import {
  fuseSequencePredictions,
  groupSequenceCandidates,
  selectRepresentativePhoto,
} from '../lib/sequences.js'
import { confirmPhotoSpeciesService } from './speciesService.js'

type SequenceRow = {
  photoId: number
  takenAt: string
  embeddingJson: string
  resultJson: string
  pipelineFingerprint: string | null
}

function parseAiResult(raw: string) {
  try {
    const parsed = JSON.parse(raw) as {
      predictions?: Array<{ nameZh?: string; nameScientific?: string; score: number }>
      roi?: {
        bestBoxAreaRatio?: number
        bestBoxScore?: number
      }
    }
    return {
      predictions: Array.isArray(parsed.predictions) ? parsed.predictions : [],
      boxAreaRatio: Number(parsed.roi?.bestBoxAreaRatio ?? 0),
      detectorScore: Number(parsed.roi?.bestBoxScore ?? 0),
    }
  } catch {
    return { predictions: [], boxAreaRatio: 0, detectorScore: 0 }
  }
}

export function listSequencesService(libraryId: number) {
  const db = getDb()
  return db.prepare(
    `SELECT s.id, s.representative_photo_id as representativePhotoId,
            s.pipeline_fingerprint as pipelineFingerprint,
            s.fused_result_json as fusedResultJson,
            COUNT(m.photo_id) as memberCount
     FROM photo_sequences s
     JOIN photo_sequence_members m ON m.sequence_id=s.id
     WHERE s.library_id=?
     GROUP BY s.id
     ORDER BY s.id`,
  ).all(libraryId).map((row) => {
    const item = row as {
      id: number
      representativePhotoId: number
      pipelineFingerprint: string
      fusedResultJson: string
      memberCount: number
    }
    return {
      id: item.id,
      representativePhotoId: item.representativePhotoId,
      pipelineFingerprint: item.pipelineFingerprint,
      memberCount: item.memberCount,
      fused: JSON.parse(item.fusedResultJson),
    }
  })
}

export function rebuildSequencesService(
  libraryId: number,
  options: { maxGapMs?: number; minSimilarity?: number } = {},
) {
  const db = getDb()
  const maxGapMs = Math.max(1_000, Number(options.maxGapMs ?? 10_000))
  const minSimilarity = Math.min(1, Math.max(-1, Number(options.minSimilarity ?? 0.9)))
  const rows = db.prepare(
    `SELECT p.id as photoId, p.taken_at as takenAt,
            e.embedding_json as embeddingJson,
            a.result_json as resultJson,
            a.pipeline_fingerprint as pipelineFingerprint
     FROM photos p
     JOIN photo_sequence_embeddings e ON e.photo_id=p.id
     JOIN photo_ai a ON a.photo_id=p.id
     WHERE p.library_id=? AND p.taken_at IS NOT NULL
     ORDER BY p.taken_at, p.id`,
  ).all(libraryId) as SequenceRow[]
  const byId = new Map(rows.map((row) => [row.photoId, row]))
  const groups = groupSequenceCandidates(
    rows.map((row) => ({
      photoId: row.photoId,
      takenAtMs: Date.parse(row.takenAt),
      embedding: JSON.parse(row.embeddingJson) as number[],
    })).filter((row) => Number.isFinite(row.takenAtMs)),
    { maxGapMs, minSimilarity },
  )

  const now = nowIso()
  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM photo_sequences WHERE library_id=?').run(libraryId)
    for (const group of groups) {
      const members = group.map((member) => {
        const row = byId.get(member.photoId)!
        const ai = parseAiResult(row.resultJson)
        const first = ai.predictions[0]
        const second = ai.predictions[1]
        const margin = first ? Number(first.score) - Number(second?.score ?? 0) : 0
        const subjectWeight = ai.boxAreaRatio > 0
          ? Math.max(0.01, ai.boxAreaRatio * Math.max(0.01, ai.detectorScore))
          : Math.max(0.01, margin)
        return {
          photoId: member.photoId,
          predictions: ai.predictions,
          subjectWeight,
          boxAreaRatio: ai.boxAreaRatio,
          detectorScore: ai.detectorScore,
          margin,
          pipelineFingerprint: row.pipelineFingerprint,
        }
      })
      const predictions = fuseSequencePredictions(members, 5)
      const representativePhotoId = selectRepresentativePhoto(members)
      const rawTop1 = members.map((member) => member.predictions[0]?.nameScientific ?? null)
      const majority = rawTop1
        .filter(Boolean)
        .map((name) => ({
          name,
          count: rawTop1.filter((candidate) => candidate === name).length,
        }))
        .sort((a, b) => b.count - a.count)[0]
      const consistency = majority ? majority.count / members.length : 0
      const pipelineFingerprint = buildPipelineFingerprint({
        kind: 'sequence_fused',
        maxGapMs,
        minSimilarity,
        memberPipelines: [...new Set(members.map((member) => member.pipelineFingerprint))].sort(),
      })
      const fused = {
        provider: 'sequence_fused',
        predictions,
        consistency,
        memberPhotoIds: members.map((member) => member.photoId),
      }
      const sequenceId = Number(db.prepare(
        `INSERT INTO photo_sequences(
           library_id, representative_photo_id, pipeline_fingerprint,
           fused_result_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        libraryId,
        representativePhotoId,
        pipelineFingerprint,
        JSON.stringify(fused),
        now,
        now,
      ).lastInsertRowid)
      const insertMember = db.prepare(
        `INSERT INTO photo_sequence_members(sequence_id, photo_id, subject_weight)
         VALUES (?, ?, ?)`,
      )
      for (const member of members) {
        insertMember.run(sequenceId, member.photoId, member.subjectWeight)
      }
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return listSequencesService(libraryId)
}

export function confirmSequenceService(
  libraryId: number,
  sequenceId: number,
  body: {
    sourcePhotoId?: unknown
    status?: unknown
    subjectType?: unknown
    scene?: unknown
    nameZh?: unknown
    nameScientific?: unknown
    note?: unknown
  },
) {
  const db = getDb()
  const members = db.prepare(
    `SELECT m.photo_id as photoId
     FROM photo_sequence_members m
     JOIN photo_sequences s ON s.id=m.sequence_id
     WHERE s.library_id=? AND s.id=?
     ORDER BY m.photo_id`,
  ).all(libraryId, sequenceId) as Array<{ photoId: number }>
  const sourcePhotoId = Number(body.sourcePhotoId)
  if (!members.length) return null
  if (!members.some((member) => member.photoId === sourcePhotoId)) {
    throw new Error('sourcePhotoId must be a member of the sequence')
  }
  for (const member of members) {
    confirmPhotoSpeciesService(member.photoId, {
      ...body,
      sourcePhotoId: member.photoId === sourcePhotoId ? undefined : sourcePhotoId,
    })
  }
  return { count: members.length }
}
