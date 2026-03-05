import { memo } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { thumbUrl, type Photo } from '@/api/catalogApi'
import { getBirdName, cn } from '@/lib/utils'
import type { Taxonomy, DisplayLang } from '@/store/catalogStore'

interface PhotoItemProps {
  photo: Photo
  selected: boolean
  taxonomy: Taxonomy
  displayLang: DisplayLang
  onClick: (e: React.MouseEvent) => void
  style?: React.CSSProperties
}

function badgeForStatus(status: Photo['status']) {
  if (status === 'keep') return { icon: CheckCircle2, className: 'text-emerald-600' }
  if (status === 'reject') return { icon: XCircle, className: 'text-rose-600' }
  return null
}

export const PhotoItem = memo(({ photo, selected, taxonomy, displayLang, onClick, style }: PhotoItemProps) => {
  const badge = badgeForStatus(photo.status)
  const BadgeIcon = badge?.icon

  return (
    <div style={style} className="h-full">
      <div
        className={cn(
          "group relative h-full overflow-hidden rounded-md cursor-pointer select-none",
          selected
            ? "ring-2 ring-zinc-900"
            : "ring-1 ring-zinc-200 hover:ring-zinc-300"
        )}
        onClick={onClick}
      >
        <img
          className="aspect-square w-full bg-white object-cover"
          src={thumbUrl(photo.id, 256)}
          alt={photo.rel_path}
          loading="lazy"
          draggable={false}
        />

        {photo.aiTop1?.nameZh || photo.aiTop1?.nameScientific ? (
          <div className="pointer-events-none absolute left-2 top-2 max-w-[80%] truncate rounded bg-black/60 px-2 py-1 text-[10px] text-white">
            {getBirdName(
              photo.aiTop1?.nameScientific,
              photo.aiTop1?.nameZh,
              taxonomy,
              displayLang,
            )}
          </div>
        ) : null}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent px-2 py-2">
          <div className="flex items-center gap-2">
            {BadgeIcon ? <BadgeIcon className={`h-4 w-4 ${badge!.className}`} /> : null}
            {photo.rating > 0 ? (
              <div className="flex items-center gap-1 text-xs font-medium text-yellow-400">
                <span>{photo.rating}</span>
                <span className="text-[10px]">★</span>
              </div>
            ) : (
              typeof (photo.aesthetic_score_cal ?? photo.aesthetic_score) === 'number' &&
              Number.isFinite(photo.aesthetic_score_cal ?? photo.aesthetic_score) ? (
                <div className="flex items-center gap-1 text-xs text-zinc-300" title="AI 美学分 (建议星级)">
                  <span className="font-mono">{(photo.aesthetic_score_cal ?? photo.aesthetic_score!).toFixed(0)}</span>
                  {(() => {
                    const s = photo.aesthetic_score_cal ?? photo.aesthetic_score!
                    const r = s >= 60 ? 5 : s >= 50 ? 4 : s >= 40 ? 3 : s >= 30 ? 2 : s >= 20 ? 1 : 0
                    return r > 0 ? <span className="text-[10px] opacity-70">({r}★)</span> : null
                  })()}
                </div>
              ) : (
                <div className="text-xs text-zinc-500">_</div>
              )
            )}
          </div>
          <div className="max-w-[120px] truncate text-xs text-white/80">{photo.rel_path}</div>
        </div>
      </div>
    </div>
  )
})

PhotoItem.displayName = 'PhotoItem'
