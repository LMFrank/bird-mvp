import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bird-confirmation-test-'))
process.env.CACHE_DIR = cacheDir

const { default: app } = await import('../server/app.js')
const { getDb, nowIso } = await import('../server/lib/catalog.js')

function seedPhoto() {
  const db = getDb()
  const now = nowIso()
  const suffix = `${Date.now()}-${Math.random()}`
  const rootPath = `/tmp/photos-${suffix}`
  const lib = db.prepare('INSERT INTO libraries(root_path, created_at) VALUES (?, ?)').run(rootPath, now)
  const libraryId = Number(lib.lastInsertRowid)
  const photo = db.prepare(`
    INSERT INTO photos(library_id, abs_path, rel_path, fingerprint, size, mtime_ms, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, 1, ?, ?)
  `).run(libraryId, `${rootPath}/a.jpg`, 'a.jpg', `fp-${suffix}`, now, now)
  const photoId = Number(photo.lastInsertRowid)
  db.prepare("INSERT INTO photo_meta(photo_id, rating, status, color, updated_at) VALUES (?, 0, 'none', 'none', ?)").run(photoId, now)
  db.prepare("INSERT INTO photo_ai(photo_id, provider, model, result_json, updated_at) VALUES (?, 'bioclip', 'bioclip-2', ?, ?)").run(
    photoId,
    JSON.stringify({
      provider: 'bioclip',
      model: 'bioclip-2',
      decision: 'accepted',
      predictions: [{ nameZh: '白鹭', nameScientific: 'Egretta garzetta', score: 0.9 }],
    }),
    now,
  )
  db.prepare("INSERT INTO photo_ai_predictions(photo_id, rank, name_zh, name_scientific, score, created_at) VALUES (?, 1, '白鹭', 'Egretta garzetta', 0.9, ?)").run(photoId, now)
  return { libraryId, photoId }
}

