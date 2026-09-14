import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ResultTab } from '@renderer/lib/tabs'
import { resultDataSize } from '@renderer/lib/resultDataSize'
import { formatBytes } from '@renderer/lib/formatBytes'

/** Mounted by the shared tooltip only when its data-size detail is displayed. */
export function ResultDataSize({ results }: { results: readonly ResultTab[] }): React.JSX.Element {
  const { t } = useTranslation()
  const [measurement, setMeasurement] = useState<{ results: readonly ResultTab[]; bytes: number } | null>(
    null
  )
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      let bytes = 0
      for (const entry of results) {
        const size = await resultDataSize(entry.result, controller.signal)
        if (size === null) return
        bytes += size
      }
      if (!controller.signal.aborted) setMeasurement({ results, bytes })
    })()
    return () => controller.abort()
  }, [results])
  return (
    <span data-result-data-size="">
      {measurement?.results === results ? formatBytes(measurement.bytes) : t('context.measuringDataSize')}
    </span>
  )
}
