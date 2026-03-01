import { getDb, nowIso } from './catalog.js'
import { deleteSetting, getSetting, hasSettingsTable, setSetting } from '../repos/settingsRepo.js'

let checked = false
let enabled = false

function ensure() {
  if (checked) return
  checked = true
  try {
    enabled = hasSettingsTable(getDb())
  } catch {
    enabled = false
  }
}

export function isRuntimeSettingsAvailable() {
  ensure()
  return enabled
}

export function getRuntimeSetting(key: string): string | null {
  ensure()
  if (!enabled) return null
  const v = getSetting(getDb(), key)
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s : null
}

export function setRuntimeSetting(key: string, value: string | null) {
  ensure()
  if (!enabled) return
  const v = String(value ?? '').trim()
  if (!v) {
    deleteSetting(getDb(), key)
    return
  }
  setSetting(getDb(), key, v, nowIso())
}
