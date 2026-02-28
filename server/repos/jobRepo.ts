import type { DatabaseSync } from 'node:sqlite'

export type JobRow = {
  id: string
  type: string
  status: string
  job_json: string
  cancel_requested: number
  created_at: string
  updated_at: string
}

export function insertJob(db: DatabaseSync, row: Omit<JobRow, 'updated_at'> & { updated_at?: string }) {
  const updatedAt = row.updated_at ?? row.created_at
  db.prepare(
    `
    INSERT INTO jobs(
      id, type, status, job_json, cancel_requested, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?
    )
    `,
  ).run(row.id, row.type, row.status, row.job_json, row.cancel_requested, row.created_at, updatedAt)
}

export function getJobRow(db: DatabaseSync, id: string): JobRow | null {
  const row = db
    .prepare(
      `
      SELECT id, type, status, job_json, cancel_requested, created_at, updated_at
      FROM jobs
      WHERE id = ?
      `,
    )
    .get(id) as JobRow | undefined
  return row ?? null
}

export function updateJobRow(db: DatabaseSync, id: string, patch: { status: string; job_json: string; updated_at: string }) {
  db.prepare('UPDATE jobs SET status = ?, job_json = ?, updated_at = ? WHERE id = ?').run(
    patch.status,
    patch.job_json,
    patch.updated_at,
    id,
  )
}

export function requestCancel(db: DatabaseSync, id: string, updatedAt: string) {
  const info = db.prepare('UPDATE jobs SET cancel_requested = 1, updated_at = ? WHERE id = ?').run(updatedAt, id)
  return info.changes > 0
}

export function clearStaleJobs(db: DatabaseSync, updatedAt: string) {
  db.prepare(
    `
    UPDATE jobs
    SET status = 'error', updated_at = ?
    WHERE status IN ('queued', 'running')
    `,
  ).run(updatedAt)
}
