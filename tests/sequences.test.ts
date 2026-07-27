import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cosineSimilarity,
  fuseSequencePredictions,
  groupSequenceCandidates,
  selectRepresentativePhoto,
} from '../server/lib/sequences.js'

test('连拍只合并时间相邻且 embedding 相似的照片', () => {
  const groups = groupSequenceCandidates([
    { photoId: 1, takenAtMs: 1_000, embedding: [1, 0] },
    { photoId: 2, takenAtMs: 5_000, embedding: [0.99, 0.01] },
    { photoId: 3, takenAtMs: 7_000, embedding: [0, 1] },
    { photoId: 4, takenAtMs: 50_000, embedding: [1, 0] },
  ], { maxGapMs: 10_000, minSimilarity: 0.9 })
  assert.deepEqual(groups.map((g) => g.map((p) => p.photoId)), [[1, 2]])
  assert.ok(cosineSimilarity([1, 0], [0.99, 0.01]) > 0.99)
})

test('序列融合按主体面积加权且不修改单张原始结果', () => {
  const inputs = [
    {
      photoId: 1,
      subjectWeight: 1,
      predictions: [
        { nameScientific: 'A', score: 0.6 },
        { nameScientific: 'B', score: 0.4 },
      ],
    },
    {
      photoId: 2,
      subjectWeight: 3,
      predictions: [
        { nameScientific: 'B', score: 0.7 },
        { nameScientific: 'A', score: 0.3 },
      ],
    },
  ]
  const fused = fuseSequencePredictions(inputs, 5)
  assert.equal(fused[0]?.nameScientific, 'B')
  assert.equal(inputs[0].predictions[0]?.nameScientific, 'A')
})

test('代表照片优先主体面积与检测分数，无框时使用 margin', () => {
  assert.equal(selectRepresentativePhoto([
    { photoId: 1, boxAreaRatio: 0.1, detectorScore: 0.9, margin: 0.8 },
    { photoId: 2, boxAreaRatio: 0.3, detectorScore: 0.8, margin: 0.2 },
  ]), 2)
  assert.equal(selectRepresentativePhoto([
    { photoId: 3, boxAreaRatio: 0, detectorScore: 0, margin: 0.2 },
    { photoId: 4, boxAreaRatio: 0, detectorScore: 0, margin: 0.8 },
  ]), 4)
})
