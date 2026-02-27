import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import * as OpenCC from 'opencc-js'

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

const MANUAL_FIXES = {
  'Grus virgo': '蓑羽鹤',
  'Anser indicus': '斑头雁',
  'Grus nigricollis': '黑颈鹤',
  'Eupodotis caerulescens': '蓝鸨',
  'Crossoptilon auritum': '蓝马鸡',
  'Nycticorax nycticorax': '夜鹭',
}

async function main() {
  const token = String(process.env.EBIRD_API_KEY ?? '').trim()
  if (!token) {
    throw new Error('缺少 EBIRD_API_KEY：请先到 eBird Keygen 生成 API Key，并设置到环境变量')
  }

  const { region, outPath, all } = parseArgs(process.argv)
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

  // 拉取三个语言版本：简体中文 (zh_CN), 繁体中文 (zh_TW), 英文 (en)
  const locales = ['zh_CN', 'zh_TW', 'en']
  console.log(`fetching taxonomy for locales: ${locales.join(', ')} ...`)

  const taxPromises = locales.map((loc) =>
    ebirdGetJson(
      `${base}/ref/taxonomy/ebird?fmt=json&cat=species&locale=${encodeURIComponent(loc)}`,
      token,
    ).then((res) => ({ loc, data: res })),
  )

  const results = await Promise.all(taxPromises)
  const taxMap = {} // speciesCode -> { sciName, zh_CN, zh_TW, en }
  
  // 初始化 OpenCC 转换器 (繁体 -> 简体)
  const converter = OpenCC.Converter({ from: 'hk', to: 'cn' })

  for (const { loc, data } of results) {
    if (!Array.isArray(data)) throw new Error(`taxonomy ${loc} 响应格式异常`)
    for (const t of data) {
      if (!t || typeof t !== 'object') continue
      const code = String(t.speciesCode ?? '')
      if (!code) continue
      
      if (!taxMap[code]) {
        taxMap[code] = {
          sciName: String(t.sciName ?? '').trim(),
          zh_CN: '',
          zh_TW: '',
          en: '',
        }
      }
      // eBird 的 comName 就是对应 locale 的俗名
      const name = String(t.comName ?? '').trim()
      if (loc === 'zh_CN') taxMap[code].zh_CN = name ? converter(name) : ''
      else if (loc === 'zh_TW') taxMap[code].zh_TW = name
      else if (loc === 'en') taxMap[code].en = name
    }
  }

  const codes = set ? await set : null
  const codeSet = codes ? new Set(codes.map((c) => String(c))) : null
  
  // 过滤并生成最终列表
  const rows = []
  const taxonomyJson = {} // sciName -> { zh_CN, zh_TW, en }

  for (const code of Object.keys(taxMap)) {
    if (codeSet && !codeSet.has(code)) continue
    const item = taxMap[code]
    const { sciName, zh_CN, zh_TW, en } = item
    if (!sciName) continue

    // 尝试补全 zh_CN：如果 zh_CN 为空但有 zh_TW，则用 OpenCC 转简
    if (!item.zh_CN && item.zh_TW) {
      item.zh_CN = converter(item.zh_TW)
    }

    // 尝试应用手动修复表
    if (MANUAL_FIXES[sciName] && (!item.zh_CN || item.zh_CN === sciName)) {
      item.zh_CN = MANUAL_FIXES[sciName]
    }

    // 优先用简体，没有则繁体，再没有则英文
    const primaryName = item.zh_CN || item.zh_TW || en
    if (!primaryName) continue

    rows.push([primaryName, sciName])
    taxonomyJson[sciName] = { zh_CN: item.zh_CN, zh_TW: item.zh_TW, en }
  }

  // 去重（按 primaryName + sciName）
  const dedup = new Map()
  for (const [zh, sci] of rows) {
    dedup.set(`${zh}__${sci}`, [zh, sci])
  }
  const list = Array.from(dedup.values()).sort((a, b) => a[1].localeCompare(b[1]))

  await fs.mkdir(path.dirname(outPath), { recursive: true })
  
  // 1. 输出 labels.csv (给 AI 用)
  const csv = ['中文名,学名', ...list.map(([zh, sci]) => toCsvRow(zh, sci))].join('\n') + '\n'
  await fs.writeFile(outPath, `\ufeff${csv}`, 'utf-8')

  // 2. 输出 taxonomy.json (给前端用)
  const jsonPath = path.join(path.dirname(outPath), 'taxonomy.json')
  await fs.writeFile(jsonPath, JSON.stringify(taxonomyJson, null, 2), 'utf-8')

  process.stdout.write(`ok: ${list.length} labels -> ${outPath}\n`)
  process.stdout.write(`ok: taxonomy json -> ${jsonPath}\n`)
}

await main()
