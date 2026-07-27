export type EvaluationCase = {
  truthScientific: string | null
  subjectType: 'bird' | 'non_bird' | 'unknown'
  scene: 'wild' | 'captive' | 'unknown'
  subjectDecision: 'bird' | 'non_bird' | 'unknown'
  decision: 'accepted' | 'review' | 'unknown'
  predictions: Array<{ nameScientific?: string; score: number }>
  sequenceId?: number | null
  sequencePredictions?: Array<{ nameScientific?: string; score: number }>
  elapsedMs?: number | null
  detectorEnabled?: boolean
  detectorFound?: boolean
}

function ratio(n: number, d: number) {
  return d > 0 ? n / d : null
}

function speciesMetrics(cases: EvaluationCase[]) {
  const withTruth = cases.filter(
    (c) => c.subjectType === 'bird' && Boolean(c.truthScientific),
  )
  const top1Correct = withTruth.filter((c) => c.predictions[0]?.nameScientific === c.truthScientific).length
  const top5Correct = withTruth.filter((c) =>
    c.predictions.slice(0, 5).some((p) => p.nameScientific === c.truthScientific),
  ).length
  return {
    evaluated: withTruth.length,
    top1Correct,
    top5Correct,
    top1Accuracy: ratio(top1Correct, withTruth.length),
    top5Recall: ratio(top5Correct, withTruth.length),
  }
}

export function evaluatePredictions(cases: EvaluationCase[]) {
  const birdCases = cases.filter((c) => c.subjectType === 'bird')
  const nonBirdCases = cases.filter((c) => c.subjectType === 'non_bird')
  const automaticEligible = birdCases.filter((c) => Boolean(c.truthScientific))
  const acceptedCases = automaticEligible.filter((c) => c.decision === 'accepted')
  const allInputAccepted = cases.filter((c) => c.decision === 'accepted')
  const acceptedCorrect = acceptedCases.filter(
    (c) =>
      c.subjectType === 'bird' &&
      Boolean(c.truthScientific) &&
      c.predictions[0]?.nameScientific === c.truthScientific,
  ).length
  const autoRejected = cases.filter((c) => c.subjectDecision === 'non_bird')
  const autoRejectedCorrect = autoRejected.filter((c) => c.subjectType === 'non_bird').length
  const review = cases.filter((c) => c.decision === 'review').length
  const unknown = cases.filter((c) => c.decision === 'unknown').length
  const birds = speciesMetrics(birdCases)
  const wild = speciesMetrics(birdCases.filter((c) => c.scene === 'wild'))
  const captive = speciesMetrics(birdCases.filter((c) => c.scene === 'captive'))
  const elapsed = cases
    .map((c) => Number(c.elapsedMs))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b)
  const detectorCases = cases.filter((c) => c.detectorEnabled)
  const detectorBirdCases = detectorCases.filter((c) => c.subjectType === 'bird')
  const sequenceGroups = new Map<number, EvaluationCase[]>()
  for (const item of cases) {
    if (typeof item.sequenceId !== 'number') continue
    const group = sequenceGroups.get(item.sequenceId) ?? []
    group.push(item)
    sequenceGroups.set(item.sequenceId, group)
  }
  const consistentRatios = [...sequenceGroups.values()].map((group) => {
    const names = group.map((item) => item.predictions[0]?.nameScientific ?? '')
    const counts = new Map<string, number>()
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
    return Math.max(0, ...counts.values()) / group.length
  })
  const fusedCases = birdCases
    .filter((item) => typeof item.sequenceId === 'number' && item.sequencePredictions?.length)
    .map((item) => ({ ...item, predictions: item.sequencePredictions ?? [] }))
  const fused = speciesMetrics(fusedCases)

  return {
    total: cases.length,
    birds,
    wild,
    captive,
    nonBird: {
      total: nonBirdCases.length,
      rejected: nonBirdCases.filter((c) => c.subjectDecision === 'non_bird').length,
      rejectionRate: ratio(
        nonBirdCases.filter((c) => c.subjectDecision === 'non_bird').length,
        nonBirdCases.length,
      ),
      autoRejected: autoRejected.length,
      autoRejectedCorrect,
      autoRejectPrecision: ratio(autoRejectedCorrect, autoRejected.length),
    },
    birdFalseRejects: birdCases.filter((c) => c.subjectDecision === 'non_bird').length,
    automatic: {
      eligible: automaticEligible.length,
      accepted: acceptedCases.length,
      acceptedCorrect,
      acceptedPrecision: ratio(acceptedCorrect, acceptedCases.length),
      coverage: ratio(acceptedCases.length, automaticEligible.length),
      allInputAccepted: allInputAccepted.length,
      allInputCoverage: ratio(allInputAccepted.length, cases.length),
    },
    detector: {
      enabled: detectorCases.length,
      found: detectorCases.filter((c) => c.detectorFound).length,
      birdRecall: ratio(
        detectorBirdCases.filter((c) => c.detectorFound).length,
        detectorBirdCases.length,
      ),
      noBoxRate: ratio(
        detectorCases.filter((c) => !c.detectorFound).length,
        detectorCases.length,
      ),
    },
    performance: {
      samples: elapsed.length,
      meanMs: elapsed.length
        ? elapsed.reduce((sum, value) => sum + value, 0) / elapsed.length
        : null,
      p95Ms: elapsed.length
        ? elapsed[Math.max(0, Math.ceil(elapsed.length * 0.95) - 1)]!
        : null,
    },
    sequences: {
      groups: sequenceGroups.size,
      rawConsistency: consistentRatios.length
        ? consistentRatios.reduce((sum, value) => sum + value, 0) / consistentRatios.length
        : null,
      fusedEvaluated: fused.evaluated,
      fusedTop1Accuracy: fused.top1Accuracy,
      fusedTop5Recall: fused.top5Recall,
    },
    review,
    unknown,
    reviewRate: ratio(review, cases.length),
    unknownRate: ratio(unknown, cases.length),
    // Backward-compatible fields for the existing asset panel.
    evaluated: birds.evaluated,
    top1Correct: birds.top1Correct,
    top5Correct: birds.top5Correct,
    top1Accuracy: birds.top1Accuracy,
    top5Recall: birds.top5Recall,
    accepted: acceptedCases.length,
    acceptedCorrect,
    acceptedPrecision: ratio(acceptedCorrect, acceptedCases.length),
  }
}
