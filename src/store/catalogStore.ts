import { create } from 'zustand'
import {
  type Library,
  type Photo,
  type AiSpecies,
  type IdentifyJob,
  addLibrary,
  backfillAesthetic,
  backfillExif,
  cancelJob,
  getJob,
  getPhoto,
  identifyPhoto,
  listLibraries,
  listAiSpecies,
  listPhotos,
  patchPhoto,
  batchPatchPhotos,
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
  sort: 'time' | 'recommend'
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
  selectedPhotoIds: Set<number>
  selectedPhoto: Photo | null
  photoIdentifyingId: number | null
  photoClearingId: number | null

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
  toggleSelect: (id: number, multi?: boolean, range?: boolean) => void
  selectAll: () => void
  clearSelection: () => void
  selectByScore: (min: number, max: number) => void
  applyPhotoPatch: (
    id: number,
    patch: Partial<Pick<Photo, 'rating' | 'status' | 'color'>> & { tags?: string[] },
  ) => Promise<void>
  applyBatchPatch: (
    patch: Partial<Pick<Photo, 'rating' | 'status' | 'color'>> & { tags?: string[] },
  ) => Promise<void>

  runIdentify: (id: number) => Promise<void>
  clearIdentify: (id: number) => Promise<void>
  loadAiSpecies: () => Promise<void>
  startIdentifyAll: (opts?: { overwrite?: boolean }) => Promise<void>
  cancelIdentifyAll: () => Promise<void>
  clearIdentifyAll: () => Promise<void>
  checkAiHealth: () => Promise<void>
  updatePhotos: (updates: Map<number, Partial<Photo>>) => void
}

const PAGE_SIZE = 200

function errMsg(e: unknown, fallback: string) {
  if (e instanceof Error && e.message) return e.message
  return fallback
}

