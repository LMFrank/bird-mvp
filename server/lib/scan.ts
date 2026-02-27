import fs from 'node:fs/promises'
import path from 'node:path'

export type ScanCandidate = {
  absPath: string
  relPath: string
}

const EXT_ALLOW = new Set(['.jpg', '.jpeg', '.png', '.webp'])

export async function collectImages(rootPath: string) {
  const out: ScanCandidate[] = []
  await walk(rootPath, rootPath, out)
  return out
}

async function walk(rootPath: string, current: string, out: ScanCandidate[]) {
  const entries = await fs.readdir(current, { withFileTypes: true })
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue
    const abs = path.join(current, ent.name)
    if (ent.isDirectory()) {
      await walk(rootPath, abs, out)
      continue
    }
    if (!ent.isFile()) continue
    const ext = path.extname(ent.name).toLowerCase()
    if (!EXT_ALLOW.has(ext)) continue
    const rel = path.relative(rootPath, abs)
    out.push({ absPath: abs, relPath: rel })
  }
}

