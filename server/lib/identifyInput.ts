import fs from 'node:fs/promises'
import { ResizeFit, Transformer } from '@napi-rs/image'

function clampInt(v: unknown, fallback: number, min: number, max: number) {
  const n = Math.trunc(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function clampFloat(v: unknown, fallback: number, min: number, max: number) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export function getIdentifyInputOptionsFromEnv() {
  return {
    maxSize: clampInt(process.env.IDENTIFY_MAX_SIZE, 4096, 512, 8192),
    quality: clampInt(process.env.IDENTIFY_JPEG_QUALITY, 90, 30, 100),
    cropsSingle: clampInt(process.env.IDENTIFY_CROPS_SINGLE, 5, 1, 9),
    cropsBatch: clampInt(process.env.IDENTIFY_CROPS_BATCH, 1, 1, 9),
    cropScale: clampFloat(process.env.IDENTIFY_CROP_SCALE, 0.6, 0.35, 0.9),
  }
}

function cropPositionsSquare(w: number, h: number, side: number) {
  const x0 = 0
  const y0 = 0
  const x1 = Math.max(0, w - side)
  const y1 = Math.max(0, h - side)
  const xc = Math.max(0, Math.round((w - side) / 2))
  const yc = Math.max(0, Math.round((h - side) / 2))
  const xm = xc
  const ym = yc
  return [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
    [xc, yc],
    [xm, y0],
    [xm, y1],
    [x0, ym],
    [x1, ym],
  ] as const
}

export async function buildIdentifyJpegsFromPath(
  absImagePath: string,
  opts?: { maxSize?: number; quality?: number; crops?: number; cropScale?: number },
) {
  const input = await fs.readFile(absImagePath)
  const maxSize = clampInt(opts?.maxSize, 4096, 512, 8192)
  const quality = clampInt(opts?.quality, 90, 30, 100)
  const crops = clampInt(opts?.crops, 1, 1, 9)
  const cropScale = clampFloat(opts?.cropScale, 0.6, 0.35, 0.9)

  const full = await new Transformer(input)
    .rotate()
    .resize({ width: maxSize, height: maxSize, fit: ResizeFit.Inside })
    .jpeg(quality)

  if (crops <= 1) return [full]

  const meta = await new Transformer(input).rotate().metadata()
  const w = meta.width
  const h = meta.height
  const side = Math.max(64, Math.round(Math.min(w, h) * cropScale))
  const pos = cropPositionsSquare(w, h, side)
  const n = Math.min(crops - 1, pos.length)

  const out: Buffer[] = [full]
  for (let i = 0; i < n; i += 1) {
    const [x, y] = pos[i]!
    const jpg = await new Transformer(input)
      .rotate()
      .crop(x, y, side, side)
      .resize({ width: maxSize, height: maxSize, fit: ResizeFit.Inside })
      .jpeg(quality)
    out.push(jpg)
  }
  return out
}

export async function buildIdentifyJpegFromPath(
  absImagePath: string,
  opts?: { maxSize?: number; quality?: number },
) {
  const list = await buildIdentifyJpegsFromPath(absImagePath, { ...opts, crops: 1 })
  return list[0]!
}
