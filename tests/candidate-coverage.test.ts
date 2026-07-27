import assert from 'node:assert/strict'
import test from 'node:test'
import { missingConfirmedSpecies } from '../server/lib/candidateCoverage.js'

test('候选覆盖门禁只报告已确认鸟类中缺失的科学学名', () => {
  assert.deepEqual(
    missingConfirmedSpecies(
      ['Egretta garzetta', 'Ara macao', 'Egretta garzetta'],
      ['Egretta garzetta'],
      ['Ara ararauna'],
    ),
    ['Ara macao'],
  )
})
