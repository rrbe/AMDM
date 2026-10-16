import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import { IANA_TIME_ZONES } from '@shared/timeZones'
import { formatTimeZoneLabel, getSystemTimeZone } from '@renderer/lib/dateTimeZone'
import { SearchableSelect } from './SearchableSelect'

interface TimeZoneSelectProps {
  value: string
  onChange: (value: string) => void
}

function matchesTimeZone(filterText: string, query: string): boolean {
  return filterText.toLowerCase().replaceAll('_', ' ').includes(query.trim().toLowerCase().replaceAll('_', ' '))
}

export function TimeZoneSelect({ value, onChange }: TimeZoneSelectProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const options = useMemo(() => {
    const now = new Date()
    const systemLabel = `${t('settings.timeZoneSystem')} · ${formatTimeZoneLabel(getSystemTimeZone(), now, i18n.resolvedLanguage)}`
    return [
      { value: 'system', label: systemLabel, filterText: systemLabel, pinned: true },
      ...IANA_TIME_ZONES.map((timeZone) => {
        const label = formatTimeZoneLabel(timeZone, now, i18n.resolvedLanguage)
        return { value: timeZone, label, filterText: label }
      })
    ]
  }, [t, i18n.resolvedLanguage])
  const selectedLabel = options.find((option) => option.value === value)?.label ?? value

  return (
    <SearchableSelect
      value={value}
      onChange={onChange}
      options={options}
      matches={matchesTimeZone}
      triggerContent={<>
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
      </>}
      header={t('settings.timeZoneHeader')}
      placeholder={t('settings.timeZoneSearchPlaceholder')}
      emptyMessage={t('settings.timeZoneEmpty')}
      aria-label={t('settings.timeZone')}
      className="h-[38px] justify-between gap-2 px-3 text-[13px]"
    />
  )
}
