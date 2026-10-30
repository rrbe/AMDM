import { useEffect, useState } from 'react'
import { cachedResultFieldInfo, prepareResultFieldInfo } from './resultFields'

export function useResultFieldInfo(docs: unknown[], enabled: boolean) {
  const [prepared, setPrepared] = useState<{
    docs: unknown[]
    info?: ReturnType<typeof cachedResultFieldInfo>
    error?: Error
  }>()
  useEffect(() => {
    if (!enabled) {
      setPrepared(undefined)
      return
    }
    const cached = cachedResultFieldInfo(docs)
    if (cached) {
      setPrepared({ docs, info: cached })
      return
    }
    const controller = new AbortController()
    void prepareResultFieldInfo(docs, controller.signal).then(
      (info) => { if (!controller.signal.aborted) setPrepared({ docs, info }) },
      (error: Error) => { if (!controller.signal.aborted) setPrepared({ docs, error }) }
    )
    return () => controller.abort()
  }, [docs, enabled])
  if (!enabled) return undefined
  if (prepared?.docs === docs && prepared.error) throw prepared.error
  return prepared?.docs === docs ? prepared.info : cachedResultFieldInfo(docs)
}
