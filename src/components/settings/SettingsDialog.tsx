import { useEffect, useMemo, useState } from 'react'
import { X, SlidersHorizontal } from 'lucide-react'
import { getSettings, updateSettings, type AppSettings, type AppSettingsPatch } from '@/api/catalogApi'

type Props = {
  open: boolean
  onClose: () => void
}

const MASK = '********'

function parseNumberList(s: string) {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n))
}

export default function SettingsDialog(props: Props) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<AppSettings | null>(null)

  const [identifyMaxSize, setIdentifyMaxSize] = useState('4096')
  const [identifyQuality, setIdentifyQuality] = useState('90')
  const [identifyCropsSingle, setIdentifyCropsSingle] = useState('9')
  const [identifyCropsBatch, setIdentifyCropsBatch] = useState('3')
  const [identifyCropScale, setIdentifyCropScale] = useState('0.6')
  const [identifyCropScalesSingle, setIdentifyCropScalesSingle] = useState('0.6,0.45')
  const [identifyCropScalesBatch, setIdentifyCropScalesBatch] = useState('0.6,0.45')

  const [llmEnabled, setLlmEnabled] = useState(false)
  const [qwenBaseUrl, setQwenBaseUrl] = useState('')
  const [qwenModelName, setQwenModelName] = useState('qwen-vl-plus')
  const [qwenApiKey, setQwenApiKey] = useState('')
  const [llmUrl, setLlmUrl] = useState('')
  const [llmModel, setLlmModel] = useState('')
  const [llmApiKey, setLlmApiKey] = useState('')
  const [llmCandidates, setLlmCandidates] = useState('5')
  const [llmTriggerScore, setLlmTriggerScore] = useState('0.6')
  const [llmTriggerMargin, setLlmTriggerMargin] = useState('0.1')

  const title = useMemo(() => {
    if (!data) return '识别调优与兜底设置'
    return '识别调优与兜底设置'
  }, [data])

  useEffect(() => {
    if (!props.open) return
    setLoading(true)
    setError(null)
    getSettings()
      .then((r) => {
        setData(r)
        setIdentifyMaxSize(String(r.identify.maxSize))
        setIdentifyQuality(String(r.identify.quality))
        setIdentifyCropsSingle(String(r.identify.cropsSingle))
        setIdentifyCropsBatch(String(r.identify.cropsBatch))
        setIdentifyCropScale(String(r.identify.cropScale))
        setIdentifyCropScalesSingle((r.identify.cropScalesSingle ?? []).join(','))
        setIdentifyCropScalesBatch((r.identify.cropScalesBatch ?? []).join(','))

        setLlmEnabled(Boolean(r.llm.enabled))
        setQwenBaseUrl(r.llm.qwenBaseUrl ?? '')
        setQwenModelName(r.llm.qwenModelName ?? 'qwen-vl-plus')
        setLlmUrl(r.llm.llmUrl ?? '')
        setLlmModel(r.llm.llmModel ?? '')
        setLlmCandidates(r.llm.candidates ?? '5')
        setLlmTriggerScore(r.llm.triggerScore ?? '0.6')
        setLlmTriggerMargin(r.llm.triggerMargin ?? '0.1')
        setQwenApiKey(r.llm.hasQwenKey ? MASK : '')
        setLlmApiKey(r.llm.hasLlmKey ? MASK : '')
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : '加载设置失败')
      })
      .finally(() => setLoading(false))
  }, [props.open])

  if (!props.open) return null

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const payload: AppSettingsPatch = {
        identify: {
          maxSize: Number(identifyMaxSize),
          quality: Number(identifyQuality),
          cropsSingle: Number(identifyCropsSingle),
          cropsBatch: Number(identifyCropsBatch),
          cropScale: Number(identifyCropScale),
          cropScalesSingle: parseNumberList(identifyCropScalesSingle),
          cropScalesBatch: parseNumberList(identifyCropScalesBatch),
        },
        llm: {
          enabled: llmEnabled,
          qwenBaseUrl,
          qwenModelName,
          llmUrl,
          llmModel,
          candidates: llmCandidates,
          triggerScore: llmTriggerScore,
          triggerMargin: llmTriggerMargin,
          qwenApiKey: qwenApiKey !== MASK ? qwenApiKey : undefined,
          apiKey: llmApiKey !== MASK ? llmApiKey : undefined,
        },
      }
      const r = await updateSettings(payload)
      setData(r)
      setQwenApiKey(r.llm.hasQwenKey ? MASK : '')
      setLlmApiKey(r.llm.hasLlmKey ? MASK : '')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-3xl rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-5 w-5 text-zinc-700" />
            <div className="text-base font-semibold text-zinc-800">{title}</div>
          </div>
          <button
            className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-zinc-100"
            onClick={props.onClose}
            title="关闭"
          >
            <X className="h-5 w-5 text-zinc-600" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-auto p-4">
          {loading ? <div className="text-sm text-zinc-600">加载中...</div> : null}
          {error ? <div className="mb-3 text-sm text-rose-600">{error}</div> : null}

          <div className="mb-5">
            <div className="mb-2 text-sm font-semibold text-zinc-800">识别输入调优</div>
            <div className="text-xs text-zinc-600">
              这会影响“识别”时发送给模型的 JPEG：分辨率、压缩质量、裁剪数量与裁剪尺度。一般来说，鸟在画面里越小，越需要更多裁剪与更小的裁剪尺度。
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="text-sm text-zinc-700">
                最大边长（px）
                <input
                  className="mt-1 h-9 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-400"
                  value={identifyMaxSize}
                  onChange={(e) => setIdentifyMaxSize(e.target.value)}
                  inputMode="numeric"
                />
                <div className="mt-1 text-xs text-zinc-500">范围 512~8192。越大越清晰，但更慢。</div>
              </label>

              <label className="text-sm text-zinc-700">
                JPEG 质量
                <input
                  className="mt-1 h-9 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-400"
                  value={identifyQuality}
                  onChange={(e) => setIdentifyQuality(e.target.value)}
                  inputMode="numeric"
                />
                <div className="mt-1 text-xs text-zinc-500">范围 30~100。越高越清晰，但体积更大。</div>
              </label>

              <label className="text-sm text-zinc-700">
                单张裁剪数
                <input
                  className="mt-1 h-9 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-400"
                  value={identifyCropsSingle}
                  onChange={(e) => setIdentifyCropsSingle(e.target.value)}
                  inputMode="numeric"
                />
                <div className="mt-1 text-xs text-zinc-500">范围 1~9。包含 1 张全图，其余为裁剪。</div>
              </label>

              <label className="text-sm text-zinc-700">
                批量裁剪数
                <input
                  className="mt-1 h-9 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-400"
                  value={identifyCropsBatch}
                  onChange={(e) => setIdentifyCropsBatch(e.target.value)}
                  inputMode="numeric"
                />
                <div className="mt-1 text-xs text-zinc-500">批量更建议 2~4，避免速度太慢。</div>
              </label>

              <label className="text-sm text-zinc-700">
                兼容：单一裁剪尺度
                <input
                  className="mt-1 h-9 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-400"
                  value={identifyCropScale}
                  onChange={(e) => setIdentifyCropScale(e.target.value)}
                  inputMode="decimal"
                />
                <div className="mt-1 text-xs text-zinc-500">范围 0.35~0.9。仅在未配置多尺度时使用。</div>
              </label>

              <div />

              <label className="text-sm text-zinc-700">
                单张多尺度（逗号分隔）
                <input
                  className="mt-1 h-9 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-400"
                  value={identifyCropScalesSingle}
                  onChange={(e) => setIdentifyCropScalesSingle(e.target.value)}
                />
                <div className="mt-1 text-xs text-zinc-500">示例：0.6,0.45（鸟更小可试 0.4）。</div>
              </label>

              <label className="text-sm text-zinc-700">
                批量多尺度（逗号分隔）
                <input
                  className="mt-1 h-9 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-400"
                  value={identifyCropScalesBatch}
                  onChange={(e) => setIdentifyCropScalesBatch(e.target.value)}
                />
                <div className="mt-1 text-xs text-zinc-500">建议比单张更保守，例如 0.6,0.5。</div>
              </label>
            </div>
          </div>

          <div className="mb-2 text-sm font-semibold text-zinc-800">低置信度兜底（多模态大模型）</div>
          <div className="text-xs text-zinc-600">
            当离线模型 Top1 分数低或与 Top2 差距小，会触发兜底，从候选 TopK 中二次裁决。启用后更准但更慢且需要联网与 API Key。
          </div>
          {data?.llm?.runtimeSupported === false ? (
            <div className="mt-2 text-xs text-rose-600">
              当前后端不支持运行时设置写入（app_settings 表不存在）。请先更新容器并重启，或改用 .env 注入。
            </div>
          ) : null}

          <div className="mt-3 flex items-center gap-2">
            <input
              id="llmEnabled"
              type="checkbox"
              className="h-4 w-4"
              checked={llmEnabled}
              onChange={(e) => setLlmEnabled(e.target.checked)}
            />
            <label htmlFor="llmEnabled" className="text-sm text-zinc-700">
              启用兜底
            </label>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-sm text-zinc-700">
              Qwen Base URL
              <input
                className="mt-1 h-9 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-400"
                value={qwenBaseUrl}
                onChange={(e) => setQwenBaseUrl(e.target.value)}
                placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
              />
              <div className="mt-1 text-xs text-zinc-500">不填将使用默认值（DashScope 兼容模式）。</div>
            </label>

            <label className="text-sm text-zinc-700">
              Qwen 多模态模型名
              <input
                className="mt-1 h-9 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-400"
                value={qwenModelName}
                onChange={(e) => setQwenModelName(e.target.value)}
                placeholder="qwen-vl-plus"
              />
              <div className="mt-1 text-xs text-zinc-500">必须支持图片输入（VL）。</div>
            </label>

            <label className="text-sm text-zinc-700">
              Qwen API Key（不会回显）
              <input
                className="mt-1 h-9 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-400"
                value={qwenApiKey}
                onChange={(e) => setQwenApiKey(e.target.value)}
                onFocus={(e) => {
                  if (qwenApiKey === MASK) e.currentTarget.select()
                }}
                placeholder="未设置"
                type="password"
              />
              <div className="mt-1 text-xs text-zinc-500">
                只在本地数据库保存，不会写回 .env。当前来源：{data?.llm?.qwenKeySource ?? 'unknown'}
              </div>
            </label>

            <div />

            <label className="text-sm text-zinc-700">
              OpenAI 兼容 URL（可选）
              <input
                className="mt-1 h-9 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-400"
                value={llmUrl}
                onChange={(e) => setLlmUrl(e.target.value)}
                placeholder="https://api.openai.com/v1/chat/completions"
              />
              <div className="mt-1 text-xs text-zinc-500">不填则使用 Qwen Base URL。</div>
            </label>

            <label className="text-sm text-zinc-700">
              OpenAI 兼容模型名（可选）
              <input
                className="mt-1 h-9 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-400"
                value={llmModel}
                onChange={(e) => setLlmModel(e.target.value)}
                placeholder="gpt-4o-mini"
              />
              <div className="mt-1 text-xs text-zinc-500">不填则优先使用 Qwen 模型名。</div>
            </label>

            <label className="text-sm text-zinc-700">
              OpenAI 兼容 API Key（不会回显）
              <input
                className="mt-1 h-9 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-400"
                value={llmApiKey}
                onChange={(e) => setLlmApiKey(e.target.value)}
                onFocus={(e) => {
                  if (llmApiKey === MASK) e.currentTarget.select()
                }}
                placeholder="未设置"
                type="password"
              />
              <div className="mt-1 text-xs text-zinc-500">
                优先级高于 Qwen API Key。当前来源：{data?.llm?.llmKeySource ?? 'unknown'}
              </div>
            </label>

            <label className="text-sm text-zinc-700">
              候选数（TopK）
              <input
                className="mt-1 h-9 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-400"
                value={llmCandidates}
                onChange={(e) => setLlmCandidates(e.target.value)}
                inputMode="numeric"
              />
              <div className="mt-1 text-xs text-zinc-500">范围 2~10。越大越慢。</div>
            </label>

            <label className="text-sm text-zinc-700">
              触发分数阈值
              <input
                className="mt-1 h-9 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-400"
                value={llmTriggerScore}
                onChange={(e) => setLlmTriggerScore(e.target.value)}
                inputMode="decimal"
              />
              <div className="mt-1 text-xs text-zinc-500">Top1 分数低于该值就触发兜底。</div>
            </label>

            <label className="text-sm text-zinc-700">
              触发差距阈值
              <input
                className="mt-1 h-9 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-400"
                value={llmTriggerMargin}
                onChange={(e) => setLlmTriggerMargin(e.target.value)}
                inputMode="decimal"
              />
              <div className="mt-1 text-xs text-zinc-500">Top1-Top2 差距小于该值就触发兜底。</div>
            </label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-4 py-3">
          <button
            className="inline-flex h-9 items-center rounded-md border border-zinc-300 bg-white px-3 text-sm hover:bg-zinc-50"
            onClick={props.onClose}
            disabled={saving}
          >
            关闭
          </button>
          <button
            className="inline-flex h-9 items-center rounded-md bg-zinc-900 px-3 text-sm text-white hover:bg-zinc-800 disabled:opacity-50"
            onClick={() => void save()}
            disabled={saving || loading}
          >
            {saving ? '保存中...' : '保存并生效'}
          </button>
        </div>
      </div>
    </div>
  )
}
