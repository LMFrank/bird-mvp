import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Copy, ExternalLink, XCircle, Trash2 } from 'lucide-react'
import { thumbUrl } from '@/api/catalogApi'
import { useCatalogStore } from '@/store/catalogStore'
import TagEditor from '@/components/catalog/TagEditor'
import { getBirdName } from '@/lib/utils'

function formatBytes(n: number) {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export default function PhotoInspector() {
  const {
    photos,
    selectedPhotoId,
    selectedPhoto,
    selectPhoto,
    applyPhotoPatch,
    runIdentify,
    clearIdentify,
    taxonomy,
    displayLang,
  } = useCatalogStore()

  const [tagHotkeySignal, setTagHotkeySignal] = useState(0)

  const idx = useMemo(() => photos.findIndex((p) => p.id === selectedPhotoId), [photos, selectedPhotoId])
  const current = useMemo(() => {
    if (!selectedPhotoId) return null
    return selectedPhoto ?? photos.find((p) => p.id === selectedPhotoId) ?? null
  }, [photos, selectedPhoto, selectedPhotoId])

  const prevId = idx > 0 ? photos[idx - 1]!.id : null
  const nextId = idx >= 0 && idx < photos.length - 1 ? photos[idx + 1]!.id : null

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!current) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      if (e.key === 'ArrowLeft') {
        if (prevId) selectPhoto(prevId)
        return
      }
      if (e.key === 'ArrowRight') {
        if (nextId) selectPhoto(nextId)
        return
      }
      if (e.key === 'p' || e.key === 'P') {
        applyPhotoPatch(current.id, { status: 'keep' })
        return
      }
      if (e.key === 'x' || e.key === 'X') {
        applyPhotoPatch(current.id, { status: 'reject' })
        return
      }
      if (e.key >= '0' && e.key <= '5') {
        applyPhotoPatch(current.id, { rating: Number(e.key) })
        return
      }
      if (e.key === 't' || e.key === 'T') {
        setTagHotkeySignal((v) => v + 1)
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [applyPhotoPatch, current, nextId, prevId, selectPhoto])

  if (!current) {
    return (
      <div className="hidden h-[calc(100vh-120px)] w-[420px] shrink-0 border-l border-zinc-200 bg-white p-4 lg:block">
        <div className="text-sm text-zinc-500">选择一张照片开始预览与打标</div>
        <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
          快捷键：P 保留，X 淘汰，0-5 星级，T 添加标签，←/→ 切换
        </div>
      </div>
    )
  }

  const tags = current.tags ?? []
  const ai = current.ai ?? null

  return (
    <div className="hidden h-[calc(100vh-120px)] w-[420px] shrink-0 overflow-auto border-l border-zinc-200 bg-white lg:block">
      <div className="space-y-4 p-4">
        <div className="space-y-2">
          <div className="text-sm font-medium text-zinc-900">预览</div>
          <div className="overflow-hidden rounded-md border border-zinc-200 bg-zinc-100">
            <img className="w-full object-contain" src={thumbUrl(current.id, 2048)} alt={current.rel_path} />
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium text-zinc-900">打标</div>
          <div className="flex flex-wrap gap-2">
            <button
              className={
                current.status === 'keep'
                  ? 'inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm text-white'
                  : 'inline-flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm hover:bg-zinc-50'
              }
              onClick={() => applyPhotoPatch(current.id, { status: 'keep' })}
            >
              <CheckCircle2 className="h-4 w-4" />
              保留 (P)
            </button>
            <button
              className={
                current.status === 'reject'
                  ? 'inline-flex items-center gap-2 rounded-md bg-rose-600 px-3 py-2 text-sm text-white'
                  : 'inline-flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm hover:bg-zinc-50'
              }
              onClick={() => applyPhotoPatch(current.id, { status: 'reject' })}
            >
              <XCircle className="h-4 w-4" />
              淘汰 (X)
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                className={
                  current.rating === n
                    ? 'rounded-md bg-zinc-900 px-3 py-2 text-sm text-white'
                    : 'rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm hover:bg-zinc-50'
                }
                onClick={() => applyPhotoPatch(current.id, { rating: n })}
              >
                {n}★
              </button>
            ))}
          </div>

          <TagEditor
            tags={tags}
            hotkeySignal={tagHotkeySignal}
            onChange={(next) => applyPhotoPatch(current.id, { tags: next })}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-zinc-900">鸟种识别</div>
            <div className="flex gap-2">
              {ai ? (
                <button
                  className="inline-flex h-9 items-center rounded-md border border-zinc-300 bg-white px-3 text-sm hover:bg-zinc-50 text-rose-600"
                  onClick={() => clearIdentify(current.id)}
                  title="清除识别结果"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
              <button
                className="inline-flex h-9 items-center rounded-md border border-zinc-300 bg-white px-3 text-sm hover:bg-zinc-50"
                onClick={() => runIdentify(current.id)}
                title="使用本地离线模型识别（基于预览图）"
              >
                识别
              </button>
            </div>
          </div>

          {ai && ai.predictions?.length ? (
            <div className="space-y-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
              <div className="text-xs text-zinc-600">
                {ai.provider} / {ai.model}
                {typeof ai.labelsCount === 'number' ? ` · labels ${ai.labelsCount}` : ''}
                {typeof ai.promptCount === 'number' ? ` · prompts ${ai.promptCount}` : ''}
              </div>
              {typeof ai.labelsCount === 'number' && ai.labelsCount < 100 ? (
                <div className="text-xs text-zinc-500">
                  当前标签数较少，识别仅供参考；建议提供全量鸟种 CSV 到 data/models/labels.csv
                </div>
              ) : null}
              {(() => {
                const p1 = ai.predictions?.[0]
                const p2 = ai.predictions?.[1]
                if (!p1) return null
                const margin = p2 ? p1.score - p2.score : p1.score
                if (p1.score < 0.6 || margin < 0.1) {
                  return <div className="text-xs text-zinc-500">置信度不高：建议只当作候选参考</div>
                }
                return null
              })()}
              <div className="space-y-1">
                {ai.predictions.slice(0, 5).map((p, i) => {
                  const name = getBirdName(p.nameScientific, p.nameZh, taxonomy, displayLang)
                  const title = [name, p.nameScientific].filter(Boolean).join(' / ')
                  return (
                    <div key={i} className="flex items-center justify-between gap-2 text-sm">
                      <div className="min-w-0 flex-1 truncate" title={title}>
                        {name}
                      </div>
                      <div className="shrink-0 text-xs text-zinc-600">{(p.score * 100).toFixed(1)}%</div>
                      <button
                        className="shrink-0 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs hover:bg-zinc-50"
                        onClick={() => {
                          const tag = name
                          if (!tag) return
                          applyPhotoPatch(current.id, { tags: Array.from(new Set([...tags, tag])).sort() })
                        }}
                        title="将该结果加入标签"
                      >
                        加入标签
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="text-xs text-zinc-500">暂无结果，点击“识别”获取 Top5 候选</div>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium text-zinc-900">信息</div>
          <div className="space-y-1 text-xs text-zinc-700">
            <div className="truncate" title={current.rel_path}>
              {current.rel_path}
            </div>
            <div className="truncate" title={current.abs_path}>
              {current.abs_path}
            </div>
            <div>{new Date(current.mtime_ms).toLocaleString()}</div>
            <div>{formatBytes(current.size)}</div>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm hover:bg-zinc-50"
              onClick={async () => {
                await navigator.clipboard.writeText(current.abs_path)
              }}
              title="复制本地路径"
            >
              <Copy className="h-4 w-4" />
              复制路径
            </button>
            <a
              className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm hover:bg-zinc-50"
              href={current.abs_path}
              target="_blank"
              rel="noreferrer"
              title="尝试用系统方式打开（可能受浏览器限制）"
            >
              <ExternalLink className="h-4 w-4" />
              打开
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
