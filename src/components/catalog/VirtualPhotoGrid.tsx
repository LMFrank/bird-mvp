import { useMemo, useCallback, forwardRef, type ComponentProps } from 'react'
import { VirtuosoGrid } from 'react-virtuoso'
import { useCatalogStore } from '@/store/catalogStore'
import { PhotoItem } from './PhotoItem'

export default function VirtualPhotoGrid() {
  const {
    photos,
    loading,
    loadMore,
    loadAll,
    selectedPhotoIds,
    selectedLibraryId,
    total,
    taxonomy,
    displayLang,
    toggleSelect,
  } = useCatalogStore()

  const empty = useMemo(() => selectedLibraryId && photos.length === 0 && !loading, [loading, photos.length, selectedLibraryId])

  const handleSelect = useCallback((e: React.MouseEvent, id: number) => {
    // Prevent default text selection on double click
    if (e.detail > 1) e.preventDefault()
    
    const multi = e.ctrlKey || e.metaKey
    const range = e.shiftKey
    toggleSelect(id, multi, range)
  }, [toggleSelect])

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
    <div className="h-[calc(100vh-120px)] bg-zinc-100">
      <VirtuosoGrid
        style={{ height: '100%' }}
        totalCount={photos.length}
        data={photos}
        endReached={() => loadMore()}
        overscan={400}
        computeItemKey={(index) => photos[index].id}
        components={{
          List: forwardRef<HTMLDivElement, ComponentProps<'div'>>(({ style, children, ...props }, ref) => (
            <div
              ref={ref}
              {...props}
              style={style}
              className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 content-start"
            >
              {children}
            </div>
          )),
          Item: forwardRef<HTMLDivElement, ComponentProps<'div'>>(({ children, ...props }, ref) => (
            <div {...props} ref={ref}>
              {children}
            </div>
          )),
          Footer: () => (
             <div className="col-span-full py-6 text-center text-sm text-zinc-500">
                {loading ? (
                    <div>加载中…</div>
                ) : (
                    <div className="space-y-2">
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
        }}
        itemContent={(index, photo) => (
           <PhotoItem
             photo={photo}
             selected={selectedPhotoIds.has(photo.id)}
             taxonomy={taxonomy}
             displayLang={displayLang}
             onClick={(e) => handleSelect(e, photo.id)}
           />
        )}
      />
    </div>
  )
}
