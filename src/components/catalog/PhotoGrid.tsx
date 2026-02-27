import { useEffect, useMemo, useRef } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { thumbUrl, type Photo } from '@/api/catalogApi'
import { useCatalogStore } from '@/store/catalogStore'
import { getBirdName } from '@/lib/utils'

function badgeForStatus(status: Photo['status']) {
  if (status === 'keep') return { icon: CheckCircle2, className: 'text-emerald-600' }
  if (status === 'reject') return { icon: XCircle, className: 'text-rose-600' }
  return null
}

export default function PhotoGrid() {
  const {
    photos,
    loading,
    loadMore,
    loadAll,
    selectedPhotoId,
    selectPhoto,
    selectedLibraryId,
    total,
    taxonomy,
    displayLang,
  } = useCatalogStore()

  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore()
      },
      { rootMargin: '1200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [loadMore])

  const empty = useMemo(() => selectedLibraryId && photos.length === 0 && !loading, [loading, photos.length, selectedLibraryId])

  if (!selectedLibraryId) {
    return (
      <div className="flex h-[calc(100vh-120px)] items-center justify-center text-sm text-zinc-500">
        先添加并选择一个照片目录，然后点击“扫描”
      </div>
    )
  }

  if (empty) {
    return (
      <div className="flex h-[calc(100vh-120px)] items-center justify-center text-sm text-zinc-500">
        目录已选择，但还没有索引结果（请先扫描）
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-120px)] overflow-auto bg-zinc-100">
      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
        {photos.map((p) => {
          const selected = p.id === selectedPhotoId
          const badge = badgeForStatus(p.status)
          const BadgeIcon = badge?.icon
          return (
            <button
              key={p.id}
              className={
                selected
                  ? 'group relative overflow-hidden rounded-md ring-2 ring-zinc-900'
                  : 'group relative overflow-hidden rounded-md ring-1 ring-zinc-200 hover:ring-zinc-300'
              }
              onClick={() => selectPhoto(p.id)}
            >
              <img
                className="aspect-square w-full bg-white object-cover"
                src={thumbUrl(p.id, 256)}
                alt={p.rel_path}
                loading="lazy"
              />

              {p.aiTop1?.nameZh || p.aiTop1?.nameScientific ? (
                <div className="pointer-events-none absolute left-2 top-2 max-w-[80%] truncate rounded bg-black/60 px-2 py-1 text-[10px] text-white">
                  {getBirdName(
                    p.aiTop1?.nameScientific,
                    p.aiTop1?.nameZh,
                    taxonomy,
                    displayLang,
                  )}
                </div>
              ) : null}

              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent px-2 py-2">
                <div className="flex items-center gap-1">
                  {BadgeIcon ? <BadgeIcon className={`h-4 w-4 ${badge!.className}`} /> : null}
                  {p.rating > 0 ? (
                    <div className="text-xs font-medium text-white">{p.rating}★</div>
                  ) : (
                    <div className="text-xs text-white/70">未评</div>
                  )}
                </div>
                <div className="max-w-[120px] truncate text-xs text-white/80">{p.rel_path}</div>
              </div>
            </button>
          )
        })}
      </div>

      <div ref={sentinelRef} className="h-10" />
      {loading ? (
        <div className="pb-6 text-center text-sm text-zinc-500">加载中…</div>
      ) : (
        <div className="pb-6 space-y-2 text-center text-sm text-zinc-500">
          <div>{total ? `已加载 ${photos.length}/${total}` : `已加载 ${photos.length}`}</div>
          {total && photos.length < total ? (
            <button
              className="h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-700 hover:bg-zinc-50"
              onClick={() => loadAll()}
            >
              加载全部
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}
