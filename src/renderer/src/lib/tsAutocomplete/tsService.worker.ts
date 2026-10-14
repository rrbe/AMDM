/** Official declarations and the language service stay in this lazy Worker. */
import { complete, setFile } from './tsService'
import type { TsWorkerRequest, TsWorkerResponse, TsCompletionEntry } from './protocol'

const scope = self as unknown as {
  postMessage(message: TsWorkerResponse): void
  onmessage: ((event: { data: TsWorkerRequest }) => void) | null
}

scope.onmessage = (e): void => {
  const msg = e.data
  if (msg.type === 'init') {
    complete('db.', 3)
    scope.postMessage({ type: 'ready' })
    return
  }
  if (msg.type === 'decls') {
    setFile('/decls.d.ts', msg.text)
    return
  }
  if (msg.type === 'complete') {
    let result: {
      entries: TsCompletionEntry[]
      replacementSpan?: { from: number }
    } = { entries: [] }
    try {
      result = complete(msg.code, msg.pos)
    } catch {
      result = { entries: [] }
    }
    scope.postMessage({ type: 'result', seq: msg.seq, ...result })
  }
}
