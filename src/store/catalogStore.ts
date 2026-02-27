import { create } from 'zustand'
import {
  type Library,
  type Photo,
  type AiSpecies,
  type IdentifyJob,
  addLibrary,
  cancelJob,
  getJob,
  getPhoto,
  identifyPhoto,
  listLibraries,
  listAiSpecies,
  listPhotos,
  patchPhoto,
  scanLibrary,
  startIdentifyLibrary,
  clearPhotoAi,
  clearLibraryAi,
} from '@/api/catalogApi'

type Filters = {
  status: 'all' | 'none' | 'keep' | 'reject'
  ratingMin: number
  tag: string
  q: string
  aiZh: string
}

export type DisplayLang = 'zh_CN' | 'zh_TW' | 'en' | 'sci'

export type TaxonomyItem = {
  zh_CN?: string
  zh_TW?: string
  en?: string
}

export type Taxonomy = Record<string, TaxonomyItem> // sciName -> item

type CatalogState = {
  libraries: Library[]
  selectedLibraryId: number | null
  photos: Photo[]
  total: number
  aiSpecies: AiSpecies[]
  taxonomy: Taxonomy
  displayLang: DisplayLang
  loading: boolean
  scanning: boolean
  identifying: boolean
  identifyJob: IdentifyJob | null
  error: string | null
  filters: Filters
  selectedPhotoId: number | null
  selectedPhoto: Photo | null

  loadLibraries: () => Promise<void>
  loadTaxonomy: () => Promise<void>
  setDisplayLang: (lang: DisplayLang) => void
  selectLibrary: (id: number) => Promise<void>
  createLibrary: (rootPath: string) => Promise<void>
  runScan: () => Promise<void>
  setFilters: (patch: Partial<Filters>) => Promise<void>
  loadMore: () => Promise<void>
  loadAll: () => Promise<void>
  selectPhoto: (id: number | null) => Promise<void>
  applyPhotoPatch: (
    id: number,
    patch: Partial<Pick<Photo, 'rating' | 'status' | 'color'>> & { tags?: string[] },
  ) => Promise<void>

  runIdentify: (id: number) => Promise<void>
  clearIdentify: (id: number) => Promise<void>
  loadAiSpecies: () => Promise<void>
  startIdentifyAll: (opts?: { overwrite?: boolean }) => Promise<void>
  cancelIdentifyAll: () => Promise<void>
  clearIdentifyAll: () => Promise<void>
}

const PAGE_SIZE = 200

function errMsg(e: unknown, fallback: string) {
  if (e instanceof Error && e.message) return e.message
  return fallback
}

