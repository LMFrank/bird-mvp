import express, { type Request, type Response } from 'express'
import { asyncHandler } from '../lib/asyncHandler.js'
import { getIdentifyInputOptionsFromEnv } from '../lib/identifyInput.js'
import { getRuntimeSetting, isRuntimeSettingsAvailable, setRuntimeSetting } from '../lib/settings.js'
import { shouldTriggerLlmFallback } from '../lib/ai.js'

const router = express.Router()

function asNumber(v: unknown) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function asInt(v: unknown) {
  const n = asNumber(v)
  return n === null ? null : Math.trunc(n)
}

function asBool(v: unknown) {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true
    if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false
  }
  return null
}

function parseScales(v: unknown): number[] | null {
  if (Array.isArray(v)) {
    const list = v.map((x) => Number(x)).filter((n) => Number.isFinite(n))
    return list.length ? list : null
  }
  if (typeof v === 'string') {
    const list = v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n))
    return list.length ? list : null
  }
  return null
}

function scalesToString(list: number[] | null): string | null {
  if (!list || !list.length) return null
  const s = list
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n))
    .map((n) => String(n))
    .join(',')
  return s ? s : null
}

function getLlmSnapshot() {
  const enabledRaw = String(getRuntimeSetting('LLM_FALLBACK_ENABLED') ?? process.env.LLM_FALLBACK_ENABLED ?? '').trim()
  const enabled = enabledRaw === '1' || enabledRaw.toLowerCase() === 'true'
  const qwenBaseUrl = String(getRuntimeSetting('QWEN_BASE_URL') ?? process.env.QWEN_BASE_URL ?? '').trim()
  const qwenModelName = String(getRuntimeSetting('QWEN_MODEL_NAME') ?? process.env.QWEN_MODEL_NAME ?? '').trim()
  const llmUrl = String(getRuntimeSetting('LLM_FALLBACK_URL') ?? process.env.LLM_FALLBACK_URL ?? '').trim()
  const llmModel = String(getRuntimeSetting('LLM_FALLBACK_MODEL') ?? process.env.LLM_FALLBACK_MODEL ?? '').trim()
  const candidates = String(
    getRuntimeSetting('LLM_FALLBACK_CANDIDATES') ?? process.env.LLM_FALLBACK_CANDIDATES ?? '',
  ).trim()
  const triggerScore = String(
    getRuntimeSetting('LLM_FALLBACK_TRIGGER_SCORE') ?? process.env.LLM_FALLBACK_TRIGGER_SCORE ?? '',
  ).trim()
  const triggerMargin = String(
    getRuntimeSetting('LLM_FALLBACK_TRIGGER_MARGIN') ?? process.env.LLM_FALLBACK_TRIGGER_MARGIN ?? '',
  ).trim()

  const runtimeQwenKey = Boolean(String(getRuntimeSetting('QWEN_API_KEY') ?? '').trim())
  const envQwenKey = Boolean(String(process.env.QWEN_API_KEY ?? '').trim())
  const hasQwenKey = runtimeQwenKey || envQwenKey

  const runtimeLlmKey = Boolean(String(getRuntimeSetting('LLM_FALLBACK_API_KEY') ?? '').trim())
  const envLlmKey = Boolean(String(process.env.LLM_FALLBACK_API_KEY ?? '').trim())
  const hasLlmKey = runtimeLlmKey || envLlmKey

  const qwenKeySource = runtimeQwenKey ? 'runtime' : envQwenKey ? 'env' : 'none'
  const llmKeySource = runtimeLlmKey ? 'runtime' : envLlmKey ? 'env' : 'none'

  return {
    enabled,
    qwenBaseUrl,
    qwenModelName,
    llmUrl,
    llmModel,
    candidates,
    triggerScore,
    triggerMargin,
    hasQwenKey,
    hasLlmKey,
    qwenKeySource,
    llmKeySource,
    runtimeSupported: isRuntimeSettingsAvailable(),
  }
}

