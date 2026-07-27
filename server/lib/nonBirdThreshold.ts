export type NonBirdCalibrationCase = {
  subjectType: 'bird' | 'non_bird' | 'unknown'
  detectorFound: boolean
  top1Score: number
}

export function selectNonBirdThreshold(
  cases: NonBirdCalibrationCase[],
  options: { minPrecision: number; maxBirdFalseRejects: number },
) {
  const labeled = cases.filter(
    (item) =>
      !item.detectorFound &&
      (item.subjectType === 'bird' || item.subjectType === 'non_bird') &&
      Number.isFinite(item.top1Score),
  )
  const nonBirdTotal = labeled.filter((item) => item.subjectType === 'non_bird').length
  const thresholds = [...new Set(labeled.map((item) => item.top1Score))]
    .filter((value) => value > 0)
    .sort((a, b) => a - b)
  const valid = thresholds.flatMap((threshold) => {
    const rejected = labeled.filter((item) => item.top1Score <= threshold)
    const correct = rejected.filter((item) => item.subjectType === 'non_bird').length
    const birdFalseRejects = rejected.filter((item) => item.subjectType === 'bird').length
    const precision = rejected.length ? correct / rejected.length : 0
    if (
      rejected.length === 0 ||
      precision < options.minPrecision ||
      birdFalseRejects > options.maxBirdFalseRejects
    ) {
      return []
    }
    return [{
      threshold,
      rejected: rejected.length,
      correct,
      precision,
      birdFalseRejects,
      nonBirdRecall: nonBirdTotal ? correct / nonBirdTotal : 0,
    }]
  })
  return valid.sort(
    (a, b) =>
      b.nonBirdRecall - a.nonBirdRecall ||
      b.precision - a.precision ||
      a.threshold - b.threshold,
  )[0] ?? null
}