test('使用方可以确认物种并从资产统计和评测中看到结果', async () => {
  const { libraryId, photoId } = seedPhoto()
  const server = app.listen(0)
  try {
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const base = `http://127.0.0.1:${address.port}`

    const saved = await fetch(`${base}/api/photos/${photoId}/confirmation`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'confirmed',
        subjectType: 'bird',
        scene: 'wild',
        nameZh: '白鹭',
        nameScientific: 'Egretta garzetta',
      }),
    })
    assert.equal(saved.status, 200)
    const savedBody = await saved.json() as {
      confirmation: { subjectType: string; scene: string }
    }
    assert.equal(savedBody.confirmation.subjectType, 'bird')
    assert.equal(savedBody.confirmation.scene, 'wild')

    const assets = await fetch(`${base}/api/library/${libraryId}/assets`).then((r) => r.json()) as {
      assets: Array<{ nameScientific: string; confirmedCount: number }>
    }
    assert.equal(assets.assets[0]?.nameScientific, 'Egretta garzetta')
    assert.equal(assets.assets[0]?.confirmedCount, 1)

    const evaluation = await fetch(`${base}/api/library/${libraryId}/evaluation`).then((r) => r.json()) as {
      metrics: { top1Accuracy: number }
    }
    assert.equal(evaluation.metrics.top1Accuracy, 1)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('非鸟真值会清空物种和场景，且拒绝携带物种名', async () => {
  const { photoId } = seedPhoto()
  const server = app.listen(0)
  try {
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const base = `http://127.0.0.1:${address.port}`
    const invalid = await fetch(`${base}/api/photos/${photoId}/confirmation`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'rejected',
        subjectType: 'non_bird',
        scene: 'captive',
        nameScientific: 'Egretta garzetta',
      }),
    })
    assert.equal(invalid.status, 400)

    const valid = await fetch(`${base}/api/photos/${photoId}/confirmation`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'rejected',
        subjectType: 'non_bird',
        scene: 'unknown',
      }),
    })
    assert.equal(valid.status, 200)
    const body = await valid.json() as {
      confirmation: { subjectType: string; scene: string; nameScientific: null }
    }
    assert.equal(body.confirmation.subjectType, 'non_bird')
    assert.equal(body.confirmation.scene, 'unknown')
    assert.equal(body.confirmation.nameScientific, null)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('使用方重建连拍组后可显式确认整组并保留传播来源', async () => {
  const db = getDb()
  const now = nowIso()
  const suffix = `${Date.now()}-${Math.random()}`
  const rootPath = `/tmp/sequence-${suffix}`
  const libraryId = Number(
    db.prepare('INSERT INTO libraries(root_path, created_at) VALUES (?, ?)').run(rootPath, now).lastInsertRowid,
  )
  const photoIds: number[] = []
  for (const [index, embedding] of [[1, 0], [0.99, 0.01]].entries()) {
    const photoId = Number(db.prepare(`
      INSERT INTO photos(
        library_id, abs_path, rel_path, fingerprint, size, mtime_ms, taken_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
    `).run(
      libraryId,
      `${rootPath}/${index}.jpg`,
      `${index}.jpg`,
      `sequence-${suffix}-${index}`,
      index + 1,
      `2026-07-27T10:00:0${index}.000Z`,
      now,
      now,
    ).lastInsertRowid)
    photoIds.push(photoId)
    db.prepare("INSERT INTO photo_meta(photo_id, rating, status, color, updated_at) VALUES (?, 0, 'none', 'none', ?)").run(photoId, now)
    const result = {
      provider: 'bioclip',
      model: 'bioclip-2',
      pipelineFingerprint: 'pipeline-a',
      predictions: [
        { nameZh: '白鹭', nameScientific: 'Egretta garzetta', score: 0.8 - index * 0.1 },
        { nameZh: '苍鹭', nameScientific: 'Ardea cinerea', score: 0.2 + index * 0.1 },
      ],
      roi: { bestBoxAreaRatio: 0.2 + index * 0.1, bestBoxScore: 0.9 },
    }
    db.prepare("INSERT INTO photo_ai(photo_id, provider, model, result_json, updated_at, pipeline_fingerprint, decision) VALUES (?, 'bioclip', 'bioclip-2', ?, ?, 'pipeline-a', 'accepted')").run(
      photoId,
      JSON.stringify(result),
      now,
    )
    db.prepare('INSERT INTO photo_sequence_embeddings(photo_id, model, embedding_json, updated_at) VALUES (?, ?, ?, ?)').run(
      photoId,
      'bioclip-2',
      JSON.stringify(embedding),
      now,
    )
  }

  const server = app.listen(0)
  try {
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const base = `http://127.0.0.1:${address.port}`
    const rebuilt = await fetch(`${base}/api/library/${libraryId}/sequences/rebuild`, {
      method: 'POST',
    })
    assert.equal(rebuilt.status, 200)
    const rebuiltBody = await rebuilt.json() as {
      sequences: Array<{ id: number; memberCount: number; representativePhotoId: number }>
    }
    assert.equal(rebuiltBody.sequences.length, 1)
    assert.equal(rebuiltBody.sequences[0]?.memberCount, 2)
    assert.equal(rebuiltBody.sequences[0]?.representativePhotoId, photoIds[1])

    const sequenceId = rebuiltBody.sequences[0]!.id
    const confirmed = await fetch(
      `${base}/api/library/${libraryId}/sequences/${sequenceId}/confirmation`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourcePhotoId: photoIds[1],
          status: 'confirmed',
          subjectType: 'bird',
          scene: 'wild',
          nameZh: '白鹭',
          nameScientific: 'Egretta garzetta',
        }),
      },
    )
    assert.equal(confirmed.status, 200)
    const confirmedBody = await confirmed.json() as { count: number }
    assert.equal(confirmedBody.count, 2)
    const propagated = db.prepare(
      'SELECT source, source_photo_id FROM photo_species_confirmations WHERE photo_id=?',
    ).get(photoIds[0]) as { source: string; source_photo_id: number }
    assert.equal(propagated.source, 'sequence_propagated')
    assert.equal(propagated.source_photo_id, photoIds[1])
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test.after(() => {
  fs.rmSync(cacheDir, { recursive: true, force: true })
})
