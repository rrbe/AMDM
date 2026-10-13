import { QuickSearchIndex } from './engine'
import type { SearchWorkerRequest, SearchWorkerResponse } from './types'

const context = self as unknown as {
  onmessage: ((event: MessageEvent<SearchWorkerRequest>) => void) | null
  postMessage(message: SearchWorkerResponse): void
}
const index = new QuickSearchIndex()
let generation = 0
let updates = Promise.resolve()
context.onmessage = ({ data }) => {
  const current = ++generation
  if (data.type === 'cancel') return
  if (data.type === 'sync') {
    updates = updates.then(() => index.sync(data.upsert, data.remove))
    return
  }
  void updates.then(async () => {
    if (current !== generation) return
    try {
      const result = await index.search(data.request, () => current !== generation)
      if (result) context.postMessage({ seq: data.seq, result })
    } catch (error) {
      context.postMessage({ seq: data.seq, error: error instanceof Error ? error.message : String(error) })
    }
  })
}
