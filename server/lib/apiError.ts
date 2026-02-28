export class ApiError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(opts: { status: number; code: string; message: string; details?: unknown }) {
    super(opts.message)
    this.status = opts.status
    this.code = opts.code
    this.details = opts.details
  }
}

export function badRequest(message: string, details?: unknown) {
  return new ApiError({ status: 400, code: 'BAD_REQUEST', message, details })
}

export function notFound(message: string, details?: unknown) {
  return new ApiError({ status: 404, code: 'NOT_FOUND', message, details })
}
