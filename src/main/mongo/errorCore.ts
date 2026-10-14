import type { FailureKind } from '../../shared/types'

interface ErrorShape {
  name?: unknown
  code?: unknown
  codeName?: unknown
  message?: unknown
  cause?: unknown
}

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTDOWN',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'EPIPE'
])

/** Classify MongoDB/Node failures structurally so foreign-realm errors work too. */
export function classifyOperationFailure(error: unknown): FailureKind {
  return classifyFailure(error, new Set())
}

function classifyFailure(error: unknown, seen: Set<unknown>): FailureKind {
  if ((typeof error === 'object' && error !== null) || typeof error === 'function') {
    if (seen.has(error)) return 'execution'
    seen.add(error)
  }

  const value = (error ?? {}) as ErrorShape
  const name = typeof value.name === 'string' ? value.name : ''
  const code = typeof value.code === 'string' || typeof value.code === 'number' ? value.code : undefined
  const codeName = typeof value.codeName === 'string' ? value.codeName : ''
  const message = typeof value.message === 'string' ? value.message : String(error)

  if (
    code === 50 ||
    codeName === 'MaxTimeMSExpired' ||
    /timeout/i.test(name) ||
    /timed? out|maxTimeMS expired|time limit/i.test(message)
  ) {
    return 'timeout'
  }
  if (name === 'AbortError' || /operation (?:was )?aborted|execution stopped/i.test(message)) {
    return 'cancelled'
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /\b(?:ENOTFOUND|EAI_AGAIN)\b/.test(message)) {
    return 'dns'
  }
  if (code === 18 || codeName === 'AuthenticationFailed' || /authentication (?:failed|rejected)/i.test(message)) {
    return 'auth'
  }
  if (
    (typeof code === 'string' && NETWORK_CODES.has(code)) ||
    /MongoNetworkError|MongoServerSelectionError/.test(name)
  ) {
    return 'network'
  }
  if (/host key verification failed/i.test(message)) return 'hostkey'

  if (value.cause && value.cause !== error) {
    const causeKind = classifyFailure(value.cause, seen)
    if (causeKind !== 'execution') return causeKind
  }
  return 'execution'
}
