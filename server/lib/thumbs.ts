import fs from 'node:fs/promises'
import path from 'node:path'
import { Transformer } from '@napi-rs/image'

export type ThumbSize = 256 | 1024 | 2048
type ThumbMeta = {
  absPath: string
  mtimeMs: number
  size: ThumbSize
}

export function normalizeThumbSize(v: unknown): ThumbSize {
  const n = Number(v)
  if (n === 256 || n === 1024 || n === 2048) return n
  return 256
}

export function thumbPath(cacheDir: string, photoId: number, size: ThumbSize) {
  return path.join(cacheDir, 'thumbs', String(size), `${photoId}.jpg`)
}

function thumbMetaPath(cacheDir: string, photoId: number, size: ThumbSize) {
  return `${thumbPath(cacheDir, photoId, size)}.json`
}

async function readThumbMeta(p: string): Promise<ThumbMeta | null> {
  try {
    const raw = await fs.readFile(p, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const obj = parsed as Record<string, unknown>
    if (typeof obj.absPath !== 'string') return null
    if (typeof obj.mtimeMs !== 'number' || !Number.isFinite(obj.mtimeMs)) return null
    if (obj.size !== 256 && obj.size !== 1024 && obj.size !== 2048) return null
    return { absPath: obj.absPath, mtimeMs: obj.mtimeMs, size: obj.size }
  } catch {
    return null
  }
}

export async function ensureThumb(
  cacheDir: string,
  photoId: number,
  absImagePath: string,
  size: ThumbSize,
) {
  const outPath = thumbPath(cacheDir, photoId, size)
  const metaPath = thumbMetaPath(cacheDir, photoId, size)
  const st = await fs.stat(absImagePath)
  let ok = false
  try {
    await fs.access(outPath)
    const meta = await readThumbMeta(metaPath)
    ok =
      meta !== null &&
      meta.size === size &&
      meta.absPath === absImagePath &&
      Math.trunc(meta.mtimeMs) === Math.trunc(st.mtimeMs)
  } catch {
    ok = false
  }
  if (ok) return outPath
  const dir = path.dirname(outPath)
  await fs.mkdir(dir, { recursive: true })
  const input = await fs.readFile(absImagePath)
  const t = new Transformer(input).rotate().resize(size)
  const jpg = await t.jpeg(80)
  await fs.writeFile(outPath, jpg)
  await fs.writeFile(
    metaPath,
    JSON.stringify({ absPath: absImagePath, mtimeMs: st.mtimeMs, size } satisfies ThumbMeta),
    'utf-8',
  )
  return outPath
}
