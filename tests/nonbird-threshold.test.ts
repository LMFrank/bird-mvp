import assert from 'node:assert/strict'
import test from 'node:test'
import { selectNonBirdThreshold } from '../server/lib/nonBirdThreshold.js'

test('阈值选择优先最大拒识召回，同时满足精度与鸟类误拒门槛', () => {
  const result = selectNonBirdThreshold([
    { subjectType: 'non_bird', detectorFound: false, top1Score: 0.05 },
    { subjectType: 'non_bird', detectorFound: false, top1Score: 0.1 },
    { subjectType: 'bird', detectorFound: false, top1Score: 0.08 },
    { subjectType: 'bird', detectorFound: false, top1Score: 0.4 },
  ], { minPrecision: 0.95, maxBirdFalseRejects: 0 })
  assert.equal(result?.threshold, 0.05)
  assert.equal(result?.precision, 1)
  assert.equal(result?.nonBirdRecall, 0.5)
})

test('没有安全阈值时保持禁用', () => {
  const result = selectNonBirdThreshold([
    { subjectType: 'bird', detectorFound: false, top1Score: 0.01 },
    { subjectType: 'non_bird', detectorFound: false, top1Score: 0.02 },
  ], { minPrecision: 0.95, maxBirdFalseRejects: 0 })
  assert.equal(result, null)
})
