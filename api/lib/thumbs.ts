import fs from 'node:fs/promises'
import path from 'node:path'
import { Transformer } from '@napi-rs/image'

export type ThumbSize = 256 | 1024 | 2048

export function normalizeThumbSize(v: unknown): ThumbSize {
  const n = Number(v)
  if (n === 256 || n === 1024 || n === 2048) return n
  return 256
}

export function thumbPath(cacheDir: string, photoId: number, size: ThumbSize) {
  return path.join(cacheDir, 'thumbs', String(size), `${photoId}.jpg`)
}

export async function ensureThumb(
  cacheDir: string,
  photoId: number,
  absImagePath: string,
  size: ThumbSize,
) {
  const outPath = thumbPath(cacheDir, photoId, size)
  try {
    await fs.access(outPath)
    return outPath
  } catch {
    const dir = path.dirname(outPath)
    await fs.mkdir(dir, { recursive: true })
    const input = await fs.readFile(absImagePath)
    const t = new Transformer(input).rotate().resize(size)
    const jpg = await t.jpeg(80)
    await fs.writeFile(outPath, jpg)
    return outPath
  }
}

