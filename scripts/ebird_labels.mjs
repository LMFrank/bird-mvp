import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'

function parseArgs(argv) {
  const out = {
    region: 'CN',
    locale: 'zh_CN',
    outPath: path.join(process.cwd(), 'data', 'models', 'labels.csv'),
    all: false,
  }
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--region') out.region = String(argv[++i] ?? '')
    else if (a === '--locale') out.locale = String(argv[++i] ?? '')
    else if (a === '--out') out.outPath = String(argv[++i] ?? '')
    else if (a === '--all') out.all = true
  }
  if (!out.outPath) out.outPath = path.join(process.cwd(), 'data', 'models', 'labels.csv')
  return out
}

async function ebirdGetJson(url, token) {
  const res = await fetch(url, {
    headers: {
      'x-ebirdapitoken': token,
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`eBird API HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
  }
  return res.json()
}

function toCsvRow(zh, sci) {
  const norm = (s) => String(s ?? '').replaceAll('"', '""')
  return `"${norm(zh)}","${norm(sci)}"`
}

async function main() {
  const token = String(process.env.EBIRD_API_KEY ?? '').trim()
  if (!token) {
    throw new Error('缺少 EBIRD_API_KEY：请先到 eBird Keygen 生成 API Key，并设置到环境变量')
  }

  const { region, locale, outPath, all } = parseArgs(process.argv)
  if (!all && !region) throw new Error('缺少 --region，例如 CN，或使用 --all 生成全量 taxonomy')

  const base = 'https://api.ebird.org/v2'
  const set = all
    ? null
    : (() => {
        const codesPromise = ebirdGetJson(
          `${base}/product/spplist/${encodeURIComponent(region)}`,
          token,
        )
        return codesPromise
      })()

  const taxonomy = await ebirdGetJson(
    `${base}/ref/taxonomy/ebird?fmt=json&cat=species&locale=${encodeURIComponent(locale)}`,
    token,
  )
  if (!Array.isArray(taxonomy)) throw new Error('taxonomy 响应格式异常')

  const codes = set ? await set : null
  const codeSet = codes ? new Set(codes.map((c) => String(c))) : null
  const rows = []
  for (const t of taxonomy) {
    if (!t || typeof t !== 'object') continue
    const speciesCode = String(t.speciesCode ?? '')
    if (codeSet && !codeSet.has(speciesCode)) continue
    const zh = String(t.comName ?? '').trim()
    const sci = String(t.sciName ?? '').trim()
    if (!zh || !sci) continue
    rows.push([zh, sci])
  }

  const dedup = new Map()
  for (const [zh, sci] of rows) {
    dedup.set(`${zh}__${sci}`, [zh, sci])
  }
  const list = Array.from(dedup.values()).sort((a, b) => a[1].localeCompare(b[1]))

  await fs.mkdir(path.dirname(outPath), { recursive: true })
  const csv = ['中文名,学名', ...list.map(([zh, sci]) => toCsvRow(zh, sci))].join('\n') + '\n'
  await fs.writeFile(outPath, `\ufeff${csv}`, 'utf-8')

  process.stdout.write(`ok: ${list.length} labels -> ${outPath}\n`)
}

await main()
