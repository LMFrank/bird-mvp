import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluatePredictions } from '../server/lib/evaluation.js'

test('评测结果同时计算 Top1、Top5、拒识与自动通过精度', () => {
  const metrics = evaluatePredictions([
    {
      truthScientific: 'A',
      subjectType: 'bird',
      scene: 'wild',
      subjectDecision: 'bird',
      decision: 'accepted',
      predictions: [
        { nameScientific: 'A', score: 0.9 },
        { nameScientific: 'B', score: 0.1 },
      ],
    },
    {
      truthScientific: 'C',
      subjectType: 'bird',
      scene: 'captive',
      subjectDecision: 'bird',
      decision: 'review',
      predictions: [
        { nameScientific: 'B', score: 0.55 },
        { nameScientific: 'C', score: 0.4 },
      ],
    },
    {
      truthScientific: null,
      subjectType: 'non_bird',
      scene: 'unknown',
      subjectDecision: 'non_bird',
      decision: 'unknown',
      predictions: [],
    },
  ])

  assert.equal(metrics.birds.evaluated, 2)
  assert.equal(metrics.birds.top1Accuracy, 0.5)
  assert.equal(metrics.birds.top5Recall, 1)
  assert.equal(metrics.wild.top1Accuracy, 1)
  assert.equal(metrics.captive.top1Accuracy, 0)
  assert.equal(metrics.nonBird.total, 1)
  assert.equal(metrics.nonBird.rejected, 1)
  assert.equal(metrics.nonBird.rejectionRate, 1)
  assert.equal(metrics.automatic.acceptedPrecision, 1)
  assert.equal(metrics.automatic.coverage, 1 / 2)
  assert.equal(metrics.automatic.allInputCoverage, 1 / 3)
  assert.equal(metrics.birdFalseRejects, 0)
  assert.equal(metrics.total, 3)
})

test('没有可评测真值时返回 null 比例而不是伪造零准确率', () => {
  const metrics = evaluatePredictions([
    {
      truthScientific: null,
      subjectType: 'unknown',
      scene: 'unknown',
      subjectDecision: 'unknown',
      decision: 'unknown',
      predictions: [],
    },
  ])
  assert.equal(metrics.birds.evaluated, 0)
  assert.equal(metrics.birds.top1Accuracy, null)
  assert.equal(metrics.birds.top5Recall, null)
  assert.equal(metrics.automatic.acceptedPrecision, null)
})

test('自动通过精度与覆盖率只使用有物种真值的鸟图', () => {
  const metrics = evaluatePredictions([
    {
      truthScientific: 'A',
      subjectType: 'bird',
      scene: 'wild',
      subjectDecision: 'bird',
      decision: 'accepted',
      predictions: [{ nameScientific: 'A', score: 0.9 }],
    },
    {
      truthScientific: null,
      subjectType: 'bird',
      scene: 'unknown',
      subjectDecision: 'bird',
      decision: 'accepted',
      predictions: [{ nameScientific: 'B', score: 0.8 }],
    },
    {
      truthScientific: null,
      subjectType: 'non_bird',
      scene: 'unknown',
      subjectDecision: 'unknown',
      decision: 'review',
      predictions: [{ nameScientific: 'C', score: 0.7 }],
    },
  ])

  assert.equal(metrics.automatic.eligible, 1)
  assert.equal(metrics.automatic.accepted, 1)
  assert.equal(metrics.automatic.acceptedCorrect, 1)
  assert.equal(metrics.automatic.acceptedPrecision, 1)
  assert.equal(metrics.automatic.coverage, 1)
  assert.equal(metrics.automatic.allInputAccepted, 2)
  assert.equal(metrics.automatic.allInputCoverage, 2 / 3)
})

test('非鸟自动拒识精度按所有被判非鸟的有真值输入计算', () => {
  const metrics = evaluatePredictions([
    {
      truthScientific: null,
      subjectType: 'non_bird',
      scene: 'unknown',
      subjectDecision: 'non_bird',
      decision: 'unknown',
      predictions: [],
    },
    {
      truthScientific: 'A',
      subjectType: 'bird',
      scene: 'wild',
      subjectDecision: 'non_bird',
      decision: 'unknown',
      predictions: [{ nameScientific: 'A', score: 0.1 }],
    },
  ])
  assert.equal(metrics.nonBird.autoRejected, 2)
  assert.equal(metrics.nonBird.autoRejectedCorrect, 1)
  assert.equal(metrics.nonBird.autoRejectPrecision, 0.5)
  assert.equal(metrics.birdFalseRejects, 1)
})

test('评测同时报告连拍融合、检测召回和耗时分位数', () => {
  const metrics = evaluatePredictions([
    {
      truthScientific: 'A',
      subjectType: 'bird',
      scene: 'wild',
      subjectDecision: 'bird',
      decision: 'accepted',
      predictions: [{ nameScientific: 'A', score: 0.8 }],
      sequenceId: 7,
      sequencePredictions: [{ nameScientific: 'A', score: 0.9 }],
      elapsedMs: 100,
      detectorEnabled: true,
      detectorFound: true,
    },
    {
      truthScientific: 'A',
      subjectType: 'bird',
      scene: 'wild',
      subjectDecision: 'unknown',
      decision: 'review',
      predictions: [{ nameScientific: 'B', score: 0.6 }],
      sequenceId: 7,
      sequencePredictions: [{ nameScientific: 'A', score: 0.9 }],
      elapsedMs: 200,
      detectorEnabled: true,
      detectorFound: false,
    },
  ])
  assert.equal(metrics.sequences.groups, 1)
  assert.equal(metrics.sequences.rawConsistency, 0.5)
  assert.equal(metrics.sequences.fusedTop1Accuracy, 1)
  assert.equal(metrics.sequences.fusedTop5Recall, 1)
  assert.equal(metrics.detector.birdRecall, 0.5)
  assert.equal(metrics.detector.noBoxRate, 0.5)
  assert.equal(metrics.performance.meanMs, 150)
  assert.equal(metrics.performance.p95Ms, 200)
})
