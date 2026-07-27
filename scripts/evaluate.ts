import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { evaluatePredictions, type EvaluationCase } from '../server/lib/evaluation.js'

const dbPath = process.argv[2] || path.join(process.cwd(), 'data', 'cache', 'catalog.sqlite')
const libraryId = Number(process.argv[3] || 0)
const db = new DatabaseSync(dbPath, { readOnly: true })
const where = libraryId > 0 ? 'WHERE p.library_id=?' : ''
const params = libraryId > 0 ? [libraryId] : []
const rows = db.prepare(
  `SELECT c.status, c.subject_type, c.scene, c.name_scientific,
          a.result_json, a.decision, sm.sequence_id, s.fused_result_json
   FROM photo_species_confirmations c
   JOIN photos p ON p.id=c.photo_id
   LEFT JOIN photo_ai a ON a.photo_id=p.id
   LEFT JOIN photo_sequence_members sm ON sm.photo_id=p.id
   LEFT JOIN photo_sequences s ON s.id=sm.sequence_id
   ${where}
   ORDER BY c.updated_at DESC`,
).all(...params) as Array<{
  status: string
  subject_type: 'bird' | 'non_bird' | 'unknown'
  scene: 'wild' | 'captive' | 'unknown'
  name_scientific: string | null
  result_json: string | null
  decision: string | null
  sequence_id: number | null
  fused_result_json: string | null
}>

const cases: EvaluationCase[] = rows.map((row) => {
  let ai: {
    predictions?: EvaluationCase['predictions']
    decision?: string
    subjectDecision?: string
    elapsedMs?: number
    detectorEnabled?: boolean
    detectorFound?: boolean
  } = {}
  try {
    ai = row.result_json ? JSON.parse(row.result_json) : {}
  } catch {
    ai = {}
  }
  const decision = row.decision || ai.decision
  let sequencePredictions: EvaluationCase['sequencePredictions'] = []
  try {
    const fused = row.fused_result_json
      ? JSON.parse(row.fused_result_json) as { predictions?: EvaluationCase['sequencePredictions'] }
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
      ai.subjectDecision === 'bird' || ai.subjectDecision === 'non_bird'
        ? ai.subjectDecision
        : 'unknown',
    decision: decision === 'accepted' || decision === 'unknown' ? decision : 'review',
    predictions: Array.isArray(ai.predictions) ? ai.predictions : [],
    sequenceId: row.sequence_id,
    sequencePredictions,
    elapsedMs: typeof ai.elapsedMs === 'number' ? ai.elapsedMs : null,
    detectorEnabled: ai.detectorEnabled === true,
    detectorFound: ai.detectorFound === true,
  }
})

const metrics = evaluatePredictions(cases)
process.stdout.write(`${JSON.stringify({ dbPath, libraryId: libraryId || null, metrics }, null, 2)}\n`)
