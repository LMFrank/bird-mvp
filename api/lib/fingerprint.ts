import crypto from 'node:crypto'
import fs from 'node:fs/promises'

type FingerprintInput = {
  absPath: string
  size: number
}

const SAMPLE_BYTES = 1024 * 1024

export async function computeFingerprint({ absPath, size }: FingerprintInput) {
  const handle = await fs.open(absPath, 'r')
  try {
    const headSize = Math.min(SAMPLE_BYTES, size)
    const tailSize = Math.min(SAMPLE_BYTES, Math.max(0, size - headSize))

    const head = Buffer.alloc(headSize)
    await handle.read(head, 0, headSize, 0)

    const tail = Buffer.alloc(tailSize)
    if (tailSize > 0) {
      await handle.read(tail, 0, tailSize, size - tailSize)
    }

    const h = crypto.createHash('sha1')
    h.update(String(size))
    h.update('\0')
    h.update(head)
    h.update('\0')
    h.update(tail)
    return h.digest('hex')
  } finally {
    await handle.close()
  }
}

