import fs from 'node:fs/promises'
import { ResizeFit, Transformer, type JsColorType } from '@napi-rs/image'

function clamp01(v: number) {
  if (!Number.isFinite(v)) return 0
  if (v <= 0) return 0
  if (v >= 1) return 1
  return v
}

function bell01(x: number, center: number, radius: number) {
  if (!Number.isFinite(x) || !Number.isFinite(center) || !Number.isFinite(radius) || radius <= 0) return 0
  return clamp01(1 - Math.abs(x - center) / radius)
}

function scoreLog01(x: number, lo: number, hi: number) {
  if (!Number.isFinite(x) || x <= 0) return 0
  const a = Math.log1p(Math.max(0, lo))
  const b = Math.log1p(Math.max(lo + 1e-9, hi))
  const v = (Math.log1p(x) - a) / (b - a)
  return clamp01(v)
}

function channelsForColorType(colorType: JsColorType) {
  if (colorType === 0) return 1
  if (colorType === 1) return 2
  if (colorType === 2) return 3
  if (colorType === 3) return 4
  if (colorType === 4) return 1
  if (colorType === 5) return 2
  if (colorType === 6) return 3
  if (colorType === 7) return 4
  if (colorType === 8) return 3
  if (colorType === 9) return 4
  return 3
}

function luminance01(r: number, g: number, b: number) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function avg01(r: number, g: number, b: number) {
  return (r + g + b) / 3
}

function sat01(r: number, g: number, b: number) {
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  if (mx <= 1e-9) return 0
  return (mx - mn) / mx
}

function bufToFloatView(buf: Buffer, bytesPerEl: 2 | 4) {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  if (bytesPerEl === 2) return new Uint16Array(ab)
  return new Float32Array(ab)
}

