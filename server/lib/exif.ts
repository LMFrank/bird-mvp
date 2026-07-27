import exifr from 'exifr'

export type ExifSummary = {
  cameraMake?: string
  cameraModel?: string
  lensModel?: string
  focalLengthMm?: number
  aperture?: number
  shutter?: string
  iso?: number
  exposureComp?: number
  takenAt?: string
  width?: number
  height?: number
  latitude?: number
  longitude?: number
}

function asNum(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function clampInt(v: unknown, min: number, max: number): number | null {
  const n = asNum(v)
  if (n === null) return null
  const i = Math.trunc(n)
  if (!Number.isFinite(i)) return null
  return Math.min(max, Math.max(min, i))
}

function formatShutter(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return ''
  if (sec >= 1) {
    if (sec >= 10) return `${Math.round(sec)}s`
    return `${Math.round(sec * 10) / 10}s`
  }
  const denom = Math.round(1 / sec)
  if (denom >= 2) return `1/${denom}s`
  return `${Math.round(sec * 1000)}ms`
}

function toIso(v: unknown): number | null {
  const n = clampInt(v, 1, 102400)
  return n
}

function toFocalMm(v: unknown): number | null {
  const n = asNum(v)
  if (n === null) return null
  if (n <= 0 || n > 5000) return null
  return Math.round(n * 10) / 10
}

function toAperture(v: unknown): number | null {
  const n = asNum(v)
  if (n === null) return null
  if (n <= 0 || n > 128) return null
  return Math.round(n * 10) / 10
}

function toExposureComp(v: unknown): number | null {
  const n = asNum(v)
  if (n === null) return null
  if (n < -10 || n > 10) return null
  return Math.round(n * 10) / 10
}

function toTakenAt(v: unknown): string | null {
  if (v == null) return null
  const d = v instanceof Date ? v : new Date(String(v))
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

export async function readExifSummary(absPath: string): Promise<ExifSummary> {
  const data = (await exifr.parse(absPath, {
    tiff: true,
    ifd0: {},
    exif: true,
    gps: true,
    xmp: false,
    icc: false,
    pick: [
      'Make',
      'Model',
      'LensModel',
      'FocalLength',
      'FNumber',
      'ExposureTime',
      'ISO',
      'ExposureCompensation',
      'DateTimeOriginal',
      'CreateDate',
      'ModifyDate',
      'ImageWidth',
      'ImageHeight',
      'ExifImageWidth',
      'ExifImageHeight',
      'latitude',
      'longitude',
    ],
  })) as Record<string, unknown> | null

  const make = typeof data?.Make === 'string' ? data.Make.trim() : ''
  const model = typeof data?.Model === 'string' ? data.Model.trim() : ''
  const lens = typeof data?.LensModel === 'string' ? data.LensModel.trim() : ''

  const exposureTime = asNum(data?.ExposureTime)
  const shutter = exposureTime !== null ? formatShutter(exposureTime) : ''

  const takenAt =
    toTakenAt(data?.DateTimeOriginal) ??
    toTakenAt(data?.CreateDate) ??
    toTakenAt(data?.ModifyDate) ??
    null

  const width =
    clampInt(data?.ExifImageWidth, 1, 200000) ??
    clampInt(data?.ImageWidth, 1, 200000) ??
    null
  const height =
    clampInt(data?.ExifImageHeight, 1, 200000) ??
    clampInt(data?.ImageHeight, 1, 200000) ??
    null

  const out: ExifSummary = {}
  if (make) out.cameraMake = make
  if (model) out.cameraModel = model
  if (lens) out.lensModel = lens
  const focal = toFocalMm(data?.FocalLength)
  if (focal !== null) out.focalLengthMm = focal
  const ap = toAperture(data?.FNumber)
  if (ap !== null) out.aperture = ap
  if (shutter) out.shutter = shutter
  const iso = toIso(data?.ISO)
  if (iso !== null) out.iso = iso
  const ec = toExposureComp(data?.ExposureCompensation)
  if (ec !== null) out.exposureComp = ec
  if (takenAt) out.takenAt = takenAt
  if (width !== null) out.width = width
  if (height !== null) out.height = height
  const latitude = asNum(data?.latitude)
  const longitude = asNum(data?.longitude)
  if (latitude !== null && latitude >= -90 && latitude <= 90) out.latitude = latitude
  if (longitude !== null && longitude >= -180 && longitude <= 180) out.longitude = longitude
  return out
}
