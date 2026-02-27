import LibraryBar from '@/components/catalog/LibraryBar'
import FilterBar from '@/components/catalog/FilterBar'
import PhotoGrid from '@/components/catalog/PhotoGrid'
import PhotoInspector from '@/components/catalog/PhotoInspector'
import { useCatalogStore } from '@/store/catalogStore'

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-100">
      <CatalogShell />
    </div>
  )
}

function CatalogShell() {
  const { error } = useCatalogStore()
  return (
    <div className="flex min-h-screen flex-col">
      <LibraryBar />
      <FilterBar />
      {error ? (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>
      ) : null}
      <div className="flex flex-1">
        <div className="flex-1">
          <PhotoGrid />
        </div>
        <PhotoInspector />
      </div>
    </div>
  )
}
