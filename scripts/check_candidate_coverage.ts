import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { missingConfirmedSpecies } from '../server/lib/candidateCoverage.js'

const dbPath = process.argv[2] || path.join(process.cwd(), 'data', 'cache', 'catalog.sqlite')
const regionPath = process.argv[3]
const captivePath = process.argv[4] || path.join(process.cwd(), 'data', 'models', 'captive.csv')
const libraryId = Number(process.argv[5] || 0)
if (!regionPath) {
  throw new Error(
    '用法：npm run labels:check -- <catalog.sqlite> <region.csv> [captive.csv] [libraryId]',
  )
}
if (!fs.existsSync(regionPath)) throw new Error(`Region labels not found: ${regionPath}`)
if (!fs.existsSync(captivePath)) throw new Error(`Captive labels not found: ${captivePath}`)

const csvRows = (file: string) => fs.readFileSync(file, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.split(',').map((part) => part.trim()))
  .filter((row) => row.some(Boolean))
const regionSpecies = csvRows(regionPath)
  .filter((row) => row[1] && row[1] !== '学名' && row[1] !== 'name_scientific')
  .map((row) => row[1]!)
const captiveSpecies = csvRows(captivePath)
  .filter((row) => row[0] && row[0] !== 'name_scientific')
  .map((row) => row[0]!)

const db = new DatabaseSync(dbPath, { readOnly: true })
const where = libraryId > 0 ? 'AND p.library_id=?' : ''
const params = libraryId > 0 ? [libraryId] : []
const confirmed = db.prepare(
  `SELECT DISTINCT c.name_scientific as nameScientific
   FROM photo_species_confirmations c
   JOIN photos p ON p.id=c.photo_id
   WHERE c.status='confirmed' AND c.subject_type='bird'
     AND c.name_scientific IS NOT NULL ${where}`,
).all(...params).map((row) => String((row as { nameScientific: string }).nameScientific))
const missing = missingConfirmedSpecies(confirmed, regionSpecies, captiveSpecies)
process.stdout.write(`${JSON.stringify({
  dbPath,
  regionPath,
  captivePath,
  confirmed: confirmed.length,
  candidates: new Set([...regionSpecies, ...captiveSpecies]).size,
  missing,
  passed: missing.length === 0,
}, null, 2)}\n`)
if (missing.length) process.exitCode = 2