let photosQuerySeq = 0
function invalidatePhotosQuery() {
  photosQuerySeq += 1
  return photosQuerySeq
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
  filters: { status: 'all', ratingMin: 0, tag: '', q: '', aiZh: '', sort: 'recommend' },
  selectedPhotoId: null,
  selectedPhotoIds: new Set(),
  selectedPhoto: null,
  photoIdentifyingId: null,
  photoClearingId: null,

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
        // `selectLibrary` 会立即加载照片；先释放全局 loading，避免 loadMore 被短路。
        set({ loading: false })
        await get().selectLibrary(data.libraries[0]!.id)
      }
    } catch (e: unknown) {
      set({ error: errMsg(e, '加载库失败') })
    } finally {
      set({ loading: false })
    }
  },

  selectLibrary: async (id: number) => {
    invalidatePhotosQuery()
    set({
      selectedLibraryId: id,
      photos: [],
      total: 0,
      aiSpecies: [],
      identifyJob: null,
      identifying: false,
      selectedPhotoId: null,
      selectedPhotoIds: new Set(),
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
    invalidatePhotosQuery()
    set({ scanning: true, error: null })
    try {
      await scanLibrary(id)
      set({ photos: [], total: 0, selectedPhotoId: null, selectedPhotoIds: new Set(), selectedPhoto: null })
      await get().loadMore()
    } catch (e: unknown) {
      set({ error: errMsg(e, '扫描失败') })
    } finally {
      set({ scanning: false })
    }
  },

  setFilters: async (patch: Partial<Filters>) => {
    invalidatePhotosQuery()
    set({ filters: { ...get().filters, ...patch }, photos: [], total: 0, selectedPhotoId: null, selectedPhotoIds: new Set(), selectedPhoto: null })
    await get().loadMore()
  },

  loadMore: async () => {
    const id = get().selectedLibraryId
    if (!id) return
    if (get().loading) return
    const offset = get().photos.length
    if (get().total !== 0 && offset >= get().total) return

    const seq = photosQuerySeq
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
        sort: f.sort,
        offset,
        limit: PAGE_SIZE,
      })
      if (seq !== photosQuerySeq) return
      const nextPhotos = [...get().photos, ...data.photos]
      set({ photos: nextPhotos, total: data.total })
      const missing = nextPhotos
        .filter(
          (p) =>
            p.aiTop1 &&
            (p.aesthetic_score == null ||
              (typeof p.aesthetic_mtime_ms === 'number' && p.aesthetic_mtime_ms !== p.mtime_ms)),
        )
        .slice(0, 8)
        .map((p) => p.id)
      if (missing.length) {
        try {
          const r = await backfillAesthetic({ libraryId: id, photoIds: missing })
          const patch = new Map(r.updated.map((u) => [u.id, u]))
          if (patch.size) {
            set({
              photos: get().photos.map((p) => {
                const u = patch.get(p.id)
                return u
                  ? { ...p, aesthetic_score: u.aesthetic_score, aesthetic_score_cal: u.aesthetic_score_cal, aesthetic_updated_at: u.aesthetic_updated_at }
                  : p
              }),
              selectedPhoto:
                get().selectedPhoto && patch.has(get().selectedPhoto!.id)
                  ? {
                      ...get().selectedPhoto!,
                      aesthetic_score: patch.get(get().selectedPhoto!.id)!.aesthetic_score,
                      aesthetic_score_cal: patch.get(get().selectedPhoto!.id)!.aesthetic_score_cal,
                      aesthetic_updated_at: patch.get(get().selectedPhoto!.id)!.aesthetic_updated_at,
                    }
                  : get().selectedPhoto,
            })
          }
        } catch {
          void 0
        }
      }
    } catch (e: unknown) {
      if (seq !== photosQuerySeq) return
      set({ error: errMsg(e, '加载照片失败') })
    } finally {
      if (seq === photosQuerySeq) set({ loading: false })
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
      const libId = get().selectedLibraryId
      if (libId) {
        const p = data.photo
        const needs =
          !!p.ai &&
          (p.aesthetic_score == null ||
            (typeof p.aesthetic_mtime_ms === 'number' &&
              typeof p.mtime_ms === 'number' &&
              p.aesthetic_mtime_ms !== p.mtime_ms))
        if (needs) {
          try {
            const r = await backfillAesthetic({ libraryId: libId, photoIds: [id] })
            const u = r.updated?.[0]
            if (u) {
              set({
                photos: get().photos.map((x) =>
                  x.id === id ? { ...x, aesthetic_score: u.aesthetic_score, aesthetic_score_cal: u.aesthetic_score_cal, aesthetic_updated_at: u.aesthetic_updated_at } : x,
                ),
                selectedPhoto:
                  get().selectedPhotoId === id && get().selectedPhoto
                    ? { ...get().selectedPhoto!, aesthetic_score: u.aesthetic_score, aesthetic_score_cal: u.aesthetic_score_cal, aesthetic_updated_at: u.aesthetic_updated_at }
                    : get().selectedPhoto,
              })
            }
          } catch {
            void 0
          }
        }
        const exifNeeds = !p.exif || !p.taken_at || !p.width || !p.height
        if (exifNeeds) {
          try {
            const r = await backfillExif({ libraryId: libId, photoIds: [id] })
            const u = r.updated?.[0]
            if (u) {
              set({
                selectedPhoto:
                  get().selectedPhotoId === id && get().selectedPhoto
                    ? { ...get().selectedPhoto!, exif: u.exif, taken_at: u.taken_at, width: u.width, height: u.height }
                    : get().selectedPhoto,
              })
            }
            const f = Array.isArray(r.failed) ? r.failed.find((x) => x && x.id === id) : null
            if (f && !u) {
              set({ error: `EXIF 提取失败：${f.error}` })
            }
          } catch {
            void 0
          }
        }
      }
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

  toggleSelect: (id, multi, range) => {
    const { selectedPhotoIds, selectedPhotoId, photos } = get()
    const nextSelected = new Set(multi ? selectedPhotoIds : [])

    if (range && selectedPhotoId) {
      const idx1 = photos.findIndex((p) => p.id === selectedPhotoId)
      const idx2 = photos.findIndex((p) => p.id === id)
      if (idx1 !== -1 && idx2 !== -1) {
        const start = Math.min(idx1, idx2)
        const end = Math.max(idx1, idx2)
        for (let i = start; i <= end; i++) {
          nextSelected.add(photos[i].id)
        }
      } else {
        nextSelected.add(id)
      }
    } else {
      if (multi) {
        if (nextSelected.has(id)) {
          nextSelected.delete(id)
        } else {
          nextSelected.add(id)
        }
      } else {
        nextSelected.clear()
        nextSelected.add(id)
      }
    }

    set({ selectedPhotoIds: nextSelected })
    if (id !== selectedPhotoId) {
      get().selectPhoto(id)
    }
  },

  selectAll: () => {
    const ids = get().photos.map((p) => p.id)
    set({ selectedPhotoIds: new Set(ids) })
  },

  clearSelection: () => {
    set({ selectedPhotoIds: new Set() })
  },

  selectByScore: (min, max) => {
    const ids = get().photos
      .filter((p) => {
        const s = p.aesthetic_score ?? 0
        return s >= min && s <= max
      })
      .map((p) => p.id)
    set({ selectedPhotoIds: new Set(ids) })
  },

  applyBatchPatch: async (patch) => {
    const ids = Array.from(get().selectedPhotoIds)
    if (!ids.length) return

    try {
      const r = await batchPatchPhotos(ids, patch)
      const updatedIds = new Set(r.updated)
      set((state) => {
        const nextPhotos = state.photos.map((p) => {
          if (updatedIds.has(p.id)) {
            return { ...p, ...patch }
          }
          return p
        })
        const nextSelected =
          state.selectedPhoto && updatedIds.has(state.selectedPhoto.id)
            ? { ...state.selectedPhoto, ...patch }
            : state.selectedPhoto
        return {
          photos: nextPhotos,
          selectedPhoto: nextSelected,
        }
      })
    } catch (e: unknown) {
      set({ error: errMsg(e, '批量更新失败') })
    }
  },

  runIdentify: async (id) => {
    if (get().photoIdentifyingId === id || get().photoClearingId === id) return
    set({ photoIdentifyingId: id, error: null })
    try {
      const data = await identifyPhoto(id)
      const aes = data.aesthetic
      set({
        photos: get().photos.map((p) =>
          p.id === id
            ? { ...p, ai: data.ai, aesthetic_score: aes?.score ?? p.aesthetic_score, aesthetic_updated_at: aes?.updatedAt ?? p.aesthetic_updated_at }
            : p,
        ),
        selectedPhoto:
          get().selectedPhotoId === id && get().selectedPhoto
            ? { ...get().selectedPhoto!, ai: data.ai }
            : get().selectedPhoto,
      })
      if (get().selectedPhotoId === id && get().selectedPhoto) {
        set({
          selectedPhoto: {
            ...get().selectedPhoto!,
            ai: data.ai,
            aesthetic_score: aes?.score ?? get().selectedPhoto!.aesthetic_score,
            aesthetic_updated_at: aes?.updatedAt ?? get().selectedPhoto!.aesthetic_updated_at,
          },
        })
      }
    } catch (e: unknown) {
      set({ error: errMsg(e, '识别失败') })
    } finally {
      if (get().photoIdentifyingId === id) set({ photoIdentifyingId: null })
    }
  },

  clearIdentify: async (id) => {
    if (get().photoClearingId === id || get().photoIdentifyingId === id) return
    set({ photoClearingId: id, error: null })
    try {
      await clearPhotoAi(id)
      set((state) => ({
        photos: state.photos.map((p) =>
          p.id === id
            ? {
                ...p,
                ai: null,
                aiTop1: null,
                aesthetic_score: null,
                aesthetic_score_cal: null,
                aesthetic_updated_at: null,
              }
            : p,
        ),
        selectedPhoto:
          state.selectedPhotoId === id && state.selectedPhoto
            ? {
                ...state.selectedPhoto!,
                ai: null,
                aiTop1: null,
                aesthetic_score: null,
                aesthetic_score_cal: null,
                aesthetic_updated_at: null,
              }
            : state.selectedPhoto,
      }))
    } catch (e: unknown) {
      set({ error: errMsg(e, '清除失败') })
    } finally {
      if (get().photoClearingId === id) set({ photoClearingId: null })
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
          invalidatePhotosQuery()
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
      invalidatePhotosQuery()
      // Force reset photos to trigger reload and avoid stale data
      set((state) => ({
        photos: [],
        total: 0,
        selectedPhotoId: null,
        selectedPhoto: null,
        aiSpecies: [],
        // Reset filters if they depend on AI
        filters: state.filters.aiZh ? { ...state.filters, aiZh: '' } : state.filters
      }))
      await get().loadAiSpecies()
      await get().loadMore()
    } catch (e: unknown) {
      set({ error: errMsg(e, '清除失败') })
    }
  },

  checkAiHealth: async () => {
    // Implement health check logic if needed, currently just a placeholder in store
    // components can call api.checkAiHealth() directly
  },

  updatePhotos: (updates) => {
    set((state) => ({
      photos: state.photos.map((p) => {
        const patch = updates.get(p.id)
        return patch ? { ...p, ...patch } : p
      }),
      selectedPhoto:
        state.selectedPhoto && updates.has(state.selectedPhoto.id)
          ? { ...state.selectedPhoto, ...updates.get(state.selectedPhoto.id) }
          : state.selectedPhoto,
    }))
  },
}))
