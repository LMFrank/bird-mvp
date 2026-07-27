export type SequenceCandidate = {
  photoId: number
  takenAtMs: number
  embedding: number[]
}

export function cosineSimilarity(a: number[], b: number[]) {
  if (!a.length || a.length !== b.length) return 0
  let dot = 0
  let an = 0
  let bn = 0
  for (let i = 0; i < a.length; i += 1) {
    const av = Number(a[i] ?? 0)
    const bv = Number(b[i] ?? 0)
    dot += av * bv
    an += av * av
    bn += bv * bv
  }
  return an > 0 && bn > 0 ? dot / Math.sqrt(an * bn) : 0
}

export function groupSequenceCandidates(
  candidates: SequenceCandidate[],
  options: { maxGapMs: number; minSimilarity: number },
) {
  const sorted = [...candidates].sort((a, b) => a.takenAtMs - b.takenAtMs)
  const groups: SequenceCandidate[][] = []
  let current: SequenceCandidate[] = []
  for (const candidate of sorted) {
    const previous = current[current.length - 1]
    const sameSequence =
      previous &&
      candidate.takenAtMs - previous.takenAtMs <= options.maxGapMs &&
      cosineSimilarity(previous.embedding, candidate.embedding) >= options.minSimilarity
    if (sameSequence) {
      current.push(candidate)
      continue
    }
    if (current.length > 1) groups.push(current)
    current = [candidate]
  }
  if (current.length > 1) groups.push(current)
  return groups
}

export function fuseSequencePredictions(
  photos: Array<{
    photoId: number
    subjectWeight: number
    predictions: Array<{ nameZh?: string; nameScientific?: string; score: number }>
  }>,
  topk: number,
) {
  const scores = new Map<string, {
    nameZh?: string
    nameScientific?: string
    weightedScore: number
    weight: number
  }>()
  for (const photo of photos) {
    const weight = Math.max(0.01, Number(photo.subjectWeight) || 1)
    for (const prediction of photo.predictions) {
      const key = String(prediction.nameScientific || prediction.nameZh || '').trim()
      if (!key) continue
      const row = scores.get(key) ?? {
        nameZh: prediction.nameZh,
        nameScientific: prediction.nameScientific,
        weightedScore: 0,
        weight: 0,
      }
      row.weightedScore += Number(prediction.score || 0) * weight
      row.weight += weight
      scores.set(key, row)
    }
  }
  return [...scores.values()]
    .map((row) => ({
      nameZh: row.nameZh,
      nameScientific: row.nameScientific,
      score: row.weight > 0 ? row.weightedScore / row.weight : 0,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, topk))
}

export function selectRepresentativePhoto(
  photos: Array<{
    photoId: number
    boxAreaRatio: number
    detectorScore: number
    margin: number
  }>,
) {
  const withBox = photos.filter((photo) => photo.boxAreaRatio > 0)
  const ranked = withBox.length
    ? withBox.sort(
        (a, b) =>
          b.boxAreaRatio * b.detectorScore - a.boxAreaRatio * a.detectorScore ||
          b.margin - a.margin,
      )
    : [...photos].sort((a, b) => b.margin - a.margin)
  return ranked[0]?.photoId ?? null
}
