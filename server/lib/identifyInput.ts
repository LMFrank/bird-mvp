import fs from 'node:fs/promises'
import path from 'node:path'
import { ResizeFit, Transformer } from '@napi-rs/image'
import { getRuntimeSetting } from './settings.js'

function asBool(v: unknown, fallback: boolean) {
  if (typeof v === 'boolean') return v
  if (typeof v !== 'string') return fallback
  const s = v.trim().toLowerCase()
  if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false
  return fallback
}

function clampInt(v: unknown, fallback: number, min: number, max: number) {
  if (v == null) return fallback
  if (typeof v === 'string' && !v.trim()) return fallback
  const n = Math.trunc(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function clampFloat(v: unknown, fallback: number, min: number, max: number) {
  if (v == null) return fallback
  if (typeof v === 'string' && !v.trim()) return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function parseCropScales(v: unknown, fallback: number) {
  const raw = String(v ?? '').trim()
  if (!raw) return [fallback]
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => clampFloat(s, NaN, 0.35, 0.9))
    .filter((n) => Number.isFinite(n))
  return list.length ? list : [fallback]
}

export function getIdentifyInputOptionsFromEnv() {
  const envOrSetting = (k: string) => getRuntimeSetting(k) ?? (process.env as Record<string, unknown>)[k]
  const roiDetect = asBool(envOrSetting('IDENTIFY_ROI_DETECT'), true)
  const cropScale = clampFloat(envOrSetting('IDENTIFY_CROP_SCALE'), 0.6, 0.35, 0.9)
  const cropScales = parseCropScales(envOrSetting('IDENTIFY_CROP_SCALES'), cropScale)
  const cropScalesSingle = parseCropScales(envOrSetting('IDENTIFY_CROP_SCALES_SINGLE'), cropScales[0]!)
  const cropScalesBatch = parseCropScales(envOrSetting('IDENTIFY_CROP_SCALES_BATCH'), cropScales[0]!)
  return {
    maxSize: clampInt(envOrSetting('IDENTIFY_MAX_SIZE'), 4096, 512, 8192),
    quality: clampInt(envOrSetting('IDENTIFY_JPEG_QUALITY'), 90, 30, 100),
    cropsSingle: roiDetect ? 1 : clampInt(envOrSetting('IDENTIFY_CROPS_SINGLE'), 5, 1, 9),
    cropsBatch: roiDetect ? 1 : clampInt(envOrSetting('IDENTIFY_CROPS_BATCH'), 1, 1, 9),
    cropScale,
    cropScalesSingle,
    cropScalesBatch,
    roiDetect,
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

type IdentifyCacheMeta = {
  absPath: string
  mtimeMs: number
  maxSize: number
  quality: number
  crops: number
  cropScales: number[]
  count: number
}

function cacheDir() {
  const raw = String(process.env.CACHE_DIR ?? '').trim()
  return raw || path.join(process.cwd(), 'data', 'cache')
}

function cacheKey(opts: IdentifyCacheMeta) {
  const cs = opts.cropScales.map((s) => Math.round(s * 1000)).join('.')
  return `${opts.mtimeMs}_${opts.maxSize}_${opts.quality}_${opts.crops}_${cs}`
}

async function readCacheMeta(p: string): Promise<IdentifyCacheMeta | null> {
  try {
    const raw = await fs.readFile(p, 'utf-8')
    const v = JSON.parse(raw) as unknown
    if (!v || typeof v !== 'object') return null
    const o = v as Record<string, unknown>
    if (typeof o.absPath !== 'string') return null
    if (typeof o.mtimeMs !== 'number' || !Number.isFinite(o.mtimeMs)) return null
    if (typeof o.maxSize !== 'number' || !Number.isFinite(o.maxSize)) return null
    if (typeof o.quality !== 'number' || !Number.isFinite(o.quality)) return null
    if (typeof o.crops !== 'number' || !Number.isFinite(o.crops)) return null
    const cropScalesRaw = Array.isArray(o.cropScales) ? o.cropScales : null
    const cropScales =
      cropScalesRaw && cropScalesRaw.length
        ? cropScalesRaw.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n) && n >= 0.35 && n <= 0.9)
        : typeof o.cropScale === 'number' && Number.isFinite(o.cropScale)
          ? [o.cropScale]
          : null
    if (!cropScales || !cropScales.length) return null
    if (typeof o.count !== 'number' || !Number.isFinite(o.count) || o.count < 1) return null
    return {
      absPath: o.absPath,
      mtimeMs: o.mtimeMs,
      maxSize: o.maxSize,
      quality: o.quality,
      crops: o.crops,
      cropScales,
      count: o.count,
    }
  } catch {
    return null
  }
}

async function buildIdentifyJpegsFromInput(input: Buffer, opts: IdentifyCacheMeta): Promise<Buffer[]> {
  const full = await new Transformer(input)
    .rotate()
    .resize({ width: opts.maxSize, height: opts.maxSize, fit: ResizeFit.Inside })
    .jpeg(opts.quality)

  if (opts.crops <= 1) return [full]

  const meta = await new Transformer(input).rotate().metadata()
  const w = meta.width
  const h = meta.height
  const scales = Array.from(new Set(opts.cropScales.map((s) => clampFloat(s, 0.6, 0.35, 0.9)))).sort((a, b) => a - b)
  const tasks: Array<{ x: number; y: number; side: number }> = []
  const prefer = [4, 5, 6, 7, 8, 0, 1, 2, 3]
  for (const idx of prefer) {
    for (const sc of scales) {
      const side = Math.max(64, Math.round(Math.min(w, h) * sc))
      const pos = cropPositionsSquare(w, h, side)
      const [x, y] = pos[idx]!
      tasks.push({ x, y, side })
    }
  }
  const n = Math.min(opts.crops - 1, tasks.length)

  const out: Buffer[] = [full]
  for (let i = 0; i < n; i += 1) {
    const t = tasks[i]!
    const jpg = await new Transformer(input)
      .rotate()
      .crop(t.x, t.y, t.side, t.side)
      .resize({ width: opts.maxSize, height: opts.maxSize, fit: ResizeFit.Inside })
      .jpeg(opts.quality)
    out.push(jpg)
  }
  return out
}

export async function buildIdentifyJpegsFromPath(
  absImagePath: string,
  opts?: { maxSize?: number; quality?: number; crops?: number; cropScale?: number; cropScales?: number[] },
) {
  const input = await fs.readFile(absImagePath)
  const maxSize = clampInt(opts?.maxSize, 4096, 512, 8192)
  const quality = clampInt(opts?.quality, 90, 30, 100)
  const crops = clampInt(opts?.crops, 1, 1, 9)
  const cropScale = clampFloat(opts?.cropScale, 0.6, 0.35, 0.9)
  const cropScales = Array.isArray(opts?.cropScales) && opts!.cropScales.length ? opts!.cropScales : [cropScale]
  return await buildIdentifyJpegsFromInput(input, {
    absPath: absImagePath,
    mtimeMs: 0,
    maxSize,
    quality,
    crops,
    cropScales,
    count: 1,
  })
}

export async function buildIdentifyJpegsFromPathCached(
  photoId: number,
  absImagePath: string,
  opts?: { maxSize?: number; quality?: number; crops?: number; cropScale?: number; cropScales?: number[] },
) {
  const st = await fs.stat(absImagePath)
  const maxSize = clampInt(opts?.maxSize, 4096, 512, 8192)
  const quality = clampInt(opts?.quality, 90, 30, 100)
  const crops = clampInt(opts?.crops, 1, 1, 9)
  const cropScale = clampFloat(opts?.cropScale, 0.6, 0.35, 0.9)
  const cropScales = Array.isArray(opts?.cropScales) && opts!.cropScales.length ? opts!.cropScales : [cropScale]

  const meta: IdentifyCacheMeta = {
    absPath: absImagePath,
    mtimeMs: Math.trunc(st.mtimeMs),
    maxSize,
    quality,
    crops,
    cropScales,
    count: 1,
  }

  const root = path.join(cacheDir(), 'identify', String(photoId))
  const key = cacheKey(meta)
  const metaPath = path.join(root, `${key}.json`)

  try {
    const cached = await readCacheMeta(metaPath)
    if (
      cached &&
      cached.absPath === meta.absPath &&
      Math.trunc(cached.mtimeMs) === meta.mtimeMs &&
      cached.maxSize === meta.maxSize &&
      cached.quality === meta.quality &&
      cached.crops === meta.crops
    ) {
      const a = cached.cropScales.map((s) => Math.round(s * 1000)).join('.')
      const b = meta.cropScales.map((s) => Math.round(s * 1000)).join('.')
      if (a !== b) throw new Error('cache crop scales mismatch')
      const out: Buffer[] = []
      for (let i = 0; i < cached.count; i += 1) {
        const p = path.join(root, `${key}-${i}.jpg`)
        out.push(await fs.readFile(p))
      }
      if (out.length) return out
    }
  } catch {
    void 0
  }

  const input = await fs.readFile(absImagePath)
  const out = await buildIdentifyJpegsFromInput(input, meta)
  await fs.mkdir(root, { recursive: true })
  await Promise.all(
    out.map((buf, i) => fs.writeFile(path.join(root, `${key}-${i}.jpg`), buf)),
  )
  await fs.writeFile(
    metaPath,
    JSON.stringify({ ...meta, count: out.length } satisfies IdentifyCacheMeta),
    'utf-8',
  )
  return out
}

export async function buildIdentifyJpegFromPath(
  absImagePath: string,
  opts?: { maxSize?: number; quality?: number },
) {
  const list = await buildIdentifyJpegsFromPath(absImagePath, { ...opts, crops: 1 })
  return list[0]!
}
