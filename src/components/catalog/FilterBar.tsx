import { useEffect, useState } from 'react'
import { Search, Star } from 'lucide-react'
import { useCatalogStore } from '@/store/catalogStore'

export default function FilterBar() {
  const { filters, setFilters, total, aiSpecies } = useCatalogStore()
  const [q, setQ] = useState(filters.q)
  const [tag, setTag] = useState(filters.tag)

  useEffect(() => setQ(filters.q), [filters.q])
  useEffect(() => setTag(filters.tag), [filters.tag])

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-3">
      <div className="flex items-center gap-2">
        <select
          className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm outline-none focus:border-zinc-400"
          value={filters.status}
          onChange={(e) => {
            const v = e.target.value
            if (v === 'all' || v === 'none' || v === 'keep' || v === 'reject') setFilters({ status: v })
          }}
        >
          <option value="all">全部</option>
          <option value="keep">保留</option>
          <option value="reject">淘汰</option>
          <option value="none">未处理</option>
        </select>

        <div className="flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-2 text-sm">
          <Star className="h-4 w-4 text-zinc-600" />
          <select
            className="h-9 bg-transparent pr-2 outline-none"
            value={filters.ratingMin}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (Number.isFinite(v) && v >= 0 && v <= 5) setFilters({ ratingMin: v })
            }}
            title="最低星级筛选"
          >
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                ≥ {n}★
              </option>
            ))}
          </select>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
          <input
            className="h-9 w-[260px] rounded-md border border-zinc-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-zinc-400"
            placeholder="按路径搜索"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setFilters({ q })
            }}
          />
        </div>

        <input
          className="h-9 w-[180px] rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-zinc-400"
          placeholder="标签（精确匹配）"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setFilters({ tag })
          }}
        />

        <select
          className="h-9 max-w-[220px] rounded-md border border-zinc-300 bg-white px-2 text-sm outline-none focus:border-zinc-400"
          value={filters.aiZh}
          onChange={(e) => setFilters({ aiZh: e.target.value })}
          title="按 AI 预测 Top1 鸟名筛选"
        >
          <option value="">AI（Top1）</option>
          {aiSpecies
            .filter((s) => typeof s.nameZh === 'string' && s.nameZh.trim())
            .slice(0, 200)
            .map((s) => (
              <option key={`${s.nameZh}__${s.nameScientific}`} value={s.nameZh}>
                {s.nameZh} ({s.count})
              </option>
            ))}
        </select>

        <button
          className="h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm hover:bg-zinc-50"
          onClick={() => setFilters({ q: '', tag: '', aiZh: '', status: 'all', ratingMin: 0 })}
        >
          重置
        </button>
      </div>

      <div className="text-sm text-zinc-600">{total ? `${total} 张` : '未扫描或无结果'}</div>
    </div>
  )
}
