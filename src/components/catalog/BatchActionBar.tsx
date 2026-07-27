import { useState, useRef, useEffect } from 'react'
import { X, Check, XCircle, Star, Wand2, ChevronDown } from 'lucide-react'
import { useCatalogStore } from '@/store/catalogStore'
import { batchPatchPhotos, type Photo } from '@/api/catalogApi'
import { clsx } from 'clsx'

export default function BatchActionBar() {
  const selectedPhotoIds = useCatalogStore((s) => s.selectedPhotoIds)
  const photos = useCatalogStore((s) => s.photos)
  const clearSelection = useCatalogStore((s) => s.clearSelection)
  const applyBatchPatch = useCatalogStore((s) => s.applyBatchPatch)
  const selectByScore = useCatalogStore((s) => s.selectByScore)
  const updatePhotos = useCatalogStore((s) => s.updatePhotos)
  
  const [isRateOpen, setIsRateOpen] = useState(false)
  const [isSelectOpen, setIsSelectOpen] = useState(false)
  const [processing, setProcessing] = useState(false)
  
  const rateRef = useRef<HTMLDivElement>(null)
  const selectRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (rateRef.current && !rateRef.current.contains(event.target as Node)) {
        setIsRateOpen(false)
      }
      if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
        setIsSelectOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [])

  if (selectedPhotoIds.size === 0) return null

  const handleRate = async (rating: number) => {
    await applyBatchPatch({ rating })
    setIsRateOpen(false)
  }

  const handleAutoRate = async () => {
    if (processing) return
    setProcessing(true)
    try {
      const selectedPhotos = photos.filter(p => selectedPhotoIds.has(p.id))
      
      const groups: Record<number, number[]> = { 5: [], 4: [], 3: [], 0: [] }
      const updates = new Map<number, Partial<Photo>>()

      selectedPhotos.forEach(p => {
        // Use aesthetic_score_cal if available, otherwise 0
        const score = p.aesthetic_score_cal ?? 0
        
        let rating = 0
        // Adjusted thresholds for more forgiving auto-rating (SuperPicky style)
        if (score >= 60) rating = 5
        else if (score >= 50) rating = 4
        else if (score >= 40) rating = 3
        else if (score >= 30) rating = 2
        else if (score >= 20) rating = 1
        
        groups[rating].push(p.id)
        updates.set(p.id, { rating })
      })

      await Promise.all(
        Object.entries(groups).map(([ratingStr, ids]) => {
          if (ids.length === 0) return Promise.resolve()
          return batchPatchPhotos(ids, { rating: Number(ratingStr) })
        })
      )
      
      updatePhotos(updates)
      
      const summary = Object.entries(groups)
        .filter(([, ids]) => ids.length > 0)
        .map(([r, ids]) => `${r}星: ${ids.length}张`)
        .join('，') || '0张更新'

      alert(`自动评分完成：\n${summary}\n(评分规则：≥60=5星, ≥50=4星, ≥40=3星, ≥30=2星)`)
    } catch (e) {
      console.error(e)
      alert('自动评分失败')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white px-4 py-2 shadow-xl ring-1 ring-zinc-200">
      <div className="mr-2 text-sm font-medium text-zinc-600">
        已选 {selectedPhotoIds.size} 张
      </div>

      <button
        onClick={() => clearSelection()}
        className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100"
        title="清除选择"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="h-4 w-px bg-zinc-200" />

      <button
        onClick={() => applyBatchPatch({ status: 'keep' })}
        className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium text-emerald-600 hover:bg-emerald-50"
      >
        <Check className="h-4 w-4" />
        保留
      </button>

      <button
        onClick={() => applyBatchPatch({ status: 'reject' })}
        className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-50"
      >
        <XCircle className="h-4 w-4" />
        废弃
      </button>

      <div className="relative" ref={rateRef}>
        <button
          onClick={() => setIsRateOpen(!isRateOpen)}
          className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium text-amber-600 hover:bg-amber-50"
        >
          <Star className="h-4 w-4" />
          评分
        </button>
        {isRateOpen && (
          <div className="absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 flex-col overflow-hidden rounded-lg bg-white shadow-lg ring-1 ring-zinc-200">
            {[5, 4, 3, 2, 1, 0].map((r) => (
              <button
                key={r}
                onClick={() => handleRate(r)}
                className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-zinc-50"
              >
                <div className="flex text-amber-400">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={clsx('h-3 w-3', i < r ? 'fill-current' : 'text-zinc-300')}
                    />
                  ))}
                </div>
                <span className="text-zinc-600 whitespace-nowrap">{r === 0 ? '清除评分' : `${r} 星`}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="h-4 w-px bg-zinc-200" />

      <div className="relative" ref={selectRef}>
        <button
          onClick={() => setIsSelectOpen(!isSelectOpen)}
          className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50"
        >
          智能选择
          <ChevronDown className="h-3 w-3" />
        </button>
        {isSelectOpen && (
          <div className="absolute bottom-full left-1/2 mb-2 w-40 -translate-x-1/2 overflow-hidden rounded-lg bg-white py-1 shadow-lg ring-1 ring-zinc-200">
            <button
              onClick={() => {
                selectByScore(0, 35)
                setIsSelectOpen(false)
              }}
              className="block w-full px-4 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
            >
              低质量 (&lt; 35)
            </button>
            <button
              onClick={() => {
                selectByScore(80, 100)
                setIsSelectOpen(false)
              }}
              className="block w-full px-4 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
            >
              高质量 (&gt; 80)
            </button>
          </div>
        )}
      </div>

      <button
        onClick={handleAutoRate}
        disabled={processing}
        className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
        title="根据美学分数自动评分"
      >
        {processing ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" /> : <Wand2 className="h-4 w-4" />}
        自动评分
      </button>
    </div>
  )
}
