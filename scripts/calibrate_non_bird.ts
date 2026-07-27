import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { selectNonBirdThreshold } from '../server/lib/nonBirdThreshold.js'

const dbPath = process.argv[2] || path.join(process.cwd(), 'data', 'cache', 'catalog.sqlite')
const db = new DatabaseSync(dbPath, { readOnly: true })
const rows = db.prepare(
  `SELECT c.subject_type, a.result_json
   FROM photo_species_confirmations c
   JOIN photo_ai a ON a.photo_id=c.photo_id
   WHERE c.subject_type IN ('bird', 'non_bird')`,
).all() as Array<{ subject_type: 'bird' | 'non_bird'; result_json: string }>

const cases = rows.flatMap((row) => {
  try {
    const result = JSON.parse(row.result_json) as {
      detectorFound?: boolean
      predictions?: Array<{ score?: number }>
    }
    return [{
      subjectType: row.subject_type,
      detectorFound: result.detectorFound === true,
      top1Score: Number(result.predictions?.[0]?.score ?? 0),
    }]
  } catch {
    return []
  }
})
const recommendation = selectNonBirdThreshold(cases, {
  minPrecision: 0.95,
  maxBirdFalseRejects: 1,
})
process.stdout.write(`${JSON.stringify({
  dbPath,
  samples: cases.length,
  recommendation,
  enabled: Boolean(recommendation),
  env: recommendation ? `NON_BIRD_MAX_SCORE=${recommendation.threshold}` : 'NON_BIRD_MAX_SCORE=0',
}, null, 2)}\n`)
