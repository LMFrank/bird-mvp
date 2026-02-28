import { badRequest } from './apiError.js'

function first(v: unknown) {
  return Array.isArray(v) ? v[0] : v
}

export function asString(v: unknown, opts?: { trim?: boolean; default?: string; maxLen?: number }) {
  const raw = first(v)
  const def = opts?.default ?? ''
  const s = raw == null ? def : String(raw)
  const out = opts?.trim === false ? s : s.trim()
  if (opts?.maxLen != null && out.length > opts.maxLen) throw badRequest('invalid string', { maxLen: opts.maxLen })
  return out
}

export function requiredString(name: string, v: unknown, opts?: { trim?: boolean; maxLen?: number }) {
  const s = asString(v, { default: '', trim: opts?.trim, maxLen: opts?.maxLen })
  if (!s) throw badRequest(`${name} is required`)
  return s
}

export function asNumber(v: unknown, opts?: { default?: number; min?: number; max?: number }) {
  const raw = first(v)
  const n = raw == null || raw === '' ? (opts?.default ?? NaN) : Number(raw)
  if (!Number.isFinite(n)) throw badRequest('invalid number')
  if (opts?.min != null && n < opts.min) throw badRequest('number too small', { min: opts.min })
  if (opts?.max != null && n > opts.max) throw badRequest('number too large', { max: opts.max })
  return n
}

export function asInt(v: unknown, opts?: { default?: number; min?: number; max?: number }) {
  return Math.trunc(asNumber(v, opts))
}

export function requiredInt(name: string, v: unknown, opts?: { min?: number; max?: number }) {
  const raw = first(v)
  if (raw == null || raw === '') throw badRequest(`${name} is required`)
  const n = Number(raw)
  if (!Number.isFinite(n)) throw badRequest(`invalid ${name}`)
  const out = Math.trunc(n)
  if (opts?.min != null && out < opts.min) throw badRequest(`${name} too small`, { min: opts.min })
  if (opts?.max != null && out > opts.max) throw badRequest(`${name} too large`, { max: opts.max })
  return out
}

export function asBool(v: unknown, opts?: { default?: boolean }) {
  const raw = first(v)
  if (raw == null || raw === '') return opts?.default ?? false
  if (typeof raw === 'boolean') return raw
  const s = String(raw).trim().toLowerCase()
  if (s === '1' || s === 'true') return true
  if (s === '0' || s === 'false') return false
  throw badRequest('invalid boolean')
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], def: T) {
  const s = asString(v, { default: def, trim: true })
  return (allowed as readonly string[]).includes(s) ? (s as T) : def
}
