import fs from 'node:fs/promises'
import path from 'node:path'

function parseArgs(argv) {
  const opts = {
    cache: false,
    models: false,
  }
  for (let i = 2; i < argv.length; i += 1) {
    const a = String(argv[i] ?? '')
    if (a === '--cache') opts.cache = true
    else if (a === '--models') opts.models = true
    else if (a === '--all') {
      opts.cache = true
      opts.models = true
    }
  }
  if (!opts.cache && !opts.models) opts.cache = true
  return opts
}

async function rmDir(p) {
  await fs.rm(p, { recursive: true, force: true, maxRetries: 3 })
}

async function main() {
  const opts = parseArgs(process.argv)
  const root = process.cwd()
  const tasks = []
  if (opts.cache) tasks.push(path.join(root, 'data', 'cache'))
  if (opts.models) tasks.push(path.join(root, 'data', 'models'))
  for (const p of tasks) {
    await rmDir(p)
    process.stdout.write(`ok: removed ${p}\n`)
  }
}

await main()

