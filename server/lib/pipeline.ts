import { createHash } from 'node:crypto'

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, stable(child)]),
    )
  }
  return value
}

export function buildPipelineFingerprint(config: unknown) {
  return createHash('sha256').update(JSON.stringify(stable(config))).digest('hex').slice(0, 16)
}

export function decidePrediction(
  predictions: Array<{ score: number }>,
  thresholds: { minScore: number; minMargin: number },
): 'accepted' | 'review' | 'unknown' {
  const first = predictions[0]
  if (!first) return 'unknown'
  const second = predictions[1]
  const margin = second ? first.score - second.score : first.score
  return first.score >= thresholds.minScore && margin >= thresholds.minMargin ? 'accepted' : 'review'
}

export type SubjectDecision = 'bird' | 'non_bird' | 'unknown'

export function decideSubject(
  predictions: Array<{ score: number }>,
  options: {
    detectorEnabled: boolean
    detectorFound: boolean
    nonBirdMaxScore: number
  },
): { subjectDecision: SubjectDecision; decisionReason: string } {
  if (options.detectorEnabled && options.detectorFound) {
    return { subjectDecision: 'bird', decisionReason: 'bird_detected' }
  }
  if (!options.detectorEnabled) {
    return { subjectDecision: 'unknown', decisionReason: 'detector_disabled' }
  }
  if (!(options.nonBirdMaxScore > 0)) {
    return { subjectDecision: 'unknown', decisionReason: 'non_bird_threshold_disabled' }
  }
  const top1 = Number(predictions[0]?.score ?? 0)
  if (top1 <= options.nonBirdMaxScore) {
    return {
      subjectDecision: 'non_bird',
      decisionReason: 'no_bird_detection_low_bioclip',
    }
  }
  return {
    subjectDecision: 'unknown',
    decisionReason: 'no_bird_detection_high_bioclip',
  }
}
