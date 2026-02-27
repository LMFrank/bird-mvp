import { useEffect, useMemo, useRef, useState } from 'react'

export default function TagEditor(props: {
  tags: string[]
  onChange: (next: string[]) => void
  hotkeySignal: number
}) {
  const { tags, onChange, hotkeySignal } = props
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (hotkeySignal > 0) inputRef.current?.focus()
  }, [hotkeySignal])

  const normalized = useMemo(() => tags.slice().sort(), [tags])

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {normalized.length ? (
          normalized.map((t) => (
            <button
              key={t}
              className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs hover:bg-zinc-50"
              onClick={() => onChange(tags.filter((x) => x !== t))}
              title="点击删除标签"
            >
              {t}
            </button>
          ))
        ) : (
          <div className="text-xs text-zinc-500">暂无标签</div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          className="h-9 flex-1 rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-zinc-400"
          placeholder="输入标签后回车（例如：翠鸟、飞行版）"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            const t = value.trim()
            if (!t) return
            if (tags.includes(t)) {
              setValue('')
              return
            }
            onChange([...tags, t])
            setValue('')
          }}
        />
        <button
          className="h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm hover:bg-zinc-50"
          onClick={() => {
            const t = value.trim()
            if (!t) return
            if (!tags.includes(t)) onChange([...tags, t])
            setValue('')
          }}
        >
          添加
        </button>
      </div>
    </div>
  )
}

