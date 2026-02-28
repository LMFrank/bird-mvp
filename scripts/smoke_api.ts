import os from 'node:os'
import path from 'node:path'

const cacheDir = path.join(os.tmpdir(), 'bird-mvp-smoke', String(Date.now()))
process.env.CACHE_DIR = cacheDir

const { default: app } = await import('../server/app.js')

const server = app.listen(0)
try {
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('failed to bind')
  const url = `http://127.0.0.1:${addr.port}/api/health`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`health failed: ${res.status}`)
  const json = (await res.json()) as { success?: boolean; message?: string }
  if (!json?.success) throw new Error('health response invalid')
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()))
}
