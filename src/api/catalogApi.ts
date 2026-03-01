export type Library = {
  id: number
  root_path: string
  created_at: string
}

export type Photo = {
  id: number
  rel_path: string
  abs_path: string
  mtime_ms: number
  size: number
  rating: number
  status: 'none' | 'keep' | 'reject'
  color: string
  updated_at: string
  tags?: string[]
  aiTop1?: { nameZh?: string; nameScientific?: string; score: number } | null
  ai?: {
    provider: string
    model: string
    labelsCount?: number
    promptCount?: number
    predictions: { nameZh?: string; nameScientific?: string; score: number }[]
    fallback?: {
      provider: string
      model: string
      chosen?: { nameZh?: string; nameScientific?: string; score: number }
      confidence?: number
      needHumanReview?: boolean
      reason?: string
    }
  } | null
}

type ApiOk<T> = T & { success: true }
type ApiErr = { success: false; error: string }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

async function api<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const origin =
    typeof window !== 'undefined' && window.location?.origin ? window.location.origin : ''

  let res: Response
  try {
    res = await fetch(input, init)
  } catch {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : ''
    const hint = origin.includes('localhost:5173')
      ? '（当前是开发端口 5173，请确认后端也已启动：npm run dev）'
      : '（请确认后端/容器在运行，并且页面与后端同源）'
    throw new Error(`无法连接到后端接口：${url} ${hint}`.trim())
  }

  const raw = await res.text()
  let data: unknown
  try {
    data = raw ? (JSON.parse(raw) as unknown) : {}
  } catch {
    data = { success: false, error: raw || `HTTP ${res.status}` }
  }
  const ok = isRecord(data) && data.success === true
  if (!res.ok || !ok) {
    const msg =
      isRecord(data) && typeof data.error === 'string' ? data.error : `HTTP ${res.status}`
    throw new Error(msg)
  }
  return data as T
}

export async function listLibraries() {
  return api<ApiOk<{ libraries: Library[] }>>('/api/library')
}

export async function addLibrary(rootPath: string) {
  return api<ApiOk<{ library: Library; inserted: boolean }>>('/api/library', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rootPath }),
  })
}

export async function scanLibrary(id: number) {
  return api<
    ApiOk<{
      libraryId: number
      rootPath: string
      total: number
      created: number
      updated: number
      skipped: number
      elapsedMs: number
    }>
  >(`/api/library/${id}/scan`, { method: 'POST' })
}

export async function listPhotos(params: {
  libraryId: number
  status: 'all' | 'none' | 'keep' | 'reject'
  ratingMin: number
  tag: string
  q: string
  aiZh?: string
  offset: number
  limit: number
}) {
  const qs = new URLSearchParams()
  qs.set('libraryId', String(params.libraryId))
  qs.set('status', params.status)
  qs.set('ratingMin', String(params.ratingMin))
  if (params.tag) qs.set('tag', params.tag)
  if (params.q) qs.set('q', params.q)
  if (params.aiZh) qs.set('aiZh', params.aiZh)
  qs.set('offset', String(params.offset))
  qs.set('limit', String(params.limit))
  const r = await api<ApiOk<{ total: number; offset: number; limit: number; photos: unknown[] }>>(
    `/api/photos?${qs.toString()}`,
  )
  const photos = r.photos.map((p) => {
    const obj = isRecord(p) ? p : {}
    const nameZh = typeof obj['ai_name_zh'] === 'string' ? obj['ai_name_zh'] : undefined
    const nameScientific =
      typeof obj['ai_name_scientific'] === 'string' ? obj['ai_name_scientific'] : undefined
    const score = Number(obj['ai_score'] ?? 0)
    const aiTop1 =
      nameZh || nameScientific
        ? { nameZh, nameScientific, score: Number.isFinite(score) ? score : 0 }
        : null
    return { ...(obj as unknown as Photo), aiTop1 }
  })
  return { ...r, photos } as ApiOk<{ total: number; offset: number; limit: number; photos: Photo[] }>
}

export async function getPhoto(id: number) {
  return api<ApiOk<{ photo: Photo }>>(`/api/photos/${id}`)
}

export function thumbUrl(id: number, size: 256 | 1024 | 2048) {
  return `/api/photos/${id}/thumb?size=${size}`
}

export async function patchPhoto(
  id: number,
  patch: Partial<Pick<Photo, 'rating' | 'status' | 'color'>> & { tags?: string[] },
) {
  return api<ApiOk<{ photo: Photo }>>(`/api/photos/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export async function identifyPhoto(id: number) {
  return api<ApiOk<{ ai: NonNullable<Photo['ai']> }>>(`/api/photos/${id}/identify`, {
    method: 'POST',
  })
}

export async function clearPhotoAi(id: number) {
  return api<ApiOk<Record<string, never>>>(`/api/photos/${id}/ai`, {
    method: 'DELETE',
  })
}

export type AiSpecies = {
  nameZh: string
  nameScientific: string
  count: number
  avgScore: number
}

export async function listAiSpecies(params: { libraryId: number; minScore?: number; q?: string }) {
  const qs = new URLSearchParams()
  qs.set('libraryId', String(params.libraryId))
  if (typeof params.minScore === 'number') qs.set('minScore', String(params.minScore))
  if (params.q) qs.set('q', params.q)
  return api<ApiOk<{ species: AiSpecies[] }>>(`/api/ai/species?${qs.toString()}`)
}

export type IdentifyJob = {
  id: string
  type: 'identify_library'
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  libraryId: number
  total: number
  processed: number
  succeeded: number
  failed: number
  skipped: number
  startedAt: string | null
  finishedAt: string | null
  currentPhotoId: number | null
  message: string | null
}

export async function startIdentifyLibrary(libraryId: number, opts?: { overwrite?: boolean; limit?: number }) {
  return api<ApiOk<{ job: IdentifyJob }>>(`/api/library/${libraryId}/identify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ overwrite: Boolean(opts?.overwrite), limit: opts?.limit ?? 0 }),
  })
}

export async function clearLibraryAi(libraryId: number) {
  return api<ApiOk<Record<string, never>>>(`/api/library/${libraryId}/ai`, { method: 'DELETE' })
}

export async function getJob(id: string) {
  return api<ApiOk<{ job: IdentifyJob }>>(`/api/jobs/${encodeURIComponent(id)}`)
}

export async function cancelJob(id: string) {
  return api<ApiOk<Record<string, never>>>(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' })
}

export type { ApiErr }

export type AppSettings = {
  identify: {
    maxSize: number
    quality: number
    cropsSingle: number
    cropsBatch: number
    cropScale: number
    cropScalesSingle: number[]
    cropScalesBatch: number[]
  }
  llm: {
    enabled: boolean
    qwenBaseUrl: string
    qwenModelName: string
    llmUrl: string
    llmModel: string
    candidates: string
    triggerScore: string
    triggerMargin: string
    hasQwenKey: boolean
    hasLlmKey: boolean
    qwenKeySource?: 'runtime' | 'env' | 'none'
    llmKeySource?: 'runtime' | 'env' | 'none'
    runtimeSupported?: boolean
  } & {
    qwenApiKey?: string
    apiKey?: string
  }
}

export async function getSettings() {
  return api<ApiOk<AppSettings>>('/api/settings')
}

export type AppSettingsPatch = {
  identify?: Partial<AppSettings['identify']>
  llm?: Partial<Omit<AppSettings['llm'], 'hasQwenKey' | 'hasLlmKey'>> & {
    qwenApiKey?: string
    apiKey?: string
  }
}

export async function updateSettings(patch: AppSettingsPatch) {
  return api<ApiOk<AppSettings>>('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}