router.get('/', (req: Request, res: Response) => {
  void req
  const identify = getIdentifyInputOptionsFromEnv()
  const llm = getLlmSnapshot()
  res.json({
    success: true,
    identify,
    llm,
  })
})

router.put(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const identify = (body.identify ?? {}) as Record<string, unknown>
    const llm = (body.llm ?? {}) as Record<string, unknown>

    if (Object.keys(identify).length) {
      const maxSize = asInt(identify.maxSize)
      if (maxSize !== null) setRuntimeSetting('IDENTIFY_MAX_SIZE', maxSize > 0 ? String(maxSize) : null)
      const quality = asInt(identify.quality)
      if (quality !== null) setRuntimeSetting('IDENTIFY_JPEG_QUALITY', quality > 0 ? String(quality) : null)
      const cropsSingle = asInt(identify.cropsSingle)
      if (cropsSingle !== null) setRuntimeSetting('IDENTIFY_CROPS_SINGLE', cropsSingle > 0 ? String(cropsSingle) : null)
      const cropsBatch = asInt(identify.cropsBatch)
      if (cropsBatch !== null) setRuntimeSetting('IDENTIFY_CROPS_BATCH', cropsBatch > 0 ? String(cropsBatch) : null)
      const cropScale = asNumber(identify.cropScale)
      if (cropScale !== null) setRuntimeSetting('IDENTIFY_CROP_SCALE', cropScale > 0 ? String(cropScale) : null)

      const ss = parseScales(identify.cropScalesSingle)
      if (ss !== null) setRuntimeSetting('IDENTIFY_CROP_SCALES_SINGLE', scalesToString(ss))
      const sb = parseScales(identify.cropScalesBatch)
      if (sb !== null) setRuntimeSetting('IDENTIFY_CROP_SCALES_BATCH', scalesToString(sb))
      const s = parseScales(identify.cropScales)
      if (s !== null) setRuntimeSetting('IDENTIFY_CROP_SCALES', scalesToString(s))
    }

    if (Object.keys(llm).length) {
      const enabled = asBool(llm.enabled)
      if (enabled !== null) setRuntimeSetting('LLM_FALLBACK_ENABLED', enabled ? '1' : '0')

      if (typeof llm.qwenBaseUrl === 'string') setRuntimeSetting('QWEN_BASE_URL', llm.qwenBaseUrl)
      if (typeof llm.qwenModelName === 'string') setRuntimeSetting('QWEN_MODEL_NAME', llm.qwenModelName)
      if (typeof llm.llmUrl === 'string') setRuntimeSetting('LLM_FALLBACK_URL', llm.llmUrl)
      if (typeof llm.llmModel === 'string') setRuntimeSetting('LLM_FALLBACK_MODEL', llm.llmModel)

      const candidates = asInt(llm.candidates)
      if (candidates !== null) setRuntimeSetting('LLM_FALLBACK_CANDIDATES', candidates > 0 ? String(candidates) : null)

      const triggerScore = asNumber(llm.triggerScore)
      if (triggerScore !== null) setRuntimeSetting('LLM_FALLBACK_TRIGGER_SCORE', String(triggerScore))
      const triggerMargin = asNumber(llm.triggerMargin)
      if (triggerMargin !== null) setRuntimeSetting('LLM_FALLBACK_TRIGGER_MARGIN', String(triggerMargin))

      if (typeof llm.qwenApiKey === 'string') setRuntimeSetting('QWEN_API_KEY', llm.qwenApiKey)
      if (typeof llm.apiKey === 'string') setRuntimeSetting('LLM_FALLBACK_API_KEY', llm.apiKey)
    }

    void shouldTriggerLlmFallback
    const nextIdentify = getIdentifyInputOptionsFromEnv()
    const nextLlm = getLlmSnapshot()
    res.json({ success: true, identify: nextIdentify, llm: nextLlm })
  }),
)

export default router
