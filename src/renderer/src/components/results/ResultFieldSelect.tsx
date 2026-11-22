import { useMemo, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { getActiveTab, useAppStore } from '@renderer/store/useAppStore'
import { FieldSelect } from '@renderer/components/ui/FieldSelect'
import { useResultFieldInfo } from '@renderer/lib/useResultFieldInfo'
import { orderFieldNames } from '@renderer/lib/ejson'

export function ResultFieldSelect({ docs, trigger }: { docs: unknown[]; trigger?: ReactElement }): React.JSX.Element | null {
  const { t } = useTranslation()
  const selected = useAppStore((s) => getActiveTab(s).visibleFields)
  const setSelected = useAppStore((s) => s.setVisibleFields)
  const fieldSort = useAppStore((s) => s.settings.resultFieldSort)
  const info = useResultFieldInfo(docs, true)
  const fields = useMemo(() => info ? orderFieldNames(info.fields, fieldSort) : [], [info, fieldSort])
  const current = useMemo(() => new Set(fields), [fields])
  const options = useMemo(() => info ? [...new Set([...fields, ...(selected ?? [])])] : undefined, [fields, selected, info])

  if (info && fields.length === 0 && selected === null) return null

  return (
    <FieldSelect
      multiple selectAll fields={options} value={selected} onChange={setSelected}
      label={t('result.visibleFields')}
      trigger={trigger}
      side="right"
      renderField={(field) => <>{field}{!current.has(field) && <span className="ml-1 text-muted-foreground">({t('result.fieldNotOnPage')})</span>}</>}
    />
  )
}
