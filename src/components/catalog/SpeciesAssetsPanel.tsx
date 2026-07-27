import { useCallback, useEffect, useMemo, useState } from 'react'
import { BarChart3, CheckCircle2, MapPin, RefreshCw, Sparkles } from 'lucide-react'
import {
  getLibraryEvaluation,
  getSpeciesAssets,
  rebuildSequences,
  thumbUrl,
  updateLibraryRegion,
  type EvaluationMetrics,
  type SpeciesAsset,
} from '@/api/catalogApi'
import { useCatalogStore } from '@/store/catalogStore'

function percent(value: number | null | undefined) {
  return typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : '待建立'
}

export default function SpeciesAssetsPanel() {
  const { selectedLibraryId, libraries, setFilters, selectPhoto, loadLibraries } = useCatalogStore()
  const [assets, setAssets] = useState<SpeciesAsset[]>([])
  const [metrics, setMetrics] = useState<EvaluationMetrics | null>(null)
  const [loading, setLoading] = useState(false)
  const [region, setRegion] = useState('CN')
  const current = useMemo(
    () => libraries.find((library) => library.id === selectedLibraryId),
    [libraries, selectedLibraryId],
  )

  const refresh = useCallback(async () => {
    if (!selectedLibraryId) return
    setLoading(true)
    try {
      const [assetResult, evaluationResult] = await Promise.all([
        getSpeciesAssets(selectedLibraryId),
        getLibraryEvaluation(selectedLibraryId),
      ])
      setAssets(assetResult.assets)
      setMetrics(evaluationResult.metrics)
    } finally {
      setLoading(false)
    }
  }, [selectedLibraryId])

  useEffect(() => {
    setRegion(current?.region_code || 'CN')
  }, [current?.region_code])

  useEffect(() => {
    void refresh()
    const onChanged = () => void refresh()
    window.addEventListener('bird:assets-changed', onChanged)
    return () => window.removeEventListener('bird:assets-changed', onChanged)
  }, [refresh])

  if (!selectedLibraryId) return null

  return (
    <section className="border-b border-emerald-950/10 bg-[linear-gradient(120deg,#f2f5e9_0%,#fffdf5_55%,#e8f0e6_100%)] px-4 py-4">
      <div className="mx-auto flex max-w-[1800px] flex-wrap items-start gap-4">
        <div className="min-w-[250px] flex-1">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-900/60">
            <Sparkles className="h-4 w-4" />
            Field archive
          </div>
          <div className="mt-1 flex items-end gap-3">
            <h2 className="font-serif text-2xl font-semibold text-emerald-950">物种资产</h2>
            <span className="pb-1 text-sm text-emerald-900/60">
              {assets.length} 种 · {metrics?.birds?.evaluated ?? metrics?.evaluated ?? 0} 张可定种鸟类真值
              {metrics?.nonBird ? ` · ${metrics.nonBird.total} 张拒识真值` : ''}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              ['Top1', percent(metrics?.top1Accuracy)],
              ['Top5', percent(metrics?.top5Recall)],
              ['野生 Top1', percent(metrics?.wild?.top1Accuracy)],
              ['圈养 Top1', percent(metrics?.captive?.top1Accuracy)],
              ['非鸟拒识', percent(metrics?.nonBird?.rejectionRate)],
              ['拒识精度', percent(metrics?.nonBird?.autoRejectPrecision)],
              ['自动通过精度', percent(metrics?.automatic?.acceptedPrecision ?? metrics?.acceptedPrecision)],
              ['自动覆盖率', percent(metrics?.automatic?.coverage)],
              ['连拍一致率', percent(metrics?.sequences?.rawConsistency)],
              ['连拍融合 Top1', percent(metrics?.sequences?.fusedTop1Accuracy)],
              ['待复核', percent(metrics?.reviewRate)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-full border border-emerald-900/15 bg-white/70 px-3 py-1 text-xs text-emerald-950">
                <span className="text-emerald-900/55">{label}</span> · {value}
              </div>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 rounded-xl border border-emerald-900/15 bg-white/75 px-3 py-2 text-sm text-emerald-950 shadow-sm">
          <MapPin className="h-4 w-4 text-amber-700" />
          候选区域
          <input
            className="w-24 border-0 bg-transparent font-mono text-xs uppercase outline-none"
            value={region}
            onChange={(event) => setRegion(event.target.value.toUpperCase())}
            onBlur={async () => {
              await updateLibraryRegion(selectedLibraryId, region || 'CN')
              await loadLibraries()
            }}
            title="WORLD 使用全球集；CN、CN-JS 使用对应区域 CSV 并自动合并 captive.csv"
          />
        </label>

        <button
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-900/15 bg-white/75 px-3 text-sm text-emerald-950 shadow-sm hover:bg-white"
          onClick={() => void refresh()}
        >
          {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
          刷新评测
        </button>
        <button
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-900/15 bg-white/75 px-3 text-sm text-emerald-950 shadow-sm hover:bg-white"
          onClick={async () => {
            await rebuildSequences(selectedLibraryId)
            await refresh()
          }}
          title="按拍摄时间与 BioCLIP embedding 重建连拍组"
        >
          <RefreshCw className="h-4 w-4" />
          重建连拍
        </button>
      </div>

      {assets.length ? (
        <div className="mx-auto mt-4 flex max-w-[1800px] gap-3 overflow-x-auto pb-1">
          {assets.slice(0, 12).map((asset) => (
            <button
              key={asset.nameScientific}
              className="group flex min-w-[230px] items-center gap-3 rounded-2xl border border-emerald-950/10 bg-white/80 p-2 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              onClick={async () => {
                await setFilters({ aiZh: asset.nameZh })
                if (asset.bestPhotoId) await selectPhoto(asset.bestPhotoId)
              }}
            >
              <img
                className="h-14 w-14 rounded-xl object-cover saturate-[.85] transition group-hover:saturate-100"
                src={thumbUrl(asset.bestPhotoId, 256)}
                alt=""
              />
              <span className="min-w-0">
                <span className="block truncate font-serif text-base font-semibold text-emerald-950">{asset.nameZh}</span>
                <span className="block truncate text-[11px] italic text-emerald-900/55">{asset.nameScientific}</span>
                <span className="mt-1 flex items-center gap-1 text-xs text-emerald-800/70">
                  <CheckCircle2 className="h-3 w-3" />
                  确认 {asset.confirmedCount} · 预测 {asset.predictedCount}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="mx-auto mt-3 max-w-[1800px] text-sm text-emerald-900/55">
          识别并人工确认照片后，这里会形成你的个人物种档案。
        </div>
      )}
    </section>
  )
}
