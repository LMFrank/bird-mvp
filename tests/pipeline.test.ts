import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildPipelineFingerprint,
  decidePrediction,
  decideSubject,
} from '../server/lib/pipeline.js'

test('pipeline fingerprint 对键顺序稳定且配置变化会改变', () => {
  const a = buildPipelineFingerprint({ model: 'bioclip-2', labelsHash: 'abc', detector: { imgsz: 960, model: 'yolov8n.pt' } })
  const b = buildPipelineFingerprint({ detector: { model: 'yolov8n.pt', imgsz: 960 }, labelsHash: 'abc', model: 'bioclip-2' })
  const c = buildPipelineFingerprint({ model: 'bioclip-2', labelsHash: 'abc', detector: { imgsz: 1280, model: 'yolov8n.pt' } })
  assert.equal(a, b)
  assert.notEqual(a, c)
})

test('决策规则区分自动通过、待复核和未知', () => {
  assert.equal(decidePrediction([], { minScore: 0.65, minMargin: 0.12 }), 'unknown')
  assert.equal(decidePrediction([{ score: 0.8 }, { score: 0.5 }], { minScore: 0.65, minMargin: 0.12 }), 'accepted')
  assert.equal(decidePrediction([{ score: 0.6 }, { score: 0.2 }], { minScore: 0.65, minMargin: 0.12 }), 'review')
  assert.equal(decidePrediction([{ score: 0.8 }, { score: 0.74 }], { minScore: 0.65, minMargin: 0.12 }), 'review')
})

test('检测证据优先，未检出时只在显式阈值内拒识非鸟', () => {
  assert.deepEqual(
    decideSubject([{ score: 0.8 }, { score: 0.1 }], {
      detectorEnabled: true,
      detectorFound: true,
      nonBirdMaxScore: 0.2,
    }),
    { subjectDecision: 'bird', decisionReason: 'bird_detected' },
  )
  assert.deepEqual(
    decideSubject([{ score: 0.1 }], {
      detectorEnabled: true,
      detectorFound: false,
      nonBirdMaxScore: 0.2,
    }),
    { subjectDecision: 'non_bird', decisionReason: 'no_bird_detection_low_bioclip' },
  )
  assert.deepEqual(
    decideSubject([{ score: 0.8 }], {
      detectorEnabled: true,
      detectorFound: false,
      nonBirdMaxScore: 0.2,
    }),
    { subjectDecision: 'unknown', decisionReason: 'no_bird_detection_high_bioclip' },
  )
  assert.deepEqual(
    decideSubject([{ score: 0.01 }], {
      detectorEnabled: true,
      detectorFound: false,
      nonBirdMaxScore: 0,
    }),
    { subjectDecision: 'unknown', decisionReason: 'non_bird_threshold_disabled' },
  )
})
