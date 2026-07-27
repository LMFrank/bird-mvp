import { spawnSync } from 'node:child_process'
import path from 'node:path'

const region = String(process.argv[2] ?? '').trim().toUpperCase()
if (!region || !/^[A-Z0-9_-]{2,32}$/.test(region)) {
  throw new Error('用法：npm run labels:region -- CN-JS')
}
const out = path.join(process.cwd(), 'data', 'models', 'regions', `${region}.csv`)
const result = spawnSync(
  process.execPath,
  ['scripts/ebird_labels.mjs', '--region', region, '--locale', 'zh_CN', '--out', out],
  { stdio: 'inherit', env: process.env },
)
process.exit(result.status ?? 1)