export async function computeAestheticScoreFromPath(absImagePath: string) {
  const input = await fs.readFile(absImagePath)
  const t = new Transformer(input)
    .rotate()
    .resize({ width: 256, height: 256, fit: ResizeFit.Inside })
  const meta = await t.metadata()
  const w = Math.max(1, Math.trunc(meta.width))
  const h = Math.max(1, Math.trunc(meta.height))
  const ct = meta.colorType
  const raw = await t.rawPixels()

  const n = w * h
  const ch = channelsForColorType(ct)

  const y = new Float32Array(n)
  let sumY = 0
  let sumY2 = 0
  let clipLo = 0
  let clipHi = 0
  let sumR = 0
  let sumG = 0
  let sumB = 0
  let sumS = 0

  const is16 = ct === 4 || ct === 5 || ct === 6 || ct === 7
  const isF32 = ct === 8 || ct === 9
  const view16 = is16 ? (bufToFloatView(raw, 2) as Uint16Array) : null
  const viewF32 = isF32 ? (bufToFloatView(raw, 4) as Float32Array) : null

  for (let i = 0; i < n; i += 1) {
    const base = i * ch
    let r = 0
    let g = 0
    let b = 0
    if (ct === 0) {
      const v = raw[i]! / 255
      r = v
      g = v
      b = v
    } else if (ct === 1) {
      const v = raw[base]! / 255
      r = v
      g = v
      b = v
    } else if (ct === 2) {
      r = raw[base]! / 255
      g = raw[base + 1]! / 255
      b = raw[base + 2]! / 255
    } else if (ct === 3) {
      r = raw[base]! / 255
      g = raw[base + 1]! / 255
      b = raw[base + 2]! / 255
    } else if (is16 && view16) {
      const div = 65535
      if (ct === 4) {
        const v = view16[i]! / div
        r = v
        g = v
        b = v
      } else if (ct === 5) {
        const v = view16[base]! / div
        r = v
        g = v
        b = v
      } else if (ct === 6) {
        r = view16[base]! / div
        g = view16[base + 1]! / div
        b = view16[base + 2]! / div
      } else {
        r = view16[base]! / div
        g = view16[base + 1]! / div
        b = view16[base + 2]! / div
      }
    } else if (isF32 && viewF32) {
      if (ct === 8) {
        r = clamp01(viewF32[base]!)
        g = clamp01(viewF32[base + 1]!)
        b = clamp01(viewF32[base + 2]!)
      } else {
        r = clamp01(viewF32[base]!)
        g = clamp01(viewF32[base + 1]!)
        b = clamp01(viewF32[base + 2]!)
      }
    } else {
      const v = raw[i]! / 255
      r = v
      g = v
      b = v
    }

    const yy = luminance01(r, g, b)
    y[i] = yy
    sumY += yy
    sumY2 += yy * yy
    if (yy <= 0.02) clipLo += 1
    if (yy >= 0.98) clipHi += 1
    sumR += r
    sumG += g
    sumB += b
    sumS += sat01(r, g, b)
  }

  const meanY = sumY / n
  const varY = Math.max(0, sumY2 / n - meanY * meanY)
  const stdY = Math.sqrt(varY)
  const clipFrac = (clipLo + clipHi) / n
  const meanR = sumR / n
  const meanG = sumG / n
  const meanB = sumB / n
  const meanS = sumS / n

  let sobelEnergySum = 0
  let flatNoiseSum = 0
  let flatNoiseCount = 0
  let energySum = 0
  let energySumX = 0
  let energySumY = 0
  let energyCenterSum = 0

  const cx0 = Math.floor(w * 0.3)
  const cx1 = Math.ceil(w * 0.7)
  const cy0 = Math.floor(h * 0.3)
  const cy1 = Math.ceil(h * 0.7)

  for (let yy = 1; yy < h - 1; yy += 1) {
    for (let xx = 1; xx < w - 1; xx += 1) {
      const i = yy * w + xx
      const i00 = (yy - 1) * w + (xx - 1)
      const i01 = (yy - 1) * w + xx
      const i02 = (yy - 1) * w + (xx + 1)
      const i10 = yy * w + (xx - 1)
      const i12 = yy * w + (xx + 1)
      const i20 = (yy + 1) * w + (xx - 1)
      const i21 = (yy + 1) * w + xx
      const i22 = (yy + 1) * w + (xx + 1)

      const gx =
        -1 * y[i00]! + 1 * y[i02]! +
        -2 * y[i10]! + 2 * y[i12]! +
        -1 * y[i20]! + 1 * y[i22]!
      const gy =
        -1 * y[i00]! + -2 * y[i01]! + -1 * y[i02]! +
        1 * y[i20]! + 2 * y[i21]! + 1 * y[i22]!
      const e = gx * gx + gy * gy
      sobelEnergySum += e

      const en = e
      energySum += en
      energySumX += xx * en
      energySumY += yy * en
      if (xx >= cx0 && xx < cx1 && yy >= cy0 && yy < cy1) energyCenterSum += en

      if (e < 0.0005) {
        const yL = y[i10]!
        const yR = y[i12]!
        const yU = y[i01]!
        const yD = y[i21]!
        const local = (yL + yR + yU + yD) / 4
        flatNoiseSum += Math.abs(y[i]! - local)
        flatNoiseCount += 1
      }
    }
  }

  const sobelEnergyAvg = sobelEnergySum / Math.max(1, (w - 2) * (h - 2))
  const sharp = scoreLog01(sobelEnergyAvg, 0.0008, 0.02)

  const expBase = bell01(meanY, 0.5, 0.38)
  const exp = expBase * clamp01(1 - clipFrac * 2.5)

  const contrast = bell01(stdY, 0.24, 0.22)

  const satScore = bell01(meanS, 0.35, 0.35) * clamp01(1 - Math.max(0, meanS - 0.85) * 4)

  const chAvg = avg01(meanR, meanG, meanB)
  const castRange = chAvg > 1e-9 ? (Math.max(meanR, meanG, meanB) - Math.min(meanR, meanG, meanB)) / chAvg : 1
  const color = clamp01(1 - Math.max(0, castRange - 0.18) / 0.45)

  const noise = flatNoiseCount > 0 ? flatNoiseSum / flatNoiseCount : 0
  const noiseScore = clamp01(1 - Math.max(0, noise - 0.006) / 0.04)

  const tech = clamp01(
    0.35 * sharp +
      0.2 * exp +
      0.15 * contrast +
      0.1 * satScore +
      0.1 * noiseScore +
      0.1 * color,
  )

  const centerRatio = energySum > 1e-9 ? energyCenterSum / energySum : 0
  const centerRatioScore = clamp01((centerRatio - 0.28) / 0.28)
  const ex = energySum > 1e-9 ? energySumX / energySum : w / 2
  const ey = energySum > 1e-9 ? energySumY / energySum : h / 2
  const dx = (ex - (w - 1) / 2) / ((w - 1) / 2)
  const dy = (ey - (h - 1) / 2) / ((h - 1) / 2)
  const dist = Math.sqrt(dx * dx + dy * dy)
  const centroidScore = clamp01(1 - dist / 0.9)
  const comp = clamp01(0.6 * centerRatioScore + 0.4 * centroidScore)

  const final01 = clamp01(0.75 * tech + 0.25 * comp)
  const gammaRaw = Number(process.env.AESTHETIC_GAMMA ?? 0.55)
  const gamma = Number.isFinite(gammaRaw) && gammaRaw > 0.05 && gammaRaw < 5 ? gammaRaw : 0.55
  const mapped01 = clamp01(Math.pow(final01, gamma))
  const score = Math.round(mapped01 * 1000) / 10
  return score
}
