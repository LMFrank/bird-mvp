import { useEffect, useMemo, useState } from 'react'
import { FolderPlus, RefreshCw, Sparkles, X, Languages, Trash2 } from 'lucide-react'
import { useCatalogStore, type DisplayLang } from '@/store/catalogStore'

export default function LibraryBar() {
  const {
    libraries,
    selectedLibraryId,
    loadLibraries,
    selectLibrary,
    createLibrary,
    runScan,
    scanning,
    identifying,
    identifyJob,
    startIdentifyAll,
    cancelIdentifyAll,
    clearIdentifyAll,
    loading,
    displayLang,
    setDisplayLang,
  } = useCatalogStore()

  const [rootPath, setRootPath] = useState('')

  useEffect(() => {
    loadLibraries()
  }, [loadLibraries])

  const current = useMemo(
    () => libraries.find((l) => l.id === selectedLibraryId) ?? null,
    [libraries, selectedLibraryId],
  )

  return (
    <div className="flex items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-3">
      <div className="flex items-center gap-2">
        <div className="mr-2 text-lg font-bold text-zinc-800">灵羽图库</div>
        <select
          className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm outline-none focus:border-zinc-400"
          value={selectedLibraryId ?? ''}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (Number.isFinite(v)) selectLibrary(v)
          }}
        >
          <option value="" disabled>
            选择照片目录库
          </option>
          {libraries.map((l) => (
            <option key={l.id} value={l.id}>
              {l.root_path}
            </option>
          ))}
        </select>

        <button
          className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm hover:bg-zinc-50 disabled:opacity-50"
          onClick={() => runScan()}
          disabled={!selectedLibraryId || scanning}
          title="扫描目录并建立索引"
        >
          <RefreshCw className={scanning ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          扫描
        </button>

        <button
          className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm hover:bg-zinc-50 disabled:opacity-50"
          onClick={() => startIdentifyAll({ overwrite: false })}
          disabled={!selectedLibraryId || identifying}
          title="对当前库进行批量鸟种识别（后台任务）"
        >
          <Sparkles className={identifying ? 'h-4 w-4 animate-pulse' : 'h-4 w-4'} />
          {identifyJob && (identifyJob.status === 'queued' || identifyJob.status === 'running')
            ? `一键识别 ${identifyJob.processed}/${identifyJob.total}`
            : '一键识别'}
        </button>

        <button
          className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm hover:bg-zinc-50 disabled:opacity-50"
          onClick={() => startIdentifyAll({ overwrite: true })}
          disabled={!selectedLibraryId || identifying}
          title="覆盖已有结果重新识别（用于更新标签集或模型后）"
        >
          <Sparkles className="h-4 w-4" />
          重识别
        </button>

        <button
          className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm hover:bg-zinc-50 disabled:opacity-50 text-rose-600"
          onClick={() => {
            if (!selectedLibraryId) return
            if (!confirm('确定要清除当前库的所有识别结果吗？')) return
            clearIdentifyAll()
          }}
          disabled={!selectedLibraryId || identifying}
          title="清除当前库的全部识别结果"
        >
          <Trash2 className="h-4 w-4" />
          清除识别
        </button>

        {identifyJob && (identifyJob.status === 'queued' || identifyJob.status === 'running') ? (
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm hover:bg-zinc-50"
            onClick={() => cancelIdentifyAll()}
            title="取消批量识别"
          >
            <X className="h-4 w-4" />
            取消
          </button>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 py-1">
          <Languages className="h-4 w-4 text-zinc-500" />
          <select
            className="h-7 border-none bg-transparent text-sm outline-none"
            value={displayLang}
            onChange={(e) => setDisplayLang(e.target.value as DisplayLang)}
            title="切换鸟种名称显示语言"
          >
            <option value="zh_CN">简体中文</option>
            <option value="zh_TW">繁體中文</option>
            <option value="en">English</option>
            <option value="sci">Scientific</option>
          </select>
        </div>

        <input
          className="h-9 w-[320px] rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-zinc-400"
          placeholder={`新增目录（示例：${
            current?.root_path ?? 'C:\\Photos\\JPG'
          }）`}
          value={rootPath}
          onChange={(e) => setRootPath(e.target.value)}
        />
        <button
          className="inline-flex h-9 items-center gap-2 rounded-md bg-zinc-900 px-3 text-sm text-white hover:bg-zinc-800 disabled:opacity-50"
          onClick={() => {
            const p = rootPath.trim()
            if (!p) return
            createLibrary(p)
            setRootPath('')
          }}
          disabled={loading}
          title="添加一个本地目录作为照片库"
        >
          <FolderPlus className="h-4 w-4" />
          添加
        </button>
      </div>
    </div>
  )
}