export const useCatalogStore = create<CatalogState>((set, get) => ({
  libraries: [],
  selectedLibraryId: null,
  photos: [],
  total: 0,
  aiSpecies: [],
  taxonomy: {},
  displayLang: 'zh_CN',
  loading: false,
  scanning: false,
  identifying: false,
  identifyJob: null,
  error: null,
  filters: { status: 'all', ratingMin: 0, tag: '', q: '', aiZh: '' },
  selectedPhotoId: null,
  selectedPhoto: null,

  loadTaxonomy: async () => {
    try {
      // 假设后端接口在 /api/ai/taxonomy
      const base = import.meta.env.VITE_API_URL || 'http://localhost:3001'
      const res = await fetch(`${base}/api/ai/taxonomy`)
      if (res.ok) {
        const data = await res.json()
        set({ taxonomy: data })
      }
    } catch {
      // ignore
    }
  },

  setDisplayLang: (lang: DisplayLang) => set({ displayLang: lang }),

  loadLibraries: async () => {
    set({ loading: true, error: null })
    try {
      const data = await listLibraries()
      set({ libraries: data.libraries })
      const current = get().selectedLibraryId
      if (!current && data.libraries.length) {
        await get().selectLibrary(data.libraries[0]!.id)
      }
    } catch (e: unknown) {
      set({ error: errMsg(e, '加载库失败') })
    } finally {
      set({ loading: false })
    }
  },

  selectLibrary: async (id: number) => {
    set({
      selectedLibraryId: id,
      photos: [],
      total: 0,
      aiSpecies: [],
      identifyJob: null,
      identifying: false,
      selectedPhotoId: null,
      selectedPhoto: null,
    })
    await get().loadAiSpecies()
    await get().loadMore()
  },

  createLibrary: async (rootPath: string) => {
    set({ loading: true, error: null })
    try {
      const r = await addLibrary(rootPath)
      const libs = await listLibraries()
      set({ libraries: libs.libraries })
      await get().selectLibrary(r.library.id)
    } catch (e: unknown) {
      set({ error: errMsg(e, '添加目录失败') })
    } finally {
      set({ loading: false })
    }
  },

  runScan: async () => {
    const id = get().selectedLibraryId
    if (!id) return
    set({ scanning: true, error: null })
    try {
      await scanLibrary(id)
      set({ photos: [], total: 0, selectedPhotoId: null, selectedPhoto: null })
      await get().loadMore()
    } catch (e: unknown) {
      set({ error: errMsg(e, '扫描失败') })
    } finally {
      set({ scanning: false })
    }
  },

  setFilters: async (patch: Partial<Filters>) => {
    set({ filters: { ...get().filters, ...patch }, photos: [], total: 0, selectedPhotoId: null, selectedPhoto: null })
    await get().loadMore()
  },

  loadMore: async () => {
    const id = get().selectedLibraryId
    if (!id) return
    if (get().loading) return
    const offset = get().photos.length
    if (get().total !== 0 && offset >= get().total) return

    set({ loading: true, error: null })
    try {
      const f = get().filters
      const data = await listPhotos({
        libraryId: id,
        status: f.status,
        ratingMin: f.ratingMin,
        tag: f.tag,
        q: f.q,
        aiZh: f.aiZh,
        offset,
        limit: PAGE_SIZE,
      })
      set({ photos: [...get().photos, ...data.photos], total: data.total })
    } catch (e: unknown) {
      set({ error: errMsg(e, '加载照片失败') })
    } finally {
      set({ loading: false })
    }
  },

  loadAll: async () => {
    const id = get().selectedLibraryId
    if (!id) return
    if (get().loading) return

    let last = -1
    for (;;) {
      const current = get().photos.length
      const total = get().total
      if (total !== 0 && current >= total) return
      if (current === last) return
      last = current
      await get().loadMore()
      await new Promise((r) => setTimeout(r, 50))
    }
  },

  selectPhoto: async (id: number | null) => {
    if (!id) {
      set({ selectedPhotoId: null, selectedPhoto: null })
      return
    }
    set({ selectedPhotoId: id, selectedPhoto: null })
    try {
      const data = await getPhoto(id)
      set({ selectedPhoto: data.photo })
    } catch {
      set({ selectedPhoto: null })
    }
  },

  applyPhotoPatch: async (id, patch) => {
    try {
      const data = await patchPhoto(id, patch)
      const next = data.photo
      set({
        photos: get().photos.map((p) => (p.id === id ? { ...p, ...next } : p)),
        selectedPhoto: get().selectedPhotoId === id ? next : get().selectedPhoto,
      })
    } catch (e: unknown) {
      set({ error: errMsg(e, '更新失败') })
    }
  },

  runIdentify: async (id) => {
    try {
      const data = await identifyPhoto(id)
      set({
        photos: get().photos.map((p) => (p.id === id ? { ...p, ai: data.ai } : p)),
        selectedPhoto:
          get().selectedPhotoId === id && get().selectedPhoto
            ? { ...get().selectedPhoto!, ai: data.ai }
            : get().selectedPhoto,
      })
    } catch (e: unknown) {
      set({ error: errMsg(e, '识别失败') })
    }
  },

  clearIdentify: async (id) => {
    try {
      await clearPhotoAi(id)
      set({
        photos: get().photos.map((p) => (p.id === id ? { ...p, ai: null, aiTop1: null } : p)),
        selectedPhoto:
          get().selectedPhotoId === id && get().selectedPhoto
            ? { ...get().selectedPhoto!, ai: null, aiTop1: null }
            : get().selectedPhoto,
      })
    } catch (e: unknown) {
      set({ error: errMsg(e, '清除失败') })
    }
  },

  loadAiSpecies: async () => {
    const id = get().selectedLibraryId
    if (!id) return
    try {
      const data = await listAiSpecies({ libraryId: id, minScore: 0 })
      set({ aiSpecies: data.species })
    } catch {
      set({ aiSpecies: [] })
    }
  },

  startIdentifyAll: async (opts) => {
    const id = get().selectedLibraryId
    if (!id) return
    if (get().identifying) return
    set({ identifying: true, error: null })
    try {
      const r = await startIdentifyLibrary(id, { overwrite: Boolean(opts?.overwrite) })
      set({ identifyJob: r.job })
      const jobId = r.job.id

      const poll = async () => {
        const current = get().identifyJob
        if (!current || current.id !== jobId) return
        try {
          const s = await getJob(jobId)
          set({ identifyJob: s.job })
          if (s.job.status === 'queued' || s.job.status === 'running') {
            setTimeout(poll, 1000)
            return
          }
          set({ identifying: false })
          if (s.job.status === 'error') {
            set({ error: s.job.message || '批量识别失败' })
            return
          }
          if (s.job.failed > 0) {
            set({ error: `批量识别完成，但有 ${s.job.failed} 张失败：${s.job.message || '请重试'}` })
          }
          set({ photos: [], total: 0, selectedPhotoId: null, selectedPhoto: null })
          await get().loadAiSpecies()
          await get().loadMore()
        } catch (e: unknown) {
          set({ identifying: false, error: errMsg(e, '批量识别失败') })
        }
      }
      setTimeout(poll, 800)
    } catch (e: unknown) {
      set({ identifying: false, error: errMsg(e, '批量识别失败') })
    }
  },

  cancelIdentifyAll: async () => {
    const j = get().identifyJob
    if (!j) return
    try {
      await cancelJob(j.id)
      const s = await getJob(j.id)
      set({ identifyJob: s.job, identifying: false })
    } catch (e: unknown) {
      set({ error: errMsg(e, '取消失败') })
    }
  },

  clearIdentifyAll: async () => {
    const id = get().selectedLibraryId
    if (!id) return
    try {
      await clearLibraryAi(id)
      set({ photos: [], total: 0, selectedPhotoId: null, selectedPhoto: null })
      await get().loadAiSpecies()
      await get().loadMore()
    } catch (e: unknown) {
      set({ error: errMsg(e, '清除失败') })
    }
  },
}))
